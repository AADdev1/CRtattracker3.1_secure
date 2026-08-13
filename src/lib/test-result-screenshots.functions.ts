// Test Result Screenshot Management — Testers upload evidence screenshots
// against Approved test cases; every role views. Every upload entry point
// is CR-scoped by the time a file reaches here (a specific CR row on Test
// Case Upload, or a specific Test Case row on Test Case Review), so the
// CR is always known from context — filenames only need TC<i>(<j>).<ext>,
// e.g. TC1(1).jpg, with <j> optional (auto-assigned if omitted).
//
// New binary-file transport for this codebase: uploadScreenshot takes a
// FormData payload (one file per call) rather than the JSON-row pattern
// every other *.functions.ts upload uses (csv-import.ts, defect-import.ts,
// test-cases.functions.ts all parse client-side and POST parsed rows).
// createServerFn passes FormData straight through as a real FormData/File
// on the handler side — confirmed against this exact
// @tanstack/react-start version's server-functions-handler, which calls
// request.formData() whenever the content-type is multipart. One call per
// file, not one call for a whole bulk batch: the app deploys to Cloudflare
// Workers (nitro cloudflare target — see vite.config.ts), which caps
// subrequests per invocation around 50 on the bundled plan, and each
// screenshot write is several subrequests (storage read/upload + DB
// read/insert). This also gives "each file in a bulk batch is processed
// independently" for free, matching the requirements doc.
//
// No hard FK from test_result_screenshots to test_cases.id:
// test_case_number is free text with no unique constraint on
// (cr_number, test_case_number), and uploadTestCases
// (test-cases.functions.ts) deletes+reinserts every row for a CR on every
// re-upload, minting fresh ids — a hard FK would cascade-delete every
// screenshot on the next test-case re-upload. Matching is done here at the
// application layer by normalizing both sides (filename's <i>, stored
// test_case_number) to digits-only and comparing.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSessionUser, assertHasRoleOrAdmin } from "@/lib/gate.functions";
import { assertFeatureEnabled } from "@/lib/release-config";
import {
  assertScreenshotFileOk,
  IMAGE_EXTENSIONS,
  MAX_SCREENSHOT_BATCH_FILES,
  sniffImageExtension,
  extensionMatchesSniffedType,
} from "@/lib/upload-limits";
import { validated, text } from "@/lib/validation";
import { compressImageIfNeeded } from "@/lib/compress-image";
import type { Database } from "@/integrations/supabase/types";
import type { SupabaseClient } from "@supabase/supabase-js";

const BUCKET = "test-result-screenshots";
const SIGNED_URL_TTL_SECONDS = 300;
const MAX_AUTO_SEQUENCE_ATTEMPTS = 5;

const EXT_TO_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
};

// Bulk mode: every upload entry point in this app is CR-scoped by the
// time a file reaches here (the Tester clicked "Upload Test Results" for
// a specific CR row on the Test Case Upload page) — the CR is already
// known from context, not derived from the filename. The filename only
// needs to identify the Test Case (TC<i>) and, optionally, an explicit
// result sequence ((<j>)); anything before "TC" (a leftover CR prefix
// from the old <CRNumber>TC<i>(<j>) convention, or nothing at all) is
// ignored rather than validated — only anchored at the end so trailing
// junk after the extension can't sneak in.
const BULK_FILENAME_RE = /TC(\d+)(?:\((\d+)\))?\.([A-Za-z0-9]+)$/i;

// Test-Case-wise mode: CR + Test Case are already known from route
// context. An explicit sequence may be given as TC<i>(<j>) or bare (<j>);
// no match at all means the caller auto-assigns MAX+1.
const TC_CONTEXT_FILENAME_RE = /^(?:.*?TC(\d+))?\s*\((\d+)\)\.([A-Za-z0-9]+)$/i;

export function normalizeDigits(s: string): string {
  return s.replace(/\D+/g, "");
}

// Numeric-aware compare so Test Cases display as TC1, TC2, ... TC10, TC11
// — not TC1, TC10, TC11, TC2, TC3 (plain string sort). Non-numeric
// test_case_number values (dirty upload data) sort after all numeric
// ones, then alphabetically, so nothing silently disappears.
export function naturalCompareTestCaseNumber(a: string, b: string): number {
  const da = normalizeDigits(a);
  const db = normalizeDigits(b);
  if (da && db) return Number(da) - Number(db);
  if (da && !db) return -1;
  if (!da && db) return 1;
  return a.localeCompare(b);
}

function buildStoragePath(
  crNumber: string,
  tcNormalized: string,
  sequence: number,
  ext: string,
): string {
  return `${crNumber}/${tcNormalized}/${sequence}.${ext}`;
}

