import { fetchAuthSession, getCurrentUser } from "aws-amplify/auth";

import { activeClient } from "@config/index";
import { accessibleBuckets, isAdmin as configIsAdmin } from "@config/access";
import type { EffectiveBucketAccess } from "@config/access";
import type { AccessMode } from "@config/types";
import { getDataClient } from "@/lib/amplify/client";

/**
 * The signed-in user, as the UI understands them.
 *
 * `groups` comes from the Cognito ID token's `cognito:groups` claim. The token
 * is signed by Cognito and verified by AppSync and the Identity Pool, so it is
 * not something the browser can edit to widen access — but this object still
 * only decides *what the UI renders*. The actual boundary is the IAM policy on
 * the group's role. If the two ever disagree, S3 refuses the call and the user
 * sees an error rather than data they should not have.
 */
export interface PortalSession {
  readonly sub: string;
  readonly username: string;
  readonly email: string;
  readonly givenName: string;
  readonly familyName: string;
  /** Optional job title from `custom:jobTitle`. Empty when never set. */
  readonly jobTitle: string;
  readonly groups: readonly string[];
  readonly isAdmin: boolean;
  readonly buckets: readonly EffectiveBucketAccess[];
}

function claimString(
  claims: Record<string, unknown> | undefined,
  key: string,
): string {
  const value = claims?.[key];
  return typeof value === "string" ? value : "";
}

/**
 * Loads the current session, or `null` when nobody is signed in.
 *
 * `forceRefresh` re-fetches the tokens rather than using the cached ones. Used
 * after any action that could have changed the user's groups, so the UI does
 * not keep rendering from a stale claim.
 */
export async function loadSession(
  forceRefresh = false,
): Promise<PortalSession | null> {
  const authSession = await fetchAuthSession({ forceRefresh });
  const idToken = authSession.tokens?.idToken;

  if (!idToken) return null;

  const claims = idToken.payload as Record<string, unknown>;
  const rawGroups = claims["cognito:groups"];
  const groups = Array.isArray(rawGroups)
    ? rawGroups.filter((g): g is string => typeof g === "string")
    : [];

  const { username } = await getCurrentUser();

  return {
    sub: claimString(claims, "sub"),
    username,
    email: claimString(claims, "email"),
    givenName: claimString(claims, "given_name"),
    familyName: claimString(claims, "family_name"),
    jobTitle: claimString(claims, "custom:jobTitle"),
    groups,
    // Administrative capability is a property of the group's definition, not of
    // its IAM policy, so it stays config-resolved.
    isAdmin: configIsAdmin(activeClient, groups),
    buckets: await liveBuckets(groups),
  };
}

/**
 * The user's bucket access as IAM currently grants it, falling back to config.
 *
 * Config is the deploy-time baseline; an administrator can widen a group from
 * the Groups page afterwards, and only IAM knows about that. Asking the backend
 * is what keeps the upload button honest — rendering from config alone would
 * hide upload on a bucket the user may now write to.
 *
 * On any failure this falls back to the config answer rather than surfacing an
 * error. That is the safe direction: config is never more permissive than the
 * boundary, and a user still cannot do anything S3 itself refuses.
 */
async function liveBuckets(
  groups: readonly string[],
): Promise<EffectiveBucketAccess[]> {
  const fromConfig = accessibleBuckets(activeClient, groups);

  try {
    const result = await getDataClient().queries.myBucketAccess();
    if (result.errors?.length) return fromConfig;

    const raw = typeof result.data === "string" ? JSON.parse(result.data) : result.data;
    if (!Array.isArray(raw)) return fromConfig;

    const live = raw as {
      bucketId: string;
      mode: AccessMode;
      viaGroups?: string[];
    }[];

    return activeClient.buckets
      .filter((bucket) => live.some((entry) => entry.bucketId === bucket.id))
      .map((bucket) => {
        const entry = live.find((e) => e.bucketId === bucket.id)!;
        return {
          bucket,
          mode: entry.mode,
          viaGroups: entry.viaGroups ?? [],
        };
      });
  } catch {
    return fromConfig;
  }
}

/** Display name, falling back sensibly when the name attributes are empty. */
export function displayName(session: PortalSession): string {
  const full = `${session.givenName} ${session.familyName}`.trim();
  return full || session.email;
}

/** Initials for the user-menu avatar. */
export function initials(session: PortalSession): string {
  const first = session.givenName.trim()[0] ?? "";
  const last = session.familyName.trim()[0] ?? "";
  const combined = `${first}${last}`.toUpperCase();
  return combined || session.email.slice(0, 2).toUpperCase();
}
