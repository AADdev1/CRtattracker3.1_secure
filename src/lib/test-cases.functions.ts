// Test Case Management — Tester upload + BA/ITPM approver review.
//
// No per-tester CR assignment: any Tester can upload test cases for any CR
// (a shared pool, unlike every other relation-scoped feature in this app).
// No versioning/audit history: re-uploading a CR's test cases deletes the
// existing rows and inserts the new set fresh at 'Pending' — the current
// rows are the only rows that ever exist for a CR.
//
// Uses the service-role client (RLS locked down — see
// supabase/migrations/20260703000000_lock_down_rls.sql), loaded dynamically
// so client.server.ts never reaches the client bundle (this file is
// reachable from route components). Excel parsing (XLSX.read) is safe to
// keep as a static import — the xlsx package works in both environments —
// but is only ever invoked client-side, mirroring the Papa.parse split in
// csv-import.ts.
import * as XLSX from "xlsx";
import { createServerFn } from "@tanstack/react-start";
import { requireSessionUser } from "@/lib/gate.functions";
import type { Database } from "@/integrations/supabase/types";
import type { SupabaseClient } from "@supabase/supabase-js";

export type TestCaseRow = Database["public"]["Tables"]["test_cases"]["Row"];

export interface TestCaseUploadRow {
  test_priority?: string | null;
  test_case_number: string;
  test_case_name: string;
  test_condition: string;
  expected_result: string;
  tester_comments?: string | null;
}

// Open to any authenticated user — used by CR Repository to show the real,
// test-case-derived testing percentage (tested / total) instead of a
// manually-entered number. Unscoped like the rest of test case management:
// a CR's completion isn't tied to who's viewing it.
export const getTestCaseCompletionByCr = createServerFn({ method: "GET" }).handler(async () => {
  await requireSessionUser();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: testCases, error } = await supabaseAdmin
    .from("test_cases")
    .select("cr_number, execution_status");
  if (error) throw new Error(error.message);

  const countByCr = new Map<string, number>();
  const testedCountByCr = new Map<string, number>();
  for (const t of testCases ?? []) {
    countByCr.set(t.cr_number, (countByCr.get(t.cr_number) ?? 0) + 1);
    if (t.execution_status === "Tested") {
      testedCountByCr.set(t.cr_number, (testedCountByCr.get(t.cr_number) ?? 0) + 1);
    }
  }

  return Array.from(countByCr.entries()).map(([crNumber, total]) => ({
    cr_number: crNumber,
    testCaseCount: total,
    testedCount: testedCountByCr.get(crNumber) ?? 0,
  }));
});

export const listAllCrsForTesting = createServerFn({ method: "GET" }).handler(async () => {
  const { isAdmin, role } = await requireSessionUser();
  if (!isAdmin && role !== "Tester")
    throw new Error("Forbidden: only Testers can view this screen");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const [{ data: crs, error: crErr }, { data: testCases, error: tcErr }] = await Promise.all([
    supabaseAdmin
      .from("crs")
      .select("cr_number, title, application, ba, itpm, workflow_status, is_dropped")
      .order("cr_number"),
    supabaseAdmin
      .from("test_cases")
      .select(
        "cr_number, status, execution_status, uploaded_date, uploaded_by, approved_by, needs_retest",
      ),
  ]);
  if (crErr) throw new Error(crErr.message);
  if (tcErr) throw new Error(tcErr.message);

  const statusByCr = new Map<string, string>();
  const countByCr = new Map<string, number>();
  const testedCountByCr = new Map<string, number>();
  const lastUploadByCr = new Map<string, string>();
  const uploadedByCr = new Map<string, string>();
  const approvedByCr = new Map<string, string | null>();
  const needsRetestByCr = new Map<string, boolean>();
  for (const t of testCases ?? []) {
    statusByCr.set(t.cr_number, t.status);
    countByCr.set(t.cr_number, (countByCr.get(t.cr_number) ?? 0) + 1);
    if (t.execution_status === "Tested") {
      testedCountByCr.set(t.cr_number, (testedCountByCr.get(t.cr_number) ?? 0) + 1);
    }
    const prev = lastUploadByCr.get(t.cr_number);
    if (!prev || t.uploaded_date > prev) {
      lastUploadByCr.set(t.cr_number, t.uploaded_date);
      uploadedByCr.set(t.cr_number, t.uploaded_by);
      approvedByCr.set(t.cr_number, t.approved_by);
    }
    if (t.needs_retest) needsRetestByCr.set(t.cr_number, true);
  }

  return (crs ?? []).map((cr) => ({
    ...cr,
    testCaseStatus: statusByCr.get(cr.cr_number) ?? "Pending",
    testCaseCount: countByCr.get(cr.cr_number) ?? 0,
    testedCount: testedCountByCr.get(cr.cr_number) ?? 0,
    lastUploadedDate: lastUploadByCr.get(cr.cr_number) ?? null,
    uploadedBy: uploadedByCr.get(cr.cr_number) ?? null,
    approvedBy: approvedByCr.get(cr.cr_number) ?? null,
    hasNeedsRetest: needsRetestByCr.get(cr.cr_number) ?? false,
  }));
});

