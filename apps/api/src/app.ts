import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import sensible from '@fastify/sensible';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import { ZodError } from 'zod';
import type { Env } from './common/env.js';
import { getLoggerOptions } from './common/logger.js';
import { isDomainError } from './common/errors.js';
import { otelPlugin } from './plugins/otel.plugin.js';
import { requestIdPlugin } from './middleware/request-id.hook.js';
import { auditHook } from './middleware/audit.hook.js';
import { vaultPlugin } from './plugins/vault.plugin.js';
import { supabasePlugin } from './plugins/supabase.plugin.js';
import { openaiPlugin } from './plugins/openai.plugin.js';
import { elevenlabsPlugin } from './plugins/elevenlabs.plugin.js';
import { stripePlugin } from './plugins/stripe.plugin.js';
import { sendgridPlugin } from './plugins/sendgrid.plugin.js';
import { twilioPlugin } from './plugins/twilio.plugin.js';
import { ioredisPlugin } from './plugins/ioredis.plugin.js';
import { bullmqPlugin } from './plugins/bullmq.plugin.js';
import { auditPartitionRotationPlugin } from './jobs/audit-partition-rotation.job.js';
import { healthRoutes } from './modules/internal/health.routes.js';
import { eventsRoutes } from './routes/v1/events/events.routes.js';
import { authRoutes } from './modules/auth/auth.routes.js';

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
  await app.register(elevenlabsPlugin);
  await app.register(stripePlugin);
  await app.register(sendgridPlugin);
  await app.register(twilioPlugin);
  await app.register(ioredisPlugin);
  await app.register(bullmqPlugin);

  await app.register(auditHook);
  await app.register(auditPartitionRotationPlugin);

  await app.register(cookie, { secret: env.JWT_SECRET });
  await app.register(jwt, {
    secret: env.JWT_SECRET,
    sign: { expiresIn: '15m' },
  });

  await app.register(sensible);

  await app.register(cors, {
    origin: env.CORS_ALLOWED_ORIGINS,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
  });

  app.setErrorHandler((err, request, reply) => {
    if (isDomainError(err)) {
      void reply.status(err.status).type('application/problem+json').send({
        type: err.type,
        status: err.status,
        title: err.title,
        detail: err.detail,
        instance: request.id,
      });
      return;
    }

    const zodError = extractZodError(err);
    if (zodError !== null) {
      void reply.status(400).type('application/problem+json').send({
        type: '/errors/validation',
        status: 400,
        title: 'Validation failed',
        detail: zodError.issues
          .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
          .join('; '),
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

  return app;
}

function extractZodError(err: unknown): ZodError | null {
  if (err instanceof ZodError) return err;
  const obj = err as { cause?: unknown; validation?: unknown };
  if (obj.cause instanceof ZodError) return obj.cause;
  // fastify-type-provider-zod v4 attaches the Zod error under .validation.
  if (Array.isArray(obj.validation)) {
    const first = obj.validation[0] as { instancePath?: string } | undefined;
    if (first && typeof first === 'object') {
      // Synthesize a ZodError-like shape from Fastify's validation entries.
      const pseudo = {
        issues: (obj.validation as Array<{ message?: string; instancePath?: string }>).map((v) => ({
          path: v.instancePath ? v.instancePath.split('/').filter(Boolean) : [],
          message: v.message ?? 'invalid',
        })),
      } as unknown as ZodError;
      return pseudo;
    }
  }
  return null;
}
