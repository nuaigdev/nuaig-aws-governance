"use client";

import { useMemo, useState } from "react";

import { activeClient } from "@config/index";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Message,
  Select,
  Table,
  TableWrap,
  TextInput,
  type BadgeTone,
} from "@/components/ui";
import { getDataClient } from "@/lib/amplify/client";
import { formatDateTime, pluralise } from "@/lib/format";
import { useAsyncData } from "@/lib/useAsyncData";

import styles from "../Admin.module.css";

interface AuditRow {
  readonly id: string;
  readonly actorEmail: string;
  readonly action: string;
  readonly outcome: string;
  readonly bucketId: string | null;
  readonly objectKey: string | null;
  readonly targetUser: string | null;
  readonly occurredAt: string;
  readonly sourceIp: string | null;
  readonly detail: string | null;
}

const PAGE_SIZE = 50;

interface AuditPage {
  readonly rows: AuditRow[];
  readonly nextToken: string | null;
}

/** One page of audit events, newest first. */
async function fetchPage(token?: string): Promise<AuditPage> {
  const client = getDataClient();
  const result = await client.models.AuditEvent.auditEventsByTime(
    { clientId: activeClient.clientId },
    {
      // Newest first: an audit screen is almost always read from the top.
      sortDirection: "DESC",
      limit: PAGE_SIZE,
      nextToken: token,
    },
  );

  if (result.errors?.length) {
    throw new Error(result.errors[0].message);
  }

  return {
    rows: (result.data ?? []) as unknown as AuditRow[],
    nextToken: result.nextToken ?? null,
  };
}

/** Groups the actions into the categories an admin actually filters by. */
const ACTION_GROUPS: Record<string, readonly string[]> = {
  "Sign-in": ["LOGIN", "LOGIN_FAILED", "LOGOUT"],
  "File access": [
    "FILE_LIST",
    "FILE_DOWNLOAD",
    "FILE_UPLOAD",
    "FILE_UPLOAD_REJECTED_COLLISION",
  ],
  Administration: [
    "USER_CREATED",
    "USER_DISABLED",
    "USER_REENABLED",
    "USER_GROUPS_CHANGED",
    "USER_INVITE_RESENT",
    "USER_PASSWORD_RESET",
    "GROUP_ACCESS_VIEWED",
    "GROUP_ACCESS_CHANGED",
  ],
  Refused: ["ACCESS_DENIED"],
};

