import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AuthError,
  checkPassword,
  describeAuthError,
  normaliseTotpCode,
  toAuthStep,
} from "./flow";

/** Builds a minimal SignInOutput-shaped object for the mapper under test. */
function output(signInStep: string, extra: Record<string, unknown> = {}) {
  return {
    isSignedIn: false,
    nextStep: { signInStep, ...extra },
  } as unknown as Parameters<typeof toAuthStep>[0];
}

describe("toAuthStep", () => {
  it("reports done when Cognito says the user is signed in", () => {
    const done = { isSignedIn: true, nextStep: { signInStep: "DONE" } };
    assert.deepEqual(
      toAuthStep(done as unknown as Parameters<typeof toAuthStep>[0]),
      { kind: "done" },
    );
  });

  it("maps the forced password change on first sign-in", () => {
    assert.deepEqual(
      toAuthStep(output("CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED")),
      { kind: "new-password" },
    );
  });

  it("maps the TOTP challenge for a returning user", () => {
    assert.deepEqual(toAuthStep(output("CONFIRM_SIGN_IN_WITH_TOTP_CODE")), {
      kind: "totp-code",
    });
  });

  it("maps TOTP enrolment, carrying the secret and a labelled setup URI", () => {
    const step = toAuthStep(
      output("CONTINUE_SIGN_IN_WITH_TOTP_SETUP", {
        totpSetupDetails: {
          sharedSecret: "SECRET123",
          getSetupUri: (issuer: string) =>
            new URL(`otpauth://totp/${encodeURIComponent(issuer)}?secret=SECRET123`),
        },
      }),
    );

    assert.equal(step.kind, "totp-setup");
    if (step.kind !== "totp-setup") return;
    assert.equal(step.secret, "SECRET123");
    // The issuer is what the user sees in their authenticator app.
    assert.match(step.uri, /Nuaig/);
  });

  it("surfaces an unhandled step rather than silently doing nothing", () => {
    const step = toAuthStep(output("CONFIRM_SIGN_IN_WITH_SMS_CODE"));
    assert.deepEqual(step, {
      kind: "unsupported",
      step: "CONFIRM_SIGN_IN_WITH_SMS_CODE",
    });
  });
});

describe("describeAuthError", () => {
  const as = (name: string, message = "") => describeAuthError({ name, message });

  it("does not reveal whether an account exists", () => {
    const wrongPassword = as("NotAuthorizedException").message;
    const noSuchUser = as("UserNotFoundException").message;

    assert.equal(wrongPassword, noSuchUser);
    assert.equal(wrongPassword, "Incorrect email or password.");
  });

  it("explains a rejected TOTP code in terms the user can act on", () => {
    assert.match(as("CodeMismatchException").message, /30 seconds/);
    assert.match(as("ExpiredCodeException").message, /expired/i);
  });

  it("tells a rate-limited user to wait rather than retry", () => {
    for (const name of [
      "LimitExceededException",
      "TooManyRequestsException",
      "TooManyFailedAttemptsException",
    ]) {
      assert.match(as(name).message, /wait a few minutes/i, name);
    }
  });

  it("passes through Cognito's own password-policy wording when present", () => {
    const error = as("InvalidPasswordException", "Password must have symbols");
    assert.equal(error.message, "Password must have symbols");
  });

  it("falls back to generic wording for an unknown error, keeping the code", () => {
    const error = as("SomethingNewException", "internal detail");
    assert.ok(error instanceof AuthError);
    assert.equal(error.code, "SomethingNewException");
    // The internal detail must not reach the user.
    assert.ok(!error.message.includes("internal detail"));
  });

  it("never returns an empty message", () => {
    for (const name of ["", "NotAuthorizedException", "Whatever"]) {
      assert.ok(describeAuthError({ name }).message.length > 0, name);
    }
  });
});

describe("checkPassword", () => {
  it("accepts a password meeting every rule", () => {
    assert.deepEqual(checkPassword("Correct-Horse9!"), { ok: true, failures: [] });
  });

  it("requires at least 12 characters", () => {
    assert.ok(checkPassword("Short1!aB").failures.includes("at least 12 characters"));
  });

  it("names every unmet rule at once, not just the first", () => {
    const result = checkPassword("aaaaaaaaaaaa");
    assert.equal(result.ok, false);
    assert.deepEqual(result.failures, [
      "an uppercase letter",
      "a number",
      "a symbol",
    ]);
  });

  it("rejects an empty password with every rule listed", () => {
    assert.equal(checkPassword("").failures.length, 5);
  });
});

describe("normaliseTotpCode", () => {
  it("strips the spaces authenticator apps display", () => {
    assert.equal(normaliseTotpCode("123 456"), "123456");
  });

  it("drops non-digits rather than rejecting the input", () => {
    assert.equal(normaliseTotpCode("12a3-45b6"), "123456");
  });

  it("caps at six digits so a paste cannot overflow the field", () => {
    assert.equal(normaliseTotpCode("1234567890"), "123456");
  });
});
