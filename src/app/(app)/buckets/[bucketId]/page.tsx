"use client";

import { notFound, useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { activeClient } from "@config/index";
import { describeMode } from "@config/access";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Message,
  SortableHeader,
  Table,
  TableWrap,
  TextInput,
  type SortDirection,
} from "@/components/ui";
import { useSession } from "@/lib/auth/SessionProvider";
import { fileExtension, formatBytes, formatDateTime, pluralise } from "@/lib/format";
import {
  AccessDeniedError,
  getDownloadUrl,
  listEntries,
  uploadFile,
  type StorageEntry,
} from "@/lib/storage/operations";

import styles from "./Browser.module.css";

type SortKey = "name" | "size" | "lastModified";

interface ActiveUpload {
  readonly id: string;
  readonly name: string;
  progress: number;
  status: "uploading" | "done" | "failed";
  message?: string;
}

export default function BucketBrowserPage() {
  const params = useParams<{ bucketId: string }>();
  const { session } = useSession();

  const bucketId = params.bucketId;
  const bucket = activeClient.buckets.find((b) => b.id === bucketId);
  const access = session?.buckets.find((entry) => entry.bucket.id === bucketId);

  const [prefix, setPrefix] = useState("");
  const [entries, setEntries] = useState<StorageEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [direction, setDirection] = useState<SortDirection>("asc");
  const [uploads, setUploads] = useState<ActiveUpload[]>([]);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const groups = useMemo(() => session?.groups ?? [], [session]);
  const canUploadHere = access?.mode === "read-upload";

  const load = useCallback(async () => {
    if (!access) return;
    setLoading(true);
    setError(null);
    try {
      setEntries(await listEntries(bucketId, groups, prefix));
    } catch (caught) {
      setError(
        caught instanceof AccessDeniedError
          ? caught.message
          : "The bucket contents could not be loaded. Please try again.",
      );
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [access, bucketId, groups, prefix]);

  useEffect(() => {
    void load();
  }, [load]);

  // A bucket id that is not in the config at all is a genuine 404, distinct
  // from one the user simply cannot reach. Checked after the hooks above so the
  // hook order stays identical on every render.
  if (!bucket) notFound();

  /* ------------------------------------------------------------- Denied -- */

  if (session && !access) {
    return (
      <>
        <PageHeading bucketLabel={bucket.label} />
        <Message tone="warning">
          Your groups do not grant access to {bucket.label}. If you need it, ask
          an administrator to add you to a group that covers this bucket.
        </Message>
      </>
    );
  }

  if (!session || !access) return null;

  /* ------------------------------------------------------------ Sorting -- */

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setDirection((value) => (value === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setDirection("asc");
    }
  }

  const visible = entries
    .filter((entry) =>
      search.trim() === ""
        ? true
        : entry.name.toLowerCase().includes(search.trim().toLowerCase()),
    )
    .sort((a, b) => {
      // Folders always lead, regardless of sort — they are navigation, not data.
      if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;

      const factor = direction === "asc" ? 1 : -1;
      switch (sortKey) {
        case "size":
          return ((a.size ?? -1) - (b.size ?? -1)) * factor;
        case "lastModified":
          return (
            ((a.lastModified ? Date.parse(a.lastModified) : 0) -
              (b.lastModified ? Date.parse(b.lastModified) : 0)) *
            factor
          );
        default:
          return a.name.localeCompare(b.name, undefined, { numeric: true }) * factor;
      }
    });

  /* ---------------------------------------------------------- Downloads -- */

  async function download(entry: StorageEntry) {
    try {
      const url = await getDownloadUrl(bucketId, groups, entry.key);
      // `noopener` matters: the opened document gets a signed URL, and we do
      // not want it holding a handle back to this window.
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (caught) {
      setError(
        caught instanceof AccessDeniedError
          ? caught.message
          : `"${entry.name}" could not be downloaded. Please try again.`,
      );
    }
  }

  /* ------------------------------------------------------------ Uploads -- */

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0 || !canUploadHere) return;

    for (const file of Array.from(files)) {
      const id = `${file.name}-${Date.now()}-${Math.random()}`;
      setUploads((current) => [
        ...current,
        { id, name: file.name, progress: 0, status: "uploading" },
      ]);

      try {
        const result = await uploadFile(
          bucketId,
          groups,
          prefix,
          file,
          session!.email,
          (fraction) =>
            setUploads((current) =>
              current.map((upload) =>
                upload.id === id ? { ...upload, progress: fraction } : upload,
              ),
            ),
        );

        setUploads((current) =>
          current.map((upload) =>
            upload.id === id
              ? {
                  ...upload,
                  progress: 1,
                  status: "done",
                  message: result.renamed
                    ? `A file of that name already existed, so this was stored as "${result.key.slice(prefix.length)}". Nothing was overwritten.`
                    : undefined,
                }
              : upload,
          ),
        );
      } catch (caught) {
        setUploads((current) =>
          current.map((upload) =>
            upload.id === id
              ? {
                  ...upload,
                  status: "failed",
                  message:
                    caught instanceof AccessDeniedError
                      ? caught.message
                      : "Upload failed. Please try again.",
                }
              : upload,
          ),
        );
      }
    }

    await load();
  }

  const segments = prefix.split("/").filter(Boolean);

  return (
    <>
      <PageHeading
        bucketLabel={bucket.label}
        sensitivity={bucket.sensitivity}
        mode={describeMode(access.mode)}
        description={bucket.description}
        bucketName={bucket.bucketName}
        actions={
          canUploadHere ? (
            <Button variant="primary" onClick={() => fileInputRef.current?.click()}>
              Upload files
            </Button>
          ) : null
        }
      />

      {bucket.sensitivity === "sensitive" && (
        <div className={styles.noticeStack}>
          <Message tone="info">
            This bucket holds sensitive records. Downloads are logged against your
            account. Handle the contents under {activeClient.displayName}&rsquo;s
            data-protection policy.
          </Message>
        </div>
      )}

      {/* Breadcrumbs */}
      <nav className={styles.breadcrumbs} aria-label="Folder path">
        <button type="button" className={styles.crumb} onClick={() => setPrefix("")}>
          {bucket.bucketName}
        </button>
        {segments.map((segment, index) => {
          const isLast = index === segments.length - 1;
          const target = `${segments.slice(0, index + 1).join("/")}/`;
          return (
            <span key={target} style={{ display: "contents" }}>
              <span className={styles.crumbSeparator} aria-hidden="true">
                /
              </span>
              {isLast ? (
                <span className={styles.crumbCurrent} aria-current="page">
                  {segment}
                </span>
              ) : (
                <button
                  type="button"
                  className={styles.crumb}
                  onClick={() => setPrefix(target)}
                >
                  {segment}
                </button>
              )}
            </span>
          );
        })}
      </nav>

      {error && (
        <div className={styles.noticeStack}>
          <Message tone="error">{error}</Message>
        </div>
      )}

      {/* Upload surface */}
      {canUploadHere && (
        <>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            onChange={(event) => {
              void handleFiles(event.target.files);
              event.target.value = "";
            }}
          />
          <div
            className={`${styles.dropZone} ${dragging ? styles.dropZoneActive : ""}`}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              void handleFiles(event.dataTransfer.files);
            }}
          >
            <Button variant="secondary" onClick={() => fileInputRef.current?.click()}>
              Choose files
            </Button>
            <p className={styles.dropHint}>
              or drop them here. Uploads never replace an existing file — a name
              clash is stored alongside the original.
            </p>
          </div>
        </>
      )}

      {uploads.length > 0 && (
        <div className={styles.uploadList}>
          {uploads.map((upload) => (
            <div key={upload.id} className={styles.uploadRow}>
              <span className={styles.uploadName}>{upload.name}</span>
              {upload.status === "uploading" && (
                <div
                  className={styles.progressTrack}
                  role="progressbar"
                  aria-valuenow={Math.round(upload.progress * 100)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`Uploading ${upload.name}`}
                >
                  <div
                    className={styles.progressBar}
                    style={{ width: `${upload.progress * 100}%` }}
                  />
                </div>
              )}
              {upload.status === "done" && <Badge tone="success">Uploaded</Badge>}
              {upload.status === "failed" && <Badge tone="error">Failed</Badge>}
              {upload.message && (
                <span className="muted" style={{ fontSize: "0.8125rem" }}>
                  {upload.message}
                </span>
              )}
            </div>
          ))}
          <div>
            <Button small variant="ghost" onClick={() => setUploads([])}>
              Clear completed
            </Button>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className={styles.toolbar}>
        <div className={styles.search}>
          <TextInput
            type="search"
            placeholder="Search this folder…"
            aria-label="Search files in this folder"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <span className={styles.count}>
          {loading ? "Loading…" : pluralise(visible.length, "item")}
        </span>
        <Button small variant="ghost" onClick={() => void load()} disabled={loading}>
          Refresh
        </Button>
      </div>

      <Card flush>
        {loading ? (
          <EmptyState title="Loading…">Reading the bucket contents.</EmptyState>
        ) : visible.length === 0 ? (
          <EmptyState
            title={search.trim() ? "Nothing matches that search" : "This folder is empty"}
          >
            {search.trim()
              ? "Try a different term, or clear the search to see everything here."
              : canUploadHere
                ? "Upload a file to get started."
                : "Nothing has been placed here yet."}
          </EmptyState>
        ) : (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <SortableHeader
                    columnKey="name"
                    label="Name"
                    activeKey={sortKey}
                    direction={direction}
                    onSort={toggleSort}
                  />
                  <SortableHeader
                    columnKey="size"
                    label="Size"
                    activeKey={sortKey}
                    direction={direction}
                    onSort={toggleSort}
                    numeric
                  />
                  <SortableHeader
                    columnKey="lastModified"
                    label="Last modified"
                    activeKey={sortKey}
                    direction={direction}
                    onSort={toggleSort}
                    numeric
                  />
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((entry) => (
                  <tr key={entry.key}>
                    <td>
                      <div className={styles.nameCell}>
                        <span className={styles.icon} aria-hidden="true">
                          {entry.isFolder ? "▸" : "·"}
                        </span>
                        {entry.isFolder ? (
                          <button
                            type="button"
                            className={styles.folderLink}
                            onClick={() => {
                              setPrefix(entry.key);
                              setSearch("");
                            }}
                          >
                            {entry.name}
                          </button>
                        ) : (
                          <>
                            <button
                              type="button"
                              className={styles.fileButton}
                              onClick={() => void download(entry)}
                            >
                              {entry.name}
                            </button>
                            {fileExtension(entry.name) && (
                              <span className={styles.extension}>
                                {fileExtension(entry.name)}
                              </span>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                    <td className="data" style={{ textAlign: "right" }}>
                      {entry.isFolder ? "—" : formatBytes(entry.size)}
                    </td>
                    <td className="data" style={{ textAlign: "right" }}>
                      {entry.isFolder ? "—" : formatDateTime(entry.lastModified)}
                    </td>
                    <td>
                      <div className={styles.rowActions}>
                        {!entry.isFolder && (
                          <Button small onClick={() => void download(entry)}>
                            Download
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </Card>
    </>
  );
}

function PageHeading({
  bucketLabel,
  sensitivity,
  mode,
  description,
  bucketName,
  actions,
}: {
  bucketLabel: string;
  sensitivity?: "standard" | "sensitive";
  mode?: string;
  description?: string;
  bucketName?: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className={styles.header}>
      <div className={styles.headerText}>
        <div className={styles.title}>
          <h1>{bucketLabel}</h1>
          {sensitivity === "sensitive" && <Badge tone="warning">Sensitive</Badge>}
          {mode && <Badge tone="neutral">{mode}</Badge>}
        </div>
        {description && <p className={styles.description}>{description}</p>}
        {bucketName && (
          <p className="data muted" style={{ marginTop: "0.5rem" }}>
            {bucketName}
          </p>
        )}
      </div>
      {actions && <div className={styles.headerActions}>{actions}</div>}
    </header>
  );
}
