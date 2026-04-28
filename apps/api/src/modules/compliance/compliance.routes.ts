import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import {
  AcknowledgeParentalNoticeRequestSchema,
  AcknowledgeParentalNoticeResponseSchema,
  ConsentDeclarationResponseSchema,
  ParentalNoticeResponseSchema,
  VpcConsentRequestSchema,
  VpcConsentResponseSchema,
} from '@hivekitchen/contracts';
import { authorize } from '../../middleware/authorize.hook.js';
import { ComplianceRepository } from './compliance.repository.js';
import { ComplianceService } from './compliance.service.js';

const complianceRoutesPlugin: FastifyPluginAsync = async (fastify) => {
  const service = new ComplianceService(
    new ComplianceRepository(fastify.supabase),
    fastify.log,
  );

  // Both endpoints are primary_parent only — secondary caregivers cannot
  // sign the COPPA declaration on behalf of the household's primary parent.
  const requirePrimaryParent = authorize(['primary_parent']);

  fastify.get(
    '/v1/compliance/consent-declaration',
    {
      preHandler: requirePrimaryParent,
      schema: { response: { 200: ConsentDeclarationResponseSchema } },
    },
    async () => service.getConsentDeclaration(),
  );

  fastify.post(
    '/v1/compliance/vpc-consent',
    {
      preHandler: requirePrimaryParent,
      schema: {
        body: VpcConsentRequestSchema,
        response: { 200: VpcConsentResponseSchema },
      },
    },
    async (request) => {
      const { document_version } = request.body as { document_version: string };
      const result = await service.submitVpcConsent({
        userId: request.user.id,
        householdId: request.user.household_id,
        documentVersion: document_version,
        requestId: request.id,
      });
      // Audit fires via the onResponse hook reading request.auditContext —
      // same pattern as auth.routes.ts. correlation_id and household_id both
      // carry the household so the ops compliance dashboard (Story 9.6) can
      // join consent rows across views.
      request.auditContext = {
        event_type: 'vpc.consented',
        user_id: request.user.id,
        household_id: result.household_id,
        correlation_id: result.household_id,
        request_id: request.id,
        metadata: {
          mechanism: 'soft_signed_declaration',
          document_version: result.document_version,
        },
      };
      return result;
    },
  );

  // ---- Story 2.9: parental notice (informational, AADC) -------------------

  fastify.get(
    '/v1/compliance/parental-notice',
    {
      preHandler: requirePrimaryParent,
      schema: { response: { 200: ParentalNoticeResponseSchema } },
    },
    async () => service.getParentalNotice(),
  );

  fastify.post(
    '/v1/compliance/parental-notice/acknowledge',
    {
      preHandler: requirePrimaryParent,
      schema: {
        body: AcknowledgeParentalNoticeRequestSchema,
        response: { 200: AcknowledgeParentalNoticeResponseSchema },
      },
    },
    async (request) => {
      const { document_version } = request.body as { document_version: string };
      const { result, isNewAcknowledgment } = await service.acknowledgeParentalNotice({
        userId: request.user.id,
        documentVersion: document_version,
        requestId: request.id,
        log: request.log,
      });
      // Only set audit context on a fresh acknowledgment. Idempotent re-ack
      // (same user, same version) is a no-op — letting it fire would inflate
      // audit volume and falsely imply repeat acknowledgments.
      if (isNewAcknowledgment) {
        request.auditContext = {
          event_type: 'parental_notice.acknowledged',
          user_id: request.user.id,
          household_id: request.user.household_id,
          correlation_id: request.user.household_id,
          request_id: request.id,
          // Use the validated input version, not the DB round-trip value, so the
          // audit record always reflects what the user submitted.
          metadata: { document_version },
        };
      }
      return result;
    },
  );
};

export const complianceRoutes = fp(complianceRoutesPlugin, { name: 'compliance-routes' });
