import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { Buffer } from 'node:buffer';
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
} from '@hivekitchen/contracts';
import type {
  AddChildBody,
  SetBagCompositionBody,
  UpdateSchoolPolicyInput,
  UpdateExtraRulesInput,
} from '@hivekitchen/types';
import { authorize } from '../../middleware/authorize.hook.js';
import { ForbiddenError, NotFoundError } from '../../common/errors.js';
import { ComplianceRepository } from '../compliance/compliance.repository.js';
import { ComplianceService } from '../compliance/compliance.service.js';
import { ChildrenRepository } from './children.repository.js';
import { ChildrenService } from './children.service.js';
import { SchoolPoliciesRepository } from './school-policies.repository.js';
import { SchoolPoliciesService } from './school-policies.service.js';
import { ExtraRulesRepository } from './extra-rules.repository.js';

const childrenRoutesPlugin: FastifyPluginAsync = async (fastify) => {
  const kekHex = fastify.env.ENVELOPE_ENCRYPTION_MASTER_KEY;
  const kek = kekHex ? Buffer.from(kekHex, 'hex') : null;

  const childrenRepository = new ChildrenRepository(fastify.supabase, kek, fastify.log);
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
          allergen_rule_version: child.allergen_rule_version,
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
};

function assertCallerInHousehold(callerHouseholdId: string, paramHouseholdId: string): void {
  if (callerHouseholdId !== paramHouseholdId) {
    throw new ForbiddenError('not a member of this household');
  }
}

export const childrenRoutes = fp(childrenRoutesPlugin, { name: 'children-routes' });
