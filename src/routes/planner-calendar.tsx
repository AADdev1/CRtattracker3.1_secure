import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  addMonths,
  differenceInCalendarDays,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { ChevronLeft, ChevronRight, Flag } from "lucide-react";
import { AppShell, PageBody, PageHeader } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAppUser } from "@/lib/app-user";
import { FEATURES } from "@/lib/release-config";
import { HARDCODED_HOLIDAYS_2026, isWorkingDay, toIsoDateKey } from "@/lib/working-days";
import { listPlannerGrid } from "@/lib/cr-planner.functions";

export const Route = createFileRoute("/planner-calendar")({
  head: () => ({ meta: [{ title: "Planner Calendar · Kpisavvy" }] }),
  component: PlannerCalendarPage,
});

const LANES = ["R1", "R2", "Tester"] as const;
type Lane = (typeof LANES)[number];
const ROW_H = 20; // px per stacked bar track within a lane
const LABEL_W = 56; // px, left-hand "R1/R2/Tester" label column

// Same "decent color, consistent per CR" family already used for
// deployment-stage-badge.tsx (bg-200/text-900 light, bg-900/text-100 dark).
// Hashed from the CR number so a given CR always gets the same color, in
// every lane, every month.
const PALETTE = [
  "bg-blue-200 text-blue-900 dark:bg-blue-900 dark:text-blue-100",
  "bg-orange-200 text-orange-900 dark:bg-orange-900 dark:text-orange-100",
  "bg-purple-200 text-purple-900 dark:bg-purple-900 dark:text-purple-100",
  "bg-emerald-200 text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100",
  "bg-rose-200 text-rose-900 dark:bg-rose-900 dark:text-rose-100",
  "bg-cyan-200 text-cyan-900 dark:bg-cyan-900 dark:text-cyan-100",
  "bg-amber-200 text-amber-900 dark:bg-amber-900 dark:text-amber-100",
  "bg-indigo-200 text-indigo-900 dark:bg-indigo-900 dark:text-indigo-100",
  "bg-teal-200 text-teal-900 dark:bg-teal-900 dark:text-teal-100",
  "bg-fuchsia-200 text-fuchsia-900 dark:bg-fuchsia-900 dark:text-fuchsia-100",
];