export default function AuditPage() {
  /**
   * The first page is loaded by the hook; older pages are appended here.
   *
   * Splitting them keeps "load more" from re-running on every dependency
   * change, and keeps the newest-first ordering stable while paging back.
   */
  const {
    data: firstPage,
    loading,
    error: loadError,
    reload,
  } = useAsyncData(() => fetchPage(), { rows: [] as AuditRow[], nextToken: null as string | null });

  const [olderRows, setOlderRows] = useState<AuditRow[]>([]);
  const [olderToken, setOlderToken] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pagingError, setPagingError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [bucketFilter, setBucketFilter] = useState("all");

  const rows = useMemo(() => [...firstPage.rows, ...olderRows], [firstPage, olderRows]);
  const nextToken = olderRows.length > 0 ? olderToken : firstPage.nextToken;

  async function refresh() {
    // A refresh resets to the newest page; keeping stale older pages appended
    // below fresh ones would misrepresent the ordering.
    setOlderRows([]);
    setOlderToken(null);
    setPagingError(null);
    await reload();
  }

  async function loadMore() {
    if (!nextToken) return;
    setLoadingMore(true);
    setPagingError(null);
    try {
      const page = await fetchPage(nextToken);
      setOlderRows((current) => [...current, ...page.rows]);
      setOlderToken(page.nextToken);
    } catch {
      setPagingError("Older entries could not be loaded.");
    } finally {
      setLoadingMore(false);
    }
  }

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    const allowedActions =
      categoryFilter === "all" ? null : new Set(ACTION_GROUPS[categoryFilter] ?? []);

    return rows.filter((row) => {
      if (allowedActions && !allowedActions.has(row.action)) return false;
      if (bucketFilter !== "all" && row.bucketId !== bucketFilter) return false;
      if (term === "") return true;
      return (
        row.actorEmail.toLowerCase().includes(term) ||
        row.action.toLowerCase().includes(term) ||
        (row.objectKey ?? "").toLowerCase().includes(term) ||
        (row.targetUser ?? "").toLowerCase().includes(term)
      );
    });
  }, [rows, search, categoryFilter, bucketFilter]);

  return (
    <>
      <header className={styles.header}>
        <div className={styles.headerText}>
          <h1 className={styles.title}>Audit log</h1>
          <p className={styles.intro}>
            Every sign-in, file access and administrative action. Records are
            written server-side from the verified session and cannot be edited or
            deleted by anyone through this portal, including administrators.
          </p>
        </div>
        <Button onClick={() => void refresh()} disabled={loading}>
          Refresh
        </Button>
      </header>

      {loadError != null && (
        <Message tone="error">
          The audit log could not be loaded. If this continues, check that your
          account is in the administrator group.
        </Message>
      )}
      {pagingError && <Message tone="error">{pagingError}</Message>}

      <div className={styles.toolbar} style={{ marginTop: "var(--space-4)" }}>
        <div className={styles.search}>
          <TextInput
            type="search"
            placeholder="Search by user, action or file…"
            aria-label="Search the audit log"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div className={styles.filter}>
          <Select
            aria-label="Filter by category"
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value)}
          >
            <option value="all">All activity</option>
            {Object.keys(ACTION_GROUPS).map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </Select>
        </div>
        <div className={styles.filter}>
          <Select
            aria-label="Filter by bucket"
            value={bucketFilter}
            onChange={(event) => setBucketFilter(event.target.value)}
          >
            <option value="all">All buckets</option>
            {activeClient.buckets.map((bucket) => (
              <option key={bucket.id} value={bucket.id}>
                {bucket.label}
              </option>
            ))}
          </Select>
        </div>
        <span className={styles.count}>
          {loading ? "Loading…" : pluralise(visible.length, "entry", "entries")}
        </span>
      </div>

      <Card flush>
        {loading ? (
          <EmptyState title="Loading the audit log…" />
        ) : visible.length === 0 ? (
          <EmptyState title={rows.length === 0 ? "No activity recorded yet" : "Nothing matches"}>
            {rows.length === 0
              ? "Entries appear here as soon as anyone signs in or opens a bucket."
              : "Adjust the search or filters to widen the view."}
          </EmptyState>
        ) : (
          <>
            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <th scope="col">When</th>
                    <th scope="col">Who</th>
                    <th scope="col">Action</th>
                    <th scope="col">Bucket</th>
                    <th scope="col">Object / target</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((row) => (
                    <tr key={row.id}>
                      <td className="data" style={{ whiteSpace: "nowrap" }}>
                        {formatDateTime(row.occurredAt)}
                      </td>
                      <td>
                        <div className={styles.userEmail}>{row.actorEmail}</div>
                        {row.sourceIp && (
                          <div className="data muted" style={{ fontSize: "0.6875rem" }}>
                            {row.sourceIp}
                          </div>
                        )}
                      </td>
                      <td>
                        <Badge tone={outcomeTone(row.outcome)}>
                          {humanAction(row.action)}
                        </Badge>
                      </td>
                      <td>{bucketLabel(row.bucketId)}</td>
                      <td className={styles.detailCell} title={row.objectKey ?? row.targetUser ?? ""}>
                        {row.objectKey ?? row.targetUser ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>

            {nextToken && (
              <div className={styles.loadMore}>
                <Button busy={loadingMore} onClick={() => void loadMore()}>
                  Load older entries
                </Button>
              </div>
            )}
          </>
        )}
      </Card>
    </>
  );
}

function outcomeTone(outcome: string): BadgeTone {
  switch (outcome) {
    case "DENIED":
      return "warning";
    case "ERROR":
      return "error";
    default:
      return "neutral";
  }
}

function bucketLabel(bucketId: string | null): string {
  if (!bucketId) return "—";
  return activeClient.buckets.find((bucket) => bucket.id === bucketId)?.label ?? bucketId;
}

/** `FILE_DOWNLOAD` → `File download`. Keeps the log readable without a legend. */
function humanAction(action: string): string {
  const lower = action.toLowerCase().replace(/_/g, " ");
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}
