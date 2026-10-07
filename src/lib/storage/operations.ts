"use client";

import { getProperties, getUrl, list, uploadData } from "aws-amplify/storage";

import { activeClient } from "@config/index";
import { canRead, canUpload } from "@config/access";
import { configureAmplify, resolveBucket } from "@/lib/amplify/client";
import { recordDataAccess } from "@/lib/audit";

import { downloadPresentation } from "./download-policy";
import { joinKey, nextAvailableKey, sanitiseFileName } from "./keys";

/**
 * S3 operations, scoped to one bucket.
 *
 * ## There is no delete here, and there must never be
 *
 * This module exposes list, download and upload. It does not wrap
 * `remove()` from `aws-amplify/storage`, and the IAM policy on every group role
 * does not grant `s3:DeleteObject` — so adding a delete here would fail at
 * runtime as well as violating the product constraint. If a future requirement
 * seems to need deletion, that is a conversation about lifecycle policies in
 * AWS, not a function in this file.
 */

export interface StorageEntry {
  /** Full S3 key. */
  readonly key: string;
  /** Display name — the segment after the last `/`. */
  readonly name: string;
  readonly size: number | undefined;
  readonly lastModified: string | null;
  /** True for a synthetic folder row derived from a common prefix. */
  readonly isFolder: boolean;
  /** Who uploaded it, when the portal recorded that. */
  readonly uploadedBy: string | null;
}

/**
 * Objects fetched per S3 call while filling one folder view.
 */
const LIST_PAGE_SIZE = 1000;

/**
 * Ceiling on how many objects one folder view will fetch.
 *
 * `listAll` used to be passed here, which enumerates *every* object under the
 * prefix. Our showcase buckets hold a few dozen seeded files, so that was never
 * stressed — but a real client folder with tens of thousands of objects would
 * issue hundreds of sequential calls and hang the tab. A governance tool that
 * freezes on the client's largest folder is worse than one that says it is
 * showing the first few thousand entries.
 */
const LIST_MAX_ENTRIES = 5000;

/** One folder view: its rows, and whether the folder holds more than we fetched. */
export interface ListResult {
  readonly entries: readonly StorageEntry[];
  /** True when the folder holds more objects than `LIST_MAX_ENTRIES`. */
  readonly truncated: boolean;
  /** The ceiling that applied, so the UI can state it without duplicating it. */
  readonly limit: number;
}

export class AccessDeniedError extends Error {
  constructor(bucketId: string) {
    super(`You do not have access to the "${bucketId}" bucket.`);
    this.name = "AccessDeniedError";
  }
}

/** Metadata key the portal stamps on uploads, so the browser can show a source. */
const UPLOADED_BY = "uploaded-by";

function bucketTarget(bucketId: string) {
  configureAmplify();
  const { bucketName, region } = resolveBucket(bucketId);
  return { bucketName, region };
}

/**
 * Lists one level of a bucket: files at `prefix`, plus folder rows for the
 * prefixes below it.
 *
 * Amplify's `list` with `subpathStrategy: exclude` gives us S3's delimiter
 * behaviour, so a bucket with 50,000 objects across folders does not have to be
 * enumerated to render one screen. Pages are fetched up to `LIST_MAX_ENTRIES`
 * and then stopped — see that constant for why there is a ceiling at all.
 */
export async function listEntries(
  bucketId: string,
  groups: readonly string[],
  prefix: string,
): Promise<ListResult> {
  if (!canRead(activeClient, groups, bucketId)) {
    await recordDataAccess({
      action: "ACCESS_DENIED",
      outcome: "DENIED",
      bucketId,
      detail: { attempted: "list", prefix },
    });
    throw new AccessDeniedError(bucketId);
  }

  const bucket = bucketTarget(bucketId);

  const files: StorageEntry[] = [];
  // Folder rows are derived from common prefixes, which repeat across pages.
  const folderKeys = new Set<string>();
  let nextToken: string | undefined;
  let truncated = false;

  do {
    const page = await list({
      path: prefix,
      options: {
        bucket,
        pageSize: LIST_PAGE_SIZE,
        nextToken,
        subpathStrategy: { strategy: "exclude" },
      },
    });

    for (const subpath of page.excludedSubpaths ?? []) folderKeys.add(subpath);

    for (const item of page.items) {
      // S3 represents an empty folder as a zero-byte object ending in `/`.
      // Showing it as a file would be noise.
      if (item.path === prefix || item.path.endsWith("/")) continue;

      files.push({
        key: item.path,
        name: item.path.slice(prefix.length),
        size: item.size,
        lastModified: item.lastModified ? item.lastModified.toISOString() : null,
        isFolder: false,
        uploadedBy: null,
      });
    }

    nextToken = page.nextToken;

    if (files.length + folderKeys.size >= LIST_MAX_ENTRIES) {
      truncated = Boolean(nextToken);
      break;
    }
  } while (nextToken);

  const folders: StorageEntry[] = [...folderKeys].map((subpath) => ({
    key: subpath,
    name: subpath.slice(prefix.length).replace(/\/$/, ""),
    size: undefined,
    lastModified: null,
    isFolder: true,
    uploadedBy: null,
  }));

  await recordDataAccess({
    action: "FILE_LIST",
    outcome: "SUCCESS",
    bucketId,
    detail: { prefix, folders: folders.length, files: files.length, truncated },
  });

  return {
    entries: [...folders, ...files],
    truncated,
    limit: LIST_MAX_ENTRIES,
  };
}