// Tester (or Admin) only. Deletes any existing rows for the CR and inserts
// the new set fresh — a full re-upload replaces the batch outright.
export const uploadTestCases = createServerFn({ method: "POST" })
  .inputValidator((data: { crNumber: string; rows: TestCaseUploadRow[] }) => data)
  .handler(async ({ data }) => {
    const { userName, isAdmin, role } = await requireSessionUser();
    if (!isAdmin && role !== "Tester")
      throw new Error("Forbidden: only Testers can upload test cases");
    if (data.rows.length === 0) throw new Error("No test case rows to upload");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: cr, error: crErr } = await supabaseAdmin
      .from("crs")
      .select("cr_number")
      .eq("cr_number", data.crNumber)
      .maybeSingle();
    if (crErr) throw new Error(crErr.message);
    if (!cr) throw new Error("CR not found");

    const { data: existing, error: existingErr } = await supabaseAdmin
      .from("test_cases")
      .select("status")
      .eq("cr_number", data.crNumber)
      .limit(1);
    if (existingErr) throw new Error(existingErr.message);
    const currentStatus = existing?.[0]?.status ?? null;
    if (currentStatus === "Submitted" || currentStatus === "Approved") {
      throw new Error(`Cannot upload: test cases for this CR are already ${currentStatus}`);
    }

    data.rows.forEach((row, i) => {
      if (
        !row.test_case_number?.trim() ||
        !row.test_case_name?.trim() ||
        !row.test_condition?.trim() ||
        !row.expected_result?.trim()
      ) {
        throw new Error(
          `Row ${i + 1}: Test Case No, Test Case Name, Test Condition, and Expected Result are required`,
        );
      }
    });

    const { error: deleteErr } = await supabaseAdmin
      .from("test_cases")
      .delete()
      .eq("cr_number", data.crNumber);
    if (deleteErr) throw new Error(deleteErr.message);

    const nowIso = new Date().toISOString();
    const insertRows = data.rows.map((row) => ({
      cr_number: data.crNumber,
      test_priority: row.test_priority?.trim() || null,
      test_case_number: row.test_case_number.trim(),
      test_case_name: row.test_case_name.trim(),
      test_condition: row.test_condition.trim(),
      expected_result: row.expected_result.trim(),
      tester_comments: row.tester_comments?.trim() || null,
      uploaded_by: userName,
      uploaded_date: nowIso,
      status: "Pending" as const,
    }));

    const { error: insertErr } = await supabaseAdmin.from("test_cases").insert(insertRows as never);
    if (insertErr) throw new Error(insertErr.message);

    return { ok: true as const, count: insertRows.length };
  });

