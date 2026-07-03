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
import type { SnackSkuRepository, SnackSkuRow } from '../recipe/snack-sku.repository.js';
import {
  NotFoundError,
  SwapGuardrailBlockedError,
  ValidationError,
} from '../../common/errors.js';
import {
  TEST_IDS,
  buildPlanTree,
  buildPlanSlot,
  buildPlanSlotVariation,
} from '../../../test/factories/index.js';

// Epic 13-s9 / routing-spec §9 #3 — swapSlotSnackSku. A placed snack is stored
// as snack_sku_id (recipe_id nulled); safety mirrors the commit-time doctrine:
// tagged SKU → tag-set guardrail evaluation per variation, untagged SKU →
// parent-attested (no evaluation).

const REQUEST_ID = '99999999-9999-4999-8999-999999999999';
const NEW_SKU_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

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

function buildSku(): SnackSkuRow {
  return {
    id: NEW_SKU_ID,
    name: 'Apple slices',
    brand: null,
    category: 'fruit',
    allergen_tags: [],
    dietary_tags: [],
    is_active: true,
    in_stock: true,
    created_by_household_id: null,
    archived_at: null,
    created_at: '2026-06-01T00:00:00Z',
    upc_code: null,
    package_type: null,
  };
}

function sku(overrides: Partial<SnackSkuRow> = {}): SnackSkuRow {
  return { ...buildSku(), ...overrides };
}

// A tree whose only slot is a snack slot already holding a SKU.
function snackTree(slotOverrides: Partial<ReturnType<typeof buildPlanSlot>> = {}) {
  const slot = buildPlanSlot({
    slot_kind: 'snack',
    main_assignment_id: null,
    recipe_id: null,
    snack_sku_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    ...slotOverrides,
  });
  return buildPlanTree({
    slots: [slot],
    variations: [buildPlanSlotVariation({ plan_slot_id: slot.id })],
  });
}

function buildRepoForTree(tree: ReturnType<typeof buildPlanTree>) {
  return {
    findByIdForPresentation: vi.fn().mockResolvedValue(tree.plan),
    findMainAssignmentsByPlanId: vi.fn().mockResolvedValue(tree.mainAssignments),
    findDaysByPlanId: vi.fn().mockResolvedValue(tree.days),
    findSlotsByPlanId: vi.fn().mockResolvedValue(tree.slots),
    findVariationsBySlotIds: vi.fn().mockResolvedValue(tree.variations),
    updateSlotSnackSku: vi
      .fn()
      .mockImplementation(({ slotId, newSnackSkuId }: { slotId: string; newSnackSkuId: string }) =>
        Promise.resolve(
          buildPlanSlot({
            id: slotId,
            slot_kind: 'snack',
            main_assignment_id: null,
            recipe_id: null,
            snack_sku_id: newSnackSkuId,
          }),
        ),
      ),
  };
}

function makeService(opts: {
  repo: ReturnType<typeof buildRepoForTree>;
  shelf?: SnackSkuRow[];
  evaluate?: ReturnType<typeof vi.fn>;
  omitSnackSkuRepo?: boolean;
}) {
  const evaluate = opts.evaluate ?? vi.fn().mockResolvedValue({ verdict: 'cleared', conflicts: [] });
  const refreshTree = vi.fn().mockResolvedValue(undefined);
  const auditWrite = vi.fn().mockResolvedValue(undefined);
  const snackSkuRepository = opts.omitSnackSkuRepo
    ? undefined
    : ({
        findActiveForHousehold: vi.fn().mockResolvedValue(opts.shelf ?? [sku()]),
      } as unknown as SnackSkuRepository);
  const service = new PlansService({
    repository: opts.repo as unknown as PlansRepository,
    briefStateRepository: {} as unknown as BriefStateRepository,
    briefStateComposer: { refreshTree } as unknown as BriefStateComposer,
    allergyGuardrail: { evaluate } as unknown as AllergyGuardrailService,
    auditService: { write: auditWrite } as unknown as AuditService,
    logger: buildLogger(),
    redis: {} as unknown as Redis,
    regenQueue: {} as unknown as Queue,
    snackSkuRepository,
  });
  return { service, evaluate, refreshTree, auditWrite };
}

function swapArgs(input: { new_snack_sku_id: string } = { new_snack_sku_id: NEW_SKU_ID }) {
  return {
    planId: TEST_IDS.plan,
    planSlotId: TEST_IDS.planSlot,
    householdId: TEST_IDS.household,
    requestId: REQUEST_ID,
    input,
  };
}

