import type { ClientConfig } from "./types";

/**
 * The invitation email Cognito sends when an administrator creates a user.
 *
 * ## Why this is hand-written HTML rather than a template library
 *
 * Cognito substitutes two placeholders into a single string and sends it. There
 * is no render step to hook into, so the message has to be a string this module
 * produces. The constraints are email's, not the web's:
 *
 *  - **Tables and inline styles only.** Outlook renders through Word's HTML
 *    engine: no flexbox, no grid, no `<style>` blocks that survive reliably.
 *  - **No SVG.** Gmail strips it, so the client's logo — which is an SVG — would
 *    render as nothing at all. The header is therefore a text wordmark, which
 *    works everywhere. Supply a PNG and it can become an `<img>`.
 *  - **No web fonts.** IBM Plex will not load in most clients, so the stack
 *    falls back through the system UI faces.
 *  - **Under 20,000 characters**, which is Cognito's hard limit on the message.
 *
 * ## Nuaig is not named here
 *
 * This reaches a client's staff, which makes it one of the client-facing
 * surfaces `showNuaigBranding` governs. For a client tenant the email carries
 * their identity and nothing else — see the branding rules in CLAUDE.md.
 */

/** Design-system colours, inlined because email cannot reach a stylesheet. */
const INK = "#171417";
const INK_MUTED = "#6B6470";
const PRIMARY = "#4E2A4B";
const PRIMARY_TINT = "#EFE4EC";
const PAGE_BG = "#F7F5F2";
const SURFACE = "#FFFFFF";
const BORDER = "#E4DFDA";

const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const MONO = "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace";

export function inviteEmailSubject(client: ClientConfig): string {
  return `Your access to the ${client.displayName} secure file portal`;
}

/**
 * Builds the invitation body.
 *
 * `username` and `temporaryPassword` are the raw Cognito placeholder tokens
 * (`{username}` and `{####}`) at deploy time, and the real values by the time
 * the message is sent. Taking them as arguments keeps this a pure function that
 * a test can render and assert on.
 */
export function inviteEmailBody(
  client: ClientConfig,
  username: string,
  temporaryPassword: string,
): string {
  const { displayName, portalUrl } = client;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${displayName} secure file portal</title>
</head>
<body style="margin:0; padding:0; background-color:${PAGE_BG}; font-family:${FONT}; color:${INK}; -webkit-font-smoothing:antialiased;">
<div style="display:none; max-height:0; overflow:hidden; opacity:0;">Your sign-in details for the ${displayName} secure file portal.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${PAGE_BG};">
<tr><td align="center" style="padding:32px 16px;">

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px; background-color:${SURFACE}; border:1px solid ${BORDER}; border-radius:8px; overflow:hidden;">

  <tr>
    <td style="background-color:${PRIMARY}; padding:24px 32px;">
      <div style="font-size:17px; font-weight:600; color:#FFFFFF; letter-spacing:0.2px;">${displayName}</div>
      <div style="font-size:13px; color:${PRIMARY_TINT}; margin-top:4px;">Secure file portal</div>
    </td>
  </tr>

  <tr>
    <td style="padding:32px 32px 8px 32px;">
      <h1 style="margin:0 0 16px 0; font-size:20px; line-height:1.3; font-weight:600; color:${INK};">An account has been created for you</h1>
      <p style="margin:0 0 16px 0; font-size:15px; line-height:1.6; color:${INK};">
        This portal is where ${displayName} staff view, download and upload files held
        in the organisation's secure storage — resident, clinical and operational
        records that are not kept in ordinary shared drives.
      </p>
      <p style="margin:0 0 24px 0; font-size:15px; line-height:1.6; color:${INK};">
        You will only see the areas your role has been granted. Every file you open,
        download or upload is recorded against your account, and nothing in the
        portal can be deleted or overwritten by anyone.
      </p>
    </td>
  </tr>

  <tr>
    <td style="padding:0 32px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${PAGE_BG}; border:1px solid ${BORDER}; border-radius:6px;">
        <tr><td style="padding:20px 24px;">
          <div style="font-size:12px; text-transform:uppercase; letter-spacing:0.6px; color:${INK_MUTED}; margin-bottom:6px;">Username</div>
          <div style="font-family:${MONO}; font-size:15px; color:${INK}; word-break:break-all;">${username}</div>
          <div style="font-size:12px; text-transform:uppercase; letter-spacing:0.6px; color:${INK_MUTED}; margin:18px 0 6px 0;">Temporary password</div>
          <div style="font-family:${MONO}; font-size:15px; color:${INK}; word-break:break-all;">${temporaryPassword}</div>
        </td></tr>
      </table>
      <p style="margin:12px 0 0 0; font-size:13px; line-height:1.5; color:${INK_MUTED};">
        This temporary password expires in 3 days and can only be used once. You will
        choose your own password when you first sign in.
      </p>
    </td>
  </tr>

  <tr>
    <td align="center" style="padding:28px 32px 8px 32px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0">
        <tr><td style="background-color:${PRIMARY}; border-radius:6px;">
          <a href="${portalUrl}" target="_blank" rel="noopener noreferrer"
             style="display:inline-block; padding:13px 32px; font-size:15px; font-weight:600; color:#FFFFFF; text-decoration:none;">Sign in to the portal</a>
        </td></tr>
      </table>
      <p style="margin:14px 0 0 0; font-size:12px; line-height:1.5; color:${INK_MUTED}; word-break:break-all;">
        Or paste this into your browser:<br><span style="font-family:${MONO};">${portalUrl}</span>
      </p>
    </td>
  </tr>

  <tr>
    <td style="padding:24px 32px 8px 32px;">
      <div style="border-top:1px solid ${BORDER}; padding-top:24px;">
        <h2 style="margin:0 0 14px 0; font-size:15px; font-weight:600; color:${INK};">Setting up, in three steps</h2>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr><td style="padding-bottom:12px; font-size:14px; line-height:1.6; color:${INK};">
            <strong style="color:${PRIMARY};">1.</strong>&nbsp; Sign in with the username and temporary password above.
          </td></tr>
          <tr><td style="padding-bottom:12px; font-size:14px; line-height:1.6; color:${INK};">
            <strong style="color:${PRIMARY};">2.</strong>&nbsp; Choose your own password. It needs at least 12 characters, including an uppercase letter, a lowercase letter, a number and a symbol.
          </td></tr>
          <tr><td style="font-size:14px; line-height:1.6; color:${INK};">
            <strong style="color:${PRIMARY};">3.</strong>&nbsp; Set up an authenticator app. You will scan a QR code with Microsoft Authenticator, Google Authenticator, Authy, 1Password or any other app that supports six-digit codes. This is required for every account, and you will enter a code each time you sign in.
          </td></tr>
        </table>
      </div>
    </td>
  </tr>

  <tr>
    <td style="padding:20px 32px 32px 32px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${PRIMARY_TINT}; border-radius:6px;">
        <tr><td style="padding:16px 20px; font-size:13px; line-height:1.6; color:${INK};">
          Keep these details to yourself. Nobody from ${displayName} will ever ask you
          for your password or an authenticator code. If you were not expecting this
          email, tell your administrator rather than signing in.
        </td></tr>
      </table>
    </td>
  </tr>

</table>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
  <tr><td align="center" style="padding:20px 24px 0 24px; font-size:12px; line-height:1.6; color:${INK_MUTED};">
    Confidential. Access is restricted to authorised users and all activity is logged.
  </td></tr>
</table>

</td></tr>
</table>
</body>
</html>`;
}
