import { defineAuth } from "@aws-amplify/backend";

import { activeClient } from "../../config/index";
import { inviteEmailBody, inviteEmailSubject } from "../../config/invite-email";
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
    email: {
      /**
       * The invitation an administrator's "create user" sends.
       *
       * Cognito's default is a one-line message naming a username and a
       * password, which reads like phishing to someone who was not told to
       * expect it — exactly the wrong first impression for a portal holding
       * resident records. The replacement explains what the portal is, links
       * to it, and sets out the three setup steps.
       *
       * `user()` and `code()` return Cognito's `{username}` and `{####}`
       * placeholders, substituted when the message is sent.
       */
      userInvitation: {
        emailSubject: inviteEmailSubject(activeClient),
        emailBody: (user: () => string, code: () => string) =>
          inviteEmailBody(activeClient, user(), code()),
      },
    },
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

    /**
     * Job title, shown beside a person's name so an administrator reviewing the
     * user list or the audit log can tell who someone is.
     *
     * ## Three decisions worth knowing, because two of them are permanent
     *
     * 1. **Optional.** `required: false` — a pool cannot later relax a required
     *    attribute, and an admin who does not know someone's title must still be
     *    able to create the account.
     * 2. **Named `jobTitle`, not `role`.** In this product "role" already means
     *    an IAM role and a Cognito group, which is the access mechanism. A
     *    `custom:role` attribute sitting next to that would read as though it
     *    granted something. It grants nothing; it is a label.
     * 3. **A custom attribute can never be removed from a user pool.** Not
     *    renamed, not deleted — only ignored. So this is added before the first
     *    client deploy rather than after, and the name is chosen once.
     */
    "custom:jobTitle": {
      dataType: "String",
      mutable: true,
      // Cognito requires a bound; 128 is long enough for "Director of Clinical
      // Services, Eastern Region" without inviting a paragraph.
      maxLen: 128,
      minLen: 0,
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