async function currentMaxSequence(
  supabaseAdmin: SupabaseClient<Database>,
  crNumber: string,
  tcNormalized: string,
): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from("test_result_screenshots")
    .select("sequence")
    .eq("cr_number", crNumber)
    .eq("test_case_number_normalized", tcNormalized)
    .order("sequence", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  return data?.[0]?.sequence ?? 0;
}

type ScreenshotRow = Database["public"]["Tables"]["test_result_screenshots"]["Row"];

// Tester (or Admin) only. One FormData payload per file: {crNumber,
// testCaseId?, file}. testCaseId present -> Test-Case-wise mode (sequence
// optional in the filename, auto-assigned if omitted); absent -> bulk
// mode (filename must carry CR + TC + sequence explicitly). Both modes
// require the resolved test case to be Approved before accepting the
// upload.
export const uploadScreenshot = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => {
    if (!(raw instanceof FormData)) throw new Error("Expected multipart form data");
    return raw;
  })
  .handler(async ({ data: formData }): Promise<ScreenshotRow> => {
    assertFeatureEnabled("testing");
    const { userName, isAdmin, role } = await requireSessionUser();
    if (!isAdmin && role !== "Tester") {
      throw new Error("Forbidden: only Testers can upload test result screenshots");
    }

    const crNumber = String(formData.get("crNumber") ?? "").trim();
    const testCaseIdRaw = formData.get("testCaseId");
    const testCaseId = typeof testCaseIdRaw === "string" && testCaseIdRaw ? testCaseIdRaw : null;
    const file = formData.get("file");
    if (!crNumber) throw new Error("CR number is required");
    if (!(file instanceof File)) throw new Error("No file provided");
    assertScreenshotFileOk(file);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: cr, error: crErr } = await supabaseAdmin
      .from("crs")
      .select("cr_number")
      .eq("cr_number", crNumber)
      .maybeSingle();
    if (crErr) throw new Error(crErr.message);
    if (!cr) throw new Error("CR not found");

    let tcNormalized: string;
    let tcRaw: string;
    let sequence: number | null; // null => auto-assign
    const rejectNotApproved = () => {
      throw new Error("Test case must be Approved before uploading test result screenshots");
    };

    if (testCaseId) {
      // --- Test-Case-wise mode ---
      const { data: tc, error: tcErr } = await supabaseAdmin
        .from("test_cases")
        .select("id, test_case_number, status")
        .eq("id", testCaseId)
        .eq("cr_number", crNumber)
        .maybeSingle();
      if (tcErr) throw new Error(tcErr.message);
      if (!tc) throw new Error("Test case not found for this CR");
      if (tc.status !== "Approved") rejectNotApproved();
      tcRaw = tc.test_case_number;
      tcNormalized = normalizeDigits(tcRaw);

      const m = file.name.match(TC_CONTEXT_FILENAME_RE);
      const explicitTcIndex = m?.[1];
      const explicitSeq = m?.[2];
      if (explicitTcIndex && tcNormalized && Number(explicitTcIndex) !== Number(tcNormalized)) {
        throw new Error(
          `Filename references TC${explicitTcIndex}, but you're uploading to TC${tcRaw}`,
        );
      }
      sequence = explicitSeq ? Number(explicitSeq) : null;
    } else {
      // --- Bulk mode ---
      const m = file.name.match(BULK_FILENAME_RE);
      if (!m) {
        throw new Error(`"${file.name}" doesn't match the required pattern TC<i>(<j>).<ext>`);
      }
      const [, tcIndex, seqStr] = m;

      const { data: testCases, error: tcListErr } = await supabaseAdmin
        .from("test_cases")
        .select("test_case_number, status")
        .eq("cr_number", crNumber);
      if (tcListErr) throw new Error(tcListErr.message);

      const matches = (testCases ?? []).filter(
        (t) =>
          normalizeDigits(t.test_case_number) &&
          Number(normalizeDigits(t.test_case_number)) === Number(tcIndex),
      );
      if (matches.length === 0) {
        throw new Error(`"${file.name}": Test Case ${tcIndex} does not exist for CR ${crNumber}`);
      }
      if (matches.length > 1) {
        throw new Error(
          `"${file.name}": Test Case ${tcIndex} is ambiguous for CR ${crNumber} — fix duplicate Test Case Nos for this CR first`,
        );
      }
      if (matches[0].status !== "Approved") rejectNotApproved();

      tcRaw = matches[0].test_case_number;
      tcNormalized = normalizeDigits(tcRaw);
      sequence = seqStr ? Number(seqStr) : null;
    }

    const claimedExt = (file.name.split(".").pop() ?? "").toLowerCase();
    if (!IMAGE_EXTENSIONS.has(claimedExt)) {
      throw new Error(`"${file.name}": unsupported file type .${claimedExt}`);
    }
    // TAGIC-IR-GL-001 §3.12: file type must be validated by header, not
    // extension/browser-supplied MIME type alone.
    const headerBytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    const sniffed = sniffImageExtension(headerBytes);
    if (!extensionMatchesSniffedType(claimedExt, sniffed)) {
      throw new Error(`"${file.name}": file content doesn't match its .${claimedExt} extension`);
    }

    const contentType = EXT_TO_MIME[claimedExt] ?? file.type;

    if (sequence !== null) {
      // --- Explicit sequence: insert-or-replace by design ---
      const path = buildStoragePath(crNumber, tcNormalized, sequence, claimedExt);
      const { data: existing, error: existingErr } = await supabaseAdmin
        .from("test_result_screenshots")
        .select("storage_path, file_extension")
        .eq("cr_number", crNumber)
        .eq("test_case_number_normalized", tcNormalized)
        .eq("sequence", sequence)
        .maybeSingle();
      if (existingErr) throw new Error(existingErr.message);
      // A prior result at this triple with a DIFFERENT extension lives at
      // a different object path — remove the stale object so it doesn't
      // linger once this upload replaces it.
      if (existing && existing.file_extension !== claimedExt) {
        await supabaseAdmin.storage.from(BUCKET).remove([existing.storage_path]);
      }

      const { error: uploadErr } = await supabaseAdmin.storage
        .from(BUCKET)
        .upload(path, file, { contentType, upsert: true });
      if (uploadErr) throw new Error(uploadErr.message);

      const { data: row, error: upsertErr } = await supabaseAdmin
        .from("test_result_screenshots")
        .upsert(
          {
            cr_number: crNumber,
            test_case_number_normalized: tcNormalized,
            test_case_number_raw: tcRaw,
            sequence,
            storage_path: path,
            file_extension: claimedExt,
            original_filename: file.name,
            uploaded_by: userName,
            uploaded_date: new Date().toISOString(),
          } as never,
          { onConflict: "cr_number,test_case_number_normalized,sequence" },
        )
        .select("*")
        .single();
      if (upsertErr) throw new Error(upsertErr.message);
      return row as ScreenshotRow;
    }

    // --- Auto-assign: MAX(sequence)+1, insert (not upsert) so a genuine
    // concurrent collision surfaces as a unique-constraint error we can
    // retry against a freshly recomputed max, rather than silently
    // overwriting another upload's just-written object. The DB row is
    // reserved before the storage write so a losing concurrent request
    // never clobbers the winner's already-uploaded file.
    let lastErrMessage = "Upload failed";
    for (let attempt = 0; attempt < MAX_AUTO_SEQUENCE_ATTEMPTS; attempt++) {
      const candidate = (await currentMaxSequence(supabaseAdmin, crNumber, tcNormalized)) + 1;
      const path = buildStoragePath(crNumber, tcNormalized, candidate, claimedExt);

      const { data: row, error: insertErr } = await supabaseAdmin
        .from("test_result_screenshots")
        .insert({
          cr_number: crNumber,
          test_case_number_normalized: tcNormalized,
          test_case_number_raw: tcRaw,
          sequence: candidate,
          storage_path: path,
          file_extension: claimedExt,
          original_filename: file.name,
          uploaded_by: userName,
          uploaded_date: new Date().toISOString(),
        } as never)
        .select("*")
        .single();

      if (insertErr) {
        lastErrMessage = insertErr.message;
        if (insertErr.code === "23505") continue; // someone else took this sequence — retry
        throw new Error(insertErr.message);
      }

      const { error: uploadErr } = await supabaseAdmin.storage
        .from(BUCKET)
        .upload(path, file, { contentType, upsert: true });
      if (uploadErr) {
        // Compensate: don't leave a metadata row pointing at a file that
        // was never actually written.
        await supabaseAdmin
          .from("test_result_screenshots")
          .delete()
          .eq("id", (row as ScreenshotRow).id);
        throw new Error(uploadErr.message);
      }
      return row as ScreenshotRow;
    }
    throw new Error(`${lastErrMessage} — please retry the upload`);
  });

