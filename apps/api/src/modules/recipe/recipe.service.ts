import { createHash } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import type { Redis } from 'ioredis';
import type {
  RecipeAgentExtraction,
  RecipeDiscoverInput,
  RecipeDiscoverOutput,
  RecipeFetchInput,
  RecipeFetchOutput,
  RecipePreview,
  RecipeSearchInput,
  RecipeSearchOutput,
} from '@hivekitchen/types';
import { RecipeAgentExtractionSchema } from '@hivekitchen/contracts';
import { NotFoundError } from '../../common/errors.js';
import type { RecipeAgent } from '../../agents/recipe-agent.js';
import type { AuditService } from '../../audit/audit.service.js';
import type {
  HouseholdUsageScore,
  RecipePreviewRow,
  RecipesRepository,
} from './recipes.repository.js';

// Story 3-31 — Redis keys for the discover candidate cache.
const CANDIDATE_TTL_SECONDS = 30 * 60;
const candidateKey = (planBuildId: string, candidateId: string): string =>
  `lumi:plan-build:${planBuildId}:recipe-candidate:${candidateId}`;
const candidateGroupKey = (planBuildId: string, groupHash: string): string =>
  `lumi:plan-build:${planBuildId}:recipe-candidate-group:${groupHash}`;

export interface RecipeServiceDiscoverDeps {
  readonly recipeAgent: RecipeAgent;
  readonly redis: Redis;
  readonly audit: AuditService;
  readonly requestId: string;
}

// ===========================================================================
// Slice D — Recipe catalog service
// ===========================================================================
// Two-faced service:
//
//  1. AGENT READ PATH (slice D.2):
//     `search()` and `fetch()` back the planner agent's recipe.search /
//     recipe.fetch tools. Search reranks repository previews by the
//     household's own use_count + favourite/banned flags so the agent
//     sees what *this* household has actually liked first, falling back
//     to community signal otherwise.
//
//  2. SERVER WRITE PATH (slice D.1):
//     `materializeFromPlanItem()` creates (or reuses) a recipes row at
//     plan-commit time so plan_slots.recipe_id and plan_main_assignments.recipe_id
//     always point at a real recipe. `recordUse()` upserts household_recipe_usage
//     so the kitchen map's favourite-recipes projection has signal to rank by.
//
// Both paths require a RecipesRepository. The orchestrator + plans hook
// each construct RecipeService with the repository wired in.
// ===========================================================================

const NAME_WORDS_KEPT = 3; // first N words of an ingredient string kept for the canonical_name fragment

// Slice D.2 — search overfetches by 3x to give the household-usage rerank
// room to bubble favourites up past name-match ordering from postgres.
const SEARCH_OVERFETCH_MULTIPLIER = 3;

export class RecipeService {
  /** When the repository is undefined, only the legacy stub methods work.
   *  Plan-commit callers must provide the repository. */
  private readonly repository: RecipesRepository | null;
  private readonly logger: FastifyBaseLogger | null;

  constructor(
    repository?: RecipesRepository,
    logger?: FastifyBaseLogger,
  ) {
    this.repository = repository ?? null;
    this.logger = logger ?? null;
  }

  // ---- Agent read path (slice D.2) ---------------------------------------

  /**
   * Slice D.2 — planner agent's recipe.search tool.
   *
   * Pipeline:
   *   1. Repository returns up to `max_results * SEARCH_OVERFETCH_MULTIPLIER`
   *      visible, active candidates (household-owned or shared) matching the
   *      free-text query.
   *   2. Service fetches per-household usage scores for those candidates.
   *   3. Service drops banned recipes, then ranks:
   *        favourite (true > false) >
   *        household use_count desc >
   *        community_use_count desc >
   *        canonical_name asc
   *   4. Slice to `max_results` and shape to the agent-facing preview.
   *
   * Returns `{ results: [] }` when nothing matches — never throws on empty.
   */
  async search(input: RecipeSearchInput): Promise<RecipeSearchOutput> {
    const repo = this.requireRepository('search');

    const overfetchLimit = input.max_results * SEARCH_OVERFETCH_MULTIPLIER;
    const previews = await repo.searchByHousehold({
      householdId: input.household_id,
      query: input.query,
      overfetchLimit,
    });
    if (previews.length === 0) {
      return { results: [] };
    }

    const scoresList = await repo.findUsageScores(
      input.household_id,
      previews.map((p) => p.id),
    );
    const scoreById = new Map<string, HouseholdUsageScore>(
      scoresList.map((s) => [s.recipe_id, s]),
    );

    const ranked = previews
      .filter((p) => !scoreById.get(p.id)?.is_household_banned)
      .sort((a, b) => comparePreviewsForRanking(a, b, scoreById))
      .slice(0, input.max_results);

    return {
      results: ranked.map((row) => ({
        id: row.id,
        name: row.canonical_name,
        primary_ingredient_key: row.primary_ingredient_key,
        cuisine_tags: row.cuisine_tags,
        allergen_flags: row.allergen_flags,
        dietary_flags: row.dietary_flags,
        prep_time_minutes: row.prep_time_minutes,
      })),
    };
  }

