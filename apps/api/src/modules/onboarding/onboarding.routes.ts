import { Buffer } from 'node:buffer';
import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import {
  OnboardingStateResponseSchema,
  TextOnboardingTurnRequestSchema,
  TextOnboardingTurnResponseSchema,
  TextOnboardingFinalizeResponseSchema,
  type TextOnboardingTurnRequest,
} from '@hivekitchen/contracts';
import { ThreadRepository } from '../threads/thread.repository.js';
import { OnboardingAgent } from '../../agents/onboarding.agent.js';
import { OpenAIAdapter } from '../../agents/providers/openai.adapter.js';
import { authorize } from '../../middleware/authorize.hook.js';
import { ChildAllergensRepository } from '../children/child-allergens.repository.js';
import { ChildrenRepository } from '../children/children.repository.js';
import { ChildrenService } from '../children/children.service.js';
import { CulturalPriorRepository } from '../cultural-priors/cultural-prior.repository.js';
import { CulturalPriorService } from '../cultural-priors/cultural-prior.service.js';
import { DietaryPreferencesRepository } from '../dietary-preferences/dietary-preferences.repository.js';
import { FoodPreferencesRepository } from '../food-preferences/food-preferences.repository.js';
import { SignalsService } from '../signals/signals.service.js';
import { RecipesRepository } from '../recipe/recipes.repository.js';
import { HouseholdRulesRepository } from '../household-rules/household-rules.repository.js';
import { HouseholdsRepository } from '../households/households.repository.js';
import { HouseholdAllergensRepository } from '../households/household-allergens.repository.js';
import { HouseholdsService } from '../households/households.service.js';
import { AllergyGuardrailRepository } from '../allergy-guardrail/allergy-guardrail.repository.js';
import { CuratedBaselineRepository } from '../catalog/curated-baseline.repository.js';
import { CuratedBaselineMaterializationService } from '../catalog/curated-baseline.service.js';
import { CatalogProjectionService } from '../catalog/catalog-projection.service.js';
import { OnboardingChipSuggestionRepository } from '../catalog/onboarding-chip-suggestion.repository.js';
import { CATALOG_SEED_QUEUE } from '../../jobs/catalog-seed.job.js';
import type { CatalogSeedJobData } from '../../jobs/catalog-seed.job.js';
import type { Queue } from 'bullmq';
import { AuditRepository } from '../../audit/audit.repository.js';
import { AuditService } from '../../audit/audit.service.js';
import { OnboardingMomentRepository } from './onboarding-moment.repository.js';
import { OnboardingService } from './onboarding.service.js';

