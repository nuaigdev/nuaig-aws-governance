"use client";

import { useEffect, useRef, useState } from "react";

import { IDLE_TIMEOUT_MINUTES, IDLE_WARNING_MINUTES } from "@config/session";
import { Button } from "@/components/ui";
import { useSession } from "@/lib/auth/SessionProvider";

const TIMEOUT_MS = IDLE_TIMEOUT_MINUTES * 60_000;
const WARNING_MS = IDLE_WARNING_MINUTES * 60_000;
const TICK_MS = 5_000;
/** Shared across tabs, so activity in one tab keeps the others alive. */
const STORAGE_KEY = "portal:last-activity";

function readShared(): number {
  try {
    return Number(window.localStorage.getItem(STORAGE_KEY)) || 0;
  } catch {
    return 0;
  }
}

function writeShared(time: number): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(time));
  } catch {
    // Storage can be blocked. Per-tab tracking below still works.
  }
}

/**
 * Signs the user out after a period of inactivity, with a short warning first.
 *
 * Timers are throttled in background tabs, so the deadline is checked against
 * the clock on every tick rather than counted down — a laptop that slept for an
 * hour signs out on wake, not an hour and 30 minutes later.
 *
 * This limits exposure on a shared or unattended screen. It is a convenience
 * layer over the token lifetimes set on the user pool, which are the real limit.
 */
export function IdleSignOut() {
  const { signOut } = useSession();
  const lastActivity = useRef(0);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  useEffect(() => {
    const touch = () => {
      const now = Date.now();
      lastActivity.current = now;
      writeShared(now);
    };

    // Initialise inside the effect: `Date.now()` during render is impure.
    lastActivity.current = Math.max(Date.now(), readShared());

    let lastTouch = 0;
    const onActivity = () => {
      const now = Date.now();
      // Throttle: pointer and key events fire constantly.
      if (now - lastTouch < 1_000) return;
      lastTouch = now;
      // Once the warning is up, only the explicit button counts, so a stray
      // keypress does not silently cancel it.
      if (now - Math.max(lastActivity.current, readShared()) >= TIMEOUT_MS - WARNING_MS) return;
      touch();
    };

    const events = ["pointerdown", "keydown", "scroll", "touchstart"] as const;
    for (const name of events) window.addEventListener(name, onActivity, { passive: true });

    const check = () => {
      const idle = Date.now() - Math.max(lastActivity.current, readShared());
      if (idle >= TIMEOUT_MS) {
        void signOut("idle");
        return;
      }
      setSecondsLeft(idle >= TIMEOUT_MS - WARNING_MS ? Math.ceil((TIMEOUT_MS - idle) / 1_000) : null);
    };

    const timer = window.setInterval(check, TICK_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      for (const name of events) window.removeEventListener(name, onActivity);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
    };
  }, [signOut]);

  if (secondsLeft === null) return null;

  return (
    <dialog
      ref={(element) => {
        // Modal, so the page behind is inert until the user answers.
        if (element && !element.open) element.showModal();
      }}
      role="alertdialog"
      aria-labelledby="idle-title"
      className="dialogSurface"
      onCancel={(event) => event.preventDefault()}
    >
      <header className="dialogHeader">
        <h2 id="idle-title">Still there?</h2>
      </header>
      <div className="dialogBody">
        <p>
          For your security you will be signed out in about{" "}
          <strong className="data">
            {secondsLeft >= 60 ? `${Math.ceil(secondsLeft / 60)} min` : `${secondsLeft} s`}
          </strong>{" "}
          because there has been no activity.
        </p>
      </div>
      <footer className="dialogFooter">
        <Button onClick={() => void signOut()}>Sign out now</Button>
        <Button
          variant="primary"
          autoFocus
          onClick={() => {
            const now = Date.now();
            lastActivity.current = now;
            writeShared(now);
            setSecondsLeft(null);
          }}
        >
          Stay signed in
        </Button>
      </footer>
    </dialog>
  );
}
