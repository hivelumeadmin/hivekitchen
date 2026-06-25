import { describe, it, expect, vi } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import type { Redis } from 'ioredis';
import type { RecipePreview } from '@hivekitchen/types';
import type { AuditService } from '../../audit/audit.service.js';
import type { RecipeService } from '../../modules/recipe/recipe.service.js';
import type { RecipeAgent } from '../recipe-agent.js';
import { ensureCandidateCoverage, MIN_MAIN_CANDIDATES } from './coverage.js';
import type { CoverageDeps } from './coverage.js';
import type {
  PlannerContext,
  PlannerExtraRules,
  PlannerRecipeCandidate,
} from './context/assemble.js';

// ===========================================================================
// Story 3.5-s5 — ensureCandidateCoverage unit tests. Mocks at the dependency
// boundary (RecipeService.search / .discover); no real services.
// ===========================================================================

const HH = '11111111-1111-4111-8111-111111111111';
const REQ = 'req-coverage';

function pc(partial: Partial<PlannerContext>): PlannerContext {
  return {
    kitchenMap: undefined,
    culturalContext: undefined,
    bagCompositions: undefined,
    extraRules: undefined,
    extraLibraryItems: undefined,
    extraProposals: undefined,
    sovereigntyMode: undefined,
    variantEligibleChildren: undefined,
    childSignals: undefined,
    pantrySnapshot: undefined,
    recipeCandidates: undefined,
    ...partial,
  };
}

function candidate(id: string, name: string): PlannerRecipeCandidate {
  return {
    id,
    name,
    cuisine_tags: [],
    allergen_flags: [],
    key_ingredients: [],
    confidence: 80,
  };
}

function preview(id: string, name: string): RecipePreview {
  return {
    id,
    name,
    primary_ingredient_key: 'chicken',
    cuisine_tags: ['anglo'],
    allergen_flags: [],
    dietary_flags: [],
    prep_time_minutes: 10,
  };
}

const EXTRA_RULES: readonly PlannerExtraRules[] = [
  { child_id: 'c1', child_name: 'Aarav', pins: ['fruit'], bans: [] },
];

interface BuiltDeps {
  deps: CoverageDeps;
  search: ReturnType<typeof vi.fn>;
  discover: ReturnType<typeof vi.fn>;
}

function buildDeps(opts: {
  searchResults?: RecipePreview[];
  discoverResults?: RecipePreview[];
  withAgent?: boolean;
}): BuiltDeps {
  const search = vi.fn().mockResolvedValue({ results: opts.searchResults ?? [] });
  const discover = vi.fn().mockResolvedValue({ results: opts.discoverResults ?? [] });

  const recipeService = { search, discover } as unknown as RecipeService;
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as FastifyBaseLogger;

  const deps: CoverageDeps = {
    recipeService,
    recipeAgent: opts.withAgent ? ({} as RecipeAgent) : null,
    redis: {} as Redis,
    auditService: {} as AuditService,
    requestId: REQ,
    householdId: HH,
    logger,
  };
  return { deps, search, discover };
}

describe('ensureCandidateCoverage', () => {
  it('returns the input ctx unchanged on a warm slate (>= 2 mains, no extra gap)', async () => {
    const ctx = pc({
      recipeCandidates: {
        main: [candidate('m-1', 'Pinwheel'), candidate('m-2', 'Quesadilla')],
        snack: [],
        extra: [],
      },
    });
    const { deps, search, discover } = buildDeps({ withAgent: true });

    const result = await ensureCandidateCoverage(ctx, deps);

    expect(result).toBe(ctx);
    expect(search).not.toHaveBeenCalled();
    expect(discover).not.toHaveBeenCalled();
  });

  it('augments mains via search when below the floor; does not reach discover when search suffices', async () => {
    const ctx = pc({
      recipeCandidates: { main: [candidate('m-1', 'Pinwheel')], snack: [], extra: [] },
    });
    const { deps, search, discover } = buildDeps({
      searchResults: [preview('s-1', 'Veggie Wrap')],
      withAgent: true,
    });

    const result = await ensureCandidateCoverage(ctx, deps);

    expect(search).toHaveBeenCalledTimes(1);
    expect(discover).not.toHaveBeenCalled();
    expect(result.recipeCandidates?.main).toHaveLength(MIN_MAIN_CANDIDATES);
    expect(result.recipeCandidates?.main.map((c) => c.id)).toContain('s-1');
  });

  it('calls both search and discover on an empty slate, returning best-available (no throw)', async () => {
    const ctx = pc({ recipeCandidates: { main: [], snack: [], extra: [] } });
    const { deps, search, discover } = buildDeps({
      searchResults: [preview('s-1', 'Wrap')],
      discoverResults: [], // discover finds nothing → still short, best-available
      withAgent: true,
    });

    const result = await ensureCandidateCoverage(ctx, deps);

    expect(search).toHaveBeenCalledTimes(1);
    expect(discover).toHaveBeenCalledTimes(1);
    // best-available: the one search hit, even though still below the floor.
    expect(result.recipeCandidates?.main).toHaveLength(1);
  });

  it('runs only search (never discover) and does not throw when recipeAgent is null', async () => {
    const ctx = pc({ recipeCandidates: { main: [], snack: [], extra: [] } });
    const { deps, search, discover } = buildDeps({
      searchResults: [preview('s-1', 'Wrap')],
      withAgent: false,
    });

    const result = await ensureCandidateCoverage(ctx, deps);

    expect(search).toHaveBeenCalledTimes(1);
    expect(discover).not.toHaveBeenCalled();
    expect(result.recipeCandidates?.main).toHaveLength(1);
  });

  it('augments extras with an extras-inclusive query when extra rules exist but no extra candidate', async () => {
    const ctx = pc({
      recipeCandidates: {
        main: [candidate('m-1', 'Pinwheel'), candidate('m-2', 'Quesadilla')],
        snack: [],
        extra: [],
      },
      extraRules: EXTRA_RULES,
    });
    const { deps, search, discover } = buildDeps({
      searchResults: [preview('x-1', 'Fruit Cup')],
      withAgent: true,
    });

    const result = await ensureCandidateCoverage(ctx, deps);

    expect(search).toHaveBeenCalledTimes(1);
    const searchArg = search.mock.calls[0][0] as { query: string };
    expect(searchArg.query).toContain('extra side dish');
    expect(result.recipeCandidates?.extra.map((c) => c.id)).toContain('x-1');
    // mains were already sufficient → discover never invoked.
    expect(discover).not.toHaveBeenCalled();
  });

  it('fills only the extra gap and leaves sufficient mains untouched', async () => {
    const mains = [candidate('m-1', 'Pinwheel'), candidate('m-2', 'Quesadilla')];
    const ctx = pc({
      recipeCandidates: { main: mains, snack: [], extra: [] },
      extraRules: EXTRA_RULES,
    });
    const { deps, search } = buildDeps({
      searchResults: [preview('x-1', 'Fruit Cup')],
      withAgent: true,
    });

    const result = await ensureCandidateCoverage(ctx, deps);

    expect(search).toHaveBeenCalledTimes(1);
    expect(result.recipeCandidates?.main).toEqual(mains);
    expect(result.recipeCandidates?.extra).toHaveLength(1);
  });
});
