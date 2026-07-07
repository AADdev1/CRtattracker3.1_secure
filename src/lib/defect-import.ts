// CSV → Defects importer.
// Validates CR No against existing CRs; skips records with blank/unknown CR.
//
// Parsing happens client-side (Papa.parse needs the browser File object).
// Everything DB-related happens in importDefectRows, a server function
// using the service-role client — RLS on crs/defects is locked down, so
// the anon client can no longer do any of this directly.
import Papa from "papaparse";
import { createServerFn } from "@tanstack/react-start";
import { requireSessionUser } from "@/lib/gate.functions";

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
  testCasesFlaggedForRetest: number;
  errors: string[];
}

const importDefectRows = createServerFn({ method: "POST" })
  .inputValidator((data: { rows: Record<string, string>[] }) => data)
  .handler(async ({ data: { rows } }): Promise<DefectImportResult> => {
    await requireSessionUser();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Load all CR numbers for validation.
    const { data: crsData, error: crsErr } = await supabaseAdmin.from("crs").select("cr_number");
    if (crsErr) throw new Error(crsErr.message);
    const crSet = new Set((crsData ?? []).map((c) => c.cr_number));

    const errors: string[] = [];
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
      const { error } = await supabaseAdmin
        .from("defects")
        .upsert(chunk, { onConflict: "defect_no" });
      if (error) errors.push(error.message);
      else imported += chunk.length;
    }

    // Reconcile: a test case marked "Defect Raised" whose referenced defect
    // has since closed (per defect_status_mapping) gets scratched back to
    // Pending and flagged — same "trust the fresh report over stale manual
    // state" pattern used for crs.is_dropped on CR re-import. Only acts on
    // defect ids this report actually resolved a status for; unrecognized
    // ids are left alone.
    let testCasesFlaggedForRetest = 0;
    const { data: raisedTestCases, error: raisedErr } = await supabaseAdmin
      .from("test_cases")
      .select("id, defect_id")
      .eq("execution_status", "Defect Raised");
    if (raisedErr) throw new Error(raisedErr.message);

    const defectIds = Array.from(
      new Set((raisedTestCases ?? []).map((t) => t.defect_id).filter((d): d is string => !!d)),
    );
    if (defectIds.length > 0) {
      const [{ data: mapping, error: mapErr }, { data: defectRows, error: defErr }] =
        await Promise.all([
          supabaseAdmin.from("defect_status_mapping").select("status, is_open"),
          supabaseAdmin.from("defects").select("defect_no, new_status").in("defect_no", defectIds),
        ]);
      if (mapErr) throw new Error(mapErr.message);
      if (defErr) throw new Error(defErr.message);

      const openStatuses = new Set((mapping ?? []).filter((m) => m.is_open).map((m) => m.status));
      const newStatusByDefectNo = new Map(
        (defectRows ?? []).map((d) => [d.defect_no, d.new_status]),
      );

      const idsToReset = (raisedTestCases ?? [])
        .filter((t) => {
          if (!t.defect_id) return false;
          const newStatus = newStatusByDefectNo.get(t.defect_id);
          if (newStatus == null) return false;
          return !openStatuses.has(newStatus);
        })
        .map((t) => t.id);

      if (idsToReset.length > 0) {
        const { error: resetErr } = await supabaseAdmin
          .from("test_cases")
          .update({ execution_status: "Pending", defect_id: null, needs_retest: true } as never)
          .in("id", idsToReset);
        if (resetErr) throw new Error(resetErr.message);
        testCasesFlaggedForRetest = idsToReset.length;
      }
    }

    return { totalRows: rows.length, imported, skipped, testCasesFlaggedForRetest, errors };
  });

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

  const parseErrors: string[] = parsed.errors.map((e) => `${e.row}: ${e.message}`);
  const result = await importDefectRows({ data: { rows: parsed.data } });
  return { ...result, errors: [...parseErrors, ...result.errors] };
}

// Compute open-defect stats per CR using the configured status mapping.
export interface DefectStats {
  openCount: number;
  maxAgingDays: number | null;
}

export function isStatusOpen(status: string | null, openStatuses: Set<string>): boolean {
  return !!status && openStatuses.has(status);
}

// Same shape as the old loadDefectStatsByCr, but derived from an
// already-fetched (already open-filtered) defect list — used with
// getScopedDefects() from scoped-data.functions.ts.
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