  /**
   * Slice D.2 — planner agent's recipe.fetch tool. Returns the canonical
   * catalog row when the recipe is visible to the household (owned or
   * shared) and active; throws NotFoundError otherwise. The two
   * "missing" cases (truly absent vs. another household's private row)
   * collapse to one error on purpose so we don't leak existence of
   * other households' recipes.
   */
  async fetch(input: RecipeFetchInput): Promise<RecipeFetchOutput> {
    const repo = this.requireRepository('fetch');

    const row = await repo.findByIdForHousehold(
      input.recipe_id,
      input.household_id,
    );
    if (row === null) {
      throw new NotFoundError(`recipe ${input.recipe_id}`);
    }
    // Repository row shape mirrors RecipeRowSchema. Cast through the
    // contract type — RecipeFetchOutputSchema validation happens at the
    // tool boundary in recipe.tools.ts, not here, so we don't pay the
    // zod-parse cost twice on the hot path.
    return row as unknown as RecipeFetchOutput;
  }

  async findIdByName(name: string, householdId: string): Promise<string | null> {
    const repo = this.requireRepository('findIdByName');
    return repo.findIdByNameForHousehold(name, householdId);
  }

  // ---- Story 3-31 — agent-discover read path -----------------------------

  /**
   * Discover N candidate recipes from the public web for the planner.
   *
   * Pipeline:
   *   1. Hash (slot, constraints, intent) into a group key. Look up Redis
   *      under lumi:plan-build:{planBuildId}:recipe-candidate-group:{hash}.
   *      A hit means the planner already called discover with this exact
   *      shape during the current planWeek run — reuse the cached IDs.
   *   2. On miss, invoke RecipeAgent.discover which calls Tavily + LLM.
   *      Write each extraction to Redis at the per-candidate key with
   *      a 30-minute TTL. Write the group key listing the candidate IDs.
   *   3. Emit ONE recipe.agent_fetch audit event per Tavily call (not
   *      one per candidate). Payload is allowlisted — no intent text,
   *      no constraint contents, no PII.
   *   4. Return previews to the planner.
   *
   * Plan commit reads candidates back via {@link readCandidate} and inserts
   * a real recipes row.
   */
  async discover(
    input: RecipeDiscoverInput,
    deps: RecipeServiceDiscoverDeps,
  ): Promise<RecipeDiscoverOutput> {
    const groupHash = hashDiscoverGroup(input);
    const groupKey = candidateGroupKey(input.plan_build_id, groupHash);

    // Cache hit path — same shape within the same plan-build session.
    const cached = await deps.redis.get(groupKey);
    if (cached !== null) {
      const cachedIds = parseCandidateIdList(cached);
      const previews: RecipePreview[] = [];
      for (const id of cachedIds) {
        const payload = await deps.redis.get(candidateKey(input.plan_build_id, id));
        if (payload === null) continue;
        try {
          // F-P2: validate shape from Redis — a stale/corrupt entry should be
          // treated as a miss for this candidate, not a crash at commit time.
          const parsed: unknown = JSON.parse(payload);
          const schemaResult = RecipeAgentExtractionSchema.safeParse(parsed);
          if (!schemaResult.success) {
            this.logger?.debug(
              {
                module: 'recipes',
                action: 'discover.cache_schema_mismatch',
                household_id: input.household_id,
                candidate_id: id,
              },
              'cached candidate failed schema validation — skipping',
            );
            continue;
          }
          previews.push(previewFromCachedExtraction(id, schemaResult.data));
        } catch {
          this.logger?.debug(
            {
              module: 'recipes',
              action: 'discover.cache_parse_failed',
              household_id: input.household_id,
              candidate_id: id,
            },
            'cached candidate payload failed JSON.parse',
          );
        }
      }
      if (previews.length > 0) {
        this.logger?.debug(
          {
            module: 'recipes',
            action: 'discover.cache_hit',
            household_id: input.household_id,
            plan_build_id: input.plan_build_id,
            count: previews.length,
          },
          'recipe.discover served from cache',
        );
        return { results: previews };
      }
      // F-P3: all per-candidate keys evicted while group key survived. Delete
      // the stale group key so the next call triggers a fresh Tavily fetch
      // rather than looping on the same stale group key indefinitely.
      try {
        await deps.redis.del(groupKey);
      } catch {
        // Non-fatal — worst case the stale key expires naturally.
      }
    }

    // Cache miss — call the agent. Time the call for audit + observability.
    const startedAt = Date.now();
    const result = await deps.recipeAgent.discover(input);
    const durationMs = Date.now() - startedAt;

    // Write each candidate payload concurrently (Redis ops are independent).
    // F-P1: derive candidateIds from result.candidates AFTER Promise.all so
    // the group key always encodes the same order as the agent returned.
    // F-P6: wrap each write individually so a single Redis failure doesn't
    // crash the whole discover call — the affected candidate simply won't
    // be resolvable at commit time (cache-miss fallback handles it).
    await Promise.all(
      result.candidates.map(async (c) => {
        try {
          await deps.redis.set(
            candidateKey(input.plan_build_id, c.candidateId),
            JSON.stringify(c.extraction),
            'EX',
            CANDIDATE_TTL_SECONDS,
          );
        } catch {
          this.logger?.warn(
            { module: 'recipes', action: 'discover.redis_candidate_write_failed', candidate_id: c.candidateId },
            'failed to cache discover candidate; commit will fall back to materializeFromPlanItem',
          );
        }
      }),
    );
    // Group key written after per-candidate writes so a partial cache
    // (group missing, some candidates present) is treated as a miss.
    const candidateIds = result.candidates.map((c) => c.candidateId);
    try {
      await deps.redis.set(
        groupKey,
        JSON.stringify(candidateIds),
        'EX',
        CANDIDATE_TTL_SECONDS,
      );
    } catch {
      this.logger?.warn(
        { module: 'recipes', action: 'discover.redis_group_write_failed' },
        'failed to cache discover group key; next discover call will re-invoke Tavily',
      );
    }

    // Audit event — allowlisted shape. No intent, no constraint contents.
    // count_requested vs count_returned reveals when Tavily / parse drops
    // shrunk the batch.
    await deps.audit.write({
      event_type: 'recipe.agent_fetch',
      household_id: input.household_id,
      request_id: deps.requestId,
      metadata: {
        slot: input.slot,
        count_requested: input.count,
        count_returned: result.candidates.length,
        dropped_count: result.droppedCount,
        source_sites: result.sourceSites,
        duration_ms: durationMs,
      },
    });

    return {
      results: result.candidates.map((c) => c.preview),
    };
  }

