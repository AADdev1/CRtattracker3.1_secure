import { Button } from "@/components/ui/button";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { recalculateAllKpis } from "@/lib/kpi-engine";
import { toast } from "sonner";

export function RefreshKpiButton() {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: recalculateAllKpis,
    onSuccess: (r) => {
      toast.success(
        `KPI Engine ran: ${r.resultsWritten} result(s) for ${r.crsProcessed} CRs × ${r.kpisProcessed} KPIs.`,
      );
      qc.invalidateQueries();
    },
    onError: (e: unknown) => {
      toast.error(`Engine failed: ${e instanceof Error ? e.message : String(e)}`);
    },
  });
  return (
    <Button onClick={() => m.mutate()} disabled={m.isPending}>
      <RefreshCw className={m.isPending ? "animate-spin" : ""} />
      Refresh KPI Engine
    </Button>
  );
}