// Shared ceilings for user-uploaded CSV/Excel files — defends against
// unbounded browser memory use during client-side parsing (Papa.parse /
// XLSX.read) and unbounded DB writes during the server-side upsert loop.
// Generous relative to this app's actual scale (the KPI engine's own
// comments cite ~300 CRs x 14 KPIs as the normal working size), so a
// legitimate import never comes close — this exists to reject a runaway
// or malicious file fast, with a clear error, rather than degrade the app.
export const MAX_UPLOAD_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_UPLOAD_ROWS = 10_000;

export function assertFileSizeOk(file: File): void {
  if (file.size > MAX_UPLOAD_FILE_BYTES) {
    const mb = (bytes: number) => (bytes / (1024 * 1024)).toFixed(1);
    throw new Error(
      `File is too large (${mb(file.size)} MB). Maximum is ${mb(MAX_UPLOAD_FILE_BYTES)} MB.`,
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