  /**
   * Read a previously-cached candidate extraction from Redis. Used by the
   * plan-commit candidate resolver. Returns null on cache miss (TTL
   * expiry, eviction, or a candidate_id that was never written).
   */
  async readCandidate(
    planBuildId: string,
    candidateId: string,
    redis: Redis,
  ): Promise<RecipeAgentExtraction | null> {
    const raw = await redis.get(candidateKey(planBuildId, candidateId));
    if (raw === null) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      // F-P2: validate shape — a stale schema (e.g. from a previous deploy) or
      // a corrupted entry returns null so the commit falls back gracefully.
      const result = RecipeAgentExtractionSchema.safeParse(parsed);
      return result.success ? result.data : null;
    } catch {
      return null;
    }
  }

  /**
   * Story 3-31 — at plan commit, insert a discover-sourced extraction as a
   * real recipes row. Maps the agent's extraction shape onto the
   * RecipesRepository.insertRecipe input shape, derives ingredient_keys
   * from the (already head-noun-disciplined) ingredients, and returns the
   * new recipe id.
   *
   * Idempotency: if the household already has a recipes row with the same
   * canonical_name, reuse it (mirrors materializeFromPlanItem's idempotency
   * guarantee — repeated discover of the same dish doesn't duplicate rows).
   */
  async insertFromDiscoverExtraction(input: {
    householdId: string;
    extraction: RecipeAgentExtraction;
  }): Promise<string> {
    const repo = this.requireRepository('insertFromDiscoverExtraction');
    const canonicalName = input.extraction.name;

    // Idempotency check — same household + same canonical_name → reuse.
    const existing = await repo.findByHouseholdAndName(
      input.householdId,
      canonicalName,
    );
    if (existing !== null) {
      return existing.id;
    }

    const ingredientKeys = deduplicate(
      input.extraction.ingredients.map((i) => i.key),
    );
    const primaryIngredientKey = ingredientKeys[0] ?? null;

    const inserted = await repo.insertRecipe({
      canonical_name: canonicalName,
      ingredients: input.extraction.ingredients.map((i) => ({
        key: i.key,
        modifier: i.modifier,
        display: i.display,
        quantity: i.quantity,
        unit: i.unit,
        optional: i.optional,
        substitutes: i.substitutes,
      })),
      // Story 3-DM-A1: persist structured steps (mode-tagged for the Wall
      // Card's Prep / Finish toggle). The RecipeAgent prompt produces
      // functional-imperative text and the activity-mode tag per step.
      steps: input.extraction.steps,
      ingredient_keys: ingredientKeys,
      primary_ingredient_key: primaryIngredientKey,
      // Tag arrays already filtered through VocabularyService.filterActive
      // by RecipeAgent's post-pass — every value here is a live vocabulary
      // row. No re-validation needed at insert time.
      allergen_flags: input.extraction.allergen_flags,
      dietary_flags: input.extraction.dietary_flags,
      cultural_tags: input.extraction.cultural_tags,
      cuisine_tags: input.extraction.cuisine_tags,
      applicable_slots: ['main'],
      prep_time_minutes: input.extraction.prep_time_minutes,
      finish_time_minutes: input.extraction.finish_time_minutes ?? null,
      source: 'agent_generated',
      created_by_household_id: input.householdId,
      visibility: 'private',
    });

    this.logger?.debug(
      {
        module: 'recipes',
        action: 'recipe.materialized_from_discover',
        household_id: input.householdId,
        recipe_id: inserted.id,
        source_url: input.extraction.source_url,
        source_site: input.extraction.source_site,
      },
      'recipe materialized from discover candidate',
    );

    return inserted.id;
  }

  private requireRepository(method: string): RecipesRepository {
    if (this.repository === null) {
      throw new Error(
        `RecipeService.${method} requires a RecipesRepository — caller constructed ` +
          'RecipeService without one. Wire the repository in orchestrator.hook / plans.hook.',
      );
    }
    return this.repository;
  }

  // ---- Server write path (slice D) ---------------------------------------

  /**
   * Slice D — at plan-commit time, given an agent-emitted plan item's
   * free-text ingredients, ensure a recipes row exists for this household
   * and return its id. Idempotent by case-insensitive canonical_name.
   *
   * Returns null when materialization is intentionally skipped:
   *   - slot !== 'main': only main slots auto-materialize from free-text
   *     ingredients here; snack + extra slots already carry a recipe_id
   *     pointing at the curated catalog (folded from snack_skus in 3-DM-A2)
   *   - ingredients array is empty
   *
   * Returns the recipe id (existing or freshly inserted) otherwise. Plan
   * commit attaches this id to plan_main_assignments.recipe_id.
   *
   * Naming heuristic (deterministic, no LLM):
   *   - one ingredient  → "Chickpea curry"
   *   - two ingredients → "Chicken thigh with rice"
   *   - three+         → first ingredient + " with " + second
   * The agent doesn't emit names today (slice D.2 will add a `name` field
   * to PlanComposeItem); until then this heuristic produces serviceable
   * labels. Future-better names are an upgrade path, not a correctness gap.
   */
  async materializeFromPlanItem(input: {
    householdId: string;
    ingredients: string[];
    slot: 'main' | 'snack' | 'extra';
  }): Promise<{ recipeId: string; wasExisting: boolean } | null> {
    const repo = this.requireRepository('materializeFromPlanItem');

    // Only main-slot items auto-materialize a recipe from free-text
    // ingredients. Snack + extra slots resolve through the curated recipes
    // catalog (folded from snack_skus in Story 3-DM-A2) and already carry a
    // recipe_id by the time PlansService.commit runs.
    if (input.slot !== 'main') return null;
    if (input.ingredients.length === 0) return null;

    const canonical_name = deriveCanonicalName(input.ingredients);

    // Idempotency: same household + same case-insensitive name → reuse.
    // This means a household that has lemon-garlic chicken on Tuesday AND
    // Friday gets one recipe row, two household_recipe_usage hits.
    const existing = await repo.findByHouseholdAndName(
      input.householdId,
      canonical_name,
    );
    if (existing !== null) {
      return { recipeId: existing.id, wasExisting: true };
    }

    const ingredient_keys = deduplicate(input.ingredients.map(toIngredientKey));
    const primary_ingredient_key = ingredient_keys[0] ?? null;
    const structured = input.ingredients.map((display, i) => ({
      key: ingredient_keys[i] ?? `ingredient_${String(i)}`,
      modifier: null,
      display,
      quantity: null,
      unit: null,
      optional: false,
      substitutes: [],
    }));

    const inserted = await repo.insertRecipe({
      canonical_name,
      ingredients: structured,
      ingredient_keys,
      primary_ingredient_key,
      // Slice D — these flags are left empty for v1. The allergy guardrail
      // already runs per-item at commit time on the free-text ingredients;
      // it doesn't depend on recipe-level pre-computation. Backfilling
      // proper allergen/dietary/cultural/cuisine tags is slice D.2 work,
      // when the planner agent emits structured tags directly.
      allergen_flags: [],
      dietary_flags: [],
      cultural_tags: [],
      cuisine_tags: [],
      applicable_slots: ['main'],
      prep_time_minutes: null,
      source: 'agent_generated',
      created_by_household_id: input.householdId,
      visibility: 'private',
    });

    this.logger?.debug(
      {
        module: 'recipes',
        action: 'recipe.materialized',
        household_id: input.householdId,
        recipe_id: inserted.id,
        canonical_name,
      },
      'recipe materialized from plan item',
    );

    return { recipeId: inserted.id, wasExisting: false };
  }

  /**
   * Slice D — record one use of a recipe by a household. Triggers an
   * atomic INSERT(use_count=1) or UPDATE(use_count++) on
   * household_recipe_usage. Idempotent: safe to call multiple times in
   * the same plan commit if the same recipe appears for multiple
   * (child, day) combinations.
   */
  async recordUse(input: { householdId: string; recipeId: string }): Promise<void> {
    const repo = this.requireRepository('recordUse');
    await repo.upsertUsageIncrement(input.householdId, input.recipeId);
  }
}

