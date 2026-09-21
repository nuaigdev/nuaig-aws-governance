import { defineFunction } from "@aws-amplify/backend";

/**
 * Writes data-access audit records on behalf of authenticated users.
 *
 * Exists so that no client ever holds write access to the audit table. The
 * handler re-derives the actor from the request's verified JWT and refuses any
 * action outside the data-access set.
 */
export const auditWriterFunction = defineFunction({
  name: "audit-writer",
  // An AppSync resolver lives with the API that invokes it; placing it
  // anywhere else creates a circular dependency between nested stacks.
  resourceGroupName: "data",
  entry: "./handler.ts",
  // Short: one DynamoDB put. A longer ceiling would just hold a download's
  // logging call open during an outage.
  timeoutSeconds: 15,
  memoryMB: 256,
});
