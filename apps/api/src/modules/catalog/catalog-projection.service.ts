import type { FastifyBaseLogger } from 'fastify';
import type { ChipOption } from '@hivekitchen/contracts';
import type { HouseholdsRepository } from '../households/households.repository.js';
import type { OnboardingChipSuggestionRepository } from './onboarding-chip-suggestion.repository.js';
import type { CuratedBaselineRepository } from './curated-baseline.repository.js';

// Slice 2.6-s4 / 2.6-s6 / 16-s1 — projects the per-household generated chip
// suggestions into a deterministic, diversity-shaped chip set for the Moment
// 5 starting-line chip card.
//
// 16-s1 (AC 4) — the chip source moved off `recipes`/`household_recipe_usage`
// to `onboarding_chip_suggestions`: recipe seeding used to have to happen
// before the information that should drive chip suggestions (M3 stated
// taste) existed. This class no longer depends on RecipesRepository at all —
// there is no code path here that can read a `recipes` row, which is the
// negative control AC 4 asks for. Declared favourites are a SEPARATE union
// this class does not yet perform (16-s7); this file returns only the
// generated set.
//
// 2.6-s6: getM5Chips now returns `M5ChipResult` ({ chips, coldStartReason }).
// When the caller is told the household is truly cold, it renders the
// conversational fallback instead of a sparse/stereotyped chip card.
//
// 16-s1 (AC 8, 9) — when generated suggestions (post allergen/dietary filter)
// fall below CHIP_FLOOR, the SAME filter is applied to `curated_baseline_items`
// (read-only — this class cannot write recipes) and that becomes the chip
// source INSTEAD of the thin suggestion set — decision 2's "used only to
// populate chips when generation yields too few" is a replacement, not a
// blend. If the fallback also underflows CHIP_FLOOR, that's cold-start
// ('chip_floor_underflow'), never a sparse partial grid.
//
// Single entry point: getM5Chips(householdId, declaredCuisineTags?). Pipeline:
//   1. Wait up to 5s for Stage 1 (households.stage1_completed_at NOT NULL).
//   2. SELECT all generated suggestion rows for the household, personalization-
//      filtered. Below CHIP_FLOOR (12) → read + filter curated_baseline_items
//      instead; below CHIP_FLOOR again → cold-start.
//   3. Sort in TS: declared-cuisine match first, then id ASC (deterministic
//      tie-breaker). Suggestions carry no confidence/provenance/favorite
//      columns — those were household_recipe_usage-specific.
//   4. Diversity cap (max 3 per cuisine_tag); if accumulator < 12, re-walk
//      with cap 5; below-threshold log fires if final < 12.
//   5. Project to ChipOption[] — key=suggestion id (UUID) or, on the fallback
//      path, the curated item's own canonical_name (never its row id — see
//      AC 5 resolution note inline); provenance='inferred' either way.
//
// NEVER throws — every error path returns { chips: [], coldStartReason: null }.

const POLL_INTERVAL_MS = 250;
const POLL_TIMEOUT_MS = 5_000;
const TARGET_CHIPS = 20;
const UNDERFLOW_THRESHOLD = 12;
const DIVERSITY_CAP_PRIMARY = 3;
const DIVERSITY_CAP_RELAXED = 5;
// Slice 16-s1 (AC 8) — the story's own vocabulary for the same number;
// explicitly NOT a third floor.
const CHIP_FLOOR = UNDERFLOW_THRESHOLD;

export type ColdStartReason =
  | 'per_cuisine_floor'
  | 'stage1_timeout'
  | 'stage2_terminal'
  // Slice 16-s1 (AC 9) — generated suggestions AND the curated-baseline
  // fallback both came up short of CHIP_FLOOR after filtering.
  | 'chip_floor_underflow';

export interface M5ChipResult {
  chips: ChipOption[];
  coldStartReason: ColdStartReason | null;
}

export interface CatalogProjectionServiceDeps {
  onboardingChipSuggestionRepository: OnboardingChipSuggestionRepository;
  householdsRepository: HouseholdsRepository;
  // Slice 16-s1 (AC 8) — read-only fallback source when generation fails,
  // times out, or leaves too few survivors. This class has no dependency
  // capable of writing `recipes`/`household_recipe_usage` at all, so the
  // "MUST NOT materialise" constraint holds structurally.
  curatedBaselineRepository: CuratedBaselineRepository;
  logger: FastifyBaseLogger;
}

interface SuggestionRow {
  id: string;
  label: string;
  cuisine_tags: string[];
  allergen_flags: string[];
  dietary_flags: string[];
}

export class CatalogProjectionService {
  private readonly onboardingChipSuggestionRepository: OnboardingChipSuggestionRepository;
  private readonly householdsRepository: HouseholdsRepository;
  private readonly curatedBaselineRepository: CuratedBaselineRepository;
  private readonly logger: FastifyBaseLogger;
  // Test seam — Vitest fake timers don't intercept setTimeout when called
  // inside service code without a configurable wait fn. Injectable so unit
  // tests can resolve the poll instantly.
  private readonly wait: (ms: number) => Promise<void>;

