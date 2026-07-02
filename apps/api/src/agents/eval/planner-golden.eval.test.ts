import { describe, it, expect } from 'vitest';
import type { PlanComposeTreeOutput } from '@hivekitchen/types';
import { runFixture, recordPromptHash, EVAL_PLAN_ID } from './planner-eval.harness.js';
import {
  assertFixture,
  assertAllergenSafe,
  assertSlotCoverage,
  assertNoConsecutiveMain,
  assertSchemaValid,
  assertNoBannedRecipes,
  assertBudget,
} from './planner-eval.assertions.js';
import { BAD_HANDLE_FIXTURE, GOLDEN_FIXTURES, SCHEMA_INVALID_FIXTURE_ID } from './planner-eval.fixtures.js';
import { CHILD, HH, WEEK_OF } from './planner-eval.builders.js';

// ===========================================================================
// Story 3.5-s1 — Planner golden-set eval (Epic 3.5 gate).
// Characterization: asserts parity with current planner behavior. Every Epic
// 3.5 slice (s2–s7) must keep this suite green.
// ===========================================================================

describe('planner golden-set eval', () => {
  it.each(GOLDEN_FIXTURES.map((f) => [f.id, f] as const))(
    'fixture %s — safe, covered, non-consecutive, schema-valid, within budget',
    async (_id, fixture) => {
      const result = await runFixture(fixture);
      // assertFixture throws (with fixture id + the violated assertion) on any
      // regression; a throw fails the test with a pinpoint message.
      assertFixture(fixture, result);
    },
  );

  it('schema-invalid fixture composes in a single turn (s2 forced-output win)', async () => {
    const fixture = GOLDEN_FIXTURES.find((f) => f.id === SCHEMA_INVALID_FIXTURE_ID);
    if (!fixture) throw new Error('schema-invalid fixture missing');
    const result = await runFixture(fixture);
    // Story 3.5-s2: forced structured output makes a schema-invalid plan.compose
    // call impossible on the primary path, so the self-correction detour is gone.
    // turns 2 → 1, planComposeCalls 2 → 1 vs the s1 baseline.
    expect(result.turns).toBe(1);
    expect(result.planComposeCalls).toBe(1);
    expect(result.output.days).toHaveLength(1);
    // s2 deleted the planner-path planner.bad_output audit (orchestrator Block C);
    // the recoverable-error path it characterized no longer exists. The audit
    // must remain absent on the happy single-turn compose.
    expect(result.audits.find((a) => a.event_type === 'planner.bad_output')).toBeUndefined();
  });

  it('bad-handle-not-in-slate — throws immediately without a retry turn (s3)', async () => {
    // The slate holds only m1; the model emits m99. plan.compose's handle
    // resolver throws a hard, non-retried error that exits planWeek. The
    // FakeLLMProvider queued ONE response — a retry would exhaust the queue
    // and surface a different ("exhausted") error, so a clean throw of this
    // message proves 0 retry turns.
    await expect(runFixture(BAD_HANDLE_FIXTURE)).rejects.toThrow('not found in the candidate slate');
  });

  it('binds the run to a stable prompt content-hash (AC9)', () => {
    const h1 = recordPromptHash();
    const h2 = recordPromptHash();
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(h1).toBe(h2);
    expect(recordPromptHash('mini')).not.toBe(h1);
  });
});

// ---- Negative tests: prove each assertion can actually FAIL ----------------
// A safety net that never fails is worthless. These pin that each assertion
// rejects the unsafe/incorrect shape it is meant to catch.

function mkOutput(
  mains: Array<{ sequence: number; recipe_id: string }>,
  days: PlanComposeTreeOutput['days'],
): PlanComposeTreeOutput {
  return {
    plan_id: EVAL_PLAN_ID,
    household_id: HH,
    week_of: WEEK_OF,
    prompt_version: 'v2.8.0',
    main_assignments: mains,
    days,
  };
}

describe('planner eval assertions reject violations', () => {
  it('assertAllergenSafe throws when a declared allergen is present', () => {
    const output = mkOutput(
      [{ sequence: 1, recipe_id: 'Peanut Noodles' }],
      [{ day: 'monday', slots: [{ slot_kind: 'main', main_assignment_sequence: 1, variations: [{ child_id: CHILD.a }] }] }],
    );
    expect(() =>
      assertAllergenSafe(
        output,
        { 'Peanut Noodles': ['peanut', 'noodles'] },
        { [CHILD.a]: ['peanut'] },
        'neg-allergen',
      ),
    ).toThrow(/allergen-unsafe/);
  });

  it('assertAllergenSafe passes when the fork removes the allergen', () => {
    const output = mkOutput(
      [{ sequence: 1, recipe_id: 'Peanut Noodles' }],
      [{ day: 'monday', slots: [{ slot_kind: 'main', main_assignment_sequence: 1, variations: [{ child_id: CHILD.a, removals: ['peanut'] }] }] }],
    );
    expect(() =>
      assertAllergenSafe(output, { 'Peanut Noodles': ['peanut', 'noodles'] }, { [CHILD.a]: ['peanut'] }, 'pos-fork'),
    ).not.toThrow();
  });

  it('assertSlotCoverage throws when an active slot is missing', () => {
    const output = mkOutput(
      [{ sequence: 1, recipe_id: 'R' }],
      [{ day: 'monday', slots: [{ slot_kind: 'main', main_assignment_sequence: 1, variations: [{ child_id: CHILD.a }] }] }],
    );
    expect(() => assertSlotCoverage(output, { [CHILD.a]: ['main', 'extra'] }, 'neg-cov')).toThrow(/missing active slot/);
  });

  it('assertNoConsecutiveMain throws on adjacent identical Mains', () => {
    const output = mkOutput(
      [{ sequence: 1, recipe_id: 'R' }],
      [
        { day: 'monday', slots: [{ slot_kind: 'main', main_assignment_sequence: 1, variations: [{ child_id: CHILD.a }] }] },
        { day: 'tuesday', slots: [{ slot_kind: 'main', main_assignment_sequence: 1, variations: [{ child_id: CHILD.a }] }] },
      ],
    );
    expect(() => assertNoConsecutiveMain(output, 'neg-consec')).toThrow(/consecutive Main/);
  });

  it('assertSchemaValid throws on a malformed tree', () => {
    expect(() => assertSchemaValid({}, 'neg-schema')).toThrow(/schema-invalid/);
  });

  it('assertNoBannedRecipes throws when a banned recipe is placed', () => {
    const output = mkOutput(
      [{ sequence: 1, recipe_id: 'Ham Sandwich' }],
      [{ day: 'monday', slots: [{ slot_kind: 'main', main_assignment_sequence: 1, variations: [{ child_id: CHILD.a }] }] }],
    );
    expect(() => assertNoBannedRecipes(output, ['Ham Sandwich'], 'neg-banned')).toThrow(/banned recipe placed/);
  });

  it('assertBudget throws when turns exceed the ceiling', () => {
    expect(() =>
      assertBudget(
        { output: mkOutput([], [{ day: 'monday', slots: [] }]), turns: 5, planComposeCalls: 1, promptTokens: 10, completionTokens: 10, audits: [], toolCalls: [] },
        { maxTurns: 1, maxPlanComposeCalls: 1, maxPromptTokens: 100, maxCompletionTokens: 100 },
        'neg-budget',
      ),
    ).toThrow(/turns 5 > budget 1/);
  });
});
