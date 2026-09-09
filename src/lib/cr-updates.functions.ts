// CR Repository — free-text CR Updates log. Append-only: every submission
// is a new row, never overwritten, so a CR accumulates a running history
// that's shown in full on the CR Detail page. Same PMO/BA/ITPM write
// access as the rest of CR Repository's inline editing (Update Status,
// Deployment Stage) — Admin is read-only here too, matching the app-wide
// "Admin read-only everywhere" convention.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSessionUser, assertHasRoleOrAdmin } from "@/lib/gate.functions";
// Aliased — this file has a local `text` variable (the trimmed update body)
// inside addCrUpdate, which would otherwise shadow the schema import.
import { text as textSchema, validated } from "@/lib/validation";

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
  .inputValidator(validated(z.object({ crNumber: textSchema })))
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

// Latest update per CR, across every CR that has at least one — powers the
// CR Repository grid's Updates cell preview (shown without opening the
// dialog, same as CR Planner's remarks-mirror column). No per-CR "latest"
// column exists here (unlike cr_planner.remarks), so this fetches every
// row ordered newest-first and keeps only the first one seen per cr_number
// — same client-side-merge style already used throughout this codebase
// (e.g. cr-planner.functions.ts's listPlannerGrid).
export const getLatestCrUpdates = createServerFn({ method: "GET" }).handler(async () => {
  assertHasRoleOrAdmin(await requireSessionUser());
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: rows, error } = await supabaseAdmin
    .from("cr_updates")
    .select("cr_number, update_text, created_by, created_at")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);

  const latestByCr = new Map<string, { update_text: string; created_by: string; created_at: string }>();
  for (const r of rows ?? []) {
    if (!latestByCr.has(r.cr_number)) {
      latestByCr.set(r.cr_number, {
        update_text: r.update_text,
        created_by: r.created_by,
        created_at: r.created_at,
      });
    }
  }

  return Array.from(latestByCr, ([cr_number, latest]) => ({ cr_number, ...latest }));
});

export const addCrUpdate = createServerFn({ method: "POST" })
  .inputValidator(validated(z.object({ crNumber: textSchema, updateText: textSchema })))
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
