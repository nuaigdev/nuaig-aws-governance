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
  type IBucket,
} from "aws-cdk-lib/aws-s3";

import { activeClient } from "../config";
import { grantedBuckets } from "../config/access";
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

const stack = Stack.of(backend.data.resources.graphqlApi);

/* -------------------------------------------------------------------------- */
/* Buckets                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Created for our showcase, adopted by name for a real client.
 *
 * Neither path grants the stack permission to delete a bucket: managed buckets
 * are created with `RETAIN`, so tearing the stack down leaves the data intact
 * and someone has to delete it deliberately, out of band.
 */
const buckets = new Map<string, IBucket>();

for (const bucket of activeClient.buckets) {
  if (activeClient.bucketProvisioning === "existing") {
    buckets.set(bucket.id, Bucket.fromBucketName(stack, `Bucket${bucket.id}`, bucket.bucketName));
    continue;
  }

  const created = new Bucket(stack, `Bucket${bucket.id}`, {
    bucketName: bucket.bucketName,
    // Versioning is what makes the "never overwrite" promise recoverable: even
    // if a collision check is ever bypassed, the prior version survives.
    versioned: true,
    encryption: BucketEncryption.S3_MANAGED,
    enforceSSL: true,
    blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
    // No `autoDeleteObjects`, and no `removalPolicy: DESTROY`. The default
    // RETAIN is the correct behaviour for a governance product.
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
const permissionsBoundary = new ManagedPolicy(stack, "PortalGroupBoundary", {
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
      (roleName) => `arn:aws:iam::${stack.account}:role/${roleName}`,
    ),
  }),
);

backend.adminGroupsFunction.addEnvironment(
  "PORTAL_GROUP_ROLE_NAMES",
  JSON.stringify(groupRoleNames),
);
backend.adminGroupsFunction.addEnvironment("AMPLIFY_AUTH_USERPOOL_ID", userPool.userPoolId);

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
      region: stack.region,
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
