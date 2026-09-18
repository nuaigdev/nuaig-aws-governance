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
 * The identity block reads "Nuaig | <client>" so it is always clear whose data
 * is on screen — the portal hosts a different client per deployment, and a
 * screenshot with no client name in it is ambiguous.
 */
export function AppHeader() {
  const pathname = usePathname();
  const { isAdmin } = useSession();

  const links = [
    { href: "/buckets", label: "Buckets" },
    ...(isAdmin
      ? [
          { href: "/admin/users", label: "Users" },
          { href: "/admin/groups", label: "Groups" },
          { href: "/admin/audit", label: "Audit log" },
        ]
      : []),
  ];

  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <Link href="/buckets" className={styles.identity}>
          <Image
            src="/branding/nuaig-logo.svg"
            alt="Nuaig"
            width={130}
            height={54}
            className={styles.logo}
            priority
          />
          <span className={styles.divider} aria-hidden="true" />
          {activeClient.logo ? (
            <Image
              src={activeClient.logo}
              alt={activeClient.displayName}
              width={160}
              height={40}
              className={styles.clientLogo}
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
