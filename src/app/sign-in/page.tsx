"use client";

import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useId, useState } from "react";
import QRCode from "qrcode";

import { activeClient } from "@config/index";
import { IDLE_TIMEOUT_MINUTES } from "@config/session";
import { AppFooter } from "@/components/chrome/AppFooter";
import { Button, Field, Message, TextInput } from "@/components/ui";
import { useSession } from "@/lib/auth/SessionProvider";
import {
  answerChallenge,
  AuthError,
  beginSignIn,
  checkPassword,
  completePasswordReset,
  normaliseTotpCode,
  requestPasswordReset,
  type AuthStep,
} from "@/lib/auth/flow";
import { BackendNotDeployedError, isPlaceholderConfig } from "@/lib/amplify/client";
import { SIGN_IN_NOTICE } from "@/lib/notices";

import styles from "./SignIn.module.css";

/** Where the password-reset sub-flow is, when it is active. */
type ResetState =
  | { stage: "request" }
  | { stage: "confirm"; email: string; adminInitiated: boolean };

function SignInFlow() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { status, refresh } = useSession();

  const [step, setStep] = useState<AuthStep>({ kind: "done" });
  const [started, setStarted] = useState(false);
  const [reset, setReset] = useState<ResetState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(
    searchParams.get("reason") === "idle"
      ? `You were signed out after ${IDLE_TIMEOUT_MINUTES} minutes of inactivity.`
      : null,
  );
  const [busy, setBusy] = useState(false);

  const nextPath = searchParams.get("next") ?? "/buckets";

  // Already signed in — for example, a second tab, or a back-navigation after
  // signing in elsewhere.
  useEffect(() => {
    if (status === "authenticated") router.replace(nextPath);
  }, [status, router, nextPath]);

  if (isPlaceholderConfig()) {
    return <BackendMissing />;
  }

  /**
   * Runs one step of the flow. An action returns the next step, or `null` when
   * it has already moved the page somewhere else (the reset sub-flow).
   */
  async function run(action: () => Promise<AuthStep | null>) {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const next = await action();
      if (next === null) return;
      if (next.kind === "done") {
        await refresh(true);
        router.replace(nextPath);
        return;
      }
      setStep(next);
      setStarted(true);
    } catch (caught) {
      setError(
        caught instanceof AuthError
          ? caught.message
          : "Sign-in could not be completed. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function signIn(email: string, password: string): Promise<AuthStep | null> {
    try {
      return await beginSignIn(email, password);
    } catch (caught) {
      // An administrator reset this account: hand straight over to the reset
      // flow, with the code already on its way, rather than dead-ending.
      if (caught instanceof AuthError && caught.code === "PasswordResetRequiredException") {
        await requestPasswordReset(email);
        setReset({ stage: "confirm", email, adminInitiated: true });
        return null;
      }
      throw caught;
    }
  }

  function leaveReset() {
    setReset(null);
    setError(null);
  }

  if (reset?.stage === "request") {
    return (
      <ForgotPasswordStep
        busy={busy}
        error={error}
        onBack={leaveReset}
        onSubmit={(email) =>
          run(async () => {
            await requestPasswordReset(email);
            setReset({ stage: "confirm", email, adminInitiated: false });
            return null;
          })
        }
      />
    );
  }

  if (reset?.stage === "confirm") {
    return (
      <ResetPasswordStep
        email={reset.email}
        adminInitiated={reset.adminInitiated}
        busy={busy}
        error={error}
        onBack={leaveReset}
        onSubmit={(code, password) =>
          run(async () => {
            await completePasswordReset(reset.email, code, password);
            setReset(null);
            setSuccess("Your password has been changed. Sign in with the new password.");
            return null;
          })
        }
      />
    );
  }

  return (
    <div>
      {!started || step.kind === "done" ? (
        <CredentialsStep
          busy={busy}
          error={error}
          success={success}
          onForgot={() => {
            setError(null);
            setSuccess(null);
            setReset({ stage: "request" });
          }}
          onSubmit={(email, password) => run(() => signIn(email, password))}
        />
      ) : step.kind === "new-password" ? (
        <NewPasswordStep
          busy={busy}
          error={error}
          onSubmit={(password) => run(() => answerChallenge(password))}
        />
      ) : step.kind === "totp-setup" ? (
        <TotpSetupStep
          secret={step.secret}
          uri={step.uri}
          busy={busy}
          error={error}
          onSubmit={(code) => run(() => answerChallenge(code))}
        />
      ) : step.kind === "totp-code" ? (
        <TotpCodeStep
          busy={busy}
          error={error}
          onSubmit={(code) => run(() => answerChallenge(code))}
        />
      ) : (
        <UnsupportedStep step={step.step} />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

const FEATURES = [
  {
    title: "Two-factor sign-in",
    body: "Every account is protected by a password and an authenticator app.",
    icon: "M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3Zm-1 14-3-3 1.4-1.4L11 13.2l4.6-4.6L17 10l-6 6Z",
  },
  {
    title: "Only what your role needs",
    body: "You see the buckets your group has been granted, and nothing else.",
    icon: "M12 1a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2h-1V6a5 5 0 0 0-5-5Zm-3 8V6a3 3 0 1 1 6 0v3H9Z",
  },
  {
    title: "Every access is recorded",
    body: "Sign-ins, downloads and administrative changes are kept in an audit log.",
    icon: "M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm8 1.5V8h4.5L14 3.5ZM8 12v2h8v-2H8Zm0 4v2h8v-2H8Z",
  },
  {
    title: "Nothing is deleted or overwritten",
    body: "Files can be viewed and downloaded, never removed or replaced from here.",
    icon: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm-1 15-4-4 1.4-1.4L11 14.2l5.6-5.6L18 10l-7 7Z",
  },
] as const;

function Shell({
  heading,
  intro,
  children,
}: {
  heading: string;
  intro?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={styles.page}>
      <main className={styles.main} id="main">
        <div className={styles.layout}>
          <section className={styles.aside} aria-label="About this portal">
            <div className={styles.identity}>
              {activeClient.logo ? (
                <Image
                  src={activeClient.logo}
                  alt={activeClient.displayName}
                  width={260}
                  height={64}
                  className={styles.clientLogo}
                  priority
                />
              ) : (
                <span className={styles.clientName}>{activeClient.displayName}</span>
              )}
            </div>

            <h2 className={styles.asideHeading}>Secure file access</h2>
            <p className={styles.asideLead}>
              Browse and download {activeClient.displayName}&rsquo;s records in one
              place, with access that follows your role.
            </p>

            <ul className={styles.features}>
              {FEATURES.map((feature) => (
                <li key={feature.title} className={styles.feature}>
                  <span className={styles.featureIcon} aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                      <path d={feature.icon} />
                    </svg>
                  </span>
                  <span>
                    <span className={styles.featureTitle}>{feature.title}</span>
                    <span className={styles.featureBody}>{feature.body}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <div className={styles.panel}>
            <div className={styles.card}>
              <h1 className={styles.heading}>{heading}</h1>
              {intro && <p className={styles.intro}>{intro}</p>}
              {children}
            </div>
            <p className={styles.notice}>{SIGN_IN_NOTICE}</p>
          </div>
        </div>
      </main>
      <AppFooter />
    </div>
  );
}

/* --------------------------------------------------------- Credentials --- */

function CredentialsStep({
  busy,
  error,
  success,
  onSubmit,
  onForgot,
}: {
  busy: boolean;
  error: string | null;
  success: string | null;
  onSubmit: (email: string, password: string) => void;
  onForgot: () => void;
}) {
  const emailId = useId();
  const passwordId = useId();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  return (
    <Shell heading="Sign in" intro="Use the email address your administrator invited.">
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(email, password);
        }}
      >
        {success && <Message tone="success">{success}</Message>}
        {error && <Message tone="error">{error}</Message>}

        <Field label="Email address" htmlFor={emailId}>
          <TextInput
            id={emailId}
            type="email"
            name="email"
            autoComplete="username"
            required
            autoFocus
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={busy}
          />
        </Field>

        <Field label="Password" htmlFor={passwordId}>
          <TextInput
            id={passwordId}
            type="password"
            name="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={busy}
          />
        </Field>

        <div className={styles.actions}>
          <Button type="submit" variant="primary" block busy={busy}>
            Continue
          </Button>
        </div>

        <button type="button" className={styles.linkButton} onClick={onForgot} disabled={busy}>
          Forgot your password?
        </button>
      </form>
    </Shell>
  );
}

/* ------------------------------------------------------ Forgot password --- */

function ForgotPasswordStep({
  busy,
  error,
  onSubmit,
  onBack,
}: {
  busy: boolean;
  error: string | null;
  onSubmit: (email: string) => void;
  onBack: () => void;
}) {
  const emailId = useId();
  const [email, setEmail] = useState("");

  return (
    <Shell
      heading="Reset your password"
      intro="Enter your email address and we will send a code to choose a new password."
    >
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(email);
        }}
      >
        {error && <Message tone="error">{error}</Message>}

        <Field label="Email address" htmlFor={emailId}>
          <TextInput
            id={emailId}
            type="email"
            autoComplete="username"
            required
            autoFocus
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={busy}
          />
        </Field>

        <div className={styles.actions}>
          <Button type="submit" variant="primary" block busy={busy}>
            Send code
          </Button>
        </div>

        <button type="button" className={styles.linkButton} onClick={onBack} disabled={busy}>
          Back to sign in
        </button>
      </form>
    </Shell>
  );
}

function ResetPasswordStep({
  email,
  adminInitiated,
  busy,
  error,
  onSubmit,
  onBack,
}: {
  email: string;
  adminInitiated: boolean;
  busy: boolean;
  error: string | null;
  onSubmit: (code: string, password: string) => void;
  onBack: () => void;
}) {
  const codeId = useId();
  const passwordId = useId();
  const confirmId = useId();
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [touched, setTouched] = useState(false);

  const check = checkPassword(password);
  const mismatch = touched && confirm !== "" && confirm !== password;
  const canSubmit = code.trim().length >= 6 && check.ok && password === confirm && !busy;

  return (
    <Shell
      heading="Choose a new password"
      intro={
        adminInitiated
          ? `An administrator has reset the password for ${email}. We have emailed a code to that address.`
          : `If ${email} has an account, a code is on its way. It can take a minute to arrive.`
      }
    >
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) onSubmit(code, password);
        }}
      >
        {error && <Message tone="error">{error}</Message>}

        <Field label="Code from your email" htmlFor={codeId}>
          <TextInput
            id={codeId}
            inputMode="numeric"
            autoComplete="one-time-code"
            mono
            required
            autoFocus
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/[^\d\s]/g, ""))}
            disabled={busy}
          />
        </Field>

        <Field
          label="New password"
          htmlFor={passwordId}
          error={touched && !check.ok ? `Must include ${check.failures.join(", ")}.` : null}
        >
          <TextInput
            id={passwordId}
            type="password"
            autoComplete="new-password"
            required
            value={password}
            invalid={touched && !check.ok}
            onChange={(event) => setPassword(event.target.value)}
            onBlur={() => setTouched(true)}
            disabled={busy}
          />
        </Field>

        <Field
          label="Confirm password"
          htmlFor={confirmId}
          error={mismatch ? "The two passwords do not match." : null}
        >
          <TextInput
            id={confirmId}
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            invalid={mismatch}
            onChange={(event) => setConfirm(event.target.value)}
            onBlur={() => setTouched(true)}
            disabled={busy}
          />
        </Field>

        <div className={styles.actions}>
          <Button type="submit" variant="primary" block busy={busy} disabled={!canSubmit}>
            Change password
          </Button>
        </div>

        <button type="button" className={styles.linkButton} onClick={onBack} disabled={busy}>
          Back to sign in
        </button>
      </form>
    </Shell>
  );
}

