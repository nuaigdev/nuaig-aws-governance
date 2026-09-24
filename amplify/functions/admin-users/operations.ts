import { activeClient } from "../../../config/index";

/**
 * Request/response contracts for the `manageUsers` mutation, plus the
 * validation that guards them.
 *
 * Kept separate from `handler.ts` so the rules can be unit-tested without an
 * AWS client — these are the checks that stop an admin locking every admin out
 * of the portal, so they deserve tests that run in CI rather than only in a
 * deployed sandbox.
 */

export type UserStatus =
  | "CONFIRMED"
  | "FORCE_CHANGE_PASSWORD"
  | "RESET_REQUIRED"
  | "UNCONFIRMED"
  | "UNKNOWN";

export interface PortalUser {
  /** Cognito username. Stable; used as the target of admin operations. */
  readonly username: string;
  readonly sub: string;
  readonly email: string;
  readonly givenName: string;
  readonly familyName: string;
  readonly enabled: boolean;
  readonly status: UserStatus;
  readonly groups: readonly string[];
  /** ISO-8601. Cognito's `UserLastModifiedDate` is not a login time — see handler. */
  readonly createdAt: string;
  /** ISO-8601 of the most recent recorded LOGIN audit event, if any. */
  readonly lastLoginAt: string | null;
}

export type ManageUsersOperation =
  | { readonly operation: "listUsers" }
  | {
      readonly operation: "createUser";
      readonly email: string;
      readonly givenName: string;
      readonly familyName: string;
      readonly groups: readonly string[];
    }
  | { readonly operation: "disableUser"; readonly username: string }
  | { readonly operation: "enableUser"; readonly username: string }
  | {
      readonly operation: "setUserGroups";
      readonly username: string;
      readonly groups: readonly string[];
    }
  | { readonly operation: "resendInvite"; readonly username: string }
  | { readonly operation: "resetPassword"; readonly username: string };

export class OperationError extends Error {
  constructor(
    message: string,
    /** Safe to show an admin in the UI. Never contains AWS internals. */
    readonly userFacing = true,
  ) {
    super(message);
    this.name = "OperationError";
  }
}

const KNOWN_OPERATIONS = new Set([
  "listUsers",
  "createUser",
  "disableUser",
  "enableUser",
  "setUserGroups",
  "resendInvite",
  "resetPassword",
]);

/**
 * RFC 5322 is not worth implementing here. Cognito performs the authoritative
 * check; this catches obvious typos before we spend an API call on them.
 */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Parses and validates the untyped `payload` arriving from AppSync. */
export function parseOperation(
  operation: string,
  payload: unknown,
): ManageUsersOperation {
  if (!KNOWN_OPERATIONS.has(operation)) {
    throw new OperationError(`Unknown operation "${operation}".`);
  }

  const input = (payload ?? {}) as Record<string, unknown>;

  switch (operation) {
    case "listUsers":
      return { operation: "listUsers" };

    case "createUser": {
      const email = requireString(input.email, "email").trim().toLowerCase();
      if (!EMAIL.test(email)) {
        throw new OperationError(`"${email}" is not a valid email address.`);
      }
      return {
        operation: "createUser",
        email,
        givenName: requireString(input.givenName, "givenName").trim(),
        familyName: requireString(input.familyName, "familyName").trim(),
        groups: validateGroups(input.groups),
      };
    }

    case "setUserGroups":
      return {
        operation: "setUserGroups",
        username: requireString(input.username, "username"),
        groups: validateGroups(input.groups),
      };

    case "disableUser":
    case "enableUser":
    case "resendInvite":
    case "resetPassword":
      return {
        operation,
        username: requireString(input.username, "username"),
      } as ManageUsersOperation;

    default:
      throw new OperationError(`Unknown operation "${operation}".`);
  }
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new OperationError(`"${field}" is required.`);
  }
  return value;
}

/**
 * Group ids must exist in the client config.
 *
 * This is what makes group membership the only path to access: an admin cannot
 * invent a group name here and have Cognito create an unmapped group that no
 * IAM policy governs.
 */
function validateGroups(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new OperationError(`"groups" must be an array of group ids.`);
  }

  const groups = value.filter((g): g is string => typeof g === "string");
  if (groups.length !== value.length) {
    throw new OperationError(`"groups" must contain only strings.`);
  }

  if (groups.length === 0) {
    throw new OperationError(
      `A user must belong to at least one group — group membership is the only ` +
        `way access is granted, so a user with none could not reach anything.`,
    );
  }

  const known = new Set(activeClient.groups.map((g) => g.id));
  const unknown = groups.filter((g) => !known.has(g));
  if (unknown.length > 0) {
    throw new OperationError(
      `Unknown group(s): ${unknown.join(", ")}. Valid groups: ` +
        activeClient.groups.map((g) => g.id).join(", "),
    );
  }

  return [...new Set(groups)];
}

/** The configured admin group id. Validated to exist by `validateClientConfig`. */
export const ADMIN_GROUP = activeClient.groups.find((g) => g.isAdmin)!.id;

/**
 * Refuses changes that would leave the portal with no way back in.
 *
 * Two distinct hazards:
 *  - An admin disabling or de-administering *themselves* mid-session.
 *  - Removing the last admin entirely, which would leave nobody able to
 *    manage users or groups without dropping to the AWS console.
 *
 * `currentAdminUsernames` must be the set of *enabled* admins, since a
 * disabled admin cannot sign in to fix anything.
 */
export function assertAdminSafety(
  change: {
    readonly targetUsername: string;
    readonly kind: "disable" | "setGroups";
    readonly nextGroups?: readonly string[];
  },
  callerUsername: string,
  currentEnabledAdminUsernames: readonly string[],
): void {
  const targetIsAdmin = currentEnabledAdminUsernames.includes(change.targetUsername);

  if (change.targetUsername === callerUsername) {
    if (change.kind === "disable") {
      throw new OperationError(
        `You cannot disable your own account. Ask another administrator to do it.`,
      );
    }
    if (change.kind === "setGroups" && !change.nextGroups?.includes(ADMIN_GROUP)) {
      throw new OperationError(
        `You cannot remove your own administrator access. Ask another ` +
          `administrator to do it.`,
      );
    }
  }

  if (!targetIsAdmin) return;

  const losesAdmin =
    change.kind === "disable" ||
    (change.kind === "setGroups" && !change.nextGroups?.includes(ADMIN_GROUP));

  if (losesAdmin && currentEnabledAdminUsernames.length <= 1) {
    throw new OperationError(
      `This is the only active administrator. Grant administrator access to ` +
        `another user first, or the portal would be left with nobody able to ` +
        `manage users and groups.`,
    );
  }
}