function colorForCr(crNumber: string): string {
  let hash = 0;
  for (let i = 0; i < crNumber.length; i++) hash = (hash * 31 + crNumber.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

const LANE_BG: Record<Lane, string> = {
  R1: "bg-blue-50/60 dark:bg-blue-950/20",
  R2: "bg-emerald-50/60 dark:bg-emerald-950/20",
  Tester: "bg-amber-50/60 dark:bg-amber-950/20",
};

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOLIDAY_SET = new Set(HARDCODED_HOLIDAYS_2026);

type PlannerRow = Awaited<ReturnType<typeof listPlannerGrid>>[number];
const EMPTY_ROWS: PlannerRow[] = [];

interface Bar {
  id: string;
  crNumber: string;
  title: string | null;
  lane: Lane;
  start: Date;
  end: Date;
  color: string;
}

// Plain `date` columns come back as bare "yyyy-MM-dd" — appending
// T00:00:00 parses as local midnight instead of UTC midnight (same fix as
// cr-planner.tsx's fmtDate, needed here for correct day-grid math).
function toLocalDate(iso: string): Date {
  return new Date(`${iso}T00:00:00`);
}

// One bar per CR per lane it occupies: R1/R2 during the Dev window, Tester
// during the SIT→UAT window. A CR only shows up if both ends of the
// relevant window are set — dev_end_date/uat_date are always
// server-calculated (never entered directly), so if they're present the
// range is always valid (end >= start).
function buildBars(rows: PlannerRow[]): Bar[] {
  const bars: Bar[] = [];
  for (const r of rows) {
    const color = colorForCr(r.crNumber);
    if ((r.devResource === "R1" || r.devResource === "R2") && r.devStartDate && r.devEndDate) {
      bars.push({
        id: `${r.crNumber}-dev`,
        crNumber: r.crNumber,
        title: r.title,
        lane: r.devResource,
        start: toLocalDate(r.devStartDate),
        end: toLocalDate(r.devEndDate),
        color,
      });
    }
    if (r.sitStartDate && r.uatDate) {
      bars.push({
        id: `${r.crNumber}-sit`,
        crNumber: r.crNumber,
        title: r.title,
        lane: "Tester",
        start: toLocalDate(r.sitStartDate),
        end: toLocalDate(r.uatDate),
        color,
      });
    }
  }
  return bars;
}

// Greedy interval-packing (classic "minimum meeting rooms" shape), done
// once across the whole dataset per lane — not per visible week — so a
// CR's bar sits on the same track every week it spans, instead of jumping
// to a different height as the calendar wraps.
function assignTracks(bars: Bar[]): {
  trackOf: Map<string, number>;
  maxTrack: Record<Lane, number>;
} {
  const trackOf = new Map<string, number>();
  const maxTrack = { R1: 1, R2: 1, Tester: 1 } as Record<Lane, number>;
  for (const lane of LANES) {
    const laneBars = bars
      .filter((b) => b.lane === lane)
      .sort((a, b) => a.start.getTime() - b.start.getTime());
    const trackEnds: number[] = [];
    for (const bar of laneBars) {
      let track = trackEnds.findIndex((end) => end < bar.start.getTime());
      if (track === -1) {
        track = trackEnds.length;
        trackEnds.push(bar.end.getTime());
      } else {
        trackEnds[track] = bar.end.getTime();
      }
      trackOf.set(bar.id, track);
    }
    maxTrack[lane] = Math.max(1, trackEnds.length);
  }
  return { trackOf, maxTrack };
}

function buildFlags(rows: PlannerRow[]): Map<string, { crNumber: string; title: string | null }[]> {
  const map = new Map<string, { crNumber: string; title: string | null }[]>();
  for (const r of rows) {
    if (!r.prodDate) continue;
    const list = map.get(r.prodDate) ?? [];
    list.push({ crNumber: r.crNumber, title: r.title });
    map.set(r.prodDate, list);
  }
  return map;
}

function buildWeeks(monthCursor: Date): Date[][] {
  const gridStart = startOfWeek(startOfMonth(monthCursor), { weekStartsOn: 1 });
  const gridEnd = endOfWeek(endOfMonth(monthCursor), { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });
  const weeks: Date[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  return weeks;
}

// Working days a bar occupies within [monthStart, monthEnd] only — a CR
// spanning multiple months counts toward each month separately, matching
// the calendar's own per-month view.
function workingDaysInMonth(bar: Bar, monthStart: Date, monthEnd: Date): number {
  const start = bar.start < monthStart ? monthStart : bar.start;
  const end = bar.end > monthEnd ? monthEnd : bar.end;
  if (start > end) return 0;
  let count = 0;
  const cursor = new Date(start);
  while (cursor <= end) {
    if (isWorkingDay(cursor, HOLIDAY_SET)) count++;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

interface LaneSummaryEntry {
  crNumber: string;
  title: string | null;
  days: number;
}

function buildMonthSummary(bars: Bar[], monthCursor: Date): Record<Lane, LaneSummaryEntry[]> {
  const monthStart = startOfMonth(monthCursor);
  const monthEnd = endOfMonth(monthCursor);
  const result: Record<Lane, LaneSummaryEntry[]> = { R1: [], R2: [], Tester: [] };
  for (const bar of bars) {
    const days = workingDaysInMonth(bar, monthStart, monthEnd);
    if (days > 0) result[bar.lane].push({ crNumber: bar.crNumber, title: bar.title, days });
  }
  for (const lane of LANES) result[lane].sort((a, b) => b.days - a.days);
  return result;
}

function PlannerCalendarPage() {
  const { role, isAdmin, isLoading } = useAppUser();
  const navigate = useNavigate();
  const canAccess = FEATURES.planner && (isAdmin || role === "ITPM");

  useEffect(() => {
    if (!isLoading && !canAccess) navigate({ to: "/" });
  }, [isLoading, canAccess, navigate]);

  if (isLoading || !canAccess) return null;

  return <PlannerCalendarView />;
}

function PlannerCalendarView() {
  const listGridFn = useServerFn(listPlannerGrid);
  const grid = useQuery({ queryKey: ["cr-planner-grid"], queryFn: () => listGridFn() });
  const [monthCursor, setMonthCursor] = useState(() => startOfMonth(new Date()));

  const rows = grid.data ?? EMPTY_ROWS;
  const bars = useMemo(() => buildBars(rows), [rows]);
  const flags = useMemo(() => buildFlags(rows), [rows]);
  const { trackOf, maxTrack } = useMemo(() => assignTracks(bars), [bars]);
  const weeks = useMemo(() => buildWeeks(monthCursor), [monthCursor]);
  const summary = useMemo(() => buildMonthSummary(bars, monthCursor), [bars, monthCursor]);

  return (
    <AppShell>
      <PageHeader
        title="Planner Calendar"
        description="R1, R2, and Tester workload from CR Planner, laid out across the month."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={() => setMonthCursor((m) => subMonths(m, 1))}
              aria-label="Previous month"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <div className="w-32 text-center font-medium">{format(monthCursor, "MMMM yyyy")}</div>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setMonthCursor((m) => addMonths(m, 1))}
              aria-label="Next month"
            >
              <ChevronRight className="size-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setMonthCursor(startOfMonth(new Date()))}
            >
              Today
            </Button>
          </div>
        }
      />
      <PageBody>
        <Card>
          <CardContent className="p-4 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
            <LegendSwatch label="R1" className={LANE_BG.R1} />
            <LegendSwatch label="R2" className={LANE_BG.R2} />
            <LegendSwatch label="Tester" className={LANE_BG.Tester} />
            <div className="flex items-center gap-1.5">
              <Flag className="size-3.5 text-rose-600" /> PROD Date
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <div className="min-w-[720px]">
              <div className="flex border-b bg-muted/40">
                <div style={{ width: LABEL_W }} className="shrink-0" />
                <div className="grid grid-cols-7 flex-1">
                  {WEEKDAY_LABELS.map((d) => (
                    <div key={d} className="px-2 py-2 text-xs font-medium text-center">
                      {d}
                    </div>
                  ))}
                </div>
              </div>
              {weeks.map((week) => (
                <WeekRow
                  key={week[0].toISOString()}
                  week={week}
                  monthCursor={monthCursor}
                  bars={bars}
                  trackOf={trackOf}
                  maxTrack={maxTrack}
                  flags={flags}
                />
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="text-sm font-medium mb-3">
              {format(monthCursor, "MMMM yyyy")} — Working Days by Resource
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {LANES.map((lane) => {
                const entries = summary[lane];
                const total = entries.reduce((sum, e) => sum + e.days, 0);
                return (
                  <div key={lane} className={cn("rounded-md p-3 text-sm", LANE_BG[lane])}>
                    <div className="font-semibold mb-2">{lane}</div>
                    {entries.length === 0 ? (
                      <div className="text-xs text-muted-foreground">
                        No working days this month.
                      </div>
                    ) : (
                      <ul className="space-y-1">
                        {entries.map((e) => (
                          <li key={e.crNumber} title={e.title ?? undefined}>
                            {e.days} day{e.days === 1 ? "" : "s"} on {e.crNumber}
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="font-medium mt-2 pt-2 border-t border-border/40">
                      Total: {total} day{total === 1 ? "" : "s"}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </PageBody>
    </AppShell>
  );
}

function LegendSwatch({ label, className }: { label: string; className: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={cn("size-3 rounded-sm border", className)} />
      {label}
    </div>
  );
}

function WeekRow({
  week,
  monthCursor,
  bars,
  trackOf,
  maxTrack,
  flags,
}: {
  week: Date[];
  monthCursor: Date;
  bars: Bar[];
  trackOf: Map<string, number>;
  maxTrack: Record<Lane, number>;
  flags: Map<string, { crNumber: string; title: string | null }[]>;
}) {
  const weekStart = week[0];
  const weekEnd = week[6];

  return (
    <div className="border-b last:border-b-0">
      <div className="flex">
        <div style={{ width: LABEL_W }} className="shrink-0" />
        <div className="grid grid-cols-7 flex-1">
          {week.map((day) => {
            const inMonth = isSameMonth(day, monthCursor);
            const holiday = !isWorkingDay(day, HOLIDAY_SET);
            const dayFlags = flags.get(toIsoDateKey(day)) ?? [];
            return (
              <div
                key={day.toISOString()}
                className={cn(
                  "border-r last:border-r-0 px-1.5 py-1 flex items-center justify-between text-xs min-h-8",
                  !inMonth && "bg-muted/30 text-muted-foreground/50",
                  holiday && inMonth && "bg-muted/20",
                )}
              >
                <span
                  className={cn(
                    isToday(day) &&
                      "inline-flex items-center justify-center size-5 rounded-full bg-primary text-primary-foreground font-semibold",
                  )}
                >
                  {format(day, "d")}
                </span>
                {dayFlags.length > 0 && (
                  <span
                    title={dayFlags
                      .map((f) => `${f.crNumber}${f.title ? " — " + f.title : ""}`)
                      .join(", ")}
                  >
                    <Flag className="size-3 text-rose-600 shrink-0" />
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {LANES.map((lane) => (
        <div key={lane} className="flex">
          <div
            style={{ width: LABEL_W }}
            className="shrink-0 flex items-center justify-center text-[10px] font-medium text-muted-foreground border-r bg-muted/20"
          >
            {lane}
          </div>
          <LaneStrip
            lane={lane}
            weekStart={weekStart}
            weekEnd={weekEnd}
            bars={bars.filter((b) => b.lane === lane && b.start <= weekEnd && b.end >= weekStart)}
            trackOf={trackOf}
            rows={maxTrack[lane]}
          />
        </div>
      ))}
    </div>
  );
}

function LaneStrip({
  lane,
  weekStart,
  weekEnd,
  bars,
  trackOf,
  rows,
}: {
  lane: Lane;
  weekStart: Date;
  weekEnd: Date;
  bars: Bar[];
  trackOf: Map<string, number>;
  rows: number;
}) {
  return (
    <div
      className={cn("relative grid grid-cols-7 flex-1", LANE_BG[lane])}
      style={{ gridTemplateRows: `repeat(${rows}, ${ROW_H}px)` }}
    >
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="border-r border-border/30"
          style={{ gridColumn: i + 1, gridRow: `1 / span ${rows}` }}
        />
      ))}
      {bars.map((bar) => {
        const visStart = bar.start < weekStart ? weekStart : bar.start;
        const visEnd = bar.end > weekEnd ? weekEnd : bar.end;
        const startCol = differenceInCalendarDays(visStart, weekStart) + 1;
        const endCol = differenceInCalendarDays(visEnd, weekStart) + 1;
        const track = trackOf.get(bar.id) ?? 0;
        const continuesLeft = bar.start < weekStart;
        const continuesRight = bar.end > weekEnd;
        return (
          <div
            key={bar.id}
            title={`${bar.crNumber}${bar.title ? " — " + bar.title : ""} (${format(bar.start, "dd-MMM-yyyy")} – ${format(bar.end, "dd-MMM-yyyy")})`}
            className={cn(
              "mx-px my-px px-1 text-[10px] leading-[16px] truncate font-medium",
              bar.color,
              !continuesLeft && "rounded-l",
              !continuesRight && "rounded-r",
            )}
            style={{ gridColumn: `${startCol} / ${endCol + 1}`, gridRow: track + 1 }}
          >
            {bar.crNumber}
          </div>
        );
      })}
    </div>
  );
}