// Open to any role/Admin — everyone views. Loads live test_cases for the
// CR to resolve display names and to filter by testCaseIds when given,
// mints batched signed URLs, groups by normalized TC number and sorts
// numerically. Rows whose normalized TC no longer matches any live test
// case still return (testCaseName: null) rather than vanishing — the UI
// surfaces these as orphaned instead of hiding them.
export const getScreenshotsForCr = createServerFn({ method: "GET" })
  .inputValidator(
    validated(z.object({ crNumber: text, testCaseIds: z.array(z.string()).optional() })),
  )
  .handler(async ({ data }) => {
    assertFeatureEnabled("testing");
    assertHasRoleOrAdmin(await requireSessionUser());
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: testCases, error: tcErr } = await supabaseAdmin
      .from("test_cases")
      .select("id, test_case_number, test_case_name")
      .eq("cr_number", data.crNumber);
    if (tcErr) throw new Error(tcErr.message);

    const liveByNormalized = new Map(
      (testCases ?? []).map((t) => [normalizeDigits(t.test_case_number), t]),
    );

    const allowedNormalized = data.testCaseIds?.length
      ? new Set(
          (testCases ?? [])
            .filter((t) => data.testCaseIds!.includes(t.id))
            .map((t) => normalizeDigits(t.test_case_number)),
        )
      : null;

    const { data: rows, error: rowsErr } = await supabaseAdmin
      .from("test_result_screenshots")
      .select("*")
      .eq("cr_number", data.crNumber);
    if (rowsErr) throw new Error(rowsErr.message);

    const filtered = (rows ?? []).filter(
      (r) => !allowedNormalized || allowedNormalized.has(r.test_case_number_normalized),
    );

    const paths = filtered.map((r) => r.storage_path);
    const { data: signedUrls } = paths.length
      ? await supabaseAdmin.storage.from(BUCKET).createSignedUrls(paths, SIGNED_URL_TTL_SECONDS)
      : { data: [] as { path: string | null; signedUrl: string }[] };
    const urlByPath = new Map((signedUrls ?? []).map((s) => [s.path, s.signedUrl]));

    const groups = new Map<
      string,
      {
        testCaseId: string | null;
        testCaseNumber: string;
        testCaseName: string | null;
        screenshots: ScreenshotRow[];
      }
    >();
    for (const r of filtered) {
      const live = liveByNormalized.get(r.test_case_number_normalized);
      const key = r.test_case_number_normalized;
      if (!groups.has(key)) {
        groups.set(key, {
          testCaseId: live?.id ?? null,
          testCaseNumber: live?.test_case_number ?? r.test_case_number_raw,
          testCaseName: live?.test_case_name ?? null,
          screenshots: [],
        });
      }
      groups.get(key)!.screenshots.push(r);
    }

    return Array.from(groups.values())
      .sort((a, b) => naturalCompareTestCaseNumber(a.testCaseNumber, b.testCaseNumber))
      .map((g) => ({
        ...g,
        screenshots: g.screenshots
          .slice()
          .sort((a, b) => a.sequence - b.sequence)
          .map((s) => ({ ...s, url: urlByPath.get(s.storage_path) ?? null })),
      }));
  });

