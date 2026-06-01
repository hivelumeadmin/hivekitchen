import { Buffer } from 'node:buffer';
import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import type { Job } from 'bullmq';
import { AllergyGuardrailRepository } from '../modules/allergy-guardrail/allergy-guardrail.repository.js';
import { CuratedBaselineRepository } from '../modules/catalog/curated-baseline.repository.js';
import { CuratedBaselineMaterializationService } from '../modules/catalog/curated-baseline.service.js';
import { CatalogRecoveryService } from '../modules/catalog/catalog-recovery.service.js';
import type { Stage2Trigger } from '../modules/catalog/catalog-recovery.service.js';
import { HouseholdsRepository } from '../modules/households/households.repository.js';
import { RecipesRepository } from '../modules/recipe/recipes.repository.js';

// STAGE 2 IS RECOVERY-ONLY. NO SCHEDULER. NO CRON.
// Triggered ONLY by catalog.seed.stage1 job completion events (floor breach,
// mass-block, or Stage 1 failure). Do NOT add any repeat/cron options to
// CATALOG_RECOVERY_JOB_OPTS.
//
// Slice 2.6-s5 — Stage 2 catalog recovery BullMQ plugin.
//
// The worker calls CatalogRecoveryService.recoverForHousehold which NEVER
// throws — failures stay silent and the household either gets a partial
// recovery or falls through to the 2.6-s6 cold-start fallback at M5 entry.

export const CATALOG_RECOVERY_QUEUE = 'catalog.recover.stage2';

export const CATALOG_RECOVERY_JOB_OPTS = {
  attempts: 2,
  // Fixed 30s backoff — matches brief "re-queued for 30s later (one retry max)".
  // The one retry is for the concurrent Stage-1-in-flight race; the service's
  // deferred_stage1_in_flight branch returns cleanly so BullMQ retries.
  backoff: { type: 'fixed' as const, delay: 30_000 },
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 50 },
  // NO repeat. NO cron. STAGE 2 IS RECOVERY-ONLY.
};

export interface CatalogRecoveryJobData {
  household_id: string;
  request_id: string;
  triggered_by: Stage2Trigger;
  emitted_count?: number;
  blocked_count?: number;
}

const catalogRecoveryPlugin: FastifyPluginAsync = async (fastify) => {
  if (!fastify.supabase) {
    throw new Error(
      'catalogRecoveryPlugin requires supabase decorator — register supabasePlugin first',
    );
  }
  if (!fastify.kitchenMapService) {
    throw new Error(
      'catalogRecoveryPlugin requires kitchenMapService decorator — register kitchenMapPlugin first',
    );
  }
  if (!fastify.bullmq) {
    throw new Error(
      'catalogRecoveryPlugin requires bullmq decorator — register bullmqPlugin first',
    );
  }

  const kekHex = fastify.env?.ENVELOPE_ENCRYPTION_MASTER_KEY;
  const kek = kekHex ? Buffer.from(kekHex, 'hex') : null;

  const householdsRepo = new HouseholdsRepository(fastify.supabase, kek);
  const guardrailRepo = new AllergyGuardrailRepository(fastify.supabase, kek);
  const recipesRepo = new RecipesRepository(fastify.supabase);
  const curatedBaselineRepo = new CuratedBaselineRepository(fastify.supabase);

  const curatedBaselineMaterializationService = new CuratedBaselineMaterializationService({
    curatedBaselineRepo,
    recipesRepo,
    householdsRepo,
    guardrailRepo,
    logger: fastify.log,
  });

  const service = new CatalogRecoveryService({
    curatedBaselineMaterializationService,
    recipesRepo,
    householdsRepo,
    kitchenMapService: fastify.kitchenMapService,
    logger: fastify.log,
  });

  const worker = fastify.bullmq.getWorker(
    CATALOG_RECOVERY_QUEUE,
    async (job: Job<CatalogRecoveryJobData>) => {
      const opts =
        job.data.emitted_count !== undefined || job.data.blocked_count !== undefined
          ? {
              emitted_count: job.data.emitted_count,
              blocked_count: job.data.blocked_count,
            }
          : undefined;
      // CatalogRecoveryService NEVER throws; the worker won't surface failures
      // via BullMQ's retry path. The deferred_stage1_in_flight log signals a
      // legitimate retry condition, and BullMQ handles that via attempts: 2.
      await service.recoverForHousehold(
        job.data.household_id,
        job.data.triggered_by,
        opts,
      );
    },
  );

  worker.on('failed', (job: Job<CatalogRecoveryJobData> | undefined, err: Error) => {
    if (!job) return;
    fastify.log.error(
      {
        module: 'catalog',
        action: 'catalog.stage2.job_failed',
        household_id: job.data.household_id,
        request_id: job.data.request_id,
        triggered_by: job.data.triggered_by,
        attempts_made: job.attemptsMade,
        err,
      },
      'catalog stage2 job failed at the BullMQ layer — should be rare; service catches its own errors',
    );
  });
};

export const catalogRecoveryJobPlugin = fp(catalogRecoveryPlugin, {
  name: 'catalog-recovery-job',
});
