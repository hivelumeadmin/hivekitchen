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
  }

  interface FastifyRequest {
    auditContext?: AuditWriteInput;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: {
      sub: string;
      hh: string;
      role: 'primary_parent' | 'secondary_caregiver' | 'guest_author' | 'ops';
    };
    user: {
      id: string;
      household_id: string;
      role: 'primary_parent' | 'secondary_caregiver' | 'guest_author' | 'ops';
    };
  }
}
