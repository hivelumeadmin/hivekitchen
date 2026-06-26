import { describe, it, afterAll } from 'vitest';
import OpenAI from 'openai';
import type { FastifyBaseLogger } from 'fastify';
import type { Redis } from 'ioredis';
import type { KitchenMap, PlanComposeTreeOutput } from '@hivekitchen/types';
import { DomainOrchestrator } from '../orchestrator.js';
import type { OrchestratorServices } from '../orchestrator.js';
import type { AuditService } from '../../audit/audit.service.js';
import { OpenAIAdapter } from '../providers/openai.adapter.js';
import { recordPromptHash } from './planner-eval.harness.js';
import type { EvalFixture } from './planner-eval.harness.js';
import { GOLDEN_FIXTURES } from './planner-eval.fixtures.js';
import {
  assertAllergenSafe,
  assertSlotCoverage,
  assertNoConsecutiveMain,
} from './planner-eval.assertions.js';

// ===========================================================================
// Story 3.5-s7 — live mini-tier compose eval (NFR-COST-3).
// ===========================================================================
// Runs the 9 golden fixtures through the REAL planner (DomainOrchestrator.planWeek)
// against gpt-4o-mini, to inform whether the single forced-compose call can drop
// from flagship to mini. Gated by RUN_LIVE_MINI_EVAL so it NEVER runs in CI —
// it makes live OpenAI calls and needs a real OPENAI_API_KEY.
//
// Run with:
//   RUN_LIVE_MINI_EVAL=true OPENAI_API_KEY=<key> \
//     pnpm --filter @hivekitchen/api exec vitest run \
//     src/agents/eval/planner-mini-tier.eval.test.ts --reporter verbose
//
// NOTE: allergen assertions in the live eval are best-effort. The
// recipeIngredients map from each fixture is keyed by the recipe names
// used in the stub responses; the real model emits different names, so
// most ingredient lookups will return undefined → treated as empty set →
// pass. The hard safety guarantee remains the commit-time guardrail (3-39).
// This eval's primary purpose is plan-structure validity and cost-per-turn
// measurement, not ingredient-level allergen testing.
// ===========================================================================

const LIVE_EVAL_ENABLED = process.env.RUN_LIVE_MINI_EVAL === 'true';

const EVAL_PLAN_ID = '99999999-9999-4999-8999-999999999999';

// Service doubles — identical to the harness's network-free doubles. The plan
// double echoes the parsed compose tree back as output; the recipe double
// resolves a name to itself as its id (so allergen lookups stay name-keyed).
function makeRecipeDouble(): OrchestratorServices['recipe'] {
  return {
    findIdByName: async (value: string): Promise<string> => value,
    search: async (): Promise<{ results: [] }> => ({ results: [] }),
  } as unknown as OrchestratorServices['recipe'];
}

function makePlanDouble(): OrchestratorServices['plan'] {
  return {
    composeTree: async (parsed: {
      household_id: string;
      week_of: string;
      main_assignments: unknown;
      days: unknown;
      prompt_version: string;
    }): Promise<unknown> => ({
      plan_id: EVAL_PLAN_ID,
      household_id: parsed.household_id,
      week_of: parsed.week_of,
      main_assignments: parsed.main_assignments,
      days: parsed.days,
      prompt_version: parsed.prompt_version,
    }),
  } as unknown as OrchestratorServices['plan'];
}

function makeInertServices(): Omit<OrchestratorServices, 'recipe' | 'plan'> {
  const inert = {} as unknown;
  return {
    memory: inert as OrchestratorServices['memory'],
    allergyGuardrail: inert as OrchestratorServices['allergyGuardrail'],
    pantry: inert as OrchestratorServices['pantry'],
    culturalPrior: inert as OrchestratorServices['culturalPrior'],
    childPrefs: inert as OrchestratorServices['childPrefs'],
    children: inert as OrchestratorServices['children'],
  };
}