/* -------------------------------------------------------- New password --- */

function NewPasswordStep({
  busy,
  error,
  onSubmit,
}: {
  busy: boolean;
  error: string | null;
  onSubmit: (password: string) => void;
}) {
  const passwordId = useId();
  const confirmId = useId();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [touched, setTouched] = useState(false);

  const check = checkPassword(password);
  const mismatch = touched && confirm !== "" && confirm !== password;
  const canSubmit = check.ok && password === confirm && !busy;

  return (
    <Shell
      heading="Choose a password"
      intro="This is your first sign-in, so the temporary password from your invitation must be replaced."
    >
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) onSubmit(password);
        }}
      >
        {error && <Message tone="error">{error}</Message>}

        <Field
          label="New password"
          htmlFor={passwordId}
          error={touched && !check.ok ? `Must include ${check.failures.join(", ")}.` : null}
        >
          <TextInput
            id={passwordId}
            type="password"
            autoComplete="new-password"
            required
            autoFocus
            value={password}
            invalid={touched && !check.ok}
            onChange={(event) => setPassword(event.target.value)}
            onBlur={() => setTouched(true)}
            disabled={busy}
          />
        </Field>

        <ul className={styles.policyList}>
          <li>At least 12 characters</li>
          <li>Upper and lower case letters</li>
          <li>At least one number and one symbol</li>
        </ul>

        <Field
          label="Confirm password"
          htmlFor={confirmId}
          error={mismatch ? "The two passwords do not match." : null}
        >
          <TextInput
            id={confirmId}
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            invalid={mismatch}
            onChange={(event) => setConfirm(event.target.value)}
            onBlur={() => setTouched(true)}
            disabled={busy}
          />
        </Field>

        <div className={styles.actions}>
          <Button type="submit" variant="primary" block busy={busy} disabled={!canSubmit}>
            Set password and continue
          </Button>
        </div>
      </form>
    </Shell>
  );
}

