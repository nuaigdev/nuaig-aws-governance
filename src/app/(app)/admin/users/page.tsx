"use client";

import { useEffect, useId, useMemo, useState } from "react";

import { activeClient } from "@config/index";
import { describeMode, grantedBuckets } from "@config/access";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Message,
  Select,
  SortableHeader,
  Table,
  TableWrap,
  TextInput,
  type BadgeTone,
  type SortDirection,
} from "@/components/ui";
import {
  AdminOperationError,
  createUser,
  disableUser,
  enableUser,
  listUsers,
  resendInvite,
  resetUserPassword,
  setUserGroups,
  type PortalUser,
} from "@/lib/admin";
import { useSession } from "@/lib/auth/SessionProvider";
import { formatDateTime, formatRelative, pluralise } from "@/lib/format";
import { useAsyncData } from "@/lib/useAsyncData";

import styles from "../Admin.module.css";

type SortKey = "name" | "status" | "lastLoginAt";
type StatusFilter = "all" | "active" | "disabled" | "pending";

export default function UsersPage() {
  const { session } = useSession();
  const {
    data: users,
    loading,
    error: loadError,
    reload: load,
  } = useAsyncData<PortalUser[]>(() => listUsers(), []);

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [direction, setDirection] = useState<SortDirection>("asc");
  const [busyUser, setBusyUser] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<PortalUser | null>(null);
  const [resetting, setResetting] = useState<PortalUser | null>(null);

  async function run(username: string, action: () => Promise<unknown>, success: string) {
    setBusyUser(username);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(success);
      await load();
    } catch (caught) {
      setError(messageFor(caught, "That action could not be completed."));
    } finally {
      setBusyUser(null);
    }
  }

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return users
      .filter((user) => {
        if (statusFilter === "active" && (!user.enabled || isPending(user))) return false;
        if (statusFilter === "disabled" && user.enabled) return false;
        if (statusFilter === "pending" && !isPending(user)) return false;
        if (term === "") return true;
        return (
          user.email.toLowerCase().includes(term) ||
          `${user.givenName} ${user.familyName}`.toLowerCase().includes(term)
        );
      })
      .sort((a, b) => {
        const factor = direction === "asc" ? 1 : -1;
        switch (sortKey) {
          case "status":
            return (Number(b.enabled) - Number(a.enabled)) * factor;
          case "lastLoginAt":
            return (
              ((a.lastLoginAt ? Date.parse(a.lastLoginAt) : 0) -
                (b.lastLoginAt ? Date.parse(b.lastLoginAt) : 0)) *
              factor
            );
          default:
            return (
              `${a.givenName} ${a.familyName}`.localeCompare(
                `${b.givenName} ${b.familyName}`,
              ) * factor
            );
        }
      });
  }, [users, search, statusFilter, sortKey, direction]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) setDirection((v) => (v === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setDirection("asc");
    }
  }

  return (
    <>
      <header className={styles.header}>
        <div className={styles.headerText}>
          <h1 className={styles.title}>Users</h1>
          <p className={styles.intro}>
            Access is granted entirely by group membership. Offboarding disables
            an account and revokes its active sessions immediately — accounts are
            never deleted, so the audit log always resolves who did what.
          </p>
        </div>
        <Button variant="primary" onClick={() => setShowCreate(true)}>
          Create user
        </Button>
      </header>

      {loadError != null && (
        <Message tone="error">
          {messageFor(loadError, "The user list could not be loaded.")}
        </Message>
      )}
      {error && <Message tone="error">{error}</Message>}
      {notice && <Message tone="success">{notice}</Message>}

      <div className={styles.toolbar} style={{ marginTop: "var(--space-4)" }}>
        <div className={styles.search}>
          <TextInput
            type="search"
            placeholder="Search by name or email…"
            aria-label="Search users"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div className={styles.filter}>
          <Select
            aria-label="Filter by status"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="pending">Pending first sign-in</option>
            <option value="disabled">Disabled</option>
          </Select>
        </div>
        <span className={styles.count}>
          {loading ? "Loading…" : pluralise(visible.length, "user")}
        </span>
      </div>

      <Card flush>
        {loading ? (
          <EmptyState title="Loading users…" />
        ) : visible.length === 0 ? (
          <EmptyState title="No users match">
            Adjust the search or filter, or create a user.
          </EmptyState>
        ) : (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <SortableHeader
                    columnKey="name"
                    label="User"
                    activeKey={sortKey}
                    direction={direction}
                    onSort={toggleSort}
                  />
                  <th scope="col">Groups</th>
                  <SortableHeader
                    columnKey="status"
                    label="Status"
                    activeKey={sortKey}
                    direction={direction}
                    onSort={toggleSort}
                  />
                  <SortableHeader
                    columnKey="lastLoginAt"
                    label="Last login"
                    activeKey={sortKey}
                    direction={direction}
                    onSort={toggleSort}
                    numeric
                  />
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((user) => {
                  const isSelf = user.sub === session?.sub;
                  return (
                    <tr key={user.username}>
                      <td>
                        <div className={styles.userCell}>
                          <div className={styles.userName}>
                            {`${user.givenName} ${user.familyName}`.trim() || "—"}
                            {isSelf && (
                              <>
                                {" "}
                                <Badge tone="neutral">You</Badge>
                              </>
                            )}
                          </div>
                          <div className={styles.userEmail}>{user.email}</div>
                        </div>
                      </td>
                      <td>
                        <div className={styles.badges}>
                          {user.groups.length === 0 ? (
                            <Badge tone="warning">None</Badge>
                          ) : (
                            user.groups.map((groupId) => (
                              <Badge
                                key={groupId}
                                tone={isAdminGroup(groupId) ? "primary" : "neutral"}
                              >
                                {groupLabel(groupId)}
                              </Badge>
                            ))
                          )}
                        </div>
                      </td>
                      <td>
                        <Badge tone={statusTone(user)}>{statusLabel(user)}</Badge>
                      </td>
                      <td className="data" style={{ textAlign: "right" }}>
                        <span title={formatDateTime(user.lastLoginAt)}>
                          {formatRelative(user.lastLoginAt)}
                        </span>
                      </td>
                      <td>
                        <div className={styles.rowActions}>
                          <Button
                            small
                            onClick={() => setEditing(user)}
                            disabled={busyUser === user.username}
                          >
                            Groups
                          </Button>
                          {isPending(user) && (
                            <Button
                              small
                              variant="ghost"
                              busy={busyUser === user.username}
                              onClick={() =>
                                void run(
                                  user.username,
                                  () => resendInvite(user.username),
                                  `Invitation resent to ${user.email}.`,
                                )
                              }
                            >
                              Resend invite
                            </Button>
                          )}
                          {user.enabled && !isPending(user) && (
                            <Button
                              small
                              variant="ghost"
                              disabled={busyUser === user.username}
                              onClick={() => setResetting(user)}
                            >
                              Reset password
                            </Button>
                          )}
                          {user.enabled ? (
                            <Button
                              small
                              variant="danger"
                              busy={busyUser === user.username}
                              onClick={() =>
                                void run(
                                  user.username,
                                  () => disableUser(user.username),
                                  `${user.email} was disabled and their sessions revoked.`,
                                )
                              }
                            >
                              Disable
                            </Button>
                          ) : (
                            <Button
                              small
                              busy={busyUser === user.username}
                              onClick={() =>
                                void run(
                                  user.username,
                                  () => enableUser(user.username),
                                  `${user.email} was re-enabled.`,
                                )
                              }
                            >
                              Re-enable
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </Card>

      {showCreate && (
        <CreateUserDialog
          onClose={() => setShowCreate(false)}
          onCreated={async (email) => {
            setShowCreate(false);
            setNotice(`${email} was created and an invitation email was sent.`);
            await load();
          }}
        />
      )}

      {resetting && (
        <Dialog
          title={`Reset password for ${resetting.email}?`}
          onClose={() => setResetting(null)}
          busy={false}
          confirmLabel="Reset password"
          canConfirm
          onConfirm={async () => {
            const target = resetting;
            setResetting(null);
            await run(
              target.username,
              () => resetUserPassword(target.username),
              `A password reset code was emailed to ${target.email}. They will choose a new password the next time they sign in.`,
            );
          }}
        >
          <p style={{ fontSize: "0.9375rem" }}>
            We will email {resetting.givenName || "the user"} a one-time code and
            sign them out of every device. You never see or set their password,
            and their two-factor authentication is unchanged.
          </p>
        </Dialog>
      )}

      {editing && (
        <EditGroupsDialog
          user={editing}
          onClose={() => setEditing(null)}
          onSaved={async (email) => {
            setEditing(null);
            setNotice(`Group membership updated for ${email}.`);
            await load();
          }}
        />
      )}
    </>
  );
}

/* -------------------------------------------------------------- Dialogs -- */

type CreateStep = "details" | "access" | "review";

const CREATE_STEPS: readonly { id: CreateStep; label: string }[] = [
  { id: "details", label: "Details" },
  { id: "access", label: "Access" },
  { id: "review", label: "Review" },
];

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** What a group lets its members do, in words an administrator can check. */
function describeGroupAccess(groupId: string): string[] {
  const group = activeClient.groups.find((candidate) => candidate.id === groupId);
  if (!group) return [];
  return grantedBuckets(activeClient, group).map(
    ({ bucket, mode }) => `${bucket.label}: ${describeMode(mode)}`,
  );
}

function CreateUserDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (email: string) => void | Promise<void>;
}) {
  const emailId = useId();
  const givenId = useId();
  const familyId = useId();

  const [step, setStep] = useState<CreateStep>("details");
  const [email, setEmail] = useState("");
  const [givenName, setGivenName] = useState("");
  const [familyName, setFamilyName] = useState("");
  const [groups, setGroups] = useState<string[]>([]);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const emailValid = EMAIL_PATTERN.test(email.trim());
  const emailInvalid = touched && email.trim() !== "" && !emailValid;
  const detailsValid = emailValid && givenName.trim() !== "" && familyName.trim() !== "";

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await createUser({ email, givenName, familyName, groups });
      await onCreated(email.trim().toLowerCase());
    } catch (caught) {
      setError(messageFor(caught, "The user could not be created."));
    } finally {
      setBusy(false);
    }
  }

  const index = CREATE_STEPS.findIndex((candidate) => candidate.id === step);

  return (
    <Dialog
      title="Create user"
      onClose={onClose}
      busy={busy}
      confirmLabel={step === "review" ? "Create and send invitation" : "Continue"}
      canConfirm={
        !busy && (step === "details" ? detailsValid : step === "access" ? groups.length > 0 : true)
      }
      onBack={step === "details" ? undefined : () => setStep(CREATE_STEPS[index - 1].id)}
      onConfirm={() => {
        if (step === "review") return submit();
        setStep(CREATE_STEPS[index + 1].id);
      }}
    >
      <ol className={styles.stepper} aria-label="Progress">
        {CREATE_STEPS.map((candidate, position) => (
          <li
            key={candidate.id}
            className={`${styles.stepperItem} ${position === index ? styles.stepperCurrent : ""} ${position < index ? styles.stepperDone : ""}`}
            aria-current={position === index ? "step" : undefined}
          >
            <span className={styles.stepperNumber}>{position + 1}</span>
            {candidate.label}
          </li>
        ))}
      </ol>

      {error && <Message tone="error">{error}</Message>}

      {step === "details" && (
        <>
          <Field
            label="Email address"
            htmlFor={emailId}
            hint="The invitation is sent here, and it becomes their sign-in name."
            error={emailInvalid ? "Enter a valid email address." : null}
          >
            <TextInput
              id={emailId}
              type="email"
              required
              autoFocus
              value={email}
              invalid={emailInvalid}
              onChange={(event) => setEmail(event.target.value)}
              onBlur={() => setTouched(true)}
              disabled={busy}
            />
          </Field>

          <Field label="First name" htmlFor={givenId}>
            <TextInput
              id={givenId}
              required
              value={givenName}
              onChange={(event) => setGivenName(event.target.value)}
              disabled={busy}
            />
          </Field>

          <Field label="Last name" htmlFor={familyId}>
            <TextInput
              id={familyId}
              required
              value={familyName}
              onChange={(event) => setFamilyName(event.target.value)}
              disabled={busy}
            />
          </Field>
        </>
      )}

      {step === "access" && (
        <GroupPicker
          selected={groups}
          onChange={setGroups}
          disabled={busy}
          hint="Choose at least one group. Membership is the only way access is granted."
        />
      )}

      {step === "review" && (
        <div className={styles.review}>
          <dl className={styles.reviewList}>
            <div>
              <dt>Name</dt>
              <dd>{`${givenName.trim()} ${familyName.trim()}`}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd className="data">{email.trim().toLowerCase()}</dd>
            </div>
            <div>
              <dt>Groups</dt>
              <dd>
                {groups.map((groupId) => (
                  <div key={groupId} className={styles.reviewGroup}>
                    <strong>{groupLabel(groupId)}</strong>
                    <ul>
                      {describeGroupAccess(groupId).map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </dd>
            </div>
          </dl>
          <p className="muted" style={{ fontSize: "0.875rem" }}>
            An invitation with a temporary password (valid for 3 days) will be
            emailed to this address. On first sign-in they set their own password
            and enrol in two-factor authentication.
          </p>
        </div>
      )}
    </Dialog>
  );
}

function EditGroupsDialog({
  user,
  onClose,
  onSaved,
}: {
  user: PortalUser;
  onClose: () => void;
  onSaved: (email: string) => void | Promise<void>;
}) {
  const [groups, setGroups] = useState<string[]>([...user.groups]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const changed =
    groups.length !== user.groups.length ||
    groups.some((group) => !user.groups.includes(group));

  const losesGroups = user.groups.some((group) => !groups.includes(group));

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await setUserGroups(user.username, groups);
      await onSaved(user.email);
    } catch (caught) {
      setError(messageFor(caught, "Group membership could not be updated."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={`Groups for ${user.email}`}
      onClose={onClose}
      busy={busy}
      confirmLabel="Save groups"
      canConfirm={changed && groups.length > 0 && !busy}
      onConfirm={submit}
    >
      {error && <Message tone="error">{error}</Message>}

      <GroupPicker selected={groups} onChange={setGroups} disabled={busy} />

      {losesGroups && (
        <Message tone="warning">
          Removing a group signs this user out of all devices, so the narrower
          access applies immediately rather than when their token expires.
        </Message>
      )}
    </Dialog>
  );
}

function GroupPicker({
  selected,
  onChange,
  disabled,
  hint,
}: {
  selected: readonly string[];
  onChange: (groups: string[]) => void;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <div>
      <p className={styles.checkboxHint} style={{ marginBottom: "var(--space-2)" }}>
        {hint ?? "A user may belong to several groups; access is the union of them."}
      </p>
      <div className={styles.checkboxList}>
        {activeClient.groups.map((group) => (
          <label key={group.id} className={styles.checkboxRow}>
            <input
              type="checkbox"
              checked={selected.includes(group.id)}
              disabled={disabled}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...selected, group.id]
                    : selected.filter((id) => id !== group.id),
                )
              }
            />
            <span className={styles.checkboxText}>
              <span>{group.label}</span>
              {group.isAdmin && (
                <>
                  {" "}
                  <Badge tone="primary">Administrator</Badge>
                </>
              )}
              <span className={styles.checkboxHint} style={{ display: "block" }}>
                {group.description}
              </span>
              {describeGroupAccess(group.id).map((line) => (
                <span
                  key={line}
                  className={`${styles.checkboxHint} data`}
                  style={{ display: "block" }}
                >
                  {line}
                </span>
              ))}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

/** Minimal modal built on the native dialog element, so focus trapping is free. */
function Dialog({
  title,
  children,
  onClose,
  onConfirm,
  onBack,
  confirmLabel,
  canConfirm,
  busy,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  /** Shows a Back button before Cancel, for the multi-step create flow. */
  onBack?: () => void;
  confirmLabel: string;
  canConfirm: boolean;
  busy: boolean;
}) {
  const [element, setElement] = useState<HTMLDialogElement | null>(null);

  useEffect(() => {
    if (element && !element.open) element.showModal();
  }, [element]);

  return (
    <dialog
      ref={setElement}
      className="dialogSurface"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <header className="dialogHeader">
        <h2>{title}</h2>
      </header>
      <div className="dialogBody">{children}</div>
      <footer className="dialogFooter">
        {onBack && (
          <Button variant="ghost" onClick={onBack} disabled={busy}>
            Back
          </Button>
        )}
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="primary"
          busy={busy}
          disabled={!canConfirm}
          onClick={() => void onConfirm()}
        >
          {confirmLabel}
        </Button>
      </footer>
    </dialog>
  );
}

/* --------------------------------------------------------------- Helpers -- */

function isPending(user: PortalUser): boolean {
  return user.status === "FORCE_CHANGE_PASSWORD";
}

function statusLabel(user: PortalUser): string {
  if (!user.enabled) return "Disabled";
  if (isPending(user)) return "Pending first sign-in";
  if (user.status === "RESET_REQUIRED") return "Password reset required";
  return "Active";
}

function statusTone(user: PortalUser): BadgeTone {
  if (!user.enabled) return "error";
  if (isPending(user) || user.status === "RESET_REQUIRED") return "warning";
  return "success";
}

function groupLabel(groupId: string): string {
  return activeClient.groups.find((group) => group.id === groupId)?.label ?? groupId;
}

function isAdminGroup(groupId: string): boolean {
  return activeClient.groups.find((group) => group.id === groupId)?.isAdmin === true;
}

function messageFor(error: unknown, fallback: string): string {
  return error instanceof AdminOperationError ? error.message : fallback;
}
