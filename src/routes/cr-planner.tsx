import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Check, ChevronsUpDown, Download, X } from "lucide-react";
import { toast } from "sonner";
import { AppShell, PageBody, PageHeader } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { cn } from "@/lib/utils";
import { useAppUser } from "@/lib/app-user";
import { FEATURES } from "@/lib/release-config";
import { addWorkingDays } from "@/lib/working-days";
import { downloadExcel, sanitizeCell } from "@/lib/export-excel";
import {
  addCrsToPlanner,
  listActiveCrsForPlanner,
  listPlannedDeploymentDates,
  listPlannerGrid,
  updatePlannerEntry,
} from "@/lib/cr-planner.functions";

export const Route = createFileRoute("/cr-planner")({
  head: () => ({ meta: [{ title: "CR Planner · Kpisavvy" }] }),
  component: CrPlannerPage,
});

const PAGE_SIZE = 25;
const DEV_RESOURCES = ["R1", "R2"] as const;

// For plain `date` columns (dev_start_date, prod_date, deployment_master's
// deployment_date) — these come back as bare "yyyy-MM-dd" with no time or
// offset, so "T00:00:00" is appended to parse them as local midnight
// instead of UTC midnight (avoids an off-by-one-day shift in negative-UTC
// timezones).
function fmtDate(d: string | null): string {
  return d ? format(new Date(`${d}T00:00:00`), "dd-MMM-yyyy") : "—";
}

// For `timestamptz` columns (crs.date_created / date_modified) — these
// already come back as a full ISO datetime with an offset (e.g.
// "2026-07-17T18:04:00+00:00"), so appending anything breaks parsing.
// Using fmtDate on these was the actual cause of the grid crashing a
// couple seconds after load, once real row data arrived.
function fmtTimestamp(d: string | null): string {
  return d ? format(new Date(d), "dd-MMM-yyyy") : "—";
}

function ageDays(d: string | null): number | null {
  return d ? Math.floor((Date.now() - new Date(d).getTime()) / 86400000) : null;
}

type SortKey =
  | "crNumber"
  | "title"
  | "dateCreated"
  | "dateModified"
  | "createdUser"
  | "workflowStatus"
  | "crAging"
  | "lastUpdatedAging"
  | "devResource"
  | "devEffort"
  | "devStartDate"
  | "devEndDate"
  | "sitEffort"
  | "sitStartDate"
  | "uatDate"
  | "prodDate";

type PlannerGridRow = Awaited<ReturnType<typeof listPlannerGrid>>[number];
const EMPTY_ROWS: PlannerGridRow[] = [];

function CrPlannerPage() {
  const { role, isAdmin, isLoading } = useAppUser();
  const navigate = useNavigate();
  const canAccess = FEATURES.planner && (role === "ITPM" || isAdmin);

  useEffect(() => {
    if (!isLoading && !canAccess) navigate({ to: "/" });
  }, [isLoading, canAccess, navigate]);

  if (isLoading || !canAccess) return null;

  // Admin gets the app-wide "read-only everywhere" baseline — view the
  // grid, no Add/edit controls. Writes stay ITPM-only server-side in
  // assertPlannerActor regardless of what the UI shows.
  return <CrPlannerView canEdit={role === "ITPM"} />;
}

