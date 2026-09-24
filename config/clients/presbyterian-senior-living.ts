import type { ClientConfig } from "../types";

/**
 * Presbyterian Senior Living.
 *
 * The client's four buckets already exist in their AWS account; the stack
 * adopts them by name and never creates or destroys them.
 *
 * ## Before this can be deployed
 *
 * The `bucketName` values below are deliberately invalid placeholders (capital
 * letters and underscores are illegal in S3 names), so config validation fails
 * the build until they are replaced with the exact names from the client's
 * account. A guessed name that happened to pass would deploy IAM policies for a
 * bucket that does not exist. Get the names from the client — see Part A of
 * `docs/deployment-plan.md`.
 *
 * Group labels and descriptions follow the reference structure in
 * `acme-senior-living.ts`; confirm the wording and the grants with the client.
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
      id: "documents",
      label: "Documents & Images",
      bucketName: "TODO_DOCUMENTS_BUCKET_NAME",
      description: "Operational documents, policies and photographs.",
      sensitivity: "standard",
    },
    {
      id: "pii",
      label: "Resident & Customer Data",
      bucketName: "TODO_PII_BUCKET_NAME",
      description: "Records identifying residents, families and staff.",
      sensitivity: "sensitive",
    },
    {
      id: "financial",
      label: "Financial Records",
      bucketName: "TODO_FINANCIAL_BUCKET_NAME",
      description: "Invoices, billing statements and year-end accounts.",
      sensitivity: "sensitive",
    },
    {
      id: "clinical",
      label: "Clinical Records",
      bucketName: "TODO_CLINICAL_BUCKET_NAME",
      description: "Care plans and medication administration records.",
      sensitivity: "sensitive",
    },
  ],
  groups: [
    {
      id: "admin",
      label: "Administrator",
      description: "Manages users, groups and the audit log. Reaches every bucket.",
      isAdmin: true,
      bucketAccess: [{ bucketId: "*", mode: "read-upload" }],
    },
    {
      id: "documents",
      label: "Documents Team",
      description: "Maintains operational documents and imagery.",
      bucketAccess: [{ bucketId: "documents", mode: "read-upload" }],
    },
    {
      id: "pii",
      label: "PII Access",
      description: "Reads resident and customer records.",
      bucketAccess: [{ bucketId: "pii", mode: "read" }],
    },
    {
      id: "financial",
      label: "Finance Team",
      description: "Reads and files financial records.",
      bucketAccess: [{ bucketId: "financial", mode: "read-upload" }],
    },
    {
      id: "clinical",
      label: "Clinical Staff",
      description: "Reads clinical documentation.",
      bucketAccess: [{ bucketId: "clinical", mode: "read" }],
    },
  ],
};
