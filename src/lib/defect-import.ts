// CSV → Defects importer.
// Validates CR No against existing CRs; skips records with blank/unknown CR.
import Papa from "papaparse";
import { supabase } from "@/integrations/supabase/client";

const FIELD_MAP: Record<string, string> = {
  "Defect No": "defect_no",
  "Summary": "summary",
  "CR No": "cr_number",
  "Priority": "priority",
  "Severity": "severity",
  "Environment": "environment",
  "Application": "application",
  "Module": "module",
  "Product": "product",
  "Nature of Defect": "nature_of_defect",
  "Old Status": "old_status",
  "New Status": "new_status",
  "Defect Raised By": "defect_raised_by",
  "Last Modified By": "last_modified_by",
  "Date Modified": "date_modified",
  "Date Created": "date_created",
};

const DATE_COLS = new Set(["date_modified", "date_created"]);

function parseDate(value: string): string | null {
  if (!value || !value.trim()) return null;
  const v = value.trim();
  const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (m) {
    const [, mm, dd, yyRaw, hh = "0", mi = "0"] = m;
    const year = yyRaw.length === 2 ? 2000 + Number(yyRaw) : Number(yyRaw);
    const d = new Date(Date.UTC(year, Number(mm) - 1, Number(dd), Number(hh), Number(mi)));
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  const d = new Date(v);
  if (!Number.isNaN(d.getTime())) return d.toISOString();
  return null;
}

export interface DefectImportResult {
  totalRows: number;
  imported: number;
  skipped: number;
  errors: string[];
}

export async function importDefectCsv(file: File): Promise<DefectImportResult> {
  const parsed = await new Promise<Papa.ParseResult<Record<string, string>>>(
    (resolve, reject) => {
      Papa.parse<Record<string, string>>(file, {
        header: true,
        skipEmptyLines: true,
        complete: resolve,
        error: reject,
      });
    },
  );

  const errors: string[] = parsed.errors.map((e) => `${e.row}: ${e.message}`);
  const rows = parsed.data;

  // Load all CR numbers for validation.
  const { data: crsData, error: crsErr } = await supabase.from("crs").select("cr_number");
  if (crsErr) throw crsErr;
  const crSet = new Set((crsData ?? []).map((c) => c.cr_number));

  let skipped = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const upsertRows: any[] = [];

  for (const row of rows) {
    const cr = (row["CR No"] ?? "").trim();
    if (!cr || !crSet.has(cr)) {
      skipped++;
      continue;
    }
    const defectNo = (row["Defect No"] ?? "").trim();
    if (!defectNo) {
      skipped++;
      continue;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dbRow: Record<string, any> = {};
    for (const [header, value] of Object.entries(row)) {
      const col = FIELD_MAP[header?.trim()];
      if (!col) continue;
      dbRow[col] = DATE_COLS.has(col) ? parseDate(value) : (value?.trim() || null);
    }
    upsertRows.push(dbRow);
  }

  const chunkSize = 200;
  let imported = 0;
  for (let i = 0; i < upsertRows.length; i += chunkSize) {
    const chunk = upsertRows.slice(i, i + chunkSize);
    const { error } = await supabase
      .from("defects")
      .upsert(chunk, { onConflict: "defect_no" });
    if (error) errors.push(error.message);
    else imported += chunk.length;
  }

  return { totalRows: rows.length, imported, skipped, errors };
}

// Compute open-defect stats per CR using the configured status mapping.
export interface DefectStats {
  openCount: number;
  maxAgingDays: number | null;
}

export async function loadDefectStatsByCr(): Promise<Map<string, DefectStats>> {
  const [defectsRes, mapRes] = await Promise.all([
    supabase.from("defects").select("cr_number, new_status, date_created"),
    supabase.from("defect_status_mapping").select("status, is_open"),
  ]);
  if (defectsRes.error) throw defectsRes.error;
  if (mapRes.error) throw mapRes.error;
  const openSet = new Set(
    (mapRes.data ?? []).filter((m) => m.is_open).map((m) => m.status),
  );
  const map = new Map<string, DefectStats>();
  const now = Date.now();
  for (const d of defectsRes.data ?? []) {
    if (!d.new_status || !openSet.has(d.new_status)) continue;
    const ageDays = d.date_created
      ? Math.floor((now - new Date(d.date_created).getTime()) / 86400000)
      : null;
    const cur = map.get(d.cr_number) ?? { openCount: 0, maxAgingDays: null };
    cur.openCount++;
    if (ageDays != null && (cur.maxAgingDays == null || ageDays > cur.maxAgingDays)) {
      cur.maxAgingDays = ageDays;
    }
    map.set(d.cr_number, cur);
  }
  return map;
}

export function isStatusOpen(status: string | null, openStatuses: Set<string>): boolean {
  return !!status && openStatuses.has(status);
}

// Same shape as loadDefectStatsByCr, but derived from an already-fetched
// (already open-filtered) defect list — used with getScopedDefects().
export function aggregateDefectStats(
  openDefects: { cr_number: string; date_created: string | null }[],
): Map<string, DefectStats> {
  const map = new Map<string, DefectStats>();
  const now = Date.now();
  for (const d of openDefects) {
    const ageDays = d.date_created
      ? Math.floor((now - new Date(d.date_created).getTime()) / 86400000)
      : null;
    const cur = map.get(d.cr_number) ?? { openCount: 0, maxAgingDays: null };
    cur.openCount++;
    if (ageDays != null && (cur.maxAgingDays == null || ageDays > cur.maxAgingDays)) {
      cur.maxAgingDays = ageDays;
    }
    map.set(d.cr_number, cur);
  }
  return map;
}