/**
 * Produces a short-lived, signed download URL.
 *
 * The URL is minted against the user's own scoped credentials, so it cannot
 * reach a bucket their group does not grant. 5 minutes is enough to start a
 * download and short enough that a URL pasted into a chat is stale quickly.
 *
 * `Content-Disposition` and `Content-Type` are both forced on the response, so
 * a file the portal did not create cannot render itself as a page in the
 * browser. See `download-policy.ts` for what that defends against.
 */
export async function getDownloadUrl(
  bucketId: string,
  groups: readonly string[],
  key: string,
): Promise<string> {
  if (!canRead(activeClient, groups, bucketId)) {
    await recordDataAccess({
      action: "ACCESS_DENIED",
      outcome: "DENIED",
      bucketId,
      objectKey: key,
      detail: { attempted: "download" },
    });
    throw new AccessDeniedError(bucketId);
  }

  const presentation = downloadPresentation(key);

  const { url } = await getUrl({
    path: key,
    options: {
      bucket: bucketTarget(bucketId),
      expiresIn: 300,
      validateObjectExistence: true,
      contentDisposition: presentation.contentDisposition,
      contentType: presentation.contentType,
    },
  });

  await recordDataAccess({
    action: "FILE_DOWNLOAD",
    outcome: "SUCCESS",
    bucketId,
    objectKey: key,
    detail: { served: presentation.contentDisposition },
  });

  return url.toString();
}

export interface UploadResult {
  /** The key actually written — may differ from the requested one. */
  readonly key: string;
  /** True when the name was changed to avoid overwriting an existing object. */
  readonly renamed: boolean;
}

/**
 * Uploads a file without ever replacing an existing object.
 *
 * On collision the key is given a ` (2)` style suffix and the caller is told,
 * rather than the upload being silently rejected or the existing object being
 * overwritten. See `nextAvailableKey` for the race this leaves open and why
 * bucket versioning closes it.
 */
export async function uploadFile(
  bucketId: string,
  groups: readonly string[],
  prefix: string,
  file: File,
  actorEmail: string,
  onProgress?: (fraction: number) => void,
): Promise<UploadResult> {
  if (!canUpload(activeClient, groups, bucketId)) {
    await recordDataAccess({
      action: "ACCESS_DENIED",
      outcome: "DENIED",
      bucketId,
      detail: { attempted: "upload", fileName: file.name },
    });
    throw new AccessDeniedError(bucketId);
  }

  const target = bucketTarget(bucketId);
  const desiredKey = joinKey(prefix, sanitiseFileName(file.name));

  const exists = async (candidate: string) => {
    try {
      await getProperties({ path: candidate, options: { bucket: target } });
      return true;
    } catch {
      // Amplify surfaces a missing object as a thrown error rather than a null
      // result. Any failure here is treated as "not present", which is the
      // safe direction: at worst we probe one more candidate name.
      return false;
    }
  };

  const key = await nextAvailableKey(desiredKey, exists);
  const renamed = key !== desiredKey;

  if (renamed) {
    await recordDataAccess({
      action: "FILE_UPLOAD_REJECTED_COLLISION",
      outcome: "SUCCESS",
      bucketId,
      objectKey: desiredKey,
      detail: { storedAs: key, reason: "key-already-exists" },
    });
  }

  await uploadData({
    path: key,
    data: file,
    options: {
      bucket: target,
      contentType: file.type || "application/octet-stream",
      metadata: { [UPLOADED_BY]: actorEmail },
      onProgress: onProgress
        ? ({ transferredBytes, totalBytes }) => {
            if (totalBytes) onProgress(transferredBytes / totalBytes);
          }
        : undefined,
    },
  }).result;

  await recordDataAccess({
    action: "FILE_UPLOAD",
    outcome: "SUCCESS",
    bucketId,
    objectKey: key,
    detail: { size: file.size, contentType: file.type, renamed },
  });

  return { key, renamed };
}

/** Reads the portal's `uploaded-by` stamp for one object, if present. */
export async function fetchUploadedBy(
  bucketId: string,
  key: string,
): Promise<string | null> {
  try {
    const properties = await getProperties({
      path: key,
      options: { bucket: bucketTarget(bucketId) },
    });
    return properties.metadata?.[UPLOADED_BY] ?? null;
  } catch {
    return null;
  }
}
