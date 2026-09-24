"use client";

import Link from "next/link";

import { activeClient } from "@config/index";
import { describeMode } from "@config/access";
import { Badge, Card, EmptyState, Table, TableWrap } from "@/components/ui";
import { useSession } from "@/lib/auth/SessionProvider";

import styles from "./Buckets.module.css";

export default function BucketsPage() {
  const { session } = useSession();
  if (!session) return null;

  const { buckets } = session;

  return (
    <>
      <header className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Buckets</h1>
        <p className={styles.pageIntro}>
          {buckets.length > 0
            ? `You have access to ${buckets.length === 1 ? "one bucket" : `${buckets.length} buckets`} through your group membership.`
            : "Your groups do not currently grant access to any bucket."}
        </p>
      </header>

      {buckets.length === 0 ? (
        <EmptyState title="No buckets available to you">
          Access is granted by group membership. Ask an administrator to add you
          to a group that covers the data you need.
        </EmptyState>
      ) : (
        <Card flush>
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <th scope="col">Bucket</th>
                  <th scope="col">Access</th>
                  <th scope="col">Data</th>
                  <th scope="col">Through</th>
                </tr>
              </thead>
              <tbody>
                {buckets.map(({ bucket, mode, viaGroups }) => (
                  <tr key={bucket.id}>
                    <td>
                      <Link href={`/buckets/${bucket.id}`} className={styles.bucketLink}>
                        {bucket.label}
                      </Link>
                      <div className={styles.bucketDescription}>{bucket.description}</div>
                    </td>
                    <td>
                      <Badge tone={mode === "read-upload" ? "primary" : "neutral"}>
                        {describeMode(mode)}
                      </Badge>
                    </td>
                    <td>
                      {bucket.sensitivity === "sensitive" ? (
                        <Badge tone="warning">Sensitive</Badge>
                      ) : (
                        <span className="muted">Standard</span>
                      )}
                    </td>
                    <td className="muted">{viaGroups.map(groupLabel).join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        </Card>
      )}
    </>
  );
}

function groupLabel(groupId: string): string {
  return activeClient.groups.find((group) => group.id === groupId)?.label ?? groupId;
}
