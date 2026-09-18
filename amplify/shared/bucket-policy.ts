import type { AccessMode } from "../../config/types";

/**
 * Generates the S3 policy statements for a set of bucket grants.
 *
 * Used in two places that must never disagree:
 *  - `backend.ts`, to seed each group's role at deploy time.
 *  - `admin-groups`, to rewrite a group's role when an admin edits access.
 *
 * ## The action lists are the enforcement point for "no destructive actions"
 *
 * There is no branch of this function that can emit `s3:DeleteObject`,
 * `s3:DeleteObjectVersion`, `s3:PutObjectAcl` or `s3:PutBucketPolicy`. Since
 * the runtime editor generates policies only through here — it never accepts
 * policy JSON from a caller — an admin, or anyone who compromises the admin
 * path, cannot introduce a delete permission through the portal.
 *
 * Changing the constants below is the only way to grant deletion, and doing so
 * is a reviewable change to this file. See `docs/no-destructive-actions.md`.
 */

/** Object-level actions. Read side. */
const READ_OBJECT_ACTIONS = ["s3:GetObject", "s3:GetObjectVersion"] as const;

/**
 * Object-level actions. Upload side.
 *
 * `s3:PutObject` alone. Notably absent:
 *  - `s3:DeleteObject` / `s3:DeleteObjectVersion` — the core constraint.
 *  - `s3:PutObjectAcl` — would let a user alter who can reach an object.
 *  - `s3:AbortMultipartUpload` is included because a browser upload that fails
 *    partway leaves an incomplete multipart upload that the user must be able
 *    to clean up; it can only affect their own in-flight upload, never a
 *    completed object.
 */
const UPLOAD_OBJECT_ACTIONS = [
  "s3:PutObject",
  "s3:AbortMultipartUpload",
  "s3:ListMultipartUploadParts",
] as const;

/** Bucket-level actions. Listing only — never `s3:DeleteBucket` or policy writes. */
const BUCKET_ACTIONS = [
  "s3:ListBucket",
  "s3:ListBucketVersions",
  "s3:GetBucketLocation",
] as const;

export interface PolicyStatement {
  readonly Sid?: string;
  readonly Effect: "Allow" | "Deny";
  readonly Action: readonly string[];
  readonly Resource: readonly string[];
  readonly Condition?: Record<string, Record<string, string | readonly string[]>>;
}

export interface PolicyDocument {
  readonly Version: "2012-10-17";
  readonly Statement: readonly PolicyStatement[];
}

export interface GrantedBucket {
  readonly bucketName: string;
  readonly mode: AccessMode;
}

/** Actions that must never appear in a generated policy. Asserted by tests. */
export const FORBIDDEN_ACTIONS = [
  "s3:DeleteObject",
  "s3:DeleteObjectVersion",
  "s3:DeleteBucket",
  "s3:DeleteBucketPolicy",
  "s3:PutObjectAcl",
  "s3:PutBucketAcl",
  "s3:PutBucketPolicy",
  "s3:PutLifecycleConfiguration",
  "s3:PutBucketVersioning",
] as const;

function bucketArn(bucketName: string): string {
  return `arn:aws:s3:::${bucketName}`;
}

/**
 * Builds the policy document for a group.
 *
 * Returns `null` when the group has no grants: an empty policy document is
 * invalid in IAM, and the caller should delete the inline policy instead.
 */
export function buildBucketPolicy(
  grants: readonly GrantedBucket[],
): PolicyDocument | null {
  if (grants.length === 0) return null;

  const statements: PolicyStatement[] = [];

  const readable = grants.map((g) => g.bucketName);
  const uploadable = grants
    .filter((g) => g.mode === "read-upload")
    .map((g) => g.bucketName);

  statements.push({
    Sid: "ListGrantedBuckets",
    Effect: "Allow",
    Action: [...BUCKET_ACTIONS],
    Resource: readable.map(bucketArn),
  });

  statements.push({
    Sid: "ReadGrantedObjects",
    Effect: "Allow",
    Action: [...READ_OBJECT_ACTIONS],
    Resource: readable.map((name) => `${bucketArn(name)}/*`),
  });

  if (uploadable.length > 0) {
    statements.push({
      Sid: "UploadNewObjects",
      Effect: "Allow",
      Action: [...UPLOAD_OBJECT_ACTIONS],
      Resource: uploadable.map((name) => `${bucketArn(name)}/*`),
    });
  }

  // Belt and braces. The Allow statements above already omit every destructive
  // action, but an explicit Deny cannot be overridden by any other policy —
  // including a future inline policy, an attached managed policy, or a
  // resource policy on the bucket. If a delete permission is ever granted to
  // these roles by some other path, this statement still blocks it.
  statements.push({
    Sid: "DenyDestructiveActionsAlways",
    Effect: "Deny",
    Action: [...FORBIDDEN_ACTIONS],
    Resource: readable.flatMap((name) => [bucketArn(name), `${bucketArn(name)}/*`]),
  });

  return { Version: "2012-10-17", Statement: statements };
}

/**
 * The permissions boundary for every group role.
 *
 * A boundary caps what *any* policy attached to the role can grant, no matter
 * who attaches it. Because the portal can rewrite group policies at runtime,
 * this is what stops a bug — or a compromise of the admin path — from granting
 * access beyond the configured buckets, or granting a destructive action at all.
 *
 * `allBucketNames` must be every bucket in the client config; the boundary is
 * the outer limit, and per-group policies narrow it from there.
 */
export function buildPermissionsBoundary(
  allBucketNames: readonly string[],
): PolicyDocument {
  const arns = allBucketNames.flatMap((name) => [
    bucketArn(name),
    `${bucketArn(name)}/*`,
  ]);

  return {
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "S3CeilingForPortalGroups",
        Effect: "Allow",
        Action: [
          ...BUCKET_ACTIONS,
          ...READ_OBJECT_ACTIONS,
          ...UPLOAD_OBJECT_ACTIONS,
        ],
        Resource: arns,
      },
      {
        // Group roles still need to reach the portal's own AppSync API to read
        // their data and record audit events.
        Sid: "PortalApiAccess",
        Effect: "Allow",
        Action: ["appsync:GraphQL"],
        Resource: ["*"],
      },
      {
        Sid: "NeverDestructive",
        Effect: "Deny",
        Action: [...FORBIDDEN_ACTIONS],
        Resource: ["*"],
      },
      {
        // The portal must never be able to widen its own permissions.
        Sid: "NeverTouchIam",
        Effect: "Deny",
        Action: ["iam:*", "sts:AssumeRole"],
        Resource: ["*"],
      },
    ],
  };
}
