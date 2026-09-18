"use client";

import { getDataClient } from "@/lib/amplify/client";
import type { Schema } from "../../amplify/data/resource";

/**
 * Client-side audit recording.
 *
 * Calls the `recordDataAccess` mutation, whose handler derives the actor and
 * timestamp from the verified JWT. Nothing about *who* or *when* is sent from
 * here — only what was accessed.
 */

type AuditAction = Schema["AuditEvent"]["type"]["action"];
type AuditOutcome = Schema["AuditEvent"]["type"]["outcome"];

export interface DataAccessEvent {
  readonly action: AuditAction;
  readonly outcome: AuditOutcome;
  readonly bucketId?: string;
  readonly objectKey?: string;
  readonly detail?: Record<string, unknown>;
}

/**
 * Records an access event.
 *
 * **Never throws.** A logging failure must not block a download the user is
 * entitled to — the failure is reported to the console for CloudWatch/RUM to
 * pick up instead. The authoritative guarantee that access is logged comes
 * from the server side: LOGIN is written by the Cognito trigger, and every
 * admin action is written inside its own mutation handler. This call covers
 * the file-level events that only the browser knows about.
 */
export async function recordDataAccess(event: DataAccessEvent): Promise<void> {
  try {
    const client = getDataClient();
    const result = await client.mutations.recordDataAccess({
      action: event.action,
      outcome: event.outcome,
      bucketId: event.bucketId ?? null,
      objectKey: event.objectKey ?? null,
      detail: event.detail ? JSON.stringify(event.detail) : null,
    });

    if (result.errors?.length) {
      console.error("AUDIT_RECORD_REJECTED", {
        action: event.action,
        errors: result.errors.map((error) => error.message),
      });
    }
  } catch (error) {
    console.error("AUDIT_RECORD_FAILED", { action: event.action, error });
  }
}
