import { z } from 'zod';

// Treat empty-string env values (common in committed .env.example templates) as unset
// so Zod `.optional()` applies its default/absent semantics instead of failing validation.
const optionalEmptyAsUndefined = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), schema.optional());

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'staging', 'production', 'test']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

    SUPABASE_URL: z.string().url(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
    SUPABASE_ANON_KEY: z.string().min(1),

    SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID: optionalEmptyAsUndefined(z.string().min(1)),
    SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET: optionalEmptyAsUndefined(z.string().min(1)),
    SUPABASE_AUTH_EXTERNAL_APPLE_CLIENT_ID: optionalEmptyAsUndefined(z.string().min(1)),
    SUPABASE_AUTH_EXTERNAL_APPLE_SECRET: optionalEmptyAsUndefined(z.string().min(1)),

    WEB_BASE_URL: z.string().url().default('http://localhost:5173'),

    OPENAI_API_KEY: z.string().min(1),
    // Tavily API key — backs RecipeAgent's web-search path (Story 3-31). The
    // agent restricts Tavily calls to allrecipes.com + recipetineats.com via
    // includeDomains. Missing this var crash-fails at boot rather than
    // surfacing an undefined read inside the planner agent loop.
    TAVILY_API_KEY: z.string().min(1),
    // When true, OpenAIAdapter calls omit the `OpenAI-Data-Privacy: zero-retention`
    // header so requests appear in the OpenAI dashboard's Activity/Logs panel for
    // debugging. Default false → ZDR stays on (prod-safe; OpenAI retains no
    // request bodies). Only flip true in dev environments — production calls
    // see real child + household data and should remain zero-retention.
    OPENAI_TRACES_ENABLED: z
      .preprocess(
        (v) => (typeof v === 'string' ? v.toLowerCase() === 'true' : false),
        z.boolean(),
      )
      .default(false),
    // When true, chat.completions.create calls include `store: true` and a
    // metadata block (agent_type, prompt_version) so completions accumulate
    // in the OpenAI Evals API dataset. The ZDR header is dropped automatically
    // when this flag is on — `store: true` and zero-retention are mutually
    // exclusive. Safe to enable in staging/production; stored completions are
    // accessible only via the OpenAI API, not the general Activity dashboard.
    OPENAI_STORE_COMPLETIONS: z
      .preprocess(
        (v) => (typeof v === 'string' ? v.toLowerCase() === 'true' : false),
        z.boolean(),
      )
      .default(false),
    // Slice C — when true, the OnboardingAgent uses an OpenAI function-call
    // loop in text mode to populate the kitchen map (children, cultural
    // priors, memory nodes) progressively during the conversation. When
    // false the agent runs the legacy single-shot path with batch
    // extraction at finalize. Default true; flip to 'false' for rollback.
    ONBOARDING_AGENT_TOOLS_ENABLED: z
      .preprocess(
        (v) => (typeof v === 'string' ? v.toLowerCase() !== 'false' : true),
        z.boolean(),
      )
      .default(true),
    // Slice 2.7-s3 — when set to a directory path, the OnboardingService
    // writes one per-turn agentic trace artifact (assembled prompt + dynamic
    // blocks + tool calls + usage + moment-state before/after) into it,
    // mirroring the planner's PLAN_TRACE_DIR. Off by default — leave unset in
    // prod. The tracer reads process.env.ONBOARDING_TRACE_DIR directly (same
    // pattern as createPlanTracer); this entry documents + validates the var.
    ONBOARDING_TRACE_DIR: optionalEmptyAsUndefined(z.string().min(1)),

    ELEVENLABS_API_KEY: z.string().min(1),
    ELEVENLABS_VOICE_ID: z.string().min(1),
    // Model used by the browser-direct TTS WebSocket (slice 2-S20). Flash
    // v2.5 is the low-latency English/multilingual default. Override per
    // environment if a different model is preferred.
    ELEVENLABS_TTS_MODEL_ID: z.string().min(1).default('eleven_flash_v2_5'),

    STRIPE_SECRET_KEY: z.string().min(1),
    STRIPE_WEBHOOK_SECRET: z.string().min(1),

    SENDGRID_API_KEY: z.string().min(1),

    TWILIO_ACCOUNT_SID: z
      .string()
      .regex(/^AC[0-9a-fA-F]{32}$/, 'must be an AC-prefixed 34-char Twilio Account SID'),
    TWILIO_AUTH_TOKEN: z.string().min(1),

    REDIS_URL: z.string().url(),
    JWT_SECRET: z.string().min(32),

    // 32-byte hex key (64 hex chars). Absent in dev/test → envelope encryption
    // falls through to NOOP passthrough. Required in staging/production;
    // production access is mediated by Supabase Vault (vault.plugin.ts is a stub).
    ENVELOPE_ENCRYPTION_MASTER_KEY: optionalEmptyAsUndefined(
      z.string().regex(/^[0-9a-fA-F]{64}$/, 'must be a 64-character hex string'),
    ),

    OTEL_EXPORTER_OTLP_ENDPOINT: optionalEmptyAsUndefined(z.string().url()),
    OTEL_EXPORTER_OTLP_HEADERS: optionalEmptyAsUndefined(z.string()),

    // Comma-separated list of origins allowed to hit the API (used by @fastify/cors).
    // Default in development covers both Vite port 5173 and its fallback 5174;
    // production deploys must set this explicitly.
    CORS_ALLOWED_ORIGINS: z
      .string()
      .default('http://localhost:5173,http://localhost:5174')
      .transform((s) =>
        s
          .split(',')
          .map((o) => o.trim())
          .filter((o) => o.length > 0),
      ),
  })
  .superRefine((data, ctx) => {
    if (
      (data.NODE_ENV === 'staging' || data.NODE_ENV === 'production') &&
      !data.ENVELOPE_ENCRYPTION_MASTER_KEY
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ENVELOPE_ENCRYPTION_MASTER_KEY'],
        message:
          'required in staging/production — set a 64-char hex KEK or configure Supabase Vault',
      });
    }
    // Hard-block ZDR-disable in non-dev environments. Child + household data
    // flows through OpenAI prompts; allowing OpenAI to retain those bodies
    // outside development is a deliberate posture change that should not be
    // toggleable via env alone in prod.
    if (
      data.OPENAI_TRACES_ENABLED &&
      data.NODE_ENV !== 'development' &&
      data.NODE_ENV !== 'test'
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['OPENAI_TRACES_ENABLED'],
        message:
          'cannot be true outside development/test — staging+ must keep OpenAI zero-retention',
      });
    }
  });

export type Env = z.infer<typeof EnvSchema>;

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
