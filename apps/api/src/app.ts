import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import sensible from '@fastify/sensible';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import websocket from '@fastify/websocket';
import { ZodError } from 'zod';
import type { Env } from './common/env.js';
import { getLoggerOptions } from './common/logger.js';
import { isDomainError, TooManyRequestsError } from './common/errors.js';
import { otelPlugin } from './plugins/otel.plugin.js';
import { requestIdPlugin } from './middleware/request-id.hook.js';
import { auditHook } from './middleware/audit.hook.js';
import { memoryHook } from './modules/memory/memory.hook.js';
import { allergyGuardrailHook } from './modules/allergy-guardrail/allergy-guardrail.hook.js';
import { plansHook } from './modules/plans/plans.hook.js';
import { orchestratorHook } from './agents/orchestrator.hook.js';
import { authenticateHook } from './middleware/authenticate.hook.js';
import { householdScopeHook } from './middleware/household-scope.hook.js';
import { vaultPlugin } from './plugins/vault.plugin.js';
import { supabasePlugin } from './plugins/supabase.plugin.js';
import { openaiPlugin } from './plugins/openai.plugin.js';
import { tavilyPlugin } from './plugins/tavily.plugin.js';
import { elevenlabsPlugin } from './plugins/elevenlabs.plugin.js';
import { stripePlugin } from './plugins/stripe.plugin.js';
import { sendgridPlugin } from './plugins/sendgrid.plugin.js';
import { twilioPlugin } from './plugins/twilio.plugin.js';
import { ioredisPlugin } from './plugins/ioredis.plugin.js';
import { bullmqPlugin } from './plugins/bullmq.plugin.js';
import { vocabularyPlugin } from './modules/vocabulary/vocabulary.plugin.js';
import { kitchenMapPlugin } from './modules/kitchen-map/kitchen-map.plugin.js';
import { kitchenMapRoutes } from './modules/kitchen-map/kitchen-map.routes.js';
import { auditPartitionRotationPlugin } from './jobs/audit-partition-rotation.job.js';
import { planGenerationJobPlugin } from './jobs/plan-generation.job.js';
import { planRegenerationJobPlugin } from './jobs/plan-regeneration.job.js';
import { dayOverrideRevertJobPlugin } from './jobs/day-override-revert.job.js';
import { catalogSeedJobPlugin } from './jobs/catalog-seed.job.js';
import { catalogRecoveryJobPlugin } from './jobs/catalog-recovery.job.js';
import { heartNoteDeliveryJobPlugin } from './jobs/heart-note-delivery.job.js';
import { memoryForgetJobPlugin } from './jobs/memory-forget.job.js';
import { dataExportJobPlugin } from './jobs/data-export.job.js';
import { accountDeletionJobPlugin } from './jobs/account-deletion.job.js';
import { healthRoutes } from './modules/internal/health.routes.js';
import { eventsRoutes } from './routes/v1/events/events.routes.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { inviteRoutes } from './modules/auth/invite.routes.js';
import { userRoutes } from './modules/users/user.routes.js';
import { voiceRoutes } from './modules/voice/voice.routes.js';
import { onboardingRoutes } from './modules/onboarding/onboarding.routes.js';
import { complianceRoutes } from './modules/compliance/compliance.routes.js';
import { childrenRoutes } from './modules/children/children.routes.js';
import { culturalPriorRoutes } from './modules/cultural-priors/cultural-prior.routes.js';
import { householdsRoutes } from './modules/households/households.routes.js';
import { memoryRoutes } from './modules/memory/memory.routes.js';
import { plansRoutes } from './modules/plans/plans.routes.js';
import { lumiRoutes } from './modules/lumi/lumi.routes.js';
import { heartNoteRoutes } from './modules/heart-notes/heart-note.routes.js';
import { guestAuthorRoutes } from './modules/guest-author/guest-author.routes.js';
import { lunchLinkRoutes } from './modules/lunch-link/lunch-link.routes.js';
import { childRequestRoutes } from './modules/child-requests/child-request.routes.js';

