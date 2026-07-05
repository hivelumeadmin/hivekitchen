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
import { GENERATE_QUEUE } from '../../jobs/plan-generation.job.js';
import { HouseholdsRepository } from '../households/households.repository.js';
import { PlanDayContextRepository } from './plan-day-context.repository.js';
import { PlanDayContextService } from './plan-day-context.service.js';
import { RecipeService } from '../recipe/recipe.service.js';
import { RecipesRepository } from '../recipe/recipes.repository.js';
import { SnackSkuRepository } from '../recipe/snack-sku.repository.js';
import { LunchLinkSessionRepository } from './lunch-link-session.repository.js';
import { MemoryRepository } from '../memory/memory.repository.js';
import { VariantProposalRepository } from './variant-proposal.repository.js';
import { VariantProposalService } from './variant-proposal.service.js';
import { ThreadRepository } from '../threads/thread.repository.js';
import { OpenAIAdapter } from '../../agents/providers/openai.adapter.js';
import { CatalogRepo } from '../../services/catalog-pick.repository.js';
import { HouseholdAllergensRepository } from '../households/household-allergens.repository.js';
import { PlanEditTurnService, buildSnackContextLoader } from './plan-edit.service.js';
import { WeekAllergenRevalidator } from './week-allergen-revalidation.js';

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
    childAllergensRepository,
  );
  // Story 3.28 — lunch link suppression. Created here so both BriefStateComposer
  // and the children route (POST /v1/children/:childId/lunch-link-pause) share
  // the same repository instance via the lunchLinkSessionRepository decorator.
  // Delivery job (lunch-link-delivery.job.ts, to be built in Epic 4) must call
  // lunchLinkSessionRepository.findSuppressedForDate(date) at the start of each
  // child's delivery loop and skip SendGrid/Twilio when suppressed_at IS NOT NULL.
  const lunchLinkSessionRepository = new LunchLinkSessionRepository(fastify.supabase);

  // Slice 5-S8 — composer reads turn-sourced memory nodes for the "I noticed"
  // learning-moment threshold.
  const memoryRepository = new MemoryRepository(fastify.supabase);
  // Story 3-S40 (AC6) — composer resolves snack_sku_id → snack_skus.name for tiles.
  const snackSkuRepository = new SnackSkuRepository(fastify.supabase);
  // Composer also resolves main/extra recipe_id → recipes.canonical_name so the
  // tile dish line shows the recipe name (not just snacks). Reuses the same
  // repository instance the service uses for commit-time ingredient lookups.
  const recipesRepositoryForComposer = new RecipesRepository(fastify.supabase);

  const briefStateComposer = new BriefStateComposer({
    plansRepository: repository,
    briefStateRepository,
    childrenRepository,
    lunchLinkSessionRepository,
    auditService: fastify.auditService,
    logger: fastify.log,
    memoryRepository,
    snackSkuRepository,
    recipesRepository: recipesRepositoryForComposer,
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
    auditService: fastify.auditService,
    logger: fastify.log,
  });

  // Story 3-S34 — on-demand composition needs the single-household timezone
  // (composition window) and the plan-generation queue (immediate enqueue).
  const householdsRepository = new HouseholdsRepository(fastify.supabase, kek);

  const plansService = new PlansService({
    repository,
    briefStateRepository,
    briefStateComposer,
    allergyGuardrail: fastify.allergyGuardrailService,
    auditService: fastify.auditService,
    logger: fastify.log,
    redis: fastify.redis,                              // Story 3.13
    regenQueue: fastify.bullmq.getQueue(REGEN_QUEUE),  // Story 3.13
    recipeService,                                     // post-Phase-9: recordUse() only
    recipesRepository,                                 // 3-DM-C1 9b/4 step 2: swap recipe-ingredient lookup
    generateQueue: fastify.bullmq.getQueue(GENERATE_QUEUE), // Story 3-S34
    householdsRepository,                              // Story 3-S34
    snackSkuRepository,                                // Story 3-s43 (Phase-2 allergen fail-safe)
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
  if (fastify.hasDecorator('planDayContextService')) {
    throw new Error(
      'planDayContextService already decorated — check plugin registration order',
    );
  }
  const planDayContextRepository = new PlanDayContextRepository(fastify.supabase);
  const planDayContextService = new PlanDayContextService({
    repository: planDayContextRepository,
    plansRepository: repository,
    regenQueue: fastify.bullmq.getQueue(REGEN_QUEUE),
    auditService: fastify.auditService,
    logger: fastify.log,
  });

  // Slice 5-S12 — the conversational swap-proposal route appends a
  // TurnBodyProposal turn to the household's family thread. Decorated here so
  // the route resolves it via fastify.threadRepository.
  if (fastify.hasDecorator('threadRepository')) {
    throw new Error(
      'threadRepository already decorated — check plugin registration order',
    );
  }
  fastify.decorate('threadRepository', new ThreadRepository(fastify.supabase));

  // Epic 13-s9 — conversational plan-edit turn (route → dispatch → execute).
  // The classifier rides the same bare OpenAIAdapter seam as onboarding; the
  // catalog pick reads the cached slate + KitchenMap; the snack re-pick inputs
  // come from the KitchenMap projection + SKU shelf.
  const catalogRepo = new CatalogRepo({
    recipesRepository,
    kitchenMapService: fastify.kitchenMapService,
  });
  const planEditSnackContext = buildSnackContextLoader({
    kitchenMapService: fastify.kitchenMapService,
    snackSkuRepository,
  });
  // Epic 13-s10 (AC7) — after a NEW allergen insert, re-screen the week and
  // deterministically re-pick conflicting slots through the existing swap
  // services (guardrail re-eval inside). Reuses the same catalog / snack-repick
  // seams as the swap path so the pre-filter and the authority cannot drift.
  const weekAllergenRevalidator = new WeekAllergenRevalidator({
    catalog: catalogRepo,
    snackContext: planEditSnackContext,
    plansService,
    recipeAllergenFlags: recipesRepository,
    snackAllergenTags: snackSkuRepository,
  });
  const planEditService = new PlanEditTurnService({
    provider: new OpenAIAdapter(fastify.openai),
    catalog: catalogRepo,
    planTree: plansService,
    plansService,
    householdAllergens: new HouseholdAllergensRepository(fastify.supabase, kek),
    snackContext: planEditSnackContext,
    kitchenMapForContext: fastify.kitchenMapService,
    revalidator: weekAllergenRevalidator,
  });

  fastify.decorate('planEditService', planEditService);
  fastify.decorate('plansService', plansService);
  fastify.decorate('briefStateComposer', briefStateComposer);
  fastify.decorate('planAdjustmentService', planAdjustmentService);
  fastify.decorate('planDayContextService', planDayContextService);
  fastify.decorate('lunchLinkSessionRepository', lunchLinkSessionRepository);
  fastify.decorate('variantProposalService', variantProposalService);
};

export const plansHook = fp(plansHookPlugin, { name: 'plans-hook' });
