// ===========================================================================
// Slice 2.7-s6 — OnboardingController (deterministic FSM via slot predicates)
// ===========================================================================
// The interview's control flow is being inverted (Epic 2.7): today the LLM
// owns the state machine (it emits `[NEXT_MOMENT:]`) and `onboarding.service.ts`
// compensates with safety nets when the model forgets. This controller is the
// deterministic replacement — it advances `current_moment` by READING slot
// state (the Kitchen Map projection + `onboarding_moment_state`), never by
// parsing a directive.
//
// It is a PURE function of its inputs: no LLM, no DB, no I/O. That is the
// headline maintainability win (AC4) — transitions are testable by feeding a
// slot state and asserting the resulting moment + chip config, with no LLM
// mock at all.
//
// In this slice the controller runs ALONGSIDE the existing path (shadow): the
// service computes the controller's predicted moment each turn and logs any
// divergence from the live (directive + safety-net) outcome. The LLM-led
// sentinel path and the safety nets are NOT deleted here — that is `s7`, after
// parity is proven. The one live behaviour this slice flips is AC3: the M1
// household-name hint-chip swap, now derived from slot state instead of the
// `[CHIP_PROMPT:household_name]` prose sentinel.
// ===========================================================================

import type { ChipConfig } from '@hivekitchen/contracts';
import type { CurrentMoment } from './onboarding-moment.repository.js';

// The slot model (AC1) — required slots expressed as booleans derived from the
// Kitchen Map projection + `onboarding_moment_state`. The field names mirror
// the existing required-set (`m1_household_name`, `m1_child_declared`,
// `m2_allergen_response`, `m5_complete`); `m3Answered` / `m4Answered` carry the
// optional-moment "answered" signal that the M3/M4 chip auto-advance safety
// nets read today (AC5).
export interface OnboardingSlots {
  /** households.display_name is set (M1 required slot). */
  m1HouseholdName: boolean;
  /** ≥1 children row declared (M1 required slot). */
  m1ChildDeclared: boolean;
  /** An allergen response is recorded — the M2 safety gate (required slot). */
  m2AllergenResponse: boolean;
  /** M3 dietary/cuisine identity answered (or explicitly skipped). Slice 13-s6 —
   *  M3 is now a REQUIRED-set moment (§6.1 defer-line); `m3_answered` is
   *  persisted in `RequiredSetStatus` and gates `required_set_complete`. */
  m3Answered: boolean;
  /** M4 bag-composition pattern chosen. Reproduces the M4 chip-only
   *  auto-advance safety net (AC5). */
  m4Answered: boolean;
  /** Starting-line complete per the Epic 2.6 gate (M5 required slot). */
  m5Complete: boolean;
}

// AC1 — the named per-moment exit predicates. A moment is "done" (and the
// controller advances out of it) the instant its required slots are filled.
// Exported so the service's shadow comparison and the transition tests share
// one source of truth.
export const MOMENT_SLOT_PREDICATES = {
  /** M1 (`m1_table`): household_name set AND ≥1 child declared. */
  m1Complete: (s: OnboardingSlots): boolean => s.m1HouseholdName && s.m1ChildDeclared,
  /** M2 (`m2_safe`): an allergen_response recorded (the required safety gate). */
  m2Complete: (s: OnboardingSlots): boolean => s.m2AllergenResponse,
  /** M3 (`m3_taste`): dietary/cuisine answered or skipped. Slice 13-s6 —
   *  M3 is now a REQUIRED-set moment (§6.1 defer-line); the predicate body is
   *  unchanged, but re-anchor no longer skips it. */
  m3Complete: (s: OnboardingSlots): boolean => s.m3Answered,
  /** M4 (`m4_bag`): bag-composition pattern chosen. */
  m4Complete: (s: OnboardingSlots): boolean => s.m4Answered,
  /** M5 (`m5_starting_line`): starting-line complete per the Epic 2.6 gate. */
  m5Complete: (s: OnboardingSlots): boolean => s.m5Complete,
} as const;

// M1 household-name hint chips — shown when the parent has declared a child but
// not yet named the household. Moved here from onboarding.service.ts: in this
// slice the swap is the controller's responsibility (AC3), derived from slot
// state rather than the `[CHIP_PROMPT:household_name]` sentinel.
const HOUSEHOLD_NAME_HINT_CHIPS: ChipConfig = {
  mode: 'hint',
  hints: ['Menon Kitchen', 'The Khan Family', 'Smith Household'],
};

export class OnboardingController {
  // AC2 — forward-only advance, reading slot state. Starting from the current
  // moment, step forward through the spine while each moment's exit predicate
  // is satisfied. Never steps backward (a moment is only ever advanced past,
  // never re-entered), preserving the `MOMENT_ORDER` semantics. `finalized` is
  // the finalize endpoint's responsibility — the controller caps at `summary`.
  nextMoment(current: CurrentMoment, slots: OnboardingSlots): CurrentMoment {
    // pre_start is an internal bootstrap state — promote to m1_table the moment
    // the conversation starts (reproduces the pre_start → m1_table fallback).
    let m: CurrentMoment = current === 'pre_start' ? 'm1_table' : current;
    if (m === 'summary' || m === 'finalized') return m;

    if (m === 'm1_table' && MOMENT_SLOT_PREDICATES.m1Complete(slots)) m = 'm2_safe';
    if (m === 'm2_safe' && MOMENT_SLOT_PREDICATES.m2Complete(slots)) m = 'm3_taste';
    if (m === 'm3_taste' && MOMENT_SLOT_PREDICATES.m3Complete(slots)) m = 'm4_bag';
    if (m === 'm4_bag' && MOMENT_SLOT_PREDICATES.m4Complete(slots)) m = 'm5_starting_line';
    if (m === 'm5_starting_line' && MOMENT_SLOT_PREDICATES.m5Complete(slots)) m = 'summary';
    return m;
  }

  // AC6 / AC5 — reconstruct `current_moment` purely from slot state when there
  // is no prior moment row (resume / reset, or a fresh session whose data
  // already exists). Slice 13-s6 — M3 is now REQUIRED, so re-anchor lands a
  // household with M1+M2 done but M3 unanswered on `m3_taste` (not `m4_bag`).
  reconstructMoment(slots: OnboardingSlots): CurrentMoment {
    if (!MOMENT_SLOT_PREDICATES.m1Complete(slots)) return 'm1_table';
    if (!MOMENT_SLOT_PREDICATES.m2Complete(slots)) return 'm2_safe';
    if (!MOMENT_SLOT_PREDICATES.m3Complete(slots)) return 'm3_taste';
    if (!MOMENT_SLOT_PREDICATES.m4Complete(slots)) return 'm4_bag';
    if (!MOMENT_SLOT_PREDICATES.m5Complete(slots)) return 'm5_starting_line';
    return 'summary';
  }

  // AC3 — the M1 household-name hint-chip swap, derived from slot state. When
  // the parent has declared a child but not yet named the household, swap the
  // child/age hint chips for household-name format examples. Replaces the
  // `[CHIP_PROMPT:household_name]` sentinel detection. For every other moment /
  // slot state the base chip config (from `momentToChipConfig`) passes through
  // unchanged.
  chipConfig(
    moment: CurrentMoment,
    baseChipConfig: ChipConfig | null,
    slots: OnboardingSlots,
  ): ChipConfig | null {
    if (moment === 'm1_table' && slots.m1ChildDeclared && !slots.m1HouseholdName) {
      return HOUSEHOLD_NAME_HINT_CHIPS;
    }
    return baseChipConfig;
  }
}
