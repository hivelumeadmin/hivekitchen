import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { Buffer } from 'node:buffer';
import { z } from 'zod';
import {
  AddChildBodySchema,
  AddChildResponseSchema,
  GetChildResponseSchema,
  ListChildrenResponseSchema,
  SetBagCompositionBodySchema,
  SetBagCompositionResponseSchema,
  UpdateSchoolPolicyInputSchema,
  UpdateSchoolPolicyResponseSchema,
  GetSchoolPoliciesResponseSchema,
  SchoolPolicyChildIdParamSchema,
  UpdateExtraRulesInputSchema,
  UpdateExtraRulesResponseSchema,
  GetExtraRulesResponseSchema,
  ExtraRulesChildIdParamSchema,
  LunchLinkPauseInputSchema,
  LunchLinkPauseResponseSchema,
  ChildSignalOutputSchema,
  FlavorPassportResponseSchema,
  ResetFlavorJourneyResponseSchema,
} from '@hivekitchen/contracts';
import type {
  AddChildBody,
  SetBagCompositionBody,
  UpdateSchoolPolicyInput,
  UpdateExtraRulesInput,
  LunchLinkPauseInput,
} from '@hivekitchen/types';
import { authorize } from '../../middleware/authorize.hook.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../../common/errors.js';
import { ComplianceRepository } from '../compliance/compliance.repository.js';
import { ComplianceService } from '../compliance/compliance.service.js';
import { ChildAllergensRepository } from './child-allergens.repository.js';
import { ChildrenRepository } from './children.repository.js';
import { ChildrenService } from './children.service.js';
import { ChildPreferencesRepository } from '../child-preferences/child-preferences.repository.js';
import { loadChildSignal } from '../child-preferences/child-signal.assembler.js';
import { MemoryRepository } from '../memory/memory.repository.js';
import { FlavorJourneyResetService } from './flavor-journey-reset.service.js';
import { FlavorPassportRepository } from '../flavor-passport/flavor-passport.repository.js';
import { FlavorPassportService } from '../flavor-passport/flavor-passport.service.js';
import { SchoolPoliciesRepository } from './school-policies.repository.js';
import { SchoolPoliciesService } from './school-policies.service.js';
import { ExtraRulesRepository } from './extra-rules.repository.js';

