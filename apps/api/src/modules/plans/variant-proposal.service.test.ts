import { describe, it, expect, vi } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import type { AuditService } from '../../audit/audit.service.js';
import type { PlanComposeOutput, PlanItemRow, VariantProposal } from '@hivekitchen/types';
import type { PlansRepository } from './plans.repository.js';
import type { VariantProposalRepository } from './variant-proposal.repository.js';
import { VariantProposalService } from './variant-proposal.service.js';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const PLAN_ID = '22222222-2222-4222-8222-222222222222';
const PLAN_ITEM_ID = '33333333-3333-4333-8333-333333333333';
const CHILD_ID = '44444444-4444-4444-8444-444444444444';
const PROPOSAL_ID = '55555555-5555-4555-8555-555555555555';
const REQUEST_ID = '66666666-6666-4666-8666-666666666666';

function buildLogger(): FastifyBaseLogger {
  const noop = vi.fn();
  return {
    info: noop, warn: noop, error: noop, debug: noop, trace: noop, fatal: noop,
    child: vi.fn().mockReturnThis(), level: 'info', silent: vi.fn(),
  } as unknown as FastifyBaseLogger;
}

interface Mocks {
  repo: VariantProposalRepository & {
    create: ReturnType<typeof vi.fn>;
    findActiveByPlan: ReturnType<typeof vi.fn>;
    confirm: ReturnType<typeof vi.fn>;
    reject: ReturnType<typeof vi.fn>;
  };
  plansRepo: PlansRepository & {
    findItemsByPlanId: ReturnType<typeof vi.fn>;
  };
  auditService: AuditService & { write: ReturnType<typeof vi.fn> };
}

function buildMocks(): Mocks {
  return {
    repo: {
      create: vi.fn(),
      findActiveByPlan: vi.fn().mockResolvedValue([]),
      confirm: vi.fn().mockResolvedValue(undefined),
      reject: vi.fn().mockResolvedValue(undefined),
    } as unknown as Mocks['repo'],
    plansRepo: {
      findItemsByPlanId: vi.fn(),
    } as unknown as Mocks['plansRepo'],
    auditService: { write: vi.fn().mockResolvedValue(undefined) } as unknown as Mocks['auditService'],
  };
}

function buildService(mocks: Mocks): VariantProposalService {
  return new VariantProposalService({
    repo: mocks.repo,
    plansRepo: mocks.plansRepo,
    auditService: mocks.auditService,
    logger: buildLogger(),
  });
}

const planItem: PlanItemRow = {
  id: PLAN_ITEM_ID,
  plan_id: PLAN_ID,
  child_id: CHILD_ID,
  day: 'wednesday',
  slot: 'main',
  recipe_id: null,
  item_id: null,
  ingredients: ['chicken', 'rice', 'peas'],
  paused_at: null,
  replaced_by_plan_id: null,
  created_at: '2026-05-04T12:00:00.000Z',
  updated_at: '2026-05-04T12:00:00.000Z',
};

function buildPlanOutput(overrides: Partial<PlanComposeOutput> = {}): PlanComposeOutput {
  return {
    plan_id: PLAN_ID,
    household_id: HOUSEHOLD_ID,
    week_of: '2026-05-04',
    prompt_version: 'p-1',
    days: [
      {
        day: 'wednesday',
        items: [
          {
            child_id: CHILD_ID,
            slot: 'main',
            ingredients: ['chicken', 'rice', 'peas'],
          },
        ],
      },
    ],
    variant_proposal: {
      child_id: CHILD_ID,
      day: 'wednesday',
      slot: 'main',
      base_method: 'pan-fried',
      variant_method: 'oven-baked',
      variant_description: 'oven-baked instead of pan-fried',
    },
    ...overrides,
  };
}

