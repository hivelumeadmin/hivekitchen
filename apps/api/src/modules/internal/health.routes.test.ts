import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import Fastify, { type FastifyInstance } from 'fastify';
import { requestIdPlugin } from '../../middleware/request-id.hook.js';
import { healthRoutes } from './health.routes.js';

describe('health.routes (unit)', () => {
  let app: FastifyInstance;
  const logLines: string[] = [];

  beforeAll(async () => {
    const logStream = new Writable({
      write(chunk: Buffer, _enc: string, cb: () => void) {
        logLines.push(chunk.toString().trim());
        cb();
      },
    });
    const REQUEST_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    app = Fastify({
      logger: { level: 'info', stream: logStream },
      genReqId(req) {
        const incoming = req.headers['x-request-id'];
        const header = Array.isArray(incoming) ? incoming[0] : incoming;
        return header && REQUEST_ID_RE.test(header) ? header : randomUUID();
      },
    });
    await app.register(requestIdPlugin);
    await app.register(healthRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /v1/health returns 200 with status ok and ISO timestamp', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { status: string; timestamp: string };
    expect(body.status).toBe('ok');
    expect(() => new Date(body.timestamp).toISOString()).not.toThrow();
  });

  it('echoes a valid UUID X-Request-Id header back on the response', async () => {
    const id = '12345678-1234-1234-1234-123456789abc';
    const res = await app.inject({
      method: 'GET',
      url: '/v1/health',
      headers: { 'x-request-id': id },
    });
    expect(res.headers['x-request-id']).toBe(id);
  });

  it('replaces a non-UUID X-Request-Id with a generated UUID', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/health',
      headers: { 'x-request-id': 'not-a-uuid' },
    });
    const echoed = res.headers['x-request-id'];
    expect(echoed).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(echoed).not.toBe('not-a-uuid');
  });

  it('generates a UUID when X-Request-Id is missing and echoes it back', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/health' });
    const id = res.headers['x-request-id'];
    expect(typeof id).toBe('string');
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('produces a Pino log line with module=health, action=health.check, reqId', async () => {
    logLines.length = 0;
    await app.inject({ method: 'GET', url: '/v1/health' });
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
    expect(healthLog!['module']).toBe('health');
    expect(healthLog!['reqId']).toBeDefined();
  });
});