/* ---------------------------------------------------------- TOTP setup --- */

function TotpSetupStep({
  secret,
  uri,
  busy,
  error,
  onSubmit,
}: {
  secret: string;
  uri: string;
  busy: boolean;
  error: string | null;
  onSubmit: (code: string) => void;
}) {
  const codeId = useId();
  const [code, setCode] = useState("");
  const [qr, setQr] = useState<string | null>(null);
  const [qrFailed, setQrFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(uri, { margin: 1, width: 360, errorCorrectionLevel: "M" })
      .then((dataUrl) => {
        if (!cancelled) setQr(dataUrl);
      })
      .catch(() => {
        // Not fatal: the manual key below is a complete alternative.
        if (!cancelled) setQrFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [uri]);

  return (
    <Shell
      heading="Set up two-factor authentication"
      intro="Two-factor authentication is required for every account on this portal."
    >
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          if (code.length === 6) onSubmit(code);
        }}
      >
        {error && <Message tone="error">{error}</Message>}

        <ol className={styles.steps}>
          <li>Open an authenticator app such as 1Password, Authy or Google Authenticator.</li>
          <li>Scan the code below, or enter the key by hand.</li>
          <li>Enter the six-digit code the app shows.</li>
        </ol>

        {qr && !qrFailed && (
          <div className={styles.qrFrame}>
            {/* eslint-disable-next-line @next/next/no-img-element -- a generated
                data URL, not a static asset; next/image cannot optimise it. */}
            <img
              src={qr}
              alt="QR code for setting up two-factor authentication"
              className={styles.qr}
            />
          </div>
        )}

        <div className={styles.secretBlock}>
          <span className="muted" style={{ fontSize: "0.8125rem" }}>
            {qrFailed ? "Enter this key in your authenticator app:" : "Or enter this key by hand:"}
          </span>
          <code className={styles.secret}>{secret}</code>
        </div>

        <Field label="Six-digit code" htmlFor={codeId}>
          <TextInput
            id={codeId}
            inputMode="numeric"
            autoComplete="one-time-code"
            mono
            required
            placeholder="000000"
            value={code}
            onChange={(event) => setCode(normaliseTotpCode(event.target.value))}
            disabled={busy}
          />
        </Field>

        <div className={styles.actions}>
          <Button
            type="submit"
            variant="primary"
            block
            busy={busy}
            disabled={code.length !== 6}
          >
            Verify and finish
          </Button>
        </div>
      </form>
    </Shell>
  );
}

