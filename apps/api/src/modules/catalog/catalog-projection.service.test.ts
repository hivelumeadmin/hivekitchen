import { describe, it, expect, vi } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import type { HouseholdsRepository } from '../households/households.repository.js';
import type { OnboardingChipSuggestionRepository } from './onboarding-chip-suggestion.repository.js';
import type { CuratedBaselineRepository } from './curated-baseline.repository.js';
import { CatalogProjectionService } from './catalog-projection.service.js';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';

function makeLogger(): FastifyBaseLogger & { calls: Array<{ level: string; payload: Record<string, unknown> }> } {
  const calls: Array<{ level: string; payload: Record<string, unknown> }> = [];
  const make = (level: string) =>
    vi.fn((payload: Record<string, unknown>) => {
      calls.push({ level, payload });
    });
  const log = {
    info: make('info'),
    warn: make('warn'),
    error: make('error'),
    debug: make('debug'),
    fatal: make('fatal'),
    trace: make('trace'),
    child: () => log,
    level: 'info',
    silent: () => {},
  } as unknown as FastifyBaseLogger & {
    calls: Array<{ level: string; payload: Record<string, unknown> }>;
  };
  (log as { calls: typeof calls }).calls = calls;
  return log;
}

// Slice 16-s1 — the chip source moved from a recipes/household_recipe_usage
// join to onboarding_chip_suggestions. The new table carries no
// confidence/provenance/is_household_favorite columns — those were
// household_recipe_usage-specific. Every generated suggestion projects to a
// chip with provenance 'inferred'; a declared-favourites union (with its own
// pinned-first sort) is 16-s7's job, not this service's.
type Row = {
  id: string;
  label: string;
  cuisine_tags: string[];
  dietary_flags: string[];
  allergen_flags: string[];
};

function makeRow(id: string, label: string, cuisine_tags: string[]): Row {
  return { id, label, cuisine_tags, dietary_flags: [], allergen_flags: [] };
}

type CuratedRow = {
  id: string;
  canonical_name: string;
  cuisine_tags: string[];
  dietary_flags: string[];
  allergen_flags: string[];
};

function makeCuratedRow(id: string, canonical_name: string, cuisine_tags: string[]): CuratedRow {
  return { id, canonical_name, cuisine_tags, dietary_flags: [], allergen_flags: [] };
}

interface BuildArgs {
  rows: Row[];
  stage1At?: string | null;
  // When non-null after `pollFlipAt` calls, getStage1CompletedAt resolves.
  stage1FlipAfterCalls?: number;
  // Slice 16-s1 (AC 8) — curated_baseline_items fallback rows. undefined means
  // the repository dep is still wired (findAllActive/findActiveByCuisineTags
  // just resolve []) — a curated repo that's entirely absent isn't a real
  // production configuration, so there's no "unwired" mode to model here.
  curatedRows?: CuratedRow[];
}

function buildService(args: BuildArgs) {
  const wait = vi.fn().mockResolvedValue(undefined);
  let getCalls = 0;
  const householdsRepository = {
    getStage1CompletedAt: vi.fn(async () => {
      getCalls += 1;
      if (args.stage1FlipAfterCalls !== undefined && getCalls >= args.stage1FlipAfterCalls) {
        return '2026-05-25T00:00:00Z';
      }
      return args.stage1At ?? null;
    }),
  };
  const onboardingChipSuggestionRepository = {
    findAllForHousehold: vi.fn().mockResolvedValue(args.rows),
  };
  const curatedBaselineRepository = {
    findAllActive: vi.fn().mockResolvedValue(args.curatedRows ?? []),
    findActiveByCuisineTags: vi.fn().mockResolvedValue(args.curatedRows ?? []),
  };
  const logger = makeLogger();
  const service = new CatalogProjectionService(
    {
      onboardingChipSuggestionRepository:
        onboardingChipSuggestionRepository as unknown as OnboardingChipSuggestionRepository,
      householdsRepository: householdsRepository as unknown as HouseholdsRepository,
      curatedBaselineRepository:
        curatedBaselineRepository as unknown as CuratedBaselineRepository,
      logger,
    },
    wait,
  );
  return {
    service,
    onboardingChipSuggestionRepository,
    householdsRepository,
    curatedBaselineRepository,
    logger,
    wait,
  };
}