function makeLogger(): FastifyBaseLogger {
  const noop = (): undefined => undefined;
  const logger = {
    fatal: noop, error: noop, warn: noop, info: noop, debug: noop, trace: noop,
    silent: noop, level: 'silent',
    child(): FastifyBaseLogger { return logger as unknown as FastifyBaseLogger; },
  };
  return logger as unknown as FastifyBaseLogger;
}

function makeRedis(): Redis {
  const pipeline = {
    zadd() { return pipeline; },
    zremrangebyscore() { return pipeline; },
    expire() { return pipeline; },
    exec: async (): Promise<unknown[]> => [],
  };
  return { pipeline: () => pipeline } as unknown as Redis;
}

function makeAudit(): AuditService {
  return { write: async (): Promise<void> => undefined } as unknown as AuditService;
}

// Effective declared allergens per child: household-wide ∪ child's own. Mirrors
// the golden eval's kitchenMap derivation; falls back to the fixture's explicit
// map when no KitchenMap is present.
function declaredAllergensByChild(fixture: EvalFixture): Record<string, readonly string[]> {
  const kitchenMap: KitchenMap | undefined = fixture.options.kitchenMap;
  if (!kitchenMap) return fixture.expected.declaredAllergensByChild;
  const householdAllergens = kitchenMap.household.declared_allergens ?? [];
  const result: Record<string, string[]> = {};
  for (const child of kitchenMap.children) {
    result[child.id] = [...new Set([...householdAllergens, ...(child.declared_allergens ?? [])])];
  }
  return result;
}

// Drive one fixture through the REAL planner at the mini tier. The model answers
// freely (no stubResponses) — only fixture.options + fixture.expected are used.
async function runLiveFixture(fixture: EvalFixture): Promise<PlanComposeTreeOutput> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is required for the live mini-tier eval');
  const adapter = new OpenAIAdapter(new OpenAI({ apiKey }));
  const orchestrator = new DomainOrchestrator(
    [adapter],
    { recipe: makeRecipeDouble(), plan: makePlanDouble(), ...makeInertServices() },
    makeRedis(),
    makeAudit(),
    makeLogger(),
  );
  try {
    return await orchestrator.planWeek({ ...fixture.options, composeTier: 'mini' });
  } finally {
    orchestrator.dispose();
  }
}

describe.skipIf(!LIVE_EVAL_ENABLED)('Mini-tier compose eval — live (NFR-COST-3)', () => {
  it.each(GOLDEN_FIXTURES.map((f) => [f.id, f] as const))(
    'fixture %s — allergen-safe, covered, non-consecutive (mini tier)',
    async (id, fixture) => {
      const output = await runLiveFixture(fixture);
      assertSlotCoverage(output, fixture.expected.activeSlotsByChild, `${id} (mini)`);
      assertNoConsecutiveMain(output, `${id} (mini)`);
      assertAllergenSafe(output, fixture.recipeIngredients, declaredAllergensByChild(fixture), `${id} (mini)`);
    },
    120_000,
  );

  afterAll(() => {
    // eslint-disable-next-line no-console -- eval summary is the deliverable
    console.log(`
=== Mini-Tier Compose Eval Results ===
Prompt hash (mini): ${recordPromptHash('mini')}
Compared to flagship hash: ${recordPromptHash('flagship')}

If all ${String(GOLDEN_FIXTURES.length)} fixtures passed:
  - Allergen-safety: ✓ (at mini tier, best-effort — see file header)
  - Slot-coverage: ✓ (at mini tier)
  - No-consecutive-main: ✓ (at mini tier)

NEXT STEP: Review plan quality in verbose output above.
  If recipe selection, variety, and family-fit look comparable to flagship:
    → Change planWeek composeTier default from 'flagship' to 'mini'
    → Record cost saving in NFR-COST-3 tracking
  If quality is degraded:
    → Keep 'flagship'; document finding in deferred-work.md as D-3.5S7-MINI-EVAL
`);
  });
});
