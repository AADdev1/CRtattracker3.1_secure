// =============================================================================
// KPI ENGINE — single source of truth for KPI calculations.
// No UI component or other module may replicate this math.
// Hold days are counted as CALENDAR days inside excluded statuses
// (per Phase 1 spec). Multiple hold→resume cycles are supported.
// =============================================================================
import { supabase } from "@/integrations/supabase/client";

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

/**
 * Recalculate every active KPI for every CR. This is the ONLY function that
 * writes to public.kpi_results. Dashboards/worklists read from there.
 */
export async function recalculateAllKpis(): Promise<{
  crsProcessed: number;
  kpisProcessed: number;
  resultsWritten: number;
}> {
  const [{ data: statuses }, { data: kpis }, { data: crs }, { data: excl }] =
    await Promise.all([
      supabase.from("workflow_statuses").select("*").order("sort_order"),
      supabase.from("kpis").select("*").eq("is_active", true),
      supabase.from("crs").select("*"),
      supabase.from("kpi_excluded_statuses").select("kpi_id, workflow_status_code"),
    ]);

  if (!statuses || !kpis || !crs) {
    throw new Error("Failed to load engine inputs");
  }

  const exclByKpi = groupExcluded(excl ?? []);

  const results: KpiCalcResult[] = [];
  for (const cr of crs as unknown as CrRow[]) {
    const timeline = buildTimeline(cr, statuses as unknown as WorkflowStatusRow[]);
    for (const kpi of kpis as unknown as KpiRow[]) {
      results.push(calcKpi(cr, kpi, timeline, exclByKpi.get(kpi.id) ?? new Set()));
    }
  }

  if (results.length === 0) {
    return { crsProcessed: crs.length, kpisProcessed: kpis.length, resultsWritten: 0 };
  }

  // Clear stale results for these CR×KPI pairs, then re-insert.
  // Simpler: delete all results for the CRs we just processed, then insert fresh.
  const crNumbers = (crs as { cr_number: string }[]).map((c) => c.cr_number);
  if (crNumbers.length > 0) {
    const { error: delErr } = await supabase
      .from("kpi_results")
      .delete()
      .in("cr_number", crNumbers);
    if (delErr) throw delErr;
  }

  // Chunked insert to avoid payload limits.
  const chunkSize = 500;
  for (let i = 0; i < results.length; i += chunkSize) {
    const chunk = results.slice(i, i + chunkSize);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await supabase.from("kpi_results").insert(chunk as any);
    if (error) throw error;
  }

  return {
    crsProcessed: crs.length,
    kpisProcessed: kpis.length,
    resultsWritten: results.length,
  };
}

/**
 * Recalculate KPIs for a single CR (used after editing CR size or notes).
 */
export async function recalculateForCr(crNumber: string): Promise<void> {
  const [{ data: statuses }, { data: kpis }, { data: cr }, { data: excl }] =
    await Promise.all([
      supabase.from("workflow_statuses").select("*").order("sort_order"),
      supabase.from("kpis").select("*").eq("is_active", true),
      supabase.from("crs").select("*").eq("cr_number", crNumber).maybeSingle(),
      supabase.from("kpi_excluded_statuses").select("kpi_id, workflow_status_code"),
    ]);
  if (!statuses || !kpis || !cr) return;

  const exclByKpi = groupExcluded(excl ?? []);
  const timeline = buildTimeline(cr as unknown as CrRow, statuses as unknown as WorkflowStatusRow[]);
  const results = (kpis as unknown as KpiRow[]).map((k) =>
    calcKpi(cr as unknown as CrRow, k, timeline, exclByKpi.get(k.id) ?? new Set()),
  );

  await supabase.from("kpi_results").delete().eq("cr_number", crNumber);
  if (results.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await supabase.from("kpi_results").insert(results as any);
  }
}

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