describe('CatalogProjectionService.getM5Chips', () => {
  it('happy path: 20 rows → 20 returned, every chip carries provenance "inferred"', async () => {
    const rows: Row[] = [];
    for (let i = 0; i < 20; i++) {
      // Spread across enough cuisines that cap-3 doesn't bite.
      rows.push(makeRow(`bbb-${String(i).padStart(2, '0')}`, `Item ${i}`, [`cuisine_${i % 8}`]));
    }
    const { service, onboardingChipSuggestionRepository } = buildService({
      rows,
      stage1At: '2026-05-25T00:00:00Z',
    });
    const { chips, coldStartReason } = await service.getM5Chips(HOUSEHOLD_ID, []);
    expect(coldStartReason).toBeNull();
    expect(chips).toHaveLength(20);
    expect(chips.every((c) => c.provenance === 'inferred')).toBe(true);
    expect(onboardingChipSuggestionRepository.findAllForHousehold).toHaveBeenCalledTimes(1);
  });

  it('sort tie-breaker: same cuisine → ordered by id ASC', async () => {
    // 9 padding rows in the SAME cuisine, id-sorted strictly after the three
    // under test — cap-3 admits only the first three in id-ASC order
    // regardless of how many more exist in that bucket, so padding a
    // same-bucket is safe here (unlike padding a near-capacity multi-tag
    // interaction — see the multi-tag test below). Clears CHIP_FLOOR (12
    // total) without changing the cap-3 outcome.
    const rows = [
      makeRow('000-aaa', 'A', ['x']),
      makeRow('000-mmm', 'M', ['x']),
      makeRow('000-zzz', 'Z', ['x']),
      ...Array.from({ length: 9 }, (_, i) => makeRow(`999-pad${i}`, `Pad ${i}`, ['x'])),
    ];
    const { service } = buildService({ rows, stage1At: '2026-05-25T00:00:00Z' });
    const { chips } = await service.getM5Chips(HOUSEHOLD_ID, []);
    // Diversity cap-3 admits 3, which is < UNDERFLOW_THRESHOLD(12) and
    // triggers the (separate, pre-existing) relax-to-5 mechanic, pulling in
    // 2 more padding rows — so assert only the first three, which is what
    // this test is actually about: id-ASC order within a cuisine bucket, the
    // only remaining tie-break once favorite/provenance/confidence are gone.
    expect(chips.slice(0, 3).map((c) => c.key)).toEqual(['000-aaa', '000-mmm', '000-zzz']);
  });

  it('Stage 1 wait: stage1_completed_at = null then flips → polls and returns', async () => {
    const rows = Array.from({ length: 12 }, (_, i) => makeRow(`r-${i}`, `Item ${i}`, [`c${i}`]));
    const { service, householdsRepository } = buildService({
      rows,
      stage1FlipAfterCalls: 3, // null on calls 1+2, non-null on call 3
    });
    const { chips } = await service.getM5Chips(HOUSEHOLD_ID, []);
    expect(chips).toHaveLength(12);
    expect(householdsRepository.getStage1CompletedAt.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('Stage 1 timeout: never flips → logs catalog.m5.stage1_timeout and still returns', async () => {
    const rows = Array.from({ length: 12 }, (_, i) => makeRow(`r-${i}`, `Item ${i}`, [`c${i}`]));
    const { service, logger, wait } = buildService({ rows, stage1At: null });
    // Make wait advance "time" so the loop terminates without sleeping. After
    // ~21 waits the timeout fires (5000ms / 250ms = 20). To keep the test
    // fast, override wait to no-op AND patch Date.now via injected fn — but
    // the service uses Date.now() directly. The injected wait still runs;
    // the loop will iterate until Date.now() exceeds the budget. To
    // guarantee termination, we let the injected wait advance Date.now
    // via a closure-captured offset, mimicking real time without sleeping.
    let elapsed = 0;
    const realNow = Date.now;
    Date.now = vi.fn(() => realNow() + elapsed);
    wait.mockImplementation(async (ms: number) => {
      elapsed += ms;
    });

    // Pass an empty declared-cuisine list so timeout alone does NOT promote
    // to cold-start (per AC3: empty declared list + non-empty rows → normal).
    const { chips } = await service.getM5Chips(HOUSEHOLD_ID, []);
    Date.now = realNow;

    expect(chips).toHaveLength(12);
    const timeoutLog = logger.calls.find(
      (c) => c.payload['action'] === 'catalog.m5.stage1_timeout',
    );
    expect(timeoutLog).toBeDefined();
  });

  it('diversity cap-3 enforced: 6 items in one cuisine → 3 in output', async () => {
    // 12 rows, all cuisine 'anglo' — padding the SAME bucket beyond the cap is
    // safe (cap-3/cap-5 only ever admit up to the cap regardless of how many
    // more candidates exist in that bucket) and clears CHIP_FLOOR.
    const rows: Row[] = [];
    for (let i = 0; i < 12; i++) {
      rows.push(makeRow(`r-${i}`, `Item ${i}`, ['anglo']));
    }
    const { service } = buildService({ rows, stage1At: '2026-05-25T00:00:00Z' });
    const { chips } = await service.getM5Chips(HOUSEHOLD_ID, []);
    // cap-3 admits 3; 3 < UNDERFLOW_THRESHOLD(12) → relax to cap-5 admits 5.
    expect(chips).toHaveLength(5);
  });

  it('diversity relax-to-5: cap-3 underflows → relaxed walk logs catalog.m5.diversity_relaxed', async () => {
    const rows: Row[] = [];
    for (let i = 0; i < 12; i++) {
      rows.push(makeRow(`r-${i}`, `Item ${i}`, ['anglo']));
    }
    const { service, logger } = buildService({ rows, stage1At: '2026-05-25T00:00:00Z' });
    await service.getM5Chips(HOUSEHOLD_ID, []);
    const relaxLog = logger.calls.find(
      (c) => c.payload['action'] === 'catalog.m5.diversity_relaxed',
    );
    expect(relaxLog).toBeDefined();
    expect(relaxLog?.payload['after_step4']).toBe(3);
    expect(relaxLog?.payload['after_relax']).toBe(5);
  });

  it('below-threshold: final count < 12 → catalog.m5.below_threshold logged, partial result returned', async () => {
    // 12 distinct-cuisine rows (cap never bites — one per bucket) clears
    // CHIP_FLOOR while the DIVERSITY-CAP output still lands under
    // UNDERFLOW_THRESHOLD is impossible once raw count >= 12 with no repeats,
    // since every row is admitted — so below-threshold instead needs a raw
    // count >= CHIP_FLOOR whose ADMITTED count still falls under
    // UNDERFLOW_THRESHOLD: pad within one bucket so the cap, not the raw
    // count, is what limits the output.
    const rows = [
      ...Array.from({ length: 10 }, (_, i) => makeRow(`anglo-${i}`, `Item ${i}`, ['anglo'])),
      makeRow('x-1', 'X', ['x']),
      makeRow('y-1', 'Y', ['y']),
    ];
    const { service, logger } = buildService({ rows, stage1At: '2026-05-25T00:00:00Z' });
    const { chips } = await service.getM5Chips(HOUSEHOLD_ID, []);
    // cap-3: anglo=3, x=1, y=1 → 5. 5 < 12 → relax cap-5: anglo=5, x=1, y=1 → 7.
    expect(chips).toHaveLength(7);
    const belowLog = logger.calls.find(
      (c) => c.payload['action'] === 'catalog.m5.below_threshold',
    );
    expect(belowLog).toBeDefined();
    expect(belowLog?.payload['final_count']).toBe(7);
  });

  it('empty input: 0 rows, curated fallback also empty → chip_floor_underflow cold-start, chips=[]', async () => {
    // Slice 16-s1 — retargeted. An empty suggestion table used to be its own
    // "stage2_terminal" cold-start check; that's now fully subsumed by the
    // CHIP_FLOOR(12) check, which 0 always fails, triggering the AC 8
    // fallback — and with the curated repo ALSO empty here, the fallback
    // underflows too, landing on AC 9's cold-start path.
    const { service, logger, curatedBaselineRepository } = buildService({
      rows: [],
      stage1At: '2026-05-25T00:00:00Z',
    });
    const result = await service.getM5Chips(HOUSEHOLD_ID, []);
    expect(result.chips).toEqual([]);
    expect(result.coldStartReason).toBe('chip_floor_underflow');
    expect(curatedBaselineRepository.findAllActive).toHaveBeenCalledTimes(1);
    expect(
      logger.calls.some((c) => c.payload['action'] === 'catalog.m5.cold_start_triggered'),
    ).toBe(true);
  });

  it('multi-tag cuisine counts toward EVERY bucket (rejected when either bucket is full)', async () => {
    const rows: Row[] = [];
    // 3 rows in cuisine_a — fills bucket
    for (let i = 0; i < 3; i++) {
      rows.push(makeRow(`a-${i}`, `Aitem ${i}`, ['cuisine_a']));
    }
    // 3 rows in cuisine_b — fills second bucket
    for (let i = 0; i < 3; i++) {
      rows.push(makeRow(`b-${i}`, `Bitem ${i}`, ['cuisine_b']));
    }
    // 1 dual-tag row: should be rejected when either bucket is full
    rows.push(makeRow('dual', 'Dual item', ['cuisine_a', 'cuisine_b']));
    // 5 padding rows in a THIRD, non-overlapping cuisine — clears CHIP_FLOOR
    // without touching the cuisine_a/cuisine_b bucket math the dual-tag
    // interaction depends on (padding EITHER of those two buckets changes
    // whether `dual` gets admitted after the relax step — verified by hand).
    for (let i = 0; i < 5; i++) {
      rows.push(makeRow(`c-${i}`, `Citem ${i}`, ['cuisine_c']));
    }
    const { service } = buildService({ rows, stage1At: '2026-05-25T00:00:00Z' });
    const { chips } = await service.getM5Chips(HOUSEHOLD_ID, []);
    // Cap-3: 3 a + 3 b + dual rejected (both full) + 3 c (capped) = 9.
    // 9 < 12 → relax to cap-5: a=3 (room), b=3 (room) → dual admitted
    // (a=4, b=4) + 5 c (cap-5, all admitted) = 3+3+1+5 = 12.
    const relevant = chips.filter((c) => !c.key.startsWith('c-'));
    expect(relevant).toHaveLength(7);
    expect(chips.find((c) => c.key === 'dual')).toBeDefined();
  });

  it('never throws — repository error path returns { chips: [], coldStartReason: null }', async () => {
    const onboardingChipSuggestionRepository = {
      findAllForHousehold: vi.fn().mockRejectedValue(new Error('boom')),
    };
    const householdsRepository = {
      getStage1CompletedAt: vi.fn().mockResolvedValue('2026-05-25T00:00:00Z'),
    };
    const curatedBaselineRepository = {
      findAllActive: vi.fn().mockResolvedValue([]),
      findActiveByCuisineTags: vi.fn().mockResolvedValue([]),
    };
    const logger = makeLogger();
    const service = new CatalogProjectionService(
      {
        onboardingChipSuggestionRepository:
          onboardingChipSuggestionRepository as unknown as OnboardingChipSuggestionRepository,
        householdsRepository: householdsRepository as unknown as HouseholdsRepository,
        curatedBaselineRepository:
          curatedBaselineRepository as unknown as CuratedBaselineRepository,
        logger,
      },
      async () => undefined,
    );
    const result = await service.getM5Chips(HOUSEHOLD_ID, []);
    expect(result.chips).toEqual([]);
    expect(result.coldStartReason).toBeNull();
    expect(
      logger.calls.some((c) => c.payload['action'] === 'catalog.m5.projection_failed'),
    ).toBe(true);
  });

  it('stage1 poll DB error falls through to catalog read (patch F2)', async () => {
    // getStage1CompletedAt throws — waitForStage1 must catch and fall through
    // so the catalog read still runs and chips are returned. 12 rows across
    // distinct cuisines — at/above CHIP_FLOOR, so the AC 8 fallback does not
    // engage and this stays a pure test of the poll-error fallthrough.
    const rows = Array.from({ length: 12 }, (_, i) => makeRow(`r-${i}`, `Item ${i}`, [`c${i}`]));
    const onboardingChipSuggestionRepository = {
      findAllForHousehold: vi.fn().mockResolvedValue(rows),
    };
    const householdsRepository = {
      getStage1CompletedAt: vi.fn().mockRejectedValue(new Error('db-poll-error')),
    };
    const curatedBaselineRepository = {
      findAllActive: vi.fn().mockResolvedValue([]),
      findActiveByCuisineTags: vi.fn().mockResolvedValue([]),
    };
    const logger = makeLogger();
    const service = new CatalogProjectionService(
      {
        onboardingChipSuggestionRepository:
          onboardingChipSuggestionRepository as unknown as OnboardingChipSuggestionRepository,
        householdsRepository: householdsRepository as unknown as HouseholdsRepository,
        curatedBaselineRepository:
          curatedBaselineRepository as unknown as CuratedBaselineRepository,
        logger,
      },
      async () => undefined,
    );
    const { chips } = await service.getM5Chips(HOUSEHOLD_ID, []);
    // Catalog read must still run despite poll failure.
    expect(chips).toHaveLength(12);
    expect(curatedBaselineRepository.findAllActive).not.toHaveBeenCalled();
    expect(
      logger.calls.some((c) => c.payload['action'] === 'catalog.m5.stage1_poll_error'),
    ).toBe(true);
  });
});

// ===========================================================================
// Slice 16-s1 (AC 8, AC 9) — curated-50 fallback, read-only.
// ===========================================================================
describe('CatalogProjectionService.getM5Chips — curated-baseline fallback (16-s1 AC 8, 9)', () => {
  it('falls back to curated_baseline_items when suggestion rows are below CHIP_FLOOR (12)', async () => {
    const rows = [makeRow('s-1', 'Suggestion One', ['south_asian'])]; // 1 < 12
    const curatedRows = Array.from({ length: 15 }, (_, i) =>
      makeCuratedRow(`cb-${i}`, `Curated ${i}`, [`cuisine_${i % 8}`]),
    );
    const { service, curatedBaselineRepository } = buildService({
      rows,
      stage1At: '2026-05-25T00:00:00Z',
      curatedRows,
    });

    const { chips, coldStartReason } = await service.getM5Chips(HOUSEHOLD_ID, []);

    expect(coldStartReason).toBeNull();
    expect(chips.length).toBeGreaterThan(0);
    // Fallback REPLACES the thin suggestion set — decision 2's "used only to
    // populate chips when generation yields too few" is a direct source
    // swap, not a blend. The one real suggestion does not appear.
    expect(chips.find((c) => c.key === 's-1')).toBeUndefined();
    expect(chips.every((c) => c.label.startsWith('Curated'))).toBe(true);
    expect(curatedBaselineRepository.findAllActive).toHaveBeenCalledTimes(1);
  });

  it('does NOT fall back when suggestion rows already meet CHIP_FLOOR', async () => {
    const rows = Array.from({ length: 12 }, (_, i) => makeRow(`s-${i}`, `Suggestion ${i}`, [`c${i}`]));
    const { service, curatedBaselineRepository } = buildService({
      rows,
      stage1At: '2026-05-25T00:00:00Z',
      curatedRows: [makeCuratedRow('cb-1', 'Should Not Appear', ['x'])],
    });

    const { chips } = await service.getM5Chips(HOUSEHOLD_ID, []);

    expect(chips.every((c) => c.label.startsWith('Suggestion'))).toBe(true);
    expect(curatedBaselineRepository.findAllActive).not.toHaveBeenCalled();
    expect(curatedBaselineRepository.findActiveByCuisineTags).not.toHaveBeenCalled();
  });

  it('applies allergen + dietary filtering to fallback rows too', async () => {
    const rows: Row[] = [];
    // 11 safe padding rows so the post-filter survivor count (12: 1 named
    // "Safe Dish" + 11 padding) still clears CHIP_FLOOR — otherwise this
    // test's own fallback would underflow ITS OWN floor and short-circuit to
    // cold-start before the allergen assertion below is ever reached.
    const curatedRows = [
      { ...makeCuratedRow('cb-1', 'Peanut Dish', ['x']), allergen_flags: ['peanut'] },
      makeCuratedRow('cb-2', 'Safe Dish', ['x']),
      ...Array.from({ length: 11 }, (_, i) => makeCuratedRow(`cb-pad-${i}`, `Pad ${i}`, ['y'])),
    ];
    const { service } = buildService({
      rows,
      stage1At: '2026-05-25T00:00:00Z',
      curatedRows,
    });

    const { chips } = await service.getM5Chips(HOUSEHOLD_ID, [], ['peanut']);

    expect(chips.find((c) => c.label === 'Peanut Dish')).toBeUndefined();
    expect(chips.find((c) => c.label === 'Safe Dish')).toBeDefined();
  });

  it('uses findActiveByCuisineTags when a declared cuisine is known, findAllActive otherwise', async () => {
    const { service, curatedBaselineRepository } = buildService({
      rows: [],
      stage1At: '2026-05-25T00:00:00Z',
      curatedRows: [],
    });

    await service.getM5Chips(HOUSEHOLD_ID, ['south_asian']);

    expect(curatedBaselineRepository.findActiveByCuisineTags).toHaveBeenCalledWith([
      'south_asian',
    ]);
    expect(curatedBaselineRepository.findAllActive).not.toHaveBeenCalled();
  });

  it('AC 9 — fallback ALSO underflows CHIP_FLOOR after filtering → cold-start, not a sparse grid', async () => {
    const rows = [makeRow('s-1', 'Suggestion One', ['south_asian'])];
    // Only 3 curated rows survive (< 12) — a household whose declared
    // allergens exclude most of the curated 50.
    const curatedRows = Array.from({ length: 3 }, (_, i) =>
      makeCuratedRow(`cb-${i}`, `Curated ${i}`, ['x']),
    );
    const { service } = buildService({
      rows,
      stage1At: '2026-05-25T00:00:00Z',
      curatedRows,
    });

    const result = await service.getM5Chips(HOUSEHOLD_ID, []);

    // Never a blank grid via a sparse partial result — a real cold-start
    // reason instead, so the caller routes to the conversational fallback.
    expect(result.chips).toEqual([]);
    expect(result.coldStartReason).not.toBeNull();
  });

  it('fallback rows carry provenance "inferred", same as generated suggestions', async () => {
    const curatedRows = Array.from({ length: 15 }, (_, i) =>
      makeCuratedRow(`cb-${i}`, `Curated ${i}`, [`cuisine_${i % 8}`]),
    );
    const { service } = buildService({
      rows: [],
      stage1At: '2026-05-25T00:00:00Z',
      curatedRows,
    });

    const { chips } = await service.getM5Chips(HOUSEHOLD_ID, []);

    expect(chips.length).toBeGreaterThan(0);
    expect(chips.every((c) => c.provenance === 'inferred')).toBe(true);
  });
});

// ===========================================================================
// Cold-start fallback — only stage2_terminal (empty catalog after filter)
// ===========================================================================
//
// The per-cuisine floor check was removed: cultural_priors stores both
// broad cultural keys (south_asian) and sub-cuisine/dietary keys (south_indian,
// halal). Sub-cuisines have < 5 baseline items and dietary keys have 0
// cuisine_tag matches — both triggered spurious cold-starts. Cold-start now
// fires only when the personalized catalog has 0 rows (stage2_terminal).

describe('CatalogProjectionService.getM5Chips — cold-start fallback (Slice 2.6-s6)', () => {
  it('no cold-start when a declared cuisine has < 5 items but catalog is non-empty', async () => {
    const rows: Row[] = [];
    // 22 English rows
    for (let i = 0; i < 22; i++) {
      rows.push(makeRow(`en-${i}`, `English ${i}`, ['english']));
    }
    // Only 2 Tibetan rows — previously triggered per_cuisine_floor; now chips show
    rows.push(makeRow('tb-1', 'Tibetan 1', ['tibetan']));
    rows.push(makeRow('tb-2', 'Tibetan 2', ['tibetan']));

    const { service } = buildService({ rows, stage1At: '2026-05-25T00:00:00Z' });
    const result = await service.getM5Chips(HOUSEHOLD_ID, ['english', 'tibetan']);

    expect(result.coldStartReason).toBeNull();
    expect(result.chips.length).toBeGreaterThan(0);
  });

  it('per_cuisine_floor does NOT fire when all declared cuisines meet the floor', async () => {
    const rows: Row[] = [];
    for (let i = 0; i < 10; i++) {
      rows.push(makeRow(`en-${i}`, `English ${i}`, ['english']));
    }
    for (let i = 0; i < 6; i++) {
      rows.push(makeRow(`sa-${i}`, `South Asian ${i}`, ['south_asian']));
    }
    const { service } = buildService({ rows, stage1At: '2026-05-25T00:00:00Z' });
    const result = await service.getM5Chips(HOUSEHOLD_ID, ['english', 'south_asian']);

    expect(result.coldStartReason).toBeNull();
    expect(result.chips.length).toBeGreaterThan(0);
  });

  it('stage1 timeout + sparse cuisine → chips still returned (no cold-start)', async () => {
    // Previously: timeout + per-cuisine below floor → stage1_timeout cold-start.
    // Now: per-cuisine floor removed; chips show whenever catalog is non-empty.
    // 12 Tibetan rows (>= CHIP_FLOOR) so the AC 8 fallback doesn't engage —
    // this test is specifically about the per-cuisine floor, not CHIP_FLOOR.
    const rows: Row[] = Array.from({ length: 12 }, (_, i) =>
      makeRow(`tb-${i}`, `Tibetan ${i}`, ['tibetan']),
    );
    const { service, wait } = buildService({ rows, stage1At: null });
    let elapsed = 0;
    const realNow = Date.now;
    Date.now = vi.fn(() => realNow() + elapsed);
    wait.mockImplementation(async (ms: number) => {
      elapsed += ms;
    });

    const result = await service.getM5Chips(HOUSEHOLD_ID, ['tibetan']);
    Date.now = realNow;

    expect(result.coldStartReason).toBeNull();
    expect(result.chips.length).toBeGreaterThan(0);
  });

  it('chip_floor_underflow triggers when total catalog and fallback are both empty (rows=[])', async () => {
    // Retargeted (16-s1) — see the "empty input" retarget note above.
    const { service, wait, curatedBaselineRepository } = buildService({
      rows: [],
      stage1At: null,
    });
    let elapsed = 0;
    const realNow = Date.now;
    Date.now = vi.fn(() => realNow() + elapsed);
    wait.mockImplementation(async (ms: number) => {
      elapsed += ms;
    });

    const result = await service.getM5Chips(HOUSEHOLD_ID, ['tibetan']);
    Date.now = realNow;

    expect(result.coldStartReason).toBe('chip_floor_underflow');
    expect(result.chips).toEqual([]);
    expect(curatedBaselineRepository.findActiveByCuisineTags).toHaveBeenCalledWith(['tibetan']);
  });

  it('no cold-start when declaredCuisineTags is empty AND catalog is healthy', async () => {
    const rows: Row[] = [];
    for (let i = 0; i < 15; i++) {
      rows.push(makeRow(`en-${i}`, `English ${i}`, ['english']));
    }
    const { service } = buildService({ rows, stage1At: '2026-05-25T00:00:00Z' });
    const result = await service.getM5Chips(HOUSEHOLD_ID, []);
    expect(result.coldStartReason).toBeNull();
    expect(result.chips.length).toBeGreaterThan(0);
  });

  it('no cold-start when declaredCuisineTags is empty and stage1 times out but catalog has rows', async () => {
    const rows: Row[] = [];
    for (let i = 0; i < 15; i++) {
      rows.push(makeRow(`en-${i}`, `English ${i}`, ['english']));
    }
    const { service, wait } = buildService({ rows, stage1At: null });
    let elapsed = 0;
    const realNow = Date.now;
    Date.now = vi.fn(() => realNow() + elapsed);
    wait.mockImplementation(async (ms: number) => {
      elapsed += ms;
    });

    const result = await service.getM5Chips(HOUSEHOLD_ID, []);
    Date.now = realNow;

    // Timeout alone + non-empty catalog + no declared priors → return chips,
    // no cold-start (parent skipped M3; best-effort chip card is correct).
    expect(result.coldStartReason).toBeNull();
    expect(result.chips.length).toBeGreaterThan(0);
  });

  it('default declaredCuisineTags parameter is treated as empty', async () => {
    // Calls that pre-date this slice (no second arg) must keep working: an
    // omitted declaredCuisineTags defaults to [] → per-cuisine check skipped.
    // 12 rows (>= CHIP_FLOOR) so this stays a pure test of the default-param
    // behavior, not the AC 8 fallback.
    const rows = Array.from({ length: 12 }, (_, i) => makeRow(`r-${i}`, `Item ${i}`, [`c${i}`]));
    const { service } = buildService({ rows, stage1At: '2026-05-25T00:00:00Z' });
    const result = await service.getM5Chips(HOUSEHOLD_ID);
    expect(result.coldStartReason).toBeNull();
  });
});

// ===========================================================================
// Slice 16-s1 (AC 4) — negative control: recipes are no longer the source.
// ===========================================================================

describe('CatalogProjectionService.getM5Chips — chip source moved off recipes (16-s1 AC 4)', () => {
  it('never reads recipes/household_recipe_usage; a household with marker recipes rows sees only generated suggestions', async () => {
    // The service no longer takes a recipesRepository dependency at all — the
    // negative control here is structural: the deps interface has no path to
    // `recipes`, so a marker row planted there literally cannot leak into the
    // suggestion-sourced chip set. Proven by asserting the only source called
    // is onboardingChipSuggestionRepository, and its rows are exactly what's
    // returned.
    // 12 rows (>= CHIP_FLOOR, distinct cuisines) so the AC 8 fallback doesn't
    // engage — this test is about the source, not the floor.
    const rows = Array.from({ length: 12 }, (_, i) =>
      makeRow(`sugg-${i}`, `Generated Idli ${i}`, [`c${i}`]),
    );
    const { service, onboardingChipSuggestionRepository, curatedBaselineRepository } =
      buildService({
        rows,
        stage1At: '2026-05-25T00:00:00Z',
      });
    const { chips } = await service.getM5Chips(HOUSEHOLD_ID, []);
    expect(chips.every((c) => c.label.startsWith('Generated Idli'))).toBe(true);
    expect(chips).toHaveLength(12);
    expect(onboardingChipSuggestionRepository.findAllForHousehold).toHaveBeenCalledWith(
      HOUSEHOLD_ID,
    );
    expect(curatedBaselineRepository.findAllActive).not.toHaveBeenCalled();
  });
});
