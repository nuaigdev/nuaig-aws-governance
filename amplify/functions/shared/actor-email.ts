import {
  AdminGetUserCommand,
  CognitoIdentityProviderClient,
} from "@aws-sdk/client-cognito-identity-provider";

import type { Caller } from "./identity";

/**
 * Fills in the caller's email when the token did not carry it.
 *
 * The browser's data client authenticates to AppSync with the Cognito *access*
 * token, which has no `email` claim — only the ID token does. Without this, the
 * audit log would name every actor by an opaque UUID, which is useless on an
 * audit screen. The username *is* in the access token, so it is looked up here.
 *
 * Cached per Lambda instance: an email is immutable in this pool
 * (`mutable: false` in `defineAuth`), so a cached value never goes stale, and a
 * user browsing folders does not cost one Cognito call per click.
 *
 * A lookup failure degrades to the caller as-is rather than throwing — the
 * record is still attributable by `actorSub`, which is the stable identifier.
 */
const cache = new Map<string, string>();
const cognito = new CognitoIdentityProviderClient();

export async function withEmail(caller: Caller, userPoolId: string): Promise<Caller> {
  if (!caller.email.startsWith("<no email claim")) return caller;

  const cached = cache.get(caller.username);
  if (cached) return { ...caller, email: cached };

  try {
    const user = await cognito.send(
      new AdminGetUserCommand({ UserPoolId: userPoolId, Username: caller.username }),
    );
    const email = user.UserAttributes?.find((a) => a.Name === "email")?.Value;
    if (!email) return caller;

    cache.set(caller.username, email);
    return { ...caller, email };
  } catch (error) {
    console.warn("ACTOR_EMAIL_LOOKUP_FAILED", { sub: caller.sub, error });
    return caller;
  }
}
