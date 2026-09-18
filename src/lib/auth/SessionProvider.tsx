"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { signOut as amplifySignOut } from "aws-amplify/auth";

import { configureAmplify } from "@/lib/amplify/client";

import { loadSession, type PortalSession } from "./session";

interface SessionContextValue {
  readonly session: PortalSession | null;
  readonly status: "loading" | "authenticated" | "unauthenticated";
  readonly isAdmin: boolean;
  /** Re-reads the session. Pass `true` after anything that could change groups. */
  readonly refresh: (forceTokenRefresh?: boolean) => Promise<void>;
  readonly signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [session, setSession] = useState<PortalSession | null>(null);
  const [status, setStatus] = useState<SessionContextValue["status"]>("loading");

  const refresh = useCallback(async (forceTokenRefresh = false) => {
    try {
      configureAmplify();
      const next = await loadSession(forceTokenRefresh);
      setSession(next);
      setStatus(next ? "authenticated" : "unauthenticated");
    } catch {
      // Any failure to establish identity is treated as "not signed in".
      // Distinguishing "no session" from "network down" here would only give
      // the user a different error on the way to the same sign-in screen.
      setSession(null);
      setStatus("unauthenticated");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      // Yield before the first setState so this is not a synchronous state
      // update inside the effect body, which would force an extra render pass
      // before the browser paints.
      await Promise.resolve();
      if (!cancelled) await refresh();
    })();

    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const signOut = useCallback(async () => {
    await amplifySignOut();
    setSession(null);
    setStatus("unauthenticated");
    router.push("/sign-in");
  }, [router]);

  const value = useMemo<SessionContextValue>(
    () => ({
      session,
      status,
      isAdmin: session?.isAdmin ?? false,
      refresh,
      signOut,
    }),
    [session, status, refresh, signOut],
  );

  return <SessionContext value={value}>{children}</SessionContext>;
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error("useSession must be used inside <SessionProvider>.");
  }
  return context;
}
