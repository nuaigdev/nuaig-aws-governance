import type { ClientConfig } from "../types";

/**
 * Worked example of a client tenant.
 *
 * Kept in the repo as the reference for onboarding a new client: copy this
 * file, rename it to `<client-id>.ts`, register it in `config/index.ts`, and
 * set `NEXT_PUBLIC_CLIENT_ID` for that deployment. The physical `bucketName`s
 * must match buckets that already exist in the client's AWS account.
 */
export const clientConfig: ClientConfig = {
  clientId: "acme-senior-living",
  displayName: "Acme Senior Living",
  // A real client's buckets already exist; the stack adopts them by name and
  // never creates or destroys them.
  bucketProvisioning: "existing",
  buckets: [
    {
      id: "documents",
      label: "Documents & Images",
      bucketName: "acme-documents",
      description: "Operational documents, policies and photographs.",
      sensitivity: "standard",
    },
    {
      id: "pii",
      label: "Resident & Customer Data",
      bucketName: "acme-pii",
      description: "Records identifying residents, families and staff.",
      sensitivity: "sensitive",
    },
    {
      id: "financial",
      label: "Financial Records",
      bucketName: "acme-financial",
      description: "Invoices, billing statements and year-end accounts.",
      sensitivity: "sensitive",
    },
    {
      id: "clinical",
      label: "Clinical Records",
      bucketName: "acme-imar",
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
