import { defineFunction } from "@aws-amplify/backend";

/**
 * Cognito post-authentication trigger.
 *
 * Records LOGIN in the audit log and refreshes the user's `UserProfile`.
 *
 * Running this as a Cognito trigger rather than a call from the browser is the
 * whole point: it fires inside the authentication flow, so a login cannot go
 * unrecorded by a client that simply chooses not to report it, and the actor
 * is whoever Cognito just authenticated rather than whoever the request says.
 *
 * It fires after a *successful* authentication, including the second factor.
 * Failed attempts never reach it — see the note on LOGIN_FAILED in
 * `docs/audit-coverage.md`.
 */
export const postAuthenticationFunction = defineFunction({
  name: "post-authentication",
  entry: "./handler.ts",
  // This sits in the critical path of every sign-in. Keep it tight: if the
  // trigger is slow, every login is slow.
  timeoutSeconds: 10,
  memoryMB: 256,
});
