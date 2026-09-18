"use client";

import { useState } from "react";

import { activeClient } from "@config/index";
import type { AccessMode } from "@config/types";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Message,
  Select,
} from "@/components/ui";
import {
  AdminOperationError,
  listGroups,
  setGroupAccess,
  type GroupAccessView,
} from "@/lib/admin";
import { pluralise } from "@/lib/format";
import { useAsyncData } from "@/lib/useAsyncData";

import styles from "../Admin.module.css";

/** `null` means "no access to this bucket at all". */
type Draft = Record<string, AccessMode | null>;

export default function GroupsPage() {
  const {
    data: groups,
    loading,
    error: loadError,
    reload: load,
  } = useAsyncData<GroupAccessView[]>(() => listGroups(), []);

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [savingGroup, setSavingGroup] = useState<string | null>(null);

  /**
   * Only the groups an admin has actually touched.
   *
   * Holding edits as overrides rather than copying the whole list into state
   * means a freshly loaded group is always shown as the server reports it,
   * with no effect needed to re-seed drafts — and no window where the form
   * shows stale values from the previous load.
   */
  const [overrides, setOverrides] = useState<Record<string, Draft>>({});

  const draftFor = (group: GroupAccessView): Draft =>
    overrides[group.id] ?? toDraft(group);

  const discard = (groupId: string) =>
    setOverrides((current) => {
      const next = { ...current };
      delete next[groupId];
      return next;
    });

  async function save(group: GroupAccessView) {
    const draft = draftFor(group);

    const access = activeClient.buckets
      .filter((bucket) => draft[bucket.id] !== null && draft[bucket.id] !== undefined)
      .map((bucket) => ({ bucketId: bucket.id, mode: draft[bucket.id]! }));

    setSavingGroup(group.id);
    setError(null);
    setNotice(null);
    try {
      await setGroupAccess(group.id, access);
      discard(group.id);
      setNotice(
        `Access for ${group.label} was updated. Members receive the new access ` +
          `on their next request.`,
      );
      await load();
    } catch (caught) {
      setError(
        caught instanceof AdminOperationError
          ? caught.message
          : "The group's access could not be updated.",
      );
    } finally {
      setSavingGroup(null);
    }
  }

  return (
    <>
      <header className={styles.header}>
        <div className={styles.headerText}>
          <h1 className={styles.title}>Groups</h1>
          <p className={styles.intro}>
            Each group maps to an IAM role whose policy is generated from the
            access below — so what this screen shows is what the infrastructure
            actually enforces. No group can be granted the ability to delete or
            overwrite anything, at any access level.
          </p>
        </div>
      </header>

      {loadError != null && (
        <Message tone="error">
          {loadError instanceof AdminOperationError
            ? loadError.message
            : "The group list could not be loaded."}
        </Message>
      )}
      {error && <Message tone="error">{error}</Message>}
      {notice && <Message tone="success">{notice}</Message>}

      <div style={{ marginTop: "var(--space-4)" }} className={styles.groupGrid}>
        {loading ? (
          <Card>
            <EmptyState title="Loading groups…" />
          </Card>
        ) : groups.length === 0 ? (
          <Card>
            <EmptyState title="No groups configured" />
          </Card>
        ) : (
          groups.map((group) => {
            const draft = draftFor(group);
            const dirty = isDirty(group, draft);

            return (
              <Card
                key={group.id}
                title={
                  <span
                    style={{
                      display: "inline-flex",
                      gap: "var(--space-2)",
                      alignItems: "center",
                      flexWrap: "wrap",
                    }}
                  >
                    {group.label}
                    {group.isAdmin && <Badge tone="primary">Administrator</Badge>}
                    {group.divergedFromConfig && (
                      <Badge tone="warning">Changed since deploy</Badge>
                    )}
                  </span>
                }
                description={group.description}
                actions={
                  <Badge tone="neutral">
                    {pluralise(group.memberCount, "member")}
                  </Badge>
                }
              >
                {group.isAdmin && (
                  <Message tone="info">
                    The administrator group must keep access to every bucket, so
                    it cannot be narrowed here. Change it in the client config if
                    that is genuinely intended.
                  </Message>
                )}

                <div style={{ marginTop: "var(--space-3)" }}>
                  {activeClient.buckets.map((bucket) => (
                    <div key={bucket.id} className={styles.accessRow}>
                      <div className={styles.accessBucket}>
                        <div className={styles.accessBucketLabel}>
                          {bucket.label}
                          {bucket.sensitivity === "sensitive" && (
                            <>
                              {" "}
                              <Badge tone="warning">Sensitive</Badge>
                            </>
                          )}
                        </div>
                        <div className={styles.accessBucketName}>
                          {bucket.bucketName}
                        </div>
                      </div>
                      <div className={styles.accessControl}>
                        <Select
                          aria-label={`${group.label} access to ${bucket.label}`}
                          value={draft[bucket.id] ?? "none"}
                          disabled={group.isAdmin || savingGroup === group.id}
                          onChange={(event) =>
                            setOverrides((current) => ({
                              ...current,
                              [group.id]: {
                                ...(current[group.id] ?? toDraft(group)),
                                [bucket.id]:
                                  event.target.value === "none"
                                    ? null
                                    : (event.target.value as AccessMode),
                              },
                            }))
                          }
                        >
                          <option value="none">No access</option>
                          <option value="read">Read only</option>
                          <option value="read-upload">Read &amp; upload</option>
                        </Select>
                      </div>
                    </div>
                  ))}
                </div>

                {!group.isAdmin && (
                  <div className={styles.groupFooter}>
                    <span className="muted" style={{ fontSize: "0.8125rem" }}>
                      {dirty
                        ? "Unsaved changes."
                        : "Upload never includes delete or overwrite."}
                    </span>
                    <div style={{ display: "flex", gap: "var(--space-2)" }}>
                      <Button
                        small
                        variant="ghost"
                        disabled={!dirty || savingGroup === group.id}
                        onClick={() => discard(group.id)}
                      >
                        Discard
                      </Button>
                      <Button
                        small
                        variant="primary"
                        busy={savingGroup === group.id}
                        disabled={!dirty}
                        onClick={() => void save(group)}
                      >
                        Save access
                      </Button>
                    </div>
                  </div>
                )}
              </Card>
            );
          })
        )}
      </div>

      <div style={{ marginTop: "var(--space-5)" }}>
        <Message tone="info">
          Creating a new group requires a change to the client config and a
          redeploy: a new group needs a new IAM role, and granting this portal
          permission to create roles would let it widen its own access. Moving
          users between groups, and editing the access above, are immediate.
        </Message>
      </div>
    </>
  );
}

function toDraft(group: GroupAccessView): Draft {
  const draft: Draft = {};
  for (const bucket of activeClient.buckets) {
    draft[bucket.id] =
      group.access.find((entry) => entry.bucketId === bucket.id)?.mode ?? null;
  }
  return draft;
}

function isDirty(group: GroupAccessView, draft: Draft): boolean {
  const original = toDraft(group);
  return activeClient.buckets.some(
    (bucket) => original[bucket.id] !== draft[bucket.id],
  );
}
