/**
 * Data-protection notices.
 *
 * Deliberately short, generic and platform-level: they describe what this
 * portal does (logs activity, cannot delete), not any client's legal position.
 * Kept in one module so the wording is reviewed in one place, and so a client
 * that needs different text has one file to change.
 */

/** Sign-in page, under the form. */
export const SIGN_IN_NOTICE =
  "Authorised users only. This portal holds confidential information, and all activity is logged and monitored.";

/** Slim banner above a bucket whose config sensitivity is `sensitive`. */
export const SENSITIVE_BUCKET_NOTICE =
  "This bucket holds confidential information. Every file you open or download is recorded against your account.";

/** Upload dialog. Uploads are permanent because the portal has no delete. */
export const UPLOAD_NOTICE =
  "Only upload files you are authorised to share. Uploads are permanent: this portal cannot delete or replace files afterwards.";

/** One line in the footer, on every page. */
export const FOOTER_NOTICE =
  "Confidential. Access is restricted to authorised users and all activity is logged.";