/* ----------------------------------------------------------- TOTP code --- */

function TotpCodeStep({
  busy,
  error,
  onSubmit,
}: {
  busy: boolean;
  error: string | null;
  onSubmit: (code: string) => void;
}) {
  const codeId = useId();
  const [code, setCode] = useState("");

  return (
    <Shell
      heading="Enter your code"
      intro="Open your authenticator app and enter the current six-digit code."
    >
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          if (code.length === 6) onSubmit(code);
        }}
      >
        {error && <Message tone="error">{error}</Message>}

        <Field label="Six-digit code" htmlFor={codeId}>
          <TextInput
            id={codeId}
            inputMode="numeric"
            autoComplete="one-time-code"
            mono
            required
            autoFocus
            placeholder="000000"
            value={code}
            onChange={(event) => setCode(normaliseTotpCode(event.target.value))}
            disabled={busy}
          />
        </Field>

        <div className={styles.actions}>
          <Button
            type="submit"
            variant="primary"
            block
            busy={busy}
            disabled={code.length !== 6}
          >
            Sign in
          </Button>
        </div>
      </form>
    </Shell>
  );
}

/* --------------------------------------------------------- Edge states --- */

function UnsupportedStep({ step }: { step: string }) {
  return (
    <Shell heading="Additional verification needed">
      <Message tone="warning">
        Your account requires a verification step this portal does not handle
        (<code className="data">{step}</code>). Contact your administrator.
      </Message>
    </Shell>
  );
}

function BackendMissing() {
  return (
    <Shell heading="Backend not deployed">
      <Message tone="warning">
        {new BackendNotDeployedError().message}
      </Message>
    </Shell>
  );
}

/**
 * `useSearchParams` requires a Suspense boundary in the App Router: it makes
 * the subtree depend on request-time data, and without one the whole route
 * would opt out of static rendering.
 */
export default function SignInPage() {
  return (
    <Suspense fallback={<Shell heading="Sign in" />}>
      <SignInFlow />
    </Suspense>
  );
}
