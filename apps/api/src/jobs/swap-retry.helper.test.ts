import { describe, it, expect, vi } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import type {
  CommitPlanInput,
  GuardrailResult,
  PlanComposeOutput,
} from '@hivekitchen/types';
import { trySurgicalSwap } from './swap-retry.helper.js';
import type { DomainOrchestrator } from '../agents/orchestrator.js';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const PLAN_ID = '22222222-2222-4222-8222-222222222222';
const WEEK_ID = '33333333-3333-4333-8333-333333333333';
const CHILD_ID_A = '44444444-4444-4444-8444-444444444444';
const CHILD_ID_B = '55555555-5555-4555-8555-555555555555';

function buildLogger(): FastifyBaseLogger {
  const noop = vi.fn();
  return {
    info: noop, warn: noop, error: noop, debug: noop, trace: noop, fatal: noop,
    child: vi.fn().mockReturnThis(), level: 'info', silent: vi.fn(),
  } as unknown as FastifyBaseLogger;
}

function buildCommit(items: CommitPlanInput['items']): CommitPlanInput {
  return {
    plan_id: PLAN_ID,
    household_id: HOUSEHOLD_ID,
    week_id: WEEK_ID,
    week_of: '2026-05-18',
    revision: 1,
    generated_at: '2026-05-15T11:00:00.000Z',
    prompt_version: 'v1.3.0',
    items,
  };
}

function blocked(...conflicts: Array<{
  child_id: string;
  day: string;
  slot: string;
  allergen: string;
  ingredient: string;
}>): GuardrailResult {
  return { verdict: 'blocked', conflicts };
}

function buildSwapOutput(days: PlanComposeOutput['days']): PlanComposeOutput {
  return {
    plan_id: PLAN_ID,
    household_id: HOUSEHOLD_ID,
    week_of: '2026-05-18',
    days,
    prompt_version: 'v1.0.0',
  };
}

type OrchestratorMock = Pick<DomainOrchestrator, 'swapBlockedItems'> & {
  swapBlockedItems: ReturnType<typeof vi.fn>;
};

function buildOrchestrator(impl?: PlanComposeOutput | Error): OrchestratorMock {
  const fn = vi.fn();
  if (impl instanceof Error) {
    fn.mockRejectedValue(impl);
  } else if (impl !== undefined) {
    fn.mockResolvedValue(impl);
  }
  return { swapBlockedItems: fn };
}

