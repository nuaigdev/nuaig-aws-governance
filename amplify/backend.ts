import { defineBackend } from "@aws-amplify/backend";
import { Stack } from "aws-cdk-lib";
import {
  Effect,
  ManagedPolicy,
  PolicyDocument as IamPolicyDocument,
  PolicyStatement,
  type CfnRole,
} from "aws-cdk-lib/aws-iam";
import {
  BlockPublicAccess,
  Bucket,
  BucketEncryption,
  HttpMethods,
  type IBucket,
} from "aws-cdk-lib/aws-s3";

import { activeClient } from "../config/index";
import { grantedBuckets } from "../config/access";
import {
  ACCESS_TOKEN_MINUTES,
  REFRESH_TOKEN_HOURS,
} from "../config/session";
import { auth } from "./auth/resource";
import { data } from "./data/resource";
import { adminGroupsFunction } from "./functions/admin-groups/resource";
import { adminUsersFunction } from "./functions/admin-users/resource";
import { auditWriterFunction } from "./functions/audit-writer/resource";
import { postAuthenticationFunction } from "./functions/post-authentication/resource";
import {
  buildBucketPolicy,
  buildPermissionsBoundary,
  type PolicyDocument,
} from "./shared/bucket-policy";

const backend = defineBackend({
  auth,
  data,
  adminUsersFunction,
  adminGroupsFunction,
  auditWriterFunction,
  postAuthenticationFunction,
});

/**
 * Every function imports `config/`, which resolves the active client from
 * `NEXT_PUBLIC_CLIENT_ID` when the module loads. The deploy process has it; a
 * Lambda does not unless it is passed in. Without this, each function throws
 * during init — for the post-authentication trigger that means every sign-in is
 * refused after a correct password.
 *
 * A literal string, so it adds no cross-stack reference.
 */
for (const fn of [
  backend.adminUsersFunction,
  backend.adminGroupsFunction,
  backend.auditWriterFunction,
  backend.postAuthenticationFunction,
]) {
  fn.addEnvironment("NEXT_PUBLIC_CLIENT_ID", activeClient.clientId);
}

/**
 * Stack placement matters here. The data stack depends on auth (it authorises
 * against the user pool), so nothing in auth may reference anything in data.
 *
 * - `authStack` holds the permissions boundary, because the group roles it caps
 *   live in auth. Putting it in data made auth depend on data: a cycle.
 * - `storageStack` holds the buckets. They reference nothing, so they get a
 *   stack of their own and can never take part in a cycle.
 */
const authStack = Stack.of(backend.auth.resources.userPool);
const storageStack = backend.createStack("storage");

/* -------------------------------------------------------------------------- */
/* Buckets                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Created for our showcase, adopted by name for a real client.
 *
 * Managed buckets are declared with the CDK default removal policy, RETAIN, and
 * versioned. **Caveat, observed:** an Amplify *sandbox* applies DESTROY to every
 * resource regardless, so `ampx sandbox delete` tries to delete these buckets.
 * S3 refuses while any object version remains, so data still has to be removed
 * deliberately first — but the retention guarantee only fully holds for branch
 * (`pipeline-deploy`) deployments. Never point a sandbox at real client data.
 */
const buckets = new Map<string, IBucket>();

/**
 * Origins allowed to call the buckets from a browser.
 *
 * Comma-separated in `PORTAL_ALLOWED_ORIGINS`; defaults to the local dev
 * server. A hosted deployment must set it to the portal's own URL.
 *
 * Only applies to `managed` buckets. A client's `existing` buckets are
 * imported, not owned, so their CORS rules must be set by whoever administers
 * them — a deployment step to flag, not something this stack can do.
 */
const PORTAL_ORIGINS = (process.env.PORTAL_ALLOWED_ORIGINS ?? "http://localhost:3000")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

for (const bucket of activeClient.buckets) {
  if (activeClient.bucketProvisioning === "existing") {
    buckets.set(bucket.id, Bucket.fromBucketName(storageStack, `Bucket${bucket.id}`, bucket.bucketName));
    continue;
  }

  const created = new Bucket(storageStack, `Bucket${bucket.id}`, {
    bucketName: bucket.bucketName,
    // Versioning is what makes the "never overwrite" promise recoverable: even
    // if a collision check is ever bypassed, the prior version survives.
    versioned: true,
    encryption: BucketEncryption.S3_MANAGED,
    enforceSSL: true,
    blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
    // The browser calls S3 directly with the session's scoped credentials, so
    // the portal's origin must be allowed. DELETE is deliberately absent — the
    // same ceiling the IAM policy enforces, stated again at the bucket.
    cors: [
      {
        allowedOrigins: PORTAL_ORIGINS,
        allowedMethods: [
          HttpMethods.GET,
          HttpMethods.HEAD,
          HttpMethods.PUT,
          HttpMethods.POST,
        ],
        allowedHeaders: ["*"],
        // ETag is required to complete multipart uploads; the metadata header
        // carries the "uploaded by" stamp the file browser displays.
        exposedHeaders: ["ETag", "x-amz-version-id", "x-amz-meta-uploaded-by"],
        maxAge: 3000,
      },
    ],
    // No `autoDeleteObjects`, and no `removalPolicy: DESTROY` here. RETAIN is
    // the correct behaviour for a governance product (sandbox caveat above).
  });

  buckets.set(bucket.id, created);
}

/* -------------------------------------------------------------------------- */
/* Group roles: permissions boundary + initial access policy                   */
/* -------------------------------------------------------------------------- */

/**
 * The ceiling for every group role.
 *
 * Because an admin can rewrite group policies at runtime, this boundary is the
 * thing that makes that safe: a policy written by the portal can only ever
 * narrow what is permitted here, never exceed it. Editing the boundary
 * requires a deploy.
 */
const permissionsBoundary = new ManagedPolicy(authStack, "PortalGroupBoundary", {
  managedPolicyName: `${activeClient.clientId}-portal-group-boundary`,
  description:
    "Ceiling for S3 governance portal group roles. Caps access to configured " +
    "buckets and denies all destructive and IAM actions.",
  document: toIamPolicyDocument(
    buildPermissionsBoundary(activeClient.buckets.map((b) => b.bucketName)),
  ),
});

/** groupId → IAM role name, handed to the admin-groups function. */
const groupRoleNames: Record<string, string> = {};

for (const group of activeClient.groups) {
  const role = backend.auth.resources.groups[group.id]?.role;

  if (!role) {
    throw new Error(
      `No Cognito role was created for group "${group.id}". Every group in the ` +
        `client config must be declared in defineAuth.`,
    );
  }

  // Cap the role before granting it anything.
  (role.node.defaultChild as CfnRole).permissionsBoundary =
    permissionsBoundary.managedPolicyArn;

  const policy = buildBucketPolicy(
    grantedBuckets(activeClient, group).map((g) => ({
      bucketName: g.bucket.bucketName,
      mode: g.mode,
    })),
  );

  if (policy) {
    for (const statement of policy.Statement) {
      role.addToPrincipalPolicy(
        new PolicyStatement({
          sid: statement.Sid,
          effect: statement.Effect === "Deny" ? Effect.DENY : Effect.ALLOW,
          actions: [...statement.Action],
          resources: [...statement.Resource],
        }),
      );
    }
  }

  groupRoleNames[group.id] = role.roleName;
}

/* -------------------------------------------------------------------------- */
/* Function permissions                                                        */
/* -------------------------------------------------------------------------- */

const adminUsersLambda = backend.adminUsersFunction.resources.lambda;
const adminGroupsLambda = backend.adminGroupsFunction.resources.lambda;
const userPool = backend.auth.resources.userPool;

/* -------------------------------------------------------------------------- */
/* User pool policy                                                            */
/* -------------------------------------------------------------------------- */

const cfnUserPool = backend.auth.resources.cfnResources.cfnUserPool;

/**
 * Password policy.
 *
 * 12 characters rather than the Cognito default of 8, given what these buckets
 * hold. `checkPassword` in `src/lib/auth/flow.ts` mirrors these rules for
 * immediate feedback — change both together.
 *
 * `temporaryPasswordValidityDays: 3` bounds how long an unused invitation stays
 * live. An invite that sits valid for a week is a credential sitting in an
 * inbox for a week.
 */
cfnUserPool.policies = {
  passwordPolicy: {
    minimumLength: 12,
    requireLowercase: true,
    requireUppercase: true,
    requireNumbers: true,
    requireSymbols: true,
    temporaryPasswordValidityDays: 3,
  },
};

/**
 * Token lifetimes, from `config/session.ts` so the UI's idle timeout and the
 * pool agree. Short access/ID tokens mean a revoked or stolen token is useful
 * for minutes, not hours; the refresh token caps an unbroken session.
 */
const cfnUserPoolClient = backend.auth.resources.cfnResources.cfnUserPoolClient;
cfnUserPoolClient.accessTokenValidity = ACCESS_TOKEN_MINUTES;
cfnUserPoolClient.idTokenValidity = ACCESS_TOKEN_MINUTES;
cfnUserPoolClient.refreshTokenValidity = REFRESH_TOKEN_HOURS;
cfnUserPoolClient.tokenValidityUnits = {
  accessToken: "minutes",
  idToken: "minutes",
  refreshToken: "hours",
};

