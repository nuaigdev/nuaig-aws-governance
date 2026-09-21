# No destructive actions

This portal exposes **no way to delete or overwrite anything**, for any role,
including administrators. Not a hidden admin-only delete, not a soft delete.

The client's stated concerns are accidental loss and tampering. A governance
tool that can destroy the data it governs does not address either.

## Where this is enforced

It is enforced in four independent places, so no single mistake re-opens it.

### 1. The generated IAM policy

`amplify/shared/bucket-policy.ts` is the only thing that produces S3 policy
documents — both at deploy time and when an admin edits a group's access at
runtime. Its action lists contain no destructive action, and there is no branch
that can add one:

| Mode | Object actions granted |
| --- | --- |
| `read` | `GetObject`, `GetObjectVersion` |
| `read-upload` | the above, plus `PutObject`, `AbortMultipartUpload`, `ListMultipartUploadParts` |

Never granted at any level: `DeleteObject`, `DeleteObjectVersion`,
`DeleteBucket`, `PutObjectAcl`, `PutBucketPolicy`, `PutLifecycleConfiguration`,
`PutBucketVersioning`.

`PutObjectAcl` is on that list because it would let a user change who can reach
an object — a tampering path even though it destroys nothing.

### 2. An explicit Deny

Every generated policy ends with a `Deny` statement covering those same actions.
An IAM `Deny` cannot be overridden by any `Allow`, from any other policy. If a
delete permission ever reaches these roles by some other route, it still fails.

### 3. The permissions boundary

Every Cognito group role carries a boundary (`buildPermissionsBoundary`) that
caps it at the configured buckets and denies destructive actions and `iam:*`
outright. A boundary is an intersection, not a union: nothing attached to the
role afterwards can exceed it. This is what makes runtime policy editing safe —
see [decisions/group-management.md](decisions/group-management.md).

### 4. No client code path

`src/lib/storage/operations.ts` exposes list, download and upload. It does not
wrap Amplify's `remove()`. Adding a delete there would fail at runtime anyway,
because of (1)–(3).

## Uploads never overwrite

`nextAvailableKey` in `src/lib/storage/keys.ts` probes for a free key and
appends ` (2)`, ` (3)` … before the extension, the way a desktop file manager
does. The user is told the file was stored under a different name.

There is a narrow race: between the final existence check and the upload,
another client could write the same key. S3 has no conditional put on this path,
so the guarantee is completed by **bucket versioning**, enabled in
`amplify/backend.ts`. If a collision does slip through, the earlier object
survives as a previous version — and nothing in this app can delete either
version.

## Buckets are retained

Managed buckets are created without `autoDeleteObjects` and without
`removalPolicy: DESTROY`. For a branch deployment (`ampx pipeline-deploy`),
tearing down the CloudFormation stack leaves the buckets and their contents
intact.

**Sandbox caveat, observed in practice:** an Amplify *sandbox* forces a DESTROY
removal policy onto every resource, overriding the above. Deleting a sandbox
stack therefore attempts to delete the buckets. It still cannot destroy data —
S3 refuses to delete a bucket that holds any object version, and versioning is
on — so the contents must be removed deliberately first. But a sandbox is not a
place for real client data.

## If a future requirement seems to need deletion

It is a conversation about S3 lifecycle policies, or a deliberate out-of-band
action by whoever administers the AWS account — not a function in this codebase.
Raise it in review rather than assuming it is acceptable because the role asking
is "trusted".

Tests asserting all of the above live in `amplify/shared/bucket-policy.test.ts`
and `src/lib/storage/keys.test.ts`.
