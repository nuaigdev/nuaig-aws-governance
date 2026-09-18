import { ALL_BUCKETS, type ClientConfig } from "./types";

/**
 * Thrown when a client config is structurally invalid.
 *
 * Config errors are build-time errors, not runtime ones. A grant pointing at a
 * bucket that does not exist would otherwise surface as an empty file list
 * long after deploy, which is exactly the kind of quiet failure this portal
 * cannot afford.
 */
export class ClientConfigError extends Error {
  constructor(clientId: string, problems: readonly string[]) {
    super(
      `Invalid client config "${clientId}":\n` +
        problems.map((p) => `  - ${p}`).join("\n"),
    );
    this.name = "ClientConfigError";
  }
}

/** Cognito group names disallow whitespace and must be non-empty. */
const COGNITO_GROUP_NAME = /^[\w+=,.@-]+$/;

/**
 * Validates a client config and returns it unchanged, or throws.
 *
 * Checks, in order of how badly each would fail in production:
 *  1. Every grant points at a bucket that exists (or the wildcard).
 *  2. Exactly one admin group exists, and it can reach every bucket.
 *  3. Bucket and group ids are unique, and group ids are Cognito-legal.
 *  4. No group grants the same bucket twice (ambiguous effective mode).
 *  5. Physical bucket names are unique and S3-legal.
 */
export function validateClientConfig(config: ClientConfig): ClientConfig {
  const problems: string[] = [];
  const bucketIds = new Set(config.buckets.map((b) => b.id));

  if (config.buckets.length === 0) {
    problems.push("no buckets defined");
  }

  const dupBucketIds = duplicates(config.buckets.map((b) => b.id));
  if (dupBucketIds.length > 0) {
    problems.push(`duplicate bucket id(s): ${dupBucketIds.join(", ")}`);
  }

  const dupBucketNames = duplicates(config.buckets.map((b) => b.bucketName));
  if (dupBucketNames.length > 0) {
    problems.push(`duplicate physical bucket name(s): ${dupBucketNames.join(", ")}`);
  }

  for (const bucket of config.buckets) {
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket.bucketName)) {
      problems.push(
        `bucket "${bucket.id}" has an S3-illegal bucketName "${bucket.bucketName}" ` +
          `(3-63 chars, lowercase letters, digits, dots and hyphens, must start and end alphanumeric)`,
      );
    }
  }

  const dupGroupIds = duplicates(config.groups.map((g) => g.id));
  if (dupGroupIds.length > 0) {
    problems.push(`duplicate group id(s): ${dupGroupIds.join(", ")}`);
  }

  for (const group of config.groups) {
    if (!COGNITO_GROUP_NAME.test(group.id)) {
      problems.push(
        `group "${group.id}" is not a legal Cognito group name ` +
          `(allowed: letters, digits, and + = , . @ - _)`,
      );
    }

    const grantedBuckets = group.bucketAccess.map((g) => g.bucketId);
    const dupGrants = duplicates(grantedBuckets);
    if (dupGrants.length > 0) {
      problems.push(
        `group "${group.id}" grants the same bucket twice (${dupGrants.join(", ")}); ` +
          `the effective access mode would be ambiguous`,
      );
    }

    if (grantedBuckets.includes(ALL_BUCKETS) && grantedBuckets.length > 1) {
      problems.push(
        `group "${group.id}" mixes a "*" grant with per-bucket grants; ` +
          `use one or the other so the generated IAM policy is unambiguous`,
      );
    }

    for (const grant of group.bucketAccess) {
      if (grant.bucketId !== ALL_BUCKETS && !bucketIds.has(grant.bucketId)) {
        problems.push(
          `group "${group.id}" grants access to unknown bucket "${grant.bucketId}"`,
        );
      }
    }

    if (group.bucketAccess.length === 0 && !group.isAdmin) {
      problems.push(
        `group "${group.id}" grants no bucket access and is not an admin group; ` +
          `it would give its members nothing`,
      );
    }
  }

  const adminGroups = config.groups.filter((g) => g.isAdmin);
  if (adminGroups.length === 0) {
    problems.push(`no group is marked isAdmin; nobody could manage users or groups`);
  } else if (adminGroups.length > 1) {
    problems.push(
      `more than one admin group (${adminGroups.map((g) => g.id).join(", ")}); ` +
        `keep administrative capability in a single group so it stays auditable`,
    );
  } else {
    const admin = adminGroups[0];
    const reachesAll =
      admin.bucketAccess.some((g) => g.bucketId === ALL_BUCKETS) ||
      config.buckets.every((b) =>
        admin.bucketAccess.some((g) => g.bucketId === b.id),
      );
    if (!reachesAll) {
      problems.push(
        `admin group "${admin.id}" cannot reach every bucket; ` +
          `grant it { bucketId: "*" } instead of listing buckets individually`,
      );
    }
  }

  if (problems.length > 0) {
    throw new ClientConfigError(config.clientId, problems);
  }

  return config;
}

function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) dupes.add(value);
    seen.add(value);
  }
  return [...dupes];
}
