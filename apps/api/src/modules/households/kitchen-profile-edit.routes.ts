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
  SetCulturalStateRequestSchema,
  SetCulturalStateResponseSchema,
  SetFavoriteLunchesRequestSchema,
  SetFavoriteLunchesResponseSchema,
} from '@hivekitchen/contracts';
import type {
  AddChildAllergenRequest,
  SetCulturalEnforcementRequest,
  SetCulturalStateRequest,
  SetFavoriteLunchesRequest,
} from '@hivekitchen/types';
import { authorize } from '../../middleware/authorize.hook.js';
import { NotFoundError } from '../../common/errors.js';
import { OnboardingAgent } from '../../agents/onboarding.agent.js';
import { OpenAIAdapter } from '../../agents/providers/openai.adapter.js';
import { ChildAllergensRepository } from '../children/child-allergens.repository.js';
import { ChildrenRepository } from '../children/children.repository.js';
import { CulturalPriorRepository } from '../cultural-priors/cultural-prior.repository.js';
import { CulturalPriorService } from '../cultural-priors/cultural-prior.service.js';
import { RecipesRepository, canonicalizeFavoriteName } from '../recipe/recipes.repository.js';
import { ThreadRepository } from '../threads/thread.repository.js';
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
  // Story 7-S15 (Arc B) — reuse the cultural-prior state machine for the
  // key-addressed opt_in/forget endpoint. threads + agent are only exercised by
  // the 'tell_lumi_more' action, which this endpoint never sends; they are wired
  // here to satisfy the service constructor.
  const culturalPriorService = new CulturalPriorService({
    repository: culturalPriors,
    threads: new ThreadRepository(fastify.supabase),
    agent: new OnboardingAgent(new OpenAIAdapter(fastify.openai)),
    logger: fastify.log,
  });
  // Story 7-S15 (Arc A) — starting-line favorites live in recipes +
  // household_recipe_usage (the favorite_lunches table was dropped in 2.6-s1).
  const recipes = new RecipesRepository(fastify.supabase);

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

  // Story 7-S15 (Arc B) — PATCH /v1/households/:id/cultural-priors/state.
  // Activate (opt_in) or deactivate (forget) a cultural identity element, keyed
  // by the prior's `key` (the only identifier the kitchen-profile chips have).
  // Fastify routes the static `/state` segment ahead of the parametric
  // `/:priorId` ratify route regardless of registration order, so there is no
  // ambiguity with the UUID-keyed endpoint in cultural-prior.routes.ts.
  fastify.patch(
    '/v1/households/:id/cultural-priors/state',
    {
      preHandler: requirePrimaryParent,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: SetCulturalStateRequestSchema,
        response: { 200: SetCulturalStateResponseSchema },
      },
    },
    async (request) => {
      const { id: householdId } = request.params as { id: string };
      if (householdId !== request.user.household_id) {
        throw new NotFoundError('household not found');
      }
      const { key, action } = request.body as SetCulturalStateRequest;

      const found = await culturalPriors.findByKeyForHousehold(householdId, key);
      if (found === null) throw new NotFoundError('cultural prior not found');

      const result = await culturalPriorService.ratify({
        householdId,
        priorId: found.id,
        action,
      });

      // Audit only on an actual state transition (mirrors the ratify route);
      // an idempotent no-op carries no audit. PII-free: prior_id + key + state
      // codes only.
      if (result.audit) {
        request.auditContext = {
          event_type: 'template.state_changed',
          user_id: request.user.id,
          household_id: householdId,
          correlation_id: request.id,
          request_id: request.id,
          metadata: {
            prior_id: result.audit.prior_id,
            key: result.audit.key,
            from_state: result.audit.from_state,
            to_state: result.audit.to_state,
          },
        };
      }

      return { key: found.key, state: result.prior.state };
    },
  );

  // Story 7-S15 (Arc A) — PUT /v1/households/:id/favorite-lunches. Replace-
  // semantics: the body carries the FULL desired starting-line list; the route
  // diffs against the current set and declares additions / revokes removals.
  // Comparison is on the canonical (normalized, case-insensitive) form so a
  // re-typed existing favorite is not churned remove-then-add.
  fastify.put(
    '/v1/households/:id/favorite-lunches',
    {
      preHandler: requirePrimaryParent,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: SetFavoriteLunchesRequestSchema,
        response: { 200: SetFavoriteLunchesResponseSchema },
      },
    },
    async (request) => {
      const { id: householdId } = request.params as { id: string };
      if (householdId !== request.user.household_id) {
        throw new NotFoundError('household not found');
      }
      const { items } = request.body as SetFavoriteLunchesRequest;

      const current = await recipes.findHouseholdFavorites(householdId);
      const keyOf = (s: string) => canonicalizeFavoriteName(s).toLowerCase();
      const requested = new Map(items.map((i) => [keyOf(i), i]));
      const existing = new Map(current.map((c) => [keyOf(c), c]));

      let added = 0;
      let removed = 0;
      for (const [k, item] of requested) {
        if (k.length > 0 && !existing.has(k)) {
          await recipes.declareForHousehold(householdId, item);
          added += 1;
        }
      }
      for (const [k, name] of existing) {
        if (!requested.has(k)) {
          await recipes.revokeHouseholdFavorite(householdId, name);
          removed += 1;
        }
      }

      // PII-free: canonical names (household food data) are NOT logged — only
      // the add/remove counts.
      request.auditContext = {
        event_type: 'household.profile_updated',
        user_id: request.user.id,
        household_id: householdId,
        correlation_id: request.id,
        request_id: request.id,
        metadata: { subject: 'favorite_lunches', added, removed },
      };

      const next = await recipes.findHouseholdFavorites(householdId);
      return { items: next };
    },
  );
};

export const kitchenProfileEditRoutes = fp(kitchenProfileEditRoutesPlugin, {
  name: 'kitchen-profile-edit-routes',
});
