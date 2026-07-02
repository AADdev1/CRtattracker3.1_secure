// Resolves the signed-in Supabase user + their profiles.role, and redirects
// to /auth when there is no session. This is a client-side gate: Supabase
// sessions live in localStorage, so SSR can't check them during beforeLoad.
// The real security boundary is Postgres RLS, which blocks all data access
// for unauthenticated requests regardless of what briefly renders.
import { createContext, useContext, useEffect, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type AppRole = Database["public"]["Enums"]["app_role"];

interface CurrentUser {
  userId: string;
  email: string;
  role: AppRole;
}

const CurrentUserContext = createContext<{
  user: CurrentUser | null;
  isLoading: boolean;
} | null>(null);

async function loadCurrentUser(): Promise<CurrentUser | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("email, role")
    .eq("id", user.id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { userId: user.id, email: data.email, role: data.role };
}

export function CurrentUserProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["current-user"],
    queryFn: loadCurrentUser,
  });

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      qc.invalidateQueries({ queryKey: ["current-user"] });
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
    <CurrentUserContext.Provider value={{ user: query.data ?? null, isLoading: query.isLoading }}>
      {children}
    </CurrentUserContext.Provider>
  );
}

export function useCurrentUser() {
  const ctx = useContext(CurrentUserContext);
  if (!ctx) throw new Error("useCurrentUser must be used within CurrentUserProvider");
  return ctx;
}
