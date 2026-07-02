import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { runScenario, HOUSEHOLD_ID, type ScenarioOutcome } from './onboarding-eval.harness.js';
import { SCENARIOS } from './onboarding-eval.fixtures.js';

// ===========================================================================
// Story 2.7-s1 — Onboarding golden-set eval (Epic 2.7 regression gate).
// ===========================================================================
// Characterization: pins the CURRENT (HEAD) external behaviour of the
// onboarding interview so every later Epic 2.7 slice — especially the control
// inversion in s6/s7 (controller owns the FSM; the service-side safety nets
// are deleted) — must keep this suite green to prove it preserved behaviour.
//
// STRUCTURED OUTCOMES ONLY. The golden record asserts moment transitions, slot
// fills (Kitchen Map / onboarding_moment_state), and the tool calls fired —
// NEVER the assistant's prose wording (non-deterministic; legitimately changes
// in s5/s7). The committed baseline lives in onboarding-eval.goldens.json.
//
// REGENERATING GOLDENS: when a later slice legitimately changes a STRUCTURED
// outcome, re-dump runScenario(scenario).outcome for each scenario into
// onboarding-eval.goldens.json and diff-review the change in the PR (same
// policy as the planner golden eval, 3.5-s1). A prose-only change must NOT
// move any golden — if it does, the harness is over-fitting and the assertion
// is wrong, not the prose.
// ===========================================================================

const GOLDENS = JSON.parse(
  readFileSync(fileURLToPath(new URL('./onboarding-eval.goldens.json', import.meta.url)), 'utf-8'),
) as Record<string, ScenarioOutcome>;

describe('onboarding golden-set eval', () => {
  it.each(SCENARIOS.map((s) => [s.id, s] as const))(
    'scenario %s — moment transitions, slot fills, and tool calls match the baseline',
    async (id, scenario) => {
      const golden = GOLDENS[id];
      expect(golden, `no golden record for scenario "${id}"`).toBeDefined();

      const { outcome, catalogSeedCalls } = await runScenario(scenario);

      // Structured-outcomes-only: the whole outcome object is moment
      // transitions + slot fills + tool calls (no prose anywhere).
      expect(outcome).toEqual(golden);

      // Catalog-seed enqueue is fire-and-forget at the m2_safe exit; its
      // payload carries a non-deterministic request_id, so assert the COUNT +
      // household_id only — never the payload verbatim.
      const expectedSeeds = scenario.expectedCatalogSeedCount ?? 0;
      expect(catalogSeedCalls).toHaveLength(expectedSeeds);
      for (const call of catalogSeedCalls) {
        expect(call.jobName).toBe('seed-catalog');
        expect(call.payload).toMatchObject({ household_id: HOUSEHOLD_ID });
      }
    },
  );

  it('every scenario has a committed golden record (no orphans either way)', () => {
    expect(new Set(Object.keys(GOLDENS))).toEqual(new Set(SCENARIOS.map((s) => s.id)));
  });
});

// ---- Spot checks: the AC behaviours, asserted explicitly ------------------
// The deep-equal above is the gate; these pin the specific behaviours the
// epic must preserve so a regression names the exact safety net it broke.

