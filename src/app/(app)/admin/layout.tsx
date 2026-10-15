"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

import { Message } from "@/components/ui";
import { useSession } from "@/lib/auth/SessionProvider";

/**
 * Guards the admin section in the UI.
 *
 * Not the security boundary — `manageUsers` and `manageGroups` are bound to
 * their permitted groups in AppSync, and the handlers re-check the caller and
 * record a denied attempt. This just means someone who types the URL gets an
 * explanation instead of a screen of failing requests.
 *
 * Checked per route rather than for the section as a whole, because the two
 * administrative tiers divide exactly here: a user administrator reaches Users
 * and the audit log, and must not reach Groups.
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  const { session, status, canManageUsers, canManageGroups, canViewAudit } =
    useSession();
  const pathname = usePathname();

  if (status === "loading" || !session) return null;

  const permitted = pathname.startsWith("/admin/groups")
    ? canManageGroups
    : pathname.startsWith("/admin/audit")
      ? canViewAudit
      : canManageUsers;

  if (!permitted) {
    return (
      <Message tone="warning">
        {pathname.startsWith("/admin/groups")
          ? "Group access is managed by Nuaig. If a group needs to reach a different bucket, ask them to change it."
          : "This section is limited to administrators. If you believe you should have access, ask an administrator to add you to the right group."}
      </Message>
    );
  }

  return <>{children}</>;
}