describe('VariantProposalService.createFromPlanOutput', () => {
  it('inserts the proposal and writes the audit event when planner emits one', async () => {
    const mocks = buildMocks();
    mocks.plansRepo.findItemsByPlanId.mockResolvedValue([planItem]);
    const service = buildService(mocks);

    await service.createFromPlanOutput({
      planOutput: buildPlanOutput(),
      planId: PLAN_ID,
      householdId: HOUSEHOLD_ID,
      requestId: REQUEST_ID,
    });

    expect(mocks.repo.create).toHaveBeenCalledTimes(1);
    const createInput = mocks.repo.create.mock.calls[0]?.[0];
    expect(createInput.householdId).toBe(HOUSEHOLD_ID);
    expect(createInput.planItemId).toBe(PLAN_ITEM_ID);
    expect(createInput.variantMethod).toBe('oven-baked');
    expect(createInput.baseRecipeName).toBe('chicken, rice, peas');

    expect(mocks.auditService.write).toHaveBeenCalledTimes(1);
    const auditCall = mocks.auditService.write.mock.calls[0]?.[0];
    expect(auditCall.event_type).toBe('plan.variant_proposal_created');
  });

  it('is a no-op when planner emits no variant_proposal', async () => {
    const mocks = buildMocks();
    const service = buildService(mocks);

    const planOutput: PlanComposeOutput = buildPlanOutput();
    delete planOutput.variant_proposal;

    await service.createFromPlanOutput({
      planOutput,
      planId: PLAN_ID,
      householdId: HOUSEHOLD_ID,
      requestId: REQUEST_ID,
    });

    expect(mocks.repo.create).not.toHaveBeenCalled();
    expect(mocks.auditService.write).not.toHaveBeenCalled();
  });

  it('skips when an active proposal already exists for the plan', async () => {
    const mocks = buildMocks();
    const existing: VariantProposal = {
      id: PROPOSAL_ID,
      household_id: HOUSEHOLD_ID,
      child_id: CHILD_ID,
      plan_item_id: PLAN_ITEM_ID,
      plan_id: PLAN_ID,
      base_recipe_name: 'older',
      base_method: 'raw',
      variant_description: 'roasted',
      variant_method: 'roasted',
      proposed_at: '2026-05-04T12:00:00.000Z',
      confirmed_at: null,
      rejected_at: null,
    };
    mocks.repo.findActiveByPlan.mockResolvedValue([existing]);
    const service = buildService(mocks);

    await service.createFromPlanOutput({
      planOutput: buildPlanOutput(),
      planId: PLAN_ID,
      householdId: HOUSEHOLD_ID,
      requestId: REQUEST_ID,
    });

    expect(mocks.repo.create).not.toHaveBeenCalled();
  });

  it('skips when base_method equals variant_method', async () => {
    const mocks = buildMocks();
    const service = buildService(mocks);

    const planOutput = buildPlanOutput({
      variant_proposal: {
        child_id: CHILD_ID,
        day: 'wednesday',
        slot: 'main',
        base_method: 'baked',
        variant_method: 'baked',
        variant_description: 'baked instead of baked',
      },
    });

    await service.createFromPlanOutput({
      planOutput,
      planId: PLAN_ID,
      householdId: HOUSEHOLD_ID,
      requestId: REQUEST_ID,
    });

    expect(mocks.repo.create).not.toHaveBeenCalled();
  });

  it('skips when the proposed (child, day, slot) cannot be resolved to a plan item', async () => {
    const mocks = buildMocks();
    mocks.plansRepo.findItemsByPlanId.mockResolvedValue([]);
    const service = buildService(mocks);

    await service.createFromPlanOutput({
      planOutput: buildPlanOutput(),
      planId: PLAN_ID,
      householdId: HOUSEHOLD_ID,
      requestId: REQUEST_ID,
    });

    expect(mocks.repo.create).not.toHaveBeenCalled();
  });
});

describe('VariantProposalService.confirmProposal', () => {
  it('calls repo.confirm + writes plan.variant_proposal_confirmed audit on try_variant', async () => {
    const mocks = buildMocks();
    const service = buildService(mocks);

    await service.confirmProposal({
      proposalId: PROPOSAL_ID,
      householdId: HOUSEHOLD_ID,
      choice: 'try_variant',
      requestId: REQUEST_ID,
    });

    expect(mocks.repo.confirm).toHaveBeenCalledWith(PROPOSAL_ID, HOUSEHOLD_ID);
    expect(mocks.repo.reject).not.toHaveBeenCalled();
    const auditCall = mocks.auditService.write.mock.calls[0]?.[0];
    expect(auditCall.event_type).toBe('plan.variant_proposal_confirmed');
  });

  it('calls repo.reject + writes plan.variant_proposal_rejected audit on keep_original', async () => {
    const mocks = buildMocks();
    const service = buildService(mocks);

    await service.confirmProposal({
      proposalId: PROPOSAL_ID,
      householdId: HOUSEHOLD_ID,
      choice: 'keep_original',
      requestId: REQUEST_ID,
    });

    expect(mocks.repo.reject).toHaveBeenCalledWith(PROPOSAL_ID, HOUSEHOLD_ID);
    expect(mocks.repo.confirm).not.toHaveBeenCalled();
    const auditCall = mocks.auditService.write.mock.calls[0]?.[0];
    expect(auditCall.event_type).toBe('plan.variant_proposal_rejected');
  });
});
