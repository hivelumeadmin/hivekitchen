import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import { CuratedBaselineMaterializationService } from './curated-baseline.service.js';
import type { CuratedBaselineItemRow, CuratedBaselineRepository } from './curated-baseline.repository.js';
import type { RecipesRepository } from '../recipe/recipes.repository.js';
import type { HouseholdsRepository } from '../households/households.repository.js';
import {
  AllergyGuardrailDecryptError,
  type AllergyGuardrailRepository,
} from '../allergy-guardrail/allergy-guardrail.repository.js';
import type { AllergyRule } from '../allergy-guardrail/allergy-rules.engine.js';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';

function buildLogger(): FastifyBaseLogger {
  const noop = vi.fn();
  return {
    info: noop, warn: noop, error: noop, debug: noop, trace: noop, fatal: noop,
    child: vi.fn().mockReturnThis(), level: 'info', silent: vi.fn(),
  } as unknown as FastifyBaseLogger;
}

const FALCPA_RULES: AllergyRule[] = [
  { id: 'peanut', household_id: null, child_id: null, allergen: 'peanut', rule_type: 'falcpa' },
  { id: 'tree_nut', household_id: null, child_id: null, allergen: 'tree_nut', rule_type: 'falcpa' },
  { id: 'dairy', household_id: null, child_id: null, allergen: 'dairy', rule_type: 'falcpa' },
  { id: 'egg', household_id: null, child_id: null, allergen: 'egg', rule_type: 'falcpa' },
  { id: 'wheat', household_id: null, child_id: null, allergen: 'wheat', rule_type: 'falcpa' },
  { id: 'soy', household_id: null, child_id: null, allergen: 'soy', rule_type: 'falcpa' },
  { id: 'fish', household_id: null, child_id: null, allergen: 'fish', rule_type: 'falcpa' },
  { id: 'shellfish', household_id: null, child_id: null, allergen: 'shellfish', rule_type: 'falcpa' },
  { id: 'sesame', household_id: null, child_id: null, allergen: 'sesame', rule_type: 'falcpa' },
];

function makeItem(
  overrides: Partial<CuratedBaselineItemRow> & { canonical_name: string },
): CuratedBaselineItemRow {
  return {
    id: 'item-id',
    allergen_flags: [],
    dietary_flags: [],
    cultural_tags: [],
    cuisine_tags: ['north_american'],
    applicable_slots: ['main'],
    notes: null,
    is_active: true,
    ...overrides,
  };
}

type Deps = {
  baselineRepo: { findAllActive: ReturnType<typeof vi.fn>; findActiveByCuisineTags: ReturnType<typeof vi.fn> };
  recipesRepo: { seedFromCatalogBaseline: ReturnType<typeof vi.fn> };
  householdsRepo: { getStage0MaterializedAt: ReturnType<typeof vi.fn>; setStage0MaterializedAt: ReturnType<typeof vi.fn> };
  guardrailRepo: { getRulesForHousehold: ReturnType<typeof vi.fn> };
};

function buildDeps(overrides: Partial<Deps> = {}): Deps {
  return {
    baselineRepo: {
      findAllActive: vi.fn().mockResolvedValue([]),
      findActiveByCuisineTags: vi.fn().mockResolvedValue([]),
    },
    recipesRepo: {
      seedFromCatalogBaseline: vi.fn().mockResolvedValue(0),
    },
    householdsRepo: {
      getStage0MaterializedAt: vi.fn().mockResolvedValue(null),
      setStage0MaterializedAt: vi.fn().mockResolvedValue(undefined),
    },
    guardrailRepo: {
      getRulesForHousehold: vi.fn().mockResolvedValue(FALCPA_RULES),
    },
    ...overrides,
  };
}

function buildService(deps: Deps, logger = buildLogger()): CuratedBaselineMaterializationService {
  return new CuratedBaselineMaterializationService({
    curatedBaselineRepo: deps.baselineRepo as unknown as CuratedBaselineRepository,
    recipesRepo: deps.recipesRepo as unknown as RecipesRepository,
    householdsRepo: deps.householdsRepo as unknown as HouseholdsRepository,
    guardrailRepo: deps.guardrailRepo as unknown as AllergyGuardrailRepository,
    logger,
  });
}

