import { describe, it, expect, vi } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import type Redis from 'ioredis';
import type { Queue } from 'bullmq';
import {
  PlansService,
  getCurrentWeekMonday,
  getNextWeekMonday,
} from './plans.service.js';
import { deriveWeekId } from '../../jobs/plan-generation.job.js';
import type { PlansRepository } from './plans.repository.js';
import type { BriefStateRepository } from './brief-state.repository.js';
import type { BriefStateComposer } from './brief-state.composer.js';
import type { AllergyGuardrailService } from '../allergy-guardrail/allergy-guardrail.service.js';
import type { AuditService } from '../../audit/audit.service.js';
import type { RecipeService } from '../recipe/recipe.service.js';
import type {
  CommitPlanInput,
  GuardrailResult,
  PlanComposeInput,
  RecipeAgentExtraction,
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
        { child_id: CHILD_ID, allergen: 'peanut', ingredient: 'peanut butter', day: 'monday', slot: 'main' },
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
    // Story 3.25 — audit.write IS now called with plan.hard_fail before the
    // throw; assert no plan.generated audit was emitted on the failure path.
    const generatedCalls = audit.write.mock.calls.filter(
      (call) => (call[0] as { event_type: string }).event_type === 'plan.generated',
    );
    expect(generatedCalls).toHaveLength(0);
  });

  it('retries via regenerate() up to 3 attempts and clears on the third', async () => {
    const repo = buildRepo();
    const blocked: GuardrailResult = {
      verdict: 'blocked',
      conflicts: [
        { child_id: CHILD_ID, allergen: 'peanut', ingredient: 'peanut butter', day: 'monday', slot: 'main' },
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
        { child_id: CHILD_ID, allergen: 'peanut', ingredient: 'peanut butter', day: 'monday', slot: 'main' },
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
    const guardrail = buildGuardrail([
      { verdict: 'uncertain', conflicts: [], reason: 'no_rules_loaded' },
    ]);
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
    expect(audit.write).not.toHaveBeenCalledWith(expect.objectContaining({ event_type: 'plan.hard_fail' }));
  });

  it('throws GuardrailRejectionError on infrastructure-uncertain "empty_ingredients"', async () => {
    const repo = buildRepo();
    const guardrail = buildGuardrail([
      { verdict: 'uncertain', conflicts: [], reason: 'empty_ingredients' },
    ]);
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
    expect(regenerate).not.toHaveBeenCalled();
    expect(audit.write).not.toHaveBeenCalledWith(expect.objectContaining({ event_type: 'plan.hard_fail' }));
  });

  // -------------------- Story 3.24 — compound-uncertain retry path --------------------

  it('retries via regenerate() on compound-uncertain reason (does NOT throw immediately)', async () => {
    const repo = buildRepo();
    const guardrail = buildGuardrail([
      {
        verdict: 'uncertain',
        conflicts: [],
        reason: 'compound_ingredient_unverified',
        flagged_items: [
          { child_id: CHILD_ID, ingredient: 'garam masala', slot: 'main', day: 'monday' },
        ],
      },
      { verdict: 'cleared', conflicts: [] },
    ]);
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

    const cleanInput = makeInput({
      items: [{ child_id: CHILD_ID, day: 'monday', slot: 'main', ingredients: ['rice', 'broccoli'] }],
    });
    const regenerate = vi.fn().mockResolvedValue(cleanInput);
    const result = await service.commit(makeInput(), REQUEST_ID, regenerate);

    expect(result).toBe(PLAN_ID);
    expect(regenerate).toHaveBeenCalledTimes(1);
    expect(repo.commit).toHaveBeenCalledTimes(1);
    // regenerate received the compound-uncertain rejection
    const passedRejections = regenerate.mock.calls[0][0] as GuardrailResult[];
    expect(passedRejections[0].verdict).toBe('uncertain');
    if (passedRejections[0].verdict === 'uncertain') {
      expect(passedRejections[0].reason).toBe('compound_ingredient_unverified');
    }
  });

  it('throws GuardrailRejectionError after MAX retries even for compound-uncertain', async () => {
    const repo = buildRepo();
    const compoundResult: GuardrailResult = {
      verdict: 'uncertain',
      conflicts: [],
      reason: 'compound_ingredient_unverified',
      flagged_items: [
        { child_id: CHILD_ID, ingredient: 'garam masala', slot: 'main', day: 'monday' },
      ],
    };
    const guardrail = buildGuardrail([compoundResult, compoundResult, compoundResult]);
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

    const regenerate = vi.fn().mockResolvedValue(makeInput());
    await expect(service.commit(makeInput(), REQUEST_ID, regenerate)).rejects.toBeInstanceOf(
      GuardrailRejectionError,
    );
    expect(repo.commit).not.toHaveBeenCalled();
  });

  it('throws GuardrailRejectionError when regenerate() throws during retry', async () => {
    const repo = buildRepo();
    const blocked: GuardrailResult = {
      verdict: 'blocked',
      conflicts: [
        { child_id: CHILD_ID, allergen: 'peanut', ingredient: 'peanut butter', day: 'monday', slot: 'main' },
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
    // regenerate() throwing is infra failure (not guardrail exhaustion) — plan.hard_fail must NOT be emitted
    expect(audit.write).not.toHaveBeenCalledWith(expect.objectContaining({ event_type: 'plan.hard_fail' }));
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

// ---------------------------------------------------------------------------
// Story 3.25 — hard-fail escalation
// ---------------------------------------------------------------------------

describe('PlansService.commit — plan.hard_fail audit (Story 3.25)', () => {
  const blocked: GuardrailResult = {
    verdict: 'blocked',
    conflicts: [
      { child_id: CHILD_ID, allergen: 'peanut', ingredient: 'peanut butter', day: 'monday', slot: 'main' },
    ],
  };

  it('writes plan.hard_fail audit with one stages entry per rejection before throwing', async () => {
    const repo = buildRepo();
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

    const regenerate = vi.fn().mockResolvedValue(makeInput());
    await expect(service.commit(makeInput(), REQUEST_ID, regenerate)).rejects.toBeInstanceOf(
      GuardrailRejectionError,
    );

    expect(audit.write).toHaveBeenCalledTimes(1);
    const auditCall = audit.write.mock.calls[0]?.[0];
    expect(auditCall).toMatchObject({
      event_type: 'plan.hard_fail',
      household_id: HOUSEHOLD_ID,
      request_id: REQUEST_ID,
      metadata: {
        plan_id: PLAN_ID,
        week_of: '2026-05-04',
        rejection_count: 3,
      },
    });
    expect(auditCall.stages).toHaveLength(3);
    expect(auditCall.stages[0]).toEqual({
      stage: 'guardrail_rejection',
      attempt: 1,
      verdict: 'blocked',
      conflicts: blocked.conflicts,
    });
    expect(auditCall.stages[2].attempt).toBe(3);
  });

  it('carries compound-uncertain reason + flagged_items on stages entries', async () => {
    const repo = buildRepo();
    const flagged = [
      { child_id: CHILD_ID, ingredient: 'garam masala', slot: 'main', day: 'monday' },
    ];
    const compound: GuardrailResult = {
      verdict: 'uncertain',
      conflicts: [],
      reason: 'compound_ingredient_unverified',
      flagged_items: flagged,
    };
    const guardrail = buildGuardrail([compound, compound, compound]);
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

    const regenerate = vi.fn().mockResolvedValue(makeInput());
    await expect(service.commit(makeInput(), REQUEST_ID, regenerate)).rejects.toBeInstanceOf(
      GuardrailRejectionError,
    );

    const auditCall = audit.write.mock.calls[0]?.[0];
    expect(auditCall.event_type).toBe('plan.hard_fail');
    expect(auditCall.stages[0]).toMatchObject({
      stage: 'guardrail_rejection',
      attempt: 1,
      verdict: 'uncertain',
      conflicts: [],
      reason: 'compound_ingredient_unverified',
      flagged_items: flagged,
    });
  });

  it('still throws GuardrailRejectionError when the audit write fails (AC4)', async () => {
    const repo = buildRepo();
    const guardrail = buildGuardrail([blocked, blocked, blocked]);
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

    const regenerate = vi.fn().mockResolvedValue(makeInput());
    await expect(service.commit(makeInput(), REQUEST_ID, regenerate)).rejects.toBeInstanceOf(
      GuardrailRejectionError,
    );
    expect((logger.error as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      expect.objectContaining({ plan_id: PLAN_ID }),
      expect.stringContaining('plan.hard_fail'),
    );
  });
});

describe('PlansService.getHardFailStatus (Story 3.25 / 3.26 / pre-4-s3)', () => {
  it('returns { week_of, failed_at, flagged_items=[] } when the repo finds a hard-fail audit row with no stages', async () => {
    const repo = {
      findHardFailAudit: vi.fn().mockResolvedValue({ failedAt: '2026-05-25T08:00:00Z', stages: null }),
    } as unknown as PlansRepository & { findHardFailAudit: ReturnType<typeof vi.fn> };
    const service = new PlansService({
      repository: repo,
      briefStateRepository: buildBriefStateRepo(),
      briefStateComposer: buildBriefStateComposer(),
      allergyGuardrail: buildGuardrail([{ verdict: 'cleared', conflicts: [] }]),
      auditService: buildAudit(),
      logger: buildLogger(),
      redis: buildRedis(),
      regenQueue: buildRegenQueue(),
    });

    const out = await service.getHardFailStatus(HOUSEHOLD_ID, '2026-05-04');

    expect(out).toEqual({ week_of: '2026-05-04', failed_at: '2026-05-25T08:00:00Z', flagged_items: [] });
    expect(repo.findHardFailAudit).toHaveBeenCalledWith(HOUSEHOLD_ID, '2026-05-04');
  });

  it('returns null when the repo finds no hard-fail audit row', async () => {
    const repo = {
      findHardFailAudit: vi.fn().mockResolvedValue(null),
    } as unknown as PlansRepository & { findHardFailAudit: ReturnType<typeof vi.fn> };
    const service = new PlansService({
      repository: repo,
      briefStateRepository: buildBriefStateRepo(),
      briefStateComposer: buildBriefStateComposer(),
      allergyGuardrail: buildGuardrail([{ verdict: 'cleared', conflicts: [] }]),
      auditService: buildAudit(),
      logger: buildLogger(),
      redis: buildRedis(),
      regenQueue: buildRegenQueue(),
    });

    const out = await service.getHardFailStatus(HOUSEHOLD_ID, '2026-05-04');

    expect(out).toBeNull();
  });

  it('extracts compound-uncertain flagged_items from stages, skipping non-matching stages', async () => {
    const childA = '11111111-1111-4111-8111-111111111111';
    const childB = '22222222-2222-4222-8222-222222222222';
    const stages = [
      { stage: 'guardrail_rejection', attempt: 1, verdict: 'blocked', conflicts: [] },
      {
        stage: 'guardrail_rejection',
        attempt: 2,
        verdict: 'uncertain',
        reason: 'compound_ingredient_unverified',
        flagged_items: [
          { child_id: childA, ingredient: 'garam masala', slot: 'main', day: 'monday' },
          { child_id: childB, ingredient: 'ranch dressing', slot: 'main', day: 'tuesday' },
        ],
      },
    ];
    const repo = {
      findHardFailAudit: vi.fn().mockResolvedValue({ failedAt: '2026-05-25T08:00:00Z', stages }),
    } as unknown as PlansRepository & { findHardFailAudit: ReturnType<typeof vi.fn> };
    const service = new PlansService({
      repository: repo,
      briefStateRepository: buildBriefStateRepo(),
      briefStateComposer: buildBriefStateComposer(),
      allergyGuardrail: buildGuardrail([{ verdict: 'cleared', conflicts: [] }]),
      auditService: buildAudit(),
      logger: buildLogger(),
      redis: buildRedis(),
      regenQueue: buildRegenQueue(),
    });

    const out = await service.getHardFailStatus(HOUSEHOLD_ID, '2026-05-04');

    expect(out).toEqual({
      week_of: '2026-05-04',
      failed_at: '2026-05-25T08:00:00Z',
      flagged_items: [
        { child_id: childA, ingredient: 'garam masala', slot: 'main', day: 'monday' },
        { child_id: childB, ingredient: 'ranch dressing', slot: 'main', day: 'tuesday' },
      ],
    });
  });

  it('dedupes the same flagged item appearing across multiple uncertain stages', async () => {
    const childA = '11111111-1111-4111-8111-111111111111';
    const stages = [
      {
        stage: 'guardrail_rejection',
        attempt: 1,
        verdict: 'uncertain',
        reason: 'compound_ingredient_unverified',
        flagged_items: [{ child_id: childA, ingredient: 'garam masala', slot: 'main', day: 'monday' }],
      },
      {
        stage: 'guardrail_rejection',
        attempt: 2,
        verdict: 'uncertain',
        reason: 'compound_ingredient_unverified',
        flagged_items: [{ child_id: childA, ingredient: 'garam masala', slot: 'main', day: 'monday' }],
      },
    ];
    const repo = {
      findHardFailAudit: vi.fn().mockResolvedValue({ failedAt: '2026-05-25T08:00:00Z', stages }),
    } as unknown as PlansRepository & { findHardFailAudit: ReturnType<typeof vi.fn> };
    const service = new PlansService({
      repository: repo,
      briefStateRepository: buildBriefStateRepo(),
      briefStateComposer: buildBriefStateComposer(),
      allergyGuardrail: buildGuardrail([{ verdict: 'cleared', conflicts: [] }]),
      auditService: buildAudit(),
      logger: buildLogger(),
      redis: buildRedis(),
      regenQueue: buildRegenQueue(),
    });

    const out = await service.getHardFailStatus(HOUSEHOLD_ID, '2026-05-04');

    expect(out?.flagged_items).toHaveLength(1);
    expect(out?.flagged_items[0]).toEqual({
      child_id: childA,
      ingredient: 'garam masala',
      slot: 'main',
      day: 'monday',
    });
  });

  it('returns flagged_items=[] when the only uncertain stage has an infrastructure reason (not compound_ingredient_unverified)', async () => {
    const stages = [
      {
        stage: 'guardrail_rejection',
        attempt: 1,
        verdict: 'uncertain',
        reason: 'no_rules_loaded',
      },
    ];
    const repo = {
      findHardFailAudit: vi.fn().mockResolvedValue({ failedAt: '2026-05-25T08:00:00Z', stages }),
    } as unknown as PlansRepository & { findHardFailAudit: ReturnType<typeof vi.fn> };
    const service = new PlansService({
      repository: repo,
      briefStateRepository: buildBriefStateRepo(),
      briefStateComposer: buildBriefStateComposer(),
      allergyGuardrail: buildGuardrail([{ verdict: 'cleared', conflicts: [] }]),
      auditService: buildAudit(),
      logger: buildLogger(),
      redis: buildRedis(),
      regenQueue: buildRegenQueue(),
    });

    const out = await service.getHardFailStatus(HOUSEHOLD_ID, '2026-05-04');

    expect(out?.flagged_items).toEqual([]);
  });

  it('skips malformed flagged_items entries (logs warning, does not throw)', async () => {
    const childA = '11111111-1111-4111-8111-111111111111';
    const stages = [
      {
        stage: 'guardrail_rejection',
        attempt: 1,
        verdict: 'uncertain',
        reason: 'compound_ingredient_unverified',
        flagged_items: [
          { child_id: childA, ingredient: 'garam masala', slot: 'main', day: 'monday' },
          { child_id: 'not-a-uuid', ingredient: 'ranch dressing', slot: 'main', day: 'tuesday' },
        ],
      },
    ];
    const repo = {
      findHardFailAudit: vi.fn().mockResolvedValue({ failedAt: '2026-05-25T08:00:00Z', stages }),
    } as unknown as PlansRepository & { findHardFailAudit: ReturnType<typeof vi.fn> };
    const logger = buildLogger();
    const service = new PlansService({
      repository: repo,
      briefStateRepository: buildBriefStateRepo(),
      briefStateComposer: buildBriefStateComposer(),
      allergyGuardrail: buildGuardrail([{ verdict: 'cleared', conflicts: [] }]),
      auditService: buildAudit(),
      logger,
      redis: buildRedis(),
      regenQueue: buildRegenQueue(),
    });

    const out = await service.getHardFailStatus(HOUSEHOLD_ID, '2026-05-04');

    expect(out?.flagged_items).toHaveLength(1);
    expect(out?.flagged_items[0].child_id).toBe(childA);
    expect(logger.warn).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Story 3-31 — PlansService.commit: resolveDiscoverCandidate (AC7)
// ---------------------------------------------------------------------------

const CANDIDATE_ID_AC7 = 'cc000000-cc00-4cc0-8cc0-cc0000000001';
const PLAN_BUILD_ID_AC7 = 'build-3-31-test-0001';
const RESOLVED_RECIPE_ID = 'ee000000-ee00-4ee0-8ee0-ee0000000001';

function buildMinimalExtraction(): RecipeAgentExtraction {
  return {
    name: 'Chicken Rice',
    source_url: 'https://www.allrecipes.com/recipe/1',
    source_site: 'allrecipes',
    cuisine_tags: [],
    cultural_tags: [],
    dietary_flags: [],
    allergen_flags: [],
    prep_time_minutes: 25,
    ingredients: [
      { key: 'chicken', modifier: null, display: '1 lb chicken', quantity: 1, unit: 'lb', optional: false, substitutes: [] },
    ],
    steps: [
      { mode: 'prep' as const, text: 'Cook the chicken.' },
      { mode: 'finish' as const, text: 'Add rice and water.' },
      { mode: 'finish' as const, text: 'Simmer 20 minutes.' },
    ],
    allergen_info_from_source: null,
  };
}

function buildRecipeServiceMock(opts: {
  candidateResult?: RecipeAgentExtraction | null;
  insertResult?: string;
} = {}): RecipeService {
  return {
    readCandidate: vi.fn().mockResolvedValue(opts.candidateResult !== undefined ? opts.candidateResult : null),
    insertFromDiscoverExtraction: vi.fn().mockResolvedValue(opts.insertResult ?? RESOLVED_RECIPE_ID),
    materializeFromPlanItem: vi.fn().mockResolvedValue({ recipeId: RESOLVED_RECIPE_ID, wasExisting: false }),
    recordUse: vi.fn().mockResolvedValue(undefined),
  } as unknown as RecipeService;
}

describe('PlansService.commit — discover candidate resolution (Story 3-31, AC7)', () => {
  it('AC7 happy path: resolves candidate from Redis, inserts recipe row, stamps recipe_id on the item', async () => {
    const repo = buildRepo();
    const guardrail = buildGuardrail([{ verdict: 'cleared', conflicts: [] }]);
    const audit = buildAudit();
    const recipeService = buildRecipeServiceMock({ candidateResult: buildMinimalExtraction() });

    const service = new PlansService({
      repository: repo,
      briefStateRepository: buildBriefStateRepo(),
      briefStateComposer: buildBriefStateComposer(),
      allergyGuardrail: guardrail,
      auditService: audit,
      logger: buildLogger(),
      redis: buildRedis(),
      regenQueue: buildRegenQueue(),
      recipeService,
    });

    const input = makeInput({
      plan_build_id: PLAN_BUILD_ID_AC7,
      items: [
        {
          child_id: CHILD_ID,
          day: 'monday',
          slot: 'main',
          recipe_candidate_id: CANDIDATE_ID_AC7,
          ingredients: ['chicken', 'rice'],
        },
      ],
    });
    await service.commit(input, REQUEST_ID, vi.fn());

    // readCandidate called with the correct plan_build_id + candidate_id
    expect((recipeService.readCandidate as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      PLAN_BUILD_ID_AC7,
      CANDIDATE_ID_AC7,
      expect.anything(),
    );
    // insertFromDiscoverExtraction called with the extraction
    expect((recipeService.insertFromDiscoverExtraction as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
    // materializeFromPlanItem NOT called — the candidate path handled it
    expect((recipeService.materializeFromPlanItem as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    // The item committed to the repo has recipe_id set to the resolved value
    const committedItems: CommitPlanInput['items'] = repo.commit.mock.calls[0]?.[0]?.items ?? [];
    expect(committedItems).toHaveLength(1);
    expect(committedItems[0]).toMatchObject({ recipe_id: RESOLVED_RECIPE_ID, slot: 'main' });
    expect(committedItems[0]).not.toHaveProperty('recipe_candidate_id');
  });

  it('AC7 cache miss: falls back to materializeFromPlanItem and emits recipe.candidate.cache_miss audit event', async () => {
    const repo = buildRepo();
    const guardrail = buildGuardrail([{ verdict: 'cleared', conflicts: [] }]);
    const audit = buildAudit();
    // readCandidate returns null → cache miss
    const recipeService = buildRecipeServiceMock({ candidateResult: null });

    const service = new PlansService({
      repository: repo,
      briefStateRepository: buildBriefStateRepo(),
      briefStateComposer: buildBriefStateComposer(),
      allergyGuardrail: guardrail,
      auditService: audit,
      logger: buildLogger(),
      redis: buildRedis(),
      regenQueue: buildRegenQueue(),
      recipeService,
    });

    const input = makeInput({
      plan_build_id: PLAN_BUILD_ID_AC7,
      items: [
        {
          child_id: CHILD_ID,
          day: 'monday',
          slot: 'main',
          recipe_candidate_id: CANDIDATE_ID_AC7,
          ingredients: ['chicken', 'rice'],
        },
      ],
    });
    await service.commit(input, REQUEST_ID, vi.fn());

    // Falls back to ingredient-based materialization
    expect((recipeService.materializeFromPlanItem as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
    // insertFromDiscoverExtraction NOT called — candidate was not in Redis
    expect((recipeService.insertFromDiscoverExtraction as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();

    // recipe.candidate.cache_miss audit event emitted (F-P9)
    const cacheMissEvent = (audit.write as ReturnType<typeof vi.fn>).mock.calls.find(
      ([e]: [{ event_type: string }]) => e.event_type === 'recipe.candidate.cache_miss',
    );
    expect(cacheMissEvent).toBeDefined();
    const [event] = cacheMissEvent!;
    expect(event).toMatchObject({
      event_type: 'recipe.candidate.cache_miss',
      household_id: HOUSEHOLD_ID,
      metadata: expect.objectContaining({
        candidate_id: CANDIDATE_ID_AC7,
        plan_build_id: PLAN_BUILD_ID_AC7,
        slot: 'main',
      }),
    });
  });

  it('F-P4: logs candidate.plan_build_id_missing warning and falls back when plan_build_id is absent', async () => {
    const repo = buildRepo();
    const guardrail = buildGuardrail([{ verdict: 'cleared', conflicts: [] }]);
    const audit = buildAudit();
    const recipeService = buildRecipeServiceMock();
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
      recipeService,
    });

    // No plan_build_id in this input
    const input = makeInput({
      items: [
        {
          child_id: CHILD_ID,
          day: 'monday',
          slot: 'main',
          recipe_candidate_id: CANDIDATE_ID_AC7,
          ingredients: ['chicken', 'rice'],
        },
      ],
    });
    await service.commit(input, REQUEST_ID, vi.fn());

    // readCandidate never called — plan_build_id was missing
    expect((recipeService.readCandidate as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    // Falls back to ingredient-based materialization
    expect((recipeService.materializeFromPlanItem as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
    // Warning logged with the correct action
    expect((logger.warn as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'candidate.plan_build_id_missing', candidate_id: CANDIDATE_ID_AC7 }),
      expect.any(String),
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
    const queue = buildRegenQueue();
    const service = buildService({
      repo: buildRegenRepo({ plan: makePlanRow() }),
      redis,
      queue,
    });

    const res = await service.requestRegeneration({
      planId: PLAN_ID,
      householdId: HOUSEHOLD_ID,
      query: { scope: 'week' },
      requestId: REQUEST_ID,
    });

    expect(res.rateLimitRemaining).toBe(0);
    expect(redis.expire).not.toHaveBeenCalled();
    // Guard against a regression that accidentally throws on count===REGEN_RATE_LIMIT
    // (the exact boundary — the 5th call must still enqueue a job).
    expect(queue.add).toHaveBeenCalledTimes(1);
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

describe('PlansService.getPlanForWeek (Story 3.14)', () => {
  function buildWeekRepo(opts: {
    plan?: PlanRow | null;
    items?: PlanItemRow[];
  } = {}): PlansRepository & {
    findByHouseholdAndWeek: ReturnType<typeof vi.fn>;
    findItemsByPlanId: ReturnType<typeof vi.fn>;
  } {
    return {
      findByHouseholdAndWeek: vi.fn().mockResolvedValue(opts.plan ?? null),
      findItemsByPlanId: vi.fn().mockResolvedValue(opts.items ?? []),
    } as unknown as PlansRepository & {
      findByHouseholdAndWeek: ReturnType<typeof vi.fn>;
      findItemsByPlanId: ReturnType<typeof vi.fn>;
    };
  }

  function makePlanRow(overrides: Partial<PlanRow> = {}): PlanRow {
    return {
      id: PLAN_ID,
      household_id: HOUSEHOLD_ID,
      week_id: WEEK_ID,
      week_of: '2026-05-04',
      revision: 1,
      generated_at: '2026-05-02T11:00:00.000Z',
      guardrail_cleared_at: '2026-05-02T11:00:01.000Z',
      guardrail_version: 'v1.0.0',
      prompt_version: 'v1.0.0',
      created_at: '2026-05-02T11:00:00.000Z',
      updated_at: '2026-05-02T11:00:01.000Z',
      ...overrides,
    };
  }

  function makeItem(day: PlanItemRow['day']): PlanItemRow {
    return {
      id: '00000000-0000-4000-8000-000000000010',
      plan_id: PLAN_ID,
      child_id: CHILD_ID,
      day,
      slot: 'main',
      recipe_id: null,
      item_id: null,
        ingredients: ['rice'],
      paused_at: null,
      replaced_by_plan_id: null,
      created_at: '2026-05-02T11:00:00.000Z',
      updated_at: '2026-05-02T11:00:00.000Z',
    };
  }

  function buildService(
    repo: PlansRepository,
  ): PlansService {
    return new PlansService({
      repository: repo,
      briefStateRepository: buildBriefStateRepo(),
      briefStateComposer: buildBriefStateComposer(),
      allergyGuardrail: buildGuardrail([{ verdict: 'cleared', conflicts: [] }]),
      auditService: buildAudit(),
      logger: buildLogger(),
      redis: buildRedis(),
      regenQueue: buildRegenQueue(),
    });
  }

  it('returns null plan + empty items when the repository has no row for the week', async () => {
    const repo = buildWeekRepo({ plan: null });
    const service = buildService(repo);

    const result = await service.getPlanForWeek({
      householdId: HOUSEHOLD_ID,
      week: 'current',
    });

    expect(result.plan).toBeNull();
    expect(result.planItems).toEqual([]);
    expect(result.isDraft).toBe(false);
    expect(result.weekOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(repo.findByHouseholdAndWeek).toHaveBeenCalledTimes(1);
  });

  it('week=next sets isDraft true regardless of plan presence', async () => {
    const repoNoPlan = buildWeekRepo({ plan: null });
    const r1 = await buildService(repoNoPlan).getPlanForWeek({
      householdId: HOUSEHOLD_ID,
      week: 'next',
    });
    expect(r1.isDraft).toBe(true);
    expect(r1.plan).toBeNull();

    const planRow = makePlanRow();
    const repoWithPlan = buildWeekRepo({ plan: planRow, items: [makeItem('monday')] });
    const r2 = await buildService(repoWithPlan).getPlanForWeek({
      householdId: HOUSEHOLD_ID,
      week: 'next',
    });
    expect(r2.isDraft).toBe(true);
    expect(r2.plan).not.toBeNull();
  });

  it('week=current sets isDraft false when a plan exists', async () => {
    const planRow = makePlanRow();
    const repo = buildWeekRepo({
      plan: planRow,
      items: [makeItem('monday'), makeItem('tuesday')],
    });
    const service = buildService(repo);

    const result = await service.getPlanForWeek({
      householdId: HOUSEHOLD_ID,
      week: 'current',
    });

    expect(result.plan).toEqual(planRow);
    expect(result.planItems).toHaveLength(2);
    expect(result.isDraft).toBe(false);
    expect(repo.findItemsByPlanId).toHaveBeenCalledWith(PLAN_ID);
  });

  it('passes a deterministic week_id derived from the resolved Monday to the repository', async () => {
    const repo = buildWeekRepo({ plan: null });
    const service = buildService(repo);

    await service.getPlanForWeek({ householdId: HOUSEHOLD_ID, week: 'next' });

    const expectedWeekId = deriveWeekId(getNextWeekMonday());
    const findCall = (repo.findByHouseholdAndWeek as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      householdId: string;
      weekId: string;
    };
    expect(findCall.weekId).toBe(expectedWeekId);
    expect(findCall.householdId).toBe(HOUSEHOLD_ID);
  });
});

describe('week-monday helpers (Story 3.14)', () => {
  it('getCurrentWeekMonday on a Wednesday returns the Monday two days back', () => {
    // 2026-05-06 is a Wednesday (UTC).
    const wed = new Date('2026-05-06T12:00:00Z');
    expect(getCurrentWeekMonday(wed)).toBe('2026-05-04');
  });

  it('getCurrentWeekMonday on a Monday returns the same day', () => {
    // 2026-05-04 is a Monday (UTC).
    const mon = new Date('2026-05-04T03:00:00Z');
    expect(getCurrentWeekMonday(mon)).toBe('2026-05-04');
  });

  it('getCurrentWeekMonday on a Sunday returns the prior Monday', () => {
    // 2026-05-03 is a Sunday (UTC).
    const sun = new Date('2026-05-03T20:00:00Z');
    expect(getCurrentWeekMonday(sun)).toBe('2026-04-27');
  });

  it('getNextWeekMonday on a Friday returns Monday three days later', () => {
    // 2026-05-01 is a Friday (UTC).
    const fri = new Date('2026-05-01T20:00:00Z');
    expect(getNextWeekMonday(fri)).toBe('2026-05-04');
  });

  it('getNextWeekMonday on a Monday returns the following Monday', () => {
    const mon = new Date('2026-05-04T08:00:00Z');
    expect(getNextWeekMonday(mon)).toBe('2026-05-11');
  });

  it('getNextWeekMonday on a Sunday returns the next day (Monday)', () => {
    const sun = new Date('2026-05-03T20:00:00Z');
    expect(getNextWeekMonday(sun)).toBe('2026-05-04');
  });

  it('deriveWeekId is stable for the same Monday', () => {
    const id1 = deriveWeekId(getNextWeekMonday(new Date('2026-05-01T20:00:00Z')));
    const id2 = deriveWeekId(getNextWeekMonday(new Date('2026-05-02T20:00:00Z')));
    // Same target Monday (2026-05-04) → same UUID.
    expect(id1).toBe(id2);
    expect(id1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('PlansService.getPlanHistory (Story 3.15)', () => {
  function makePlanRow(overrides: Partial<PlanRow> = {}): PlanRow {
    return {
      id: PLAN_ID,
      household_id: HOUSEHOLD_ID,
      week_id: WEEK_ID,
      week_of: '2026-04-21',
      revision: 1,
      generated_at: '2026-04-19T11:00:00.000Z',
      guardrail_cleared_at: '2026-04-19T11:00:01.000Z',
      guardrail_version: 'v1.0.0',
      prompt_version: 'v1.0.0',
      created_at: '2026-04-19T11:00:00.000Z',
      updated_at: '2026-04-19T11:00:01.000Z',
      ...overrides,
    };
  }

  function makeItem(overrides: Partial<PlanItemRow> = {}): PlanItemRow {
    return {
      id: '00000000-0000-4000-8000-000000000010',
      plan_id: PLAN_ID,
      child_id: CHILD_ID,
      day: 'monday',
      slot: 'main',
      recipe_id: null,
      item_id: null,
        ingredients: ['rice'],
      paused_at: null,
      replaced_by_plan_id: null,
      created_at: '2026-04-19T11:00:00.000Z',
      updated_at: '2026-04-19T11:00:00.000Z',
      ...overrides,
    };
  }

  function buildHistoryRepo(opts: {
    plan?: PlanRow | null;
    items?: PlanItemRow[];
    swapHistory?: Array<{
      child_id: string;
      day: PlanItemRow['day'];
      slot: string;
      previous_ingredients: string[];
      replaced_at: string;
    }>;
    findItemsBlocker?: { resolve: () => void; promise: Promise<void> };
    findSwapHistoryBlocker?: { resolve: () => void; promise: Promise<void> };
  } = {}): PlansRepository & {
    findByHouseholdAndWeek: ReturnType<typeof vi.fn>;
    findItemsByPlanId: ReturnType<typeof vi.fn>;
    findSwapHistory: ReturnType<typeof vi.fn>;
  } {
    const findByHouseholdAndWeek = vi.fn().mockResolvedValue(opts.plan ?? null);
    const findItemsByPlanId = vi.fn(async () => {
      if (opts.findItemsBlocker !== undefined) {
        await opts.findItemsBlocker.promise;
      }
      return opts.items ?? [];
    });
    const findSwapHistory = vi.fn(async () => {
      if (opts.findSwapHistoryBlocker !== undefined) {
        await opts.findSwapHistoryBlocker.promise;
      }
      return opts.swapHistory ?? [];
    });
    return {
      findByHouseholdAndWeek,
      findItemsByPlanId,
      findSwapHistory,
    } as unknown as PlansRepository & {
      findByHouseholdAndWeek: ReturnType<typeof vi.fn>;
      findItemsByPlanId: ReturnType<typeof vi.fn>;
      findSwapHistory: ReturnType<typeof vi.fn>;
    };
  }

  function makeBlocker(): { resolve: () => void; promise: Promise<void> } {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => {
      resolve = r;
    });
    return { resolve, promise };
  }

  function buildService(repo: PlansRepository): PlansService {
    return new PlansService({
      repository: repo,
      briefStateRepository: buildBriefStateRepo(),
      briefStateComposer: buildBriefStateComposer(),
      allergyGuardrail: buildGuardrail([{ verdict: 'cleared', conflicts: [] }]),
      auditService: buildAudit(),
      logger: buildLogger(),
      redis: buildRedis(),
      regenQueue: buildRegenQueue(),
    });
  }

  it('throws NotFoundError and skips item/history reads when no plan exists for the week', async () => {
    const repo = buildHistoryRepo({ plan: null });
    const service = buildService(repo);

    await expect(
      service.getPlanHistory({ householdId: HOUSEHOLD_ID, weekId: WEEK_ID }),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(repo.findByHouseholdAndWeek).toHaveBeenCalledWith({
      householdId: HOUSEHOLD_ID,
      weekId: WEEK_ID,
    });
    expect(repo.findItemsByPlanId).not.toHaveBeenCalled();
    expect(repo.findSwapHistory).not.toHaveBeenCalled();
  });

  it('returns final items + swap history + weekOf for an existing past plan', async () => {
    const plan = makePlanRow();
    const items = [makeItem({ day: 'monday' }), makeItem({ day: 'tuesday' })];
    const swap = {
      child_id: '00000000-0000-4000-8000-000000000020',
      day: 'monday' as const,
      slot: 'main',
      previous_ingredients: ['hummus'],
      replaced_at: '2026-04-22T10:00:00.000Z',
    };
    const repo = buildHistoryRepo({
      plan,
      items,
      swapHistory: [swap],
    });
    const service = buildService(repo);

    const result = await service.getPlanHistory({
      householdId: HOUSEHOLD_ID,
      weekId: WEEK_ID,
    });

    expect(result.plan).toEqual(plan);
    expect(result.planItems).toEqual(items);
    expect(result.swapHistory).toEqual([swap]);
    expect(result.weekOf).toBe('2026-04-21');
    expect(repo.findItemsByPlanId).toHaveBeenCalledWith(PLAN_ID);
    expect(repo.findSwapHistory).toHaveBeenCalledWith(PLAN_ID);
  });

  it('runs findItemsByPlanId and findSwapHistory in parallel via Promise.all', async () => {
    // Deterministic parallelism check: hold both repo calls behind blockers.
    // If the service serializes them, only the first call would be invoked
    // before the test resolves either blocker.
    const plan = makePlanRow();
    const itemsBlocker = makeBlocker();
    const swapBlocker = makeBlocker();
    const repo = buildHistoryRepo({
      plan,
      items: [],
      swapHistory: [],
      findItemsBlocker: itemsBlocker,
      findSwapHistoryBlocker: swapBlocker,
    });
    const service = buildService(repo);

    const promise = service.getPlanHistory({
      householdId: HOUSEHOLD_ID,
      weekId: WEEK_ID,
    });

    // Yield once so both fn bodies can begin (Promise.all dispatches eagerly).
    await Promise.resolve();
    await Promise.resolve();

    expect(repo.findItemsByPlanId).toHaveBeenCalledTimes(1);
    expect(repo.findSwapHistory).toHaveBeenCalledTimes(1);

    itemsBlocker.resolve();
    swapBlocker.resolve();
    await promise;
  });

  it('passes weekId through to findByHouseholdAndWeek verbatim', async () => {
    const otherWeekId = '99999999-9999-4999-8999-999999999999';
    const repo = buildHistoryRepo({ plan: null });
    const service = buildService(repo);

    await expect(
      service.getPlanHistory({ householdId: HOUSEHOLD_ID, weekId: otherWeekId }),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(repo.findByHouseholdAndWeek).toHaveBeenCalledWith({
      householdId: HOUSEHOLD_ID,
      weekId: otherWeekId,
    });
  });
});

// ===========================================================================
// Slice D — recipe materialization at plan commit
// ===========================================================================
// At commit time, every main-slot item must be associated with a recipes row
// (created or reused-by-canonical-name) and household_recipe_usage must be
// bumped. Snack + extra slot items pass through untouched.

import type { RecipeService } from '../recipe/recipe.service.js';

const SLICE_D_RECIPE_ID = '77777777-7777-4777-8777-777777777777';

type RecipeServiceMock = RecipeService & {
  materializeFromPlanItem: ReturnType<typeof vi.fn>;
  recordUse: ReturnType<typeof vi.fn>;
};

function buildRecipeService(
  opts: { recipeId?: string; wasExisting?: boolean } = {},
): RecipeServiceMock {
  return {
    materializeFromPlanItem: vi.fn().mockResolvedValue({
      recipeId: opts.recipeId ?? SLICE_D_RECIPE_ID,
      wasExisting: opts.wasExisting ?? false,
    }),
    recordUse: vi.fn().mockResolvedValue(undefined),
  } as unknown as RecipeServiceMock;
}

describe('PlansService.commit — Slice D recipe materialization', () => {
  it('attaches a materialized recipe_id to main-slot items before repo.commit', async () => {
    const repo = buildRepo();
    const recipeService = buildRecipeService();
    const service = new PlansService({
      repository: repo,
      briefStateRepository: buildBriefStateRepo(),
      briefStateComposer: buildBriefStateComposer(),
      allergyGuardrail: buildGuardrail([{ verdict: 'cleared', conflicts: [] }]),
      auditService: buildAudit(),
      logger: buildLogger(),
      redis: buildRedis(),
      regenQueue: buildRegenQueue(),
      recipeService,
    });

    await service.commit(makeInput(), REQUEST_ID, vi.fn());

    expect(recipeService.materializeFromPlanItem).toHaveBeenCalledWith({
      householdId: HOUSEHOLD_ID,
      ingredients: ['rice', 'lentils'],
      slot: 'main',
    });

    const committed = repo.commit.mock.calls[0]?.[0] as CommitPlanInput;
    expect(committed.items[0]?.recipe_id).toBe(SLICE_D_RECIPE_ID);
  });

  it('skips materialization for snack + extra slot items (they resolve via curated recipes catalog)', async () => {
    const repo = buildRepo();
    const recipeService = buildRecipeService();
    const service = new PlansService({
      repository: repo,
      briefStateRepository: buildBriefStateRepo(),
      briefStateComposer: buildBriefStateComposer(),
      allergyGuardrail: buildGuardrail([{ verdict: 'cleared', conflicts: [] }]),
      auditService: buildAudit(),
      logger: buildLogger(),
      redis: buildRedis(),
      regenQueue: buildRegenQueue(),
      recipeService,
    });

    const input = makeInput({
      items: [
        { child_id: CHILD_ID, day: 'monday', slot: 'snack', ingredients: ['granola'] },
        { child_id: CHILD_ID, day: 'monday', slot: 'extra', ingredients: ['fruit'] },
      ],
    });
    await service.commit(input, REQUEST_ID, vi.fn());

    expect(recipeService.materializeFromPlanItem).not.toHaveBeenCalled();
    const committed = repo.commit.mock.calls[0]?.[0] as CommitPlanInput;
    // snack + extra items pass through unchanged — no recipe_id stamped
    expect(committed.items[0]?.recipe_id).toBeUndefined();
    expect(committed.items[1]?.recipe_id).toBeUndefined();
  });

  it('respects a recipe_id supplied by the agent (does not re-materialize)', async () => {
    const repo = buildRepo();
    const recipeService = buildRecipeService();
    const agentSuppliedRecipeId = '66666666-6666-4666-8666-666666666666';
    const service = new PlansService({
      repository: repo,
      briefStateRepository: buildBriefStateRepo(),
      briefStateComposer: buildBriefStateComposer(),
      allergyGuardrail: buildGuardrail([{ verdict: 'cleared', conflicts: [] }]),
      auditService: buildAudit(),
      logger: buildLogger(),
      redis: buildRedis(),
      regenQueue: buildRegenQueue(),
      recipeService,
    });

    const input = makeInput({
      items: [
        {
          child_id: CHILD_ID,
          day: 'monday',
          slot: 'main',
          ingredients: ['rice'],
          recipe_id: agentSuppliedRecipeId,
        },
      ],
    });
    await service.commit(input, REQUEST_ID, vi.fn());

    expect(recipeService.materializeFromPlanItem).not.toHaveBeenCalled();
    const committed = repo.commit.mock.calls[0]?.[0] as CommitPlanInput;
    expect(committed.items[0]?.recipe_id).toBe(agentSuppliedRecipeId);
  });

  it('calls recordUse once per unique recipe_id after commit succeeds', async () => {
    const repo = buildRepo();
    const recipeService = buildRecipeService();
    const service = new PlansService({
      repository: repo,
      briefStateRepository: buildBriefStateRepo(),
      briefStateComposer: buildBriefStateComposer(),
      allergyGuardrail: buildGuardrail([{ verdict: 'cleared', conflicts: [] }]),
      auditService: buildAudit(),
      logger: buildLogger(),
      redis: buildRedis(),
      regenQueue: buildRegenQueue(),
      recipeService,
    });

    // Three main items → materializeFromPlanItem returns the same recipe_id
    // for each (same canonical name); recordUse must be called once.
    const input = makeInput({
      items: [
        { child_id: CHILD_ID, day: 'monday', slot: 'main', ingredients: ['rice'] },
        { child_id: CHILD_ID, day: 'tuesday', slot: 'main', ingredients: ['rice'] },
        { child_id: CHILD_ID, day: 'wednesday', slot: 'main', ingredients: ['rice'] },
      ],
    });
    await service.commit(input, REQUEST_ID, vi.fn());

    // Flush the fire-and-forget recordUse microtasks.
    await new Promise((r) => setImmediate(r));

    expect(recipeService.materializeFromPlanItem).toHaveBeenCalledTimes(3);
    expect(recipeService.recordUse).toHaveBeenCalledTimes(1);
    expect(recipeService.recordUse).toHaveBeenCalledWith({
      householdId: HOUSEHOLD_ID,
      recipeId: SLICE_D_RECIPE_ID,
    });
  });

  it('orders materialization before repo.commit (recipe_ids land in the committed payload)', async () => {
    const callOrder: string[] = [];
    const recipeService = {
      materializeFromPlanItem: vi.fn(async () => {
        callOrder.push('materialize');
        return { recipeId: SLICE_D_RECIPE_ID, wasExisting: false };
      }),
      recordUse: vi.fn(async () => {
        callOrder.push('recordUse');
      }),
    } as unknown as RecipeServiceMock;

    const repo = buildRepo({
      commitImpl: async (input) => {
        callOrder.push('commit');
        return input.plan_id;
      },
    });
    const service = new PlansService({
      repository: repo,
      briefStateRepository: buildBriefStateRepo(),
      briefStateComposer: buildBriefStateComposer(),
      allergyGuardrail: buildGuardrail([{ verdict: 'cleared', conflicts: [] }]),
      auditService: buildAudit(),
      logger: buildLogger(),
      redis: buildRedis(),
      regenQueue: buildRegenQueue(),
      recipeService,
    });

    await service.commit(makeInput(), REQUEST_ID, vi.fn());
    await new Promise((r) => setImmediate(r));

    // materialize → commit → recordUse (usage bump only after the row lands)
    expect(callOrder).toEqual(['materialize', 'commit', 'recordUse']);
  });

  it('commits without materialization when RecipeService is not wired (legacy path)', async () => {
    const repo = buildRepo();
    const service = new PlansService({
      repository: repo,
      briefStateRepository: buildBriefStateRepo(),
      briefStateComposer: buildBriefStateComposer(),
      allergyGuardrail: buildGuardrail([{ verdict: 'cleared', conflicts: [] }]),
      auditService: buildAudit(),
      logger: buildLogger(),
      redis: buildRedis(),
      regenQueue: buildRegenQueue(),
      // no recipeService — exercises the null-check pre-D path
    });

    await service.commit(makeInput(), REQUEST_ID, vi.fn());

    expect(repo.commit).toHaveBeenCalledTimes(1);
    const committed = repo.commit.mock.calls[0]?.[0] as CommitPlanInput;
    expect(committed.items[0]?.recipe_id).toBeUndefined();
  });

  it('does not materialize when the guardrail blocks the plan (rolled back retry)', async () => {
    const repo = buildRepo();
    const recipeService = buildRecipeService();
    const blocked: GuardrailResult = {
      verdict: 'blocked',
      conflicts: [
        { child_id: CHILD_ID, allergen: 'peanut', ingredient: 'peanut butter', day: 'monday', slot: 'main' },
      ],
    };
    const service = new PlansService({
      repository: repo,
      briefStateRepository: buildBriefStateRepo(),
      briefStateComposer: buildBriefStateComposer(),
      allergyGuardrail: buildGuardrail([blocked, blocked, blocked]),
      auditService: buildAudit(),
      logger: buildLogger(),
      redis: buildRedis(),
      regenQueue: buildRegenQueue(),
      recipeService,
    });

    await expect(
      service.commit(makeInput(), REQUEST_ID, vi.fn(async () => makeInput())),
    ).rejects.toBeInstanceOf(GuardrailRejectionError);

    // Guardrail never cleared → no materialization or usage bump
    expect(recipeService.materializeFromPlanItem).not.toHaveBeenCalled();
    expect(recipeService.recordUse).not.toHaveBeenCalled();
  });
});

// Story 3.29 — soft cultural-degradation signal. handleDegradedPlan is
// invoked from plan-generation.job after commit clears, so these tests
// exercise the method directly (not commit() — degraded_reason flows live
// in the BullMQ job).
describe('PlansService.handleDegradedPlan (Story 3.29)', () => {
  function buildBriefStateRepoWithPlanState(): BriefStateRepository & {
    setPlanState: ReturnType<typeof vi.fn>;
    clearDegradedPlanState: ReturnType<typeof vi.fn>;
  } {
    return {
      findByHousehold: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue(undefined),
      setPlanState: vi.fn().mockResolvedValue(undefined),
      clearDegradedPlanState: vi.fn().mockResolvedValue(undefined),
    } as unknown as BriefStateRepository & {
      setPlanState: ReturnType<typeof vi.fn>;
      clearDegradedPlanState: ReturnType<typeof vi.fn>;
    };
  }

  it('writes plan_state=degraded + the canonical message to brief_state and emits plan.cultural_degraded audit', async () => {
    const briefStateRepo = buildBriefStateRepoWithPlanState();
    const audit = buildAudit();
    const service = new PlansService({
      repository: buildRepo(),
      briefStateRepository: briefStateRepo,
      briefStateComposer: buildBriefStateComposer(),
      allergyGuardrail: buildGuardrail([{ verdict: 'cleared', conflicts: [] }]),
      auditService: audit,
      logger: buildLogger(),
      redis: buildRedis(),
      regenQueue: buildRegenQueue(),
    });

    await service.handleDegradedPlan({
      householdId: HOUSEHOLD_ID,
      requestId: REQUEST_ID,
    });

    expect(briefStateRepo.setPlanState).toHaveBeenCalledTimes(1);
    const setArgs = briefStateRepo.setPlanState.mock.calls[0]![0];
    expect(setArgs.householdId).toBe(HOUSEHOLD_ID);
    expect(setArgs.planState).toBe('degraded');
    expect(setArgs.message).toBe(
      "This week's plan couldn't honor every rule strictly. Try alternating whose rules lead each day?",
    );
    expect(typeof setArgs.setAt).toBe('string');

    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'plan.cultural_degraded',
        household_id: HOUSEHOLD_ID,
        request_id: REQUEST_ID,
        metadata: { reason: 'CULTURAL_INTERSECTION_EMPTY' },
      }),
    );
  });

  it('still resolves when the audit write fails (best-effort)', async () => {
    const briefStateRepo = buildBriefStateRepoWithPlanState();
    const audit = buildAudit();
    audit.write.mockRejectedValueOnce(new Error('audit down'));
    const service = new PlansService({
      repository: buildRepo(),
      briefStateRepository: briefStateRepo,
      briefStateComposer: buildBriefStateComposer(),
      allergyGuardrail: buildGuardrail([{ verdict: 'cleared', conflicts: [] }]),
      auditService: audit,
      logger: buildLogger(),
      redis: buildRedis(),
      regenQueue: buildRegenQueue(),
    });

    await expect(
      service.handleDegradedPlan({ householdId: HOUSEHOLD_ID, requestId: REQUEST_ID }),
    ).resolves.toBeUndefined();
    expect(briefStateRepo.setPlanState).toHaveBeenCalledTimes(1);
  });

  it('clearDegradedPlanState delegates to the brief_state repository', async () => {
    const briefStateRepo = buildBriefStateRepoWithPlanState();
    const service = new PlansService({
      repository: buildRepo(),
      briefStateRepository: briefStateRepo,
      briefStateComposer: buildBriefStateComposer(),
      allergyGuardrail: buildGuardrail([{ verdict: 'cleared', conflicts: [] }]),
      auditService: buildAudit(),
      logger: buildLogger(),
      redis: buildRedis(),
      regenQueue: buildRegenQueue(),
    });

    await service.clearDegradedPlanState(HOUSEHOLD_ID);

    expect(briefStateRepo.clearDegradedPlanState).toHaveBeenCalledWith(HOUSEHOLD_ID);
  });
});
