import { describe, it, expect, afterEach } from 'vitest';
import type { Env } from '../common/env.js';
import { initOtel, shutdownOtel } from './otel.js';

function fakeEnv(overrides: Partial<Env> = {}): Pick<
  Env,
  'NODE_ENV' | 'OTEL_EXPORTER_OTLP_ENDPOINT' | 'OTEL_EXPORTER_OTLP_HEADERS'
> {
  return {
    NODE_ENV: 'test',
    OTEL_EXPORTER_OTLP_ENDPOINT: undefined,
    OTEL_EXPORTER_OTLP_HEADERS: undefined,
    ...overrides,
  };
}

describe('initOtel / shutdownOtel', () => {
  afterEach(async () => {
    await shutdownOtel();
  });

  it('starts and shuts down cleanly in test mode (ConsoleSpanExporter)', async () => {
    expect(() => initOtel(fakeEnv())).not.toThrow();
    await expect(shutdownOtel()).resolves.toBeUndefined();
  });

  it('shutdownOtel is a no-op when the SDK was never started', async () => {
    await expect(shutdownOtel()).resolves.toBeUndefined();
  });

  it('starts in production mode with OTLP endpoint configured', () => {
    expect(() =>
      initOtel(
        fakeEnv({
          NODE_ENV: 'production',
          OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otlp.example.com/v1/traces',
          OTEL_EXPORTER_OTLP_HEADERS: 'Authorization=Bearer xyz,X-Scope=foo',
        }),
      ),
    ).not.toThrow();
  });

  it('falls back to ConsoleSpanExporter in production when endpoint is absent', () => {
    expect(() =>
      initOtel(fakeEnv({ NODE_ENV: 'production', OTEL_EXPORTER_OTLP_ENDPOINT: undefined })),
    ).not.toThrow();
  });
});
