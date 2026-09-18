# Audit coverage

What the audit log records, where each record comes from, and what it does
**not** cover. The gaps are listed because an audit log whose limits are
undocumented invites more confidence than it has earned.

## The log is append-only

`AuditEvent` grants no create, update or delete to any caller — including
administrators. Admins have `read` and nothing else. Records are written only by
backend functions, which derive the actor, their groups and the timestamp from
the verified Cognito JWT rather than from request input.

A client-writable audit log is one the client can forge. There is also no edit
or delete path at all: retention is a lifecycle concern on the DynamoDB table,
not a button in this app.

## Where each event comes from

| Event | Written by | Forgeable by a user? |
| --- | --- | --- |
| `LOGIN` | Cognito post-authentication trigger | No — fires inside the auth flow |
| `FILE_LIST`, `FILE_DOWNLOAD`, `FILE_UPLOAD`, `FILE_UPLOAD_REJECTED_COLLISION` | `audit-writer`, called by the browser | Actor and time no; the object key yes (see gaps) |
| `USER_CREATED`, `USER_DISABLED`, `USER_REENABLED`, `USER_GROUPS_CHANGED`, `USER_INVITE_RESENT` | `admin-users`, inside the operation | No |
| `GROUP_ACCESS_VIEWED`, `GROUP_ACCESS_CHANGED` | `admin-groups`, inside the operation | No |
| `ACCESS_DENIED` | whichever handler refused | No |

`audit-writer` accepts only the data-access actions from a client. An attempt to
record anything else — for example a fabricated `USER_CREATED` — is refused and
itself recorded as `ACCESS_DENIED`.

## Known gaps

**Failed sign-ins are not recorded.** The `LOGIN_FAILED` action exists in the
enum, but Cognito's post-authentication trigger only fires on success. Capturing
failures needs a custom-auth challenge trigger or CloudTrail on the user pool.
Until then, brute-force attempts are visible in CloudTrail, not here.

**`LOGIN` records an empty group list.** The post-authentication event does not
carry group membership; only the pre-token-generation trigger does. Rather than
spend an `AdminListGroupsForUser` call inside every sign-in's critical path,
`actorGroups` is left empty for `LOGIN`. Membership over time is recoverable
from `USER_GROUPS_CHANGED`, which does record it.

**Object keys in access events are client-supplied.** The actor, their groups
and the timestamp all come from the JWT and cannot be forged. The `objectKey` on
a `FILE_DOWNLOAD` is what the browser reported. A user cannot download something
they lack access to — IAM stops that regardless — but a determined user calling
the mutation directly could log a *different* key than the one they fetched.
Treat keys as strong evidence, not proof; S3 server access logging is the
authoritative record if that ever matters.

**Downloads are logged at URL issue, not at transfer.** `FILE_DOWNLOAD` is
recorded when the signed URL is minted. The URL is valid for 5 minutes, so a
logged download may not have completed — or may have been fetched more than once
within that window.

**A logging failure does not block the action.** `recordDataAccess` never
throws: a logging outage must not stop a download a user is entitled to.
Failures go to the console as `AUDIT_RECORD_FAILED`. The post-authentication
trigger likewise swallows failures rather than denying a sign-in, logging
`POST_AUTH_AUDIT_FAILED`.

Admin mutations take the opposite stance: `writeAuditEvent` rethrows, so an
admin operation that could not be logged fails rather than happening silently.

## Recommended monitoring

Not configured by this repo — decide per deployment:

- CloudWatch metric filters on `AUDIT_WRITE_FAILED`, `AUDIT_RECORD_FAILED` and
  `POST_AUTH_AUDIT_FAILED`, alarming on any occurrence.
- An alarm on `GROUP_ACCESS_CHANGED`, which should be rare and always expected.
- CloudTrail on the user pool and on `PutRolePolicy` against the group roles, as
  an independent record of the same events.

## Indexes

Three secondary indexes back the audit screen's filters, so the log stays
queryable as it grows: by time (`auditEventsByTime`), by actor
(`auditEventsByActor`) and by bucket (`auditEventsByBucket`).