// Admins create every user. Nobody self-registers into a client's data portal.
cfnUserPool.adminCreateUserConfig = {
  allowAdminCreateUserOnly: true,
};

// User management: scoped to this pool, and deliberately without
// AdminDeleteUser — offboarding is disable + global sign-out, so the audit
// trail that names a user always resolves.
adminUsersLambda.addToRolePolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: [
      "cognito-idp:AdminCreateUser",
      "cognito-idp:AdminGetUser",
      "cognito-idp:AdminEnableUser",
      "cognito-idp:AdminDisableUser",
      "cognito-idp:AdminResetUserPassword",
      "cognito-idp:AdminUserGlobalSignOut",
      "cognito-idp:AdminAddUserToGroup",
      "cognito-idp:AdminRemoveUserFromGroup",
      "cognito-idp:AdminListGroupsForUser",
      "cognito-idp:ListUsers",
      "cognito-idp:ListUsersInGroup",
    ],
    resources: [userPool.userPoolArn],
  }),
);

backend.adminUsersFunction.addEnvironment("AMPLIFY_AUTH_USERPOOL_ID", userPool.userPoolId);

// Group management: read the pool's groups, and rewrite the inline access
// policy on the group roles only.
adminGroupsLambda.addToRolePolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: [
      "cognito-idp:ListGroups",
      "cognito-idp:GetGroup",
      "cognito-idp:CreateGroup",
      "cognito-idp:UpdateGroup",
      "cognito-idp:ListUsersInGroup",
    ],
    resources: [userPool.userPoolArn],
  }),
);

/**
 * The privilege that makes runtime group editing possible — and the one worth
 * reading carefully.
 *
 * Scoped three ways:
 *  1. `resources` lists only the group role ARNs, so it cannot touch its own
 *     execution role, the admin role, or anything else in the account.
 *  2. The action list is inline-policy writes only. No `AttachRolePolicy`, so
 *     it cannot bind an arbitrary managed policy such as AdministratorAccess.
 *     No `CreateRole`, `PassRole`, or trust-policy edits.
 *  3. Every role it can write to already carries the permissions boundary, so
 *     whatever it writes is still capped at the configured buckets.
 */
adminGroupsLambda.addToRolePolicy(
  new PolicyStatement({
    sid: "RewriteGroupAccessPolicies",
    effect: Effect.ALLOW,
    actions: ["iam:PutRolePolicy", "iam:DeleteRolePolicy", "iam:GetRolePolicy"],
    resources: Object.values(groupRoleNames).map(
      (roleName) => `arn:aws:iam::${authStack.account}:role/${roleName}`,
    ),
  }),
);

backend.adminGroupsFunction.addEnvironment(
  "PORTAL_GROUP_ROLE_NAMES",
  JSON.stringify(groupRoleNames),
);
backend.adminGroupsFunction.addEnvironment("AMPLIFY_AUTH_USERPOOL_ID", userPool.userPoolId);

/**
 * AppSync hands resolvers the access token, which carries no email claim. The
 * audit writer and the group manager look the actor's email up so the audit
 * log names people rather than UUIDs. Read-only, scoped to this pool.
 * (`admin-users` already holds AdminGetUser above.)
 */
backend.auditWriterFunction.addEnvironment("AMPLIFY_AUTH_USERPOOL_ID", userPool.userPoolId);
for (const lambda of [backend.auditWriterFunction.resources.lambda, adminGroupsLambda]) {
  lambda.addToRolePolicy(
    new PolicyStatement({
      sid: "ResolveActorEmail",
      effect: Effect.ALLOW,
      actions: ["cognito-idp:AdminGetUser"],
      resources: [userPool.userPoolArn],
    }),
  );
}

/* -------------------------------------------------------------------------- */
/* Outputs                                                                     */
/* -------------------------------------------------------------------------- */

backend.addOutput({
  custom: {
    clientId: activeClient.clientId,
    // The browser needs physical bucket names and the region to address S3 with
    // the session's scoped credentials.
    buckets: activeClient.buckets.map((bucket) => ({
      id: bucket.id,
      bucketName: bucket.bucketName,
      region: authStack.region,
    })),
  },
});

/** Converts our plain policy documents into CDK's IAM representation. */
function toIamPolicyDocument(document: PolicyDocument): IamPolicyDocument {
  return new IamPolicyDocument({
    statements: document.Statement.map(
      (statement) =>
        new PolicyStatement({
          sid: statement.Sid,
          effect: statement.Effect === "Deny" ? Effect.DENY : Effect.ALLOW,
          actions: [...statement.Action],
          resources: [...statement.Resource],
        }),
    ),
  });
}
