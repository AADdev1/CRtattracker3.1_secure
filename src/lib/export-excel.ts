// Client-side Excel export shared by the CR Repository and CR Planner
// "Export" buttons — builds a workbook from already-fetched/filtered rows
// and triggers a browser download, no server round trip (XLSX.writeFile
// detects the browser environment and saves via a Blob, per SheetJS docs).
// Same approach as test-cases.functions.ts's downloadTestCasesExcel.
import * as XLSX from "xlsx";

// Prefixing with a leading apostrophe is the standard "force text" marker
// — Excel/Sheets render it as literal text and never evaluate it — guards
// against formula injection from CR titles/remarks/notes that happen to
// start with =, +, -, or @.
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

export function sanitizeCell(value: string): string {
  return FORMULA_TRIGGER.test(value) ? `'${value}` : value;
}

export function downloadExcel(
  filename: string,
  sheetName: string,
  rows: Record<string, unknown>[],
) {
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  XLSX.writeFile(workbook, filename);
}
