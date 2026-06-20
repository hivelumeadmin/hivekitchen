import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { Buffer } from 'node:buffer';
import { z } from 'zod';
import {
  AddChildAllergenRequestSchema,
  ALLERGEN_LABELS,
  ChildAllergenMutationResponseSchema,
  SetCulturalEnforcementRequestSchema,
  SetCulturalEnforcementResponseSchema,
} from '@hivekitchen/contracts';
import type {
  AddChildAllergenRequest,
  SetCulturalEnforcementRequest,
} from '@hivekitchen/types';
import { authorize } from '../../middleware/authorize.hook.js';
import { NotFoundError } from '../../common/errors.js';
import { ChildAllergensRepository } from '../children/child-allergens.repository.js';
import { ChildrenRepository } from '../children/children.repository.js';
import { CulturalPriorRepository } from '../cultural-priors/cultural-prior.repository.js';
import { HouseholdAllergensRepository } from './household-allergens.repository.js';

// Story 7-S14 — Kitchen Profile parent-deterministic safety edits (Phase 1).
// Allergens (add/remove) + cultural-rule enforcement level. NO LLM in the write
// path. Mirrors the 7-s3 memory-edit pattern (authorize preHandler, household
// scoping from JWT, 404-on-null with no cross-household existence leak,
// PII-free audit). No migration — tables, triggers, and the `parent_edited`
// allergen source already exist; the cache bumps via DB triggers.

const kitchenProfileEditRoutesPlugin: FastifyPluginAsync = async (fastify) => {
  const kekHex = fastify.env.ENVELOPE_ENCRYPTION_MASTER_KEY;
  const kek = kekHex ? Buffer.from(kekHex, 'hex') : null;

  const householdAllergens = new HouseholdAllergensRepository(fastify.supabase, kek);
  // ChildrenRepository is used only for the household-ownership guard
  // (findById returns null for cross-household childIds → 404). It requires a
  // ChildAllergensRepository dependency, mirroring children.routes wiring.
  const childAllergens = new ChildAllergensRepository(fastify.supabase, kek);
  const children = new ChildrenRepository(fastify.supabase, kek, fastify.log, childAllergens);
  const culturalPriors = new CulturalPriorRepository(fastify.supabase);

  // Safety edits are primary-parent-only — matching school-policies / extra-rules.
  const requirePrimaryParent = authorize(['primary_parent']);

  // POST /v1/children/:childId/allergens — add one curated allergen to a child.
  fastify.post(
    '/v1/children/:childId/allergens',
    {
      preHandler: requirePrimaryParent,
      schema: {
        params: z.object({ childId: z.string().uuid() }),
        body: AddChildAllergenRequestSchema,
        response: { 200: ChildAllergenMutationResponseSchema },
      },
    },
    async (request) => {
      const { childId } = request.params as { childId: string };
      const householdId = request.user.household_id;
      const { allergen } = request.body as AddChildAllergenRequest;

      // Ownership guard — false for a missing OR cross-household child → 404
      // (no existence leak across households).
      const exists = await children.existsInHousehold(householdId, childId);
      if (!exists) throw new NotFoundError(`child not found: ${childId}`);

      await householdAllergens.declareIfNew({
        household_id: householdId,
        child_id: childId,
        allergen: ALLERGEN_LABELS[allergen],
        source: 'parent_edited',
      });

      // PII-free audit: ids + action only. The allergen string is encrypted PII
      // and never appears in metadata, logs, or error bodies.
      request.auditContext = {
        event_type: 'household.profile_updated',
        user_id: request.user.id,
        household_id: householdId,
        correlation_id: request.id,
        request_id: request.id,
        metadata: { subject: 'child_allergen', child_id: childId, action: 'added' },
      };

      const allergens = await householdAllergens.findByHouseholdAndChild(householdId, childId);
      return { child_id: childId, allergens };
    },
  );

  // DELETE /v1/children/:childId/allergens/:allergen — remove one allergen by value.
  // Value is in the URL path (not the body) so proxy/CDN body-stripping cannot
  // silently turn removes into 400s. Fastify URL-decodes the param automatically.
  fastify.delete(
    '/v1/children/:childId/allergens/:allergen',
    {
      preHandler: requirePrimaryParent,
      schema: {
        params: z.object({ childId: z.string().uuid(), allergen: z.string().min(1).max(100) }),
        response: { 200: ChildAllergenMutationResponseSchema },
      },
    },
    async (request) => {
      const { childId, allergen } = request.params as { childId: string; allergen: string };
      const householdId = request.user.household_id;

      const exists = await children.existsInHousehold(householdId, childId);
      if (!exists) throw new NotFoundError(`child not found: ${childId}`);

      const deleted = await householdAllergens.deleteOneByAllergen(householdId, childId, allergen);
      if (!deleted) throw new NotFoundError('allergen not found');

      request.auditContext = {
        event_type: 'household.profile_updated',
        user_id: request.user.id,
        household_id: householdId,
        correlation_id: request.id,
        request_id: request.id,
        metadata: { subject: 'child_allergen', child_id: childId, action: 'removed' },
      };

      const allergens = await householdAllergens.findByHouseholdAndChild(householdId, childId);
      return { child_id: childId, allergens };
    },
  );

  // PATCH /v1/households/:id/cultural-priors/enforcement — set the enforcement
  // level on a cultural rule, keyed by the prior's `key` (the identifier the
  // KitchenMap projection exposes). Distinct from the ratify route (which
  // drives the opt_in/forget state machine).
  fastify.patch(
    '/v1/households/:id/cultural-priors/enforcement',
    {
      preHandler: requirePrimaryParent,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: SetCulturalEnforcementRequestSchema,
        response: { 200: SetCulturalEnforcementResponseSchema },
      },
    },
    async (request) => {
      const { id: householdId } = request.params as { id: string };
      if (householdId !== request.user.household_id) {
        throw new NotFoundError('household not found');
      }
      const { key, enforcement } = request.body as SetCulturalEnforcementRequest;

      const updated = await culturalPriors.updateEnforcementByKey(householdId, key, enforcement);
      if (updated === null) throw new NotFoundError('cultural prior not found');

      // PII-free: key + enforcement are system identifiers/constants, not child
      // names or allergens.
      request.auditContext = {
        event_type: 'household.profile_updated',
        user_id: request.user.id,
        household_id: householdId,
        correlation_id: request.id,
        request_id: request.id,
        metadata: { subject: 'cultural_enforcement', key: updated.key, enforcement },
      };

      return { key: updated.key, enforcement: updated.enforcement };
    },
  );
};

export const kitchenProfileEditRoutes = fp(kitchenProfileEditRoutesPlugin, {
  name: 'kitchen-profile-edit-routes',
});
