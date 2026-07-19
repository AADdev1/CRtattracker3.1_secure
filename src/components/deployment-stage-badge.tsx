import { cn } from "@/lib/utils";
import type { DeploymentStage } from "@/lib/deployment.functions";

const map: Record<DeploymentStage, { label: string; cls: string }> = {
  "UAT Signed Off": {
    label: "UAT Signed Off",
    cls: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  },
  "Code Merging Done": {
    label: "Code Merging Done",
    cls: "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300",
  },
  "Deployed to MO": {
    label: "Deployed to MO",
    cls: "bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300",
  },
  "MO Testing Done": {
    label: "MO Testing Done",
    cls: "bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-300",
  },
  "MO Signed Off": {
    label: "MO Signed Off",
    cls: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
  },
  "Deployed to Production": {
    label: "Deployed to Production",
    cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  },
};

export function DeploymentStageBadge({ stage }: { stage: DeploymentStage | null }) {
  if (!stage) return <span className="text-xs text-muted-foreground">—</span>;
  const m = map[stage];
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap",
        m.cls,
      )}
    >
      {m.label}
    </span>
  );
}
