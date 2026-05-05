import { describe, it, expect, vi } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import type Redis from 'ioredis';
import type { Queue } from 'bullmq';
import { PlansService } from './plans.service.js';
import type { PlansRepository } from './plans.repository.js';
import type { BriefStateRepository } from './brief-state.repository.js';
import type { BriefStateComposer } from './brief-state.composer.js';
import type { AllergyGuardrailService } from '../allergy-guardrail/allergy-guardrail.service.js';
import type { AuditService } from '../../audit/audit.service.js';
import type {
  CommitPlanInput,
  GuardrailResult,
  PlanComposeInput,
} from '@hivekitchen/types';
import {
  GuardrailRejectionError,
  NotFoundError,
  SwapGuardrailBlockedError,
  TooManyRequestsError,
  ValidationError,
} from '../../common/errors.js';
import { GUARDRAIL_VERSION } from '../allergy-guardrail/allergy-rules.engine.js';
import type { PlanItemRow, PlanRow } from '@hivekitchen/types';

const PLAN_ID = '11111111-1111-4111-8111-111111111111';
const HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';
const WEEK_ID = '33333333-3333-4333-8333-333333333333';
const CHILD_ID = '44444444-4444-4444-8444-444444444444';
const REQUEST_ID = '55555555-5555-4555-8555-555555555555';

function buildLogger(): FastifyBaseLogger {
  const noop = vi.fn();
  return {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    trace: noop,
    fatal: noop,
    child: vi.fn().mockReturnThis(),
    level: 'info',
    silent: vi.fn(),
  } as unknown as FastifyBaseLogger;
}

function makeInput(overrides: Partial<CommitPlanInput> = {}): CommitPlanInput {
  return {
    plan_id: PLAN_ID,
    household_id: HOUSEHOLD_ID,
    week_id: WEEK_ID,
    week_of: '2026-05-04',
    revision: 1,
    generated_at: '2026-05-02T11:00:00.000Z',
    prompt_version: 'v1.0.0',
    items: [
      {
        child_id: CHILD_ID,
        day: 'monday',
        slot: 'main',
        ingredients: ['rice', 'lentils'],
      },
    ],
    ...overrides,
  };
}

// Story 3.13 — minimal Redis + Queue stubs for PlansService construction.
// Individual tests override these with vi.fn() to assert call-site behavior.
type RedisMock = Redis & {
  incr: ReturnType<typeof vi.fn>;
  expire: ReturnType<typeof vi.fn>;
  ttl: ReturnType<typeof vi.fn>;
};

function buildRedis(opts: { incrCount?: number; ttl?: number } = {}): RedisMock {
  return {
    incr: vi.fn().mockResolvedValue(opts.incrCount ?? 1),
    expire: vi.fn().mockResolvedValue(1),
    ttl: vi.fn().mockResolvedValue(opts.ttl ?? 60),
  } as unknown as RedisMock;
}

type QueueMock = Queue & { add: ReturnType<typeof vi.fn> };

function buildRegenQueue(opts: { jobId?: string } = {}): QueueMock {
  return {
    add: vi
      .fn()
      .mockResolvedValue({ id: opts.jobId ?? 'test-regen-job-id' }),
  } as unknown as QueueMock;
}

function buildRepo(opts: {
  commitImpl?: (input: CommitPlanInput, clearedAt: string, version: string) => Promise<string>;
  existingPlanId?: string | null;
} = {}): PlansRepository & {
  commit: ReturnType<typeof vi.fn>;
  findActiveByHouseholdAndWeek: ReturnType<typeof vi.fn>;
} {
  const commit = vi.fn(async (input: CommitPlanInput, clearedAt: string, version: string) => {
    if (opts.commitImpl) return opts.commitImpl(input, clearedAt, version);
    return input.plan_id;
  });
  const existingRow =
    opts.existingPlanId != null
      ? { id: opts.existingPlanId, household_id: HOUSEHOLD_ID, week_id: WEEK_ID }
      : null;
  const findActiveByHouseholdAndWeek = vi.fn().mockResolvedValue(existingRow);
  return { commit, findActiveByHouseholdAndWeek } as unknown as PlansRepository & {
    commit: ReturnType<typeof vi.fn>;
    findActiveByHouseholdAndWeek: ReturnType<typeof vi.fn>;
  };
}

function buildGuardrail(verdicts: GuardrailResult[]): AllergyGuardrailService & {
  clearOrReject: ReturnType<typeof vi.fn>;
} {
  let i = 0;
  const clearOrReject = vi.fn(async () => {
    const v = verdicts[Math.min(i, verdicts.length - 1)];
    i += 1;
    return v;
  });
  return { clearOrReject } as unknown as AllergyGuardrailService & {
    clearOrReject: ReturnType<typeof vi.fn>;
  };
}

function buildAudit() {
  return {
    write: vi.fn().mockResolvedValue(undefined),
  } as unknown as AuditService & { write: ReturnType<typeof vi.fn> };
}

