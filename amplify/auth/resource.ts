import { defineAuth } from "@aws-amplify/backend";

import { activeClient } from "../../config/index";
import { postAuthenticationFunction } from "../functions/post-authentication/resource";

/**
 * Cognito User Pool + Identity Pool for the active client.
 *
 * Groups are declared from the client config, so the Cognito groups and the
 * portal's notion of groups can never drift apart. Each group gets its own IAM
 * role; `amplify/backend.ts` attaches the scoped S3 policy to it.
 *
 * MFA is required for every user, not just admins — the buckets hold resident,
 * clinical and financial records, and a single-factor account is the weakest
 * link regardless of which group it sits in.
 */
export const auth = defineAuth({
  loginWith: {
    email: true,
  },

  // Group order matters: Amplify assigns precedence by array position, and
  // the admin group must win when a user belongs to several.
  groups: activeClient.groups.map((group) => group.id),

  multifactor: {
    mode: "REQUIRED",
    totp: true,
    // SMS is deliberately off. It is the weakest of the MFA options (SIM-swap
    // and SS7 interception), it costs per message, and it needs an SNS spend
    // limit raise before it works in production at all. TOTP via an
    // authenticator app is the default here.
    sms: false,
  },

  userAttributes: {
    email: {
      required: true,
      mutable: false,
    },
    givenName: {
      required: true,
      mutable: true,
    },
    familyName: {
      required: true,
      mutable: true,
    },
  },

  // Admins create users; nobody self-registers into a client's data portal.
  // This is enforced again on the user pool in `backend.ts`.
  accountRecovery: "EMAIL_ONLY",

  triggers: {
    // Records LOGIN server-side, inside the auth flow, so a login cannot go
    // unlogged by a client that declines to report it.
    postAuthentication: postAuthenticationFunction,
  },
});
