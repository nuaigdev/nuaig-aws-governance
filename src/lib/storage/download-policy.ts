/**
 * Decides how a downloaded object is handed to the browser.
 *
 * ## Why this exists
 *
 * A signed URL opened in a tab is rendered according to the object's stored
 * `Content-Type`. A client's buckets hold files this portal did not create —
 * years of accumulated content — and a single `.html` or `.svg` among them
 * would execute its own script when previewed, on an `amazonaws.com` origin the
 * user reached from a portal they trust. That is a phishing surface, not a
 * theoretical one.
 *
 * So the default is `attachment`: the browser saves the file rather than
 * rendering it. Inline preview is an **allowlist**, and for the types on it the
 * response `Content-Type` is pinned to the safe value as well. That second part
 * is what makes this robust rather than cosmetic: an object named `report.pdf`
 * but stored as `text/html` is served as `application/pdf`, so the browser
 * tries to parse it as a PDF and fails instead of running it as a page.
 *
 * No `filename` is set on the header. With a bare `attachment`, the browser
 * names the saved file from the last segment of the URL path — which is the
 * object key — and that sidesteps the RFC 6266 encoding rules that a key with
 * quotes or non-ASCII characters in it would otherwise trip over.
 */

/**
 * Extensions allowed to render in the browser, each pinned to the MIME type it
 * will be served as.
 *
 * Deliberately absent:
 *  - `svg` — an SVG is a document that can carry script. It is the single most
 *    commonly missed XSS vector in file browsers.
 *  - `html`, `htm`, `xhtml`, `xml`, `mhtml` — for the obvious reason.
 *
 * `pdf` is included knowingly. A PDF can contain JavaScript, but browser PDF
 * viewers sandbox it, and forcing every document in a document portal to
 * download rather than preview is a real cost for a small marginal gain.
 */
const INLINE_TYPES: Readonly<Record<string, string>> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  txt: "text/plain",
};

/** What to put on the signed URL for one object. */
export interface DownloadPresentation {
  /** `Content-Disposition` to force on the response. */
  readonly contentDisposition: "inline" | "attachment";
  /** `Content-Type` to force on the response, overriding what S3 has stored. */
  readonly contentType: string;
}

/** Lowercased extension of a key, without the dot. Empty when there is none. */
export function extensionOf(key: string): string {
  const name = key.slice(key.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  // `dot <= 0` covers both "no extension" and a leading-dot file, where the
  // whole name is the dotfile rather than an extension.
  if (dot <= 0 || dot === name.length - 1) return "";
  return name.slice(dot + 1).toLowerCase();
}

/**
 * How this object should be served. Anything not on the inline allowlist is an
 * attachment — that is the safe default, and it is the default on purpose.
 */
export function downloadPresentation(key: string): DownloadPresentation {
  const inlineType = INLINE_TYPES[extensionOf(key)];

  return inlineType
    ? { contentDisposition: "inline", contentType: inlineType }
    : { contentDisposition: "attachment", contentType: "application/octet-stream" };
}
