import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { Buffer } from 'node:buffer';
import {
  AddChildBodySchema,
  AddChildResponseSchema,
  GetChildResponseSchema,
  SetBagCompositionBodySchema,
  SetBagCompositionResponseSchema,
} from '@hivekitchen/contracts';
import type { AddChildBody, SetBagCompositionBody } from '@hivekitchen/types';
import { authorize } from '../../middleware/authorize.hook.js';
import { ForbiddenError } from '../../common/errors.js';
import { ComplianceRepository } from '../compliance/compliance.repository.js';
import { ComplianceService } from '../compliance/compliance.service.js';
import { ChildrenRepository } from './children.repository.js';
import { ChildrenService } from './children.service.js';

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
};

function assertCallerInHousehold(callerHouseholdId: string, paramHouseholdId: string): void {
  if (callerHouseholdId !== paramHouseholdId) {
    throw new ForbiddenError('not a member of this household');
  }
}

export const childrenRoutes = fp(childrenRoutesPlugin, { name: 'children-routes' });
