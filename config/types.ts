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
   * Full administrative capability: user management, group management and
   * the audit log. Separate from bucket access — an admin's *data* reach is
   * still expressed as an ordinary grant, so it is visible and auditable in
   * the same place as everyone else's.
   *
   * **Exactly one group per client carries this**, enforced by
   * `validateClientConfig`. Several places resolve "the admin group" with
   * `groups.find(g => g.isAdmin)`, which would silently pick the first of two.
   */
  readonly isAdmin?: boolean;
  /**
   * User administration without group administration: manage users and read
   * the audit log, but never see or change which buckets a group reaches.
   *
   * Exists because the two responsibilities sit with different organisations.
   * Nuaig owns the group → bucket mapping, since that is the access model
   * itself; the client owns their own staff list. A client administrator can
   * therefore add someone and put them in the right groups, without being able
   * to change what those groups mean.
   *
   * The ceiling is enforced in three places, not one: `manageGroups` is bound
   * to the admin group in AppSync so the API refuses them outright, the
   * `admin-users` handler refuses to let them touch a full administrator or
   * grant the admin group, and the UI hides what they cannot reach. Never
   * combine with `isAdmin` — `validateClientConfig` rejects that.
   */
  readonly isUserAdmin?: boolean;
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
   * The portal's own URL, used in the invitation email.
   *
   * Config rather than an environment variable on purpose: an unset variable
   * would fall back to a default, and the default that makes sense for a local
   * build — `http://localhost:3000` — would reach a client's inbox as a dead
   * link. A missing value here fails the build instead.
   *
   * No trailing slash.
   */
  readonly portalUrl: string;
  /**
   * IANA timezone every timestamp in the portal is displayed in, e.g.
   * `"America/New_York"`.
   *
   * Fixed to the client rather than taken from the viewer's browser, which is
   * what this used to do. An audit log needs one reading everyone shares: with
   * browser-local time, a record written at 06:59 UTC reads as 02:59 to staff
   * in Pennsylvania and 12:29 to someone in India, and nothing on screen says
   * which — so two people comparing notes on an incident are quietly talking
   * about different clocks.
   *
   * Events are still *stored* in UTC. This only decides how they are rendered,
   * and the rendered zone is always labelled.
   */
  readonly timeZone: string;
  /**
   * Path to the client's own logo under `public/`. Omit when the client has
   * not supplied one — the UI then renders `displayName` as styled text.
   * Never invent a client logo.
   */
  readonly logo?: string;
  /**
   * Raster logo for the invitation email, served from `public/`.
   *
   * Separate from `logo` because email cannot use the same asset: `logo` is an
   * SVG, and Gmail strips SVG entirely, so it would render as nothing at all.
   * Omit it and the email falls back to the client's name as a text wordmark,
   * which is correct — a missing logo is better than a broken one.
   *
   * `width` and `height` are the *display* size; supply the file at twice that
   * so it is not soft on a high-density screen. Both are set as HTML attributes
   * so the layout does not jump while the image loads, and so a client that
   * blocks remote images still reserves the right space.
   */
  readonly emailLogo?: {
    /** Absolute path from the site root, e.g. `/branding/acme/logo-email.png`. */
    readonly path: string;
    readonly width: number;
    readonly height: number;
  };
  /**
   * Whether Nuaig's own branding appears in the portal — the footer logo, the
   * "built and managed by" line and our copyright.
   *
   * **Defaults to false**, so a client deployment is unbranded unless someone
   * deliberately opts in. The default is that way round because the failure
   * mode matters: forgetting the flag on a new client config shows the client a
   * clean portal, whereas the opposite default would put our logo in front of
   * a client who never agreed to it.
   *
   * Only our own showcase tenant sets this to true.
   */
  readonly showNuaigBranding?: boolean;
  readonly buckets: readonly BucketDefinition[];
  readonly groups: readonly GroupDefinition[];
}
