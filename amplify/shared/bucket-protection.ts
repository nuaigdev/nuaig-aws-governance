/**
 * Pure logic behind `scripts/protect-buckets.ts`, which adds a deny-deletion
 * statement to a client's bucket policy.
 *
 * Separated from the AWS calls so the merge rules — the part that must never
 * discard a statement somebody else put there — are unit-tested.
 *
 * ## Why a bucket policy, and why it is the right size of hammer
 *
 * The portal's own roles already cannot delete: the generated policy omits the
 * actions, an explicit Deny covers them, and the permissions boundary caps
 * every role. None of that constrains the *deployment* credentials, which are
 * account-wide for the deployment window. This statement does, because a bucket
 * policy Deny applies to every principal including the account root.
 *
 * The escape hatch is deliberate: the policy-management actions are **not**
 * denied, so a deliberate, out-of-band change to the bucket policy is the only
 * way to delete anything afterwards. That is exactly the posture the product
 * documents — deletion happens through a considered AWS operation, never
 * through the app.
 *
 * S3 Object Lock would be stronger still, but compliance mode is irreversible
 * even by AWS, which is the wrong risk to take on a client's live records on a
 * deadline. This is reversible by the account owner in one action.
 */

/** Stable Sid, so re-running updates in place instead of adding duplicates. */
export const DENY_DELETION_SID = "DenyDeletionOfGovernedData";

/**
 * Actions denied to every principal.
 *
 * `DeleteObjectVersion` matters as much as `DeleteObject`: without it, the
 * previous version that makes an accidental overwrite recoverable could itself
 * be removed, and the recovery story would be fiction.
 *
 * `PutBucketVersioning` is included because suspending versioning would stop
 * future overwrites from being recoverable. The script therefore refuses to
 * apply this until versioning is already on — locking the door before the
 * room is furnished would be the wrong order.
 */
export const DENIED_ACTIONS = [
  "s3:DeleteObject",
  "s3:DeleteObjectVersion",
  "s3:DeleteBucket",
  "s3:PutBucketVersioning",
] as const;

/**
 * Actions that must never be denied to everyone, with the reason.
 *
 * Denying the first two to `"*"` makes the bucket policy permanently
 * unchangeable — not by an administrator, not by the account root. Recovering
 * from that needs AWS Support, if it is recoverable at all. The rest would
 * break the portal itself.
 */
export const NEVER_DENY: Readonly<Record<string, string>> = {
  "s3:PutBucketPolicy": "would make this policy permanently unchangeable",
  "s3:DeleteBucketPolicy": "would make this policy permanently unchangeable",
  "s3:GetObject": "the portal would not be able to read files",
  "s3:ListBucket": "the portal would not be able to list files",
  "s3:PutObject": "uploads would fail",
  "s3:PutBucketCors": "the portal's CORS rule could never be updated",
};

export interface PolicyStatement {
  Sid?: string;
  Effect: "Allow" | "Deny";
  Principal?: unknown;
  NotPrincipal?: unknown;
  Action?: string | string[];
  NotAction?: string | string[];
  Resource?: string | string[];
  Condition?: Record<string, unknown>;
}

export interface BucketPolicy {
  Version?: string;
  Id?: string;
  Statement: PolicyStatement[];
}

/** The statement this tool owns, for one bucket. */
export function denyDeletionStatement(bucketName: string): PolicyStatement {
  return {
    Sid: DENY_DELETION_SID,
    Effect: "Deny",
    Principal: "*",
    Action: [...DENIED_ACTIONS],
    // Bucket-level actions resolve against the bucket ARN, object-level ones
    // against the object ARN. Both are needed for full coverage.
    Resource: [`arn:aws:s3:::${bucketName}`, `arn:aws:s3:::${bucketName}/*`],
  };
}

function actionList(statement: PolicyStatement): string[] {
  const raw = statement.Action ?? [];
  return typeof raw === "string" ? [raw] : raw;
}

function appliesToEveryone(statement: PolicyStatement): boolean {
  const principal = JSON.stringify(statement.Principal ?? "");
  return principal === '"*"' || principal.includes('"AWS":"*"') || principal.includes('"*"');
}

/**
 * Reasons it is unsafe to touch this bucket's existing policy.
 *
 * Returns an empty array when the policy can be safely extended. A non-empty
 * result means stop and show a human, rather than merge and hope.
 */
export function unsafeToModify(policy: BucketPolicy | null): string[] {
  if (!policy) return [];

  const problems: string[] = [];

  for (const statement of policy.Statement ?? []) {
    if (statement.Effect !== "Deny" || !appliesToEveryone(statement)) continue;

    for (const action of actionList(statement)) {
      const reason = NEVER_DENY[action];
      if (reason && (action === "s3:PutBucketPolicy" || action === "s3:DeleteBucketPolicy")) {
        problems.push(
          `an existing statement ("${statement.Sid ?? "no sid"}") already denies ${action} to ` +
            `everyone, so this policy may not be modifiable at all`,
        );
      }
    }
  }

  return problems;
}

export interface PolicyPlan {
  readonly policy: BucketPolicy;
  readonly change: "none" | "add" | "update";
  /** Sids preserved from the existing policy, for the operator to eyeball. */
  readonly preserved: string[];
}

/**
 * Merges the deny statement into whatever policy the bucket already has.
 *
 * `PutBucketPolicy` **replaces** the entire policy — it is not a merge — which
 * is the trap in doing this by hand. A client's bucket may already carry a
 * statement requiring TLS, or granting a backup tool access; overwriting it
 * blind would silently remove that. Every statement that is not ours is
 * carried through untouched.
 */
export function planPolicy(existing: BucketPolicy | null, bucketName: string): PolicyPlan {
  const desired = denyDeletionStatement(bucketName);
  const statements = existing?.Statement ?? [];
  const others = statements.filter((statement) => statement.Sid !== DENY_DELETION_SID);
  const current = statements.find((statement) => statement.Sid === DENY_DELETION_SID);

  const preserved = others.map((statement) => statement.Sid ?? "(no sid)");

  if (current && JSON.stringify(sorted(current)) === JSON.stringify(sorted(desired))) {
    return { policy: existing as BucketPolicy, change: "none", preserved };
  }

  return {
    policy: {
      Version: existing?.Version ?? "2012-10-17",
      ...(existing?.Id ? { Id: existing.Id } : {}),
      Statement: [...others, desired],
    },
    change: current ? "update" : "add",
    preserved,
  };
}

/** Order-insensitive comparison of a statement's action and resource lists. */
function sorted(statement: PolicyStatement): PolicyStatement {
  const list = (value: string | string[] | undefined) =>
    value === undefined ? undefined : [...(typeof value === "string" ? [value] : value)].sort();

  return {
    ...statement,
    Action: list(statement.Action),
    Resource: list(statement.Resource),
  };
}

/**
 * True when a lifecycle configuration can expire objects or noncurrent
 * versions.
 *
 * Worth surfacing loudly: **lifecycle rules are executed by S3 itself, not by
 * an IAM principal, so a bucket policy Deny does not stop them.** A bucket with
 * an expiration rule is deleting data on a schedule today, and nothing this
 * tool adds will change that. It is the client's decision, but they should be
 * making it knowingly.
 */
export function lifecycleExpiresData(rules: readonly Record<string, unknown>[] | undefined): boolean {
  return (rules ?? []).some(
    (rule) =>
      rule.Status === "Enabled" &&
      // An incomplete-multipart cleanup rule is housekeeping, not data loss,
      // so it is deliberately not counted here.
      ("Expiration" in rule || "NoncurrentVersionExpiration" in rule),
  );
}
