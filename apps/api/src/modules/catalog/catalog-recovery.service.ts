import type { FastifyBaseLogger } from 'fastify';
import type { HouseholdsRepository } from '../households/households.repository.js';
import type { KitchenMapService } from '../kitchen-map/kitchen-map.service.js';
import type { RecipesRepository } from '../recipe/recipes.repository.js';
import type { CuratedBaselineMaterializationService } from './curated-baseline.service.js';

// Slice 2.6-s5 — Stage 2 Recovery-only handler.
//
// STAGE 2 IS RECOVERY-ONLY. NO SCHEDULER. NO CRON.
// Triggered ONLY by Stage 1 completion events (floor breach, mass-block,
// or stage1_failure). Re-materializes curated baseline rows for the
// household's declared cuisine buckets when the personalized catalog
// has dropped below the floor or been mass-blocked by allergen rules.

const STAGE2_SKIP_FLOOR = 35;

export type Stage2Trigger = 'floor_breach' | 'mass_block' | 'stage1_failure';

export interface CatalogRecoveryServiceDeps {
  curatedBaselineMaterializationService: CuratedBaselineMaterializationService;
  recipesRepo: RecipesRepository;
  householdsRepo: HouseholdsRepository;
  kitchenMapService: KitchenMapService;
  logger: FastifyBaseLogger;
}

export interface CatalogRecoveryOpts {
  emitted_count?: number;
  blocked_count?: number;
}

export class CatalogRecoveryService {
  private readonly curatedBaselineMaterializationService: CuratedBaselineMaterializationService;
  private readonly recipesRepo: RecipesRepository;
  private readonly householdsRepo: HouseholdsRepository;
  private readonly kitchenMapService: KitchenMapService;
  private readonly logger: FastifyBaseLogger;

  constructor(deps: CatalogRecoveryServiceDeps) {
    this.curatedBaselineMaterializationService =
      deps.curatedBaselineMaterializationService;
    this.recipesRepo = deps.recipesRepo;
    this.householdsRepo = deps.householdsRepo;
    this.kitchenMapService = deps.kitchenMapService;
    this.logger = deps.logger;
  }

  /**
   * Stage 2 recovery entry point. NEVER throws. The BullMQ worker calls
   * this and trusts that no exception propagates.
   *
   * Pipeline:
   * 1. Concurrent Stage 1 guard — read stage1_completed_at.
   * 2. Skip-if-recovered — count catalog_seeded rows; bail if >= STAGE2_SKIP_FLOOR.
   * 3. Load cuisine context via KitchenMapService.
   * 4. Re-materialize curated baseline for those cuisine buckets.
   * 5. Post-recovery count + terminal-zero detection.
   * 6. Completion log.
   */
  async recoverForHousehold(
    householdId: string,
    triggeredBy: Stage2Trigger,
    opts?: CatalogRecoveryOpts,
  ): Promise<void> {
    try {
      // ---- Step 1: concurrent Stage 1 guard ---------------------------------
      // Skip for stage1_failure: Stage 1 has definitionally stopped all work
      // (LLM call failed, parse failed, or schema failed) so stage1_completed_at
      // is intentionally NULL. The guard is only meaningful for mass_block and
      // floor_breach triggers where Stage 1 may still be writing.
      if (triggeredBy !== 'stage1_failure') {
        const stage1At = await this.householdsRepo.getStage1CompletedAt(householdId);
        if (stage1At === null) {
          this.logger.info(
            {
              module: 'catalog',
              action: 'catalog.stage2.deferred_stage1_in_flight',
              household_id: householdId,
              triggered_by: triggeredBy,
            },
            'stage 2 deferred — Stage 1 still in-flight; BullMQ will retry',
          );
          return;
        }
      }

      // ---- Step 2: skip-if-recovered ----------------------------------------
      const preRecoveryCount = await this.recipesRepo.countCatalogSeededForHousehold(
        householdId,
      );
      if (preRecoveryCount >= STAGE2_SKIP_FLOOR) {
        this.logger.info(
          {
            module: 'catalog',
            action: 'catalog.stage2.skip_already_recovered',
            household_id: householdId,
            triggered_by: triggeredBy,
            count: preRecoveryCount,
          },
          'stage 2 skipped — household already at or above floor',
        );
        return;
      }

      // ---- Step 3: load cuisine context -------------------------------------
      const map = await this.kitchenMapService.get(householdId);
      const cuisineTags = map.cultural.active.map((p) => p.key);

      // ---- Step 4: re-materialize curated baseline --------------------------
      // CuratedBaselineMaterializationService.rematerialize is additive only
      // (ON CONFLICT DO NOTHING) and NEVER throws.
      await this.curatedBaselineMaterializationService.rematerialize(
        householdId,
        cuisineTags,
      );

      // ---- Step 5: post-recovery count + terminal-zero ----------------------
      let postRecoveryCount: number;
      try {
        postRecoveryCount = await this.recipesRepo.countCatalogSeededForHousehold(householdId);
      } catch (postCountErr) {
        this.logger.error(
          {
            module: 'catalog',
            action: 'catalog.stage2.post_count_failed',
            household_id: householdId,
            triggered_by: triggeredBy,
            err: postCountErr,
          },
          'stage 2 post-recovery count failed — recovery ran but outcome unknown',
        );
        return;
      }

      if (postRecoveryCount === 0) {
        this.logger.warn(
          {
            module: 'catalog',
            action: 'catalog.stage2.terminal_zero',
            household_id: householdId,
            triggered_by: triggeredBy,
            cuisine_tag_count: cuisineTags.length,
            ...(triggeredBy === 'mass_block' && opts?.emitted_count !== undefined
              ? { emitted_count: opts.emitted_count }
              : {}),
            ...(triggeredBy === 'mass_block' && opts?.blocked_count !== undefined
              ? { blocked_count: opts.blocked_count }
              : {}),
          },
          'stage 2 terminal zero — 2.6-s6 cold-start fallback will handle M5 entry',
        );
        return;
      }

      // ---- Step 6: completion log ------------------------------------------
      this.logger.info(
        {
          module: 'catalog',
          action: 'catalog.stage2.completed',
          household_id: householdId,
          triggered_by: triggeredBy,
          pre_recovery_count: preRecoveryCount,
          post_recovery_count: postRecoveryCount,
          cuisine_tag_count: cuisineTags.length,
          ...(triggeredBy === 'mass_block' && opts?.emitted_count !== undefined
            ? { emitted_count: opts.emitted_count }
            : {}),
          ...(triggeredBy === 'mass_block' && opts?.blocked_count !== undefined
            ? { blocked_count: opts.blocked_count }
            : {}),
        },
        'stage 2 recovery complete',
      );
    } catch (err) {
      this.logger.error(
        {
          module: 'catalog',
          action: 'catalog.stage2.failed',
          household_id: householdId,
          triggered_by: triggeredBy,
          err,
        },
        'stage 2 recovery failed — returning without throwing',
      );
    }
  }
}
