// Shared ceilings for user-uploaded CSV/Excel files — defends against
// unbounded browser memory use during client-side parsing (Papa.parse /
// XLSX.read) and unbounded DB writes during the server-side upsert loop.
// Generous relative to this app's actual scale (the KPI engine's own
// comments cite ~300 CRs x 14 KPIs as the normal working size), so a
// legitimate import never comes close — this exists to reject a runaway
// or malicious file fast, with a clear error, rather than degrade the app.
export const MAX_UPLOAD_FILE_BYTES = 5 * 1024 * 1024; // 5 MB
export const MAX_UPLOAD_ROWS = 10_000;

function formatMb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

export function assertFileSizeOk(file: File): void {
  if (file.size > MAX_UPLOAD_FILE_BYTES) {
    throw new Error(
      `File is too large (${formatMb(file.size)} MB). Maximum is ${formatMb(MAX_UPLOAD_FILE_BYTES)} MB.`,
    );
  }
}

// Server-side counterpart to assertFileSizeOk (M5 remediation). The
// original file's bytes never reach the server — parsing (Papa.parse/
// XLSX.read) happens client-side, and only the parsed rows are sent over
// RPC — so a direct server-function call bypassing the UI has no "file" to
// size-check. This checks the actual thing the server receives instead:
// the serialized size of the rows payload, using the same 5 MB ceiling.
export function assertPayloadSizeOk(rows: unknown): void {
  const bytes = new TextEncoder().encode(JSON.stringify(rows)).length;
  if (bytes > MAX_UPLOAD_FILE_BYTES) {
    throw new Error(
      `Upload payload is too large (${formatMb(bytes)} MB). Maximum is ${formatMb(MAX_UPLOAD_FILE_BYTES)} MB.`,
    );
  }
}

export function assertRowCountOk(rowCount: number): void {
  if (rowCount > MAX_UPLOAD_ROWS) {
    // Locale pinned explicitly — this runs server-side, and formatting
    // shouldn't depend on the deployment host's default locale.
    throw new Error(
      `Too many rows (${rowCount.toLocaleString("en-US")}). This import is limited to ${MAX_UPLOAD_ROWS.toLocaleString("en-US")} rows.`,
    );
  }
}

// Separate ceilings for test result screenshots (binary image files, not
// CSV/Excel rows) — see test-result-screenshots.functions.ts. Not a
// repurposing of the row-oriented constants above: 8 MB accommodates a
// full-resolution phone/browser screenshot after client-side compression
// (compress-image.ts) still leaves headroom, and matches the Storage
// bucket's own file_size_limit set in the
// 20260813000000_test_result_screenshot_management.sql migration.
export const MAX_SCREENSHOT_FILE_BYTES = 8 * 1024 * 1024; // 8 MB
export const MAX_SCREENSHOT_BATCH_FILES = 100;
export const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp"]);

export function assertScreenshotFileOk(file: File): void {
  if (file.size > MAX_SCREENSHOT_FILE_BYTES) {
    throw new Error(
      `File is too large (${formatMb(file.size)} MB). Maximum is ${formatMb(MAX_SCREENSHOT_FILE_BYTES)} MB.`,
    );
  }
}

// TAGIC-IR-GL-001 §3.12: "Validate uploaded files are the expected type by
// checking file headers. Checking for file type by extension alone is not
// sufficient." Sniffs the actual magic bytes rather than trusting the
// filename extension or the browser-supplied file.type.
const IMAGE_SIGNATURES: { ext: string; check: (b: Uint8Array) => boolean }[] = [
  { ext: "jpg", check: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    ext: "png",
    check: (b) =>
      b[0] === 0x89 &&
      b[1] === 0x50 &&
      b[2] === 0x4e &&
      b[3] === 0x47 &&
      b[4] === 0x0d &&
      b[5] === 0x0a,
  },
  { ext: "gif", check: (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 },
  {
    ext: "webp",
    check: (b) =>
      b[0] === 0x52 &&
      b[1] === 0x49 &&
      b[2] === 0x46 &&
      b[3] === 0x46 &&
      b[8] === 0x57 &&
      b[9] === 0x45 &&
      b[10] === 0x42 &&
      b[11] === 0x50,
  },
  { ext: "bmp", check: (b) => b[0] === 0x42 && b[1] === 0x4d },
];

// Returns the sniffed extension family ("jpg" covers jpg/jpeg) or null if
// the header doesn't match any supported image signature.
export function sniffImageExtension(bytes: Uint8Array): string | null {
  const match = IMAGE_SIGNATURES.find((sig) => sig.check(bytes));
  return match?.ext ?? null;
}

// A claimed .jpg/.jpeg file is only required to sniff as "jpg" (both
// extensions map to the same JPEG signature); every other extension must
// match its own signature family exactly.
export function extensionMatchesSniffedType(claimedExt: string, sniffed: string | null): boolean {
  if (!sniffed) return false;
  const normalized = claimedExt.toLowerCase();
  if (sniffed === "jpg") return normalized === "jpg" || normalized === "jpeg";
  return normalized === sniffed;
}
