import type { ClientConfig } from "../types";

/**
 * Nuaig's own showcase deployment.
 *
 * Generic on purpose: it demonstrates the real shape of the product — four
 * buckets across four sensitivity profiles, an admin group and four scoped
 * groups — without resembling any specific client's environment. Bucket names
 * and sample contents are synthetic. See `scripts/seed-showcase-data.ts` for
 * the sample files.
 */
export const clientConfig: ClientConfig = {
  clientId: "nuaig-internal",
  displayName: "Northwind Care Group",
  // Our showcase account has no pre-existing buckets, so the stack creates them.
  bucketProvisioning: "managed",
  // No `logo`: Northwind Care Group is a demonstration tenant and has supplied
  // no logo, so the header renders its displayName as styled text. This is the
  // same path a real client without a logo takes — worth exercising in the
  // showcase rather than hiding behind a placeholder mark.
  buckets: [
    {
      id: "documents",
      label: "Documents & Images",
      bucketName: "nuaig-showcase-documents",
      description:
        "Operational documents, policies, photographs and general correspondence.",
      sensitivity: "standard",
    },
    {
      id: "pii",
      label: "Resident & Customer Data",
      bucketName: "nuaig-showcase-resident-data",
      description:
        "Records identifying residents, families and staff. Handle under the client's data-protection policy.",
      sensitivity: "sensitive",
    },
    {
      id: "financial",
      label: "Financial Records",
      bucketName: "nuaig-showcase-financial",
      description:
        "Invoices, billing statements, payroll exports and year-end accounts.",
      sensitivity: "sensitive",
    },
    {
      id: "clinical",
      label: "Clinical Records",
      bucketName: "nuaig-showcase-clinical",
      description:
        "Care plans, medication administration records and clinical assessments.",
      sensitivity: "sensitive",
    },
  ],
  groups: [
    {
      id: "admin",
      label: "Administrator",
      description:
        "Manages users, groups and the audit log. Reaches every bucket.",
      isAdmin: true,
      bucketAccess: [{ bucketId: "*", mode: "read-upload" }],
    },
    {
      id: "documents",
      label: "Documents Team",
      description:
        "Maintains operational documents and imagery. May upload to the documents bucket.",
      bucketAccess: [{ bucketId: "documents", mode: "read-upload" }],
    },
    {
      id: "pii",
      label: "PII Access",
      description:
        "Reads resident and customer records. Read-only: changes to these records are made in the source system, not here.",
      bucketAccess: [{ bucketId: "pii", mode: "read" }],
    },
    {
      id: "financial",
      label: "Finance Team",
      description:
        "Reads and files financial records. May upload statements and exports.",
      bucketAccess: [{ bucketId: "financial", mode: "read-upload" }],
    },
    {
      id: "clinical",
      label: "Clinical Staff",
      description:
        "Reads clinical documentation. Read-only: the clinical system of record remains authoritative.",
      bucketAccess: [{ bucketId: "clinical", mode: "read" }],
    },
  ],
};