const onboardingRoutesPlugin: FastifyPluginAsync = async (fastify) => {
  const threads = new ThreadRepository(fastify.supabase);
  const agent = new OnboardingAgent(new OpenAIAdapter(fastify.openai));
  const culturalPriorRepository = new CulturalPriorRepository(fastify.supabase);
  const culturalPriorService = new CulturalPriorService({
    repository: culturalPriorRepository,
    threads,
    agent,
    logger: fastify.log,
  });

  // Slice C — construct ChildrenService here so the onboarding tool loop
  // can write children rows during the interview. ChildrenService is also
  // constructed in apps/api/src/modules/children/children.routes.ts for the
  // parent-facing HTTP route — both consumers share the same KEK + repo
  // pattern. A future refactor could promote ChildrenService to a Fastify
  // plugin to eliminate the duplication; out of scope for slice C.
  const kekHex = fastify.env.ENVELOPE_ENCRYPTION_MASTER_KEY;
  const kek = kekHex ? Buffer.from(kekHex, 'hex') : null;
  // Slice 2.6-s8 — ChildrenRepository depends on ChildAllergensRepository for
  // declared_allergens reads + writes. Construct child-allergens first so the
  // 2.5-s6 declare path AND the children-routes path share the same instance.
  const childAllergensRepository = new ChildAllergensRepository(fastify.supabase, kek);
  const childrenRepository = new ChildrenRepository(
    fastify.supabase,
    kek,
    childAllergensRepository,
  );
  const childrenService = new ChildrenService(childrenRepository);

  // Slice 2-s27 — household-level food-identity service for the new
  // household.upsert agent tool. Same KEK + supabase wiring as the children
  // path; vocabulary validation lives in the service.
  const householdsRepository = new HouseholdsRepository(fastify.supabase, kek);
  const householdsService = new HouseholdsService({
    repository: householdsRepository,
    vocabulary: fastify.vocabularyService,
    logger: fastify.log,
  });

  // Slice 2.5-s4 — moment-state tracker for the chaptered conversation.
  // Sidecar to thread/turn; one row per household_id keyed in
  // onboarding_moment_state.
  const momentRepository = new OnboardingMomentRepository(fastify.supabase);

  // Slice 2.5-s6 — structured allergen + dietary repositories for the wired
  // allergen.declare / dietary.declare onboarding tools (Moment 2).
  // childAllergensRepository is constructed above (shared with childrenRepository).
  const dietaryPreferencesRepository = new DietaryPreferencesRepository(fastify.supabase);

  // Slice 2.5-s7 — food-preferences + household-rules repositories for the
  // wired food_preference.declare / rule.set onboarding tools (Moment 3).
  const foodPreferencesRepository = new FoodPreferencesRepository(fastify.supabase, kek);
  const householdRulesRepository = new HouseholdRulesRepository(fastify.supabase, kek);

  // Slice 2.6-s1 — recipes repository powers favorite_lunch.add (Moment 5 —
  // cold-start seed, FR124). The 2.5-s9 favorite_lunches table is dropped;
  // the new M5 hot path is RecipesRepository.declareForHousehold().
  const recipesRepository = new RecipesRepository(fastify.supabase);

  // Slice 2.6-s2 — Stage 0 catalog re-materialization wired into
  // OnboardingService so M3 exit triggers a fire-and-forget rematerialize().
  // Same KEK is shared with the existing childAllergens / household /
  // child-rules wires above.
  const curatedBaseline = new CuratedBaselineMaterializationService({
    curatedBaselineRepo: new CuratedBaselineRepository(fastify.supabase),
    recipesRepo: recipesRepository,
    householdsRepo: householdsRepository,
    guardrailRepo: new AllergyGuardrailRepository(fastify.supabase, kek),
    logger: fastify.log,
  });

  // Slice 2.6-s3 — BullMQ queue handle for the Stage 1 catalog-seed job.
  // OnboardingService fires the enqueue when the parent advances out of m2_safe.
  // The job plugin (catalog-seed.job.ts) provides the queue under
  // CATALOG_SEED_QUEUE — register order in app.ts guarantees availability in
  // the real Fastify app. Route-level unit tests construct a minimal Fastify
  // instance without the bullmq decorator; treat its absence as a no-op (the
  // M2 trigger in OnboardingService also guards on queue presence).
  const catalogSeedQueue: Queue<CatalogSeedJobData> | undefined = fastify.bullmq
    ? (fastify.bullmq.getQueue(CATALOG_SEED_QUEUE) as Queue<CatalogSeedJobData>)
    : undefined;

  // Slice 2.6-s4 / 16-s1 — per-household M5 chip projection. Reads the
  // generated chip suggestions at turn-time and returns ChipOption[] for the
  // Moment 5 starting-line chip card. Replaces the deleted static 18-chip set
  // and, as of 16-s1, no longer reads recipes/household_recipe_usage.
  const onboardingChipSuggestionRepository = new OnboardingChipSuggestionRepository(
    fastify.supabase,
  );
  const catalogProjection = new CatalogProjectionService({
    onboardingChipSuggestionRepository,
    householdsRepository,
    logger: fastify.log,
  });

  const householdAllergensRepository = new HouseholdAllergensRepository(fastify.supabase, kek);

  const service = new OnboardingService({
    threads,
    agent,
    culturalPriorService,
    logger: fastify.log,
    memoryService: fastify.memoryService,
    childrenService,
    culturalPriorRepository,
    householdsService,
    kitchenMapService: fastify.kitchenMapService,
    vocabularyService: fastify.vocabularyService,
    agentToolsEnabled: fastify.env.ONBOARDING_AGENT_TOOLS_ENABLED,
    momentRepository,
    childAllergensRepository,
    dietaryPreferencesRepository,
    foodPreferencesRepository,
    // Story 15-s2 — food_preference.declare dual-writes a preference_edit signal.
    signalsService: new SignalsService(fastify.supabase, kek, fastify.log),
    householdRulesRepository,
    recipesRepository,
    // Slice 16-s1 (AC 5) — checked before recipesRepository for M5 chip-key
    // resolution; same instance catalogProjection reads for the chip source.
    onboardingChipSuggestionRepository,
    curatedBaseline,
    catalogSeedQueue,
    catalogProjection,
    householdAllergensRepository,
    // Stage 1 retry accounting for the idempotent ensure.
    householdsRepository,
  });

  // Slice 2-S26 — fire-and-forget audit writer for resume / reset events.
  // The text/turn route writes onboarding.resumed when service detects a
  // mid-conversation continuation; state route writes onboarding.resume_offered;
  // reset route writes onboarding.reset. Each is a secondary write (alongside
  // the request's primary auditContext or none), so the auth.routes.ts pattern
  // (`void auditService.write(...).catch(...)`) is the right shape.
  const auditService = new AuditService(new AuditRepository(fastify.supabase));

  // R2-D3 — onboarding authors the household's cultural template, palate
  // notes, and allergen declarations. Restrict to the primary parent;
  // secondary caregivers (Story 2-3 invite) get 403.
  const requirePrimaryParent = authorize(['primary_parent']);

  fastify.post(
    '/v1/onboarding/text/turn',
    {
      preHandler: requirePrimaryParent,
      schema: {
        body: TextOnboardingTurnRequestSchema,
        response: { 200: TextOnboardingTurnResponseSchema },
      },
    },
    async (request) => {
      // Slice 2.5-s3 — discriminate text vs chip turn. Body is the Zod-parsed
      // union; chip turns are serialized to a natural-language string the
      // agent can read. The OnboardingService signature is unchanged — it
      // receives a single `message` string regardless of origin. The
      // `[Chips selected: ...]` prefix is the contract the agent prompt in
      // 2.5-s4 will be taught to recognize.
      const body = request.body as TextOnboardingTurnRequest;
      const agentMessage =
        'chip_selections' in body
          ? `[Chips selected: ${body.chip_selections.join(', ')}]${
              body.text !== undefined && body.text.length > 0 ? ` ${body.text}` : ''
            }`
          : body.message;

      const result = await service.submitTextTurn({
        userId: request.user.id,
        householdId: request.user.household_id,
        message: agentMessage,
      });
      request.log.info(
        {
          module: 'onboarding',
          action: 'onboarding.text_turn',
          user_id: request.user.id,
          household_id: request.user.household_id,
          thread_id: result.thread_id,
          message_chars: agentMessage.length,
          response_chars: result.lumi_response.length,
          is_complete: result.is_complete,
          was_resumed: result._was_resumed,
          turn_kind: 'chip_selections' in body ? 'chip' : 'text',
        },
        'onboarding text turn served',
      );

      // Slice 2-S26 — fire-and-forget audit row when this turn is a resume
      // continuation. One row per resumed turn is intentional (volume is
      // low — onboarding has ≤~10 turns total — and a per-turn count signal
      // is useful for "how often do users abandon then return" metrics).
      if (result._was_resumed) {
        void auditService
          .write({
            event_type: 'onboarding.resumed',
            user_id: request.user.id,
            household_id: request.user.household_id,
            request_id: request.id,
            metadata: {
              thread_id: result.thread_id,
              turn_id: result.turn_id,
            },
          })
          .catch((err: unknown) => {
            request.log.error(
              { err, module: 'onboarding', action: 'onboarding.resumed_audit_failed' },
              'onboarding.resumed audit write failed',
            );
          });
      }

      // Slice 2.5-s4 — chip_config now flows from the service (computed
      // from the post-turn current_moment). Always null in this slice;
      // moment slices 2.5-s5 through 2.5-s9 fill their respective branches.
      return result;
    },
  );

  // Slice 2-S26 — three-state snapshot for the /onboarding entry surface.
  // Returns minimal payload for not_started / completed (just the status),
  // and a hydrated transcript for in_progress so the client can re-mount
  // OnboardingText with prior turns prepended.
  fastify.get(
    '/v1/onboarding/state',
    {
      preHandler: requirePrimaryParent,
      schema: {
        response: { 200: OnboardingStateResponseSchema },
      },
    },
    async (request) => {
      const result = await service.getState(request.user.household_id);

      if (result.status === 'in_progress') {
        void auditService
          .write({
            event_type: 'onboarding.resume_offered',
            user_id: request.user.id,
            household_id: request.user.household_id,
            request_id: request.id,
            metadata: {
              thread_id: result.thread_id ?? null,
              modality: result.modality ?? null,
              turn_count: result.turns?.length ?? 0,
            },
          })
          .catch((err: unknown) => {
            request.log.error(
              {
                err,
                module: 'onboarding',
                action: 'onboarding.resume_offered_audit_failed',
              },
              'onboarding.resume_offered audit write failed',
            );
          });
      }

      return result;
    },
  );

  // Slice 2-S26 — close the active onboarding thread so "Start over" gives
  // the user a fresh transcript. Idempotent: 204 either way. The audit row
  // captures the prior thread_id when one was actually closed.
  fastify.post(
    '/v1/onboarding/state/reset',
    { preHandler: requirePrimaryParent },
    async (request, reply) => {
      const result = await service.resetState(request.user.household_id);
      request.auditContext = {
        event_type: 'onboarding.reset',
        user_id: request.user.id,
        household_id: request.user.household_id,
        request_id: request.id,
        metadata: {
          prior_thread_id: result.closed_thread_id,
          was_noop: result.closed_thread_id === null,
        },
      };
      return reply.code(204).send();
    },
  );

  fastify.post(
    '/v1/onboarding/text/finalize',
    {
      preHandler: requirePrimaryParent,
      schema: {
        response: { 200: TextOnboardingFinalizeResponseSchema },
      },
    },
    async (request) => {
      const result = await service.finalizeTextOnboarding({
        userId: request.user.id,
        householdId: request.user.household_id,
      });
      return result;
    },
  );

  // Story 2.14 — fire-and-forget breadcrumb that the no-approval mental-model
  // copy was actually shown to the parent at the end of onboarding (UX-DR65).
  // Non-mechanism audit: a swallowed write is fine — the screen still rendered
  // and the user moved on. Fired via the audit hook (onResponse), so the 204
  // returns regardless of audit outcome. No request body — the mere presence
  // of the call is the signal.
  fastify.post(
    '/v1/onboarding/mental-model-shown',
    { preHandler: requirePrimaryParent },
    async (request, reply) => {
      request.auditContext = {
        event_type: 'onboarding.mental_model_shown',
        user_id: request.user.id,
        household_id: request.user.household_id,
        request_id: request.id,
        metadata: {},
      };
      return reply.code(204).send();
    },
  );
};

export const onboardingRoutes = fp(onboardingRoutesPlugin, { name: 'onboarding-routes' });
