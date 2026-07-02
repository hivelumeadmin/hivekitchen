import type { FastifyBaseLogger } from 'fastify';
import type { Redis } from 'ioredis';
import type { RecipeDiscoverInput, RecipePreview } from '@hivekitchen/types';
import type { AuditService } from '../../audit/audit.service.js';
import type { RecipeService } from '../../modules/recipe/recipe.service.js';
import type { RecipeAgent } from '../recipe-agent.js';
import type { PlannerContext, PlannerRecipeCandidate } from './context/assemble.js';

// Story 3.5-s5 — minimum distinct Main candidates the deterministic pre-flight
// must see before it stops acquiring. The no-consecutive-Main rule (v2.6.0)
// needs at least 2 distinct Mains so a multi-day week can alternate (M1/M2). A
// single candidate forces a repeat every day, making the constraint unmeetable.
export const MIN_MAIN_CANDIDATES = 2;

// Overfetch a few extra previews so duplicate-id filtering still leaves enough
// to clear the floor. Bounded by RecipeSearchInputSchema.max_results (20).
const SEARCH_MAX_RESULTS = 8;

// recipe.search / discover previews carry no confidence_score (that lives only
// on catalog usage rows). Acquired candidates get a neutral default so the
// <recipe_candidates> block renders a value without implying a real signal.
const ACQUIRED_CANDIDATE_CONFIDENCE = 50;

export interface CoverageDeps {
  recipeService: RecipeService;
  recipeAgent: RecipeAgent | null;
  redis: Redis;
  auditService: AuditService;
  requestId: string;
  householdId: string;
  logger: FastifyBaseLogger;
}

// Story 3.5-s5 — deterministic recipe pre-flight. Replaces the model-driven
// recipe.search/recipe.discover tool calls that the old ReAct loop made: when
// the pre-assembled slate already covers the plan, this is a no-op; otherwise
// it acquires candidates by calling RecipeService directly (NOT via the LLM)
// and returns a slate-augmented context. It never writes to the DB, never
// mutates the input ctx, and is best-effort — if acquisition can't meet the
// floor, it logs and returns the best-available slate (the commit-time allergy
// guardrail catches anything unsafe regardless of how candidates were sourced).
export async function ensureCandidateCoverage(
  ctx: PlannerContext,
  deps: CoverageDeps,
): Promise<PlannerContext> {
  const currentMains = ctx.recipeCandidates?.main ?? [];
  const currentExtras = ctx.recipeCandidates?.extra ?? [];

  const mainOk = currentMains.length >= MIN_MAIN_CANDIDATES;
  // Extras are optional: only "required" when at least one child has Extra
  // rules (pins/bans) in scope. A bag with no Extra slot needs no candidate.
  const extraNeeded = ctx.extraRules !== undefined && ctx.extraRules.length > 0;
  const extraOk = !extraNeeded || currentExtras.length >= 1;

  if (mainOk && extraOk) return ctx;

  const query = deriveSearchQuery(ctx, !extraOk);

  const seenIds = new Set<string>([
    ...currentMains.map((c) => c.id),
    ...currentExtras.map((c) => c.id),
  ]);
  const newMains: PlannerRecipeCandidate[] = [];
  const newExtras: PlannerRecipeCandidate[] = [];

  // 1. Deterministic catalog search.
  const searchOut = await deps.recipeService.search({
    query,
    household_id: deps.householdId,
    max_results: SEARCH_MAX_RESULTS,
  });
  for (const preview of searchOut.results) {
    if (seenIds.has(preview.id)) continue;
    seenIds.add(preview.id);
    const candidate = previewToCandidate(preview);
    // Dynamic: once the Main floor is met mid-loop, surplus results fill the Extra gap.
    if (currentMains.length + newMains.length < MIN_MAIN_CANDIDATES) newMains.push(candidate);
    else if (!extraOk) newExtras.push(candidate);
  }

  // 2. Web discover (Main only) when search didn't clear the floor and an
  //    agent is wired. Routed through RecipeService.discover so candidates are
  //    cached to Redis under the run's plan_build_id — plan commit resolves
  //    them via readCandidate exactly as the old discover tool did.
  const mainsShortAfterSearch =
    currentMains.length + newMains.length < MIN_MAIN_CANDIDATES;
  if (mainsShortAfterSearch && deps.recipeAgent !== null) {
    deps.logger.info(
      { requestId: deps.requestId, householdId: deps.householdId, query },
      'ensureCandidateCoverage: invoking recipe discover for cold slate',
    );
    const discoverInput: RecipeDiscoverInput = {
      household_id: deps.householdId,
      plan_build_id: deps.requestId,
      slot: 'main',
      count: MIN_MAIN_CANDIDATES,
      intent: query,
      constraints: {
        cuisine_tags: [],
        cultural_tags: ctx.culturalContext
          ? [...ctx.culturalContext.culturalTemplates].slice(0, 20)
          : [],
        dietary_flags: [],
        allergen_exclusions: collectAllergenExclusions(ctx),
        max_prep_minutes: null,
      },
    };
    const discoverOut = await deps.recipeService.discover(discoverInput, {
      recipeAgent: deps.recipeAgent,
      redis: deps.redis,
      audit: deps.auditService,
      requestId: deps.requestId,
    });
    for (const preview of discoverOut.results) {
      if (seenIds.has(preview.id)) continue;
      seenIds.add(preview.id);
      newMains.push(previewToCandidate(preview));
    }
  }

  // 3. Acquired nothing → return the input untouched. This preserves the
  //    undefined-slate (cold name-based compose) path AND the existing handle
  //    map, so a no-result acquisition never alters the plan.
  if (newMains.length === 0 && newExtras.length === 0) {
    deps.logger.warn(
      { requestId: deps.requestId, householdId: deps.householdId },
      'ensureCandidateCoverage: coverage insufficient and acquisition returned nothing — composing with best-available slate',
    );
    return ctx;
  }

  const finalMains = [...currentMains, ...newMains];
  if (finalMains.length < MIN_MAIN_CANDIDATES) {
    deps.logger.warn(
      { requestId: deps.requestId, householdId: deps.householdId, mainCount: finalMains.length },
      'ensureCandidateCoverage: Main floor still unmet after acquisition — composing with best-available slate',
    );
  }

  return {
    ...ctx,
    recipeCandidates: {
      main: finalMains,
      snack: ctx.recipeCandidates?.snack ?? [],
      extra: [...currentExtras, ...newExtras],
    },
  };
}

