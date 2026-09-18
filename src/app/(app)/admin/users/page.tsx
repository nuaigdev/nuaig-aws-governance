"use client";

import { useEffect, useId, useMemo, useState } from "react";

import { activeClient } from "@config/index";
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

  const [email, setEmail] = useState("");
  const [givenName, setGivenName] = useState("");
  const [familyName, setFamilyName] = useState("");
  const [groups, setGroups] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit =
    email.trim() !== "" &&
    givenName.trim() !== "" &&
    familyName.trim() !== "" &&
    groups.length > 0 &&
    !busy;

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

  return (
    <Dialog
      title="Create user"
      onClose={onClose}
      busy={busy}
      confirmLabel="Create and send invitation"
      canConfirm={canSubmit}
      onConfirm={submit}
    >
      {error && <Message tone="error">{error}</Message>}

      <p className="muted" style={{ fontSize: "0.875rem" }}>
        Cognito emails a temporary password valid for 3 days. On first sign-in
        they must set a password and enrol in two-factor authentication.
      </p>

      <Field label="Email address" htmlFor={emailId}>
        <TextInput
          id={emailId}
          type="email"
          required
          autoFocus
          value={email}
          onChange={(event) => setEmail(event.target.value)}
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

      <GroupPicker
        selected={groups}
        onChange={setGroups}
        disabled={busy}
        hint="A user must belong to at least one group — membership is the only way access is granted."
      />
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
  confirmLabel,
  canConfirm,
  busy,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
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
