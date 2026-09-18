import {
  ALL_BUCKETS,
  type AccessMode,
  type BucketDefinition,
  type ClientConfig,
  type GroupDefinition,
} from "./types";

/**
 * Turns Cognito group membership into effective bucket access.
 *
 * This is the only place that answers "what may this user do". The UI uses it
 * to decide what to render; the backend uses it to generate each group's IAM
 * policy. Sharing one implementation is deliberate — if the two ever disagreed,
 * the UI would be showing a permission the infrastructure does not actually
 * grant, or hiding one it does.
 *
 * Nothing here is a security boundary on its own. The boundary is the IAM
 * policy attached to the group's role; this module decides what that policy
 * says, and keeps the UI honest about it.
 */

/** Access modes ordered least to most permissive. Used to resolve overlaps. */
const MODE_RANK: Readonly<Record<AccessMode, number>> = {
  read: 0,
  "read-upload": 1,
};

/**
 * A user's resolved access to one bucket.
 */
export interface EffectiveBucketAccess {
  readonly bucket: BucketDefinition;
  readonly mode: AccessMode;
  /** Which of the user's groups produced this access. Shown in the UI and audit log. */
  readonly viaGroups: readonly string[];
}

/** Resolves the user's group ids against the config, ignoring unknown groups. */
function resolveGroups(
  config: ClientConfig,
  groupIds: readonly string[],
): GroupDefinition[] {
  const byId = new Map(config.groups.map((g) => [g.id, g]));
  // Unknown group ids are ignored rather than throwing: a group could be
  // removed from config while a user still carries it in Cognito, and that
  // should degrade to "no access from that group", never to a crash.
  return groupIds
    .map((id) => byId.get(id))
    .filter((g): g is GroupDefinition => g !== undefined);
}

/** True when any of the user's groups carries administrative capability. */
export function isAdmin(
  config: ClientConfig,
  groupIds: readonly string[],
): boolean {
  return resolveGroups(config, groupIds).some((g) => g.isAdmin === true);
}

/**
 * Every bucket the user can reach, with the most permissive mode across all
 * their groups.
 *
 * Union semantics: a user in both a read group and a read-upload group for the
 * same bucket gets read-upload. This is what group membership means everywhere
 * else in AWS, and the alternative — most restrictive wins — would make adding
 * someone to a group able to silently *remove* access they already had.
 *
 * Returned in config order so the UI listing is stable and predictable.
 */
export function accessibleBuckets(
  config: ClientConfig,
  groupIds: readonly string[],
): EffectiveBucketAccess[] {
  const groups = resolveGroups(config, groupIds);
  const resolved = new Map<string, { mode: AccessMode; viaGroups: string[] }>();

  for (const group of groups) {
    for (const grant of group.bucketAccess) {
      const targets =
        grant.bucketId === ALL_BUCKETS
          ? config.buckets.map((b) => b.id)
          : [grant.bucketId];

      for (const bucketId of targets) {
        const existing = resolved.get(bucketId);
        if (!existing) {
          resolved.set(bucketId, { mode: grant.mode, viaGroups: [group.id] });
          continue;
        }
        existing.viaGroups.push(group.id);
        if (MODE_RANK[grant.mode] > MODE_RANK[existing.mode]) {
          existing.mode = grant.mode;
        }
      }
    }
  }

  return config.buckets
    .filter((bucket) => resolved.has(bucket.id))
    .map((bucket) => {
      const entry = resolved.get(bucket.id)!;
      return {
        bucket,
        mode: entry.mode,
        viaGroups: [...new Set(entry.viaGroups)],
      };
    });
}

/** The user's access to one bucket, or `undefined` if they have none. */
export function bucketAccess(
  config: ClientConfig,
  groupIds: readonly string[],
  bucketId: string,
): EffectiveBucketAccess | undefined {
  return accessibleBuckets(config, groupIds).find(
    (access) => access.bucket.id === bucketId,
  );
}

/** True when the user may read the bucket at all. */
export function canRead(
  config: ClientConfig,
  groupIds: readonly string[],
  bucketId: string,
): boolean {
  return bucketAccess(config, groupIds, bucketId) !== undefined;
}

/**
 * True when the user may upload *new* objects to the bucket.
 *
 * Upload never implies overwrite. Collision handling lives in the upload path
 * itself, which refuses to replace an existing key — see `src/lib/uploads.ts`.
 */
export function canUpload(
  config: ClientConfig,
  groupIds: readonly string[],
  bucketId: string,
): boolean {
  return bucketAccess(config, groupIds, bucketId)?.mode === "read-upload";
}

/**
 * Expands a group's grants into concrete bucket definitions.
 *
 * Used by the backend to generate IAM policy statements, and by the group
 * management screen to show what a group actually reaches.
 */
export function grantedBuckets(
  config: ClientConfig,
  group: GroupDefinition,
): { bucket: BucketDefinition; mode: AccessMode }[] {
  const resolved = new Map<string, AccessMode>();

  for (const grant of group.bucketAccess) {
    const targets =
      grant.bucketId === ALL_BUCKETS
        ? config.buckets.map((b) => b.id)
        : [grant.bucketId];

    for (const bucketId of targets) {
      const existing = resolved.get(bucketId);
      if (existing === undefined || MODE_RANK[grant.mode] > MODE_RANK[existing]) {
        resolved.set(bucketId, grant.mode);
      }
    }
  }

  return config.buckets
    .filter((bucket) => resolved.has(bucket.id))
    .map((bucket) => ({ bucket, mode: resolved.get(bucket.id)! }));
}

/** Human-readable mode label. Kept here so UI and emails phrase it identically. */
export function describeMode(mode: AccessMode): string {
  return mode === "read-upload" ? "Read & upload" : "Read only";
}
