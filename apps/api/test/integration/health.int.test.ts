import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Writable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { parseEnv } from '../../src/common/env.js';
import { buildApp } from '../../src/app.js';

const SKIP = !process.env['CI_INTEGRATION'];

describe('Health smoke test', () => {
  let app: FastifyInstance | undefined;
  const logLines: string[] = [];

  beforeAll(async () => {
    if (SKIP) return;
    const env = parseEnv();
    const logStream = new Writable({
      write(chunk: Buffer, _enc: string, cb: () => void) {
        logLines.push(chunk.toString().trim());
        cb();
      },
    });
    app = await buildApp({ env, logStream });
    await app.ready();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it.skipIf(SKIP)('GET /v1/health returns 200 with status ok', async () => {
    const res = await app!.inject({ method: 'GET', url: '/v1/health' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { status: string };
    expect(body.status).toBe('ok');
  });

  it.skipIf(SKIP)('GET /v1/health echoes X-Request-Id in response', async () => {
    const res = await app!.inject({
      method: 'GET',
      url: '/v1/health',
      headers: { 'x-request-id': '12345678-1234-1234-1234-123456789abc' },
    });
    expect(res.headers['x-request-id']).toBe('12345678-1234-1234-1234-123456789abc');
  });

  it.skipIf(SKIP)('GET /v1/health produces Pino log with requestId', async () => {
    logLines.length = 0;
    await app!.inject({ method: 'GET', url: '/v1/health' });
    const healthLog = logLines
      .map((l) => {
        try {
          return JSON.parse(l) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .find((l) => l !== null && l['action'] === 'health.check');
    expect(healthLog).toBeDefined();
    expect(healthLog!['reqId']).toBeDefined();
  });
});