/**
 * Slice D.2 search-result comparator. Returns negative when `a` should rank
 * before `b`. Tie-break order:
 *   favourite first → household use_count desc → community_use_count desc → name asc
 */
function comparePreviewsForRanking(
  a: RecipePreviewRow,
  b: RecipePreviewRow,
  scoreById: ReadonlyMap<string, HouseholdUsageScore>,
): number {
  const aScore = scoreById.get(a.id);
  const bScore = scoreById.get(b.id);

  // 1. Favourites surface above everything else from the same household.
  const aFav = aScore?.is_household_favorite === true ? 1 : 0;
  const bFav = bScore?.is_household_favorite === true ? 1 : 0;
  if (aFav !== bFav) return bFav - aFav;

  // 2. Household use_count — what we've actually liked enough to repeat.
  const aUse = aScore?.use_count ?? 0;
  const bUse = bScore?.use_count ?? 0;
  if (aUse !== bUse) return bUse - aUse;

  // 3. Community signal — what other households are repeating, for cold-start.
  if (a.community_use_count !== b.community_use_count) {
    return b.community_use_count - a.community_use_count;
  }

  // 4. Stable tie-break — deterministic ordering for test snapshots / paging.
  return a.canonical_name.localeCompare(b.canonical_name);
}

// ---------------------------------------------------------------------------
// Helpers — exported for tests
// ---------------------------------------------------------------------------

