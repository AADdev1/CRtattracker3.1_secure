// =============================================================================
// KPI ENGINE — single source of truth for KPI calculations.
// No UI component or other module may replicate this math.
// Hold days are counted as CALENDAR days inside excluded statuses
// (per Phase 1 spec). Multiple hold→resume cycles are supported.
// =============================================================================
import { createServerFn } from "@tanstack/react-start";
import { requireSessionUser } from "@/lib/gate.functions";

export type CrSize = "Small" | "Medium" | "Large";
export type KpiStatusValue = "pending" | "not_started" | "green" | "amber" | "red";

export interface WorkflowStatusRow {
  code: string;
  db_column: string;
  label: string;
  sort_order: number;
}

export interface KpiRow {
  id: string;
  name: string;
  start_status_code: string;
  end_status_code: string;
  small_tat: number;
  medium_tat: number;
  large_tat: number;
  warning_pct: number;
  is_active: boolean;
}

export interface CrRow {
  cr_number: string;
  cr_size: CrSize | null;
  [key: string]: unknown;
}

export interface TimelineEntry {
  ts: Date;
  code: string;
  label: string;
}

export interface KpiCalcResult {
  cr_number: string;
  kpi_id: string;
  start_date: string | null;
  end_date: string | null;
  working_days: number | null;
  hold_days: number | null;
  effective_days: number | null;
  tat: number | null;
  remaining_days: number | null;
  utilization_pct: number | null;
  status: KpiStatusValue;
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;

function diffDays(a: Date, b: Date): number {
  return Math.max(0, (b.getTime() - a.getTime()) / MS_PER_DAY);
}

/**
 * Calendar-day difference between two dates, EXCLUDING Saturdays and Sundays.
 * Weekend time is never counted toward KPI elapsed/hold days.
 */
function diffDaysExcludingWeekends(a: Date, b: Date): number {
  if (b.getTime() <= a.getTime()) return 0;
  let total = 0;
  const cursor = new Date(a.getTime());
  while (cursor.getTime() < b.getTime()) {
    // Step to the end of the current calendar day (local time) or to b, whichever is sooner.
    const dayEnd = new Date(cursor);
    dayEnd.setHours(24, 0, 0, 0);
    const segEnd = dayEnd.getTime() < b.getTime() ? dayEnd : b;
    const dow = cursor.getDay(); // 0 = Sun, 6 = Sat
    if (dow !== 0 && dow !== 6) {
      total += (segEnd.getTime() - cursor.getTime()) / MS_PER_DAY;
    }
    cursor.setTime(segEnd.getTime());
  }
  return total;
}

function tatForSize(kpi: KpiRow, size: CrSize): number {
  if (size === "Small") return kpi.small_tat;
  if (size === "Medium") return kpi.medium_tat;
  return kpi.large_tat;
}

/**
 * Build a chronological timeline from a CR row, using every populated
 * workflow-status timestamp. This is the workflow timeline that drives
 * every KPI calculation.
 */
export function buildTimeline(cr: CrRow, statuses: WorkflowStatusRow[]): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  for (const s of statuses) {
    const raw = cr[s.db_column];
    if (raw == null || raw === "") continue;
    const d = new Date(raw as string);
    if (Number.isNaN(d.getTime())) continue;
    entries.push({ ts: d, code: s.code, label: s.label });
  }
  entries.sort((a, b) => a.ts.getTime() - b.ts.getTime());
  return entries;
}

/**
 * Classify a status from effective days vs TAT thresholds.
 */
export function classifyStatus(
  effectiveDays: number,
  tat: number,
  warningPct: number,
): KpiStatusValue {
  if (tat <= 0) return "green";
  if (effectiveDays >= tat) return "red";
  const warnThreshold = tat * (warningPct / 100);
  if (effectiveDays >= warnThreshold) return "amber";
  return "green";
}

/**
 * Calculate one KPI for one CR using the workflow timeline.
 * Returns a row ready to upsert into kpi_results.
 */