function buildBriefStateRepo(): BriefStateRepository {
  return {
    findByHousehold: vi.fn().mockResolvedValue(null),
    upsert: vi.fn().mockResolvedValue(undefined),
  } as unknown as BriefStateRepository;
}

function buildBriefStateComposer(): BriefStateComposer & {
  refresh: ReturnType<typeof vi.fn>;
} {
  return {
    refresh: vi.fn().mockResolvedValue(undefined),
  } as unknown as BriefStateComposer & { refresh: ReturnType<typeof vi.fn> };
}

describe('PlansService.compose (Story 3.7 — pure transform with generated plan_id)', () => {
  it('returns a PlanComposeOutput with a freshly-generated plan_id', async () => {
    const service = new PlansService({
      repository: buildRepo(),
      briefStateRepository: buildBriefStateRepo(),
      briefStateComposer: buildBriefStateComposer(),
      allergyGuardrail: buildGuardrail([{ verdict: 'cleared', conflicts: [] }]),
      auditService: buildAudit(),
      logger: buildLogger(),
      redis: buildRedis(),
      regenQueue: buildRegenQueue(),
    });
    const input: PlanComposeInput = {
      household_id: HOUSEHOLD_ID,
      week_of: '2026-05-11',
      days: [
        {
          day: 'monday',
          items: [{ child_id: CHILD_ID, slot: 'main', ingredients: ['rice'] }],
        },
      ],
      prompt_version: 'v1.0.0',
    };

    const output = await service.compose(input);

    expect(output.plan_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(output.household_id).toBe(HOUSEHOLD_ID);
    expect(output.week_of).toBe('2026-05-11');
    expect(output.days).toEqual(input.days);
    expect(output.prompt_version).toBe('v1.0.0');
  });

  it('mints a different plan_id on repeated calls (does not memoize)', async () => {
    const service = new PlansService({
      repository: buildRepo(),
      briefStateRepository: buildBriefStateRepo(),
      briefStateComposer: buildBriefStateComposer(),
      allergyGuardrail: buildGuardrail([{ verdict: 'cleared', conflicts: [] }]),
      auditService: buildAudit(),
      logger: buildLogger(),
      redis: buildRedis(),
      regenQueue: buildRegenQueue(),
    });
    const input: PlanComposeInput = {
      household_id: HOUSEHOLD_ID,
      week_of: '2026-05-11',
      days: [
        {
          day: 'monday',
          items: [{ child_id: CHILD_ID, slot: 'main', ingredients: ['rice'] }],
        },
      ],
      prompt_version: 'v1.0.0',
    };

    const first = await service.compose(input);
    const second = await service.compose(input);
    expect(first.plan_id).not.toBe(second.plan_id);
  });
});

describe('PlansService.commit', () => {
  it('clears, commits, and writes plan.generated audit on first-attempt success', async () => {
    const repo = buildRepo();
    const guardrail = buildGuardrail([{ verdict: 'cleared', conflicts: [] }]);
    const audit = buildAudit();
    const service = new PlansService({
      repository: repo,
      briefStateRepository: buildBriefStateRepo(),
      briefStateComposer: buildBriefStateComposer(),
      allergyGuardrail: guardrail,
      auditService: audit,
      logger: buildLogger(),
      redis: buildRedis(),
      regenQueue: buildRegenQueue(),
    });

    const regenerate = vi.fn();
    const result = await service.commit(makeInput(), REQUEST_ID, regenerate);

    expect(result).toBe(PLAN_ID);
    expect(guardrail.clearOrReject).toHaveBeenCalledTimes(1);
    expect(repo.commit).toHaveBeenCalledTimes(1);
    expect(repo.commit.mock.calls[0][2]).toBe(GUARDRAIL_VERSION);
    expect(regenerate).not.toHaveBeenCalled();

    const auditCall = audit.write.mock.calls[0]?.[0];
    expect(auditCall).toMatchObject({
      event_type: 'plan.generated',
      household_id: HOUSEHOLD_ID,
      request_id: REQUEST_ID,
      metadata: expect.objectContaining({ plan_id: PLAN_ID, revision: 1, prompt_version: 'v1.0.0' }),
    });
    expect(auditCall.stages).toEqual([
      { stage: 'guardrail_verdict', verdict: 'cleared', guardrail_version: GUARDRAIL_VERSION },
    ]);
  });

  it('only commits to the repository when verdict is cleared', async () => {
    const repo = buildRepo();
    const blocked: GuardrailResult = {
      verdict: 'blocked',
      conflicts: [
        { child_id: CHILD_ID, allergen: 'peanuts', ingredient: 'peanut butter', day: 'monday', slot: 'main' },
      ],
    };
    const guardrail = buildGuardrail([blocked, blocked, blocked]);
    const audit = buildAudit();
    const service = new PlansService({
      repository: repo,
      briefStateRepository: buildBriefStateRepo(),
      briefStateComposer: buildBriefStateComposer(),
      allergyGuardrail: guardrail,
      auditService: audit,
      logger: buildLogger(),
      redis: buildRedis(),
      regenQueue: buildRegenQueue(),
    });

    const regenerate = vi.fn(async () => makeInput());
    await expect(service.commit(makeInput(), REQUEST_ID, regenerate)).rejects.toBeInstanceOf(
      GuardrailRejectionError,
    );
    expect(repo.commit).not.toHaveBeenCalled();
    expect(audit.write).not.toHaveBeenCalled();
  });

  it('retries via regenerate() up to 3 attempts and clears on the third', async () => {
    const repo = buildRepo();
    const blocked: GuardrailResult = {
      verdict: 'blocked',
      conflicts: [
        { child_id: CHILD_ID, allergen: 'peanuts', ingredient: 'peanut butter', day: 'monday', slot: 'main' },
      ],
    };
    const guardrail = buildGuardrail([blocked, blocked, { verdict: 'cleared', conflicts: [] }]);
    const audit = buildAudit();
    const service = new PlansService({
      repository: repo,
      briefStateRepository: buildBriefStateRepo(),
      briefStateComposer: buildBriefStateComposer(),
      allergyGuardrail: guardrail,
      auditService: audit,
      logger: buildLogger(),
      redis: buildRedis(),
      regenQueue: buildRegenQueue(),
    });

    const regenerate = vi.fn(async () => makeInput());
    const result = await service.commit(makeInput(), REQUEST_ID, regenerate);

    expect(result).toBe(PLAN_ID);
    expect(guardrail.clearOrReject).toHaveBeenCalledTimes(3);
    expect(regenerate).toHaveBeenCalledTimes(2);
    expect(repo.commit).toHaveBeenCalledTimes(1);

    const auditCall = audit.write.mock.calls[0]?.[0];
    expect(auditCall.stages).toEqual([
      { stage: 'guardrail_rejection', attempt: 1, conflicts: blocked.conflicts },
      { stage: 'guardrail_rejection', attempt: 2, conflicts: blocked.conflicts },
      { stage: 'guardrail_verdict', verdict: 'cleared', guardrail_version: GUARDRAIL_VERSION },
    ]);
  });

  it('throws GuardrailRejectionError after 3 failed attempts and never calls regenerate beyond attempt 2', async () => {
    const repo = buildRepo();
    const blocked: GuardrailResult = {
      verdict: 'blocked',
      conflicts: [
        { child_id: CHILD_ID, allergen: 'peanuts', ingredient: 'peanut butter', day: 'monday', slot: 'main' },
      ],
    };
    const guardrail = buildGuardrail([blocked, blocked, blocked]);
    const audit = buildAudit();
    const service = new PlansService({
      repository: repo,
      briefStateRepository: buildBriefStateRepo(),
      briefStateComposer: buildBriefStateComposer(),
      allergyGuardrail: guardrail,
      auditService: audit,
      logger: buildLogger(),
      redis: buildRedis(),
      regenQueue: buildRegenQueue(),
    });

    const regenerate = vi.fn(async () => makeInput());
    await expect(service.commit(makeInput(), REQUEST_ID, regenerate)).rejects.toBeInstanceOf(
      GuardrailRejectionError,
    );

    expect(guardrail.clearOrReject).toHaveBeenCalledTimes(3);
    // regenerate is invoked between attempts (after attempt 1 and 2), not after attempt 3
    expect(regenerate).toHaveBeenCalledTimes(2);
  });

  it('passes only child_id/day/slot/ingredients to the guardrail (drops recipe_id/item_id)', async () => {
    const repo = buildRepo();
    const guardrail = buildGuardrail([{ verdict: 'cleared', conflicts: [] }]);
    const audit = buildAudit();
    const service = new PlansService({
      repository: repo,
      briefStateRepository: buildBriefStateRepo(),
      briefStateComposer: buildBriefStateComposer(),
      allergyGuardrail: guardrail,
      auditService: audit,
      logger: buildLogger(),
      redis: buildRedis(),
      regenQueue: buildRegenQueue(),
    });

    const input = makeInput({
      items: [
        {
          child_id: CHILD_ID,
          day: 'monday',
          slot: 'main',
          recipe_id: '99999999-9999-4999-8999-999999999999',
          item_id: '88888888-8888-4888-8888-888888888888',
          ingredients: ['rice'],
        },
      ],
    });
    await service.commit(input, REQUEST_ID, vi.fn());

    const passedItems = guardrail.clearOrReject.mock.calls[0]?.[0];
    expect(passedItems).toEqual([
      { child_id: CHILD_ID, day: 'monday', slot: 'main', ingredients: ['rice'] },
    ]);
  });

  it('writes a guardrail-cleared timestamp to repository.commit on success', async () => {
    const repo = buildRepo();
    const guardrail = buildGuardrail([{ verdict: 'cleared', conflicts: [] }]);
    const audit = buildAudit();
    const service = new PlansService({
      repository: repo,
      briefStateRepository: buildBriefStateRepo(),
      briefStateComposer: buildBriefStateComposer(),
      allergyGuardrail: guardrail,
      auditService: audit,
      logger: buildLogger(),
      redis: buildRedis(),
      regenQueue: buildRegenQueue(),
    });

    await service.commit(makeInput(), REQUEST_ID, vi.fn());

    const clearedAt = repo.commit.mock.calls[0][1];
    expect(clearedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('reuses existing plan_id when a plan already exists for the household+week', async () => {
    const EXISTING_PLAN_ID = '99999999-9999-4999-8999-999999999999';
    const repo = buildRepo({ existingPlanId: EXISTING_PLAN_ID });
    const guardrail = buildGuardrail([{ verdict: 'cleared', conflicts: [] }]);
    const audit = buildAudit();
    const service = new PlansService({
      repository: repo,
      briefStateRepository: buildBriefStateRepo(),
      briefStateComposer: buildBriefStateComposer(),
      allergyGuardrail: guardrail,
      auditService: audit,
      logger: buildLogger(),
      redis: buildRedis(),
      regenQueue: buildRegenQueue(),
    });

    const result = await service.commit(makeInput(), REQUEST_ID, vi.fn());

    expect(result).toBe(EXISTING_PLAN_ID);
    expect(repo.commit.mock.calls[0][0].plan_id).toBe(EXISTING_PLAN_ID);
  });

  it('throws GuardrailRejectionError immediately on uncertain verdict (infrastructure failure)', async () => {
    const repo = buildRepo();
    const guardrail = buildGuardrail([{ verdict: 'uncertain', conflicts: [] }]);
    const audit = buildAudit();
    const service = new PlansService({
      repository: repo,
      briefStateRepository: buildBriefStateRepo(),
      briefStateComposer: buildBriefStateComposer(),
      allergyGuardrail: guardrail,
      auditService: audit,
      logger: buildLogger(),
      redis: buildRedis(),
      regenQueue: buildRegenQueue(),
    });

    const regenerate = vi.fn();
    await expect(service.commit(makeInput(), REQUEST_ID, regenerate)).rejects.toBeInstanceOf(
      GuardrailRejectionError,
    );
    expect(guardrail.clearOrReject).toHaveBeenCalledTimes(1);
    expect(regenerate).not.toHaveBeenCalled();
    expect(repo.commit).not.toHaveBeenCalled();
  });

  it('throws GuardrailRejectionError when regenerate() throws during retry', async () => {
    const repo = buildRepo();
    const blocked: GuardrailResult = {
      verdict: 'blocked',
      conflicts: [
        { child_id: CHILD_ID, allergen: 'peanuts', ingredient: 'peanut butter', day: 'monday', slot: 'main' },
      ],
    };
    const guardrail = buildGuardrail([blocked]);
    const audit = buildAudit();
    const service = new PlansService({
      repository: repo,
      briefStateRepository: buildBriefStateRepo(),
      briefStateComposer: buildBriefStateComposer(),
      allergyGuardrail: guardrail,
      auditService: audit,
      logger: buildLogger(),
      redis: buildRedis(),
      regenQueue: buildRegenQueue(),
    });

    const regenerate = vi.fn().mockRejectedValue(new Error('LLM unavailable'));
    await expect(service.commit(makeInput(), REQUEST_ID, regenerate)).rejects.toBeInstanceOf(
      GuardrailRejectionError,
    );
    expect(repo.commit).not.toHaveBeenCalled();
  });

  it('returns planId and logs error when audit write fails after successful commit', async () => {
    const repo = buildRepo();
    const guardrail = buildGuardrail([{ verdict: 'cleared', conflicts: [] }]);
    const audit = {
      write: vi.fn().mockRejectedValue(new Error('audit DB down')),
    } as unknown as AuditService & { write: ReturnType<typeof vi.fn> };
    const logger = buildLogger();
    const service = new PlansService({
      repository: repo,
      briefStateRepository: buildBriefStateRepo(),
      briefStateComposer: buildBriefStateComposer(),
      allergyGuardrail: guardrail,
      auditService: audit,
      logger,
      redis: buildRedis(),
      regenQueue: buildRegenQueue(),
    });

    const result = await service.commit(makeInput(), REQUEST_ID, vi.fn());

    expect(result).toBe(PLAN_ID);
    expect(repo.commit).toHaveBeenCalledTimes(1);
    expect((logger.error as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      expect.objectContaining({ plan_id: PLAN_ID }),
      expect.stringContaining('audit write failed'),
    );
  });
});

// --- Story 3.12 — swapItem + pauseDay ---

const ITEM_ID = '00000000-0000-4000-8000-000000000010';

function makePlanRow(overrides: Partial<PlanRow> = {}): PlanRow {
  return {
    id: PLAN_ID,
    household_id: HOUSEHOLD_ID,
    week_id: WEEK_ID,
    week_of: '2026-05-04',
    revision: 1,
    generated_at: '2026-05-02T11:00:00.000Z',
    guardrail_cleared_at: '2026-05-02T11:00:01.000Z',
    guardrail_version: '1.1.0',
    prompt_version: 'v1.0.0',
    created_at: '2026-05-02T11:00:00.000Z',
    updated_at: '2026-05-02T11:00:01.000Z',
    ...overrides,
  };
}

function makeItemRow(overrides: Partial<PlanItemRow> = {}): PlanItemRow {
  return {
    id: ITEM_ID,
    plan_id: PLAN_ID,
    child_id: CHILD_ID,
    day: 'monday',
    slot: 'main',
    recipe_id: null,
    item_id: null,
    ingredients: ['rice'],
    paused_at: null,
    replaced_by_plan_id: null,
    created_at: '2026-05-02T11:00:00.000Z',
    updated_at: '2026-05-02T11:00:00.000Z',
    ...overrides,
  };
}

function buildSwapRepo(opts: {
  plan?: PlanRow | null;
  existingItem?: PlanItemRow | null;
  updatedItem?: PlanItemRow;
  pauseDayThrows?: Error;
  // Story 3.12 Round 2: pauseDay returns the rows it actually flipped (empty
  // means already-paused). countItemsForDay returns the total row count for
  // the (plan, day) pair (zero means the day doesn't exist in the plan).
  pausedRows?: PlanItemRow[];
  itemCountForDay?: number;
} = {}): PlansRepository & {
  findByIdForPresentation: ReturnType<typeof vi.fn>;
  findItemById: ReturnType<typeof vi.fn>;
  updateItemIngredients: ReturnType<typeof vi.fn>;
  pauseDay: ReturnType<typeof vi.fn>;
  countItemsForDay: ReturnType<typeof vi.fn>;
} {
  const findByIdForPresentation = vi.fn().mockResolvedValue(opts.plan ?? null);
  const findItemById = vi.fn().mockResolvedValue(opts.existingItem ?? null);
  const updateItemIngredients = vi
    .fn()
    .mockResolvedValue(opts.updatedItem ?? makeItemRow());
  const pauseDay = vi.fn(async () => {
    if (opts.pauseDayThrows) throw opts.pauseDayThrows;
    return opts.pausedRows ?? [makeItemRow()];
  });
  const countItemsForDay = vi
    .fn()
    .mockResolvedValue(opts.itemCountForDay ?? 1);
  return {
    findByIdForPresentation,
    findItemById,
    updateItemIngredients,
    pauseDay,
    countItemsForDay,
  } as unknown as PlansRepository & {
    findByIdForPresentation: ReturnType<typeof vi.fn>;
    findItemById: ReturnType<typeof vi.fn>;
    updateItemIngredients: ReturnType<typeof vi.fn>;
    pauseDay: ReturnType<typeof vi.fn>;
    countItemsForDay: ReturnType<typeof vi.fn>;
  };
}

function buildEvalGuardrail(verdict: GuardrailResult): AllergyGuardrailService & {
  evaluate: ReturnType<typeof vi.fn>;
} {
  return {
    evaluate: vi.fn().mockResolvedValue(verdict),
  } as unknown as AllergyGuardrailService & {
    evaluate: ReturnType<typeof vi.fn>;
  };
}

describe('PlansService.swapItem (Story 3.12)', () => {
  it('throws NotFoundError when plan does not exist (or not owned by household)', async () => {
    const repo = buildSwapRepo({ plan: null });
    const service = new PlansService({
      repository: repo,
      briefStateRepository: buildBriefStateRepo(),
      briefStateComposer: buildBriefStateComposer(),
      allergyGuardrail: buildEvalGuardrail({ verdict: 'cleared', conflicts: [] }),
      auditService: buildAudit(),
      logger: buildLogger(),
      redis: buildRedis(),
      regenQueue: buildRegenQueue(),
    });

    await expect(
      service.swapItem({
        planId: PLAN_ID,
        itemId: ITEM_ID,
        householdId: HOUSEHOLD_ID,
        input: { ingredients: ['hummus'] },
        requestId: REQUEST_ID,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(repo.findItemById).not.toHaveBeenCalled();
    expect(repo.updateItemIngredients).not.toHaveBeenCalled();
  });

  it('throws NotFoundError when item does not exist on plan', async () => {
    const repo = buildSwapRepo({ plan: makePlanRow(), existingItem: null });
    const service = new PlansService({
      repository: repo,
      briefStateRepository: buildBriefStateRepo(),
      briefStateComposer: buildBriefStateComposer(),
      allergyGuardrail: buildEvalGuardrail({ verdict: 'cleared', conflicts: [] }),
      auditService: buildAudit(),
      logger: buildLogger(),
      redis: buildRedis(),
      regenQueue: buildRegenQueue(),
    });

    await expect(
      service.swapItem({
        planId: PLAN_ID,
        itemId: ITEM_ID,
        householdId: HOUSEHOLD_ID,
        input: { ingredients: ['hummus'] },
        requestId: REQUEST_ID,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(repo.updateItemIngredients).not.toHaveBeenCalled();
  });

  it('throws SwapGuardrailBlockedError on blocked verdict and writes guardrail_rejection audit', async () => {
    const repo = buildSwapRepo({
      plan: makePlanRow(),
      existingItem: makeItemRow(),
    });
    const audit = buildAudit();
    const service = new PlansService({
      repository: repo,
      briefStateRepository: buildBriefStateRepo(),
      briefStateComposer: buildBriefStateComposer(),
      allergyGuardrail: buildEvalGuardrail({
        verdict: 'blocked',
        conflicts: [
          { child_id: CHILD_ID, allergen: 'peanut', ingredient: 'peanut butter', day: 'monday', slot: 'main' },
        ],
      }),
      auditService: audit,
      logger: buildLogger(),
      redis: buildRedis(),
      regenQueue: buildRegenQueue(),
    });

    await expect(
      service.swapItem({
        planId: PLAN_ID,
        itemId: ITEM_ID,
        householdId: HOUSEHOLD_ID,
        input: { ingredients: ['peanut butter'] },
        requestId: REQUEST_ID,
      }),
    ).rejects.toBeInstanceOf(SwapGuardrailBlockedError);

    expect(repo.updateItemIngredients).not.toHaveBeenCalled();
    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'allergy.guardrail_rejection',
        metadata: expect.objectContaining({
          plan_id: PLAN_ID,
          item_id: ITEM_ID,
          source: 'user_swap',
          verdict: 'blocked',
          allergens: ['peanut'],
        }),
      }),
    );
  });

  it('throws SwapGuardrailBlockedError on uncertain verdict', async () => {
    const repo = buildSwapRepo({
      plan: makePlanRow(),
      existingItem: makeItemRow(),
    });
    const service = new PlansService({
      repository: repo,
      briefStateRepository: buildBriefStateRepo(),
      briefStateComposer: buildBriefStateComposer(),
      allergyGuardrail: buildEvalGuardrail({
        verdict: 'uncertain',
        conflicts: [],
        reason: 'no_rules_loaded',
      }),
      auditService: buildAudit(),
      logger: buildLogger(),
      redis: buildRedis(),
      regenQueue: buildRegenQueue(),
    });

    await expect(
      service.swapItem({
        planId: PLAN_ID,
        itemId: ITEM_ID,
        householdId: HOUSEHOLD_ID,
        input: { ingredients: ['hummus'] },
        requestId: REQUEST_ID,
      }),
    ).rejects.toBeInstanceOf(SwapGuardrailBlockedError);

    expect(repo.updateItemIngredients).not.toHaveBeenCalled();
  });

  it('on cleared verdict: updates ingredients, refreshes brief with userInitiated:true, and writes plan.item_swapped audit', async () => {
    const updatedItem = makeItemRow({ ingredients: ['hummus', 'crackers'] });
    const repo = buildSwapRepo({
      plan: makePlanRow(),
      existingItem: makeItemRow(),
      updatedItem,
    });
    const composer = buildBriefStateComposer();
    const audit = buildAudit();
    const service = new PlansService({
      repository: repo,
      briefStateRepository: buildBriefStateRepo(),
      briefStateComposer: composer,
      allergyGuardrail: buildEvalGuardrail({ verdict: 'cleared', conflicts: [] }),
      auditService: audit,
      logger: buildLogger(),
      redis: buildRedis(),
      regenQueue: buildRegenQueue(),
    });

    const result = await service.swapItem({
      planId: PLAN_ID,
      itemId: ITEM_ID,
      householdId: HOUSEHOLD_ID,
      input: { ingredients: ['hummus', 'crackers'] },
      requestId: REQUEST_ID,
    });

    expect(result).toEqual(updatedItem);
    expect(repo.updateItemIngredients).toHaveBeenCalledWith({
      itemId: ITEM_ID,
      planId: PLAN_ID,
      ingredients: ['hummus', 'crackers'],
      recipeId: undefined,
      itemSlotId: undefined,
    });
    expect(composer.refresh).toHaveBeenCalledWith(
      HOUSEHOLD_ID,
      WEEK_ID,
      REQUEST_ID,
      { userInitiated: true },
    );
    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'plan.item_swapped',
        metadata: expect.objectContaining({
          plan_id: PLAN_ID,
          item_id: ITEM_ID,
          day: 'monday',
          slot: 'main',
          new_ingredients: ['hummus', 'crackers'],
          guardrail_version: GUARDRAIL_VERSION,
        }),
      }),
    );
  });

  it('audit failure after successful swap is logged but does not rethrow', async () => {
    const repo = buildSwapRepo({
      plan: makePlanRow(),
      existingItem: makeItemRow(),
      updatedItem: makeItemRow(),
    });
    const audit = {
      write: vi.fn().mockRejectedValue(new Error('audit DB down')),
    } as unknown as AuditService & { write: ReturnType<typeof vi.fn> };
    const logger = buildLogger();
    const service = new PlansService({
      repository: repo,
      briefStateRepository: buildBriefStateRepo(),
      briefStateComposer: buildBriefStateComposer(),
      allergyGuardrail: buildEvalGuardrail({ verdict: 'cleared', conflicts: [] }),
      auditService: audit,
      logger,
      redis: buildRedis(),
      regenQueue: buildRegenQueue(),
    });

    await expect(
      service.swapItem({
        planId: PLAN_ID,
        itemId: ITEM_ID,
        householdId: HOUSEHOLD_ID,
        input: { ingredients: ['hummus'] },
        requestId: REQUEST_ID,
      }),
    ).resolves.toBeDefined();

    expect((logger.error as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      expect.objectContaining({ plan_id: PLAN_ID, item_id: ITEM_ID }),
      expect.stringContaining('audit write failed after item swap'),
    );
  });
});

describe('PlansService.requestRegeneration (Story 3.13)', () => {
  function buildRegenRepo(opts: { plan?: PlanRow | null }): PlansRepository & {
    findByIdForPresentation: ReturnType<typeof vi.fn>;
  } {
    const findByIdForPresentation = vi.fn().mockResolvedValue(opts.plan ?? null);
    return { findByIdForPresentation } as unknown as PlansRepository & {
      findByIdForPresentation: ReturnType<typeof vi.fn>;
    };
  }

  function buildService(deps: {
    repo: PlansRepository;
    redis: RedisMock;
    queue: QueueMock;
    audit?: AuditService;
    logger?: FastifyBaseLogger;
  }) {
    return new PlansService({
      repository: deps.repo,
      briefStateRepository: buildBriefStateRepo(),
      briefStateComposer: buildBriefStateComposer(),
      allergyGuardrail: buildEvalGuardrail({ verdict: 'cleared', conflicts: [] }),
      auditService: deps.audit ?? buildAudit(),
      logger: deps.logger ?? buildLogger(),
      redis: deps.redis,
      regenQueue: deps.queue,
    });
  }

  it('throws NotFoundError when plan does not exist', async () => {
    const service = buildService({
      repo: buildRegenRepo({ plan: null }),
      redis: buildRedis(),
      queue: buildRegenQueue(),
    });

    await expect(
      service.requestRegeneration({
        planId: PLAN_ID,
        householdId: HOUSEHOLD_ID,
        query: { scope: 'week' },
        requestId: REQUEST_ID,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws ValidationError when plan.week_of is null (pre-3.13 row)', async () => {
    const service = buildService({
      repo: buildRegenRepo({ plan: makePlanRow({ week_of: null }) }),
      redis: buildRedis(),
      queue: buildRegenQueue(),
    });

    await expect(
      service.requestRegeneration({
        planId: PLAN_ID,
        householdId: HOUSEHOLD_ID,
        query: { scope: 'week' },
        requestId: REQUEST_ID,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('first call: increments redis counter, sets TTL, enqueues job, returns rateLimitRemaining=4', async () => {
    const redis = buildRedis({ incrCount: 1 });
    const queue = buildRegenQueue({ jobId: 'regen-1' });
    const audit = buildAudit();
    const service = buildService({
      repo: buildRegenRepo({ plan: makePlanRow() }),
      redis,
      queue,
      audit,
    });

    const res = await service.requestRegeneration({
      planId: PLAN_ID,
      householdId: HOUSEHOLD_ID,
      query: { scope: 'week' },
      requestId: REQUEST_ID,
    });

    expect(res).toEqual({ jobId: 'regen-1', rateLimitRemaining: 4 });
    expect(redis.incr).toHaveBeenCalledWith(`regen-limit:${HOUSEHOLD_ID}:${WEEK_ID}`);
    expect(redis.expire).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'plan.regeneration_requested',
        metadata: expect.objectContaining({
          plan_id: PLAN_ID,
          scope: 'week',
          rate_limit_used: 1,
        }),
      }),
    );
  });

  it('5th call: succeeds with rateLimitRemaining=0', async () => {
    const redis = buildRedis({ incrCount: 5 });
    const service = buildService({
      repo: buildRegenRepo({ plan: makePlanRow() }),
      redis,
      queue: buildRegenQueue(),
    });

    const res = await service.requestRegeneration({
      planId: PLAN_ID,
      householdId: HOUSEHOLD_ID,
      query: { scope: 'week' },
      requestId: REQUEST_ID,
    });

    expect(res.rateLimitRemaining).toBe(0);
    expect(redis.expire).not.toHaveBeenCalled();
  });

  it('6th call: throws TooManyRequestsError', async () => {
    const redis = buildRedis({ incrCount: 6, ttl: 3600 });
    const queue = buildRegenQueue();
    const service = buildService({
      repo: buildRegenRepo({ plan: makePlanRow() }),
      redis,
      queue,
    });

    await expect(
      service.requestRegeneration({
        planId: PLAN_ID,
        householdId: HOUSEHOLD_ID,
        query: { scope: 'week' },
        requestId: REQUEST_ID,
      }),
    ).rejects.toBeInstanceOf(TooManyRequestsError);

    expect(queue.add).not.toHaveBeenCalled();
  });

  it('day-scope query: enqueues job with day field set', async () => {
    const queue = buildRegenQueue();
    const service = buildService({
      repo: buildRegenRepo({ plan: makePlanRow() }),
      redis: buildRedis(),
      queue,
    });

    await service.requestRegeneration({
      planId: PLAN_ID,
      householdId: HOUSEHOLD_ID,
      query: { scope: 'day', day: 'tuesday' },
      requestId: REQUEST_ID,
    });

    const enqueued = queue.add.mock.calls[0]?.[1];
    expect(enqueued).toMatchObject({
      plan_id: PLAN_ID,
      household_id: HOUSEHOLD_ID,
      scope: 'day',
      day: 'tuesday',
    });
  });

  it('audit failure does not rethrow (job stays enqueued)', async () => {
    const audit = {
      write: vi.fn().mockRejectedValue(new Error('audit DB down')),
    } as unknown as AuditService & { write: ReturnType<typeof vi.fn> };
    const service = buildService({
      repo: buildRegenRepo({ plan: makePlanRow() }),
      redis: buildRedis(),
      queue: buildRegenQueue(),
      audit,
    });

    await expect(
      service.requestRegeneration({
        planId: PLAN_ID,
        householdId: HOUSEHOLD_ID,
        query: { scope: 'week' },
        requestId: REQUEST_ID,
      }),
    ).resolves.toMatchObject({ rateLimitRemaining: expect.any(Number) });
  });
});

describe('PlansService.pauseDay (Story 3.12)', () => {
  it('throws NotFoundError when plan does not exist', async () => {
    const repo = buildSwapRepo({ plan: null });
    const service = new PlansService({
      repository: repo,
      briefStateRepository: buildBriefStateRepo(),
      briefStateComposer: buildBriefStateComposer(),
      allergyGuardrail: buildEvalGuardrail({ verdict: 'cleared', conflicts: [] }),
      auditService: buildAudit(),
      logger: buildLogger(),
      redis: buildRedis(),
      regenQueue: buildRegenQueue(),
    });

    await expect(
      service.pauseDay({
        planId: PLAN_ID,
        day: 'tuesday',
        householdId: HOUSEHOLD_ID,
        requestId: REQUEST_ID,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(repo.pauseDay).not.toHaveBeenCalled();
  });

  it('on success: calls repo.pauseDay, refreshes brief userInitiated:true, and audits plan.day_paused', async () => {
    const repo = buildSwapRepo({ plan: makePlanRow() });
    const composer = buildBriefStateComposer();
    const audit = buildAudit();
    const service = new PlansService({
      repository: repo,
      briefStateRepository: buildBriefStateRepo(),
      briefStateComposer: composer,
      allergyGuardrail: buildEvalGuardrail({ verdict: 'cleared', conflicts: [] }),
      auditService: audit,
      logger: buildLogger(),
      redis: buildRedis(),
      regenQueue: buildRegenQueue(),
    });

    await service.pauseDay({
      planId: PLAN_ID,
      day: 'tuesday',
      householdId: HOUSEHOLD_ID,
      requestId: REQUEST_ID,
    });

    expect(repo.pauseDay).toHaveBeenCalledWith({
      planId: PLAN_ID,
      day: 'tuesday',
      pausedAt: expect.any(String),
    });
    expect(composer.refresh).toHaveBeenCalledWith(
      HOUSEHOLD_ID,
      WEEK_ID,
      REQUEST_ID,
      { userInitiated: true },
    );
    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'plan.day_paused',
        metadata: expect.objectContaining({
          plan_id: PLAN_ID,
          day: 'tuesday',
        }),
      }),
    );
  });

  it('audit failure after successful pause is logged but does not rethrow', async () => {
    const repo = buildSwapRepo({ plan: makePlanRow() });
    const audit = {
      write: vi.fn().mockRejectedValue(new Error('audit DB down')),
    } as unknown as AuditService & { write: ReturnType<typeof vi.fn> };
    const logger = buildLogger();
    const service = new PlansService({
      repository: repo,
      briefStateRepository: buildBriefStateRepo(),
      briefStateComposer: buildBriefStateComposer(),
      allergyGuardrail: buildEvalGuardrail({ verdict: 'cleared', conflicts: [] }),
      auditService: audit,
      logger,
      redis: buildRedis(),
      regenQueue: buildRegenQueue(),
    });

    await expect(
      service.pauseDay({
        planId: PLAN_ID,
        day: 'tuesday',
        householdId: HOUSEHOLD_ID,
        requestId: REQUEST_ID,
      }),
    ).resolves.toBeUndefined();

    expect((logger.error as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      expect.objectContaining({ plan_id: PLAN_ID }),
      expect.stringContaining('audit write failed after day pause'),
    );
  });
});
