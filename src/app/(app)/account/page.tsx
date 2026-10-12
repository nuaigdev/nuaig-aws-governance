"use client";

import { useId, useState } from "react";

import { Badge, Button, Card, Field, Message, TextInput } from "@/components/ui";
import { AuthError, changeOwnPassword, checkPassword } from "@/lib/auth/flow";
import { useSession } from "@/lib/auth/SessionProvider";
import { displayName } from "@/lib/auth/session";
import { recordDataAccess } from "@/lib/audit";
import { activeClient } from "@config/index";

import styles from "./Account.module.css";

/**
 * The signed-in user's own account page.
 *
 * Exists because every other way to get a new password went through an
 * administrator or an emailed code. Someone who simply wants to rotate their
 * password — because they typed it on a shared screen, or their organisation
 * asks them to periodically — had no route that did not involve telling someone
 * their password was being changed.
 *
 * Name and job title are read-only here on purpose. They appear in the audit
 * log beside the actions a person took, so letting people edit their own
 * display identity would let them quietly change how their history reads. An
 * administrator changes them, and that change is itself audited.
 */
export default function AccountPage() {
  const { session } = useSession();
  if (!session) return null;

  const groupLabels = session.groups.map(
    (id) => activeClient.groups.find((group) => group.id === id)?.label ?? id,
  );

  return (
    <>
      <header className={styles.header}>
        <h1 className={styles.title}>Your account</h1>
        <p className={styles.intro}>
          Your name, title and access are set by an administrator. You can change
          your own password here.
        </p>
      </header>

      <div className={styles.columns}>
        <Card>
          <h2 className={styles.cardTitle}>Details</h2>
          <dl className={styles.details}>
            <div>
              <dt>Name</dt>
              <dd>{displayName(session)}</dd>
            </div>
            {session.jobTitle && (
              <div>
                <dt>Title</dt>
                <dd>{session.jobTitle}</dd>
              </div>
            )}
            <div>
              <dt>Email</dt>
              <dd className="data">{session.email}</dd>
            </div>
            <div>
              <dt>Access</dt>
              <dd className={styles.badges}>
                {groupLabels.length === 0 ? (
                  <Badge tone="warning">No groups</Badge>
                ) : (
                  groupLabels.map((label) => (
                    <Badge key={label} tone="neutral">
                      {label}
                    </Badge>
                  ))
                )}
              </dd>
            </div>
          </dl>
          <p className={styles.note}>
            Something wrong here? Ask an administrator — these fields are not
            self-editable, because they appear beside your actions in the audit log.
          </p>
        </Card>

        <Card>
          <h2 className={styles.cardTitle}>Change your password</h2>
          <ChangePasswordForm />
        </Card>
      </div>
    </>
  );
}

function ChangePasswordForm() {
  const currentId = useId();
  const nextId = useId();
  const confirmId = useId();

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const check = checkPassword(next);
  const mismatch = touched && confirm !== "" && confirm !== next;
  const sameAsOld = next !== "" && next === current;
  const canSubmit =
    current !== "" && check.ok && next === confirm && !sameAsOld && !busy;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await changeOwnPassword(current, next);
      setDone(true);
      setCurrent("");
      setNext("");
      setConfirm("");
      setTouched(false);
      // Recorded server-side from the verified JWT; only the fact is sent.
      await recordDataAccess({ action: "PASSWORD_CHANGED", outcome: "SUCCESS" });
    } catch (caught) {
      setError(
        caught instanceof AuthError
          ? caught.message
          : "Your password could not be changed. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) void submit();
      }}
    >
      {done && (
        <Message tone="success">
          Your password has been changed. You stay signed in on this device, and
          your authenticator app is unaffected.
        </Message>
      )}
      {error && <Message tone="error">{error}</Message>}

      <Field label="Current password" htmlFor={currentId}>
        <TextInput
          id={currentId}
          type="password"
          autoComplete="current-password"
          required
          value={current}
          onChange={(event) => {
            setCurrent(event.target.value);
            setDone(false);
          }}
          disabled={busy}
        />
      </Field>

      <Field
        label="New password"
        htmlFor={nextId}
        error={
          touched && next !== "" && !check.ok
            ? `Must include ${check.failures.join(", ")}.`
            : sameAsOld
              ? "Choose a password different from your current one."
              : null
        }
      >
        <TextInput
          id={nextId}
          type="password"
          autoComplete="new-password"
          required
          value={next}
          invalid={(touched && next !== "" && !check.ok) || sameAsOld}
          onChange={(event) => setNext(event.target.value)}
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
        label="Confirm new password"
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

      <div>
        <Button type="submit" variant="primary" busy={busy} disabled={!canSubmit}>
          Change password
        </Button>
      </div>
    </form>
  );
}
