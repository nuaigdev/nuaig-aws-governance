"use client";

import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useId, useState } from "react";
import QRCode from "qrcode";

import { activeClient } from "@config/index";
import { Button, Field, Message, TextInput } from "@/components/ui";
import { useSession } from "@/lib/auth/SessionProvider";
import {
  answerChallenge,
  AuthError,
  beginSignIn,
  checkPassword,
  normaliseTotpCode,
  type AuthStep,
} from "@/lib/auth/flow";
import { BackendNotDeployedError, isPlaceholderConfig } from "@/lib/amplify/client";

import styles from "./SignIn.module.css";

function SignInFlow() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { status, refresh } = useSession();

  const [step, setStep] = useState<AuthStep>({ kind: "done" });
  const [started, setStarted] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  async function run(action: () => Promise<AuthStep>) {
    setBusy(true);
    setError(null);
    try {
      const next = await action();
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

  return (
    <div>
      {!started || step.kind === "done" ? (
        <CredentialsStep
          busy={busy}
          error={error}
          onSubmit={(email, password) => run(() => beginSignIn(email, password))}
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
        <div className={styles.panel}>
          <div className={styles.identity}>
            <Image
              src="/branding/nuaig-logo.svg"
              alt="Nuaig"
              width={150}
              height={62}
              className={styles.logo}
              priority
            />
            <span className={styles.divider} aria-hidden="true" />
            {activeClient.logo ? (
              <Image
                src={activeClient.logo}
                alt={activeClient.displayName}
                width={170}
                height={40}
                className={styles.clientLogo}
              />
            ) : (
              <span className={styles.clientName}>{activeClient.displayName}</span>
            )}
          </div>

          <div className={styles.card}>
            <h1 className={styles.heading}>{heading}</h1>
            {intro && <p className={styles.intro}>{intro}</p>}
            {children}
          </div>

          <p className={styles.footerNote}>
            Managed by Nuaig for {activeClient.displayName}
          </p>
        </div>
      </main>
    </div>
  );
}

/* --------------------------------------------------------- Credentials --- */

function CredentialsStep({
  busy,
  error,
  onSubmit,
}: {
  busy: boolean;
  error: string | null;
  onSubmit: (email: string, password: string) => void;
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
