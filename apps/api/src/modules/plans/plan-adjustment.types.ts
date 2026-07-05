// Story 3.17 — event-driven plan adjustment pipeline.
// PlanAdjustmentService re-evaluates impacted future plans when an external
// signal (school policy change, leftover state shift, cultural-calendar event)
// arrives. Each trigger type carries the metadata the audit trail needs and
// the scope hints the orchestrator uses to size the regeneration job.
//
// Trigger sources by type:
// - 'school_policy_changed':   wired by SchoolPoliciesService (Story 3.16).
// - 'pantry_leftover_changed': deferred to Epic 6 (Story 6.5). Pipeline ready.
// - 'cultural_calendar_event': deferred to Story 3.18. Pipeline ready.
//
// HOW TO WIRE A NEW TRIGGER:
// 1. Inject planAdjustmentService into the upstream service.
// 2. After the upstream commit, call planAdjustmentService.triggerAdjustment({...}).
// 3. Add the trigger type to PlanAdjustmentTriggerType below.
// 4. AUDIT_EVENT_TYPES already includes 'plan.adjustment_triggered' — reuse it;
//    distinguish the cause via `metadata.trigger_type`.
type PlanAdjustmentTriggerType =
  | 'school_policy_changed'
  | 'pantry_leftover_changed'
  | 'cultural_calendar_event'
  | 'cultural_sovereignty_mode_changed';

// `slotScope: null` means bag-wide or scope-unknown; the regen job will plan
// the full bag. `dayScope: null` means all future days; a non-null ISO weekday
// name (`'monday' | … | 'saturday'`) narrows regen to a single day.
export interface PlanAdjustmentTrigger {
  type: PlanAdjustmentTriggerType;
  householdId: string;
  slotScope: 'bag_wide' | 'main' | 'snack' | 'extra' | null;
  dayScope: string | null;
  requestId: string;
  metadata: Record<string, unknown>;
}

export interface PlanAdjustmentResult {
  plansQueued: number;
  enqueuedPlanIds: string[];
  failedPlanIds: string[];
}