function CrPlannerView({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const listActiveFn = useServerFn(listActiveCrsForPlanner);
  const addToPlannerFn = useServerFn(addCrsToPlanner);
  const listGridFn = useServerFn(listPlannerGrid);
  const listPlannedDatesFn = useServerFn(listPlannedDeploymentDates);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [sortKey, setSortKey] = useState<SortKey>("dateModified");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // Only needed for the Active CR Selection / Add To Planner flow, which
  // is hidden entirely for Admin — no point firing an ITPM-only-gated
  // request (assertPlannerActor) that would just 403.
  const activeCrs = useQuery({
    queryKey: ["cr-planner-active-crs"],
    queryFn: () => listActiveFn(),
    enabled: canEdit,
  });

  const grid = useQuery({
    queryKey: ["cr-planner-grid"],
    queryFn: () => listGridFn(),
  });

  // Read-only — mirrors the Deployment Planning module's Planned
  // schedules, no add/write capability from this page. Only needed to
  // populate the PROD Date dropdown, which Admin never sees.
  const plannedDates = useQuery({
    queryKey: ["cr-planner-planned-dates"],
    queryFn: () => listPlannedDatesFn(),
    enabled: canEdit,
  });

  const addToPlanner = useMutation({
    mutationFn: (crNumbers: string[]) => addToPlannerFn({ data: { crNumbers } }),
    onSuccess: (result) => {
      if (result.added.length > 0)
        toast.success(`Added ${result.added.length} CR(s) to the planner.`);
      if (result.skipped.length > 0) {
        toast.error(`Selected CR already exists in planner: ${result.skipped.join(", ")}`);
      }
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["cr-planner-active-crs"] });
      qc.invalidateQueries({ queryKey: ["cr-planner-grid"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  function toggleSelected(crNumber: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(crNumber)) next.delete(crNumber);
      else next.add(crNumber);
      return next;
    });
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("desc");
    }
    setPage(1);
  }

  const rows = grid.data ?? EMPTY_ROWS;

  const filtered = useMemo(() => {
    if (!q) return rows;
    const t = q.toLowerCase();
    return rows.filter(
      (r) => r.crNumber.toLowerCase().includes(t) || (r.title ?? "").toLowerCase().includes(t),
    );
  }, [rows, q]);

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    function value(r: PlannerGridRow): string | number | null {
      switch (sortKey) {
        case "crNumber":
          return r.crNumber;
        case "title":
          return r.title;
        case "dateCreated":
          return r.dateCreated ? new Date(r.dateCreated).getTime() : null;
        case "dateModified":
          return r.dateModified ? new Date(r.dateModified).getTime() : null;
        case "createdUser":
          return r.createdUser;
        case "workflowStatus":
          return r.workflowStatus;
        case "crAging":
          return ageDays(r.dateCreated);
        case "lastUpdatedAging":
          return ageDays(r.dateModified);
        case "devResource":
          return r.devResource;
        case "devEffort":
          return r.devEffort;
        case "devStartDate":
          return r.devStartDate;
        case "devEndDate":
          return r.devEndDate;
        case "sitEffort":
          return r.sitEffort;
        case "sitStartDate":
          return r.sitStartDate;
        case "uatDate":
          return r.uatDate;
        case "prodDate":
          return r.prodDate;
      }
    }
    return [...filtered].sort((a, b) => {
      const av = value(a);
      const bv = value(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }, [filtered, sortKey, sortDir]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const paged = sorted.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const SortHead = ({ k, label, className }: { k: SortKey; label: string; className?: string }) => (
    <TableHead
      className={cn("cursor-pointer select-none whitespace-nowrap", className)}
      onClick={() => toggleSort(k)}
    >
      {label}
      {sortKey === k && <span className="ml-1 text-xs">{sortDir === "asc" ? "▲" : "▼"}</span>}
    </TableHead>
  );

  // Exports every filtered/sorted row (not just the current page) — the
  // same `sorted` array the grid paginates over.
  function handleExport() {
    const rows = sorted.map((r) => {
      const ac = ageDays(r.dateCreated);
      const am = ageDays(r.dateModified);
      return {
        "CR Number": sanitizeCell(r.crNumber),
        Title: sanitizeCell(r.title ?? ""),
        Developer: sanitizeCell(r.devResource ?? ""),
        "Dev Effort": r.devEffort ?? "",
        "Dev Start Date": fmtDate(r.devStartDate),
        "Dev End Date": fmtDate(r.devEndDate),
        "SIT Effort": r.sitEffort ?? "",
        "SIT Start Date": fmtDate(r.sitStartDate),
        "UAT Date": fmtDate(r.uatDate),
        "PROD Date": fmtDate(r.prodDate),
        Remarks: sanitizeCell(r.remarks ?? ""),
        "Date Created": fmtTimestamp(r.dateCreated),
        "Date Modified": fmtTimestamp(r.dateModified),
        "Created User": sanitizeCell(r.createdUser ?? ""),
        "Workflow Status": sanitizeCell(r.workflowStatus ?? ""),
        "CR Aging": ac ?? "",
        "Last Updated Aging": am ?? "",
      };
    });
    downloadExcel(`cr-planner-${new Date().toISOString().slice(0, 10)}.xlsx`, "CR Planner", rows);
  }

  return (
    <AppShell>
      <PageHeader
        title="CR Planner"
        description="Plan Development, SIT, UAT, and Production timelines for active CRs."
        actions={
          <Button variant="outline" onClick={handleExport}>
            <Download /> Export
          </Button>
        }
      />
      <PageBody>
        {canEdit && (
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="text-sm font-medium">Active CR Selection</div>
              <div className="flex flex-wrap items-center gap-3">
                <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-96 justify-between font-normal">
                      {selected.size > 0
                        ? `${selected.size} CR(s) selected`
                        : "Search and select active CRs…"}
                      <ChevronsUpDown className="size-4 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-96 p-0">
                    <Command>
                      <CommandInput placeholder="Search CR number or title…" />
                      <CommandList>
                        <CommandEmpty>No active CRs found.</CommandEmpty>
                        <CommandGroup>
                          {(activeCrs.data ?? []).map((c) => (
                            <CommandItem
                              key={c.cr_number}
                              value={`${c.cr_number} ${c.title ?? ""}`}
                              onSelect={() => toggleSelected(c.cr_number)}
                            >
                              <Check
                                className={cn(
                                  "size-4",
                                  selected.has(c.cr_number) ? "opacity-100" : "opacity-0",
                                )}
                              />
                              {c.cr_number} - {c.title ?? "(untitled)"}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
                <Button
                  disabled={selected.size === 0 || addToPlanner.isPending}
                  onClick={() => addToPlanner.mutate(Array.from(selected))}
                >
                  {addToPlanner.isPending ? "Adding…" : "Add To Planner"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="p-4 flex flex-wrap items-center gap-3">
            <Input
              placeholder="Search planner by CR number or title…"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
              className="max-w-sm"
            />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <SortHead
                    k="crNumber"
                    label="CR Number"
                    className="sticky left-0 z-20 w-[110px] min-w-[110px] bg-card"
                  />
                  <SortHead
                    k="title"
                    label="Title"
                    className="sticky left-[110px] z-20 w-[220px] min-w-[220px] bg-card border-r whitespace-normal"
                  />
                  <SortHead k="devResource" label="Developer" />
                  <SortHead k="devEffort" label="Dev Effort" className="text-right" />
                  <SortHead k="devStartDate" label="Dev Start Date" />
                  <SortHead k="devEndDate" label="Dev End Date" />
                  <SortHead k="sitEffort" label="SIT Effort" className="text-right" />
                  <SortHead k="sitStartDate" label="SIT Start Date" />
                  <SortHead k="uatDate" label="UAT Date" />
                  <SortHead k="prodDate" label="PROD Date" />
                  <TableHead>Remarks</TableHead>
                  <SortHead k="dateCreated" label="Date Created" />
                  <SortHead k="dateModified" label="Date Modified" />
                  <SortHead k="createdUser" label="Created User" />
                  <SortHead k="workflowStatus" label="Workflow Status" />
                  <SortHead k="crAging" label="CR Aging" className="text-right" />
                  <SortHead
                    k="lastUpdatedAging"
                    label="Last Updated Aging"
                    className="text-right"
                  />
                </TableRow>
              </TableHeader>
              <TableBody>
                {paged.map((row) => (
                  <PlannerGridRowView
                    key={row.crNumber}
                    row={row}
                    plannedDates={plannedDates.data ?? []}
                    canEdit={canEdit}
                  />
                ))}
                {paged.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={17} className="text-center py-12 text-muted-foreground">
                      No CRs in the planner yet — select active CRs above and click Add To Planner.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {pageCount > 1 && (
          <Pagination>
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    setPage((p) => Math.max(1, p - 1));
                  }}
                />
              </PaginationItem>
              <PaginationItem>
                <PaginationLink href="#" isActive onClick={(e) => e.preventDefault()}>
                  {currentPage} / {pageCount}
                </PaginationLink>
              </PaginationItem>
              <PaginationItem>
                <PaginationNext
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    setPage((p) => Math.min(pageCount, p + 1));
                  }}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        )}
      </PageBody>
    </AppShell>
  );
}

function PlannerGridRowView({
  row,
  plannedDates,
  canEdit,
}: {
  row: PlannerGridRow;
  plannedDates: {
    id: string;
    deployment_name: string;
    application: string | null;
    deployment_date: string;
  }[];
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const updateFn = useServerFn(updatePlannerEntry);

  const [devResource, setDevResource] = useState(row.devResource ?? "");
  const [devEffort, setDevEffort] = useState(row.devEffort != null ? String(row.devEffort) : "");
  const [devStartDate, setDevStartDate] = useState<Date | undefined>(
    row.devStartDate ? new Date(`${row.devStartDate}T00:00:00`) : undefined,
  );
  const [sitEffort, setSitEffort] = useState(row.sitEffort != null ? String(row.sitEffort) : "");
  const [sitStartDate, setSitStartDate] = useState<Date | undefined>(
    row.sitStartDate ? new Date(`${row.sitStartDate}T00:00:00`) : undefined,
  );
  const [prodDate, setProdDate] = useState(row.prodDate ?? "");
  const [remarks, setRemarks] = useState(row.remarks ?? "");

  const devEffortNum = parseInt(devEffort, 10);
  const devEndDatePreview =
    devStartDate && Number.isInteger(devEffortNum) && devEffortNum > 0
      ? addWorkingDays(devStartDate, devEffortNum)
      : null;

  const sitEffortNum = parseInt(sitEffort, 10);
  const uatDatePreview =
    sitStartDate && Number.isInteger(sitEffortNum) && sitEffortNum > 0
      ? addWorkingDays(sitStartDate, sitEffortNum)
      : null;

  const update = useMutation({
    mutationFn: (overrides: Partial<Parameters<typeof updateFn>[0]["data"]> = {}) =>
      updateFn({
        data: {
          crNumber: row.crNumber,
          devResource: devResource || null,
          devEffort: Number.isInteger(devEffortNum) && devEffortNum > 0 ? devEffortNum : null,
          devStartDate: devStartDate ? format(devStartDate, "yyyy-MM-dd") : null,
          sitEffort: Number.isInteger(sitEffortNum) && sitEffortNum > 0 ? sitEffortNum : null,
          sitStartDate: sitStartDate ? format(sitStartDate, "yyyy-MM-dd") : null,
          prodDate: prodDate || null,
          remarks: remarks || null,
          ...overrides,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cr-planner-grid"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const ac = ageDays(row.dateCreated);
  const am = ageDays(row.dateModified);

  return (
    <TableRow>
      <TableCell className="sticky left-0 z-10 w-[110px] min-w-[110px] bg-card font-medium whitespace-nowrap">
        {row.crNumber}
      </TableCell>
      <TableCell className="sticky left-[110px] z-10 w-[220px] min-w-[220px] bg-card border-r whitespace-normal break-words align-top">
        {row.title}
      </TableCell>

      <TableCell>
        {canEdit ? (
          <Select
            value={devResource || undefined}
            onValueChange={(v) => {
              setDevResource(v);
              update.mutate({ devResource: v });
            }}
          >
            <SelectTrigger className="w-20 h-8">
              <SelectValue placeholder="—" />
            </SelectTrigger>
            <SelectContent>
              {DEV_RESOURCES.map((r) => (
                <SelectItem key={r} value={r}>
                  {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          devResource || "—"
        )}
      </TableCell>

      <TableCell>
        {canEdit ? (
          <Input
            type="number"
            min={1}
            className="w-20 h-8"
            value={devEffort}
            onChange={(e) => setDevEffort(e.target.value)}
            onBlur={() => {
              if ((row.devEffort != null ? String(row.devEffort) : "") !== devEffort)
                update.mutate({});
            }}
          />
        ) : (
          devEffort || "—"
        )}
      </TableCell>

      <TableCell>
        {canEdit ? (
          <div className="flex items-center gap-1">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="w-32 justify-start font-normal">
                  {devStartDate ? format(devStartDate, "dd-MMM-yyyy") : "—"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0">
                <Calendar
                  mode="single"
                  selected={devStartDate}
                  onSelect={(d) => {
                    setDevStartDate(d);
                    update.mutate({ devStartDate: d ? format(d, "yyyy-MM-dd") : null });
                  }}
                />
              </PopoverContent>
            </Popover>
            {devStartDate && (
              <Button
                variant="ghost"
                size="icon"
                className="size-6 shrink-0"
                title="Clear date"
                onClick={() => {
                  // Effort without a start date can't compute an end date, and
                  // fails the "Dev Start Date required if Dev Effort entered"
                  // rule server-side — clear both together, not just the date.
                  setDevStartDate(undefined);
                  setDevEffort("");
                  update.mutate({ devStartDate: null, devEffort: null });
                }}
              >
                <X className="size-3" />
              </Button>
            )}
          </div>
        ) : devStartDate ? (
          format(devStartDate, "dd-MMM-yyyy")
        ) : (
          "—"
        )}
      </TableCell>

      <TableCell className="bg-muted text-xs whitespace-nowrap">
        {devEndDatePreview ? format(devEndDatePreview, "dd-MMM-yyyy") : "—"}
      </TableCell>

      <TableCell>
        {canEdit ? (
          <Input
            type="number"
            min={1}
            className="w-20 h-8"
            value={sitEffort}
            onChange={(e) => setSitEffort(e.target.value)}
            onBlur={() => {
              if ((row.sitEffort != null ? String(row.sitEffort) : "") !== sitEffort)
                update.mutate({});
            }}
          />
        ) : (
          sitEffort || "—"
        )}
      </TableCell>

      <TableCell>
        {canEdit ? (
          <div className="flex items-center gap-1">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="w-32 justify-start font-normal">
                  {sitStartDate ? format(sitStartDate, "dd-MMM-yyyy") : "—"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0">
                <Calendar
                  mode="single"
                  selected={sitStartDate}
                  onSelect={(d) => {
                    setSitStartDate(d);
                    update.mutate({ sitStartDate: d ? format(d, "yyyy-MM-dd") : null });
                  }}
                />
              </PopoverContent>
            </Popover>
            {sitStartDate && (
              <Button
                variant="ghost"
                size="icon"
                className="size-6 shrink-0"
                title="Clear date"
                onClick={() => {
                  // Same reasoning as Dev Start Date's clear button — clear
                  // the paired effort too, or the server's "SIT Start Date
                  // required if SIT Effort entered" rule rejects it.
                  setSitStartDate(undefined);
                  setSitEffort("");
                  update.mutate({ sitStartDate: null, sitEffort: null });
                }}
              >
                <X className="size-3" />
              </Button>
            )}
          </div>
        ) : sitStartDate ? (
          format(sitStartDate, "dd-MMM-yyyy")
        ) : (
          "—"
        )}
      </TableCell>

      <TableCell className="bg-muted text-xs whitespace-nowrap">
        {uatDatePreview ? format(uatDatePreview, "dd-MMM-yyyy") : "—"}
      </TableCell>

      <TableCell>
        {canEdit ? (
          <div className="flex items-center gap-1">
            <Select
              value={prodDate || undefined}
              onValueChange={(v) => {
                setProdDate(v);
                update.mutate({ prodDate: v });
              }}
            >
              <SelectTrigger className="w-36 h-8">
                <SelectValue placeholder="Pick date…" />
              </SelectTrigger>
              <SelectContent>
                {plannedDates.map((d) => (
                  <SelectItem key={d.id} value={d.deployment_date}>
                    {fmtDate(d.deployment_date)} — {d.deployment_name}
                    {d.application ? ` (${d.application})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {prodDate && (
              <Button
                variant="ghost"
                size="icon"
                className="size-6 shrink-0"
                title="Clear date"
                onClick={() => {
                  setProdDate("");
                  update.mutate({ prodDate: null });
                }}
              >
                <X className="size-3" />
              </Button>
            )}
          </div>
        ) : prodDate ? (
          fmtDate(prodDate)
        ) : (
          "—"
        )}
      </TableCell>

      <TableCell>
        {canEdit ? (
          <Textarea
            className="min-w-40"
            rows={1}
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            onBlur={() => {
              if ((row.remarks ?? "") !== remarks) update.mutate({});
            }}
          />
        ) : (
          remarks || "—"
        )}
      </TableCell>

      <TableCell className="text-xs whitespace-nowrap">{fmtTimestamp(row.dateCreated)}</TableCell>
      <TableCell className="text-xs whitespace-nowrap">{fmtTimestamp(row.dateModified)}</TableCell>
      <TableCell>{row.createdUser ?? "—"}</TableCell>
      <TableCell className="text-xs text-muted-foreground">{row.workflowStatus}</TableCell>
      <TableCell className="text-right tabular-nums">{ac == null ? "—" : `${ac}d`}</TableCell>
      <TableCell className="text-right tabular-nums">{am == null ? "—" : `${am}d`}</TableCell>
    </TableRow>
  );
}
