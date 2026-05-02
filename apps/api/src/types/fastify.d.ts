import type { SupabaseClient } from '@supabase/supabase-js';
import type OpenAI from 'openai';
import type { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import type Stripe from 'stripe';
import type { MailService } from '@sendgrid/mail';
import type { Twilio } from 'twilio';
import type Redis from 'ioredis';
import type { Queue, Worker, Processor } from 'bullmq';
import type { Env } from '../common/env.js';
import type { AuditWriteInput } from '../audit/audit.types.js';
import type { AuditService } from '../audit/audit.service.js';
import type { MemoryService } from '../modules/memory/memory.service.js';
import type { AllergyGuardrailService } from '../modules/allergy-guardrail/allergy-guardrail.service.js';
import type { PlansService } from '../modules/plans/plans.service.js';
import type { DomainOrchestrator } from '../agents/orchestrator.js';

interface BullMQFacade {
  getQueue(name: string): Queue;
  getWorker(name: string, processor: Processor): Worker;
}

declare module 'fastify' {
  interface FastifyInstance {
    env: Env;
    supabase: SupabaseClient;
    openai: OpenAI;
    elevenlabs: ElevenLabsClient;
    stripe: Stripe;
    sendgrid: MailService;
    twilio: Twilio;
    redis: Redis;
    bullmq: BullMQFacade;
    auditService: AuditService;
    memoryService: MemoryService;
    allergyGuardrailService: AllergyGuardrailService;
    plansService: PlansService;
    orchestrator: DomainOrchestrator;
  }

  interface FastifyRequest {
    auditContext?: AuditWriteInput;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    // Two payload shapes share the same JWT_SECRET / @fastify/jwt instance:
    //   - access tokens: { sub, hh, role } — issued at login/refresh, sent in Authorization header.
    //   - invite tokens: { household_id, role, invite_id, jti } — issued by Story 2.3 invite create,
    //     sent as a body field on POST /v1/auth/invites/redeem (never in Authorization header).
    // Read sites pin the shape via the typed generic: jwt.verify<AccessTokenPayload>() /
    // jwt.verify<InviteClaims>(). The union here lets jwt.sign() accept either shape.
    payload:
      | {
          sub: string;
          hh: string;
          role: 'primary_parent' | 'secondary_caregiver' | 'guest_author' | 'ops';
        }
      | {
          household_id: string;
          role: 'secondary_caregiver' | 'guest_author';
          invite_id: string;
          jti: string;
        };
    user: {
      id: string;
      household_id: string;
      role: 'primary_parent' | 'secondary_caregiver' | 'guest_author' | 'ops';
    };
  }
}
