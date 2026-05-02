import { describe, it, expect, vi } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import { PlansService } from './plans.service.js';
import type { PlansRepository } from './plans.repository.js';
import type { AllergyGuardrailService } from '../allergy-guardrail/allergy-guardrail.service.js';
import type { AuditService } from '../../audit/audit.service.js';
import type { CommitPlanInput, GuardrailResult } from '@hivekitchen/types';
import { GuardrailRejectionError, NotImplementedError } from '../../common/errors.js';
import { GUARDRAIL_VERSION } from '../allergy-guardrail/allergy-rules.engine.js';

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

describe('PlansService.compose', () => {
  it('throws NotImplementedError until Story 3.7 wires real composer', async () => {
    const service = new PlansService({
      repository: buildRepo(),
      allergyGuardrail: buildGuardrail([{ verdict: 'cleared', conflicts: [] }]),
      auditService: buildAudit(),
      logger: buildLogger(),
    });
    await expect(
      service.compose({
        household_id: HOUSEHOLD_ID,
        week_of: '2026-05-04',
        days: [],
        prompt_version: 'v1.0.0',
      }),
    ).rejects.toBeInstanceOf(NotImplementedError);
  });
});

describe('PlansService.commit', () => {
  it('clears, commits, and writes plan.generated audit on first-attempt success', async () => {
    const repo = buildRepo();
    const guardrail = buildGuardrail([{ verdict: 'cleared', conflicts: [] }]);
    const audit = buildAudit();
    const service = new PlansService({
      repository: repo,
      allergyGuardrail: guardrail,
      auditService: audit,
      logger: buildLogger(),
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
      allergyGuardrail: guardrail,
      auditService: audit,
      logger: buildLogger(),
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
      allergyGuardrail: guardrail,
      auditService: audit,
      logger: buildLogger(),
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
      allergyGuardrail: guardrail,
      auditService: audit,
      logger: buildLogger(),
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
      allergyGuardrail: guardrail,
      auditService: audit,
      logger: buildLogger(),
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
      allergyGuardrail: guardrail,
      auditService: audit,
      logger: buildLogger(),
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
      allergyGuardrail: guardrail,
      auditService: audit,
      logger: buildLogger(),
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
      allergyGuardrail: guardrail,
      auditService: audit,
      logger: buildLogger(),
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
      allergyGuardrail: guardrail,
      auditService: audit,
      logger: buildLogger(),
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
      allergyGuardrail: guardrail,
      auditService: audit,
      logger,
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