describe('trySurgicalSwap', () => {
  it('returns null when no rejections are "blocked" (uncertain-only)', async () => {
    const orchestrator = buildOrchestrator();
    const commit = buildCommit([
      { child_id: CHILD_ID_A, day: 'monday', slot: 'main', ingredients: ['rice'] },
    ]);
    const result = await trySurgicalSwap({
      orchestrator,
      previousCommit: commit,
      rejections: [{ verdict: 'uncertain', conflicts: [], reason: 'no_rules_loaded' }],
      weekOf: '2026-05-18',
      requestId: 'req-1',
      logger: buildLogger(),
    });
    expect(result).toBeNull();
    expect(orchestrator.swapBlockedItems).not.toHaveBeenCalled();
  });

  it('returns null when no previousCommit items match the blocked tuples (stale data)', async () => {
    const orchestrator = buildOrchestrator();
    const commit = buildCommit([
      { child_id: CHILD_ID_A, day: 'monday', slot: 'main', ingredients: ['rice'] },
    ]);
    const result = await trySurgicalSwap({
      orchestrator,
      previousCommit: commit,
      rejections: [
        blocked({
          child_id: CHILD_ID_B, // child_id not in commit.items
          day: 'monday',
          slot: 'main',
          allergen: 'peanut',
          ingredient: 'peanut butter',
        }),
      ],
      weekOf: '2026-05-18',
      requestId: 'req-1',
      logger: buildLogger(),
    });
    expect(result).toBeNull();
    expect(orchestrator.swapBlockedItems).not.toHaveBeenCalled();
  });

  it('returns null and logs when swapBlockedItems throws (fallback path)', async () => {
    const orchestrator = buildOrchestrator(new Error('swap agent timeout'));
    const logger = buildLogger();
    const commit = buildCommit([
      { child_id: CHILD_ID_A, day: 'monday', slot: 'main', ingredients: ['peanut butter', 'bread'] },
    ]);
    const result = await trySurgicalSwap({
      orchestrator,
      previousCommit: commit,
      rejections: [
        blocked({
          child_id: CHILD_ID_A,
          day: 'monday',
          slot: 'main',
          allergen: 'peanut',
          ingredient: 'peanut butter',
        }),
      ],
      weekOf: '2026-05-18',
      requestId: 'req-1',
      logger,
    });
    expect(result).toBeNull();
    expect(orchestrator.swapBlockedItems).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('returns null when the swap output does not cover every blocked slot', async () => {
    // Two slots blocked; swap only replaces one. Coverage failure → fallback.
    const orchestrator = buildOrchestrator(
      buildSwapOutput([
        {
          day: 'monday',
          items: [
            { child_id: CHILD_ID_A, slot: 'main', ingredients: ['sunflower seed butter', 'bread'] },
          ],
        },
      ]),
    );
    const commit = buildCommit([
      { child_id: CHILD_ID_A, day: 'monday', slot: 'main', ingredients: ['peanut butter', 'bread'] },
      { child_id: CHILD_ID_A, day: 'tuesday', slot: 'main', ingredients: ['milk', 'cereal'] },
    ]);
    const result = await trySurgicalSwap({
      orchestrator,
      previousCommit: commit,
      rejections: [
        blocked(
          { child_id: CHILD_ID_A, day: 'monday', slot: 'main', allergen: 'peanut', ingredient: 'peanut butter' },
          { child_id: CHILD_ID_A, day: 'tuesday', slot: 'main', allergen: 'milk', ingredient: 'milk' },
        ),
      ],
      weekOf: '2026-05-18',
      requestId: 'req-1',
      logger: buildLogger(),
    });
    expect(result).toBeNull();
  });

  it('merges replacements over the previous commit on full coverage (happy path)', async () => {
    const orchestrator = buildOrchestrator(
      buildSwapOutput([
        {
          day: 'monday',
          items: [
            { child_id: CHILD_ID_A, slot: 'main', ingredients: ['sunflower seed butter', 'bread'] },
          ],
        },
      ]),
    );
    const commit = buildCommit([
      { child_id: CHILD_ID_A, day: 'monday',  slot: 'main', ingredients: ['peanut butter', 'bread'] },
      { child_id: CHILD_ID_A, day: 'tuesday', slot: 'main', ingredients: ['rice', 'lentils'] },
      { child_id: CHILD_ID_B, day: 'monday',  slot: 'main', ingredients: ['pasta', 'tomato'] },
    ]);
    const result = await trySurgicalSwap({
      orchestrator,
      previousCommit: commit,
      rejections: [
        blocked({
          child_id: CHILD_ID_A,
          day: 'monday',
          slot: 'main',
          allergen: 'peanut',
          ingredient: 'peanut butter',
        }),
      ],
      weekOf: '2026-05-18',
      requestId: 'req-1',
      logger: buildLogger(),
    });

    expect(result).not.toBeNull();
    // Monday/A replaced; everything else preserved.
    expect(result?.items).toEqual([
      { child_id: CHILD_ID_A, day: 'monday',  slot: 'main', ingredients: ['sunflower seed butter', 'bread'] },
      { child_id: CHILD_ID_A, day: 'tuesday', slot: 'main', ingredients: ['rice', 'lentils'] },
      { child_id: CHILD_ID_B, day: 'monday',  slot: 'main', ingredients: ['pasta', 'tomato'] },
    ]);
    // Same plan_id + envelope — only items mutated.
    expect(result?.plan_id).toBe(PLAN_ID);
    expect(result?.household_id).toBe(HOUSEHOLD_ID);
    expect(result?.revision).toBe(1);
  });

  it('drops swap items whose tuple does NOT match a blocked slot (prompt-drift defense)', async () => {
    const orchestrator = buildOrchestrator(
      buildSwapOutput([
        {
          day: 'monday',
          items: [
            // Legit replacement for blocked slot
            { child_id: CHILD_ID_A, slot: 'main', ingredients: ['sunflower seed butter', 'bread'] },
            // Drift: agent emitted an item for a non-blocked slot
            { child_id: CHILD_ID_B, slot: 'main', ingredients: ['pasta', 'pesto'] },
          ],
        },
      ]),
    );
    const commit = buildCommit([
      { child_id: CHILD_ID_A, day: 'monday', slot: 'main', ingredients: ['peanut butter', 'bread'] },
      { child_id: CHILD_ID_B, day: 'monday', slot: 'main', ingredients: ['pasta', 'tomato'] },
    ]);
    const result = await trySurgicalSwap({
      orchestrator,
      previousCommit: commit,
      rejections: [
        blocked({
          child_id: CHILD_ID_A,
          day: 'monday',
          slot: 'main',
          allergen: 'peanut',
          ingredient: 'peanut butter',
        }),
      ],
      weekOf: '2026-05-18',
      requestId: 'req-1',
      logger: buildLogger(),
    });

    expect(result).not.toBeNull();
    // Child B was NOT blocked — keep the original ingredients regardless of
    // what the agent emitted.
    const childB = result?.items.find((i) => i.child_id === CHILD_ID_B);
    expect(childB?.ingredients).toEqual(['pasta', 'tomato']);
  });

  it('passes the agent the original ingredients + aggregated blocked_by reasons', async () => {
    const orchestrator = buildOrchestrator(
      buildSwapOutput([
        {
          day: 'monday',
          items: [
            { child_id: CHILD_ID_A, slot: 'main', ingredients: ['safe'] },
          ],
        },
      ]),
    );
    const commit = buildCommit([
      { child_id: CHILD_ID_A, day: 'monday', slot: 'main', ingredients: ['peanut butter', 'milk', 'bread'] },
    ]);
    await trySurgicalSwap({
      orchestrator,
      previousCommit: commit,
      rejections: [
        // Same slot blocked on two allergens — should aggregate into one
        // BlockedItem with blocked_by length 2.
        blocked(
          { child_id: CHILD_ID_A, day: 'monday', slot: 'main', allergen: 'peanut', ingredient: 'peanut butter' },
          { child_id: CHILD_ID_A, day: 'monday', slot: 'main', allergen: 'milk',   ingredient: 'milk' },
        ),
      ],
      weekOf: '2026-05-18',
      requestId: 'req-1',
      logger: buildLogger(),
    });

    const callArg = orchestrator.swapBlockedItems.mock.calls[0]?.[0] as {
      blockedItems: Array<{ original_ingredients: string[]; blocked_by: Array<{ allergen: string }> }>;
    };
    expect(callArg.blockedItems).toHaveLength(1);
    expect(callArg.blockedItems[0]?.original_ingredients).toEqual([
      'peanut butter', 'milk', 'bread',
    ]);
    expect(callArg.blockedItems[0]?.blocked_by.map((r) => r.allergen).sort()).toEqual(['milk', 'peanut']);
  });
});
