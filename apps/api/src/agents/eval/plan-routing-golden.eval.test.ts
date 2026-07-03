import { describe, it, expect } from 'vitest';
// eslint-disable-next-line no-restricted-imports -- live eval constructs its own client (never runs in CI)
import OpenAI from 'openai';
import { OpenAIAdapter } from '../providers/openai.adapter.js';
import { routePlanIntent, type PlanContextLite } from '../route-plan-intent.js';
import { dispatchPlanIntent, type DispatchDeps } from '../dispatch-plan-intent.js';

// ===========================================================================
// Epic 13-s9 — routing golden eval (routing-spec §11 step 1).
// ===========================================================================
// Fixed utterances → expected {intent, tier}: the regression gate for the
// 'mini'-tier classifier + deterministic dispatcher. Gated by
// RUN_LIVE_ROUTING_EVAL so it NEVER runs in CI — it makes live OpenAI calls
// (one 'mini'-tier call per fixture) and needs a real OPENAI_API_KEY.
//
// Run with:
//   RUN_LIVE_ROUTING_EVAL=true OPENAI_API_KEY=<key> \
//     pnpm --filter @hivekitchen/api exec vitest run \
//     src/agents/eval/plan-routing-golden.eval.test.ts --reporter verbose
//
// The dispatch tier is asserted against a stubbed always-hit catalog (T0 for
// swaps) plus one explicit miss fixture (T2 escalate). Same policy as the
// planner mini-tier eval (3.5-s7): the deterministic half is fully covered by
// unit tests; this eval pins the MODEL half — utterance → intent — which can
// drift with model or prompt changes.
// ===========================================================================

const LIVE_EVAL_ENABLED = process.env.RUN_LIVE_ROUTING_EVAL === 'true';

const CHILD_MAYA = '11111111-1111-4111-8111-111111111111';
const CHILD_AARAV = '22222222-2222-4222-8222-222222222222';

const CTX: PlanContextLite = {
  weekLabel: 'Mon 29 Jun – Fri 3 Jul',
  days: [
    { day: 'mon', mainTitle: 'Veggie wraps' },
    { day: 'tue', mainTitle: 'Teriyaki rice bowls' },
    { day: 'wed', mainTitle: 'Veggie wraps' },
    { day: 'thu', mainTitle: 'Teriyaki rice bowls' },
    { day: 'fri', mainTitle: 'Pasta salad' },
  ],
  children: [
    { id: CHILD_MAYA, name: 'Maya' },
    { id: CHILD_AARAV, name: 'Aarav' },
  ],
};

interface RoutingFixture {
  id: string;
  utterance: string;
  expectedIntent: string;
  expectedTier: 'T0' | 'T1' | 'T2';
  /** Force a catalog miss for this fixture (default: catalog always hits). */
  catalogMiss?: boolean;
}

// One fixture per intent (12) + slot-resolution and miss variants.
const FIXTURES: readonly RoutingFixture[] = [
  { id: 'inspect', utterance: 'show me Tuesday', expectedIntent: 'inspect', expectedTier: 'T0' },
  { id: 'explain', utterance: "why this main on Monday?", expectedIntent: 'explain', expectedTier: 'T0' },
  { id: 'commit', utterance: 'confirm the week', expectedIntent: 'commit', expectedTier: 'T0' },
  { id: 'affirm', utterance: 'looks great, thanks!', expectedIntent: 'affirm', expectedTier: 'T0' },
  { id: 'swap-main', utterance: "swap Tuesday's main", expectedIntent: 'swap_slot', expectedTier: 'T0' },
  { id: 'swap-child-ref', utterance: 'Maya is bored of the wraps, change Monday', expectedIntent: 'swap_slot', expectedTier: 'T0' },
  { id: 'exclude', utterance: 'no fish this week please', expectedIntent: 'exclude_filter', expectedTier: 'T0' },
  { id: 'vary-spice', utterance: 'make Tuesday less spicy for Aarav', expectedIntent: 'vary_slot', expectedTier: 'T0' },
  { id: 'vary-portion', utterance: 'smaller portion for Maya on Monday', expectedIntent: 'vary_slot', expectedTier: 'T0' },
  { id: 'safety', utterance: 'add a peanut allergy for Maya', expectedIntent: 'safety_write', expectedTier: 'T0' },
  { id: 'add-dish', utterance: 'can we do bibimbap on Friday?', expectedIntent: 'add_dish', expectedTier: 'T2' },
  { id: 'recompose', utterance: 'redo the whole week', expectedIntent: 'recompose', expectedTier: 'T2' },
  { id: 'compose-next', utterance: 'draft next week for me', expectedIntent: 'compose_next', expectedTier: 'T2' },
  { id: 'fallback', utterance: 'what is the weather tomorrow?', expectedIntent: 'fallback', expectedTier: 'T1' },
  { id: 'swap-catalog-miss', utterance: "swap Friday's main", expectedIntent: 'swap_slot', expectedTier: 'T2', catalogMiss: true },
];

function stubCatalog(miss: boolean): DispatchDeps {
  return {
    catalog: {
      pickRecipe: () =>
        Promise.resolve(miss ? null : { id: 'r1', kind: 'recipe' as const, title: 'Dal wraps' }),
    },
  };
}

describe.skipIf(!LIVE_EVAL_ENABLED)('plan routing golden eval — live (mini tier)', () => {
  const apiKey = process.env.OPENAI_API_KEY;
  const provider = LIVE_EVAL_ENABLED
    ? new OpenAIAdapter(new OpenAI({ apiKey }))
    : undefined;

  it.each(FIXTURES.map((f) => [f.id, f] as const))(
    'fixture %s — utterance routes to the expected {intent, tier}',
    async (id, fixture) => {
      const intent = await routePlanIntent(fixture.utterance, CTX, provider!);
      expect(intent.intent, `${id}: intent`).toBe(fixture.expectedIntent);

      const dispatch = await dispatchPlanIntent(
        intent,
        { householdId: 'eval-hh' },
        stubCatalog(fixture.catalogMiss === true),
      );
      expect(dispatch.tier, `${id}: tier`).toBe(fixture.expectedTier);
    },
    30_000,
  );

  it('resolves a named child to their childId from context', async () => {
    const intent = await routePlanIntent('make Tuesday less spicy for Aarav', CTX, provider!);
    expect(intent.childId).toBe(CHILD_AARAV);
  }, 30_000);

  it('safety_write carries the canonical allergen', async () => {
    const intent = await routePlanIntent('add a peanut allergy for Maya', CTX, provider!);
    expect(intent.allergen).toBe('peanut');
    expect(intent.childId).toBe(CHILD_MAYA);
  }, 30_000);
});
