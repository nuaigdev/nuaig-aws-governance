import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { invitationTarget, OperationError, parseOperation } from "./operations";

describe("parseOperation: resetPassword", () => {
  it("accepts a username", () => {
    assert.deepEqual(parseOperation("resetPassword", { username: "abc" }), {
      operation: "resetPassword",
      username: "abc",
    });
  });

  it("requires a username", () => {
    assert.throws(() => parseOperation("resetPassword", {}), OperationError);
    assert.throws(() => parseOperation("resetPassword", { username: "  " }), OperationError);
  });

  it("does not accept a password from the caller", () => {
    // A reset never takes a password: the user chooses theirs with an emailed
    // code, so no credential passes through an administrator.
    const parsed = parseOperation("resetPassword", { username: "abc", password: "hunter2" });
    assert.deepEqual(parsed, { operation: "resetPassword", username: "abc" });
  });
});

describe("parseOperation: unknown operations", () => {
  it("rejects anything not on the allow-list, including destructive verbs", () => {
    assert.throws(() => parseOperation("deleteUser", { username: "abc" }), OperationError);
  });
});

describe("parseOperation: jobTitle", () => {
  const base = { email: "a@b.co", givenName: "A", familyName: "B", groups: ["admin"] };

  it("is optional — absent, null and blank all mean not set", () => {
    for (const value of [undefined, null, "", "   "]) {
      const parsed = parseOperation("createUser", { ...base, jobTitle: value });
      assert.equal(
        parsed.operation === "createUser" ? parsed.jobTitle : "unreachable",
        "",
      );
    }
  });

  it("trims a supplied title", () => {
    const parsed = parseOperation("createUser", { ...base, jobTitle: "  Nurse Manager  " });
    assert.equal(parsed.operation === "createUser" ? parsed.jobTitle : "", "Nurse Manager");
  });

  it("rejects a title longer than the pool allows, with a readable message", () => {
    // Cognito would otherwise refuse this as an opaque InvalidParameterException.
    assert.throws(
      () => parseOperation("createUser", { ...base, jobTitle: "x".repeat(129) }),
      /longer than 128/,
    );
  });

  it("rejects a non-string title", () => {
    assert.throws(() => parseOperation("createUser", { ...base, jobTitle: 42 }), OperationError);
  });
});

describe("parseOperation: updateProfile", () => {
  it("requires a username and both names, and allows clearing the title", () => {
    assert.deepEqual(
      parseOperation("updateProfile", {
        username: "u1",
        givenName: "A",
        familyName: "B",
        jobTitle: "",
      }),
      { operation: "updateProfile", username: "u1", givenName: "A", familyName: "B", jobTitle: "" },
    );

    assert.throws(
      () => parseOperation("updateProfile", { givenName: "A", familyName: "B" }),
      OperationError,
    );
  });

  it("offers no way to change the email address", () => {
    // Email is the sign-in identifier and every audit entry is tied to it, so
    // the operation must silently ignore an attempt rather than honour it.
    const parsed = parseOperation("updateProfile", {
      username: "u1",
      givenName: "A",
      familyName: "B",
      email: "attacker@example.com",
    });
    assert.equal("email" in parsed, false);
  });
});

describe("invitationTarget", () => {
  const pending = {
    Enabled: true,
    UserStatus: "FORCE_CHANGE_PASSWORD",
    UserAttributes: [
      { Name: "sub", Value: "e4d80448-30d1-709e-60c9-3ead8702ff3f" },
      { Name: "email", Value: "dlarkin@psl.org" },
    ],
  };

  /**
   * The production bug this guards against: the handler passed the Cognito
   * username — a UUID in this pool — to AdminCreateUser, which requires an
   * email and refused with "Username should be an email". Resending an
   * invitation is the only remedy for an expired temporary password, so the
   * failure left a new user with no way in at all.
   */
  it("returns the email, never the opaque username", () => {
    const target = invitationTarget(pending);
    assert.equal(target, "dlarkin@psl.org");
    assert.match(target, /@/, "AdminCreateUser rejects a non-email username");
  });

  it("refuses a user who has already signed in, and says what to do instead", () => {
    assert.throws(
      () => invitationTarget({ ...pending, UserStatus: "CONFIRMED" }),
      (error: unknown) => {
        assert.ok(error instanceof OperationError);
        assert.match(error.message, /Reset password/);
        return true;
      },
    );
  });

  it("refuses a disabled account", () => {
    assert.throws(
      () => invitationTarget({ ...pending, Enabled: false }),
      /disabled/,
    );
  });

  it("refuses rather than guessing when no email is recorded", () => {
    assert.throws(
      () => invitationTarget({ ...pending, UserAttributes: [{ Name: "sub", Value: "x" }] }),
      /no email address/,
    );
    assert.throws(() => invitationTarget({ ...pending, UserAttributes: undefined }), OperationError);
  });

  it("treats a missing Enabled flag as not enabled", () => {
    assert.throws(() => invitationTarget({ ...pending, Enabled: undefined }), OperationError);
  });
});