describe('PlansService.swapSlotSnackSku', () => {
  it('writes snack_sku_id via the repo, refreshes brief state, and audits plan.slot_snack_swapped', async () => {
    const repo = buildRepoForTree(snackTree());
    const { service, refreshTree, auditWrite } = makeService({ repo });

    const updated = await service.swapSlotSnackSku(swapArgs());

    expect(repo.updateSlotSnackSku).toHaveBeenCalledWith({
      slotId: TEST_IDS.planSlot,
      newSnackSkuId: NEW_SKU_ID,
    });
    expect(updated.snack_sku_id).toBe(NEW_SKU_ID);
    expect(updated.recipe_id).toBeNull();
    expect(refreshTree).toHaveBeenCalledWith(
      TEST_IDS.household,
      expect.any(String),
      REQUEST_ID,
      { userInitiated: true },
    );
    expect(auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'plan.slot_snack_swapped',
        household_id: TEST_IDS.household,
        request_id: REQUEST_ID,
        metadata: expect.objectContaining({
          plan_id: TEST_IDS.plan,
          plan_slot_id: TEST_IDS.planSlot,
          new_snack_sku_id: NEW_SKU_ID,
        }),
      }),
    );
  });

  it('migrates a legacy snack slot holding recipe_id to snack_sku_id (§9 #3 convergence)', async () => {
    const repo = buildRepoForTree(
      snackTree({ snack_sku_id: null, recipe_id: TEST_IDS.recipe }),
    );
    const { service } = makeService({ repo });

    const updated = await service.swapSlotSnackSku(swapArgs());

    expect(repo.updateSlotSnackSku).toHaveBeenCalledWith({
      slotId: TEST_IDS.planSlot,
      newSnackSkuId: NEW_SKU_ID,
    });
    expect(updated.snack_sku_id).toBe(NEW_SKU_ID);
    expect(updated.recipe_id).toBeNull();
  });

  it('rejects non-snack slots with ValidationError', async () => {
    const repo = buildRepoForTree(buildPlanTree()); // default tree: main slot
    const { service } = makeService({ repo });

    await expect(service.swapSlotSnackSku(swapArgs())).rejects.toBeInstanceOf(ValidationError);
    expect(repo.updateSlotSnackSku).not.toHaveBeenCalled();
  });

  it('throws NotFoundError for an unknown slot', async () => {
    const tree = snackTree();
    const repo = buildRepoForTree({ ...tree, slots: [] });
    const { service } = makeService({ repo });

    await expect(service.swapSlotSnackSku(swapArgs())).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws NotFoundError when the SKU is not on the household shelf', async () => {
    const repo = buildRepoForTree(snackTree());
    const { service } = makeService({ repo, shelf: [] });

    await expect(service.swapSlotSnackSku(swapArgs())).rejects.toBeInstanceOf(NotFoundError);
    expect(repo.updateSlotSnackSku).not.toHaveBeenCalled();
  });

  it('rejects an out-of-stock SKU with ValidationError', async () => {
    const repo = buildRepoForTree(snackTree());
    const { service } = makeService({ repo, shelf: [sku({ in_stock: false })] });

    await expect(service.swapSlotSnackSku(swapArgs())).rejects.toBeInstanceOf(ValidationError);
    expect(repo.updateSlotSnackSku).not.toHaveBeenCalled();
  });

  it('evaluates tagged SKUs against the guardrail and blocks with audit on conflict', async () => {
    const repo = buildRepoForTree(snackTree());
    const evaluate = vi.fn().mockResolvedValue({
      verdict: 'blocked',
      conflicts: [
        {
          child_id: TEST_IDS.childA,
          allergen: 'peanut',
          ingredient: 'peanut',
          day: 'monday',
          slot: 'snack',
        },
      ],
    });
    const { service, auditWrite } = makeService({
      repo,
      shelf: [sku({ allergen_tags: ['peanut'] })],
      evaluate,
    });

    await expect(service.swapSlotSnackSku(swapArgs())).rejects.toBeInstanceOf(
      SwapGuardrailBlockedError,
    );
    expect(evaluate).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          child_id: TEST_IDS.childA,
          day: 'monday',
          slot: 'snack',
          ingredients: ['peanut'],
        }),
      ],
      TEST_IDS.household,
    );
    expect(repo.updateSlotSnackSku).not.toHaveBeenCalled();
    expect(auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({ event_type: 'allergy.guardrail_rejection' }),
    );
  });

  it('skips guardrail evaluation for untagged SKUs (parent-attested doctrine)', async () => {
    const repo = buildRepoForTree(snackTree());
    const evaluate = vi.fn();
    const { service } = makeService({ repo, shelf: [sku({ allergen_tags: [] })], evaluate });

    await service.swapSlotSnackSku(swapArgs());

    expect(evaluate).not.toHaveBeenCalled();
    expect(repo.updateSlotSnackSku).toHaveBeenCalled();
  });

  it('throws ValidationError when snackSkuRepository is not configured', async () => {
    const repo = buildRepoForTree(snackTree());
    const { service } = makeService({ repo, omitSnackSkuRepo: true });

    await expect(service.swapSlotSnackSku(swapArgs())).rejects.toBeInstanceOf(ValidationError);
  });
});
