"use client";

import Link from "next/link";

import { activeClient } from "@config/index";
import { describeMode } from "@config/access";
import { Badge, EmptyState } from "@/components/ui";
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
        <div className={styles.grid}>
          {buckets.map(({ bucket, mode, viaGroups }) => (
            <Link
              key={bucket.id}
              href={`/buckets/${bucket.id}`}
              className={styles.bucketCard}
            >
              <div className={styles.bucketTop}>
                <span className={styles.bucketLabel}>{bucket.label}</span>
                {bucket.sensitivity === "sensitive" && (
                  <Badge tone="warning">Sensitive</Badge>
                )}
              </div>

              <p className={styles.bucketDescription}>{bucket.description}</p>

              <div className={styles.bucketMeta}>
                <Badge tone={mode === "read-upload" ? "primary" : "neutral"}>
                  {describeMode(mode)}
                </Badge>
                <span className={styles.bucketName} title="S3 bucket">
                  {bucket.bucketName}
                </span>
              </div>

              <span className="muted" style={{ fontSize: "0.75rem" }}>
                {viaGroups.length === 1
                  ? `Via your ${groupLabel(viaGroups[0])} membership`
                  : `Via ${viaGroups.map(groupLabel).join(" and ")}`}
              </span>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

function groupLabel(groupId: string): string {
  return activeClient.groups.find((group) => group.id === groupId)?.label ?? groupId;
}
