"use client";

import type { ReactNode } from "react";

import { Message } from "@/components/ui";
import { useSession } from "@/lib/auth/SessionProvider";

/**
 * Guards the admin section in the UI.
 *
 * Not the security boundary — the `manageUsers` and `manageGroups` mutations
 * are bound to the admin group in AppSync, and their handlers re-check the
 * caller's groups and record a denied attempt. This just means a non-admin who
 * types the URL gets an explanation instead of a screen of failing requests.
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  const { session, status } = useSession();

  if (status === "loading") return null;

  if (session && !session.isAdmin) {
    return (
      <Message tone="warning">
        This section is limited to administrators. If you believe you should have
        access, ask an existing administrator to add you to the administrator
        group.
      </Message>
    );
  }

  return <>{children}</>;
}
