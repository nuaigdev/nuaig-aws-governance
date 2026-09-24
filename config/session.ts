/**
 * Session policy, shared by the infrastructure (`amplify/backend.ts`) and the
 * UI (idle sign-out), so the two cannot drift apart.
 *
 * These are deployment-wide, not per-client: the same short-session stance
 * applies to every tenant, because every tenant's buckets hold sensitive data.
 * Changing a value is a code change and a redeploy.
 */

/** Cognito access and ID token lifetime. Amplify refreshes them transparently. */
export const ACCESS_TOKEN_MINUTES = 30;

/**
 * Maximum session length without signing in again, however active the user is.
 * (Cognito's refresh token lifetime.)
 */
export const REFRESH_TOKEN_HOURS = 12;

/** The UI signs a user out after this long with no interaction. */
export const IDLE_TIMEOUT_MINUTES = 30;

/** How long before sign-out the user is warned and offered "stay signed in". */
export const IDLE_WARNING_MINUTES = 2;
