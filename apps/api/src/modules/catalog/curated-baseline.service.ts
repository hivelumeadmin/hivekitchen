import type { FastifyBaseLogger } from 'fastify';
import type {
  AllergyGuardrailRepository} from '../allergy-guardrail/allergy-guardrail.repository.js';
import {
  AllergyGuardrailDecryptError,
} from '../allergy-guardrail/allergy-guardrail.repository.js';
import {
  evaluate as evaluateGuardrail,
  type AllergyRule,
} from '../allergy-guardrail/allergy-rules.engine.js';
import type { HouseholdsRepository } from '../households/households.repository.js';
import type { RecipesRepository } from '../recipe/recipes.repository.js';
import { catalogItemToPlanItem } from './catalog-guardrail-helper.js';
import type {
  CuratedBaselineItemRow,
  CuratedBaselineRepository,
} from './curated-baseline.repository.js';

// Slice 2.6-s2 — Stage 0 catalog materialization service.
//
// Two entry points, both fire-and-forget from the caller's perspective:
//   - materialize(householdId)                    — household creation
//   - rematerialize(householdId, cuisineTags)     — M3 completion
//
// Both run baseline items through AllergyGuardrailService.evaluate() and
// persist survivors via RecipesRepository.seedFromCatalogBaseline. Neither
// path throws — Stage 0 must never block household creation or M3
// completion. Errors are caught and logged via structured Pino events.
//
// Idempotency:
//   - materialize(): household-level via households.stage0_materialized_at —
//     a second call with a non-null timestamp is a no-op.
//   - rematerialize(): no household-level guard — always runs; relies on
//     row-level ON CONFLICT DO NOTHING (recipes UNIQUE per-household-name +
//     household_recipe_usage PK) for idempotency.

// Per-batch floor below which we log `catalog.stage0.below_floor`. Tunable
// but the brief sets 30 as the threshold for "Stage 0 left the household
// without enough fallback coverage; Stage 1 had better deliver."
const STAGE0_PERSIST_FLOOR = 30;

export interface CuratedBaselineServiceDeps {
  curatedBaselineRepo: CuratedBaselineRepository;
  recipesRepo: RecipesRepository;
  householdsRepo: HouseholdsRepository;
  guardrailRepo: AllergyGuardrailRepository;
  logger: FastifyBaseLogger;
}

export class CuratedBaselineMaterializationService {
  private readonly baselineRepo: CuratedBaselineRepository;
  private readonly recipesRepo: RecipesRepository;
  private readonly householdsRepo: HouseholdsRepository;
  private readonly guardrailRepo: AllergyGuardrailRepository;
  private readonly logger: FastifyBaseLogger;

  constructor(deps: CuratedBaselineServiceDeps) {
    this.baselineRepo = deps.curatedBaselineRepo;
    this.recipesRepo = deps.recipesRepo;
    this.householdsRepo = deps.householdsRepo;
    this.guardrailRepo = deps.guardrailRepo;
    this.logger = deps.logger;
  }

  /**
   * Initial Stage 0 materialization — triggered at household creation.
   *
   * 1. Short-circuit if households.stage0_materialized_at is already set.
   * 2. Load all active baseline items (no cuisine filter — M1/M2 not done).
   * 3. Filter via AllergyGuardrailService (belt-and-suspenders; baseline
   *    items honor the broad-safe-seed invariant by construction).
   * 4. Persist survivors via RecipesRepository.seedFromCatalogBaseline.
   * 5. Log floor breach (count < 30) or terminal-zero (count = 0).
   * 6. Set stage0_materialized_at on success.
   *
   * NEVER throws. Catches everything; logs; returns void.
   */
  async materialize(householdId: string): Promise<void> {
    let persisted = 0;
    try {
      const existing = await this.householdsRepo.getStage0MaterializedAt(householdId);
      if (existing !== null) {
        this.logger.info(
          {
            module: 'catalog',
            action: 'catalog.stage0.skip_idempotent',
            household_id: householdId,
            stage0_materialized_at: existing,
          },
          'stage 0 materialization skipped — household already materialized',
        );
        return;
      }

      const items = await this.baselineRepo.findAllActive();
      persisted = await this.runBatch(householdId, items, 'initial');

      // Mark the household done EVEN IF persisted = 0 — Stage 1/2/fallback
      // are designed to compensate downstream. Setting the timestamp prevents
      // a retry loop that would re-run the guardrail for the same items.
      await this.householdsRepo.setStage0MaterializedAt(householdId);

      this.logger.info(
        {
          module: 'catalog',
          action: 'catalog.stage0.materialize_complete',
          household_id: householdId,
          candidate_count: items.length,
          persisted_count: persisted,
        },
        'stage 0 initial materialization complete',
      );
    } catch (err) {
      this.logger.error(
        {
          module: 'catalog',
          action: 'catalog.stage0.materialize_failed',
          household_id: householdId,
          persisted_count_before_failure: persisted,
          err,
        },
        'stage 0 initial materialization failed — household_creation not blocked',
      );
    }
  }

