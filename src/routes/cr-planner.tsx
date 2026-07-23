import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
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
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import { addWorkingDays } from "@/lib/working-days";
import {
  addCrsToPlanner,
  addDeploymentMasterDate,
  listActiveCrsForPlanner,
  listDeploymentMasterDates,
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
  const { role, isLoading } = useAppUser();
  const navigate = useNavigate();
  const canAccess = role === "ITPM";

  useEffect(() => {
    if (!isLoading && !canAccess) navigate({ to: "/" });
  }, [isLoading, canAccess, navigate]);

  if (isLoading || !canAccess) return null;

  return <CrPlannerView />;
}

function CrPlannerView() {
  const qc = useQueryClient();
  const listActiveFn = useServerFn(listActiveCrsForPlanner);
  const addToPlannerFn = useServerFn(addCrsToPlanner);
  const listGridFn = useServerFn(listPlannerGrid);
  const listMasterDatesFn = useServerFn(listDeploymentMasterDates);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [sortKey, setSortKey] = useState<SortKey>("dateModified");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const activeCrs = useQuery({
    queryKey: ["cr-planner-active-crs"],
    queryFn: () => listActiveFn(),
  });

  const grid = useQuery({
    queryKey: ["cr-planner-grid"],
    queryFn: () => listGridFn(),
  });

  const masterDates = useQuery({
    queryKey: ["cr-planner-master-dates"],
    queryFn: () => listMasterDatesFn(),
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

  return (
    <AppShell>
      <PageHeader
        title="CR Planner"
        description="Plan Development, SIT, UAT, and Production timelines for active CRs."
      />
      <PageBody>
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
            <AddMasterDateDialog masterDatesQueryKey={["cr-planner-master-dates"]} />
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
                  <SortHead k="devResource" label="Developer" />
                  <SortHead k="devEffort" label="Dev Effort" className="text-right" />
                  <SortHead k="devStartDate" label="Dev Start Date" />
                  <SortHead k="devEndDate" label="Dev End Date" />
                  <SortHead k="sitEffort" label="SIT Effort" className="text-right" />
                  <SortHead k="sitStartDate" label="SIT Start Date" />
                  <SortHead k="uatDate" label="UAT Date" />
                  <SortHead k="prodDate" label="PROD Date" />
                  <TableHead>Remarks</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paged.map((row) => (
                  <PlannerGridRowView
                    key={row.crNumber}
                    row={row}
                    masterDates={masterDates.data ?? []}
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

function AddMasterDateDialog({ masterDatesQueryKey }: { masterDatesQueryKey: string[] }) {
  const qc = useQueryClient();
  const addDateFn = useServerFn(addDeploymentMasterDate);
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState<Date | undefined>(undefined);
  const [application, setApplication] = useState("");

  const addDate = useMutation({
    mutationFn: () =>
      addDateFn({
        data: {
          deploymentDate: format(date!, "yyyy-MM-dd"),
          application: application.trim() || null,
        },
      }),
    onSuccess: () => {
      toast.success("Deployment Master date added");
      setOpen(false);
      setDate(undefined);
      setApplication("");
      qc.invalidateQueries({ queryKey: masterDatesQueryKey });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Plus className="size-3.5 mr-1" /> Add Deployment Master Date
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Deployment Master Date</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="w-full justify-start font-normal">
                {date ? format(date, "dd-MMM-yyyy") : "Pick a date…"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0">
              <Calendar mode="single" selected={date} onSelect={setDate} />
            </PopoverContent>
          </Popover>
          <Input
            placeholder="Application (optional)"
            value={application}
            onChange={(e) => setApplication(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button disabled={!date || addDate.isPending} onClick={() => addDate.mutate()}>
            {addDate.isPending ? "Adding…" : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PlannerGridRowView({
  row,
  masterDates,
}: {
  row: PlannerGridRow;
  masterDates: { id: string; deployment_date: string; application: string | null }[];
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
      <TableCell className="text-xs whitespace-nowrap">{fmtTimestamp(row.dateCreated)}</TableCell>
      <TableCell className="text-xs whitespace-nowrap">{fmtTimestamp(row.dateModified)}</TableCell>
      <TableCell>{row.createdUser ?? "—"}</TableCell>
      <TableCell className="text-xs text-muted-foreground">{row.workflowStatus}</TableCell>
      <TableCell className="text-right tabular-nums">{ac == null ? "—" : `${ac}d`}</TableCell>
      <TableCell className="text-right tabular-nums">{am == null ? "—" : `${am}d`}</TableCell>

      <TableCell>
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
      </TableCell>

      <TableCell>
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
      </TableCell>

      <TableCell>
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
      </TableCell>

      <TableCell className="bg-muted text-xs whitespace-nowrap">
        {devEndDatePreview ? format(devEndDatePreview, "dd-MMM-yyyy") : "—"}
      </TableCell>

      <TableCell>
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
      </TableCell>

      <TableCell>
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
      </TableCell>

      <TableCell className="bg-muted text-xs whitespace-nowrap">
        {uatDatePreview ? format(uatDatePreview, "dd-MMM-yyyy") : "—"}
      </TableCell>

      <TableCell>
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
            {masterDates.map((m) => (
              <SelectItem key={m.id} value={m.deployment_date}>
                {fmtDate(m.deployment_date)}
                {m.application ? ` (${m.application})` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>

      <TableCell>
        <Textarea
          className="min-w-40"
          rows={1}
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          onBlur={() => {
            if ((row.remarks ?? "") !== remarks) update.mutate({});
          }}
        />
      </TableCell>
    </TableRow>
  );
}
