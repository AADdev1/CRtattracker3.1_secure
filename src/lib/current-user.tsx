// Client-side "is there a Supabase Auth session" gate — redirects to /auth
// when there is none. Sessions live in localStorage, so SSR can't check
// this during beforeLoad. The real security boundary is every server
// function's requireSessionUser() call (src/lib/gate.functions.ts), which
// re-verifies the JWT and the caller's public.user_management row on every
// request — this provider only avoids flashing protected UI at a
// signed-out visitor. Role/admin/approver checks live in useAppUser()
// (src/lib/app-user.ts), not here — this file no longer knows about roles
// at all (see the migration that dropped public.profiles/app_role).
import { createContext, useCallback, useContext, useEffect, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

async function hasSession(): Promise<boolean> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return !!user;
}

const SessionContext = createContext<{ hasSession: boolean; isLoading: boolean } | null>(null);

// 15-minute idle-session timeout. persistSession + autoRefreshToken in
// client.ts mean the SDK silently keeps a session alive forever as long
// as the tab is open — this tracks real user interaction (not just
// tab-open time) and signs out once the app has seen none for 15
// minutes, matching the policy's explicit numeric requirement.
const IDLE_TIMEOUT_MS = 15 * 60 * 1000;
// mousedown/keydown/scroll/touchstart, not mousemove — mousemove fires
// continuously while the cursor moves, which would reset the timer far
// more often than needed just to prove "still at the desk."
const ACTIVITY_EVENTS = ["mousedown", "keydown", "scroll", "touchstart"] as const;

function useIdleSignOut(enabled: boolean, onTimeout: () => void) {
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout>;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(onTimeout, IDLE_TIMEOUT_MS);
    };
    reset();
    ACTIVITY_EVENTS.forEach((event) => window.addEventListener(event, reset, { passive: true }));
    return () => {
      clearTimeout(timer);
      ACTIVITY_EVENTS.forEach((event) => window.removeEventListener(event, reset));
    };
  }, [enabled, onTimeout]);
}

export function CurrentUserProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["current-session"],
    queryFn: hasSession,
  });

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      qc.invalidateQueries({ queryKey: ["current-session"] });
      qc.invalidateQueries({ queryKey: ["app-user"] });
    });
    return () => sub.subscription.unsubscribe();
  }, [qc]);

  const handleIdleTimeout = useCallback(async () => {
    await supabase.auth.signOut();
    qc.invalidateQueries({ queryKey: ["current-session"] });
    qc.invalidateQueries({ queryKey: ["app-user"] });
    navigate({ to: "/auth" });
  }, [qc, navigate]);

  useIdleSignOut(!!query.data, handleIdleTimeout);

  useEffect(() => {
    if (query.isLoading) return;
    if (!query.data && pathname !== "/auth") {
      navigate({ to: "/auth" });
    }
  }, [query.isLoading, query.data, pathname, navigate]);

  if (pathname !== "/auth" && (query.isLoading || !query.data)) {
    return null;
  }

  return (
    <SessionContext.Provider
      value={{ hasSession: query.data ?? false, isLoading: query.isLoading }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSessionGate() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSessionGate must be used within CurrentUserProvider");
  return ctx;
}
