import { describe, it, expect, vi } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import type { HouseholdsRepository } from '../households/households.repository.js';
import type { OnboardingChipSuggestionRepository } from './onboarding-chip-suggestion.repository.js';
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

interface BuildArgs {
  rows: Row[];
  stage1At?: string | null;
  // When non-null after `pollFlipAt` calls, getStage1CompletedAt resolves.
  stage1FlipAfterCalls?: number;
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
  const logger = makeLogger();
  const service = new CatalogProjectionService(
    {
      onboardingChipSuggestionRepository:
        onboardingChipSuggestionRepository as unknown as OnboardingChipSuggestionRepository,
      householdsRepository: householdsRepository as unknown as HouseholdsRepository,
      logger,
    },
    wait,
  );
  return { service, onboardingChipSuggestionRepository, householdsRepository, logger, wait };
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
    const rows = [makeRow('zzz', 'Z', ['x']), makeRow('aaa', 'A', ['x']), makeRow('mmm', 'M', ['x'])];
    const { service } = buildService({ rows, stage1At: '2026-05-25T00:00:00Z' });
    const { chips } = await service.getM5Chips(HOUSEHOLD_ID, []);
    // Diversity cap-3 on cuisine 'x' admits all three; order is id-ASC, the
    // only remaining tie-break once favorite/provenance/confidence are gone.
    expect(chips.map((c) => c.key)).toEqual(['aaa', 'mmm', 'zzz']);
  });

  it('Stage 1 wait: stage1_completed_at = null then flips → polls and returns', async () => {
    const rows = [makeRow('r-1', 'A', ['x'])];
    const { service, householdsRepository } = buildService({
      rows,
      stage1FlipAfterCalls: 3, // null on calls 1+2, non-null on call 3
    });
    const { chips } = await service.getM5Chips(HOUSEHOLD_ID, []);
    expect(chips).toHaveLength(1);
    expect(householdsRepository.getStage1CompletedAt.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('Stage 1 timeout: never flips → logs catalog.m5.stage1_timeout and still returns', async () => {
    const rows = [makeRow('r-1', 'A', ['x'])];
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

    expect(chips).toHaveLength(1);
    const timeoutLog = logger.calls.find(
      (c) => c.payload['action'] === 'catalog.m5.stage1_timeout',
    );
    expect(timeoutLog).toBeDefined();
  });

  it('diversity cap-3 enforced: 6 items in one cuisine → 3 in output', async () => {
    const rows: Row[] = [];
    for (let i = 0; i < 6; i++) {
      rows.push(makeRow(`r-${i}`, `Item ${i}`, ['anglo']));
    }
    const { service } = buildService({ rows, stage1At: '2026-05-25T00:00:00Z' });
    const { chips } = await service.getM5Chips(HOUSEHOLD_ID, []);
    // With only 6 same-cuisine inputs, cap-3 admits 3; underflow relaxes to 5.
    // Final = 5 (under threshold 12 → below_threshold logged).
    expect(chips).toHaveLength(5);
  });

  it('diversity relax-to-5: cap-3 underflows → relaxed walk logs catalog.m5.diversity_relaxed', async () => {
    const rows: Row[] = [];
    for (let i = 0; i < 6; i++) {
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
    const rows = [makeRow('r-1', 'A', ['x']), makeRow('r-2', 'B', ['y'])];
    const { service, logger } = buildService({ rows, stage1At: '2026-05-25T00:00:00Z' });
    const { chips } = await service.getM5Chips(HOUSEHOLD_ID, []);
    expect(chips).toHaveLength(2);
    const belowLog = logger.calls.find(
      (c) => c.payload['action'] === 'catalog.m5.below_threshold',
    );
    expect(belowLog).toBeDefined();
    expect(belowLog?.payload['final_count']).toBe(2);
  });

  it('empty input: 0 rows → stage2_terminal cold-start, chips=[]', async () => {
    const { service, logger } = buildService({ rows: [], stage1At: '2026-05-25T00:00:00Z' });
    const result = await service.getM5Chips(HOUSEHOLD_ID, []);
    expect(result.chips).toEqual([]);
    expect(result.coldStartReason).toBe('stage2_terminal');
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
    const { service } = buildService({ rows, stage1At: '2026-05-25T00:00:00Z' });
    const { chips } = await service.getM5Chips(HOUSEHOLD_ID, []);
    // Cap-3: 6 items + dual rejected = 6 final → relax-to-5 → admits dual now? Let's trace:
    //   cap=3 walk: take 3 a-* (a=3), 3 b-* (b=3) → dual rejected (both buckets full). Result = 6.
    //   6 < 12 → relax to cap=5: a=3 (room for 2 more), b=3 (room for 2 more) → dual admitted (a=4, b=4). Result = 7.
    expect(chips).toHaveLength(7);
    expect(chips.find((c) => c.key === 'dual')).toBeDefined();
  });

  it('never throws — repository error path returns { chips: [], coldStartReason: null }', async () => {
    const onboardingChipSuggestionRepository = {
      findAllForHousehold: vi.fn().mockRejectedValue(new Error('boom')),
    };
    const householdsRepository = {
      getStage1CompletedAt: vi.fn().mockResolvedValue('2026-05-25T00:00:00Z'),
    };
    const logger = makeLogger();
    const service = new CatalogProjectionService(
      {
        onboardingChipSuggestionRepository:
          onboardingChipSuggestionRepository as unknown as OnboardingChipSuggestionRepository,
        householdsRepository: householdsRepository as unknown as HouseholdsRepository,
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
    // so the catalog read still runs and chips are returned.
    const rows = [makeRow('r-1', 'A', ['x'])];
    const onboardingChipSuggestionRepository = {
      findAllForHousehold: vi.fn().mockResolvedValue(rows),
    };
    const householdsRepository = {
      getStage1CompletedAt: vi.fn().mockRejectedValue(new Error('db-poll-error')),
    };
    const logger = makeLogger();
    const service = new CatalogProjectionService(
      {
        onboardingChipSuggestionRepository:
          onboardingChipSuggestionRepository as unknown as OnboardingChipSuggestionRepository,
        householdsRepository: householdsRepository as unknown as HouseholdsRepository,
        logger,
      },
      async () => undefined,
    );
    const { chips } = await service.getM5Chips(HOUSEHOLD_ID, []);
    // Catalog read must still run despite poll failure.
    expect(chips).toHaveLength(1);
    expect(
      logger.calls.some((c) => c.payload['action'] === 'catalog.m5.stage1_poll_error'),
    ).toBe(true);
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
    const rows: Row[] = [makeRow('tb-1', 'Tibetan 1', ['tibetan']), makeRow('tb-2', 'Tibetan 2', ['tibetan'])];
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

  it('stage2_terminal triggers when total catalog is empty (rows=[])', async () => {
    const { service, wait } = buildService({ rows: [], stage1At: null });
    let elapsed = 0;
    const realNow = Date.now;
    Date.now = vi.fn(() => realNow() + elapsed);
    wait.mockImplementation(async (ms: number) => {
      elapsed += ms;
    });

    const result = await service.getM5Chips(HOUSEHOLD_ID, ['tibetan']);
    Date.now = realNow;

    expect(result.coldStartReason).toBe('stage2_terminal');
    expect(result.chips).toEqual([]);
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
    const rows = [makeRow('r-1', 'A', ['english'])];
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
    const rows = [makeRow('sugg-1', 'Generated Idli', ['south_asian'])];
    const { service, onboardingChipSuggestionRepository } = buildService({
      rows,
      stage1At: '2026-05-25T00:00:00Z',
    });
    const { chips } = await service.getM5Chips(HOUSEHOLD_ID, []);
    expect(chips.map((c) => c.label)).toEqual(['Generated Idli']);
    expect(onboardingChipSuggestionRepository.findAllForHousehold).toHaveBeenCalledWith(
      HOUSEHOLD_ID,
    );
  });
});
