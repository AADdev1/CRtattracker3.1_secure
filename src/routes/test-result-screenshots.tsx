import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { z } from "zod";
import { AppShell, PageBody, PageHeader } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MultiSelectFilter } from "@/components/multi-select-filter";
import { ImageIcon, ChevronLeft, ChevronRight } from "lucide-react";
import { useAppUser } from "@/lib/app-user";
import { FEATURES } from "@/lib/release-config";
import { getTestCases } from "@/lib/test-cases.functions";
import {
  getScreenshotsForCr,
  listCrsForTestResults,
  naturalCompareTestCaseNumber,
} from "@/lib/test-result-screenshots.functions";

export const Route = createFileRoute("/test-result-screenshots")({
  head: () => ({ meta: [{ title: "Test Results · Kpisavvy" }] }),
  validateSearch: z.object({
    crNumber: z.string().optional(),
    testCaseIds: z.array(z.string()).optional(),
  }).parse,
  component: TestResultScreenshotsPage,
});

const ALL_SENTINEL = "__all__";

function TestResultScreenshotsPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const { isAdmin, role, isLoading: userLoading } = useAppUser();
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // No role and not Admin = no legitimate use for this screen — matches
  // the server-side assertHasRoleOrAdmin() gate on getScreenshotsForCr.
  const blocked = !userLoading && (!FEATURES.testing || (!isAdmin && role == null));

  useEffect(() => {
    if (blocked) navigate({ to: "/" });
  }, [blocked, navigate]);

  const crNumber = search.crNumber ?? null;
  const testCaseIds = search.testCaseIds ?? [];

  const crsQuery = useQuery({
    queryKey: ["test-result-crs"],
    queryFn: () => listCrsForTestResults(),
    enabled: !blocked,
  });

  const testCasesQuery = useQuery({
    queryKey: ["test-cases-for-result-filter", crNumber],
    queryFn: () => getTestCases({ data: { crNumber: crNumber! } }),
    enabled: !blocked && !!crNumber,
  });

  const screenshotsQuery = useQuery({
    queryKey: ["test-result-screenshots", crNumber, testCaseIds],
    queryFn: () => getScreenshotsForCr({ data: { crNumber: crNumber!, testCaseIds } }),
    enabled: !blocked && !!crNumber,
  });

  const groups = screenshotsQuery.data ?? [];

  // Flattened in the same order the groups render (numeric TC order, then
  // numeric sequence within each) so the lightbox can step through every
  // visible screenshot on the page, not just the ones in the group it was
  // opened from. Only screenshots with a live signed URL are navigable —
  // matches the thumbnails themselves being disabled when url is null.
  const flatShots = groups.flatMap((g) =>
    g.screenshots
      .filter((s) => s.url)
      .map((s) => ({
        id: s.id,
        url: s.url as string,
        testCaseNumber: g.testCaseNumber,
        sequence: s.sequence,
      })),
  );
  const current = lightboxIndex !== null ? flatShots[lightboxIndex] : null;
  const goPrev = () => setLightboxIndex((i) => (i !== null && i > 0 ? i - 1 : i));
  const goNext = () =>
    setLightboxIndex((i) => (i !== null && i < flatShots.length - 1 ? i + 1 : i));

  useEffect(() => {
    if (lightboxIndex === null) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "ArrowLeft") goPrev();
      else if (e.key === "ArrowRight") goNext();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lightboxIndex, flatShots.length]);

  if (userLoading || blocked) return null;

  const crs = crsQuery.data ?? [];
  const testCaseOptions = (testCasesQuery.data ?? [])
    .slice()
    .sort((a, b) => naturalCompareTestCaseNumber(a.test_case_number, b.test_case_number))
    .map((t) => ({ v: t.id, l: `TC${t.test_case_number} — ${t.test_case_name}` }));

  const virtualTcValues = testCaseIds.length === 0 ? [ALL_SENTINEL] : testCaseIds;

  function handleTcChange(newValues: string[]) {
    const clickedAllNow = newValues.includes(ALL_SENTINEL);
    const clickedAllBefore = virtualTcValues.includes(ALL_SENTINEL);
    const real =
      clickedAllNow && !clickedAllBefore ? [] : newValues.filter((v) => v !== ALL_SENTINEL);
    navigate({
      to: "/test-result-screenshots",
      search: { crNumber: crNumber!, testCaseIds: real.length > 0 ? real : undefined },
    });
  }

  return (
    <AppShell>
      <PageHeader
        title="Test Results"
        description="Browse uploaded test result screenshots by CR and Test Case."
      />
      <PageBody>
        <Card>
          <CardContent className="p-4 flex flex-wrap gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">CR Number</span>
              <Select
                value={crNumber ?? undefined}
                onValueChange={(v) =>
                  navigate({ to: "/test-result-screenshots", search: { crNumber: v } })
                }
              >
                <SelectTrigger className="w-56">
                  <SelectValue placeholder="Select a CR…" />
                </SelectTrigger>
                <SelectContent>
                  {crs.map((cr) => (
                    <SelectItem key={cr.cr_number} value={cr.cr_number}>
                      {cr.cr_number}
                      {cr.title ? ` — ${cr.title}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {crNumber && (
              <MultiSelectFilter
                label="Test Case"
                values={virtualTcValues}
                onChange={handleTcChange}
                options={[{ v: ALL_SENTINEL, l: "All" }, ...testCaseOptions]}
                placeholder="All"
                triggerClassName="w-64"
              />
            )}
          </CardContent>
        </Card>

        {!crNumber && (
          <Card>
            <CardContent className="p-12 text-center text-muted-foreground">
              Select a CR to view its test result screenshots.
            </CardContent>
          </Card>
        )}

        {crNumber && screenshotsQuery.isLoading && (
          <Card>
            <CardContent className="p-12 text-center text-muted-foreground">Loading…</CardContent>
          </Card>
        )}

        {crNumber && !screenshotsQuery.isLoading && groups.length === 0 && (
          <Card>
            <CardContent className="p-12 text-center text-muted-foreground">
              No test result screenshots for {crNumber} yet.
            </CardContent>
          </Card>
        )}

        {groups.map((g) => (
          <Card key={g.testCaseId ?? g.testCaseNumber}>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">
                TC{g.testCaseNumber}
                {g.testCaseName ? ` — ${g.testCaseName}` : ""}
              </CardTitle>
              {g.testCaseName === null && (
                <Badge variant="destructive">Test case no longer exists</Badge>
              )}
            </CardHeader>
            <CardContent className="flex flex-wrap gap-3">
              {g.screenshots.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="group relative size-28 rounded-md border overflow-hidden bg-muted"
                  onClick={() => {
                    const idx = flatShots.findIndex((x) => x.id === s.id);
                    if (idx !== -1) setLightboxIndex(idx);
                  }}
                  disabled={!s.url}
                >
                  {s.url ? (
                    <img
                      src={s.url}
                      alt={`TC${g.testCaseNumber} result ${s.sequence}`}
                      loading="lazy"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <ImageIcon className="size-6 text-muted-foreground" />
                    </div>
                  )}
                  <span className="absolute bottom-0 right-0 bg-black/60 text-white text-xs px-1.5 py-0.5 rounded-tl">
                    {s.sequence}
                  </span>
                </button>
              ))}
            </CardContent>
          </Card>
        ))}
      </PageBody>

      <Dialog open={lightboxIndex !== null} onOpenChange={(o) => !o && setLightboxIndex(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {current ? `TC${current.testCaseNumber} — Result ${current.sequence}` : ""}
            </DialogTitle>
          </DialogHeader>
          {current && (
            <div className="relative">
              <img
                src={current.url}
                alt={`TC${current.testCaseNumber} — Result ${current.sequence}`}
                className="w-full h-auto rounded-md"
              />
              {lightboxIndex !== null && lightboxIndex > 0 && (
                <button
                  type="button"
                  onClick={goPrev}
                  aria-label="Previous screenshot"
                  className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/60 text-white p-2 hover:bg-black/80"
                >
                  <ChevronLeft className="size-5" />
                </button>
              )}
              {lightboxIndex !== null && lightboxIndex < flatShots.length - 1 && (
                <button
                  type="button"
                  onClick={goNext}
                  aria-label="Next screenshot"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/60 text-white p-2 hover:bg-black/80"
                >
                  <ChevronRight className="size-5" />
                </button>
              )}
            </div>
          )}
          {lightboxIndex !== null && (
            <div className="text-center text-xs text-muted-foreground">
              {lightboxIndex + 1} of {flatShots.length}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
