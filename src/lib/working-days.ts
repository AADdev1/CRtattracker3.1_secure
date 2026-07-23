// Pure date-math for CR Planner — no DB/auth imports, so it runs
// identically in the browser (instant reactive preview as the user types)
// and inside a server function (authoritative recompute on save). Holidays
// are a plain yyyy-MM-dd string Set specifically so a future Holiday
// Master table can be swapped in later just by building that Set from a
// query instead of the hardcoded list below — addWorkingDays/isWorkingDay
// themselves never have to change.

export const HARDCODED_HOLIDAYS_2026: readonly string[] = [
  "2026-09-14", // Ganesh Chaturthi
  "2026-10-02", // Gandhi Jayanti
  "2026-10-20", // Dussehra
  "2026-11-10", // Diwali
  "2026-12-25", // Christmas
];

export function toIsoDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function isWorkingDay(d: Date, holidays: Set<string>): boolean {
  const dow = d.getDay(); // 0 = Sun, 6 = Sat
  if (dow === 0 || dow === 6) return false;
  return !holidays.has(toIsoDateKey(d));
}

// The start date itself counts as day 1 when it's a working day — matches
// the spec's worked example (09-Sep start + 5 effort -> 16-Sep).
export function addWorkingDays(
  start: Date,
  workingDays: number,
  holidays: Set<string> = new Set(HARDCODED_HOLIDAYS_2026),
): Date {
  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  let counted = 0;
  while (counted < workingDays) {
    if (isWorkingDay(cursor, holidays)) counted++;
    if (counted < workingDays) cursor.setDate(cursor.getDate() + 1);
  }
  return cursor;
}