describe('CuratedBaselineMaterializationService — materialize', () => {
  it('happy path: items materialized, stage0_materialized_at set', async () => {
    const items = [
      makeItem({ canonical_name: 'Grilled chicken with rice', id: 'a' }),
      makeItem({ canonical_name: 'Rice with black beans', id: 'b' }),
    ];
    const deps = buildDeps();
    deps.baselineRepo.findAllActive.mockResolvedValue(items);
    deps.recipesRepo.seedFromCatalogBaseline.mockResolvedValue(2);

    await buildService(deps).materialize(HOUSEHOLD_ID);

    // both items cleared the broad-safe guardrail (FALCPA rules only) and
    // were passed downstream
    expect(deps.recipesRepo.seedFromCatalogBaseline).toHaveBeenCalledTimes(1);
    const [callHouseholdId, callItems] = deps.recipesRepo.seedFromCatalogBaseline.mock.calls[0]!;
    expect(callHouseholdId).toBe(HOUSEHOLD_ID);
    expect(callItems).toHaveLength(2);
    expect(deps.householdsRepo.setStage0MaterializedAt).toHaveBeenCalledWith(HOUSEHOLD_ID);
  });

  it('idempotent no-op when stage0_materialized_at is already set', async () => {
    const deps = buildDeps();
    deps.householdsRepo.getStage0MaterializedAt.mockResolvedValue('2026-05-24T00:00:00.000Z');

    await buildService(deps).materialize(HOUSEHOLD_ID);

    expect(deps.baselineRepo.findAllActive).not.toHaveBeenCalled();
    expect(deps.recipesRepo.seedFromCatalogBaseline).not.toHaveBeenCalled();
    expect(deps.householdsRepo.setStage0MaterializedAt).not.toHaveBeenCalled();
  });

  it('guardrail blocks tripwire items (name contains FALCPA synonym); survivors persisted', async () => {
    // 'peanut butter rice bowl' — name contains 'peanut' → blocked by FALCPA
    // peanut rule. Clean items pass through.
    const items = [
      makeItem({ canonical_name: 'Grilled chicken with rice', id: 'safe' }),
      makeItem({ canonical_name: 'peanut butter rice bowl', id: 'tripwire' }),
      makeItem({ canonical_name: 'Rice with black beans', id: 'safe2' }),
    ];
    const deps = buildDeps();
    deps.baselineRepo.findAllActive.mockResolvedValue(items);
    deps.recipesRepo.seedFromCatalogBaseline.mockResolvedValue(2);

    await buildService(deps).materialize(HOUSEHOLD_ID);

    const [, survivors] = deps.recipesRepo.seedFromCatalogBaseline.mock.calls[0]!;
    expect(survivors).toHaveLength(2);
    const survivorNames = (survivors as Array<{ canonical_name: string }>).map((s) => s.canonical_name);
    expect(survivorNames).not.toContain('peanut butter rice bowl');
  });

  it('below-floor log fires when persisted < 30', async () => {
    const items = [makeItem({ canonical_name: 'Grilled chicken with rice', id: 'a' })];
    const logger = buildLogger();
    const deps = buildDeps();
    deps.baselineRepo.findAllActive.mockResolvedValue(items);
    deps.recipesRepo.seedFromCatalogBaseline.mockResolvedValue(5);

    await buildService(deps, logger).materialize(HOUSEHOLD_ID);

    const warnCalls = (logger.warn as ReturnType<typeof vi.fn>).mock.calls;
    const belowFloor = warnCalls.find(
      ([ctx]) => (ctx as { action?: string }).action === 'catalog.stage0.below_floor',
    );
    expect(belowFloor).toBeDefined();
    expect((belowFloor![0] as { persisted_count: number }).persisted_count).toBe(5);
  });

  it('terminal-zero log fires when persisted = 0; setStage0MaterializedAt still set', async () => {
    const items = [makeItem({ canonical_name: 'Grilled chicken with rice', id: 'a' })];
    const logger = buildLogger();
    const deps = buildDeps();
    deps.baselineRepo.findAllActive.mockResolvedValue(items);
    deps.recipesRepo.seedFromCatalogBaseline.mockResolvedValue(0);

    await buildService(deps, logger).materialize(HOUSEHOLD_ID);

    const warnCalls = (logger.warn as ReturnType<typeof vi.fn>).mock.calls;
    const terminalZero = warnCalls.find(
      ([ctx]) => (ctx as { action?: string }).action === 'catalog.stage0.terminal_zero',
    );
    expect(terminalZero).toBeDefined();
    // We still set the timestamp so we don't loop on retry — Stage 1
    // compensates downstream.
    expect(deps.householdsRepo.setStage0MaterializedAt).toHaveBeenCalledWith(HOUSEHOLD_ID);
  });

  it('never throws — guardrail rule load error is caught and logged; timestamp NOT set', async () => {
    const items = [makeItem({ canonical_name: 'Grilled chicken with rice', id: 'a' })];
    const logger = buildLogger();
    const deps = buildDeps();
    deps.baselineRepo.findAllActive.mockResolvedValue(items);
    deps.guardrailRepo.getRulesForHousehold.mockRejectedValue(new Error('db down'));

    await expect(buildService(deps, logger).materialize(HOUSEHOLD_ID)).resolves.toBeUndefined();

    const errorCalls = (logger.error as ReturnType<typeof vi.fn>).mock.calls;
    const failedCall = errorCalls.find(
      ([ctx]) => (ctx as { action?: string }).action === 'catalog.stage0.materialize_failed',
    );
    expect(failedCall).toBeDefined();
    expect(deps.recipesRepo.seedFromCatalogBaseline).not.toHaveBeenCalled();
    // runBatch re-throws non-decrypt errors → outer catch fires BEFORE
    // setStage0MaterializedAt. The household remains un-stamped so the next
    // login can retry once the DB recovers.
    expect(deps.householdsRepo.setStage0MaterializedAt).not.toHaveBeenCalled();
  });

  it('empty baseline (findAllActive returns []) logs no_candidates; timestamp still set', async () => {
    const logger = buildLogger();
    const deps = buildDeps(); // findAllActive returns [] by default

    await buildService(deps, logger).materialize(HOUSEHOLD_ID);

    const warnCalls = (logger.warn as ReturnType<typeof vi.fn>).mock.calls;
    const noCandidates = warnCalls.find(
      ([ctx]) => (ctx as { action?: string }).action === 'catalog.stage0.no_candidates',
    );
    expect(noCandidates).toBeDefined();
    expect(deps.recipesRepo.seedFromCatalogBaseline).not.toHaveBeenCalled();
    // No candidates is a valid degraded state — stamp the timestamp to avoid
    // a retry loop; Stage 1 will compensate.
    expect(deps.householdsRepo.setStage0MaterializedAt).toHaveBeenCalledWith(HOUSEHOLD_ID);
  });

  it('AllergyGuardrailDecryptError is fail-closed: skip persistence + log + return 0 survivors', async () => {
    const items = [makeItem({ canonical_name: 'Grilled chicken with rice', id: 'a' })];
    const logger = buildLogger();
    const deps = buildDeps();
    deps.baselineRepo.findAllActive.mockResolvedValue(items);
    deps.guardrailRepo.getRulesForHousehold.mockRejectedValue(
      new AllergyGuardrailDecryptError(HOUSEHOLD_ID),
    );

    await buildService(deps, logger).materialize(HOUSEHOLD_ID);

    expect(deps.recipesRepo.seedFromCatalogBaseline).not.toHaveBeenCalled();
    const errorCalls = (logger.error as ReturnType<typeof vi.fn>).mock.calls;
    const decryptFailure = errorCalls.find(
      ([ctx]) => (ctx as { action?: string }).action === 'catalog.stage0.allergen_decrypt_failure',
    );
    expect(decryptFailure).toBeDefined();
    // Still marks materialization done — next M3 trigger will retry the
    // cuisine-filtered re-seed once the DEK comes back.
    expect(deps.householdsRepo.setStage0MaterializedAt).toHaveBeenCalledWith(HOUSEHOLD_ID);
  });

  it('persistence error in recipesRepo is caught at the outer boundary; never throws', async () => {
    const items = [makeItem({ canonical_name: 'Grilled chicken with rice', id: 'a' })];
    const logger = buildLogger();
    const deps = buildDeps();
    deps.baselineRepo.findAllActive.mockResolvedValue(items);
    deps.recipesRepo.seedFromCatalogBaseline.mockRejectedValue(new Error('insert failed'));

    await expect(buildService(deps, logger).materialize(HOUSEHOLD_ID)).resolves.toBeUndefined();

    const errorCalls = (logger.error as ReturnType<typeof vi.fn>).mock.calls;
    const failedCall = errorCalls.find(
      ([ctx]) => (ctx as { action?: string }).action === 'catalog.stage0.materialize_failed',
    );
    expect(failedCall).toBeDefined();
  });
});

