// CR Repository — free-text CR Updates log. Append-only: every submission
// is a new row, never overwritten, so a CR accumulates a running history
// that's shown in full on the CR Detail page. Same PMO/BA/ITPM write
// access as the rest of CR Repository's inline editing (Update Status,
// Deployment Stage) — Admin is read-only here too, matching the app-wide
// "Admin read-only everywhere" convention.
import { createServerFn } from "@tanstack/react-start";
import { requireSessionUser, assertHasRoleOrAdmin } from "@/lib/gate.functions";

// Deliberately does NOT include isAdmin — same reasoning as
// crs-admin.functions.ts's assertCrEditAccess: CR data entry is a
// PMO/BA/ITPM function-of-record, not an Admin one.
async function assertCrUpdateWriteAccess() {
  const session = await requireSessionUser();
  if (session.role !== "PMO" && session.role !== "BA" && session.role !== "ITPM") {
    throw new Error("Forbidden: only PMO, BA, or ITPM can post CR updates");
  }
  return session;
}

// Full history for a CR, newest first — powers the CR Detail page's
// Updates card.
export const listUpdatesByCr = createServerFn({ method: "GET" })
  .inputValidator((data: { crNumber: string }) => data)
  .handler(async ({ data }) => {
    assertHasRoleOrAdmin(await requireSessionUser());
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("cr_updates")
      .select("id, update_text, created_by, created_at")
      .eq("cr_number", data.crNumber)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const addCrUpdate = createServerFn({ method: "POST" })
  .inputValidator((data: { crNumber: string; updateText: string }) => data)
  .handler(async ({ data }) => {
    const { userName } = await assertCrUpdateWriteAccess();
    const text = data.updateText.trim();
    if (!text) throw new Error("Update text is required");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("cr_updates")
      .insert({ cr_number: data.crNumber, update_text: text, created_by: userName } as never)
      .select("id, update_text, created_by, created_at")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });
