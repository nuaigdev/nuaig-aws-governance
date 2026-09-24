"use client";

import { useRouter, usePathname } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { AppFooter } from "@/components/chrome/AppFooter";
import { AppHeader } from "@/components/chrome/AppHeader";
import { IdleSignOut } from "@/components/chrome/IdleSignOut";
import { Message } from "@/components/ui";
import { useSession } from "@/lib/auth/SessionProvider";

import styles from "./layout.module.css";

/**
 * Shell for every signed-in route: header, centred content, dark footer band.
 *
 * The redirect here is a convenience, not a security boundary. Everything this
 * app can reach is gated by the Cognito token and the group role's IAM policy;
 * a user who bypassed this guard would see an empty shell and failed API calls,
 * not data. The guard exists so they get a sign-in screen instead.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === "unauthenticated") {
      const next = encodeURIComponent(pathname);
      router.replace(`/sign-in?next=${next}`);
    }
  }, [status, router, pathname]);

  if (status === "loading") {
    return (
      <div className={styles.centred}>
        <p className="muted">Loading…</p>
      </div>
    );
  }

  if (status === "unauthenticated") {
    // The effect above is redirecting. Rendering the shell in the meantime
    // would flash a header belonging to a session that does not exist.
    return (
      <div className={styles.centred}>
        <p className="muted">Redirecting to sign-in…</p>
      </div>
    );
  }

  return (
    <>
      <AppHeader />
      <main className={styles.main} id="main">
        <div className={styles.container}>
          <NoAccessNotice />
          {children}
        </div>
      </main>
      <AppFooter />
      <IdleSignOut />
    </>
  );
}

/**
 * A signed-in user in no groups can reach nothing.
 *
 * Without this they would see an empty bucket list and reasonably conclude the
 * portal is broken, rather than that their account is not finished.
 */
function NoAccessNotice() {
  const { session } = useSession();
  if (!session || session.groups.length > 0) return null;

  return (
    <div className={styles.notice}>
      <Message tone="warning">
        Your account is not yet assigned to any group, so there is nothing for you
        to access. Ask an administrator to add you to a group.
      </Message>
    </div>
  );
}