const childrenRoutesPlugin: FastifyPluginAsync = async (fastify) => {
  const kekHex = fastify.env.ENVELOPE_ENCRYPTION_MASTER_KEY;
  const kek = kekHex ? Buffer.from(kekHex, 'hex') : null;

  // Slice 2.6-s8 — ChildrenRepository now requires a ChildAllergensRepository
  // because declared_allergens reads + writes route through child_allergens
  // (the legacy children.declared_allergens column is a zombie).
  const childAllergensRepository = new ChildAllergensRepository(fastify.supabase, kek);
  const childrenRepository = new ChildrenRepository(
    fastify.supabase,
    kek,
    fastify.log,
    childAllergensRepository,
  );
  const childrenService = new ChildrenService(childrenRepository);

  // Reuse the compliance service so that the parental-notice gate is enforced
  // identically here and at the dedicated /v1/compliance/* endpoints.
  const complianceService = new ComplianceService(
    new ComplianceRepository(fastify.supabase),
    fastify.log,
  );

  // Story 3.16 — school policy service. Story 3.17 moved the regen fanout
  // into PlanAdjustmentService (decorated by plansHook); this route consumes
  // it via the decorator instead of re-instantiating plans plumbing here.
  if (!fastify.planAdjustmentService) {
    throw new Error(
      'childrenRoutes requires planAdjustmentService decorator — register plansHook first',
    );
  }
  const schoolPoliciesService = new SchoolPoliciesService({
    repository: new SchoolPoliciesRepository(fastify.supabase),
    childrenRepository,
    planAdjustmentService: fastify.planAdjustmentService,
    auditService: fastify.auditService,
    logger: fastify.log,
  });

  // Story 3.21 — extra-rules repository. PII-free; no encryption needed.
  const extraRulesRepository = new ExtraRulesRepository(fastify.supabase);

  // Slice 4-S11 — Layer 2 signal read for the per-child signal-summary endpoint.
  const childPreferencesRepository = new ChildPreferencesRepository(fastify.supabase);

  // Slice 4-S12 — FlavorPassport read service for the parent endpoint.
  const flavorPassportService = new FlavorPassportService(
    new FlavorPassportRepository(fastify.supabase, fastify.log),
  );

  // Story 7-S7 — flavor-journey reset service.
  const flavorJourneyResetService = new FlavorJourneyResetService({
    childrenRepository,
    memoryRepository: new MemoryRepository(fastify.supabase),
    childPreferencesRepository,
    logger: fastify.log,
    audit: fastify.auditService,
  });

  // Story 3.28 — lunch link suppression. Decorated by plansHook; children-routes
  // depends on it so plansHook must be registered before childrenRoutes.
  if (!fastify.lunchLinkSessionRepository) {
    throw new Error(
      'childrenRoutes requires lunchLinkSessionRepository decorator — register plansHook first',
    );
  }
  const lunchLinkSessionRepository = fastify.lunchLinkSessionRepository;

  const requirePrimaryParent = authorize(['primary_parent']);
  const requireMember = authorize(['primary_parent', 'secondary_caregiver']);

  fastify.post(
    '/v1/households/:id/children',
    {
      preHandler: requirePrimaryParent,
      schema: {
        body: AddChildBodySchema,
        response: { 201: AddChildResponseSchema },
      },
    },
    async (request, reply) => {
      const { id: householdId } = request.params as { id: string };
      assertCallerInHousehold(request.user.household_id, householdId);
      await complianceService.assertParentalNoticeAcknowledged(request.user.id);

      const body = request.body as AddChildBody;
      const child = await childrenService.addChild({ householdId, body });

      // Audit metadata is intentionally PII-free — no allergen values, no
      // cultural identifiers, no name. Only the IDs and rule version that
      // ops needs to reconstruct decisions land in the audit trail.
      request.auditContext = {
        event_type: 'child.add',
        user_id: request.user.id,
        household_id: householdId,
        correlation_id: request.id,
        request_id: request.id,
        metadata: {
          child_id: child.id,
          declared_allergen_count: body.declared_allergens.length,
          cultural_identifier_count: body.cultural_identifiers.length,
          dietary_preference_count: body.dietary_preferences.length,
        },
      };

      return reply.code(201).send({ child });
    },
  );

  fastify.get(
    '/v1/households/:id/children/:childId',
    {
      preHandler: requireMember,
      schema: { response: { 200: GetChildResponseSchema } },
    },
    async (request) => {
      const { id: householdId, childId } = request.params as { id: string; childId: string };
      assertCallerInHousehold(request.user.household_id, householdId);
      const child = await childrenService.getChild({ householdId, childId });
      return { child };
    },
  );

  // Slice 4-S1 — household-scoped list endpoint. The Heart Note compose
  // surface needs the children roster to pick the active child; multi-
  // child picker UI ships in a later slice.
  fastify.get(
    '/v1/households/:id/children',
    {
      preHandler: requireMember,
      schema: { response: { 200: ListChildrenResponseSchema } },
    },
    async (request) => {
      const { id: householdId } = request.params as { id: string };
      assertCallerInHousehold(request.user.household_id, householdId);
      const children = await childrenRepository.findByHouseholdId(householdId);
      return { children };
    },
  );

  // Story 2.12: per-child bag-slot declaration. Route is child-scoped (not
  // nested under households) — household ownership is enforced from the JWT,
  // not the URL.
  fastify.patch(
    '/v1/children/:id/bag-composition',
    {
      preHandler: requirePrimaryParent,
      schema: {
        body: SetBagCompositionBodySchema,
        response: { 200: SetBagCompositionResponseSchema },
      },
    },
    async (request) => {
      const { id: childId } = request.params as { id: string };
      const householdId = request.user.household_id;

      const body = request.body as SetBagCompositionBody;
      const result = await childrenService.setBagComposition({
        householdId,
        childId,
        body,
      });

      // Audit metadata is PII-free: child_id + household_id + slot booleans
      // only. No name, no allergens, no cultural identifiers.
      request.auditContext = {
        event_type: 'child.bag_updated',
        user_id: request.user.id,
        household_id: householdId,
        correlation_id: request.id,
        request_id: request.id,
        metadata: {
          child_id: result.child.id,
          old: result.audit.old,
          new: result.audit.new,
        },
      };

      return { child: result.child };
    },
  );
  // Story 3.16: PATCH /v1/children/:id/school-policies
  // Primary Parent only — policy changes are household-level decisions and
  // affect every member of the family, not just one caregiver.
  fastify.patch(
    '/v1/children/:id/school-policies',
    {
      preHandler: requirePrimaryParent,
      schema: {
        params: SchoolPolicyChildIdParamSchema,
        body: UpdateSchoolPolicyInputSchema,
        response: { 200: UpdateSchoolPolicyResponseSchema },
      },
    },
    async (request, reply) => {
      const { id: childId } = request.params as { id: string };
      const householdId = request.user.household_id;
      const body = request.body as UpdateSchoolPolicyInput;

      const result = await schoolPoliciesService.updatePolicy({
        childId,
        householdId,
        input: body,
        requestId: request.id,
      });

      return reply.status(200).send({
        policy: result.policy,
        regeneration_triggered: result.regenerationTriggered,
        affected_plan_ids: result.affectedPlanIds,
      });
    },
  );

  // Story 3.16: GET /v1/children/:id/school-policies
  // Either caregiver may read; the audit trail captures the parent who
  // mutated. Verifies child belongs to the caller's household.
  fastify.get(
    '/v1/children/:id/school-policies',
    {
      preHandler: requireMember,
      schema: {
        params: SchoolPolicyChildIdParamSchema,
        response: { 200: GetSchoolPoliciesResponseSchema },
      },
    },
    async (request, reply) => {
      const { id: childId } = request.params as { id: string };
      const householdId = request.user.household_id;

      const policies = await schoolPoliciesService.getPoliciesForChild({
        childId,
        householdId,
      });

      return reply.status(200).send({ policies });
    },
  );

  // Story 3.21 — PATCH /v1/children/:id/extra-rules. Replaces the full
  // pin/ban set for the Extra slot. Primary Parent only — Extra rules are
  // household-level decisions and affect every plan generated for the child.
  fastify.patch(
    '/v1/children/:id/extra-rules',
    {
      preHandler: requirePrimaryParent,
      schema: {
        params: ExtraRulesChildIdParamSchema,
        body: UpdateExtraRulesInputSchema,
        response: { 200: UpdateExtraRulesResponseSchema },
      },
    },
    async (request, reply) => {
      const { id: childId } = request.params as { id: string };
      const householdId = request.user.household_id;
      const body = request.body as UpdateExtraRulesInput;

      const result = await extraRulesRepository.updateExtraRules({
        childId,
        householdId,
        pins: body.pins,
        bans: body.bans,
      });
      // Update returns null when 0 rows match — either the child does not
      // exist or it belongs to a different household. We surface 404 in both
      // cases so we don't leak existence across households.
      if (result === null) {
        throw new NotFoundError(`child not found: ${childId}`);
      }

      // Audit metadata is PII-free — only ids and rule counts. Rule strings
      // are generic component types, not child names or allergens.
      request.auditContext = {
        event_type: 'child.extra_rules_updated',
        user_id: request.user.id,
        household_id: householdId,
        correlation_id: request.id,
        request_id: request.id,
        metadata: {
          child_id: childId,
          pin_count: body.pins.length,
          ban_count: body.bans.length,
        },
      };

      return reply.status(200).send(result);
    },
  );

  // Story 3.21 — GET /v1/children/:id/extra-rules. Either caregiver may read;
  // household ownership is enforced via the household_id filter in the query.
  fastify.get(
    '/v1/children/:id/extra-rules',
    {
      preHandler: requireMember,
      schema: {
        params: ExtraRulesChildIdParamSchema,
        response: { 200: GetExtraRulesResponseSchema },
      },
    },
    async (request, reply) => {
      const { id: childId } = request.params as { id: string };
      const householdId = request.user.household_id;

      const extra_rules = await extraRulesRepository.findExtraRulesForChild(childId, householdId);
      if (extra_rules === null) {
        throw new NotFoundError(`child not found: ${childId}`);
      }

      return reply.status(200).send({ child_id: childId, extra_rules });
    },
  );

  // Slice 4-S11 — GET /v1/children/:childId/signal-summary
  // Per-child Layer 2 preference summary (30-day lookback). Primary Parent only.
  // This is the verification surface for the child_preferences feedback loop —
  // there is no web UI in this slice. family_liked stays household-scoped (the
  // parent owns every child in the household); per_child is filtered to the
  // requested child only.
  fastify.get(
    '/v1/children/:childId/signal-summary',
    {
      preHandler: requirePrimaryParent,
      schema: { response: { 200: ChildSignalOutputSchema } },
    },
    async (request, reply) => {
      const { childId } = request.params as { childId: string };
      const householdId = request.user.household_id;

      // Ownership: 404 if the child is not in the caller's household.
      const child = await childrenRepository.findById(householdId, childId);
      if (child === null) throw new NotFoundError(`child not found: ${childId}`);

      const signal = await loadChildSignal({
        childPrefsRepo: childPreferencesRepository,
        childrenRepo: childrenRepository,
        householdId,
        lookbackDays: 30,
      });

      return reply.status(200).send({
        per_child: signal.per_child.filter((c) => c.child_id === childId),
        family_liked: signal.family_liked,
      });
    },
  );

  // Slice 4-S12 — GET /v1/children/:childId/flavor-passport
  // Per-child cumulative flavor journey. Either caregiver may read. The query is
  // household-scoped, so a childId outside the caller's household simply yields
  // an empty passport (no existence oracle). Parent view orders chronologically
  // (childFirst:false) — the journey from the beginning.
  fastify.get(
    '/v1/children/:childId/flavor-passport',
    {
      preHandler: requireMember,
      schema: {
        params: z.object({ childId: z.string().uuid() }),
        response: { 200: FlavorPassportResponseSchema },
      },
    },
    async (request, reply) => {
      const { childId } = request.params as { childId: string };
      const householdId = request.user.household_id;

      const passport = await flavorPassportService.buildPassport(childId, householdId, {
        childFirst: false,
      });

      return reply.status(200).send(passport);
    },
  );

  // Story 3.28 — POST /v1/children/:childId/lunch-link-pause
  // Both caregivers can suppress/resume — the pickup parent often knows about
  // sick days before the primary parent updates the app.
  // The underlying plan_item is unchanged; only the delivery session is affected.
  fastify.post(
    '/v1/children/:childId/lunch-link-pause',
    {
      preHandler: requireMember,
      schema: {
        body: LunchLinkPauseInputSchema,
        response: { 200: LunchLinkPauseResponseSchema },
      },
    },
    async (request, reply) => {
      const { childId } = request.params as { childId: string };
      const householdId = request.user.household_id;
      const body = request.body as LunchLinkPauseInput;

      // Ownership: verify child belongs to this household.
      const child = await childrenRepository.findById(householdId, childId);
      if (!child) throw new NotFoundError(`child not found: ${childId}`);

      if (body.suppress) {
        await lunchLinkSessionRepository.suppress({
          householdId,
          childId,
          date: body.date,
          userId: request.user.id,
        });
      } else {
        await lunchLinkSessionRepository.unsuppress({ householdId, childId, date: body.date });
      }

      try {
        await fastify.auditService.write({
          event_type: body.suppress ? 'lunch_link.suppressed' : 'lunch_link.unsuppressed',
          household_id: householdId,
          user_id: request.user.id,
          request_id: request.id,
          metadata: { child_id: childId, date: body.date },
        });
      } catch (err) {
        request.log.error({ err }, 'audit write failed for lunch_link suppression');
      }

      const session = await lunchLinkSessionRepository.findByChildAndDate(householdId, childId, body.date);
      return reply.send({
        child_id: childId,
        date: body.date,
        suppressed: session?.suppressed_at != null,
        suppressed_at: session?.suppressed_at ?? null,
      });
    },
  );

  // Story 7-S7 — POST /v1/children/:childId/reset-flavor-journey
  // Primary Parent only — irreversible annual action.
  // 409 when called within 365 days of the previous reset.
  // 404 when childId does not belong to the caller's household (no oracle).
  fastify.post(
    '/v1/children/:childId/reset-flavor-journey',
    {
      preHandler: requirePrimaryParent,
      schema: {
        params: z.object({ childId: z.string().uuid() }),
        response: { 200: ResetFlavorJourneyResponseSchema },
      },
    },
    async (request, reply) => {
      const { childId } = request.params as { childId: string };
      const householdId = request.user.household_id;

      const outcome = await flavorJourneyResetService.reset(
        childId,
        householdId,
        request.user.id,
        request.id,
      );

      if (outcome.type === 'not_found') throw new NotFoundError(`child not found: ${childId}`);
      if (outcome.type === 'cooldown_active') {
        throw new ConflictError(
          `flavor journey was already reset on ${outcome.last_reset_at}`,
        );
      }

      return reply.status(200).send({
        child_id: outcome.child_id,
        reset_at: outcome.reset_at,
      });
    },
  );
};

function assertCallerInHousehold(callerHouseholdId: string, paramHouseholdId: string): void {
  if (callerHouseholdId !== paramHouseholdId) {
    throw new ForbiddenError('not a member of this household');
  }
}

export const childrenRoutes = fp(childrenRoutesPlugin, { name: 'children-routes' });