// Populates the required CR dropdown on the centralized Test Results
// screen. Deliberately open to any role/Admin — everyone views, unlike
// listAllCrsForTesting (Tester/Admin-only) in test-cases.functions.ts.
export const listCrsForTestResults = createServerFn({ method: "GET" }).handler(async () => {
  assertFeatureEnabled("testing");
  assertHasRoleOrAdmin(await requireSessionUser());
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("crs")
    .select("cr_number, title")
    .order("cr_number");
  if (error) throw new Error(error.message);
  return data ?? [];
});

// --- Client-side helpers (build FormData, run compression, call the
// server function) — same client-parse/server-write split as
// uploadTestCaseExcel in test-cases.functions.ts. ---

export interface ScreenshotUploadResult {
  file: string;
  ok: boolean;
  message?: string;
}

export async function uploadScreenshotBulk(
  crNumber: string,
  files: File[],
): Promise<ScreenshotUploadResult[]> {
  if (files.length > MAX_SCREENSHOT_BATCH_FILES) {
    throw new Error(`Select at most ${MAX_SCREENSHOT_BATCH_FILES} files at once`);
  }
  const results: ScreenshotUploadResult[] = [];
  for (const file of files) {
    try {
      const compressed = await compressImageIfNeeded(file);
      const fd = new FormData();
      fd.set("crNumber", crNumber);
      fd.set("file", compressed, file.name);
      await uploadScreenshot({ data: fd });
      results.push({ file: file.name, ok: true });
    } catch (e) {
      results.push({
        file: file.name,
        ok: false,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return results;
}

export async function uploadScreenshotForTestCase(
  crNumber: string,
  testCaseId: string,
  file: File,
): Promise<ScreenshotUploadResult> {
  try {
    const compressed = await compressImageIfNeeded(file);
    const fd = new FormData();
    fd.set("crNumber", crNumber);
    fd.set("testCaseId", testCaseId);
    fd.set("file", compressed, file.name);
    await uploadScreenshot({ data: fd });
    return { file: file.name, ok: true };
  } catch (e) {
    return { file: file.name, ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
