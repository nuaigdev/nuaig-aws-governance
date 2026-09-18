"use client";

import { useEffect, useRef, useState } from "react";

import { activeClient } from "@config/index";
import { Badge } from "@/components/ui";
import { useSession } from "@/lib/auth/SessionProvider";
import { displayName, initials } from "@/lib/auth/session";

import styles from "./UserMenu.module.css";

export function UserMenu() {
  const { session, signOut } = useSession();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close on outside click and on Escape — a menu that traps the user is worse
  // than no menu.
  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (!session) return null;

  const groupLabels = session.groups.map(
    (id) => activeClient.groups.find((g) => g.id === id)?.label ?? id,
  );

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        type="button"
        className={styles.trigger}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <span className={styles.avatar} aria-hidden="true">
          {initials(session)}
        </span>
        <span className={styles.name}>{displayName(session)}</span>
        <span className={styles.chevron} aria-hidden="true">
          ▼
        </span>
      </button>

      {open && (
        <div className={styles.menu} role="menu">
          <div className={styles.identity}>
            <div className={styles.identityName}>{displayName(session)}</div>
            <div className={styles.identityEmail}>{session.email}</div>
            <div className={styles.groups}>
              {groupLabels.length > 0 ? (
                groupLabels.map((label) => (
                  <Badge key={label} tone={session.isAdmin ? "primary" : "neutral"}>
                    {label}
                  </Badge>
                ))
              ) : (
                <Badge tone="warning">No groups assigned</Badge>
              )}
            </div>
          </div>

          <button
            type="button"
            className={styles.item}
            role="menuitem"
            onClick={() => void signOut()}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
