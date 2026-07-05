import type { FastifyBaseLogger } from 'fastify';
import type { ChipOption } from '@hivekitchen/contracts';
import type { CatalogProvenance } from '@hivekitchen/types';
import type { HouseholdsRepository } from '../households/households.repository.js';
import type { RecipesRepository } from '../recipe/recipes.repository.js';

// Slice 2.6-s4 / 2.6-s6 — projects the per-household catalog (recipes +
// household_recipe_usage) into a deterministic, diversity-shaped chip set for
// the Moment 5 starting-line chip card.
//
// 2.6-s6: getM5Chips now returns `M5ChipResult` ({ chips, coldStartReason }).
// When any declared cuisine bucket falls below PER_CUISINE_FLOOR_THRESHOLD,
// Stage 1 times out with a depleted catalog, or the catalog is empty after
// Stage 2 recovery, the caller is told to render the conversational fallback
// instead of a sparse/stereotyped chip card.
//
// Single entry point: getM5Chips(householdId, declaredCuisineTags?). Pipeline:
//   1. Wait up to 5s for Stage 1 (households.stage1_completed_at NOT NULL).
//   2. SELECT joined catalog rows (banned filtered at SQL).
//   3. Sort in TS: favorites first, then provenance priority, then confidence,
//      then id ASC (deterministic tie-breaker).
//   4. Diversity cap (max 3 per cuisine_tag); if accumulator < 12, re-walk
//      with cap 5; below-threshold log fires if final < 12.
//   5. Project to ChipOption[] with key=recipe_id (UUID), label=canonical_name.
//   6. Per-cuisine floor check (post-step-2 raw rows) — fires cold-start.
//
// NEVER throws — every error path returns { chips: [], coldStartReason: null }.

const POLL_INTERVAL_MS = 250;
const POLL_TIMEOUT_MS = 5_000;
const TARGET_CHIPS = 20;
const UNDERFLOW_THRESHOLD = 12;
const DIVERSITY_CAP_PRIMARY = 3;
const DIVERSITY_CAP_RELAXED = 5;

export type ColdStartReason =
  | 'per_cuisine_floor'
  | 'stage1_timeout'
  | 'stage2_terminal';

export interface M5ChipResult {
  chips: ChipOption[];
  coldStartReason: ColdStartReason | null;
}

export interface CatalogProjectionServiceDeps {
  recipesRepository: RecipesRepository;
  householdsRepository: HouseholdsRepository;
  logger: FastifyBaseLogger;
}

/**
 * Provenance priority weight — higher = surface earlier. Matches brief §4 AC4.
 *   declared      = 4  (parent stated it)
 *   parent_added  = 3  (parent added in-app post-onboarding)
 *   inferred      = 2  (Stage 1 LLM seed)
 *   plan_promoted = 1  (planner promoted it)
 */
function provenancePriority(p: CatalogProvenance): number {
  switch (p) {
    case 'declared':
      return 4;
    case 'parent_added':
      return 3;
    case 'inferred':
      return 2;
    case 'plan_promoted':
      return 1;
    default:
      return 0;
  }
}

interface CatalogRow {
  id: string;
  canonical_name: string;
  cuisine_tags: string[];
  cultural_tags: string[];
  allergen_flags: string[];
  dietary_flags: string[];
  catalog_provenance: CatalogProvenance;
  confidence_score: number;
  is_household_favorite: boolean;
}

export class CatalogProjectionService {
  private readonly recipesRepository: RecipesRepository;
  private readonly householdsRepository: HouseholdsRepository;
  private readonly logger: FastifyBaseLogger;
  // Test seam — Vitest fake timers don't intercept setTimeout when called
  // inside service code without a configurable wait fn. Injectable so unit
  // tests can resolve the poll instantly.
  private readonly wait: (ms: number) => Promise<void>;