const REQUEST_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface BuildAppOptions {
  env: Env;
  logStream?: NodeJS.WritableStream;
}

export async function buildApp(opts: BuildAppOptions) {
  const { env, logStream } = opts;

  const loggerOpts = getLoggerOptions(env);

  // pino-pretty transport and `stream` override are mutually exclusive;
  // when a logStream is provided (tests), drop the transport.
  const logger = logStream
    ? { ...(loggerOpts as object), transport: undefined, stream: logStream }
    : loggerOpts;

  const app = Fastify({
    logger,
    // Slice 4-S3 Lunch Link tokens are ~310 chars (base64url payload + 64 hex).
    // find-my-way's default maxParamLength is 100, which would 404 the public
    // GET /v1/lunch-link/:token route. 1024 leaves headroom for future shapes.
    routerOptions: { maxParamLength: 1024 },
    genReqId(req) {
      const incoming = req.headers['x-request-id'];
      const header = Array.isArray(incoming) ? incoming[0] : incoming;
      return header && REQUEST_ID_RE.test(header) ? header : randomUUID();
    },
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.decorate('env', env);

  await app.register(otelPlugin);
  await app.register(requestIdPlugin);

  await app.register(vaultPlugin);

  await app.register(supabasePlugin);
  await app.register(openaiPlugin);
  await app.register(tavilyPlugin);
  await app.register(elevenlabsPlugin);
  await app.register(stripePlugin);
  await app.register(sendgridPlugin);
  await app.register(twilioPlugin);
  await app.register(ioredisPlugin);
  await app.register(bullmqPlugin);

  // Slice A0.5 — vocabulary tables loaded into memory at startup; kitchen-map
  // service decorates fastify with the projection read-through cache. Both
  // depend on supabase + redis above. vocabularyPlugin must run before any
  // service that validates tag arrays.
  await app.register(vocabularyPlugin);
  await app.register(kitchenMapPlugin);

  await app.register(auditHook);
  await app.register(memoryHook);
  await app.register(allergyGuardrailHook);
  await app.register(plansHook);
  await app.register(orchestratorHook);
  await app.register(auditPartitionRotationPlugin);
  await app.register(planGenerationJobPlugin);
  await app.register(planRegenerationJobPlugin);
  await app.register(dayOverrideRevertJobPlugin);
  // Slice 2.6-s3 — must register BEFORE onboardingRoutes so the queue is
  // available when OnboardingService submits its M2 trigger.
  // Slice 2.6-s5 — recovery plugin registered first so the recovery queue
  // exists when Stage 1 needs to enqueue. bullmq.getQueue is idempotent, so
  // registration order is functionally independent, but keeping it
  // recovery-before-seed makes the dependency graph explicit.
  await app.register(catalogRecoveryJobPlugin);
  // Slice 4-S6 — daily 06:00 UTC sweep that flips scheduled heart notes to
  // delivered. Independent of catalog jobs; ordered after recovery to keep
  // the (recovery → seed) catalog pair contiguous in the registration list.
  await app.register(heartNoteDeliveryJobPlugin);
  // Slice 7-S5 — nightly 03:00 UTC sweep that hard-deletes memory_nodes
  // soft-forgotten more than 30 days ago (the soft→hard promotion / feature
  // MVP wall). Depends on supabase + bullmq + auditService (auditHook above).
  await app.register(memoryForgetJobPlugin);
  // Slice 7-S10 — on-demand data-portability export worker (no scheduler). The
  // POST /v1/households/:id/export route enqueues; this worker composes the
  // snapshot, uploads to Supabase Storage, and emails a signed URL. Depends on
  // supabase + bullmq + sendgrid + auditService (auditHook above).
  await app.register(dataExportJobPlugin);
  // Slice 7-S11 — nightly 04:00 UTC sweep that hard-deletes households past the
  // 30-day deletion threshold (COPPA right-to-delete; regulatory MVP wall).
  // Staggered 1h after memory-forget (03:00 UTC). Depends on supabase + bullmq
  // + auditService (auditHook above).
  await app.register(accountDeletionJobPlugin);
  await app.register(catalogSeedJobPlugin);

  await app.register(cookie);
  await app.register(jwt, {
    secret: env.JWT_SECRET,
    sign: { expiresIn: '15m' },
  });

  // CORS must register BEFORE authenticateHook. @fastify/cors uses an
  // onRequest hook to attach Access-Control-Allow-* headers and to short-
  // circuit preflight OPTIONS. If it registers after the auth hook, auth
  // runs first and a 401 response is sent without CORS headers — the
  // browser then reports a CORS error instead of the real 401 (which is
  // what we were seeing on /v1/events SSE, where EventSource can't send
  // Authorization). Registering CORS first ensures every response — error
  // or not — carries the CORS headers.
  await app.register(cors, {
    origin: env.CORS_ALLOWED_ORIGINS,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
  });

  await app.register(authenticateHook);
  await app.register(householdScopeHook);

  await app.register(sensible);
  await app.register(websocket);

  app.setErrorHandler((err, request, reply) => {
    if (isDomainError(err)) {
      // Story 3.13 — 429 responses must carry Retry-After per architecture §3.6.
      if (err instanceof TooManyRequestsError) {
        void reply
          .status(429)
          .header('Retry-After', String(err.retryAfterSeconds))
          .type('application/problem+json')
          .send({
            type: err.type,
            status: err.status,
            title: err.title,
            detail: err.detail,
            instance: request.id,
          });
        return;
      }
      void reply.status(err.status).type('application/problem+json').send({
        type: err.type,
        status: err.status,
        title: err.title,
        detail: err.detail,
        instance: request.id,
      });
      return;
    }

    const zodIssues = extractZodIssues(err);
    if (zodIssues !== null) {
      void reply.status(400).type('application/problem+json').send({
        type: '/errors/validation',
        status: 400,
        title: 'Validation failed',
        detail: zodIssues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; '),
        instance: request.id,
      });
      return;
    }

    request.log.error({ err, action: 'unhandled.error' }, 'unhandled error');
    void reply.status(500).type('application/problem+json').send({
      type: '/errors/internal',
      status: 500,
      title: 'Internal Server Error',
      instance: request.id,
    });
  });

  await app.register(healthRoutes);
  await app.register(eventsRoutes);
  await app.register(authRoutes);
  await app.register(inviteRoutes);
  await app.register(userRoutes);
  await app.register(voiceRoutes);
  await app.register(onboardingRoutes);
  await app.register(complianceRoutes);
  await app.register(childrenRoutes);
  await app.register(culturalPriorRoutes);
  await app.register(householdsRoutes);
  await app.register(memoryRoutes);
  await app.register(plansRoutes);
  await app.register(lumiRoutes, { prefix: '/v1/lumi' });
  await app.register(heartNoteRoutes);
  await app.register(guestAuthorRoutes);
  await app.register(lunchLinkRoutes);
  await app.register(childRequestRoutes);
  await app.register(kitchenMapRoutes);

  return app;
}

interface ZodIssueShape {
  path: string[];
  message: string;
}

function extractZodIssues(err: unknown): ZodIssueShape[] | null {
  if (err instanceof ZodError) {
    return err.issues.map((i) => ({ path: i.path.map(String), message: i.message }));
  }
  const obj = err as { cause?: unknown; validation?: unknown };
  if (obj.cause instanceof ZodError) {
    return obj.cause.issues.map((i) => ({ path: i.path.map(String), message: i.message }));
  }
  // fastify-type-provider-zod v4 attaches validation errors under .validation.
  if (Array.isArray(obj.validation) && obj.validation.length > 0) {
    return (obj.validation as Array<{ message?: string; instancePath?: string }>).map((v) => ({
      path: v.instancePath ? v.instancePath.split('/').filter(Boolean) : [],
      message: v.message ?? 'invalid',
    }));
  }
  return null;
}
