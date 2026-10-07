/**
 * Validation for the `?next=` parameter on the sign-in page.
 *
 * ## Why this is not just `searchParams.get("next")`
 *
 * The sign-in page redirects to `next` once authentication succeeds, and the
 * Next.js router will happily perform a full page navigation to an absolute
 * URL. Without this check, `/sign-in?next=https://evil.example` sends a user
 * who has *just* typed their password and MFA code to an attacker's page — one
 * that can then present a convincing "session expired, sign in again" form.
 *
 * It is the cheapest phishing chain there is against an auth flow, and it is
 * the first thing an automated probe tries. So `next` is treated as untrusted
 * input and anything that is not plainly a path within this app is discarded in
 * favour of the default.
 */

/** Where a user goes when no valid destination was supplied. */
export const DEFAULT_SIGNED_IN_PATH = "/buckets";

/**
 * Returns `raw` when it is a safe in-app path, and the default otherwise.
 *
 * Accepts only a single-slash-prefixed path. Rejected:
 *  - absolute URLs (`https://evil.example`), which navigate off-site;
 *  - protocol-relative URLs (`//evil.example`), which do the same while
 *    looking like a path;
 *  - anything containing a backslash, because browsers and URL parsers
 *    disagree about whether `/\evil.example` is a path or a host;
 *  - control characters, which can be used to smuggle a newline into a
 *    header or to disguise the destination on screen.
 */
export function safeNextPath(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith("/")) return DEFAULT_SIGNED_IN_PATH;
  if (raw.startsWith("//")) return DEFAULT_SIGNED_IN_PATH;
  if (raw.includes("\\")) return DEFAULT_SIGNED_IN_PATH;
  // C0 controls and DEL, written as escapes rather than literals so they stay
  // visible in an editor and survive copy-paste.
  if (/[\u0000-\u001f\u007f]/.test(raw)) return DEFAULT_SIGNED_IN_PATH;

  return raw;
}
