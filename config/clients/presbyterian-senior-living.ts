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
 * ## Two groups per bucket, and two administrative tiers
 *
 * Each bucket has a read group and a read-upload group rather than one group
 * whose mode is edited. Membership is then the only thing that changes when
 * someone needs to upload, which is visible on their user record and recorded
 * in the audit log — whereas editing a group's mode silently changes what
 * every existing member can do.
 *
 * Administrative capability is split in two, because the responsibilities sit
 * with different organisations. Nuaig holds `admin` and owns the group → bucket
 * mapping, which is the access model itself. The client holds `user-admin`:
 * they add their own staff and put them in groups, without being able to change
 * what a group means.
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
    // Order is load-bearing: `defineAuth` assigns Cognito precedence by array
    // position, and the full administrator must win when a user holds several.
    {
      id: "admin",
      label: "Platform Administrator",
      description:
        "Nuaig. Manages users, groups and their bucket mapping, and the audit log. Reads and uploads to every bucket.",
      isAdmin: true,
      bucketAccess: [{ bucketId: "*", mode: "read-upload" }],
    },
    {
      id: "user-admin",
      label: "User Administrator",
      description:
        "Manages users and reads the audit log. Cannot see or change which buckets a group reaches.",
      isUserAdmin: true,
      // No bucket grants of its own: administrative capability and data access
      // stay separate, so a client administrator reaches a bucket only by also
      // being in one of its groups — which is visible on their own user record
      // like everybody else's.
      bucketAccess: [],
    },
    {
      id: "amazon-psl-bucket-read",
      label: "amazon-psl-bucket — Read only",
      description: "View and download from amazon-psl-bucket. Cannot upload.",
      bucketAccess: [{ bucketId: "amazon-psl-bucket", mode: "read" }],
    },
    {
      id: "amazon-psl-bucket-upload",
      label: "amazon-psl-bucket — Read & upload",
      description:
        "View, download and upload to amazon-psl-bucket. Nothing can be deleted or overwritten.",
      bucketAccess: [{ bucketId: "amazon-psl-bucket", mode: "read-upload" }],
    },
    {
      id: "connectedliving-to-goicon-read",
      label: "connectedliving-to-goicon — Read only",
      description: "View and download from connectedliving-to-goicon. Cannot upload.",
      bucketAccess: [{ bucketId: "connectedliving-to-goicon", mode: "read" }],
    },
    {
      id: "connectedliving-to-goicon-upload",
      label: "connectedliving-to-goicon — Read & upload",
      description:
        "View, download and upload to connectedliving-to-goicon. Nothing can be deleted or overwritten.",
      bucketAccess: [{ bucketId: "connectedliving-to-goicon", mode: "read-upload" }],
    },
  ],
};