/**
 * Derive a recipe canonical_name from free-text ingredients. Deterministic;
 * same input → same output → idempotent across plan commits.
 *
 *   ["chicken thigh", "rice", "lemon zest"]  → "Chicken thigh with rice"
 *   ["chickpea curry"]                       → "Chickpea curry"
 *   []                                       → "Untitled dish" (caller-guarded;
 *                                                shouldn't reach here)
 */
export function deriveCanonicalName(ingredients: readonly string[]): string {
  if (ingredients.length === 0) return 'Untitled dish';
  const first = cleanIngredientPhrase(ingredients[0] ?? '');
  if (ingredients.length === 1) return capitaliseFirst(first || 'Untitled dish');
  const second = cleanIngredientPhrase(ingredients[1] ?? '');
  if (second.length === 0) return capitaliseFirst(first || 'Untitled dish');
  return capitaliseFirst(`${first} with ${second}`);
}

/**
 * Slugify a free-text ingredient string into a vocabulary key. Best-effort —
 * the agent emits unstructured strings today, so we lossy-compress to a
 * lowercase snake_case form. Slice D.2 will have the agent emit canonical
 * keys directly via the new structured ingredient shape.
 *
 *   "Chicken thigh, sliced" → "chicken_thigh_sliced"
 *   "1/2 cup rice"          → "cup_rice" (strips numbers + punctuation)
 *   "Salt to taste"         → "salt_to_taste"
 */