describe('CuratedBaselineMaterializationService — rematerialize', () => {
  it('happy path: cuisine-filtered items materialized; no idempotency check', async () => {
    const items = [
      makeItem({ canonical_name: 'Dal chawal thermos', cuisine_tags: ['south_asian'], id: 'a' }),
    ];
    const deps = buildDeps();
    deps.baselineRepo.findActiveByCuisineTags.mockResolvedValue(items);
    deps.recipesRepo.seedFromCatalogBaseline.mockResolvedValue(1);
    // even with a non-null stage0_materialized_at, rematerialize runs
    deps.householdsRepo.getStage0MaterializedAt.mockResolvedValue('2026-05-24T00:00:00.000Z');

    await buildService(deps).rematerialize(HOUSEHOLD_ID, ['south_asian', 'north_indian']);

    expect(deps.baselineRepo.findActiveByCuisineTags).toHaveBeenCalledWith([
      'south_asian',
      'north_indian',
    ]);
    expect(deps.recipesRepo.seedFromCatalogBaseline).toHaveBeenCalledTimes(1);
    expect(deps.householdsRepo.setStage0MaterializedAt).not.toHaveBeenCalled();
    expect(deps.householdsRepo.getStage0MaterializedAt).not.toHaveBeenCalled();
  });

  it('empty cuisine tags array short-circuits before DB read', async () => {
    const deps = buildDeps();

    await buildService(deps).rematerialize(HOUSEHOLD_ID, []);

    expect(deps.baselineRepo.findActiveByCuisineTags).not.toHaveBeenCalled();
    expect(deps.recipesRepo.seedFromCatalogBaseline).not.toHaveBeenCalled();
  });

  it('never throws — error inside service is caught and logged', async () => {
    const logger = buildLogger();
    const deps = buildDeps();
    deps.baselineRepo.findActiveByCuisineTags.mockRejectedValue(new Error('db error'));

    await expect(
      buildService(deps, logger).rematerialize(HOUSEHOLD_ID, ['south_asian']),
    ).resolves.toBeUndefined();

    const errorCalls = (logger.error as ReturnType<typeof vi.fn>).mock.calls;
    const failed = errorCalls.find(
      ([ctx]) => (ctx as { action?: string }).action === 'catalog.stage0.rematerialize_failed',
    );
    expect(failed).toBeDefined();
  });
});

