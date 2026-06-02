import fp from 'fastify-plugin';
import { Buffer } from 'node:buffer';
import type { FastifyPluginAsync } from 'fastify';
import { PlansRepository } from './plans.repository.js';
import { PlansService } from './plans.service.js';
import { PlanAdjustmentService } from './plan-adjustment.service.js';
import { BriefStateRepository } from './brief-state.repository.js';
import { BriefStateComposer } from './brief-state.composer.js';
import { ChildAllergensRepository } from '../children/child-allergens.repository.js';
import { ChildrenRepository } from '../children/children.repository.js';
import { REGEN_QUEUE } from '../../jobs/plan-regeneration.job.js';
import { DayOverridesRepository } from './day-overrides.repository.js';
import { DayOverridesService } from './day-overrides.service.js';
import { ExtraRulesRepository } from '../children/extra-rules.repository.js';
import { ExtraRemovalSignalService } from './extra-removal-signal.service.js';
import { RecipeService } from '../recipe/recipe.service.js';
import { RecipesRepository } from '../recipe/recipes.repository.js';
import { LunchLinkSessionRepository } from './lunch-link-session.repository.js';
import { VariantProposalRepository } from './variant-proposal.repository.js';
import { VariantProposalService } from './variant-proposal.service.js';

const plansHookPlugin: FastifyPluginAsync = async (fastify) => {
  if (!fastify.supabase) {
    throw new Error('plansHook requires supabase decorator — register supabasePlugin first');
  }
  if (!fastify.env) {
    throw new Error('plansHook requires env decorator — register env validator plugin first');
  }
  if (!fastify.allergyGuardrailService) {
    throw new Error(
      'plansHook requires allergyGuardrailService decorator — register allergyGuardrailHook first',
    );
  }
  if (!fastify.auditService) {
    throw new Error('plansHook requires auditService decorator — register auditHook first');
  }
  if (!fastify.openai) {
    throw new Error('plansHook requires openai decorator — register openaiPlugin first');
  }
  if (!fastify.tavily) {
    throw new Error('plansHook requires tavily decorator — register tavilyPlugin first');
  }
  if (!fastify.vocabularyService) {
    throw new Error(
      'plansHook requires vocabularyService decorator — register vocabularyPlugin first',
    );
  }
  if (fastify.hasDecorator('briefStateComposer')) {
    throw new Error(
      'briefStateComposer already decorated — check plugin registration order',
    );
  }

  const repository = new PlansRepository(fastify.supabase);
  const briefStateRepository = new BriefStateRepository(fastify.supabase);
  // Story 3.10: composer needs children-with-allergens to emit cleared_allergies.
  // child.name is envelope-encrypted at rest; ChildrenRepository decrypts via KEK.
  const kekHex = fastify.env.ENVELOPE_ENCRYPTION_MASTER_KEY;
  const kek = kekHex ? Buffer.from(kekHex, 'hex') : null;
  // Slice 2.6-s8 — ChildrenRepository now requires ChildAllergensRepository
  // so declared_allergens reads go through child_allergens (the legacy
  // children.declared_allergens column is a zombie).
  const childAllergensRepository = new ChildAllergensRepository(fastify.supabase, kek);
  const childrenRepository = new ChildrenRepository(
    fastify.supabase,
    kek,
    fastify.log,
    childAllergensRepository,
  );
  // Story 3.28 — lunch link suppression. Created here so both BriefStateComposer
  // and the children route (POST /v1/children/:childId/lunch-link-pause) share
  // the same repository instance via the lunchLinkSessionRepository decorator.
  // Delivery job (lunch-link-delivery.job.ts, to be built in Epic 4) must call
  // lunchLinkSessionRepository.findSuppressedForDate(date) at the start of each
  // child's delivery loop and skip SendGrid/Twilio when suppressed_at IS NOT NULL.
  const lunchLinkSessionRepository = new LunchLinkSessionRepository(fastify.supabase);

  const briefStateComposer = new BriefStateComposer({
    plansRepository: repository,
    briefStateRepository,
    childrenRepository,
    lunchLinkSessionRepository,
    auditService: fastify.auditService,
    logger: fastify.log,
  });
  // Story 3.22 — passive Extra-removal bias service. Lives next to PlansService
  // because the swap path is the only signal source today; co-locating avoids
  // a separate plugin for a single fire-and-forget hook.
  const extraRulesRepositoryForBias = new ExtraRulesRepository(fastify.supabase);
  const extraRemovalSignalService = new ExtraRemovalSignalService({
    client: fastify.supabase,
    extraRulesRepo: extraRulesRepositoryForBias,
    auditService: fastify.auditService,
    logger: fastify.log,
  });
  // Slice D — recipes catalog. At plan-commit time, RecipeService materializes
  // a recipes row for each main-slot plan item (idempotent by canonical name
  // within the household) and bumps household_recipe_usage so the kitchen
  // map's favourite-recipes projection has signal to rank by. The agent's
  // recipe.search / recipe.fetch tools still throw NotImplementedError; that
  // read path is wired in slice D.2.
  const recipesRepository = new RecipesRepository(fastify.supabase);
  const recipeService = new RecipeService(recipesRepository, fastify.log);

  // Story 3.27 — variant proposal active learning. The repository, service,
  // and Fastify decorator are wired here so the plan-generation worker can
  // call createFromPlanOutput after commit, and the confirm route can resolve
  // the service via fastify.variantProposalService.
  const variantProposalRepository = new VariantProposalRepository(fastify.supabase);
  const variantProposalService = new VariantProposalService({
    repo: variantProposalRepository,
    plansRepo: repository,
    auditService: fastify.auditService,
    logger: fastify.log,
  });

  const plansService = new PlansService({
    repository,
    briefStateRepository,
    briefStateComposer,
    allergyGuardrail: fastify.allergyGuardrailService,
    auditService: fastify.auditService,
    logger: fastify.log,
    redis: fastify.redis,                              // Story 3.13
    regenQueue: fastify.bullmq.getQueue(REGEN_QUEUE),  // Story 3.13
    extraRemovalSignalService,                         // Story 3.22
    recipeService,                                     // post-Phase-9: recordUse() only
    recipesRepository,                                 // 3-DM-C1 9b/4 step 2: swap recipe-ingredient lookup
    variantProposalService,                            // Story 3.27
  });
  if (fastify.hasDecorator('planAdjustmentService')) {
    throw new Error(
      'planAdjustmentService already decorated — check plugin registration order',
    );
  }
  // Story 3.17 — central dispatcher for event-driven plan adjustments.
  // Consumed by SchoolPoliciesService today (3.16); future consumers (Epic 6
  // pantry, Story 3.18 cultural calendar) inject via the same decorator.
  const planAdjustmentService = new PlanAdjustmentService({
    plansRepository: repository,
    regenQueue: fastify.bullmq.getQueue(REGEN_QUEUE),
    auditService: fastify.auditService,
    logger: fastify.log,
  });

  // Story 3.19 — day-level context overrides. Reuses REGEN_QUEUE for the
  // composition-changing override regen path so no new BullMQ topology is
  // introduced.
  if (fastify.hasDecorator('dayOverridesService')) {
    throw new Error(
      'dayOverridesService already decorated — check plugin registration order',
    );
  }
  const dayOverridesRepository = new DayOverridesRepository(fastify.supabase);
  const dayOverridesService = new DayOverridesService({
    repository: dayOverridesRepository,
    plansRepository: repository,
    briefStateComposer,
    regenQueue: fastify.bullmq.getQueue(REGEN_QUEUE),
    auditService: fastify.auditService,
    logger: fastify.log,
  });

  fastify.decorate('plansService', plansService);
  fastify.decorate('briefStateComposer', briefStateComposer);
  fastify.decorate('planAdjustmentService', planAdjustmentService);
  fastify.decorate('dayOverridesService', dayOverridesService);
  fastify.decorate('lunchLinkSessionRepository', lunchLinkSessionRepository);
  fastify.decorate('variantProposalService', variantProposalService);
};

export const plansHook = fp(plansHookPlugin, { name: 'plans-hook' });
