import { z } from 'zod';

// ===========================================================================
// Epic 2.5 — Enforcement gradient
// ===========================================================================
// Five-rung enforcement strength applied to dietary signals, cultural priors,
// food preferences, and household rules. Mirrors the `enforcement_level`
// Postgres enum exactly (see migration 20260903000000). Parity is enforced
// by enforcement.test.ts and the API integration test
// enforcement-enum-parity.test.ts.
//
// Order in the tuple is meaningful — increasing strictness:
//   non_negotiable   → hard rule; planner MUST NOT violate
//   strong           → elevated cultural / religious / dietary; planner
//                      avoids and confirms before exceptions
//   default          → standard family preference; planner respects,
//                      may surface alternatives
//   soft             → gentle bias; planner weighs but does not gate
//   just_for_context → informational only; planner reads but never enforces
//
// Allergens are intentionally NOT routed through this enum — they are
// uniformly hard. See FR122 (sprint-change-proposal-2026-05-19).
// ===========================================================================

export const ENFORCEMENT_LEVEL_VALUES = [
  'non_negotiable',
  'strong',
  'default',
  'soft',
  'just_for_context',
] as const;

export const EnforcementLevelSchema = z.enum(ENFORCEMENT_LEVEL_VALUES);
export type EnforcementLevel = z.infer<typeof EnforcementLevelSchema>;
