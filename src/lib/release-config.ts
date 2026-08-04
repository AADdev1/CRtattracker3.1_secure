// Central release configuration. Toggling a flag here is the ONLY thing
// required to turn a future-release module on or off — no route,
// component, or server function should be deleted or rewritten to move
// between releases, they should just check these flags.
//
// Release 1 (Pilot Production) ships with only release1-scope modules
// reachable: Dashboard, Data Import, CR Repository, CR Detail, CR Size
// Management, CR Assignment & Claiming, KPI Engine, KPI Worklist, TAT
// Calculation Logic. Everything else stays fully implemented in the
// codebase and database — it's gated off, not removed.
export const FEATURES = {
  release1: true,
  // Release 2 — Testing Governance: Test Case Management, Test Case
  // Approval, Test Execution Tracking, Defect Re-testing, CR Testing
  // Progress.
  testing: true,
  // Release 3 (part 1) — CR Planner, Planner Calendar.
  planner: true,
  // Release 3 (part 2) — Deployment Planning, Deployment Status
  // Tracking, Production Deployment Workflow.
  deployment: false,
  // Release 4 — KPI Configuration, Defect Status Mapping, Security
  // Report, User Management.
  administration: false,
} as const;

export type FeatureName = Exclude<keyof typeof FEATURES, "release1">;

export function isFeatureEnabled(feature: FeatureName): boolean {
  return FEATURES[feature];
}

// Server-side gate — throws the same way every other access-denial in
// this codebase does (assertCrEditAccess, assertDeploymentActor, etc.),
// so a disabled-module server function can't be reached even by calling
// it directly, regardless of what the UI shows. Call this before any
// other check in every server function that belongs to a gated module.
export function assertFeatureEnabled(feature: FeatureName): void {
  if (!FEATURES[feature]) {
    throw new Error("This module is not available in the current release.");
  }
}