  constructor(
    deps: CatalogProjectionServiceDeps,
    wait?: (ms: number) => Promise<void>,
  ) {
    this.onboardingChipSuggestionRepository = deps.onboardingChipSuggestionRepository;
    this.householdsRepository = deps.householdsRepository;
    this.curatedBaselineRepository = deps.curatedBaselineRepository;
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
      const allRows: SuggestionRow[] =
        await this.onboardingChipSuggestionRepository.findAllForHousehold(householdId);

      // Step 2b — personalization filter: exclude allergen conflicts and
      // suggestions that don't satisfy non-negotiable dietary requirements.
      let rows = this.filterByPersonalization(allRows, allergenFilter, requiredDietaryFlags);

      // Step 3 — AC 8: generation failed, timed out, or left too few
      // survivors after filtering. All three reduce to the same observable
      // state by the time M5 is reached: few/no rows in
      // onboarding_chip_suggestions. Read curated_baseline_items directly —
      // read-only, this class has no dependency capable of writing
      // `recipes`/`household_recipe_usage` at all.
      if (rows.length < CHIP_FLOOR) {
        const curatedRaw =
          declaredCuisineTags.length > 0
            ? await this.curatedBaselineRepository.findActiveByCuisineTags(declaredCuisineTags)
            : await this.curatedBaselineRepository.findAllActive();
        // Deliberately keyed by canonical_name, NOT the curated_baseline_items
        // id. A curated row is never inserted into recipes or the suggestion
        // store, so its real id would resolve via neither lookup AC 5 checks —
        // reproducing exactly the silent-failure trap AC 5 exists to close.
        // The dish name is already a valid, non-UUID chip key (same pattern
        // every non-M5 chip in this app already uses), so tapping one needs
        // no resolution at all — it passes straight through as its own label.
        const curatedRows: SuggestionRow[] = curatedRaw.map((c) => ({
          id: c.canonical_name,
          label: c.canonical_name,
          cuisine_tags: c.cuisine_tags,
          allergen_flags: c.allergen_flags,
          dietary_flags: c.dietary_flags,
        }));
        const filteredCurated = this.filterByPersonalization(
          curatedRows,
          allergenFilter,
          requiredDietaryFlags,
        );
        this.logger.info(
          {
            module: 'catalog',
            action: 'catalog.m5.chip_floor_fallback',
            household_id: householdId,
            suggestion_count: rows.length,
            curated_count: filteredCurated.length,
          },
          'M5 chip suggestions below floor — falling back to curated baseline',
        );

        // AC 9 — the fallback itself came up short too (e.g. a household
        // whose declared allergens exclude most of the curated 50). Never a
        // sparse/partial grid — a real cold-start reason instead.
        if (filteredCurated.length < CHIP_FLOOR) {
          this.logger.info(
            {
              module: 'catalog',
              action: 'catalog.m5.cold_start_triggered',
              household_id: householdId,
              cold_start_reason: 'chip_floor_underflow',
              declared_cuisine_count: declaredCuisineTags.length,
              total_catalog_rows: filteredCurated.length,
            },
            'M5 cold-start triggered — fallback also underflowed CHIP_FLOOR',
          );
          return { chips: [], coldStartReason: 'chip_floor_underflow' };
        }
        rows = filteredCurated;
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

      // Step 7 — project to ChipOption[]. Every generated suggestion is
      // LLM-inferred; a 'declared' provenance only exists for the favourites
      // union (16-s7), which this class does not yet perform.
      const chips: ChipOption[] = picked.map((r) => ({
        key: r.id,
        label: r.label,
        provenance: 'inferred',
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


  private filterByPersonalization(
    rows: ReadonlyArray<SuggestionRow>,
    allergenFilter: ReadonlyArray<string>,
    requiredDietaryFlags: ReadonlyArray<string>,
  ): SuggestionRow[] {
    if (allergenFilter.length === 0 && requiredDietaryFlags.length === 0) return [...rows];
    return rows.filter((row) => {
      if (allergenFilter.some((a) => row.allergen_flags.includes(a))) return false;
      if (requiredDietaryFlags.some((d) => !row.dietary_flags.includes(d))) return false;
      return true;
    });
  }

  // 16-s1 — favorite/provenance/confidence sort criteria are gone with the
  // recipes-usage join; declared-cuisine match is now the only signal besides
  // the id tie-break. 16-s7's favourites union restores a pinned-first
  // ordering, but as a UNION step upstream of this sort, not as a field on
  // SuggestionRow.
  private sortCandidates(
    rows: ReadonlyArray<SuggestionRow>,
    declaredCuisineTags: ReadonlyArray<string> = [],
  ): SuggestionRow[] {
    const hasDeclared = declaredCuisineTags.length > 0;
    return [...rows].sort((a, b) => {
      if (hasDeclared) {
        const aMatch = a.cuisine_tags.some((t) => declaredCuisineTags.includes(t)) ? 1 : 0;
        const bMatch = b.cuisine_tags.some((t) => declaredCuisineTags.includes(t)) ? 1 : 0;
        if (aMatch !== bMatch) return bMatch - aMatch;
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
    sorted: ReadonlyArray<SuggestionRow>,
    cap: number,
  ): SuggestionRow[] {
    const buckets = new Map<string, number>();
    const out: SuggestionRow[] = [];
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
