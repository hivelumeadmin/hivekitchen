import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  FamilyLanguageRatifyBodySchema,
  FamilyLanguageRatifyResponseSchema,
  FamilyLanguageTermsResponseSchema,
} from '@hivekitchen/contracts';
import type { FamilyLanguageRatifyBody } from '@hivekitchen/types';
import { authorize } from '../../middleware/authorize.hook.js';
import { ForbiddenError } from '../../common/errors.js';
import { FamilyLanguageRepository } from './family-language.repository.js';
import { FamilyLanguageService } from './family-language.service.js';

const familyLanguageRoutesPlugin: FastifyPluginAsync = async (fastify) => {
  const repository = new FamilyLanguageRepository(fastify.supabase);
  const service = new FamilyLanguageService(repository);

  const requirePrimaryParent = authorize(['primary_parent']);
  const requireMember = authorize(['primary_parent', 'secondary_caregiver']);

  // Review patch (5-S10): the web reads the household's terms so an already-resolved
  // family_language_prompt turn (state !== 'candidate') is suppressed on re-hydration
  // instead of replaying the card. Any household member may read; ratify stays
  // primary_parent-only.
  fastify.get(
    '/v1/households/:id/family-language',
    {
      preHandler: requireMember,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: FamilyLanguageTermsResponseSchema },
      },
    },
    async (request) => {
      const { id: householdId } = request.params as { id: string };
      assertCallerInHousehold(request.user.household_id, householdId);
      const terms = await repository.getTerms(householdId);
      return { terms };
    },
  );

  fastify.post(
    '/v1/households/:id/family-language/ratify',
    {
      preHandler: requirePrimaryParent,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: FamilyLanguageRatifyBodySchema,
        response: { 200: FamilyLanguageRatifyResponseSchema },
      },
    },
    async (request) => {
      const { id: householdId } = request.params as { id: string };
      assertCallerInHousehold(request.user.household_id, householdId);

      const body = request.body as FamilyLanguageRatifyBody;
      const result = await service.ratify({
        householdId,
        term: body.term,
        action: body.action,
      });

      // Audit only fires on a real state transition (opt_in / forget on a
      // candidate). Metadata is PII-safe: maps_to + state codes only — the
      // family-language word itself is NEVER written to audit.
      if (result.audit) {
        request.auditContext = {
          event_type: 'template.state_changed',
          user_id: request.user.id,
          household_id: householdId,
          correlation_id: request.id,
          request_id: request.id,
          metadata: {
            maps_to: result.audit.maps_to,
            from_state: result.audit.from_state,
            to_state: result.audit.to_state,
          },
        };
      }

      return {
        term: result.term,
        ...(result.lumi_response !== undefined ? { lumi_response: result.lumi_response } : {}),
      };
    },
  );
};

function assertCallerInHousehold(callerHouseholdId: string, paramHouseholdId: string): void {
  if (callerHouseholdId !== paramHouseholdId) {
    throw new ForbiddenError('not a member of this household');
  }
}

export const familyLanguageRoutes = fp(familyLanguageRoutesPlugin, {
  name: 'family-language-routes',
});
