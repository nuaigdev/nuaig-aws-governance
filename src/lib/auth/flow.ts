import {
  confirmSignIn,
  signIn,
  type SignInOutput,
} from "aws-amplify/auth";

/**
 * The sign-in state machine, expressed as our own step type.
 *
 * Amplify returns a `nextStep.signInStep` string discriminant. Mapping it onto
 * a closed union here means the UI handles every state explicitly, and an
 * unrecognised one surfaces as a clear error instead of a blank screen — which
 * is what a `default: return null` would produce for a user who cannot sign in.
 */
export type AuthStep =
  | { kind: "done" }
  /** First sign-in: the temporary password from the invite must be replaced. */
  | { kind: "new-password" }
  /**
   * MFA is required for everyone, so a user with no authenticator yet is sent
   * here to enrol. `secret` and `uri` render the QR code and manual key.
   */
  | { kind: "totp-setup"; secret: string; uri: string }
  /** Returning user: six-digit code from their authenticator. */
  | { kind: "totp-code" }
  /** Cognito asked for something this portal does not implement. */
  | { kind: "unsupported"; step: string };

export class AuthError extends Error {
  constructor(
    message: string,
    /** Cognito's error name, for logging. Never rendered verbatim. */
    readonly code?: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

/**
 * Maps a Cognito error onto a message we are willing to show.
 *
 * Deliberately vague about whether an account exists: "Incorrect email or
 * password" for both a wrong password and an unknown user. Distinguishing them
 * would let anyone enumerate who has access to a client's data portal.
 */
export function describeAuthError(error: unknown): AuthError {
  const name = (error as { name?: string })?.name ?? "";
  const message = (error as { message?: string })?.message ?? "";

  switch (name) {
    case "NotAuthorizedException":
    case "UserNotFoundException":
      return new AuthError("Incorrect email or password.", name);

    case "PasswordResetRequiredException":
      return new AuthError(
        "Your password must be reset before you can sign in. Ask an administrator to resend your invitation.",
        name,
      );

    case "UserNotConfirmedException":
      return new AuthError(
        "Your account has not been confirmed yet. Ask an administrator to resend your invitation.",
        name,
      );

    case "CodeMismatchException":
    case "EnableSoftwareTokenMFAException":
      return new AuthError(
        "That code was not accepted. Codes expire every 30 seconds — check your authenticator and try the current one.",
        name,
      );

    case "ExpiredCodeException":
      return new AuthError("That code has expired. Enter the current one.", name);

    case "LimitExceededException":
    case "TooManyRequestsException":
    case "TooManyFailedAttemptsException":
      return new AuthError(
        "Too many attempts. Wait a few minutes before trying again.",
        name,
      );

    case "InvalidPasswordException":
      return new AuthError(
        message || "That password does not meet the password policy.",
        name,
      );

    case "UserLambdaValidationException":
      return new AuthError(
        "Sign-in was refused. If this continues, contact your administrator.",
        name,
      );

    default:
      // Log the specific cause; show something a user can act on.
      console.error("AUTH_UNEXPECTED", { name, message });
      return new AuthError(
        "Sign-in could not be completed. If this continues, contact your administrator.",
        name || "Unknown",
      );
  }
}

/** Translates Amplify's `nextStep` into our step union. */
export function toAuthStep(output: SignInOutput): AuthStep {
  if (output.isSignedIn) return { kind: "done" };

  const next = output.nextStep;

  switch (next.signInStep) {
    case "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED":
      return { kind: "new-password" };

    case "CONTINUE_SIGN_IN_WITH_TOTP_SETUP": {
      const setup = next.totpSetupDetails;
      return {
        kind: "totp-setup",
        secret: setup.sharedSecret,
        // The issuer is what the user sees in their authenticator app, so it
        // must name the portal rather than a raw pool id.
        uri: setup
          .getSetupUri("Nuaig S3 Governance Portal")
          .toString(),
      };
    }

    case "CONFIRM_SIGN_IN_WITH_TOTP_CODE":
      return { kind: "totp-code" };

    default:
      return { kind: "unsupported", step: next.signInStep };
  }
}

/** Starts sign-in with email and password. */
export async function beginSignIn(
  email: string,
  password: string,
): Promise<AuthStep> {
  try {
    const output = await signIn({
      username: email.trim().toLowerCase(),
      password,
      options: { authFlowType: "USER_SRP_AUTH" },
    });
    return toAuthStep(output);
  } catch (error) {
    throw describeAuthError(error);
  }
}

/**
 * Answers whatever challenge Cognito raised.
 *
 * One function for all of them because `confirmSignIn` is one call regardless
 * of challenge; the UI supplies a new password or a six-digit code.
 */
export async function answerChallenge(response: string): Promise<AuthStep> {
  try {
    const output = await confirmSignIn({ challengeResponse: response });
    return toAuthStep(output);
  } catch (error) {
    throw describeAuthError(error);
  }
}

/** Client-side password rules, mirroring the Cognito policy. */
export interface PasswordCheck {
  readonly ok: boolean;
  readonly failures: readonly string[];
}

/**
 * Checks a password against the pool's policy before spending a round trip.
 *
 * Cognito remains authoritative — this only gives immediate feedback. The rules
 * mirror the defaults asserted in `amplify/auth/resource.ts`; if the policy is
 * changed there, change it here too.
 */
export function checkPassword(password: string): PasswordCheck {
  const failures: string[] = [];

  if (password.length < 12) failures.push("at least 12 characters");
  if (!/[a-z]/.test(password)) failures.push("a lowercase letter");
  if (!/[A-Z]/.test(password)) failures.push("an uppercase letter");
  if (!/\d/.test(password)) failures.push("a number");
  if (!/[^A-Za-z0-9]/.test(password)) failures.push("a symbol");

  return { ok: failures.length === 0, failures };
}

/** Normalises a typed TOTP code: strip spaces, keep digits. */
export function normaliseTotpCode(input: string): string {
  return input.replace(/\D/g, "").slice(0, 6);
}
