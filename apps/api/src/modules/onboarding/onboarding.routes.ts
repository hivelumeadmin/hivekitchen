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
import { authorize } from '../../middleware/authorize.hook.js';
import { ChildrenRepository } from '../children/children.repository.js';
import { ChildrenService } from '../children/children.service.js';
import { CulturalPriorRepository } from '../cultural-priors/cultural-prior.repository.js';
import { CulturalPriorService } from '../cultural-priors/cultural-prior.service.js';
import { HouseholdsRepository } from '../households/households.repository.js';
import { HouseholdsService } from '../households/households.service.js';
import { AuditRepository } from '../../audit/audit.repository.js';
import { AuditService } from '../../audit/audit.service.js';
import { OnboardingService } from './onboarding.service.js';

const onboardingRoutesPlugin: FastifyPluginAsync = async (fastify) => {
  const threads = new ThreadRepository(fastify.supabase);
  const agent = new OnboardingAgent(fastify.openai);
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
  const childrenRepository = new ChildrenRepository(fastify.supabase, kek, fastify.log);
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

      // Slice 2.5-s3 — chip_config is always null in this slice. The agent
      // gains the ability to emit chip configs in 2.5-s4 alongside the
      // chaptered-conversation prompt.
      return { ...result, chip_config: null };
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
