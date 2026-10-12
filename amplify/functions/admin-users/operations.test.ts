import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { OperationError, parseOperation } from "./operations";

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
