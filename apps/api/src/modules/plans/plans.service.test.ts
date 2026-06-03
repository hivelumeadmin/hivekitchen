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
import type {
  CommitPlanTreeInput,
  GuardrailResult,
} from '@hivekitchen/types';
import {
  GuardrailRejectionError,
  NotFoundError,
  SwapGuardrailBlockedError,
  TooManyRequestsError,
  ValidationError,
} from '../../common/errors.js';
import { GUARDRAIL_VERSION } from '../allergy-guardrail/allergy-rules.engine.js';
import type { PlanRow } from '@hivekitchen/types';
import { buildPlan } from '../../../test/factories/index.js';

const PLAN_ID = '11111111-1111-4111-8111-111111111111';
const HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';
const WEEK_ID = '33333333-3333-4333-8333-333333333333';
const CHILD_ID = '44444444-4444-4444-8444-444444444444';
const REQUEST_ID = '55555555-5555-4555-8555-555555555555';
const RECIPE_M1 = '66666666-6666-4666-8666-666666666666';

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

function makeInput(overrides: Partial<CommitPlanTreeInput> = {}): CommitPlanTreeInput {
  return {
    plan_id: PLAN_ID,
    household_id: HOUSEHOLD_ID,
    week_of: '2026-05-04',
    revision: 1,
    generated_at: '2026-05-02T11:00:00.000Z',
    prompt_version: 'v2.0.0',
    main_assignments: [{ sequence: 1, recipe_id: RECIPE_M1 }],
    days: [
      {
        day: 'monday',
        slots: [
          {
            slot_kind: 'main',
            main_assignment_sequence: 1,
            variations: [{ child_id: CHILD_ID }],
          },
        ],
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
  commitImpl?: (input: CommitPlanTreeInput, clearedAt: string, version: string) => Promise<string>;
  existingPlanId?: string | null;
} = {}): PlansRepository & {
  commitTree: ReturnType<typeof vi.fn>;
  findActiveByHouseholdAndWeek: ReturnType<typeof vi.fn>;
  setPlanState: ReturnType<typeof vi.fn>;
  clearDegradedPlanState: ReturnType<typeof vi.fn>;
} {
  const commitTree = vi.fn(async (input: CommitPlanTreeInput, clearedAt: string, version: string) => {
    if (opts.commitImpl) return opts.commitImpl(input, clearedAt, version);
    return input.plan_id;
  });
  const existingRow =
    opts.existingPlanId != null
      ? { id: opts.existingPlanId, household_id: HOUSEHOLD_ID, week_id: WEEK_ID }
      : null;
  const findActiveByHouseholdAndWeek = vi.fn().mockResolvedValue(existingRow);
  // Story 3-DM-D1 — plan_state write path moved from BriefStateRepository to
  // PlansRepository.
  const setPlanState = vi.fn().mockResolvedValue(undefined);
  const clearDegradedPlanState = vi.fn().mockResolvedValue(undefined);
  return {
    commitTree,
    findActiveByHouseholdAndWeek,
    setPlanState,
    clearDegradedPlanState,
  } as unknown as PlansRepository & {
    commitTree: ReturnType<typeof vi.fn>;
    findActiveByHouseholdAndWeek: ReturnType<typeof vi.fn>;
    setPlanState: ReturnType<typeof vi.fn>;
    clearDegradedPlanState: ReturnType<typeof vi.fn>;
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
  refreshTree: ReturnType<typeof vi.fn>;
} {
  return {
    refreshTree: vi.fn().mockResolvedValue(undefined),
  } as unknown as BriefStateComposer & { refreshTree: ReturnType<typeof vi.fn> };
}

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
    expect(repo.commitTree).toHaveBeenCalledTimes(1);
    expect(repo.commitTree.mock.calls[0][2]).toBe(GUARDRAIL_VERSION);
    expect(regenerate).not.toHaveBeenCalled();

    const auditCall = audit.write.mock.calls[0]?.[0];
    expect(auditCall).toMatchObject({
      event_type: 'plan.generated',
      household_id: HOUSEHOLD_ID,
      request_id: REQUEST_ID,
      metadata: expect.objectContaining({ plan_id: PLAN_ID, revision: 1, prompt_version: 'v2.0.0' }),
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
    expect(repo.commitTree).not.toHaveBeenCalled();
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
    expect(repo.commitTree).toHaveBeenCalledTimes(1);

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

  it('walks the tree and emits one (child, day, slot, ingredients) guardrail item per variation', async () => {
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
      days: [
        {
          day: 'monday',
          slots: [
            {
              slot_kind: 'main',
              main_assignment_sequence: 1,
              variations: [{ child_id: CHILD_ID, add_ons: ['rice'] }],
            },
          ],
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

    const clearedAt = repo.commitTree.mock.calls[0][1];
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
    expect(repo.commitTree.mock.calls[0][0].plan_id).toBe(EXISTING_PLAN_ID);
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
    expect(repo.commitTree).not.toHaveBeenCalled();
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
      days: [
        {
          day: 'monday',
          slots: [
            {
              slot_kind: 'main',
              main_assignment_sequence: 1,
              variations: [{ child_id: CHILD_ID, add_ons: ['rice', 'broccoli'] }],
            },
          ],
        },
      ],
    });
    const regenerate = vi.fn().mockResolvedValue(cleanInput);
    const result = await service.commit(makeInput(), REQUEST_ID, regenerate);

    expect(result).toBe(PLAN_ID);
    expect(regenerate).toHaveBeenCalledTimes(1);
    expect(repo.commitTree).toHaveBeenCalledTimes(1);
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
    expect(repo.commitTree).not.toHaveBeenCalled();
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
    expect(repo.commitTree).not.toHaveBeenCalled();
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
    expect(repo.commitTree).toHaveBeenCalledTimes(1);
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


// --- Story 3.12 — swapItem + pauseDay ---

const ITEM_ID = '00000000-0000-4000-8000-000000000010';

// Story 3-DM-A3: thin wrappers around the shared factories so this file's
// PLAN_ID / HOUSEHOLD_ID / CHILD_ID constants + 3.12-era dates stay pinned at
// the wrapper, while the row SHAPE (subject to Phase C1's tree-shape cutover)
// lives once in apps/api/test/factories.
function makePlanRow(overrides: Partial<PlanRow> = {}): PlanRow {
  return buildPlan({
    id: PLAN_ID,
    household_id: HOUSEHOLD_ID,
    guardrail_version: '1.1.0',
    ...overrides,
  });
}

// Story 3-DM-C1 Phase 9b part 4 step 5 — the flat makeItemRow / buildSwapRepo
// helpers retired with the deleted swapItem + pauseDay describe blocks.

function buildEvalGuardrail(verdict: GuardrailResult): AllergyGuardrailService & {
  evaluate: ReturnType<typeof vi.fn>;
} {
  return {
    evaluate: vi.fn().mockResolvedValue(verdict),
  } as unknown as AllergyGuardrailService & {
    evaluate: ReturnType<typeof vi.fn>;
  };
}


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

  // Story 3-DM-C1 Phase 9b part 4 step 5 — the "plan.week_of is null"
  // pre-3.13 ValidationError test retired with the canonical PlanRow's
  // non-nullable week_of column.
  it.skip('throws ValidationError when plan.week_of is null (pre-3.13 row)', async () => {
    const service = buildService({
      repo: buildRegenRepo({ plan: makePlanRow() }),
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
    // Story 3-DM-C1 step 5 — rate-limit key derives weekId from plan.week_of
    // since the canonical PlanRow no longer carries week_id.
    const expectedWeekId = deriveWeekId(makePlanRow().week_of);
    expect(redis.incr).toHaveBeenCalledWith(`regen-limit:${HOUSEHOLD_ID}:${expectedWeekId}`);
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
describe('PlansService.handleDegradedPlan (Story 3.29 / 3-DM-D1)', () => {
  it('writes plan_state=degraded + the canonical message via PlansRepository and emits plan.cultural_degraded audit', async () => {
    const repo = buildRepo();
    const audit = buildAudit();
    const service = new PlansService({
      repository: repo,
      briefStateRepository: buildBriefStateRepo(),
      briefStateComposer: buildBriefStateComposer(),
      allergyGuardrail: buildGuardrail([{ verdict: 'cleared', conflicts: [] }]),
      auditService: audit,
      logger: buildLogger(),
      redis: buildRedis(),
      regenQueue: buildRegenQueue(),
    });

    await service.handleDegradedPlan({
      householdId: HOUSEHOLD_ID,
      planId: PLAN_ID,
      requestId: REQUEST_ID,
    });

    expect(repo.setPlanState).toHaveBeenCalledTimes(1);
    const setArgs = repo.setPlanState.mock.calls[0]![0];
    expect(setArgs.planId).toBe(PLAN_ID);
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
    const repo = buildRepo();
    const audit = buildAudit();
    audit.write.mockRejectedValueOnce(new Error('audit down'));
    const service = new PlansService({
      repository: repo,
      briefStateRepository: buildBriefStateRepo(),
      briefStateComposer: buildBriefStateComposer(),
      allergyGuardrail: buildGuardrail([{ verdict: 'cleared', conflicts: [] }]),
      auditService: audit,
      logger: buildLogger(),
      redis: buildRedis(),
      regenQueue: buildRegenQueue(),
    });

    await expect(
      service.handleDegradedPlan({ householdId: HOUSEHOLD_ID, planId: PLAN_ID, requestId: REQUEST_ID }),
    ).resolves.toBeUndefined();
    expect(repo.setPlanState).toHaveBeenCalledTimes(1);
  });

  it('clearDegradedPlanState delegates to the plans repository', async () => {
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
    });

    await service.clearDegradedPlanState(HOUSEHOLD_ID);

    expect(repo.clearDegradedPlanState).toHaveBeenCalledWith(HOUSEHOLD_ID);
  });
});