describe('CuratedBaselineMaterializationService — guardrail uncertain handling', () => {
  it('uncertain verdict is fail-closed; item skipped + logged with index (no name)', async () => {
    // Force an uncertain verdict by removing the FALCPA baseline rules
    // entirely — engine returns uncertain('falcpa_baseline_missing'). NOT a
    // real Stage 0 condition (FALCPA rules ship via the allergen_tags
    // vocabulary), but the cleanest way to drive the uncertain branch.
    const items = [
      makeItem({ canonical_name: 'Grilled chicken with rice', id: 'a' }),
    ];
    const logger = buildLogger();
    const deps = buildDeps();
    deps.baselineRepo.findAllActive.mockResolvedValue(items);
    deps.guardrailRepo.getRulesForHousehold.mockResolvedValue([]); // empty rules → uncertain
    deps.recipesRepo.seedFromCatalogBaseline.mockResolvedValue(0);

    await buildService(deps, logger).materialize(HOUSEHOLD_ID);

    const warnCalls = (logger.warn as ReturnType<typeof vi.fn>).mock.calls;
    const uncertainLog = warnCalls.find(
      ([ctx]) => (ctx as { action?: string }).action === 'catalog.stage0.guardrail_uncertain',
    );
    expect(uncertainLog).toBeDefined();
    expect((uncertainLog![0] as { item_index: number }).item_index).toBe(0);
    // Crucially, no canonical_name in the log payload.
    expect(JSON.stringify(uncertainLog![0])).not.toContain('Grilled chicken');
    // Zero survivors persisted.
    const [, survivors] = deps.recipesRepo.seedFromCatalogBaseline.mock.calls[0]!;
    expect(survivors).toHaveLength(0);
  });
});

describe('CuratedBaselineMaterializationService — loads guardrail rules once per batch', () => {
  it('getRulesForHousehold called exactly once even with many items', async () => {
    const items = Array.from({ length: 50 }, (_, i) =>
      makeItem({ canonical_name: `Item number ${i}`, id: `id-${i}` }),
    );
    const deps = buildDeps();
    deps.baselineRepo.findAllActive.mockResolvedValue(items);
    deps.recipesRepo.seedFromCatalogBaseline.mockResolvedValue(50);

    await buildService(deps).materialize(HOUSEHOLD_ID);

    expect(deps.guardrailRepo.getRulesForHousehold).toHaveBeenCalledTimes(1);
  });
});
