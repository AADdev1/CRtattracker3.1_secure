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
