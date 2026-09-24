"use client";

import type { AccessMode } from "@config/types";
import { getDataClient } from "@/lib/amplify/client";

/**
 * Typed wrappers over the admin mutations.
 *
 * The mutations take `(operation, payload)` rather than one mutation per
 * action, so the GraphQL surface stays small and every admin operation runs
 * through the same authorisation and audit path in the handler. These wrappers
 * put the type safety back on the client side.
 */

export interface PortalUser {
  readonly username: string;
  readonly sub: string;
  readonly email: string;
  readonly givenName: string;
  readonly familyName: string;
  readonly enabled: boolean;
  readonly status:
    | "CONFIRMED"
    | "FORCE_CHANGE_PASSWORD"
    | "RESET_REQUIRED"
    | "UNCONFIRMED"
    | "UNKNOWN";
  readonly groups: readonly string[];
  readonly createdAt: string;
  readonly lastLoginAt: string | null;
}

export interface GroupAccessView {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly isAdmin: boolean;
  readonly memberCount: number;
  readonly access: readonly {
    readonly bucketId: string;
    readonly bucketLabel: string;
    readonly mode: AccessMode;
  }[];
  readonly divergedFromConfig: boolean;
}

/**
 * Error carrying a message the handler intended for an administrator.
 *
 * The handlers distinguish expected refusals (last-admin protection, validation)
 * from internal faults, and only the former carry a message worth showing.
 */
export class AdminOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminOperationError";
  }
}

async function callUsers<T>(operation: string, payload: unknown): Promise<T> {
  const client = getDataClient();
  const result = await client.mutations.manageUsers({
    operation,
    payload: JSON.stringify(payload ?? {}),
  });

  if (result.errors?.length) {
    throw new AdminOperationError(result.errors[0].message);
  }
  return parse<T>(result.data);
}

async function callGroups<T>(operation: string, payload: unknown): Promise<T> {
  const client = getDataClient();
  const result = await client.mutations.manageGroups({
    operation,
    payload: JSON.stringify(payload ?? {}),
  });

  if (result.errors?.length) {
    throw new AdminOperationError(result.errors[0].message);
  }
  return parse<T>(result.data);
}

/** AppSync returns `AWSJSON` as a string; older shapes may already be parsed. */
function parse<T>(data: unknown): T {
  if (typeof data === "string") return JSON.parse(data) as T;
  return data as T;
}

/* ------------------------------------------------------------------ Users */

export function listUsers(): Promise<PortalUser[]> {
  return callUsers<PortalUser[]>("listUsers", {});
}

export function createUser(input: {
  email: string;
  givenName: string;
  familyName: string;
  groups: readonly string[];
}): Promise<PortalUser> {
  return callUsers<PortalUser>("createUser", input);
}

export function disableUser(username: string): Promise<{ username: string }> {
  return callUsers("disableUser", { username });
}

export function enableUser(username: string): Promise<{ username: string }> {
  return callUsers("enableUser", { username });
}

export function setUserGroups(
  username: string,
  groups: readonly string[],
): Promise<{ username: string }> {
  return callUsers("setUserGroups", { username, groups });
}

export function resendInvite(username: string): Promise<{ username: string }> {
  return callUsers("resendInvite", { username });
}

export function resetUserPassword(username: string): Promise<{ username: string }> {
  return callUsers("resetPassword", { username });
}

/* ----------------------------------------------------------------- Groups */

export function listGroups(): Promise<GroupAccessView[]> {
  return callGroups<GroupAccessView[]>("listGroups", {});
}

export function setGroupAccess(
  groupId: string,
  access: readonly { bucketId: string; mode: AccessMode }[],
): Promise<{ groupId: string }> {
  return callGroups("setGroupAccess", { groupId, access });
}