// Derive a deterministic search query from the planning context. The model used
// to choose this; now it's a fixed heuristic — the goal is "surface some
// relevant recipes so compose can proceed", not a perfect retrieval (the model
// still selects, the guardrail still gates).
function deriveSearchQuery(ctx: PlannerContext, needsExtra: boolean): string {
  const parts: string[] = [];
  const template = ctx.culturalContext?.culturalTemplates[0];
  if (template) parts.push(template.replace(/_/g, ' '));
  parts.push('family-friendly lunch main dish');
  if (needsExtra) parts.push('and extra side dish');
  return parts.join(' ');
}

// Household-wide ∪ per-child declared allergens, fed to discover as negative
// constraints. Best-effort (the guardrail is the real safety gate); capped at
// the schema's 20-item ceiling.
function collectAllergenExclusions(ctx: PlannerContext): string[] {
  const map = ctx.kitchenMap;
  if (map === undefined) return [];
  const set = new Set<string>();
  for (const a of map.household.declared_allergens) set.add(a);
  for (const child of map.children) {
    for (const a of child.declared_allergens) set.add(a);
  }
  return [...set].slice(0, 20);
}

// recipe.search / discover return RecipePreview (no confidence_score, only a
// primary_ingredient_key). Map onto the planner's candidate shape — mirrors the
// loader's toCandidate where the fields overlap; confidence + key_ingredients
// are derived from what a preview carries.
function previewToCandidate(preview: RecipePreview): PlannerRecipeCandidate {
  return {
    id: preview.id,
    name: preview.name,
    cuisine_tags: preview.cuisine_tags,
    allergen_flags: preview.allergen_flags,
    key_ingredients:
      preview.primary_ingredient_key !== null ? [preview.primary_ingredient_key] : [],
    confidence: ACQUIRED_CANDIDATE_CONFIDENCE,
  };
}
