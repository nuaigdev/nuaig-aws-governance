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
