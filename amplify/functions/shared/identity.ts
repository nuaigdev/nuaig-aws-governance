import type { AppSyncIdentityCognito, AppSyncResolverEvent } from "aws-lambda";

/**
 * The caller, as derived from the verified Cognito JWT that AppSync attached
 * to the request.
 *
 * Every field here comes from the token, never from request arguments. This is
 * the distinction that makes the audit log trustworthy: a caller can choose
 * *what* they ask for, but not *who the log says asked*.
 */
export interface Caller {
  readonly sub: string;
  /**
   * Cognito username — the identifier admin operations target.
   *
   * Distinct from `email` on purpose. They happen to coincide today because
   * users are created with their email as username, but comparing a username
   * to an email would silently stop working the moment that changes.
   */
  readonly username: string;
  readonly email: string;
  readonly groups: readonly string[];
  readonly sourceIp?: string;
  readonly userAgent?: string;
}

export class UnauthenticatedError extends Error {
  constructor() {
    super("Request carried no Cognito identity.");
    this.name = "UnauthenticatedError";
  }
}

function isCognitoIdentity(identity: unknown): identity is AppSyncIdentityCognito {
  return (
    typeof identity === "object" &&
    identity !== null &&
    "sub" in identity &&
    typeof (identity as { sub: unknown }).sub === "string"
  );
}

/**
 * Extracts the caller from an AppSync event.
 *
 * Throws rather than returning a partial identity: a handler that cannot name
 * its caller must not proceed, because it could not audit what it did.
 */
export function resolveCaller(
  event: AppSyncResolverEvent<unknown>,
): Caller {
  const identity = event.identity;

  if (!isCognitoIdentity(identity)) {
    throw new UnauthenticatedError();
  }

  const claims = (identity.claims ?? {}) as Record<string, unknown>;
  const email = typeof claims.email === "string" ? claims.email : undefined;

  // AppSync surfaces groups on the identity; fall back to the raw claim for
  // token shapes where only the claim is populated.
  const rawGroups = identity.groups ?? claims["cognito:groups"];
  const groups = Array.isArray(rawGroups)
    ? rawGroups.filter((g): g is string => typeof g === "string")
    : [];

  const username =
    typeof claims["cognito:username"] === "string"
      ? (claims["cognito:username"] as string)
      : identity.username;

  if (!username) {
    // Without a username we cannot safely evaluate "is this admin acting on
    // themselves", so refuse rather than guess.
    throw new UnauthenticatedError();
  }

  return {
    sub: identity.sub,
    username,
    // An account always has an email — it is the login identifier and is
    // required + immutable in `defineAuth`. The fallback exists so a token
    // missing the claim degrades to an auditable record rather than a crash.
    email: email ?? `<no email claim:${identity.sub}>`,
    groups,
    sourceIp: identity.sourceIp?.[0],
    userAgent: (event.request?.headers?.["user-agent"] as string | undefined) ?? undefined,
  };
}

/** True when the caller belongs to the configured admin group. */
export function callerIsAdmin(caller: Caller, adminGroup: string): boolean {
  return caller.groups.includes(adminGroup);
}
