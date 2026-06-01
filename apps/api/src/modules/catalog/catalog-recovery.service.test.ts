import { describe, it, expect, vi } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import type { KitchenMap } from '@hivekitchen/types';
import { CatalogRecoveryService } from './catalog-recovery.service.js';
import type { CuratedBaselineMaterializationService } from './curated-baseline.service.js';
import type { HouseholdsRepository } from '../households/households.repository.js';
import type { KitchenMapService } from '../kitchen-map/kitchen-map.service.js';
import type { RecipesRepository } from '../recipe/recipes.repository.js';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const STAGE1_AT = '2026-05-25T01:23:45.000Z';

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

function buildKitchenMap(cuisineKeys: string[] = ['south_asian']): KitchenMap {
  return {
    household: {
      id: HOUSEHOLD_ID,
      tier: 'standard',
      tier_variant: 'A',
      timezone: 'America/Toronto',
      display_name: 'The Khans',
      cultural_identifiers: [],
      dietary_preferences: [],
      declared_allergens: [],
    },
    caregivers: [],
    children: [],
    cultural: {
      active: cuisineKeys.map((key) => ({
        key,
        label: key,
        state: 'active' as const,
        tier: 'L1' as const,
        confidence: 90,
        presence: 90,
        enforcement: 'just_for_context' as const,
      })),
      suggested: [],
    },
    memory: { nodes: [] },
    household_extras: { library: [] },
    recipes: { favourites: [], banned: [] },
    allergens: [],
    dietary: [],
    food_preferences: [],
    favorite_lunches: [],
    rules: [],
    meta: {
      composed_at: '2026-05-25T00:00:00.000Z',
      map_version: 1,
      schema_version: '1.1.0',
      is_complete: false,
      required_set_complete: false,
    },
  };
}

type Deps = {
  curatedBaselineMaterializationService: { rematerialize: ReturnType<typeof vi.fn> };
  recipesRepo: { countCatalogSeededForHousehold: ReturnType<typeof vi.fn> };
  householdsRepo: { getStage1CompletedAt: ReturnType<typeof vi.fn> };
  kitchenMapService: { get: ReturnType<typeof vi.fn> };
};

function buildDeps(overrides: Partial<Deps> = {}): Deps {
  return {
    curatedBaselineMaterializationService: {
      rematerialize: vi.fn().mockResolvedValue(undefined),
    },
    recipesRepo: {
      // Pre-recovery: below floor. Post-recovery: above floor.
      countCatalogSeededForHousehold: vi
        .fn()
        .mockResolvedValueOnce(20)
        .mockResolvedValueOnce(42),
    },
    householdsRepo: {
      getStage1CompletedAt: vi.fn().mockResolvedValue(STAGE1_AT),
    },
    kitchenMapService: {
      get: vi.fn().mockResolvedValue(buildKitchenMap()),
    },
    ...overrides,
  };
}

function buildService(deps: Deps, logger = buildLogger()): CatalogRecoveryService {
  return new CatalogRecoveryService({
    curatedBaselineMaterializationService:
      deps.curatedBaselineMaterializationService as unknown as CuratedBaselineMaterializationService,
    recipesRepo: deps.recipesRepo as unknown as RecipesRepository,
    householdsRepo: deps.householdsRepo as unknown as HouseholdsRepository,
    kitchenMapService: deps.kitchenMapService as unknown as KitchenMapService,
    logger,
  });
}