export function toIngredientKey(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/[0-9/]+/g, ' ') // strip quantities like "1/2"
    .replace(/[^a-z\s]+/g, ' ') // strip everything except letters + whitespace
    .trim()
    .replace(/\s+/g, '_');
  return cleaned.length > 0 ? cleaned : 'unknown';
}

/** Strips quantities and parenthetical content, keeps the first N words. */
function cleanIngredientPhrase(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\([^)]*\)/g, '') // drop parenthetical content
    .replace(/[0-9/]+\s*(cup|cups|tbsp|tsp|oz|g|ml|kg|lb|pound|pinch|dash|slice|slices|piece|pieces|can|cans|package)?s?\b/gi, ' ') // drop quantity + unit
    .replace(/[,.;].*$/, '') // drop everything after first comma/period/semi (preparation notes)
    .replace(/\s+/g, ' ')
    .trim()
    .split(/\s+/)
    .slice(0, NAME_WORDS_KEPT)
    .join(' ');
}

function capitaliseFirst(s: string): string {
  if (s.length === 0) return s;
  return s.charAt(0).toLocaleUpperCase() + s.slice(1);
}

function deduplicate<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

// ---------------------------------------------------------------------------
// Story 3-31 — discover helpers (exported for tests)
// ---------------------------------------------------------------------------

/**
 * Stable hash of the discover input fields that determine cache identity:
 * slot, constraints (sorted), and intent. Household + plan_build_id are
 * carried in the Redis key, not in the hash. Two structurally-identical
 * discover calls in the same planWeek run produce the same hash and reuse
 * the same candidates.
 */
export function hashDiscoverGroup(input: RecipeDiscoverInput): string {
  const canonical = JSON.stringify({
    slot: input.slot,
    intent: input.intent.trim().toLowerCase(),
    constraints: {
      cuisine_tags: [...input.constraints.cuisine_tags].sort(),
      cultural_tags: [...input.constraints.cultural_tags].sort(),
      dietary_flags: [...input.constraints.dietary_flags].sort(),
      allergen_exclusions: [...input.constraints.allergen_exclusions].sort(),
      max_prep_minutes: input.constraints.max_prep_minutes,
    },
  });
  return createHash('sha256').update(canonical).digest('hex').slice(0, 32);
}

function parseCandidateIdList(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === 'string');
  } catch {
    return [];
  }
}

function previewFromCachedExtraction(
  candidateId: string,
  extraction: RecipeAgentExtraction,
): RecipePreview {
  return {
    id: candidateId,
    name: extraction.name,
    primary_ingredient_key: extraction.ingredients[0]?.key ?? null,
    cuisine_tags: extraction.cuisine_tags,
    allergen_flags: extraction.allergen_flags,
    dietary_flags: extraction.dietary_flags,
    prep_time_minutes: extraction.prep_time_minutes,
  };
}

