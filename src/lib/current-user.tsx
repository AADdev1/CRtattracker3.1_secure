// Client-side "is there a Supabase Auth session" gate — redirects to /auth
// when there is none. Sessions live in localStorage, so SSR can't check
// this during beforeLoad. The real security boundary is every server
// function's requireSessionUser() call (src/lib/gate.functions.ts), which
// re-verifies the JWT and the caller's public.user_management row on every
// request — this provider only avoids flashing protected UI at a
// signed-out visitor. Role/admin/approver checks live in useAppUser()
// (src/lib/app-user.ts), not here — this file no longer knows about roles
// at all (see the migration that dropped public.profiles/app_role).
import { createContext, useContext, useEffect, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

async function hasSession(): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser();
  return !!user;
}

const SessionContext = createContext<{ hasSession: boolean; isLoading: boolean } | null>(null);

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
    <SessionContext.Provider value={{ hasSession: query.data ?? false, isLoading: query.isLoading }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSessionGate() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSessionGate must be used within CurrentUserProvider");
  return ctx;
}
