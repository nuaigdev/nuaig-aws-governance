import type { generateClient } from "aws-amplify/data";

import type { Schema } from "../../data/resource";
import type { Caller } from "./identity";

type AuditAction = Schema["AuditEvent"]["type"]["action"];
type AuditOutcome = Schema["AuditEvent"]["type"]["outcome"];

/**
 * The generated data client.
 *
 * Typed as the real client rather than a hand-written structural subset: a
 * loose shape here would let a field-name typo in the audit record compile,
 * and a record that fails to write is a record that is not in the log.
 */
export type AuditCapableClient = ReturnType<typeof generateClient<Schema>>;

export interface AuditEntry {
  readonly action: AuditAction;
  readonly outcome: AuditOutcome;
  readonly bucketId?: string | null;
  readonly objectKey?: string | null;
  readonly targetUser?: string | null;
  readonly detail?: unknown;
}

/**
 * Writes one audit record.
 *
 * `occurredAt`, `actorSub`, `actorEmail` and `actorGroups` are all set from the
 * verified caller and the server clock — the entry argument cannot influence
 * them.
 *
 * ## Failure policy
 *
 * A failed audit write is logged to CloudWatch and rethrown. Callers decide
 * whether that is fatal: for an admin mutation it is (better to fail the
 * operation than perform it unlogged), while the fire-and-forget access
 * recorder swallows it so a logging outage cannot block a download. Both
 * behaviours are deliberate and marked at the call site.
 */
export async function writeAuditEvent(
  client: AuditCapableClient,
  clientId: string,
  caller: Caller,
  entry: AuditEntry,
): Promise<void> {
  const record = {
    clientId,
    actorSub: caller.sub,
    actorEmail: caller.email,
    actorGroups: [...caller.groups],
    action: entry.action,
    outcome: entry.outcome,
    bucketId: entry.bucketId ?? null,
    objectKey: entry.objectKey ?? null,
    targetUser: entry.targetUser ?? null,
    occurredAt: new Date().toISOString(),
    sourceIp: caller.sourceIp ?? null,
    userAgent: caller.userAgent ?? null,
    detail: serialiseDetail(entry.detail),
  };

  const result = await client.models.AuditEvent.create(record);

  if (result.errors && result.errors.length > 0) {
    const message = result.errors.map((e) => e.message).join("; ");
    // Emit the record alongside the failure so the event is at least
    // recoverable from CloudWatch if the table write was the thing that broke.
    console.error("AUDIT_WRITE_FAILED", { message, record });
    throw new Error(`Failed to write audit event: ${message}`);
  }
}

/**
 * Serialises `detail` for the `AWSJSON` field.
 *
 * AppSync's `AWSJSON` scalar takes a JSON *string* on input. It also parses
 * one on the way in, so a detail that arrived as a mutation argument reaches
 * the handler as an object, and passing that straight back to `create` is
 * rejected ("Variable 'detail' has an invalid value"). Both shapes are
 * normalised here, so no call site has to remember which one it holds.
 */
export function serialiseDetail(detail: unknown): string | null {
  if (detail === undefined || detail === null) return null;
  if (typeof detail === "string") return detail;
  return JSON.stringify(detail);
}
