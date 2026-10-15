"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { activeClient } from "@config/index";
import { useSession } from "@/lib/auth/SessionProvider";

import styles from "./AppHeader.module.css";
import { UserMenu } from "./UserMenu";

/**
 * Header navigation. There is no sidebar in this app, by design.
 *
 * The identity block is the client's alone — logo, or display name as text when
 * no logo has been supplied. Nuaig appears only in the footer, so it is always
 * clear whose data is on screen.
 */
export function AppHeader() {
  const pathname = usePathname();
  const { canManageUsers, canManageGroups, canViewAudit } = useSession();

  // Built per capability rather than per tier, so Groups disappears for a user
  // administrator while Users and the audit log stay.
  const links = [
    { href: "/buckets", label: "Buckets" },
    ...(canManageUsers ? [{ href: "/admin/users", label: "Users" }] : []),
    ...(canManageGroups ? [{ href: "/admin/groups", label: "Groups" }] : []),
    ...(canViewAudit ? [{ href: "/admin/audit", label: "Audit log" }] : []),
  ];

  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <Link href="/buckets" className={styles.identity}>
          {activeClient.logo ? (
            <Image
              src={activeClient.logo}
              alt={activeClient.displayName}
              width={200}
              height={48}
              className={styles.clientLogo}
              priority
            />
          ) : (
            <span className={styles.clientName}>{activeClient.displayName}</span>
          )}
        </Link>

        <nav className={styles.nav} aria-label="Primary">
          {links.map((link) => {
            const active =
              pathname === link.href || pathname.startsWith(`${link.href}/`);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`${styles.navLink} ${active ? styles.navLinkActive : ""}`}
                aria-current={active ? "page" : undefined}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <UserMenu />
      </div>
    </header>
  );
}
