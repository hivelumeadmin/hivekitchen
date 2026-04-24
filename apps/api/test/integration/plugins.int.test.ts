import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { parseEnv } from '../../src/common/env.js';
import { buildApp } from '../../src/app.js';

const SKIP = !process.env['CI_INTEGRATION'];

describe('Plugin bootstrap', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    if (SKIP) return;
    const env = parseEnv();
    app = await buildApp({ env });
    await app.ready();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it.skipIf(SKIP)('decorates fastify.supabase', () => {
    expect(app.supabase).toBeDefined();
  });

  it.skipIf(SKIP)('decorates fastify.openai', () => {
    expect(app.openai).toBeDefined();
  });

  it.skipIf(SKIP)('decorates fastify.elevenlabs', () => {
    expect(app.elevenlabs).toBeDefined();
  });

  it.skipIf(SKIP)('decorates fastify.stripe', () => {
    expect(app.stripe).toBeDefined();
  });

  it.skipIf(SKIP)('decorates fastify.sendgrid', () => {
    expect(app.sendgrid).toBeDefined();
  });

  it.skipIf(SKIP)('decorates fastify.twilio', () => {
    expect(app.twilio).toBeDefined();
  });

  it.skipIf(SKIP)('decorates fastify.redis and redis is ready', async () => {
    expect(app.redis).toBeDefined();
    expect(await app.redis.ping()).toBe('PONG');
  });

  it.skipIf(SKIP)('decorates fastify.bullmq with getQueue/getWorker', () => {
    expect(typeof app.bullmq.getQueue).toBe('function');
    expect(typeof app.bullmq.getWorker).toBe('function');
  });
});
