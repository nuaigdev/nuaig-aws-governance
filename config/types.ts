/**
 * Client configuration contract.
 *
 * One deployment serves exactly one client. The active client is chosen at
 * build time via `NEXT_PUBLIC_CLIENT_ID` and resolved in `config/index.ts`.
 *
 * Nothing in `src/` may reference a client name, bucket name or group id as a
 * literal — it all comes from here. That is what makes the portal reusable
 * across clients without a fork.
 *
 * This module is imported by both the Next.js app and the Amplify backend
 * (`amplify/`), so it must stay free of React, Next and AWS SDK imports.
 */

/**
 * What a group may do with a bucket.
 *
 * Deliberately not named "read-write": "write" is the word that invites a
 * `DeleteObject` to be added later. The mode name states its own ceiling.
 *
 * - `read`        — list the bucket, read and download objects.
 * - `read-upload` — the above, plus upload *new* keys. Never delete, never
 *                   overwrite an existing key. See `docs/no-destructive-actions.md`.
 */
export type AccessMode = "read" | "read-upload";

/** Wildcard bucket id. Matches the IAM idiom, and is only ever used by admin groups. */
export const ALL_BUCKETS = "*" as const;
export type AllBuckets = typeof ALL_BUCKETS;

/**
 * A single grant: one group, one bucket (or all), one mode.
 *
 * A grant list maps 1:1 onto the IAM policy statements generated for the
 * group's role, so policy generation stays a translation rather than an
 * interpretation.
 */
export interface BucketGrant {
  /** A `BucketDefinition.id` from the same config, or `"*"` for every bucket. */
  readonly bucketId: string | AllBuckets;
  readonly mode: AccessMode;
}

export interface BucketDefinition {
  /** Stable, config-local identifier. Used in URLs and grants; never shown to users. */
  readonly id: string;
  /** Human label shown in the UI, e.g. "Resident & Customer Data". */
  readonly label: string;
  /** Physical S3 bucket name in the client's AWS account. */
  readonly bucketName: string;
  /** One line explaining what belongs in this bucket. Shown on the bucket card. */
  readonly description: string;
  /**
   * Marks buckets holding regulated or otherwise sensitive records. Drives a
   * visible handling notice in the UI. Presentation only — it is never the
   * mechanism that restricts access; grants are.
   */
  readonly sensitivity: "standard" | "sensitive";
}

export interface GroupDefinition {
  /** Cognito group name. Must match `^[\p{L}\p{M}\p{S}\p{N}\p{P}]+$` and be stable. */
  readonly id: string;
  readonly label: string;
  readonly description: string;
  /**
   * Grants administrative capability: user management, group management and
   * the audit log. Separate from bucket access — an admin's *data* reach is
   * still expressed as an ordinary grant, so it is visible and auditable in
   * the same place as everyone else's.
   */
  readonly isAdmin?: boolean;
  readonly bucketAccess: readonly BucketGrant[];
}

export interface ClientConfig {
  /** Must equal the config's filename under `config/clients/`. */
  readonly clientId: string;
  readonly displayName: string;
  /**
   * Whether this deployment creates its buckets or adopts existing ones.
   *
   * - `"managed"` — the CDK stack creates the buckets. Used by our showcase,
   *   where no buckets pre-exist.
   * - `"existing"` — the buckets already live in the client's account and are
   *   imported by name. The stack never creates, renames or destroys them.
   *
   * There is no path that deletes a bucket in either mode.
   */
  readonly bucketProvisioning: "managed" | "existing";
  /**
   * Path to the client's own logo under `public/`. Omit when the client has
   * not supplied one — the UI then renders `displayName` as styled text.
   * Never invent a client logo.
   */
  readonly logo?: string;
  readonly buckets: readonly BucketDefinition[];
  readonly groups: readonly GroupDefinition[];
}
