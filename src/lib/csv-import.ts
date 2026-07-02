// CSV → CRs importer.
// Preserves manual fields (cr_size, manual_notes) on existing CRs.
// After import, the caller MUST trigger recalculateAllKpis().
import Papa from "papaparse";
import { supabase } from "@/integrations/supabase/client";

// Map from CSV header → DB column name.
// Status columns are populated dynamically from workflow_statuses table.
const BASE_FIELD_MAP: Record<string, string> = {
  "CR Number": "cr_number",
  "Title": "title",
  "Application": "application",
  "Module name": "module_name",
  "Date Created": "date_created",
  "Date Modified": "date_modified",
  "Created User": "created_user",
  "Created user": "created_user",
  "Department": "department",
  "HOD": "hod",
  "KOM": "kom",
  "KOM Department": "kom_department",
  "IT Vertical Head": "it_vertical_head",
  "LOB": "lob",
  "Product": "product",
  "Severity": "severity",
  "Workflow Status": "workflow_status",
  "BRD Start Date": "brd_start_date",
  "BRD Signoff Awaited Date by BA": "brd_signoff_awaited_by_ba",
  "BRD Signoff Date by BA": "brd_signoff_date_by_ba",
  "UAT Signoff Awaited Date by BA": "uat_signoff_awaited_by_ba",
  "UAT Signoff Date by BA": "uat_signoff_date_by_ba",
  "Planned Development date": "planned_development_date",
  "Planned UAT Release Date": "planned_uat_release_date",
  "Planned Production Date": "planned_production_date",
  "BA": "ba",
  "ITPM": "itpm",
  "Assigned Team": "assigned_team",
  "Assigned User": "assigned_user",
  "Expected Go Live Date": "expected_go_live_date",
};

const DATE_COLUMNS = new Set([
  "date_created",
  "date_modified",
  "brd_start_date",
  "brd_signoff_awaited_by_ba",
  "brd_signoff_date_by_ba",
  "uat_signoff_awaited_by_ba",
  "uat_signoff_date_by_ba",
  "planned_development_date",
  "planned_uat_release_date",
  "planned_production_date",
  "expected_go_live_date",
]);

function parseDate(value: string): string | null {
  if (!value || !value.trim()) return null;
  const v = value.trim();
  // Try MM/DD/YY HH:MM
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

export interface CsvImportResult {
  totalRows: number;
  inserted: number;
  updated: number;
  skipped: number;
  errors: string[];
}

export async function importCrCsv(file: File): Promise<CsvImportResult> {
  const { data: statuses, error: sErr } = await supabase
    .from("workflow_statuses")
    .select("code, db_column");
  if (sErr || !statuses) throw new Error("Failed to load workflow statuses");

  const statusMap = new Map<string, string>();
  for (const s of statuses) statusMap.set(s.code, s.db_column);

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

  // Pre-fetch existing CR numbers to determine insert vs update.
  const crNumbers = rows.map((r) => r["CR Number"]?.trim()).filter(Boolean) as string[];
  const existingSet = new Set<string>();
  if (crNumbers.length > 0) {
    const { data: existing } = await supabase
      .from("crs")
      .select("cr_number")
      .in("cr_number", crNumbers);
    if (existing) existing.forEach((c) => existingSet.add(c.cr_number));
  }

  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const upsertRows: any[] = [];

  for (const row of rows) {
    const crNumber = row["CR Number"]?.trim();
    if (!crNumber) {
      skipped++;
      continue;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dbRow: Record<string, any> = { cr_number: crNumber };

    for (const [header, value] of Object.entries(row)) {
      const trimmedHeader = header?.trim();
      if (!trimmedHeader) continue;
      const baseCol = BASE_FIELD_MAP[trimmedHeader];
      if (baseCol) {
        if (DATE_COLUMNS.has(baseCol)) {
          dbRow[baseCol] = parseDate(value);
        } else {
          dbRow[baseCol] = value?.trim() || null;
        }
        continue;
      }
      const statusCol = statusMap.get(trimmedHeader);
      if (statusCol) {
        dbRow[statusCol] = parseDate(value);
      }
      // Unknown headers (Call Journal, etc.) are ignored on purpose.
    }

    // Never overwrite manual fields.
    delete dbRow.cr_size;
    delete dbRow.manual_notes;

    upsertRows.push(dbRow);
    if (existingSet.has(crNumber)) updated++;
    else inserted++;
  }

  // Upsert in chunks
  const chunkSize = 200;
  for (let i = 0; i < upsertRows.length; i += chunkSize) {
    const chunk = upsertRows.slice(i, i + chunkSize);
    const { error } = await supabase
      .from("crs")
      .upsert(chunk, { onConflict: "cr_number" });
    if (error) errors.push(error.message);
  }

  return { totalRows: rows.length, inserted, updated, skipped, errors };
}