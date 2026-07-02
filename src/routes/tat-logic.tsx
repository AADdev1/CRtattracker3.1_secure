import { createFileRoute } from "@tanstack/react-router";
import { AppShell, PageHeader, PageBody } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/tat-logic")({
  component: TatLogicPage,
  head: () => ({
    meta: [
      { title: "TAT Calculator Logic — Kpisavvy" },
      {
        name: "description",
        content:
          "How Kpisavvy computes KPI Turnaround Time: weekdays-only elapsed days, hold days, effective days, utilization, and Green/Amber/Red classification.",
      },
    ],
  }),
});

function TatLogicPage() {
  return (
    <AppShell>
      <PageHeader
        title="TAT Calculator Logic"
        description="Exactly how Kpisavvy turns workflow timestamps into KPI status."
      />
      <PageBody>
        <Card>
          <CardHeader>
            <CardTitle>1. Inputs to a KPI</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>Each KPI is configured with:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li><b>Start status</b> and <b>End status</b> — two workflow milestones.</li>
              <li><b>TAT per CR Size</b> — Small / Medium / Large targets (in working days).</li>
              <li><b>Warning %</b> — share of TAT after which status turns Amber.</li>
              <li><b>Excluded statuses</b> — workflow states that pause the timer for this KPI.</li>
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>2. Build the CR Timeline</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              Every populated workflow timestamp on the CR row is collected into one
              chronological list. This is the single source of truth for all KPIs on
              that CR.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>3. Locate Start and End</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <ul className="list-disc pl-5 space-y-1">
              <li><b>Start date</b> = earliest entry matching the KPI's start status.</li>
              <li><b>End date</b> = first entry <i>after</i> start matching the end status.</li>
              <li>If end has not occurred yet, the KPI is <b>in progress</b> and the current time is used as a running end.</li>
              <li>If start has not occurred yet, status = <b>Not Started</b>.</li>
              <li>If start exists but CR Size is blank, status = <b>Pending</b> (no TAT to compare against).</li>
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>4. Count Working Days (Weekends Excluded)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              Calendar time between two timestamps is walked one day at a time. Hours
              that fall on <b>Saturday or Sunday are dropped</b> from both elapsed and
              hold totals. Public holidays are <i>not</i> currently excluded.
            </p>
            <p className="font-mono bg-muted p-2 rounded text-xs">
              total_days = weekdayHours(start → end) / 24
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>5. Compute Hold Days</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              The timeline is walked segment by segment from start to end. A segment
              is the interval the CR spent inside one status. If that status is in
              the KPI's <b>Excluded Statuses</b>, the segment's weekday duration is
              added to <b>hold_days</b>.
            </p>
            <p>Multiple hold → resume cycles are supported — they simply accumulate.</p>
            <p className="font-mono bg-muted p-2 rounded text-xs">
              hold_days = Σ weekdayHours(segStart → segEnd) / 24, for each excluded segment
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>6. Effective Days, Remaining, Utilization</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="font-mono bg-muted p-2 rounded text-xs">
              effective_days = max(0, total_days − hold_days)<br />
              tat = TAT for the CR's size (Small | Medium | Large)<br />
              remaining_days = tat − effective_days<br />
              utilization_pct = (effective_days / tat) × 100
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>7. Classify Status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-start gap-3">
              <Badge className="bg-emerald-500 hover:bg-emerald-500">Green</Badge>
              <span>effective_days &lt; tat × (warning_pct / 100)</span>
            </div>
            <div className="flex items-start gap-3">
              <Badge className="bg-amber-500 hover:bg-amber-500">Amber</Badge>
              <span>tat × (warning_pct / 100) ≤ effective_days &lt; tat</span>
            </div>
            <div className="flex items-start gap-3">
              <Badge className="bg-red-500 hover:bg-red-500">Red</Badge>
              <span>effective_days ≥ tat (breached)</span>
            </div>
            <div className="flex items-start gap-3">
              <Badge variant="secondary">Pending</Badge>
              <span>Start status reached, but CR Size is not set yet.</span>
            </div>
            <div className="flex items-start gap-3">
              <Badge variant="outline">Not Started</Badge>
              <span>The KPI's start status has not been recorded on this CR.</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>8. When Recalculation Runs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <ul className="list-disc pl-5 space-y-1">
              <li>After a CR CSV import.</li>
              <li>After updating a CR's status from the CR Repository.</li>
              <li>After changing CR Size or Notes in CR Size Management.</li>
              <li>After editing a KPI definition or its excluded statuses.</li>
              <li>On demand via the <b>Recalculate KPIs</b> button.</li>
            </ul>
            <p className="text-muted-foreground">
              All results are written to one table (<span className="font-mono">kpi_results</span>) and
              every dashboard / worklist reads from there — there is no second copy of the math anywhere.
            </p>
          </CardContent>
        </Card>
      </PageBody>
    </AppShell>
  );
}