// Tester (or Admin) only. Only rows currently Pending move to Submitted —
// mirrors "tester can upload test cases for any pending CR."
export const submitTestCases = createServerFn({ method: "POST" })
  .inputValidator((data: { crNumber: string }) => data)
  .handler(async ({ data }) => {
    const { isAdmin, role } = await requireSessionUser();
    if (!isAdmin && role !== "Tester")
      throw new Error("Forbidden: only Testers can submit test cases");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: updated, error } = await supabaseAdmin
      .from("test_cases")
      .update({ status: "Submitted" } as never)
      .eq("cr_number", data.crNumber)
      .eq("status", "Pending")
      .select("id");
    if (error) throw new Error(error.message);
    if (!updated || updated.length === 0) {
      throw new Error("No pending test cases to submit for this CR");
    }
    return { ok: true as const };
  });

// Tester (or Admin) only, and only once the CR's test cases are Approved —
// per-row execution outcome, separate from the approval workflow status
// above. Defect Raised requires a defect id; any other status clears it.
export const updateExecutionStatus = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      testCaseId: string;
      executionStatus: Database["public"]["Enums"]["test_case_execution_status"];
      defectId?: string | null;
    }) => data,
  )
  .handler(async ({ data }) => {
    const { isAdmin, role } = await requireSessionUser();
    if (!isAdmin && role !== "Tester") {
      throw new Error("Forbidden: only Testers can update execution status");
    }
    if (data.executionStatus === "Defect Raised" && !data.defectId?.trim()) {
      throw new Error("Defect ID is required when marking a test case as Defect Raised");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error: fetchErr } = await supabaseAdmin
      .from("test_cases")
      .select("status")
      .eq("id", data.testCaseId)
      .maybeSingle();
    if (fetchErr) throw new Error(fetchErr.message);
    if (!row) throw new Error("Test case not found");
    if (row.status !== "Approved") {
      throw new Error("Execution status can only be set once the CR's test cases are Approved");
    }

    const { error } = await supabaseAdmin
      .from("test_cases")
      .update({
        execution_status: data.executionStatus,
        defect_id: data.executionStatus === "Defect Raised" ? data.defectId!.trim() : null,
        // Any Tester edit counts as "handled" — clears the auto-reset flag
        // set when a defect import found the previously-referenced defect
        // had closed.
        needs_retest: false,
      } as never)
      .eq("id", data.testCaseId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

// Approver (BA/ITPM flagged is_test_case_approver) or Admin only. Reuses
// the existing ba/itpm relation match — same mechanism as scoped-data.functions.ts
// — rather than a new per-CR approver table.
export const listSubmittedForApproval = createServerFn({ method: "GET" }).handler(async () => {
  const { userName, isAdmin, isTestCaseApprover } = await requireSessionUser();
  if (!isAdmin && !isTestCaseApprover) throw new Error("Forbidden");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: testCases, error: tcErr } = await supabaseAdmin
    .from("test_cases")
    .select("cr_number, uploaded_date, uploaded_by")
    .eq("status", "Submitted");
  if (tcErr) throw new Error(tcErr.message);

  const crNumbers = Array.from(new Set((testCases ?? []).map((t) => t.cr_number)));
  if (crNumbers.length === 0) return [];

  const { data: crs, error: crErr } = await supabaseAdmin
    .from("crs")
    .select("cr_number, title, application, ba, itpm")
    .in("cr_number", crNumbers);
  if (crErr) throw new Error(crErr.message);

  const countByCr = new Map<string, number>();
  const lastUploadByCr = new Map<string, string>();
  const uploadedByCr = new Map<string, string>();
  for (const t of testCases ?? []) {
    countByCr.set(t.cr_number, (countByCr.get(t.cr_number) ?? 0) + 1);
    const prev = lastUploadByCr.get(t.cr_number);
    if (!prev || t.uploaded_date > prev) {
      lastUploadByCr.set(t.cr_number, t.uploaded_date);
      uploadedByCr.set(t.cr_number, t.uploaded_by);
    }
  }

  return (crs ?? [])
    .filter((cr) => isAdmin || cr.ba === userName || cr.itpm === userName)
    .map((cr) => ({
      ...cr,
      testCaseCount: countByCr.get(cr.cr_number) ?? 0,
      lastUploadedDate: lastUploadByCr.get(cr.cr_number) ?? null,
      uploadedBy: uploadedByCr.get(cr.cr_number) ?? null,
    }));
});

// Approver or Admin only — per-row inline edit (auto-save on blur, same UX
// as manual_notes in cr-sizes.tsx).
export const updateApproverComment = createServerFn({ method: "POST" })
  .inputValidator((data: { testCaseId: string; comment: string | null }) => data)
  .handler(async ({ data }) => {
    const { isAdmin, isTestCaseApprover } = await requireSessionUser();
    if (!isAdmin && !isTestCaseApprover) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("test_cases")
      .update({ approver_comments: data.comment } as never)
      .eq("id", data.testCaseId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

async function assertApproverForCr(
  supabaseAdmin: SupabaseClient<Database>,
  crNumber: string,
  userName: string,
  isAdmin: boolean,
) {
  if (isAdmin) return;
  const { data: cr, error } = await supabaseAdmin
    .from("crs")
    .select("ba, itpm")
    .eq("cr_number", crNumber)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!cr || (cr.ba !== userName && cr.itpm !== userName)) {
    throw new Error("Forbidden: you are not the BA/ITPM for this CR");
  }
}

// Approver or Admin only — every Submitted row for the CR moves to
// Approved, stamped with who/when.
export const approveTestCases = createServerFn({ method: "POST" })
  .inputValidator((data: { crNumber: string }) => data)
  .handler(async ({ data }) => {
    const { userName, isAdmin, isTestCaseApprover } = await requireSessionUser();
    if (!isAdmin && !isTestCaseApprover) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await assertApproverForCr(supabaseAdmin, data.crNumber, userName, isAdmin);

    const { data: updated, error } = await supabaseAdmin
      .from("test_cases")
      .update({
        status: "Approved",
        approved_by: userName,
        approval_date: new Date().toISOString(),
      } as never)
      .eq("cr_number", data.crNumber)
      .eq("status", "Submitted")
      .select("id");
    if (error) throw new Error(error.message);
    if (!updated || updated.length === 0)
      throw new Error("No submitted test cases to approve for this CR");
    return { ok: true as const };
  });

// Approver or Admin only — every Submitted row for the CR moves to Sent
// Back for Revision. overallComment (if given) fills any row missing its
// own approver_comments; rows with an existing comment keep it as-is.
export const sendBackTestCases = createServerFn({ method: "POST" })
  .inputValidator((data: { crNumber: string; overallComment?: string | null }) => data)
  .handler(async ({ data }) => {
    const { userName, isAdmin, isTestCaseApprover } = await requireSessionUser();
    if (!isAdmin && !isTestCaseApprover) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await assertApproverForCr(supabaseAdmin, data.crNumber, userName, isAdmin);

    const { data: rows, error: fetchErr } = await supabaseAdmin
      .from("test_cases")
      .select("id, approver_comments")
      .eq("cr_number", data.crNumber)
      .eq("status", "Submitted");
    if (fetchErr) throw new Error(fetchErr.message);
    if (!rows || rows.length === 0)
      throw new Error("No submitted test cases to send back for this CR");

    const overallComment = data.overallComment?.trim() || null;
    const idsMissingComment = rows.filter((r) => !r.approver_comments?.trim()).map((r) => r.id);
    const idsWithComment = rows.filter((r) => r.approver_comments?.trim()).map((r) => r.id);

    if (idsWithComment.length > 0) {
      const { error } = await supabaseAdmin
        .from("test_cases")
        .update({ status: "Sent Back for Revision" } as never)
        .in("id", idsWithComment);
      if (error) throw new Error(error.message);
    }
    if (idsMissingComment.length > 0) {
      const { error } = await supabaseAdmin
        .from("test_cases")
        .update({ status: "Sent Back for Revision", approver_comments: overallComment } as never)
        .in("id", idsMissingComment);
      if (error) throw new Error(error.message);
    }
    return { ok: true as const };
  });

// Unscoped CR header lookup (cr_number/title/application/ba/itpm/status)
// for the test-case review screen — deliberately NOT relation-scoped like
// getScopedCrs, since any Tester/approver can look at any CR's test cases.
export const getCrTestingHeader = createServerFn({ method: "GET" })
  .inputValidator((data: { crNumber: string }) => data)
  .handler(async ({ data }) => {
    await requireSessionUser();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: cr, error } = await supabaseAdmin
      .from("crs")
      .select("cr_number, title, application, ba, itpm, workflow_status")
      .eq("cr_number", data.crNumber)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!cr) throw new Error("CR not found");
    return cr;
  });

// Returns every test case row for a CR. Open to any authenticated user —
// used both by the Tester's read-only "View Status" and the approver's
// review screen; each route enforces its own authorization on top.
export const getTestCases = createServerFn({ method: "GET" })
  .inputValidator((data: { crNumber: string }) => data)
  .handler(async ({ data }) => {
    await requireSessionUser();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("test_cases")
      .select("*")
      .eq("cr_number", data.crNumber)
      .order("test_case_number");
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

const TEST_CASE_FIELD_MAP: Record<string, keyof TestCaseUploadRow> = {
  "Test Priority": "test_priority",
  Priority: "test_priority",
  "Test Case No": "test_case_number",
  "Test Case No.": "test_case_number",
  "Test Case Number": "test_case_number",
  "Test Case Name": "test_case_name",
  "Test Condition": "test_condition",
  "Expected Result": "expected_result",
  "Tester Comments": "tester_comments",
  Comments: "tester_comments",
};

function parseTestCaseWorkbook(buffer: ArrayBuffer): TestCaseUploadRow[] {
  const workbook = XLSX.read(buffer, { type: "array" });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return [];
  const sheet = workbook.Sheets[firstSheetName];
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });

  return json
    .map((row) => {
      const mapped: TestCaseUploadRow = {
        test_case_number: "",
        test_case_name: "",
        test_condition: "",
        expected_result: "",
      };
      for (const [header, value] of Object.entries(row)) {
        const col = TEST_CASE_FIELD_MAP[header.trim()];
        if (col) mapped[col] = String(value ?? "").trim();
      }
      return mapped;
    })
    .filter((r) => r.test_case_number || r.test_case_name || r.test_condition || r.expected_result);
}

// Client-side parse (needs the browser File object) → server write, same
// split as importCrCsv in csv-import.ts.
export async function uploadTestCaseExcel(crNumber: string, file: File) {
  const buffer = await file.arrayBuffer();
  const rows = parseTestCaseWorkbook(buffer);
  if (rows.length === 0) throw new Error("The uploaded file has no test case rows");
  return uploadTestCases({ data: { crNumber, rows } });
}

// Builds a workbook client-side from already-fetched rows and triggers a
// browser download — no server round trip (XLSX.writeFile detects the
// browser environment and saves via a Blob, per SheetJS docs).
export function downloadTestCasesExcel(crNumber: string, rows: TestCaseRow[]) {
  const worksheet = XLSX.utils.json_to_sheet(
    rows.map((r) => ({
      "Test Case No": r.test_case_number,
      "Test Priority": r.test_priority ?? "",
      "Test Case Name": r.test_case_name,
      "Test Condition": r.test_condition,
      "Expected Result": r.expected_result,
      "Tester Comments": r.tester_comments ?? "",
      "Approver Comments": r.approver_comments ?? "",
      Status: r.status,
      "Uploaded By": r.uploaded_by,
      "Uploaded Date": r.uploaded_date,
      "Approved By": r.approved_by ?? "",
      "Approval Date": r.approval_date ?? "",
      "Execution Status": r.execution_status,
      "Defect ID": r.defect_id ?? "",
    })),
  );
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Test Cases");
  XLSX.writeFile(workbook, `${crNumber}-test-cases.xlsx`);
}
