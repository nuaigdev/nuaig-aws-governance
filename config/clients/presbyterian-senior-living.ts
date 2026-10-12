import type { ClientConfig } from "../types";

/**
 * Presbyterian Senior Living.
 *
 * Two buckets in the client's AWS account, adopted by name. The stack never
 * creates, modifies or destroys them — `verify:stack` proves that mechanically.
 *
 * ## Why only two, and why they are not split by category
 *
 * The account holds four buckets; only these two belong in the portal. Each of
 * them mixes documents, resident data and clinical records, so there is no
 * honest "clinical bucket" or "financial bucket" to label — the earlier
 * four-category layout was a template, not this client's reality. Both are
 * therefore named as they are and marked sensitive. Splitting access by folder
 * prefix would be a separate piece of work, not something to imply here.
 *
 * The other two buckets are deliberately absent from this file. Absence is the
 * control: no script, IAM policy or permissions boundary generated from this
 * config ever references them.
 *
 * ## Everyone is read-only to start, deliberately
 *
 * Uploads are rare and these buckets hold PHI and single-copy records, so no
 * group — including the administrator — holds `read-upload`. That is the most
 * restrictive start, and it costs nothing to widen: an administrator can grant
 * `read-upload` to a group from the Groups page at runtime, without a code
 * change or a deploy. Starting permissive and narrowing later is the direction
 * that needs a deploy, and leaves an unnecessary write grant live meanwhile.
 *
 * Administrator still manages users, groups and the audit log. That runs
 * through the app's own API, not S3, so read-only S3 access does not limit it.
 *
 * Descriptions are intentionally generic and are expected to be reworded with
 * the client after the first demonstration.
 */
export const clientConfig: ClientConfig = {
  clientId: "presbyterian-senior-living",
  displayName: "Presbyterian Senior Living",
  // Their corporate mark, as published on presbyterianseniorliving.org. Ask the
  // client to confirm this is the version they want used, or supply their own.
  logo: "/branding/presbyterian-senior-living/logo.svg",
  bucketProvisioning: "existing",
  buckets: [
    {
      id: "amazon-psl-bucket",
      label: "amazon-psl-bucket",
      bucketName: "amazon-psl-bucket",
      description: "Contains protected health information and health records.",
      sensitivity: "sensitive",
    },
    {
      id: "connectedliving-to-goicon",
      label: "connectedliving-to-goicon",
      bucketName: "connectedliving-to-goicon",
      description: "Contains protected health information and health records.",
      sensitivity: "sensitive",
    },
  ],
  groups: [
    {
      id: "admin",
      label: "Administrator",
      description: "Manages users, groups and the audit log. Reads every bucket.",
      isAdmin: true,
      bucketAccess: [{ bucketId: "*", mode: "read" }],
    },
    {
      id: "amazon-psl-bucket",
      label: "amazon-psl-bucket access",
      description: "Access to amazon-psl-bucket. Read-only until granted otherwise.",
      bucketAccess: [{ bucketId: "amazon-psl-bucket", mode: "read" }],
    },
    {
      id: "connectedliving-to-goicon",
      label: "connectedliving-to-goicon access",
      description: "Access to connectedliving-to-goicon. Read-only until granted otherwise.",
      bucketAccess: [{ bucketId: "connectedliving-to-goicon", mode: "read" }],
    },
  ],
};