  /**
   * M3 re-materialization — triggered when the parent advances out of
   * m3_taste. Cuisine-filtered re-seed; additive only (ON CONFLICT DO
   * NOTHING preserves existing rows).
   *
   * Does NOT check or update households.stage0_materialized_at — this path
   * is always allowed to run.
   *
   * NEVER throws.
   */
  async rematerialize(householdId: string, cuisineTags: readonly string[]): Promise<void> {
    try {
      if (cuisineTags.length === 0) {
        this.logger.info(
          {
            module: 'catalog',
            action: 'catalog.stage0.rematerialize_skip_no_tags',
            household_id: householdId,
          },
          'stage 0 re-materialization skipped — no cuisine tags from M3',
        );
        return;
      }

      const items = await this.baselineRepo.findActiveByCuisineTags(cuisineTags);
      const persisted = await this.runBatch(householdId, items, 'rematerialize');

      this.logger.info(
        {
          module: 'catalog',
          action: 'catalog.stage0.rematerialize_complete',
          household_id: householdId,
          cuisine_tag_count: cuisineTags.length,
          candidate_count: items.length,
          persisted_count: persisted,
        },
        'stage 0 re-materialization complete',
      );
    } catch (err) {
      this.logger.error(
        {
          module: 'catalog',
          action: 'catalog.stage0.rematerialize_failed',
          household_id: householdId,
          err,
        },
        'stage 0 re-materialization failed — M3 completion not blocked',
      );
    }
  }

  /**
   * Shared inner pipeline: load guardrail rules once, filter items per
   * AllergyRulesEngine.evaluate, then call
   * RecipesRepository.seedFromCatalogBaseline with survivors. Returns the
   * persisted count and emits floor-breach / terminal-zero events.
   *
   * Throws on infrastructure errors (guardrail rule load failure, decrypt
   * error). The outer entry points catch and log.
   */
  private async runBatch(
    householdId: string,
    items: readonly CuratedBaselineItemRow[],
    phase: 'initial' | 'rematerialize',
  ): Promise<number> {
    if (items.length === 0) {
      this.logger.warn(
        {
          module: 'catalog',
          action: 'catalog.stage0.no_candidates',
          household_id: householdId,
          phase,
        },
        'no curated baseline candidates to evaluate',
      );
      return 0;
    }

    // Load rules ONCE per invocation — bypasses the per-item DB round-trip
    // that AllergyGuardrailService.evaluate() would do.
    let rules: AllergyRule[];
    try {
      rules = await this.guardrailRepo.getRulesForHousehold(householdId);
    } catch (err) {
      if (err instanceof AllergyGuardrailDecryptError) {
        // Fail-closed: cannot safely materialize when allergen data is
        // unreadable. The household has no Stage 0 catalog this run; Stage
        // 1 will compensate (or the retry path on next M3 will succeed
        // once DEK becomes readable).
        this.logger.error(
          {
            module: 'catalog',
            action: 'catalog.stage0.allergen_decrypt_failure',
            household_id: householdId,
            phase,
          },
          'stage 0 aborted — allergen data unreadable; persisted_count=0',
        );
        return 0;
      }
      throw err;
    }

    const survivors: CuratedBaselineItemRow[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      const planItem = catalogItemToPlanItem(item, householdId);
      const verdict = evaluateGuardrail([planItem], rules);
      if (verdict.verdict === 'cleared') {
        survivors.push(item);
        continue;
      }
      if (verdict.verdict === 'uncertain') {
        // Per AC7: skip uncertain (fail-closed). Log with item index but
        // NOT the canonical_name — even curator names can be culturally
        // identifying once household allergen data is involved.
        this.logger.warn(
          {
            module: 'catalog',
            action: 'catalog.stage0.guardrail_uncertain',
            household_id: householdId,
            phase,
            item_index: i,
            reason: verdict.reason,
          },
          'stage 0 item skipped — guardrail uncertain',
        );
        continue;
      }
      // verdict === 'blocked' — silently skip; this is the expected path
      // for items that DO trip a household-specific allergen rule. We don't
      // log per-item blocks (would be noisy + leak names).
    }

    const persisted = await this.recipesRepo.seedFromCatalogBaseline(
      householdId,
      survivors,
      (err, itemIndex) => {
        this.logger.error(
          {
            module: 'catalog',
            action: 'catalog.stage0.persist_item_failed',
            household_id: householdId,
            phase,
            item_index: itemIndex,
            err,
          },
          'stage 0 item persist failed — continuing with batch',
        );
      },
    );

    if (persisted === 0) {
      this.logger.warn(
        {
          module: 'catalog',
          action: 'catalog.stage0.terminal_zero',
          household_id: householdId,
          phase,
          candidate_count: items.length,
        },
        'stage 0 persisted zero items — Stage 1/fallback will compensate',
      );
    } else if (persisted < STAGE0_PERSIST_FLOOR) {
      this.logger.warn(
        {
          module: 'catalog',
          action: 'catalog.stage0.below_floor',
          household_id: householdId,
          phase,
          candidate_count: items.length,
          persisted_count: persisted,
          floor: STAGE0_PERSIST_FLOOR,
        },
        'stage 0 persisted below floor — downstream compensation expected',
      );
    }

    return persisted;
  }
}

// Slice 2.6-s3 — the local baselineToPlanItem helper was extracted to
// catalog-guardrail-helper.ts so Stage 1 (CatalogSeedService) can share it.
// Stage 0 callers now use catalogItemToPlanItem from that module.
