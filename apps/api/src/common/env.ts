import { z } from 'zod';

// Treat empty-string env values (common in committed .env.example templates) as unset
// so Zod `.optional()` applies its default/absent semantics instead of failing validation.
const optionalEmptyAsUndefined = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), schema.optional());

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'staging', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  OPENAI_API_KEY: z.string().min(1),

  ELEVENLABS_API_KEY: z.string().min(1),
  ELEVENLABS_WEBHOOK_SECRET: z.string().min(1),

  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_WEBHOOK_SECRET: z.string().min(1),

  SENDGRID_API_KEY: z.string().min(1),

  TWILIO_ACCOUNT_SID: z
    .string()
    .regex(/^AC[0-9a-fA-F]{32}$/, 'must be an AC-prefixed 34-char Twilio Account SID'),
  TWILIO_AUTH_TOKEN: z.string().min(1),

  REDIS_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),

  OTEL_EXPORTER_OTLP_ENDPOINT: optionalEmptyAsUndefined(z.string().url()),
  OTEL_EXPORTER_OTLP_HEADERS: optionalEmptyAsUndefined(z.string()),
});

export type Env = z.infer<typeof EnvSchema>;

export { EnvSchema };

export function parseEnv(): Env {
  const result = EnvSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    process.stderr.write(
      JSON.stringify({ level: 60, msg: `Env validation failed — ${issues}`, time: Date.now() }) +
        '\n',
    );
    process.exit(1);
  }
  return result.data;
}
