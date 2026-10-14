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
 * ## Only the administrator may upload
 *
 * These buckets hold PHI and single-copy records, so upload starts with the
 * administrator group alone. Every other group is read-only until an
 * administrator widens it from the Groups page at runtime — no code change, no
 * deploy. Starting permissive and narrowing later is the direction that needs a
 * deploy, and leaves an unnecessary write grant live meanwhile.
 *
 * Upload never means overwrite: `s3:DeleteObject` is absent from every policy
 * this repo can generate, the upload path renames on collision, and versioning
 * is enabled on both buckets, so a PutObject issued outside the portal still
 * leaves the previous version intact.
 *
 * Managing users, groups and the audit log runs through the app's own API
 * rather than S3, so a group's bucket mode never affects it either way.
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
      description:
        "Manages users, groups and the audit log. Reads and uploads to every bucket.",
      isAdmin: true,
      bucketAccess: [{ bucketId: "*", mode: "read-upload" }],
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
