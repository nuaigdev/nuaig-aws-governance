import { a, defineData, type ClientSchema } from "@aws-amplify/backend";

import { activeClient } from "../../config/index";
import { adminGroupsFunction } from "../functions/admin-groups/resource";
import { adminUsersFunction } from "../functions/admin-users/resource";
import { auditWriterFunction } from "../functions/audit-writer/resource";
import { postAuthenticationFunction } from "../functions/post-authentication/resource";

/**
 * The admin group's id comes from the client config, never a literal — a client
 * may name their admin group something else, and `validateClientConfig` has
 * already guaranteed exactly one group carries `isAdmin`.
 */
const ADMIN_GROUP = activeClient.groups.find((group) => group.isAdmin)!.id;

/**
 * Portal metadata and the audit log.
 *
 * ## Why no client writes to the audit log
 *
 * `AuditEvent` grants no create/update/delete to any caller — not even admins.
 * Records are written only by `auditWriterFunction` and the two admin
 * functions, which derive the actor from the verified Cognito JWT rather than
 * from request input. A client-writable audit log is a log the client can
 * forge, which defeats the point of having one.
 *
 * There is also no update or delete path at all, for anyone. The log is
 * append-only by construction; retention is an out-of-band lifecycle concern
 * on the underlying table, not a button in this app.
 */

/** Actions recorded in the audit log. Values are stored verbatim — never renumber. */
const auditAction = a.enum([
  // Session
  "LOGIN",
  "LOGIN_FAILED",
  "LOGOUT",
  // Data access
  "FILE_LIST",
  "FILE_DOWNLOAD",
  "FILE_UPLOAD",
  "FILE_UPLOAD_REJECTED_COLLISION",
  // Administration
  "USER_CREATED",
  "USER_DISABLED",
  "USER_REENABLED",
  "USER_GROUPS_CHANGED",
  "USER_INVITE_RESENT",
  "GROUP_ACCESS_VIEWED",
  "GROUP_ACCESS_CHANGED",
  // Anything the portal refused
  "ACCESS_DENIED",
]);

const auditOutcome = a.enum(["SUCCESS", "DENIED", "ERROR"]);

const schema = a
  .schema({
    AuditAction: auditAction,
    AuditOutcome: auditOutcome,

    AuditEvent: a
      .model({
        /** Namespaces records when one table is ever shared across tenants. */
        clientId: a.string().required(),

        /** Cognito `sub` of the actor. Stable across email changes. */
        actorSub: a.string().required(),
        /** Actor's email at the time of the event, denormalised for display. */
        actorEmail: a.string().required(),
        /** Actor's groups at the time of the event — group membership changes over time. */
        actorGroups: a.string().array(),

        action: a.ref("AuditAction").required(),
        outcome: a.ref("AuditOutcome").required(),

        /** Config bucket id (not the physical S3 name). Absent for non-bucket actions. */
        bucketId: a.string(),
        /** S3 object key, when the event concerns one object. */
        objectKey: a.string(),

        /** Cognito username/sub the admin action was performed *on*. */
        targetUser: a.string(),

        /** Server-assigned. Never taken from client input. */
        occurredAt: a.datetime().required(),

        sourceIp: a.string(),
        userAgent: a.string(),

        /** Free-form JSON for action-specific context. Never holds file contents. */
        detail: a.json(),
      })
      .secondaryIndexes((index) => [
        // The audit screen's three filters, each backed by an index so the UI
        // never resorts to a full table scan as the log grows.
        index("clientId").sortKeys(["occurredAt"]).queryField("auditEventsByTime"),
        index("actorSub").sortKeys(["occurredAt"]).queryField("auditEventsByActor"),
        index("bucketId").sortKeys(["occurredAt"]).queryField("auditEventsByBucket"),
      ])
      .authorization((allow) => [
        // Read-only, admins only. No create/update/delete for any caller.
        // Backend function access is granted at the schema level below — this
        // version of data-schema does not accept `allow.resource` per model.
        allow.groups([ADMIN_GROUP]).to(["read"]),
      ]),

    /**
     * One record per user, maintained by the Cognito post-authentication
     * trigger.
     *
     * Exists so the user list can show "last login" with a single list call,
     * instead of scanning the audit log per user. The audit log remains the
     * authoritative history; this is a derived, current-state projection of it.
     */
    UserProfile: a
      .model({
        /** Cognito `sub`. The identifier, so the trigger can upsert blind. */
        sub: a.id().required(),
        email: a.string().required(),
        lastLoginAt: a.datetime(),
        /** Cumulative successful sign-ins. Useful for spotting dormant accounts. */
        loginCount: a.integer().default(0),
      })
      .identifier(["sub"])
      .authorization((allow) => [
        allow.groups([ADMIN_GROUP]).to(["read"]),
      ]),

    /**
     * Records a data-access event on behalf of the calling user.
     *
     * The handler derives actor, groups and timestamp from the request's
     * verified JWT, and rejects any action that is not a data-access action —
     * so a user cannot use this to fabricate an admin event.
     */
    recordDataAccess: a
      .mutation()
      .arguments({
        action: a.ref("AuditAction").required(),
        outcome: a.ref("AuditOutcome").required(),
        bucketId: a.string(),
        objectKey: a.string(),
        detail: a.json(),
      })
      .returns(a.boolean())
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(auditWriterFunction)),

    /** Admin-only user management. All operations are audited by the handler. */
    manageUsers: a
      .mutation()
      .arguments({
        operation: a.string().required(),
        payload: a.json().required(),
      })
      .returns(a.json())
      .authorization((allow) => [allow.groups([ADMIN_GROUP])])
      .handler(a.handler.function(adminUsersFunction)),

    /** Admin-only group inspection and membership changes. */
    manageGroups: a
      .mutation()
      .arguments({
        operation: a.string().required(),
        payload: a.json().required(),
      })
      .returns(a.json())
      .authorization((allow) => [allow.groups([ADMIN_GROUP])])
      .handler(a.handler.function(adminGroupsFunction)),
  })
  // Backend function access to the models.
  //
  // This grant is schema-wide rather than per-model: `allow.resource` is only
  // available at the schema level in data-schema, so each function below can
  // reach every model, not just the one it uses. These are four trusted
  // first-party handlers with no caller-supplied queries, so the practical
  // exposure is small — but it is wider than the per-model scoping the code
  // would otherwise express, and worth knowing when adding a fifth function or
  // a model holding something more sensitive.
  .authorization((allow) => [
    allow.resource(auditWriterFunction),
    allow.resource(adminUsersFunction),
    allow.resource(adminGroupsFunction),
    allow.resource(postAuthenticationFunction),
  ]);

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    // No API key and no public access: every caller is an authenticated
    // Cognito user, so every request carries an identity we can audit.
    defaultAuthorizationMode: "userPool",
  },
});
