/**
 * What the portal accepts for upload.
 *
 * ## This is a product control, not a security boundary
 *
 * IAM cannot filter by file type: `s3:PutObject` is granted per bucket, and S3
 * does not inspect what is written. So this stops the portal from accepting the
 * wrong kind of file; it does not stop someone holding the session's temporary
 * credentials from writing one with the AWS SDK directly. The security
 * properties that do hold regardless are elsewhere — no delete anywhere in the
 * generated policies, versioning on every bucket, and `download-policy.ts`
 * refusing to render anything but an allowlisted type inline, so a file that
 * reaches a bucket by some other route still cannot execute as a page.
 *
 * Enforcing the list at S3 instead would mean a bucket policy condition on the
 * key suffix, which edits policy in the client's own account.
 */

/** Extensions the client asked the portal to accept. */
export const ALLOWED_UPLOAD_EXTENSIONS = [
  "pdf",
  "doc",
  "docx",
  "txt",
  "xlsx",
] as const;

/** `accept` attribute for the file picker, so the OS dialog filters first. */
export const UPLOAD_ACCEPT_ATTRIBUTE = ALLOWED_UPLOAD_EXTENSIONS.map(
  (extension) => `.${extension}`,
).join(",");

/** Human-readable list for notices and refusal messages. */
export const ALLOWED_UPLOAD_LABEL = ALLOWED_UPLOAD_EXTENSIONS.map((extension) =>
  extension.toUpperCase(),
).join(", ");

/**
 * The file's extension, lowercased, or `""` when it has none.
 *
 * Only the final segment counts. `report.pdf.exe` is an `exe`, which is the
 * reading that matters here — a double extension is the oldest way to dress an
 * executable up as a document.
 */
function extensionOf(fileName: string): string {
  const base = fileName.slice(fileName.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "";
  return base.slice(dot + 1).toLowerCase();
}

export interface UploadTypeVerdict {
  readonly allowed: boolean;
  /** The extension that was judged, for the audit record. */
  readonly extension: string;
  /** Message to show the user. Empty when allowed. */
  readonly message: string;
}

/** Decides whether the portal will accept a file, by name alone. */
export function checkUploadType(fileName: string): UploadTypeVerdict {
  const extension = extensionOf(fileName);

  if (extension === "") {
    return {
      allowed: false,
      extension: "",
      message: `"${fileName}" has no file extension. Only ${ALLOWED_UPLOAD_LABEL} files can be uploaded.`,
    };
  }

  const allowed = (ALLOWED_UPLOAD_EXTENSIONS as readonly string[]).includes(
    extension,
  );

  return {
    allowed,
    extension,
    message: allowed
      ? ""
      : `.${extension} files cannot be uploaded. Only ${ALLOWED_UPLOAD_LABEL} files are accepted.`,
  };
}