describe('onboarding eval — behaviour spot checks (AC4/AC5)', () => {
  it('spine walks the full moment spine m1→summary and finalize is eligible', async () => {
    const scenario = SCENARIOS.find((s) => s.id === 'spine-happy-path');
    if (scenario === undefined) throw new Error('spine scenario missing');
    const { outcome } = await runScenario(scenario);
    // Slice 13-s6 — the M5 natural threshold dropped 10→5 (§6.1 "~5 is enough"),
    // so the 5-favourite free-text turn now completes M5 on its own and the
    // controller advances straight to summary; the later override_fewer tap is a
    // no-op that holds at summary. Deterministic — no LLM directive.
    expect(outcome.momentSequence).toEqual([
      'm1_table', 'm2_safe', 'm3_taste', 'm4_bag', 'm5_starting_line', 'summary', 'summary',
    ]);
    expect(outcome.lastTurn?.required_set_complete).toBe(true);
    expect(outcome.finalize).toEqual(expect.objectContaining({ ok: true }));
    // Slot fills landed: Slice 2.7-s5 — pure-chip M2 allergens are HOUSEHOLD-
    // WIDE (no free-text child attribution), plus household dietary, cuisine
    // prior, and the M5 starting-line favourites.
    expect(outcome.finalSlots.allergens).toEqual([
      { scope: '__household__', allergen: 'peanut' },
      { scope: '__household__', allergen: 'dairy' },
    ]);
    expect(outcome.finalSlots.favorites).toHaveLength(5);
  });

  it('M2/M3/M4 pure-chip turns advance deterministically (zero-call) through the spine', async () => {
    const scenario = SCENARIOS.find((s) => s.id === 'safety-net-chip-only');
    if (scenario === undefined) throw new Error('chip-only scenario missing');
    const { outcome } = await runScenario(scenario);
    expect(outcome.momentSequence).toEqual(['m2_safe', 'm3_taste', 'm4_bag', 'm5_starting_line']);
    // Zero-call slot fills: household-wide allergen, cuisine prior, bag pattern.
    expect(outcome.finalSlots.allergens).toEqual([
      { scope: '__household__', allergen: 'peanut' },
    ]);
    expect(outcome.finalSlots.children[0]?.bag_composition_pattern).toBe('main_plus_snack');
  });

  it('re-anchors to m3_taste when the moment row is missing but data exists', async () => {
    const scenario = SCENARIOS.find((s) => s.id === 'safety-net-reanchor');
    if (scenario === undefined) throw new Error('reanchor scenario missing');
    const { outcome } = await runScenario(scenario);
    // Slice 13-s6 — M3 is now REQUIRED, so re-anchor no longer skips it: a
    // household with M1+M2 done but M3 unanswered lands on m3_taste, not m4_bag.
    expect(outcome.momentSequence).toEqual(['m3_taste']);
  });

  it('bootstraps pre_start → m1_table on the first turn with no directive', async () => {
    const scenario = SCENARIOS.find((s) => s.id === 'pre-start-bootstrap');
    if (scenario === undefined) throw new Error('bootstrap scenario missing');
    const { outcome } = await runScenario(scenario);
    expect(outcome.momentSequence).toEqual(['m1_table']);
    expect(outcome.lastTurn?.chip_config?.mode).toBe('hint');
  });

  it('enters M5 cold-start mode when the projection returns a coldStartReason', async () => {
    const scenario = SCENARIOS.find((s) => s.id === 'm5-cold-start');
    if (scenario === undefined) throw new Error('cold-start scenario missing');
    const { outcome } = await runScenario(scenario);
    expect(outcome.lastTurn?.cold_start_mode).toBe(true);
    expect(outcome.momentState?.cold_start_triggered).toBe(true);
    expect(outcome.lastTurn?.chip_config).toBeNull();
  });

  it('blocks finalize with a ConflictError when not yet at summary', async () => {
    const scenario = SCENARIOS.find((s) => s.id === 'finalize-gate-negative');
    if (scenario === undefined) throw new Error('finalize-negative scenario missing');
    const { outcome } = await runScenario(scenario);
    expect(outcome.finalize).toEqual({
      ok: false,
      error: 'onboarding summary not reached — complete all five moments before finalizing',
    });
  });

  it('is deterministic — the same scenario produces a byte-identical outcome', async () => {
    const scenario = SCENARIOS.find((s) => s.id === 'spine-happy-path');
    if (scenario === undefined) throw new Error('spine scenario missing');
    const a = await runScenario(scenario);
    const b = await runScenario(scenario);
    expect(a.outcome).toEqual(b.outcome);
  });
});
