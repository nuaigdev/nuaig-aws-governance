# Administrator guide

For the person at the client who manages access to the portal. No AWS
knowledge is needed: everything below is done inside the portal itself.

## Signing in for the first time

1. Open the invitation email and sign in with the temporary password. It is
   valid for **3 days**.
2. Choose your own password (at least 12 characters, with upper and lower case,
   a number and a symbol).
3. Scan the QR code with an authenticator app (1Password, Authy, Google
   Authenticator) and enter the six-digit code.

From then on, signing in needs your password and a code from the app.

## Adding a person

**Users → Create user**, then:

1. **Details.** Their name and email. The invitation goes to that address.
2. **Access.** Choose one or more groups. Each group lists exactly which buckets
   it opens and whether it allows upload. Access comes only from groups.
3. **Review.** Check the summary and send the invitation.

If the invitation expires or goes missing, use **Resend invite** on their row
while they are still "Pending first sign-in".

## Changing what someone can see

**Users → Groups** on their row. Adding a group takes effect the next time they
sign in or their session refreshes (within about 30 minutes). **Removing a group signs them out of every device** so the narrower access
applies immediately.

To change what a *group* can reach, use **Groups** in the top menu.

## Someone forgot their password

Two ways, both end with the person choosing their own new password:

- **They do it themselves:** on the sign-in page, **Forgot your password?**, then
  enter the code that is emailed to them.
- **You do it for them:** **Users → Reset password** on their row. They are
  emailed a one-time code and signed out of every device; when they next try to
  sign in the portal asks for that code and a new password.

You never see, choose or hear the new password, and their authenticator app
still applies afterwards. If someone has lost their **authenticator** device,
contact Nuaig.

Reset is unavailable for someone who has never signed in (use **Resend invite**)
and for disabled accounts (re-enable first).

## When someone leaves

**Users → Disable.** They are signed out of every device immediately and cannot
sign in again. Accounts are never deleted, so the audit log can always show who
did what. **Re-enable** restores access if they return.

## The audit log

**Audit log** shows every sign-in, file listing and download, upload, and every
change made by an administrator, with who, what, when and which bucket. Filter by
person, action or bucket.

It cannot be edited or cleared by anyone, including administrators.

## Things this portal does not do

- **It cannot delete or overwrite files.** Nobody, including administrators, can
  remove or replace a file through the portal. Uploading a file with an existing
  name stores it alongside the original.
- **It cannot create groups or buckets.** Contact Nuaig.

## Signed out unexpectedly?

Sessions end after 30 minutes without activity, and after 12 hours in any case.
You are warned two minutes before an inactivity sign-out.

## Getting help

Contact Nuaig via <https://nuaig.ai>.
