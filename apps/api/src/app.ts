import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import sensible from '@fastify/sensible';
import cors from '@fastify/cors';
import type { Env } from './common/env.js';
import { getLoggerOptions } from './common/logger.js';
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

  await app.register(sensible);

  await app.register(cors, {
    origin: env.CORS_ALLOWED_ORIGINS,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    // credentials: true must be re-enabled when JWT moves to cookies (Story 2.2).
  });

  await app.register(healthRoutes);
  await app.register(eventsRoutes);

  return app;
}
