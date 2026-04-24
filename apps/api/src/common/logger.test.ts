import { describe, it, expect } from 'vitest';
import type { Env } from './env.js';
import { getLoggerOptions } from './logger.js';

function fakeEnv(overrides: Partial<Env> = {}): Env {
  return {
    NODE_ENV: 'production',
    PORT: 3001,
    LOG_LEVEL: 'info',
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-role',
    OPENAI_API_KEY: 'test-openai',
    ELEVENLABS_API_KEY: 'test-11',
    ELEVENLABS_WEBHOOK_SECRET: 'test-11-webhook',
    STRIPE_SECRET_KEY: 'sk_test',
    STRIPE_WEBHOOK_SECRET: 'whsec_test',
    SENDGRID_API_KEY: 'SG.test',
    TWILIO_ACCOUNT_SID: 'AC00000000000000000000000000000000',
    TWILIO_AUTH_TOKEN: 'twilio-token',
    REDIS_URL: 'redis://localhost:6379',
    JWT_SECRET: 'a'.repeat(32),
    OTEL_EXPORTER_OTLP_ENDPOINT: undefined,
    OTEL_EXPORTER_OTLP_HEADERS: undefined,
    ...overrides,
  } as Env;
}

describe('getLoggerOptions', () => {
  it('returns base options with LOG_LEVEL and redact.remove=true in production', () => {
    const opts = getLoggerOptions(fakeEnv({ NODE_ENV: 'production', LOG_LEVEL: 'warn' }));
    expect(opts).toBeTruthy();
    if (typeof opts === 'boolean' || !opts) throw new Error('expected options object');
    expect(opts.level).toBe('warn');
    expect(opts.redact).toBeDefined();
    const redact = opts.redact as { paths: string[]; remove: boolean };
    expect(redact.remove).toBe(true);
    expect(redact.paths).toContain('req.headers.authorization');
    expect(redact.paths).toContain('req.headers.cookie');
    expect(redact.paths).toContain('*.heart_note_content');
    expect(redact.paths).toContain('*.child_name');
    expect(redact.paths).toContain('*.declared_allergens');
    expect(redact.paths).toContain('*.cultural_identifiers');
    expect(redact.paths).toContain('*.dietary_preferences');
    expect(redact.paths).toContain('*.card');
    expect(redact.paths).toContain('*.cvv');
  });

  it('enables pino-pretty transport in development', () => {
    const opts = getLoggerOptions(fakeEnv({ NODE_ENV: 'development' }));
    if (typeof opts === 'boolean' || !opts) throw new Error('expected options object');
    const transport = (opts as { transport?: { target: string } }).transport;
    expect(transport).toBeDefined();
    expect(transport!.target).toBe('pino-pretty');
  });

  it('does NOT enable pino-pretty transport in staging', () => {
    const opts = getLoggerOptions(fakeEnv({ NODE_ENV: 'staging' }));
    if (typeof opts === 'boolean' || !opts) throw new Error('expected options object');
    expect((opts as { transport?: unknown }).transport).toBeUndefined();
  });

  it('does NOT enable pino-pretty transport in test', () => {
    const opts = getLoggerOptions(fakeEnv({ NODE_ENV: 'test' }));
    if (typeof opts === 'boolean' || !opts) throw new Error('expected options object');
    expect((opts as { transport?: unknown }).transport).toBeUndefined();
  });
});