export function calcKpi(
  cr: CrRow,
  kpi: KpiRow,
  timeline: TimelineEntry[],
  excludedCodes: Set<string>,
): KpiCalcResult {
  const base: KpiCalcResult = {
    cr_number: cr.cr_number,
    kpi_id: kpi.id,
    start_date: null,
    end_date: null,
    working_days: null,
    hold_days: null,
    effective_days: null,
    tat: null,
    remaining_days: null,
    utilization_pct: null,
    status: "not_started",
  };

  // Locate start: earliest timeline entry matching the KPI start status.
  const startIdx = timeline.findIndex((t) => t.code === kpi.start_status_code);
  if (startIdx < 0) return base;

  const startEntry = timeline[startIdx];
  base.start_date = startEntry.ts.toISOString();

  // Without a CR size we cannot evaluate TAT → status is Pending.
  if (!cr.cr_size) {
    return { ...base, status: "pending" };
  }

  // Locate end: first timeline entry AFTER start that matches the end status.
  let endIdx = -1;
  for (let i = startIdx + 1; i < timeline.length; i++) {
    if (timeline[i].code === kpi.end_status_code) {
      endIdx = i;
      break;
    }
  }

  const completed = endIdx >= 0;
  const endDate = completed ? timeline[endIdx].ts : new Date();
  const lastIdx = completed ? endIdx : timeline.length - 1;

  // Walk timeline segments from startIdx until end. Each segment is the
  // interval the CR spent inside timeline[i]'s status. Excluded segments
  // contribute to hold_days; non-excluded contribute to active time.
  let holdDays = 0;
  for (let i = startIdx; i <= lastIdx; i++) {
    const segStart = timeline[i].ts;
    const segEnd = i < lastIdx ? timeline[i + 1].ts : endDate;
    if (segEnd.getTime() <= segStart.getTime()) continue;
    if (excludedCodes.has(timeline[i].code)) {
      // Hold days only count weekdays — weekends are already excluded globally.
      holdDays += diffDaysExcludingWeekends(segStart, segEnd);
    }
  }

  // Total elapsed time ignores weekends (Sat/Sun never count toward KPI days).
  const totalDays = diffDaysExcludingWeekends(startEntry.ts, endDate);
  const effectiveDays = Math.max(0, totalDays - holdDays);
  const tat = tatForSize(kpi, cr.cr_size);
  const remaining = tat - effectiveDays;
  const utilization = tat > 0 ? (effectiveDays / tat) * 100 : 0;
  const status = classifyStatus(effectiveDays, tat, kpi.warning_pct);

  return {
    ...base,
    end_date: completed ? endDate.toISOString() : null,
    working_days: round2(totalDays),
    hold_days: round2(holdDays),
    effective_days: round2(effectiveDays),
    tat,
    remaining_days: round2(remaining),
    utilization_pct: round2(utilization),
    status,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const LOCK_STALE_MS = 5 * 60 * 1000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function acquireKpiEngineLock(supabaseAdmin: any): Promise<void> {
  const nowIso = new Date().toISOString();
  const staleCutoff = new Date(Date.now() - LOCK_STALE_MS).toISOString();
  const { data: claimed, error } = await supabaseAdmin
    .from("kpi_engine_lock")
    .update({ is_running: true, started_at: nowIso, updated_at: nowIso })
    .eq("id", "singleton")
    .or(`is_running.eq.false,started_at.lt.${staleCutoff}`)
    .select("id");
  if (error) throw new Error(error.message);
  if (!claimed || claimed.length === 0) {
    throw new Error("The KPI engine is already running from another request. Please try again shortly.");
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function releaseKpiEngineLock(supabaseAdmin: any): Promise<void> {
  await supabaseAdmin
    .from("kpi_engine_lock")
    .update({ is_running: false, updated_at: new Date().toISOString() })
    .eq("id", "singleton");
}

/**
 * Recalculate every active KPI for every CR the caller can see: all of them
 * for an Admin, or only CRs where the caller is the BA or ITPM otherwise.
 * KPI *role* filtering (BA-only sees BA KPIs, etc.) still happens only at
 * read time in getScopedKpiResults — this just narrows which CRs get
 * touched, so both roles' results stay correct for the CRs it does process.
 * This is the ONLY function that writes to public.kpi_results. Dashboards/
 * worklists read from there.
 * Guarded by kpi_engine_lock so at most one run can be in flight at once —
 * with ~300 CRs x 14+ KPIs, overlapping runs would double the DB load and
 * can throw duplicate-key errors if their delete/insert steps interleave.
 */
export const recalculateAllKpis = createServerFn({ method: "POST" }).handler(
  async (): Promise<{
    crsProcessed: number;
    kpisProcessed: number;
    resultsWritten: number;
  }> => {
    const { userName, isAdmin } = await requireSessionUser();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await acquireKpiEngineLock(supabaseAdmin);
    try {
      const [{ data: statuses }, { data: kpis }, { data: allCrs }, { data: excl }] =
        await Promise.all([
          supabaseAdmin.from("workflow_statuses").select("*").order("sort_order"),
          supabaseAdmin.from("kpis").select("*").eq("is_active", true),
          supabaseAdmin.from("crs").select("*"),
          supabaseAdmin.from("kpi_excluded_statuses").select("kpi_id, workflow_status_code"),
        ]);

      if (!statuses || !kpis || !allCrs) {
        throw new Error("Failed to load engine inputs");
      }

      const crs = isAdmin
        ? (allCrs as unknown as CrRow[])
        : (allCrs as unknown as CrRow[]).filter((cr) => cr.ba === userName || cr.itpm === userName);

      // Dropped CRs are excluded from KPI calculation entirely — no
      // kpi_results rows are computed or kept for them (see below, their
      // stale results still get deleted, just never reinserted).
      const activeCrs = crs.filter((cr) => !cr.is_dropped);

      const exclByKpi = groupExcluded(excl ?? []);

      const results: KpiCalcResult[] = [];
      for (const cr of activeCrs) {
        const timeline = buildTimeline(cr, statuses as unknown as WorkflowStatusRow[]);
        for (const kpi of kpis as unknown as KpiRow[]) {
          results.push(calcKpi(cr, kpi, timeline, exclByKpi.get(kpi.id) ?? new Set()));
        }
      }

      // Clear stale results for every CR in scope (active AND dropped), then
      // re-insert only for the active ones.
      const crNumbers = crs.map((c) => c.cr_number);
      if (crNumbers.length > 0) {
        const { error: delErr } = await supabaseAdmin
          .from("kpi_results")
          .delete()
          .in("cr_number", crNumbers);
        if (delErr) throw new Error(delErr.message);
      }

      // Chunked insert to avoid payload limits.
      const chunkSize = 500;
      for (let i = 0; i < results.length; i += chunkSize) {
        const chunk = results.slice(i, i + chunkSize);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await supabaseAdmin.from("kpi_results").insert(chunk as any);
        if (error) throw new Error(error.message);
      }

      return {
        crsProcessed: activeCrs.length,
        kpisProcessed: kpis.length,
        resultsWritten: results.length,
      };
    } finally {
      await releaseKpiEngineLock(supabaseAdmin);
    }
  },
);

/**
 * Recalculate KPIs for a single CR (used after editing CR size or notes).
 */
export const recalculateForCr = createServerFn({ method: "POST" })
  .inputValidator((crNumber: string) => crNumber)
  .handler(async ({ data: crNumber }): Promise<void> => {
    await requireSessionUser();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: statuses }, { data: kpis }, { data: cr }, { data: excl }] =
      await Promise.all([
        supabaseAdmin.from("workflow_statuses").select("*").order("sort_order"),
        supabaseAdmin.from("kpis").select("*").eq("is_active", true),
        supabaseAdmin.from("crs").select("*").eq("cr_number", crNumber).maybeSingle(),
        supabaseAdmin.from("kpi_excluded_statuses").select("kpi_id, workflow_status_code"),
      ]);
    if (!statuses || !kpis || !cr) return;

    await supabaseAdmin.from("kpi_results").delete().eq("cr_number", crNumber);
    // Dropped CRs are excluded from KPI calculation entirely — their stale
    // results are cleared above, but nothing gets recomputed for them.
    if ((cr as unknown as CrRow).is_dropped) return;

    const exclByKpi = groupExcluded(excl ?? []);
    const timeline = buildTimeline(cr as unknown as CrRow, statuses as unknown as WorkflowStatusRow[]);
    const results = (kpis as unknown as KpiRow[]).map((k) =>
      calcKpi(cr as unknown as CrRow, k, timeline, exclByKpi.get(k.id) ?? new Set()),
    );

    if (results.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await supabaseAdmin.from("kpi_results").insert(results as any);
    }
  });

function groupExcluded(
  rows: { kpi_id: string; workflow_status_code: string }[],
): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const r of rows) {
    let set = map.get(r.kpi_id);
    if (!set) {
      set = new Set();
      map.set(r.kpi_id, set);
    }
    set.add(r.workflow_status_code);
  }
  return map;
}