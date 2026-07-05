import { describe, it, expect, vi } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import { VariantProposalService } from './variant-proposal.service.js';
import type { VariantProposalRepository } from './variant-proposal.repository.js';
import type { AuditService } from '../../audit/audit.service.js';
import type { PlanComposeTreeOutput } from '@hivekitchen/types';

// Story 3-DM-C1 Phase 6 — createFromTreePlanOutput resolution + repo.createTree
// wiring. Vitest-mocked; no DB.

const HOUSEHOLD = '11111111-1111-4111-8111-111111111111';
const PLAN_ID = '22222222-2222-4222-8222-222222222222';
const CHILD_A = '33333333-3333-4333-8333-333333333333';
const VARIATION_ID = '44444444-4444-4444-8444-444444444444';
const RECIPE_M1 = '55555555-5555-4555-8555-555555555555';
const REQ = '66666666-6666-4666-8666-666666666666';

function buildLogger(): FastifyBaseLogger {
  const noop = vi.fn();
  return {
    info: noop, warn: noop, error: noop, debug: noop, trace: noop, fatal: noop,
    child: vi.fn().mockReturnThis(), level: 'info', silent: vi.fn(),
  } as unknown as FastifyBaseLogger;
}

function buildService(opts: { existing?: unknown[] } = {}) {
  const createTree = vi.fn().mockResolvedValue({ id: 'vp1' });
  const findActiveByPlan = vi.fn().mockResolvedValue(opts.existing ?? []);
  const write = vi.fn().mockResolvedValue(undefined);
  const repo = { createTree, findActiveByPlan } as unknown as VariantProposalRepository;
  const audit = { write } as unknown as AuditService;
  return {
    service: new VariantProposalService({ repo, auditService: audit, logger: buildLogger() }),
    mocks: { createTree, findActiveByPlan, write },
  };
}

const baseTreeOutput: PlanComposeTreeOutput = {
  plan_id: PLAN_ID,
  household_id: HOUSEHOLD,
  week_of: '2026-06-01',
  prompt_version: 'v2.0.0',
  main_assignments: [{ sequence: 1, recipe_id: RECIPE_M1 }],
  days: [
    {
      day: 'monday',
      slots: [
        {
          slot_kind: 'main',
          main_assignment_sequence: 1,
          variations: [
            // Post-commit tree carries variation.id. Type cast: PlannerVariationInputSchema
            // doesn't include `id`, but the post-commit object adds it.
            { child_id: CHILD_A, portion_size: 'regular' } as unknown as { child_id: string },
          ],
        },
      ],
    },
  ],
  variant_proposal: {
    child_id: CHILD_A,
    day: 'monday',
    slot: 'main',
    base_method: 'pan-fried',
    variant_method: 'oven-baked',
    variant_description: 'oven-baked instead of pan-fried',
  },
};

function withVariationId(output: PlanComposeTreeOutput, id: string): PlanComposeTreeOutput {
  return {
    ...output,
    days: output.days.map((d) => ({
      ...d,
      slots: d.slots.map((s) => ({
        ...s,
        variations: s.variations.map(
          (v) => ({ ...v, id }) as unknown as { child_id: string },
        ),
      })),
    })),
  };
}

describe('VariantProposalService.createFromTreePlanOutput', () => {
  it('no-ops when planOutput.variant_proposal is absent', async () => {
    const { service, mocks } = buildService();
    await service.createFromTreePlanOutput({
      planOutput: { ...baseTreeOutput, variant_proposal: undefined },
      planId: PLAN_ID,
      householdId: HOUSEHOLD,
      requestId: REQ,
    });
    expect(mocks.createTree).not.toHaveBeenCalled();
  });

  it('skips when base_method === variant_method', async () => {
    const { service, mocks } = buildService();
    await service.createFromTreePlanOutput({
      planOutput: {
        ...baseTreeOutput,
        variant_proposal: { ...baseTreeOutput.variant_proposal!, variant_method: 'pan-fried' },
      },
      planId: PLAN_ID,
      householdId: HOUSEHOLD,
      requestId: REQ,
    });
    expect(mocks.createTree).not.toHaveBeenCalled();
  });

  it('skips when an active proposal already exists for the plan', async () => {
    const { service, mocks } = buildService({ existing: [{ id: 'prior' }] });
    await service.createFromTreePlanOutput({
      planOutput: withVariationId(baseTreeOutput, VARIATION_ID),
      planId: PLAN_ID,
      householdId: HOUSEHOLD,
      requestId: REQ,
    });
    expect(mocks.createTree).not.toHaveBeenCalled();
  });

  it('logs and skips when the variation has no id (caller passed pre-commit tree)', async () => {
    const { service, mocks } = buildService();
    await service.createFromTreePlanOutput({
      planOutput: baseTreeOutput,
      planId: PLAN_ID,
      householdId: HOUSEHOLD,
      requestId: REQ,
    });
    expect(mocks.createTree).not.toHaveBeenCalled();
  });

  it('writes plan_slot_variation_id when variation id is present', async () => {
    const { service, mocks } = buildService();
    await service.createFromTreePlanOutput({
      planOutput: withVariationId(baseTreeOutput, VARIATION_ID),
      planId: PLAN_ID,
      householdId: HOUSEHOLD,
      requestId: REQ,
    });
    expect(mocks.createTree).toHaveBeenCalledTimes(1);
    expect(mocks.createTree).toHaveBeenCalledWith(
      expect.objectContaining({
        planSlotVariationId: VARIATION_ID,
        planId: PLAN_ID,
        householdId: HOUSEHOLD,
        childId: CHILD_A,
        baseMethod: 'pan-fried',
        variantMethod: 'oven-baked',
      }),
    );
    expect(mocks.write).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'plan.variant_proposal_created',
        metadata: expect.objectContaining({
          plan_slot_variation_id: VARIATION_ID,
        }),
      }),
    );
  });

  it('skips when (child_id, day, slot) does not resolve in the tree', async () => {
    const { service, mocks } = buildService();
    await service.createFromTreePlanOutput({
      planOutput: withVariationId(
        {
          ...baseTreeOutput,
          variant_proposal: {
            ...baseTreeOutput.variant_proposal!,
            day: 'friday', // ← not in days[]
          },
        },
        VARIATION_ID,
      ),
      planId: PLAN_ID,
      householdId: HOUSEHOLD,
      requestId: REQ,
    });
    expect(mocks.createTree).not.toHaveBeenCalled();
  });

  it('uses recipe_name lookup when provided', async () => {
    const { service, mocks } = buildService();
    const recipeNameById = new Map([[RECIPE_M1, 'Lemon Chicken Bowl']]);
    await service.createFromTreePlanOutput({
      planOutput: withVariationId(baseTreeOutput, VARIATION_ID),
      planId: PLAN_ID,
      householdId: HOUSEHOLD,
      requestId: REQ,
      recipeNameById,
    });
    expect(mocks.createTree).toHaveBeenCalledWith(
      expect.objectContaining({ baseRecipeName: 'Lemon Chicken Bowl' }),
    );
  });

  it('falls back to "Unknown dish" when no recipe_name lookup is provided', async () => {
    const { service, mocks } = buildService();
    await service.createFromTreePlanOutput({
      planOutput: withVariationId(baseTreeOutput, VARIATION_ID),
      planId: PLAN_ID,
      householdId: HOUSEHOLD,
      requestId: REQ,
    });
    expect(mocks.createTree).toHaveBeenCalledWith(
      expect.objectContaining({ baseRecipeName: 'Unknown dish' }),
    );
  });
});