  constructor(
    deps: CatalogProjectionServiceDeps,
    wait?: (ms: number) => Promise<void>,
  ) {
    this.recipesRepository = deps.recipesRepository;
    this.householdsRepository = deps.householdsRepository;
    this.logger = deps.logger;
    this.wait =
      wait ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async isStage1Complete(householdId: string): Promise<boolean> {
    try {
      const at = await this.householdsRepository.getStage1CompletedAt(householdId);
      return at !== null;
    } catch {
      return false;
    }
  }

  async getM5Chips(
    householdId: string,
    declaredCuisineTags: string[] = [],
    allergenFilter: string[] = [],
    requiredDietaryFlags: string[] = [],
  ): Promise<M5ChipResult> {
    try {
      // Step 1 — Stage 1 wait (polling).
      await this.waitForStage1(householdId);

      // Step 2 — single read.
      const allRows: CatalogRow[] =
        await this.recipesRepository.findCatalogProjectionForHousehold(householdId);

      // Step 2b — personalization filter: exclude allergen conflicts and
      // recipes that don't satisfy non-negotiable dietary requirements.
      const rows = this.filterByPersonalization(allRows, allergenFilter, requiredDietaryFlags);

      // Step 3 (early gate) — cold-start only when catalog is truly empty.
      // The per-cuisine floor check was removed: cultural_priors stores both
      // broad cultural keys (south_asian) and sub-cuisine keys (south_indian,
      // halal) from cuisine.declare. Sub-cuisines have < 5 baseline items and
      // dietary/religious keys have 0 cuisine_tag matches — both triggered
      // spurious cold-starts with 50 perfectly usable chips in the catalog.
      const coldStartReason = this.deriveColdStartReason(rows);
      if (coldStartReason !== null) {
        this.logger.info(
          {
            module: 'catalog',
            action: 'catalog.m5.cold_start_triggered',
            household_id: householdId,
            cold_start_reason: coldStartReason,
            declared_cuisine_count: declaredCuisineTags.length,
            total_catalog_rows: rows.length,
          },
          'M5 cold-start triggered',
        );
        return { chips: [], coldStartReason };
      }

      // Step 4 — stable sort: declared-cuisine matches first, then favorites,
      // then provenance priority, then confidence, then id.
      const sorted = this.sortCandidates(rows, declaredCuisineTags);

      // Step 4 — diversity cap (3 per cuisine_tag).
      let picked = this.pickWithDiversityCap(sorted, DIVERSITY_CAP_PRIMARY);

      // Step 5 — underflow relax to 5 per cuisine_tag.
      if (picked.length < UNDERFLOW_THRESHOLD) {
        const relaxed = this.pickWithDiversityCap(sorted, DIVERSITY_CAP_RELAXED);
        this.logger.info(
          {
            module: 'catalog',
            action: 'catalog.m5.diversity_relaxed',
            household_id: householdId,
            after_step4: picked.length,
            after_relax: relaxed.length,
          },
          'M5 chip projection relaxed diversity cap to 5',
        );
        picked = relaxed;
      }

      // Step 6 — below-threshold log.
      if (picked.length < UNDERFLOW_THRESHOLD) {
        this.logger.info(
          {
            module: 'catalog',
            action: 'catalog.m5.below_threshold',
            household_id: householdId,
            final_count: picked.length,
          },
          'M5 chip projection final count below threshold',
        );
      }

      // Step 7 — project to ChipOption[].
      const chips: ChipOption[] = picked.map((r) => ({
        key: r.id,
        label: r.canonical_name,
        provenance: r.catalog_provenance,
      }));
      return { chips, coldStartReason: null };
    } catch (err) {
      // Defensive: a query failure must not surface to the caller. Return
      // the cold-start-safe empty result so the onboarding service can
      // continue to the conversational fallback path.
      this.logger.warn(
        {
          err,
          module: 'catalog',
          action: 'catalog.m5.projection_failed',
          household_id: householdId,
        },
        'M5 chip projection failed — returning empty result',
      );
      return { chips: [], coldStartReason: null };
    }
  }

  private async waitForStage1(
    householdId: string,
  ): Promise<{ timedOut: boolean }> {
    try {
      const start = Date.now();
      let stage1At = await this.householdsRepository.getStage1CompletedAt(householdId);
      while (stage1At === null && Date.now() - start < POLL_TIMEOUT_MS) {
        await this.wait(POLL_INTERVAL_MS);
        stage1At = await this.householdsRepository.getStage1CompletedAt(householdId);
      }
      if (stage1At === null) {
        this.logger.info(
          {
            module: 'catalog',
            action: 'catalog.m5.stage1_timeout',
            household_id: householdId,
          },
          'M5 chip projection: Stage 1 timeout — falling through with current catalog',
        );
        return { timedOut: true };
      }
      return { timedOut: false };
    } catch (err) {
      // DB error during poll — fall through to catalog read with whatever rows exist,
      // same behaviour as the timeout path. Do not re-throw.
      this.logger.warn(
        {
          err,
          module: 'catalog',
          action: 'catalog.m5.stage1_poll_error',
          household_id: householdId,
        },
        'M5 chip projection: Stage 1 poll error — falling through with current catalog',
      );
      return { timedOut: true };
    }
  }

  /**
   * Cold-start only when the personalized catalog has 0 rows. Shows chips
   * whenever anything exists, even if a declared sub-cuisine has few matches.
   */
  private deriveColdStartReason(
    rows: ReadonlyArray<CatalogRow>,
  ): ColdStartReason | null {
    return rows.length === 0 ? 'stage2_terminal' : null;
  }

  private filterByPersonalization(
    rows: ReadonlyArray<CatalogRow>,
    allergenFilter: ReadonlyArray<string>,
    requiredDietaryFlags: ReadonlyArray<string>,
  ): CatalogRow[] {
    if (allergenFilter.length === 0 && requiredDietaryFlags.length === 0) return [...rows];
    return rows.filter((row) => {
      if (allergenFilter.some((a) => row.allergen_flags.includes(a))) return false;
      if (requiredDietaryFlags.some((d) => !row.dietary_flags.includes(d))) return false;
      return true;
    });
  }

  private sortCandidates(
    rows: ReadonlyArray<CatalogRow>,
    declaredCuisineTags: ReadonlyArray<string> = [],
  ): CatalogRow[] {
    const hasDeclared = declaredCuisineTags.length > 0;
    return [...rows].sort((a, b) => {
      if (hasDeclared) {
        const aMatch = a.cuisine_tags.some((t) => declaredCuisineTags.includes(t)) ? 1 : 0;
        const bMatch = b.cuisine_tags.some((t) => declaredCuisineTags.includes(t)) ? 1 : 0;
        if (aMatch !== bMatch) return bMatch - aMatch;
      }
      if (a.is_household_favorite !== b.is_household_favorite) {
        return a.is_household_favorite ? -1 : 1;
      }
      const pa = provenancePriority(a.catalog_provenance);
      const pb = provenancePriority(b.catalog_provenance);
      if (pa !== pb) return pb - pa;
      if (a.confidence_score !== b.confidence_score) {
        return b.confidence_score - a.confidence_score;
      }
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
  }

  /**
   * Walk the pre-sorted candidate list; admit each row only if every one of
   * its cuisine_tags is still below `cap` in the accumulator. A multi-tag
   * row counts toward every bucket it touches; rejection is "ANY full → skip."
   * Stops at TARGET_CHIPS items or input exhaustion.
   */
  private pickWithDiversityCap(
    sorted: ReadonlyArray<CatalogRow>,
    cap: number,
  ): CatalogRow[] {
    const buckets = new Map<string, number>();
    const out: CatalogRow[] = [];
    const seen = new Set<string>();
    for (const row of sorted) {
      if (out.length >= TARGET_CHIPS) break;
      if (seen.has(row.id)) continue;
      const tags =
        row.cuisine_tags.length > 0 ? row.cuisine_tags : ['__untagged__'];
      let allowed = true;
      for (const t of tags) {
        if ((buckets.get(t) ?? 0) >= cap) {
          allowed = false;
          break;
        }
      }
      if (!allowed) continue;
      for (const t of tags) {
        buckets.set(t, (buckets.get(t) ?? 0) + 1);
      }
      seen.add(row.id);
      out.push(row);
    }
    return out;
  }
}
