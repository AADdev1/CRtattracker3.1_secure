import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Check, ChevronsUpDown, Download, History, X } from "lucide-react";
import { toast } from "sonner";
import { AppShell, PageBody, PageHeader } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
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
  addPlannerRemark,
  listActiveCrsForPlanner,
  listPlannedDeploymentDates,
  listPlannerGrid,
  listPlannerRemarks,
  updatePlannerEntry,
} from "@/lib/cr-planner.functions";

export const Route = createFileRoute("/cr-planner")({
  head: () => ({ meta: [{ title: "CR Planner · Kpisavvy" }] }),
  component: CrPlannerPage,
});

const PAGE_SIZE = 25;
const DEV_RESOURCES = ["R1", "R2"] as const;

// For plain `date` columns — these come back as bare
// "yyyy-MM-dd" with no time or offset, so "T00:00:00" is
// appended to parse them as local midnight.
function fmtDate(d: string | null): string {
  return d ? format(new Date(`${d}T00:00:00`), "dd-MMM-yyyy") : "—";
}

// For `timestamptz` columns such as date_created / date_modified.
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
  | "uatSignOffDate"
  | "finalCrObservationDate"
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

  // Admin is read-only.
  // Writes remain ITPM-only server-side.
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

  // Active CR selection.
  const activeCrs = useQuery({
    queryKey: ["cr-planner-active-crs"],
    queryFn: () => listActiveFn(),
    enabled: canEdit,
  });

  // Planner grid.
  const grid = useQuery({
    queryKey: ["cr-planner-grid"],
    queryFn: () => listGridFn(),
  });

  // Planned deployment dates used by PROD Date.
  const plannedDates = useQuery({
    queryKey: ["cr-planner-planned-dates"],
    queryFn: () => listPlannedDatesFn(),
    enabled: canEdit,
  });

  const addToPlanner = useMutation({
    mutationFn: (crNumbers: string[]) =>
      addToPlannerFn({
        data: { crNumbers },
      }),

    onSuccess: (result) => {
      if (result.added.length > 0) {
        toast.success(`Added ${result.added.length} CR(s) to the planner.`);
      }

      if (result.skipped.length > 0) {
        toast.error(
          `Selected CR already exists in planner: ${result.skipped.join(", ")}`,
        );
      }

      setSelected(new Set());

      qc.invalidateQueries({
        queryKey: ["cr-planner-active-crs"],
      });

      qc.invalidateQueries({
        queryKey: ["cr-planner-grid"],
      });
    },

    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : String(e)),
  });

  function toggleSelected(crNumber: string) {
    setSelected((prev) => {
      const next = new Set(prev);

      if (next.has(crNumber)) {
        next.delete(crNumber);
      } else {
        next.add(crNumber);
      }

      return next;
    });
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
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
      (r) =>
        r.crNumber.toLowerCase().includes(t) ||
        (r.title ?? "").toLowerCase().includes(t),
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
          return r.dateCreated
            ? new Date(r.dateCreated).getTime()
            : null;

        case "dateModified":
          return r.dateModified
            ? new Date(r.dateModified).getTime()
            : null;

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

        case "uatSignOffDate":
          return r.uatSignOffDate;

        case "finalCrObservationDate":
          return r.finalCrObservationDate;

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

  const pageCount = Math.max(
    1,
    Math.ceil(sorted.length / PAGE_SIZE),
  );

  const currentPage = Math.min(page, pageCount);

  const paged = sorted.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );

  const SortHead = ({
    k,
    label,
    className,
  }: {
    k: SortKey;
    label: string;
    className?: string;
  }) => (
    <TableHead
      className={cn(
        "cursor-pointer select-none whitespace-nowrap",
        className,
      )}
      onClick={() => toggleSort(k)}
    >
      {label}

      {sortKey === k && (
        <span className="ml-1 text-xs">
          {sortDir === "asc" ? "▲" : "▼"}
        </span>
      )}
    </TableHead>
  );

  // Export all filtered/sorted rows.
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

        "UAT Sign Off Date": fmtDate(r.uatSignOffDate),

        "Final CR Observation Date": fmtDate(
          r.finalCrObservationDate,
        ),

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

    downloadExcel(
      `cr-planner-${new Date().toISOString().slice(0, 10)}.xlsx`,
      "CR Planner",
      rows,
    );
  }

  return (
    <AppShell>
      <PageHeader
        title="CR Planner"
        description="Plan Development, SIT, UAT, and Production timelines for active CRs."
        actions={
          <Button variant="outline" onClick={handleExport}>
            <Download />
            Export
          </Button>
        }
      />

      <PageBody>
        {canEdit && (
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="text-sm font-medium">
                Active CR Selection
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Popover
                  open={pickerOpen}
                  onOpenChange={setPickerOpen}
                >
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className="w-96 justify-between font-normal"
                    >
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
                        <CommandEmpty>
                          No active CRs found.
                        </CommandEmpty>

                        <CommandGroup>
                          {(activeCrs.data ?? []).map((c) => (
                            <CommandItem
                              key={c.cr_number}
                              value={`${c.cr_number} ${c.title ?? ""}`}
                              onSelect={() =>
                                toggleSelected(c.cr_number)
                              }
                            >
                              <Check
                                className={cn(
                                  "size-4",
                                  selected.has(c.cr_number)
                                    ? "opacity-100"
                                    : "opacity-0",
                                )}
                              />

                              {c.cr_number} -{" "}
                              {c.title ?? "(untitled)"}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>

                <Button
                  disabled={
                    selected.size === 0 ||
                    addToPlanner.isPending
                  }
                  onClick={() =>
                    addToPlanner.mutate(
                      Array.from(selected),
                    )
                  }
                >
                  {addToPlanner.isPending
                    ? "Adding…"
                    : "Add To Planner"}
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

                  <SortHead
                    k="devResource"
                    label="Developer"
                  />

                  <SortHead
                    k="devEffort"
                    label="Dev Effort"
                    className="text-right"
                  />

                  <SortHead
                    k="devStartDate"
                    label="Dev Start Date"
                  />

                  <SortHead
                    k="devEndDate"
                    label="Dev End Date"
                  />

                  <SortHead
                    k="sitEffort"
                    label="SIT Effort"
                    className="text-right"
                  />

                  <SortHead
                    k="sitStartDate"
                    label="SIT Start Date"
                  />

                  <SortHead
                    k="uatDate"
                    label="UAT Date"
                  />

                  <SortHead
                    k="uatSignOffDate"
                    label="UAT Sign Off Date"
                  />

                  <SortHead
                    k="finalCrObservationDate"
                    label="Final CR Observation Date"
                  />

                  <SortHead
                    k="prodDate"
                    label="PROD Date"
                  />

                  <TableHead>Remarks</TableHead>

                  <SortHead
                    k="dateCreated"
                    label="Date Created"
                  />

                  <SortHead
                    k="dateModified"
                    label="Date Modified"
                  />

                  <SortHead
                    k="createdUser"
                    label="Created User"
                  />

                  <SortHead
                    k="workflowStatus"
                    label="Workflow Status"
                  />

                  <SortHead
                    k="crAging"
                    label="CR Aging"
                    className="text-right"
                  />

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
                    <TableCell
                      colSpan={19}
                      className="text-center py-12 text-muted-foreground"
                    >
                      No CRs in the planner yet — select active
                      CRs above and click Add To Planner.
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
                <PaginationLink
                  href="#"
                  isActive
                  onClick={(e) => e.preventDefault()}
                >
                  {currentPage} / {pageCount}
                </PaginationLink>
              </PaginationItem>

              <PaginationItem>
                <PaginationNext
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    setPage((p) =>
                      Math.min(pageCount, p + 1),
                    );
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

  const [devResource, setDevResource] = useState(
    row.devResource ?? "",
  );

  const [devEffort, setDevEffort] = useState(
    row.devEffort != null
      ? String(row.devEffort)
      : "",
  );

  const [devStartDate, setDevStartDate] = useState<
    Date | undefined
  >(
    row.devStartDate
      ? new Date(`${row.devStartDate}T00:00:00`)
      : undefined,
  );

  const [sitEffort, setSitEffort] = useState(
    row.sitEffort != null
      ? String(row.sitEffort)
      : "",
  );

  const [sitStartDate, setSitStartDate] = useState<
    Date | undefined
  >(
    row.sitStartDate
      ? new Date(`${row.sitStartDate}T00:00:00`)
      : undefined,
  );

  // NEW: UAT Sign Off Date
  const [uatSignOffDate, setUatSignOffDate] = useState<
    Date | undefined
  >(
    row.uatSignOffDate
      ? new Date(`${row.uatSignOffDate}T00:00:00`)
      : undefined,
  );

  // NEW: Final CR Observation Date
  const [finalCrObservationDate, setFinalCrObservationDate] =
    useState<Date | undefined>(
      row.finalCrObservationDate
        ? new Date(
            `${row.finalCrObservationDate}T00:00:00`,
          )
        : undefined,
    );

  const [prodDate, setProdDate] = useState(
    row.prodDate ?? "",
  );

  const devEffortNum = parseInt(devEffort, 10);

  const devEndDatePreview =
    devStartDate &&
    Number.isInteger(devEffortNum) &&
    devEffortNum > 0
      ? addWorkingDays(devStartDate, devEffortNum)
      : null;

  const sitEffortNum = parseInt(sitEffort, 10);

  const uatDatePreview =
    sitStartDate &&
    Number.isInteger(sitEffortNum) &&
    sitEffortNum > 0
      ? addWorkingDays(sitStartDate, sitEffortNum)
      : null;

  const update = useMutation({
    mutationFn: (
      overrides: Partial<
        Parameters<typeof updateFn>[0]["data"]
      > = {},
    ) =>
      updateFn({
        data: {
          crNumber: row.crNumber,

          devResource: devResource || null,

          devEffort:
            Number.isInteger(devEffortNum) &&
            devEffortNum > 0
              ? devEffortNum
              : null,

          devStartDate: devStartDate
            ? format(devStartDate, "yyyy-MM-dd")
            : null,

          sitEffort:
            Number.isInteger(sitEffortNum) &&
            sitEffortNum > 0
              ? sitEffortNum
              : null,

          sitStartDate: sitStartDate
            ? format(sitStartDate, "yyyy-MM-dd")
            : null,

          // NEW
          uatSignOffDate: uatSignOffDate
            ? format(
                uatSignOffDate,
                "yyyy-MM-dd",
              )
            : null,

          // NEW
          finalCrObservationDate:
            finalCrObservationDate
              ? format(
                  finalCrObservationDate,
                  "yyyy-MM-dd",
                )
              : null,

          prodDate: prodDate || null,

          ...overrides,
        },
      }),

    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["cr-planner-grid"],
      });
    },

    onError: (e: unknown) =>
      toast.error(
        e instanceof Error
          ? e.message
          : String(e),
      ),
  });

  const ac = ageDays(row.dateCreated);
  const am = ageDays(row.dateModified);

  return (
    <TableRow>
      {/* CR Number */}
      <TableCell className="sticky left-0 z-10 w-[110px] min-w-[110px] bg-card font-medium whitespace-nowrap">
        {row.crNumber}
      </TableCell>

      {/* Title */}
      <TableCell className="sticky left-[110px] z-10 w-[220px] min-w-[220px] bg-card border-r whitespace-normal break-words align-top">
        {row.title}
      </TableCell>

      {/* Developer */}
      <TableCell>
        {canEdit ? (
          <Select
            value={devResource || undefined}
            onValueChange={(v) => {
              setDevResource(v);
              update.mutate({
                devResource: v,
              });
            }}
          >
            <SelectTrigger className="w-20 h-8">
              <SelectValue placeholder="—" />
            </SelectTrigger>

            <SelectContent>
              {DEV_RESOURCES.map((r) => (
                <SelectItem
                  key={r}
                  value={r}
                >
                  {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          devResource || "—"
        )}
      </TableCell>

      {/* Dev Effort */}
      <TableCell>
        {canEdit ? (
          <Input
            type="number"
            min={1}
            className="w-20 h-8"
            value={devEffort}
            onChange={(e) =>
              setDevEffort(e.target.value)
            }
            onBlur={() => {
              if (
                (row.devEffort != null
                  ? String(row.devEffort)
                  : "") !== devEffort
              ) {
                update.mutate({});
              }
            }}
          />
        ) : (
          devEffort || "—"
        )}
      </TableCell>

      {/* Dev Start Date */}
      <TableCell>
        {canEdit ? (
          <div className="flex items-center gap-1">
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-32 justify-start font-normal"
                >
                  {devStartDate
                    ? format(
                        devStartDate,
                        "dd-MMM-yyyy",
                      )
                    : "—"}
                </Button>
              </PopoverTrigger>

              <PopoverContent className="w-auto p-0">
                <Calendar
                  mode="single"
                  selected={devStartDate}
                  onSelect={(d) => {
                    setDevStartDate(d);

                    update.mutate({
                      devStartDate: d
                        ? format(
                            d,
                            "yyyy-MM-dd",
                          )
                        : null,
                    });
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
                  setDevStartDate(undefined);
                  setDevEffort("");

                  update.mutate({
                    devStartDate: null,
                    devEffort: null,
                  });
                }}
              >
                <X className="size-3" />
              </Button>
            )}
          </div>
        ) : devStartDate ? (
          format(
            devStartDate,
            "dd-MMM-yyyy",
          )
        ) : (
          "—"
        )}
      </TableCell>

      {/* Dev End Date */}
      <TableCell className="bg-muted text-xs whitespace-nowrap">
        {devEndDatePreview
          ? format(
              devEndDatePreview,
              "dd-MMM-yyyy",
            )
          : "—"}
      </TableCell>

      {/* SIT Effort */}
      <TableCell>
        {canEdit ? (
          <Input
            type="number"
            min={1}
            className="w-20 h-8"
            value={sitEffort}
            onChange={(e) =>
              setSitEffort(e.target.value)
            }
            onBlur={() => {
              if (
                (row.sitEffort != null
                  ? String(row.sitEffort)
                  : "") !== sitEffort
              ) {
                update.mutate({});
              }
            }}
          />
        ) : (
          sitEffort || "—"
        )}
      </TableCell>

      {/* SIT Start Date */}
      <TableCell>
        {canEdit ? (
          <div className="flex items-center gap-1">
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-32 justify-start font-normal"
                >
                  {sitStartDate
                    ? format(
                        sitStartDate,
                        "dd-MMM-yyyy",
                      )
                    : "—"}
                </Button>
              </PopoverTrigger>

              <PopoverContent className="w-auto p-0">
                <Calendar
                  mode="single"
                  selected={sitStartDate}
                  onSelect={(d) => {
                    setSitStartDate(d);

                    update.mutate({
                      sitStartDate: d
                        ? format(
                            d,
                            "yyyy-MM-dd",
                          )
                        : null,
                    });
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
                  setSitStartDate(undefined);
                  setSitEffort("");

                  update.mutate({
                    sitStartDate: null,
                    sitEffort: null,
                  });
                }}
              >
                <X className="size-3" />
              </Button>
            )}
          </div>
        ) : sitStartDate ? (
          format(
            sitStartDate,
            "dd-MMM-yyyy",
          )
        ) : (
          "—"
        )}
      </TableCell>

      {/* UAT Date - Calculated */}
      <TableCell className="bg-muted text-xs whitespace-nowrap">
        {uatDatePreview
          ? format(
              uatDatePreview,
              "dd-MMM-yyyy",
            )
          : "—"}
      </TableCell>

      {/* NEW: UAT Sign Off Date */}
      <TableCell>
        {canEdit ? (
          <div className="flex items-center gap-1">
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-32 justify-start font-normal"
                >
                  {uatSignOffDate
                    ? format(
                        uatSignOffDate,
                        "dd-MMM-yyyy",
                      )
                    : "—"}
                </Button>
              </PopoverTrigger>

              <PopoverContent className="w-auto p-0">
                <Calendar
                  mode="single"
                  selected={uatSignOffDate}
                  onSelect={(d) => {
                    setUatSignOffDate(d);

                    update.mutate({
                      uatSignOffDate: d
                        ? format(
                            d,
                            "yyyy-MM-dd",
                          )
                        : null,
                    });
                  }}
                />
              </PopoverContent>
            </Popover>

            {uatSignOffDate && (
              <Button
                variant="ghost"
                size="icon"
                className="size-6 shrink-0"
                title="Clear date"
                onClick={() => {
                  setUatSignOffDate(undefined);

                  update.mutate({
                    uatSignOffDate: null,
                  });
                }}
              >
                <X className="size-3" />
              </Button>
            )}
          </div>
        ) : uatSignOffDate ? (
          format(
            uatSignOffDate,
            "dd-MMM-yyyy",
          )
        ) : (
          "—"
        )}
      </TableCell>

      {/* NEW: Final CR Observation Date */}
      <TableCell>
        {canEdit ? (
          <div className="flex items-center gap-1">
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-32 justify-start font-normal"
                >
                  {finalCrObservationDate
                    ? format(
                        finalCrObservationDate,
                        "dd-MMM-yyyy",
                      )
                    : "—"}
                </Button>
              </PopoverTrigger>

              <PopoverContent className="w-auto p-0">
                <Calendar
                  mode="single"
                  selected={
                    finalCrObservationDate
                  }
                  onSelect={(d) => {
                    setFinalCrObservationDate(d);

                    update.mutate({
                      finalCrObservationDate:
                        d
                          ? format(
                              d,
                              "yyyy-MM-dd",
                            )
                          : null,
                    });
                  }}
                />
              </PopoverContent>
            </Popover>

            {finalCrObservationDate && (
              <Button
                variant="ghost"
                size="icon"
                className="size-6 shrink-0"
                title="Clear date"
                onClick={() => {
                  setFinalCrObservationDate(
                    undefined,
                  );

                  update.mutate({
                    finalCrObservationDate: null,
                  });
                }}
              >
                <X className="size-3" />
              </Button>
            )}
          </div>
        ) : finalCrObservationDate ? (
          format(
            finalCrObservationDate,
            "dd-MMM-yyyy",
          )
        ) : (
          "—"
        )}
      </TableCell>

      {/* PROD Date */}
      <TableCell>
        {canEdit ? (
          <div className="flex items-center gap-1">
            <Select
              value={prodDate || undefined}
              onValueChange={(v) => {
                setProdDate(v);

                update.mutate({
                  prodDate: v,
                });
              }}
            >
              <SelectTrigger className="w-36 h-8">
                <SelectValue placeholder="Pick date…" />
              </SelectTrigger>

              <SelectContent>
                {plannedDates.map((d) => (
                  <SelectItem
                    key={d.id}
                    value={d.deployment_date}
                  >
                    {fmtDate(
                      d.deployment_date,
                    )}{" "}
                    — {d.deployment_name}
                    {d.application
                      ? ` (${d.application})`
                      : ""}
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

                  update.mutate({
                    prodDate: null,
                  });
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

      {/* Remarks */}
      <TableCell>
        <RemarksCell
          crNumber={row.crNumber}
          title={row.title}
          workflowStatus={row.workflowStatus}
          latestRemark={row.remarks}
          canEdit={canEdit}
        />
      </TableCell>

      {/* Date Created */}
      <TableCell className="text-xs whitespace-nowrap">
        {fmtTimestamp(row.dateCreated)}
      </TableCell>

      {/* Date Modified */}
      <TableCell className="text-xs whitespace-nowrap">
        {fmtTimestamp(row.dateModified)}
      </TableCell>

      {/* Created User */}
      <TableCell>
        {row.createdUser ?? "—"}
      </TableCell>

      {/* Workflow Status */}
      <TableCell className="text-xs text-muted-foreground">
        {row.workflowStatus}
      </TableCell>

      {/* CR Aging */}
      <TableCell className="text-right tabular-nums">
        {ac == null ? "—" : `${ac}d`}
      </TableCell>

      {/* Last Updated Aging */}
      <TableCell className="text-right tabular-nums">
        {am == null ? "—" : `${am}d`}
      </TableCell>
    </TableRow>
  );
}

// CR Planner's Remarks cell — hovering shows the full remarks history in a
// popover preview; clicking opens a dialog with a few CR details, the same
// full history, and (ITPM only) a free-text box to add a new remark. Every
// addition is a new, dated, attributed entry — never an overwrite — via
// addPlannerRemark; the latest entry's text also becomes the row's
// `remarks` value (row.remarks), so the cell and the Excel export always
// show the most recent remark even before the dialog/hover fetch history.
function RemarksCell({
  crNumber,
  title,
  workflowStatus,
  latestRemark,
  canEdit,
}: {
  crNumber: string;
  title: string | null;
  workflowStatus: string | null;
  latestRemark: string | null;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const listFn = useServerFn(listPlannerRemarks);
  const addFn = useServerFn(addPlannerRemark);

  const [hoverOpen, setHoverOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [text, setText] = useState("");

  const historyEnabled = hoverOpen || dialogOpen;

  const history = useQuery({
    queryKey: ["cr-planner-remarks", crNumber],
    queryFn: () => listFn({ data: { crNumber } }),
    enabled: historyEnabled,
  });

  const submit = useMutation({
    mutationFn: () =>
      addFn({ data: { crNumber, remarkText: text } }),

    onSuccess: () => {
      toast.success("Remark added");
      setText("");

      qc.invalidateQueries({
        queryKey: ["cr-planner-remarks", crNumber],
      });

      qc.invalidateQueries({
        queryKey: ["cr-planner-grid"],
      });
    },

    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : String(e)),
  });

  const entries = history.data ?? [];

  const HistoryList = ({ empty }: { empty: string }) =>
    history.isLoading ? (
      <div className="text-base text-muted-foreground text-center py-6">
        Loading…
      </div>
    ) : entries.length === 0 ? (
      <div className="text-base text-muted-foreground text-center py-6">
        {empty}
      </div>
    ) : (
      <ol className="relative border-l-2 border-border ml-2 space-y-5">
        {entries.map((r) => (
          <li key={r.id} className="ml-5">
            <span className="absolute -left-[7px] size-3 rounded-full ring-2 ring-background bg-primary" />
            <div className="flex items-baseline gap-3">
              <span className="text-sm text-muted-foreground tabular-nums">
                {fmtTimestamp(r.created_at)}
              </span>
              <span className="text-sm font-medium text-muted-foreground">
                {r.created_by}
              </span>
            </div>
            <div className="text-base mt-1 whitespace-pre-wrap break-words">
              {r.remark_text}
            </div>
          </li>
        ))}
      </ol>
    );

  return (
    <>
      <HoverCard
        open={hoverOpen}
        onOpenChange={setHoverOpen}
        openDelay={200}
      >
        <HoverCardTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-1 max-w-48 text-left text-xs hover:underline"
            onClick={() => setDialogOpen(true)}
          >
            <History className="size-3 shrink-0 text-muted-foreground" />

            <span className="truncate">
              {latestRemark ||
                (canEdit ? "Add remark…" : "—")}
            </span>
          </button>
        </HoverCardTrigger>

        <HoverCardContent className="w-[28rem] p-5">
          <div className="text-base font-semibold mb-3">
            Remarks history
          </div>

          <div className="max-h-96 overflow-y-auto pr-1">
            <HistoryList empty="No remarks yet." />
          </div>
        </HoverCardContent>
      </HoverCard>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-2xl">
              Remarks — {crNumber}
            </DialogTitle>
          </DialogHeader>

          <div className="text-base text-muted-foreground space-y-1">
            <div>
              <span className="font-medium text-foreground">
                Title:
              </span>{" "}
              {title ?? "—"}
            </div>

            <div>
              <span className="font-medium text-foreground">
                Workflow Status:
              </span>{" "}
              {workflowStatus ?? "—"}
            </div>
          </div>

          <div className="space-y-5">
            {canEdit && (
              <div className="flex items-center gap-3">
                <Input
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Add a remark…"
                  className="h-11 text-base md:text-base"
                  onKeyDown={(e) => {
                    if (
                      e.key === "Enter" &&
                      text.trim() &&
                      !submit.isPending
                    ) {
                      submit.mutate();
                    }
                  }}
                />

                <Button
                  className="shrink-0 h-11 text-base"
                  disabled={!text.trim() || submit.isPending}
                  onClick={() => submit.mutate()}
                >
                  {submit.isPending ? "Saving…" : "Add"}
                </Button>
              </div>
            )}

            <div className="max-h-[28rem] overflow-y-auto pr-1">
              <HistoryList empty="No remarks posted yet." />
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
