// Interim identity for the env-based multi-user gate (see gate.functions.ts).
// Separate from current-user.tsx, which is a dormant Supabase-Auth-based
// identity path that isn't wired up yet.
import { useQuery } from "@tanstack/react-query";
import { getAuthState } from "@/lib/gate.functions";
import type { StaffRole } from "@/lib/gate.functions";

export function useAppUser() {
  const query = useQuery({
    queryKey: ["app-user"],
    queryFn: () => getAuthState(),
  });
  return {
    email: query.data?.email ?? null,
    userName: query.data?.userName ?? null,
    isAdmin: query.data?.isAdmin ?? false,
    role: (query.data?.role ?? null) as StaffRole | null,
    isTestCaseApprover: query.data?.isTestCaseApprover ?? false,
    isLoading: query.isLoading,
  };
}
