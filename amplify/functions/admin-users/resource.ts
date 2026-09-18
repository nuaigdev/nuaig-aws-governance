import { defineFunction } from "@aws-amplify/backend";

/**
 * Admin-only user management against the Cognito user pool.
 *
 * Deliberately offers no delete operation. Offboarding is
 * `AdminDisableUser` + `AdminUserGlobalSignOut`, which stops access
 * immediately while leaving the account — and therefore the audit trail that
 * references it — intact. Deleting a user record would orphan every audit
 * entry naming them, which is the opposite of what an audit log is for.
 */
export const adminUsersFunction = defineFunction({
  name: "admin-users",
  entry: "./handler.ts",
  // Listing users fans out to AdminListGroupsForUser per user. The ceiling is
  // sized for a pool larger than expected rather than for normal operation.
  timeoutSeconds: 60,
  memoryMB: 512,
});