describe('CatalogRecoveryService — recoverForHousehold', () => {
  it('happy path (floor_breach): pre=20 → rematerialize → post=42 → completed logged', async () => {
    const logger = buildLogger();
    const deps = buildDeps();

    await buildService(deps, logger).recoverForHousehold(HOUSEHOLD_ID, 'floor_breach');

    expect(deps.curatedBaselineMaterializationService.rematerialize).toHaveBeenCalledWith(
      HOUSEHOLD_ID,
      ['south_asian'],
    );
    const infoCalls = (logger.info as ReturnType<typeof vi.fn>).mock.calls;
    const completed = infoCalls.find(
      ([ctx]) => (ctx as { action?: string }).action === 'catalog.stage2.completed',
    );
    expect(completed).toBeDefined();
    expect(completed![0]).toMatchObject({
      household_id: HOUSEHOLD_ID,
      triggered_by: 'floor_breach',
      pre_recovery_count: 20,
      post_recovery_count: 42,
      cuisine_tag_count: 1,
    });
  });

  it('happy path (mass_block): triggered_by carries through; emitted/blocked counts surfaced in log', async () => {
    const logger = buildLogger();
    const deps = buildDeps();

    await buildService(deps, logger).recoverForHousehold(HOUSEHOLD_ID, 'mass_block', {
      emitted_count: 50,
      blocked_count: 30,
    });

    expect(deps.curatedBaselineMaterializationService.rematerialize).toHaveBeenCalled();
    const infoCalls = (logger.info as ReturnType<typeof vi.fn>).mock.calls;
    const completed = infoCalls.find(
      ([ctx]) => (ctx as { action?: string }).action === 'catalog.stage2.completed',
    );
    expect(completed).toBeDefined();
    expect(completed![0]).toMatchObject({
      triggered_by: 'mass_block',
      emitted_count: 50,
      blocked_count: 30,
    });
  });

  it('happy path (stage1_failure): triggered_by surfaces in completion log', async () => {
    const logger = buildLogger();
    const deps = buildDeps();

    await buildService(deps, logger).recoverForHousehold(HOUSEHOLD_ID, 'stage1_failure');

    const infoCalls = (logger.info as ReturnType<typeof vi.fn>).mock.calls;
    const completed = infoCalls.find(
      ([ctx]) => (ctx as { action?: string }).action === 'catalog.stage2.completed',
    );
    expect(completed).toBeDefined();
    expect((completed![0] as { triggered_by: string }).triggered_by).toBe(
      'stage1_failure',
    );
  });

  it('stage1 in-flight (floor_breach): getStage1CompletedAt returns null → deferred log; rematerialize NOT called', async () => {
    const logger = buildLogger();
    const deps = buildDeps();
    deps.householdsRepo.getStage1CompletedAt.mockResolvedValue(null);

    await expect(
      buildService(deps, logger).recoverForHousehold(HOUSEHOLD_ID, 'floor_breach'),
    ).resolves.toBeUndefined();

    expect(
      deps.curatedBaselineMaterializationService.rematerialize,
    ).not.toHaveBeenCalled();
    const infoCalls = (logger.info as ReturnType<typeof vi.fn>).mock.calls;
    const deferred = infoCalls.find(
      ([ctx]) =>
        (ctx as { action?: string }).action ===
        'catalog.stage2.deferred_stage1_in_flight',
    );
    expect(deferred).toBeDefined();
  });

  it('stage1_failure trigger skips in-flight guard even when stage1_completed_at is null', async () => {
    const deps = buildDeps();
    deps.householdsRepo.getStage1CompletedAt.mockResolvedValue(null);

    await expect(
      buildService(deps).recoverForHousehold(HOUSEHOLD_ID, 'stage1_failure'),
    ).resolves.toBeUndefined();

    // Guard bypassed — rematerialize runs despite null stage1_completed_at.
    expect(deps.curatedBaselineMaterializationService.rematerialize).toHaveBeenCalled();
    // getStage1CompletedAt is never called for stage1_failure.
    expect(deps.householdsRepo.getStage1CompletedAt).not.toHaveBeenCalled();
  });

  it('skip-if-recovered: pre-count >= 35 → skip_already_recovered; rematerialize NOT called', async () => {
    const logger = buildLogger();
    const deps = buildDeps();
    deps.recipesRepo.countCatalogSeededForHousehold = vi.fn().mockResolvedValue(50);

    await expect(
      buildService(deps, logger).recoverForHousehold(HOUSEHOLD_ID, 'mass_block'),
    ).resolves.toBeUndefined();

    expect(
      deps.curatedBaselineMaterializationService.rematerialize,
    ).not.toHaveBeenCalled();
    const infoCalls = (logger.info as ReturnType<typeof vi.fn>).mock.calls;
    const skipped = infoCalls.find(
      ([ctx]) =>
        (ctx as { action?: string }).action === 'catalog.stage2.skip_already_recovered',
    );
    expect(skipped).toBeDefined();
    expect((skipped![0] as { count: number }).count).toBe(50);
  });

  it('terminal-zero: rematerialize runs but post-count = 0 → terminal_zero logged; no throw', async () => {
    const logger = buildLogger();
    const deps = buildDeps();
    deps.recipesRepo.countCatalogSeededForHousehold = vi
      .fn()
      .mockResolvedValueOnce(0) // pre
      .mockResolvedValueOnce(0); // post

    await expect(
      buildService(deps, logger).recoverForHousehold(HOUSEHOLD_ID, 'stage1_failure'),
    ).resolves.toBeUndefined();

    expect(deps.curatedBaselineMaterializationService.rematerialize).toHaveBeenCalled();
    const warnCalls = (logger.warn as ReturnType<typeof vi.fn>).mock.calls;
    const terminalZero = warnCalls.find(
      ([ctx]) => (ctx as { action?: string }).action === 'catalog.stage2.terminal_zero',
    );
    expect(terminalZero).toBeDefined();
    expect(terminalZero![0]).toMatchObject({
      household_id: HOUSEHOLD_ID,
      triggered_by: 'stage1_failure',
    });
  });

  it('cuisine context with empty active priors: rematerialize called with empty array', async () => {
    const deps = buildDeps();
    deps.kitchenMapService.get.mockResolvedValue(buildKitchenMap([]));

    await buildService(deps).recoverForHousehold(HOUSEHOLD_ID, 'floor_breach');

    expect(deps.curatedBaselineMaterializationService.rematerialize).toHaveBeenCalledWith(
      HOUSEHOLD_ID,
      [],
    );
  });

  it('kitchenMapService.get throws → outer catch; failed log; no rethrow', async () => {
    const logger = buildLogger();
    const deps = buildDeps();
    deps.kitchenMapService.get.mockRejectedValue(new Error('household missing'));

    await expect(
      buildService(deps, logger).recoverForHousehold(HOUSEHOLD_ID, 'mass_block'),
    ).resolves.toBeUndefined();

    expect(
      deps.curatedBaselineMaterializationService.rematerialize,
    ).not.toHaveBeenCalled();
    const errCalls = (logger.error as ReturnType<typeof vi.fn>).mock.calls;
    const failed = errCalls.find(
      ([ctx]) => (ctx as { action?: string }).action === 'catalog.stage2.failed',
    );
    expect(failed).toBeDefined();
  });

  it('countCatalogSeededForHousehold throws on pre-count → outer catch; failed log; no rethrow', async () => {
    const logger = buildLogger();
    const deps = buildDeps();
    deps.recipesRepo.countCatalogSeededForHousehold = vi
      .fn()
      .mockRejectedValue(new Error('db down'));

    await expect(
      buildService(deps, logger).recoverForHousehold(HOUSEHOLD_ID, 'floor_breach'),
    ).resolves.toBeUndefined();

    expect(
      deps.curatedBaselineMaterializationService.rematerialize,
    ).not.toHaveBeenCalled();
    const errCalls = (logger.error as ReturnType<typeof vi.fn>).mock.calls;
    const failed = errCalls.find(
      ([ctx]) => (ctx as { action?: string }).action === 'catalog.stage2.failed',
    );
    expect(failed).toBeDefined();
  });

  it('countCatalogSeededForHousehold throws on post-count → post_count_failed log; recovery ran; no rethrow', async () => {
    const logger = buildLogger();
    const deps = buildDeps();
    // Pre-count succeeds (below floor), post-count throws.
    deps.recipesRepo.countCatalogSeededForHousehold = vi
      .fn()
      .mockResolvedValueOnce(10) // pre
      .mockRejectedValueOnce(new Error('db down')); // post

    await expect(
      buildService(deps, logger).recoverForHousehold(HOUSEHOLD_ID, 'floor_breach'),
    ).resolves.toBeUndefined();

    // Rematerialize still ran (recovery happened before the post-count).
    expect(deps.curatedBaselineMaterializationService.rematerialize).toHaveBeenCalled();
    const errCalls = (logger.error as ReturnType<typeof vi.fn>).mock.calls;
    const postFailed = errCalls.find(
      ([ctx]) => (ctx as { action?: string }).action === 'catalog.stage2.post_count_failed',
    );
    expect(postFailed).toBeDefined();
    // catalog.stage2.failed must NOT fire — recovery was not a failure.
    const generalFailed = errCalls.find(
      ([ctx]) => (ctx as { action?: string }).action === 'catalog.stage2.failed',
    );
    expect(generalFailed).toBeUndefined();
  });

  it('rematerialize throws unexpectedly → outer catch (defensive); failed log; no rethrow', async () => {
    // rematerialize is documented as NEVER throwing, but the outer try/catch
    // exists for defense-in-depth. Verify it works if rematerialize is ever
    // refactored to throw.
    const logger = buildLogger();
    const deps = buildDeps();
    deps.curatedBaselineMaterializationService.rematerialize.mockRejectedValue(
      new Error('unexpected'),
    );

    await expect(
      buildService(deps, logger).recoverForHousehold(HOUSEHOLD_ID, 'floor_breach'),
    ).resolves.toBeUndefined();

    const errCalls = (logger.error as ReturnType<typeof vi.fn>).mock.calls;
    const failed = errCalls.find(
      ([ctx]) => (ctx as { action?: string }).action === 'catalog.stage2.failed',
    );
    expect(failed).toBeDefined();
  });
});
