import { Buffer } from 'node:buffer';
import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import type { Job, Queue } from 'bullmq';
import { AllergyGuardrailRepository } from '../modules/allergy-guardrail/allergy-guardrail.repository.js';
import { CuratedBaselineRepository } from '../modules/catalog/curated-baseline.repository.js';
import { OnboardingChipSuggestionRepository } from '../modules/catalog/onboarding-chip-suggestion.repository.js';
import { CatalogSeedService } from '../modules/catalog/catalog-seed.service.js';
import { HouseholdsRepository } from '../modules/households/households.repository.js';
import { RecipesRepository } from '../modules/recipe/recipes.repository.js';
import {
  CATALOG_RECOVERY_QUEUE,
  type CatalogRecoveryJobData,
} from './catalog-recovery.job.js';

// Slice 2.6-s3 — Stage 1 catalog seeding BullMQ plugin.
//
// Fires once per household when the parent advances OUT of m2_safe in
// onboarding (see OnboardingService.submitTextTurn — fire-and-forget enqueue).
// The worker calls CatalogSeedService.seedForHousehold which NEVER throws —
// failures stay silent and stage1_completed_at remains NULL so 2.6-s4's
// polling window expires and the cold-start fallback takes over.

export const CATALOG_SEED_QUEUE = 'catalog.seed.stage1';

export const CATALOG_SEED_JOB_OPTS = {
  attempts: 2,
  backoff: { type: 'exponential' as const, delay: 30_000 },
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 50 },
};

export interface CatalogSeedJobData {
  household_id: string;
  request_id: string;
}

const catalogSeedPlugin: FastifyPluginAsync = async (fastify) => {
  if (!fastify.openai) {
    throw new Error(
      'catalogSeedPlugin requires openai decorator — register openaiPlugin first',
    );
  }
  if (!fastify.supabase) {
    throw new Error(
      'catalogSeedPlugin requires supabase decorator — register supabasePlugin first',
    );
  }
  if (!fastify.kitchenMapService) {
    throw new Error(
      'catalogSeedPlugin requires kitchenMapService decorator — register kitchenMapPlugin first',
    );
  }
  if (!fastify.bullmq) {
    throw new Error(
      'catalogSeedPlugin requires bullmq decorator — register bullmqPlugin first',
    );
  }

  const kekHex = fastify.env?.ENVELOPE_ENCRYPTION_MASTER_KEY;
  const kek = kekHex ? Buffer.from(kekHex, 'hex') : null;

  const householdsRepo = new HouseholdsRepository(fastify.supabase, kek);
  // Stage 1 reads allergen rules to feed AllergyRulesEngine.evaluate(); KEK
  // is required to decrypt households.declared_allergens.
  const guardrailRepo = new AllergyGuardrailRepository(fastify.supabase, kek);
  const recipesRepo = new RecipesRepository(fastify.supabase);
  const curatedBaselineRepo = new CuratedBaselineRepository(fastify.supabase);
  const onboardingChipSuggestionRepo = new OnboardingChipSuggestionRepository(fastify.supabase);

  // Slice 2.6-s5 — recovery queue for Stage 2 enqueues from Stage 1 completion.
  // Queue is created lazily via bullmq.getQueue; idempotent across plugins.
  const recoveryQueue = fastify.bullmq.getQueue(
    CATALOG_RECOVERY_QUEUE,
  ) as Queue<CatalogRecoveryJobData>;

  const service = new CatalogSeedService({
    openai: fastify.openai,
    kitchenMapService: fastify.kitchenMapService,
    householdsRepo,
    guardrailRepo,
    recipesRepo,
    curatedBaselineRepo,
    recoveryQueue,
    onboardingChipSuggestionRepo,
    logger: fastify.log,
  });

  const worker = fastify.bullmq.getWorker(
    CATALOG_SEED_QUEUE,
    async (job: Job<CatalogSeedJobData>) => {
      // The service now THROWS on retryable failures (LLM timeout, malformed
      // response) so this worker's `attempts: 2` actually engages. Terminal
      // failures still return quietly. Letting the rejection propagate is the
      // point — BullMQ owns the retry policy, and `worker.on('failed')` below
      // logs the final give-up.
      await service.seedForHousehold(job.data.household_id, job.data.request_id);
    },
  );

  worker.on('failed', (job: Job<CatalogSeedJobData> | undefined, err: Error) => {
    if (!job) return;
    fastify.log.error(
      {
        module: 'catalog',
        action: 'catalog.stage1.job_failed',
        household_id: job.data.household_id,
        request_id: job.data.request_id,
        attempts_made: job.attemptsMade,
        err,
      },
      'catalog stage1 job failed at the BullMQ layer — should be rare; service catches its own errors',
    );
  });
};

export const catalogSeedJobPlugin = fp(catalogSeedPlugin, {
  name: 'catalog-seed-job',
});
