# Story 1.7: Pino structured logging + OpenTelemetry skeleton + Grafana Cloud OTLP

Status: done

## Story

As a developer,
I want Pino logging with request-scoped child loggers and OpenTelemetry instrumentation exporting to Grafana Cloud (or stdout in dev),
so that every request is traceable end-to-end with consistent log shape `{ requestId, userId?, householdId?, module, action }`.

## Acceptance Criteria

1. `apps/api/src/middleware/request-id.hook.ts` generates UUIDv4 if `X-Request-Id` is missing (via `genReqId` in `app.ts`), attaches to `request.id`, creates child Pino logger as `request.log`, and echoes the ID in the response `X-Request-Id` header.

2. Pino redaction allowlist explicitly blocks logging of `*.heart_note_content`, `*.child_name`, `*.declared_allergens`, `*.cultural_identifiers`, `*.dietary_preferences`, `*.card`, `*.cvv` paths (in addition to the existing `req.headers.authorization` and `req.headers.cookie` redactions from Story 1.6).

3. `apps/api/src/plugins/otel.plugin.ts` wraps the OTEL SDK initialization (from `apps/api/src/observability/otel.ts`) as a Fastify plugin; `initOtel(env)` is called in `server.ts` BEFORE `buildApp()` for correct auto-instrumentation of Fastify and ioredis; in dev it exports to stdout (ConsoleSpanExporter), in staging/prod it exports to the OTLP endpoint from env.

4. ESLint rule `no-console: error` is added to `apiConfig()` in `packages/eslint-config-hivekitchen/src/index.ts` for `apps/api/src/**/*.ts` files; `pnpm lint` reports an error on a deliberate-violation fixture; removing the fixture restores 0 errors.

5. Integration test `apps/api/test/integration/health.int.test.ts` uses Vitest + `fastify.inject()` to send `GET /v1/health`, verifies: (a) 200 response with `{ status: 'ok' }`, (b) the response carries `X-Request-Id` header, (c) captured Pino log line contains `requestId` field. Guarded with `it.skipIf(!process.env.CI_INTEGRATION)`.

6. Global `unhandledRejection` and `uncaughtException` handlers are installed in `server.ts` routing through Pino (deferred from Story 1.6 code review).

7. `pnpm typecheck`, `pnpm lint`, and `pnpm test` remain green workspace-wide.

## Tasks / Subtasks

- [x] **Task 1 — Pre-flight** (no AC)
  - [x] Confirm Story 1.6 is `done` in `sprint-status.yaml`.
  - [x] Confirm `apps/api/src/middleware/` does NOT yet exist.
  - [x] Confirm `apps/api/src/common/logger.ts` does NOT yet exist.
  - [x] Confirm `apps/api/src/observability/` does NOT yet exist.
  - [x] Confirm `apps/api/src/plugins/otel.plugin.ts` does NOT yet exist.

- [x] **Task 2 — Install npm packages** (AC: #3)
  - [x] Add to `apps/api/package.json` **dependencies**: `@opentelemetry/sdk-node`, `@opentelemetry/auto-instrumentations-node`, `@opentelemetry/exporter-trace-otlp-http`.
  - [x] Add to `apps/api/package.json` **devDependencies**: `pino-pretty`.
  - [x] Run `pnpm install` at workspace root.
  - [x] Verify `pnpm typecheck` still passes after install.

- [x] **Task 3 — Create `src/common/logger.ts`** (AC: #1, #2)
  - [x] Create `apps/api/src/common/logger.ts` per **Logger Factory Spec** in Dev Notes.
  - [x] Export `getLoggerOptions(env)` returning Fastify-compatible Pino options.
  - [x] Include full PII redaction paths from AC #2 merged with the authorization/cookie paths from Story 1.6.
  - [x] Enable `pino-pretty` transport in `NODE_ENV === 'development'` only.

- [x] **Task 4 — Create `src/observability/otel.ts`** (AC: #3)
  - [x] Create `apps/api/src/observability/otel.ts` per **OTEL Init Spec** in Dev Notes.
  - [x] Export `initOtel(env)` and `shutdownOtel()`.
  - [x] Use `ConsoleSpanExporter` in dev; `OTLPTraceExporter` in staging/prod.
  - [x] Auto-instrumentation via `getNodeAutoInstrumentations` with `@opentelemetry/instrumentation-fs` disabled (too noisy).

- [x] **Task 5 — Create `src/plugins/otel.plugin.ts`** (AC: #3)
  - [x] Create `apps/api/src/plugins/otel.plugin.ts` per **OTEL Plugin Spec** in Dev Notes.
  - [x] Plugin calls `shutdownOtel()` in the `onClose` hook.
  - [x] Does NOT call `initOtel()` — that is the responsibility of `server.ts` (see OTEL Init Order rule).

- [x] **Task 6 — Create `src/middleware/request-id.hook.ts`** (AC: #1)
  - [x] Create `apps/api/src/middleware/request-id.hook.ts` per **Request ID Hook Spec** in Dev Notes.
  - [x] Plugin registers `onSend` hook to echo `request.id` in `X-Request-Id` response header.
  - [x] Note: ID generation (UUIDv4 or passthrough of incoming header) is done via `genReqId` in `app.ts`, NOT in this hook.

- [x] **Task 7 — Create `/v1/health` endpoint** (AC: #5)
  - [x] Create `apps/api/src/modules/internal/health.routes.ts` per **Health Route Spec** in Dev Notes.
  - [x] Route: `GET /v1/health` → `{ status: 'ok', timestamp: <ISO8601> }` with `200`.
  - [x] Log at `info` level with `{ module: 'health', action: 'health.check' }` shape.

- [x] **Task 8 — Update `src/app.ts`** (AC: #1, #3)
  - [x] Add `genReqId` to Fastify constructor (see **genReqId Spec**).
  - [x] Replace inline logger config with `getLoggerOptions(env)` from `common/logger.ts`.
  - [x] Register `otelPlugin` FIRST (before vault and SDK plugins).
  - [x] Register `requestIdPlugin` from `middleware/request-id.hook.ts` after `otelPlugin`.
  - [x] Register `healthRoutes` from `modules/internal/health.routes.ts`.

- [x] **Task 9 — Update `src/server.ts`** (AC: #3, #6)
  - [x] Call `initOtel(env)` BEFORE `buildApp()` — see **OTEL Init Order** rule.
  - [x] Add `unhandledRejection` and `uncaughtException` handlers routing through Pino (see **Unhandled Error Handlers Spec**).

- [x] **Task 10 — Add `no-console` ESLint rule** (AC: #4)
  - [x] Add `'no-console': 'error'` to the `apps/api/src/**/*.ts` config block in `packages/eslint-config-hivekitchen/src/index.ts` `apiConfig()`.
  - [x] Create deliberate-violation fixture `apps/api/src/__fixtures__/console-violation.ts` containing `console.log('test')`.
  - [x] Run `pnpm lint` scoped to `apps/api` — confirm the ESLint `no-console` error fires.
  - [x] Delete `apps/api/src/__fixtures__/console-violation.ts`.
  - [x] Run `pnpm lint` — confirm 0 errors.
  - [x] Rebuild `packages/eslint-config-hivekitchen` (`pnpm build` in that package) so the dist is updated.

- [x] **Task 11 — Create integration smoke test** (AC: #5)
  - [x] Create `apps/api/test/integration/health.int.test.ts` per **Integration Test Spec** in Dev Notes.
  - [x] Guard all tests with `it.skipIf(!process.env.CI_INTEGRATION)`.

- [x] **Task 12 — Verification** (AC: #7)
  - [x] `pnpm typecheck` — all packages green.
  - [x] `pnpm lint` — 0 errors workspace-wide.
  - [x] `pnpm test` — all existing tests green; new integration tests skip (no `CI_INTEGRATION`).
  - [x] `pnpm build` at `apps/api` — dist emits correctly.
  - [x] Update `sprint-status.yaml` story to `review`.

---

## Dev Notes

### Architecture References (authoritative sources)

- `_bmad-output/planning-artifacts/architecture.md` §"2.2 apps/api internal layout" — folder structure, file names
- `_bmad-output/planning-artifacts/architecture.md` §"5.6 Logging conventions" — log shape, PII discipline, levels
- `_bmad-output/planning-artifacts/architecture.md` §"5.3 Observability" — Grafana Cloud OTEL target
- `_bmad-output/planning-artifacts/architecture.md` §"5.7 Non-Prod Cost Discipline §N" — dev: stdout only, no Grafana Cloud ingress
- `_bmad-output/planning-artifacts/architecture.md` §"3.1 API request format" — `X-Request-Id` tracing header
- `_bmad-output/project-context.md` §"Fastify 5" — logger rules, no `console.*`
- `_bmad-output/implementation-artifacts/1-6-wire-fastify-plugins-zod-env-validation-in-apps-api.md` — Story 1.6 patterns (genReqId, fp(), plugin order)
- Story 1.6 Deferred Items — `unhandledRejection`/`uncaughtException` handlers are in scope for this story

### CRITICAL: OTEL SDK Must Start Before Fastify

OpenTelemetry auto-instrumentation patches module imports at startup. If `new NodeSDK({ ... }).start()` is called **after** Fastify is already imported/instantiated, the Fastify instrumentation will be incomplete (spans may not be generated for HTTP requests).

**The correct initialization order in `server.ts`:**
```ts
// 1. Env validation (always first)
const env = parseEnv();

// 2. OTEL SDK start — BEFORE buildApp() which imports Fastify
initOtel(env);

// 3. App initialization
const app = await buildApp({ env });
```

`otel.plugin.ts` does NOT call `initOtel()`. It only registers the `onClose` shutdown hook. If you move `initOtel()` into the plugin, auto-instrumentation will silently not work because Fastify is already instantiated when plugins run.

### Logger Factory Spec

```ts
// apps/api/src/common/logger.ts
import type { FastifyServerOptions } from 'fastify';
import type { Env } from './env.js';

// Paths explicitly removed from all Pino log entries — PII and auth secrets.
// Extend this list before logging any new domain object that contains sensitive fields.
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  '*.heart_note_content',
  '*.child_name',
  '*.declared_allergens',
  '*.cultural_identifiers',
  '*.dietary_preferences',
  '*.card',
  '*.cvv',
];

export function getLoggerOptions(env: Env): FastifyServerOptions['logger'] {
  const base: FastifyServerOptions['logger'] = {
    level: env.LOG_LEVEL,
    redact: { paths: REDACT_PATHS, remove: true },
  };

  if (env.NODE_ENV === 'development') {
    return {
      ...base,
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
      },
    };
  }

  return base;
}
```

**Why not a Pino instance?** Fastify 5 accepts `loggerInstance` (a Pino instance) OR `logger` (Pino options). Using options is simpler and lets Fastify manage the logger lifecycle. `pino-pretty` transport is dev-only; it must NOT be enabled in production (it serializes to human-readable text, not JSON, which breaks Loki ingestion).

### Request ID Hook Spec

The request ID lifecycle uses **two cooperating pieces**:

1. **`genReqId` in `app.ts`** — reads `X-Request-Id` from incoming request headers; generates `crypto.randomUUID()` if absent. This runs before any hook and sets `request.id`. Fastify auto-creates `request.log` as a Pino child logger with `reqId: request.id` bound — no manual child logger creation needed.

2. **`request-id.hook.ts`** — echoes the ID back in the response header so callers can correlate requests.

```ts
// apps/api/src/middleware/request-id.hook.ts
import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';

const requestIdHook: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onSend', async (request, reply) => {
    void reply.header('X-Request-Id', request.id as string);
  });
};

export const requestIdPlugin = fp(requestIdHook, { name: 'request-id' });
```

**genReqId in `app.ts`** (alongside the Fastify constructor update):
```ts
import { randomUUID } from 'node:crypto';
// ...
const app = Fastify({
  logger: getLoggerOptions(env),
  genReqId(req) {
    const incoming = req.headers['x-request-id'];
    return (Array.isArray(incoming) ? incoming[0] : incoming) ?? randomUUID();
  },
});
```

`request.log` usage: In handlers and services, use `request.log.info({ module: 'health', action: 'health.check' }, 'message')`. Log payloads must be structured (object first arg). The `requestId` field is bound automatically via `reqId` by Fastify.

### OTEL Init Spec

```ts
// apps/api/src/observability/otel.ts
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { ConsoleSpanExporter } from '@opentelemetry/sdk-trace-node';
import type { Env } from '../common/env.js';

let sdk: NodeSDK | null = null;

export function initOtel(
  env: Pick<Env, 'NODE_ENV' | 'OTEL_EXPORTER_OTLP_ENDPOINT' | 'OTEL_EXPORTER_OTLP_HEADERS'>,
): void {
  const isDev = env.NODE_ENV === 'development' || env.NODE_ENV === 'test';

  const traceExporter =
    isDev || !env.OTEL_EXPORTER_OTLP_ENDPOINT
      ? new ConsoleSpanExporter()
      : new OTLPTraceExporter({
          url: env.OTEL_EXPORTER_OTLP_ENDPOINT,
          headers: parseOtelHeaders(env.OTEL_EXPORTER_OTLP_HEADERS),
        });

  sdk = new NodeSDK({
    traceExporter,
    instrumentations: [
      getNodeAutoInstrumentations({
        // fs instrumentation is too noisy for general use; disable it
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  });

  sdk.start();
}

export async function shutdownOtel(): Promise<void> {
  if (sdk) {
    await sdk.shutdown();
    sdk = null;
  }
}

function parseOtelHeaders(headers: string | undefined): Record<string, string> {
  if (!headers) return {};
  return Object.fromEntries(
    headers.split(',').flatMap((pair) => {
      const eqIdx = pair.indexOf('=');
      if (eqIdx === -1) return [];
      return [[pair.slice(0, eqIdx).trim(), pair.slice(eqIdx + 1).trim()]];
    }),
  );
}
```

**`NODE_ENV=test`**: OTEL should use `ConsoleSpanExporter` in test (no real OTLP calls). The `isDev` check covers this.

**OTEL in dev/test**: `ConsoleSpanExporter` writes JSON to stdout. In unit tests this is fine; in integration tests it is noisy but harmless. Do not configure OTEL suppression in tests — the skeleton must prove spans are generated.

### OTEL Plugin Spec

```ts
// apps/api/src/plugins/otel.plugin.ts
import fp from 'fastify-plugin';
import { shutdownOtel } from '../observability/otel.js';

// Registers OTEL shutdown on Fastify close.
// initOtel() is called in server.ts BEFORE buildApp() — NOT here.
export const otelPlugin = fp(
  async (fastify) => {
    fastify.addHook('onClose', async () => {
      await shutdownOtel();
    });
  },
  { name: 'otel' },
);
```

### Health Route Spec

```ts
// apps/api/src/modules/internal/health.routes.ts
import type { FastifyPluginAsync } from 'fastify';

export const healthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/v1/health', async (request, reply) => {
    request.log.info({ module: 'health', action: 'health.check' }, 'health check');
    return reply.send({ status: 'ok', timestamp: new Date().toISOString() });
  });
};
```

**No auth on `/v1/health`**: This is a public liveness probe. The `authenticate.hook` added in Story 2.1 must NOT be applied to this route (register it inside a separate scope with the auth hook, not globally).

**File location**: `src/modules/internal/health.routes.ts` — consistent with the architecture's `modules/internal/` for cross-cutting infrastructure endpoints that serve no single feature FR.

### Updated `app.ts` Registration Order

```ts
// Registration order in buildApp():
app.decorate('env', env);

// 1. OTEL plugin — shutdown hook; initOtel() is in server.ts
await app.register(otelPlugin);

// 2. Request ID — must be before SDK plugins so all plugin logs carry requestId
await app.register(requestIdPlugin);

// 3. Bootstrap secrets
await app.register(vaultPlugin);

// 4. SDK client plugins (unchanged from Story 1.6)
await app.register(supabasePlugin);
// ... etc.

// 5. Utility
await app.register(sensible);

// 6. Application routes
await app.register(healthRoutes);
```

### Unhandled Error Handlers Spec

Add to `server.ts` after the `SIGTERM`/`SIGINT` handlers (deferred from Story 1.6 code review):

```ts
// Unhandled promise rejections — route through Pino so they are structured JSON.
// These indicate programming errors; fatal exit is intentional.
process.on('unhandledRejection', (reason) => {
  app?.log.fatal({ err: reason }, 'unhandledRejection — exiting');
  process.exit(1);
});

// Uncaught synchronous exceptions — same treatment.
process.on('uncaughtException', (err) => {
  app?.log.fatal({ err }, 'uncaughtException — exiting');
  process.exit(1);
});
```

**Placement**: Register these handlers AFTER `app` is assigned (after `buildApp()` resolves) so `app.log` is available. For errors that happen before `buildApp()` completes (rare), `app` will be `undefined` and the handlers fall back to silent. That is acceptable for a skeleton.

### Integration Test Spec

```ts
// apps/api/test/integration/health.int.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Writable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { parseEnv } from '../../src/common/env.js';
import { buildApp } from '../../src/app.js';

const SKIP = !process.env.CI_INTEGRATION;

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
      headers: { 'x-request-id': 'test-id-123' },
    });
    expect(res.headers['x-request-id']).toBe('test-id-123');
  });

  it.skipIf(SKIP)('GET /v1/health produces Pino log with requestId', async () => {
    logLines.length = 0;
    await app!.inject({ method: 'GET', url: '/v1/health' });
    const healthLog = logLines
      .map((l) => { try { return JSON.parse(l) as Record<string, unknown>; } catch { return null; } })
      .find((l) => l !== null && l['action'] === 'health.check');
    expect(healthLog).toBeDefined();
    expect(healthLog!['reqId']).toBeDefined();
  });
});
```

**`buildApp` signature change**: The test above passes a `logStream` to capture Pino output. This requires updating `buildApp(opts: { env: Env; logStream?: NodeJS.WritableStream })` so tests can inject a custom log destination. In production `logStream` is `undefined` and Fastify uses `process.stdout`.

Update `getLoggerOptions(env, logStream?)` or pass `stream` directly into the Fastify logger config:

```ts
// In app.ts:
const loggerOpts = getLoggerOptions(env);
const app = Fastify({
  logger: opts.logStream
    ? { ...loggerOpts, stream: opts.logStream }  // test override
    : loggerOpts,
  genReqId(req) { ... },
});
```

**Note on pino-pretty + stream**: `pino-pretty` transport and `stream` override are mutually exclusive. When `logStream` is provided (test context), do not add the `transport` property.

### `no-console` ESLint Rule

Add to `packages/eslint-config-hivekitchen/src/index.ts` in `apiConfig()`, in the existing `apps/api/src/**/*.ts` block with `no-restricted-imports`:

```ts
// In the block: { files: ['apps/api/src/**/*.ts'], rules: { ... } }
'no-console': 'error',
```

This will fail on any `console.log`, `console.error`, `console.warn`, `console.info`, `console.debug`, `console.trace`. The only logging mechanism allowed in `apps/api/src/` is Pino via `fastify.log` or `request.log`.

**After editing the package**: Run `pnpm --filter @hivekitchen/eslint-config build` to rebuild the dist. The ESLint config in `apps/api` imports from the built dist.

### Package Version Notes (verify latest stable at implementation time)

| Package | Min version | Notes |
|---|---|---|
| `@opentelemetry/sdk-node` | `^0.52` | NodeSDK class; verify stable release at install time |
| `@opentelemetry/auto-instrumentations-node` | `^0.49` | Includes fastify, ioredis, pg instrumentations |
| `@opentelemetry/exporter-trace-otlp-http` | `^0.52` | Must match `sdk-node` major |
| `pino-pretty` | `^11` | dev-only; transforms Pino JSON to human-readable output |

**OTEL versioning rule**: All `@opentelemetry/*` packages must be on the same minor/patch version. Mixed versions cause peer-dep conflicts. Check `npm info @opentelemetry/sdk-node peerDependencies` after install.

**`@opentelemetry/sdk-trace-node`**: This is re-exported by `@opentelemetry/sdk-node`. Import `ConsoleSpanExporter` from `@opentelemetry/sdk-trace-node`, not `@opentelemetry/sdk-trace-base` directly — avoids version mismatch if they drift.

### Previous Story Intelligence (from Stories 1.5 + 1.6)

- **`.js` extensions on relative imports**: required in `apps/api` (TSC emits `.js`; `tsx watch` hides this). Every new file in this story must use `.js` extensions on relative imports.
- **`fastify-plugin` (`fp()`) wraps every Fastify plugin**: `requestIdPlugin` and `otelPlugin` must both use `fp()` so their decorations/hooks are visible at the parent scope.
- **No `import type` for runtime values**: `initOtel`, `shutdownOtel`, `ConsoleSpanExporter`, `NodeSDK` are runtime values — import without `type`.
- **`fastify-type-provider-zod` v4 requires Zod 3**: do not install Zod 4 or `fastify-type-provider-zod` v5+.
- **`OTEL_EXPORTER_OTLP_ENDPOINT`**: already in `env.ts` as `optionalEmptyAsUndefined(z.string().url())`. Use `env.OTEL_EXPORTER_OTLP_ENDPOINT` — it may be `undefined` in dev.
- **`fastify.log` vs `request.log`**: Use `fastify.log` in plugin hooks (no `request` context); use `request.log` in route handlers. Never `console.*`.
- **Boundary rule from Story 1.5**: OTEL packages (`@opentelemetry/*`) are not in `VENDOR_SDK_PATTERNS` in `packages/eslint-config-hivekitchen` — they are OK to import outside `plugins/`. Only `@supabase/*`, `openai`, `@elevenlabs/*`, `stripe`, `@sendgrid/*`, `twilio`, `ioredis`, `bullmq` are restricted.
- **Story 1.6 ESLint path remap (`remapPaths()`)**: already in `apps/api/eslint.config.mjs`. New rules added to `apiConfig()` will be correctly remapped — no changes needed to `eslint.config.mjs`.
- **`pnpm build` (apps/api)**: Always run after implementation to catch `.js` extension issues that `tsx watch` hides.

### Project Structure Notes

**New files:**
```
apps/api/src/
├── middleware/
│   └── request-id.hook.ts           NEW — echoes X-Request-Id in response
├── common/
│   ├── env.ts                        UNCHANGED
│   └── logger.ts                     NEW — Pino factory with PII redaction
├── observability/
│   └── otel.ts                       NEW — OTEL NodeSDK init + shutdown
├── plugins/
│   └── otel.plugin.ts                NEW — Fastify plugin (shutdown hook only)
├── modules/
│   └── internal/
│       └── health.routes.ts          NEW — GET /v1/health
└── app.ts                            MODIFIED — genReqId, logger factory, plugin order
└── server.ts                         MODIFIED — initOtel() before buildApp(), error handlers

apps/api/
└── test/
    └── integration/
        └── health.int.test.ts        NEW — smoke test

packages/eslint-config-hivekitchen/
└── src/
    └── index.ts                      MODIFIED — no-console rule in apiConfig()
```

**Modified files:**
- `apps/api/package.json` — add 3 OTEL deps + pino-pretty devDep
- `apps/api/src/app.ts` — genReqId, logger factory, plugin registration order
- `apps/api/src/server.ts` — initOtel() call, unhandledRejection/uncaughtException handlers
- `packages/eslint-config-hivekitchen/src/index.ts` — no-console rule
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — story status update

**`src/modules/internal/` folder**: This is the first route in the `internal/` module. The architecture defines this as the location for `v1/internal/*` browser-reachable beacons (§4.4). `/v1/health` is an internal utility endpoint placed here as it fits the "infrastructure, no single feature FR" pattern.

### Architecture Compliance Invariants (lint-enforced from Story 1.5)

| Rule | Impact on this story |
|---|---|
| Files outside `plugins/` cannot import `ioredis`, `bullmq`, etc. | OTEL packages (`@opentelemetry/*`) are NOT in the restricted list — import freely from `observability/otel.ts` |
| No `console.*` in `apps/api/src/` | This story ADDS the lint rule — use `fastify.log` everywhere |
| Agents cannot import from routes or Fastify internals | Not applicable (no agent code in this story) |
| Every route handler calls a service — no business logic in handler | `/v1/health` is trivially simple — inline is acceptable since it has no logic beyond a timestamp |

### Deferred Items (out of scope for Story 1.7)

- **Pino log → Loki**: Sending Pino logs to Grafana Cloud Loki via OTLP Logs exporter. Story 1.7 handles traces only; logs go to stdout for Fly.io log drain pickup. Full Pino → OTEL Logs integration is a later observability story.
- **Prometheus metrics**: `slo-counters.ts` and per-HH cost counters (Story 3.7+ scope).
- **`tool-latency.histogram.ts`** (Story 1.9 scope — tools manifest story).
- **OTLP gRPC exporter**: Story 1.7 uses HTTP exporter (`@opentelemetry/exporter-trace-otlp-http`). gRPC is not needed for Grafana Cloud OTLP endpoint.
- **Swagger/OpenAPI plugin**: `swagger.plugin.ts` is deferred until first route with a full schema is built.
- **`authenticate.hook.ts` / `authorize.hook.ts`**: Story 2.1 scope (JWT/RBAC).
- **`audit.hook.ts`**: Story 1.8 scope (audit log schema).
- **`src/routes/` → `src/modules/` rename from Story 1.6**: Still deferred; `modules/internal/` folder created by this story sets the naming precedent.

### References

- Architecture §5.6 Logging: `_bmad-output/planning-artifacts/architecture.md`
- Architecture §5.3 Observability: `_bmad-output/planning-artifacts/architecture.md`
- Architecture §2.2 API layout: `_bmad-output/planning-artifacts/architecture.md`
- Architecture §3.1 Tracing header: `_bmad-output/planning-artifacts/architecture.md`
- Project context critical rules: `_bmad-output/project-context.md`
- Story 1.6 Dev Notes (plugin patterns, boundary rules): `_bmad-output/implementation-artifacts/1-6-wire-fastify-plugins-zod-env-validation-in-apps-api.md`
- Story 1.6 Deferred Items (unhandledRejection): `_bmad-output/implementation-artifacts/deferred-work.md`
- OpenTelemetry JS SDK: https://opentelemetry.io/docs/languages/js/
- `@opentelemetry/auto-instrumentations-node`: https://github.com/open-telemetry/opentelemetry-js-contrib/tree/main/metapackages/auto-instrumentations-node
- Fastify Logging: https://fastify.dev/docs/latest/Reference/Logging/
- pino-pretty: https://github.com/pinojs/pino-pretty

---

## Dev Agent Record

### Agent Model Used

claude-opus-4-7 (1M context)

### Debug Log References

1. **OTEL package versions** — `@opentelemetry/sdk-node@^0.52` and `@opentelemetry/exporter-trace-otlp-http@^0.52` aligned as required (same minor). `@opentelemetry/auto-instrumentations-node@^0.49` is a metapackage that pulls compatible instrumentation modules. Resolved: sdk-node 0.52.1, sdk-trace-node 1.30.1.

2. **`ConsoleSpanExporter` import path** — confirmed re-exported from `@opentelemetry/sdk-trace-node`; added it to dependencies so the import is explicit rather than relying on a transitive through `@opentelemetry/sdk-node`.

3. **`logStream` + `pino-pretty` transport exclusivity** — Fastify logger config cannot take both a `transport` (which sends to a worker thread) and a `stream` (direct writable). In `buildApp()`, when `logStream` is provided (test path) the `transport` is nullified via spread + `undefined` override to allow the stream override to take effect.

4. **`no-console` rule placement** — added to the existing `apps/api/src/**/*.ts` block that has `no-restricted-imports` per Dev Notes. This block has `ignores` for `plugins/**` and `**/repository.ts` (carved out for vendor SDK imports); `no-console` inherits those exemptions. Acceptable because plugins use `fastify.log` as a matter of convention; no plugin currently calls `console.*`. The deliberate-violation fixture lives at `apps/api/src/__fixtures__/console-violation.ts` which is NOT in the ignores list — rule fires as expected.

5. **Added `health.routes.test.ts` unit test** — `health.int.test.ts` correctly guards with `it.skipIf(!process.env.CI_INTEGRATION)` per AC #5, but that means the happy-path code never runs in standard `pnpm test`. Added a unit-level equivalent that constructs a minimal Fastify instance (just `requestIdPlugin` + `healthRoutes`) without buildApp/ioredis so all three AC #5 assertions (200/ok, X-Request-Id echo, Pino log w/ reqId) run on every push. Not required by any AC but strengthens coverage of AC #1 + #5.

### Completion Notes List

- ✅ AC #1: `request-id.hook.ts` registers `onSend` echoing `request.id`; `genReqId` in `app.ts` reads `x-request-id` header or generates UUIDv4. Fastify auto-binds `reqId` on `request.log`.
- ✅ AC #2: `REDACT_PATHS` in `common/logger.ts` contains all 7 PII paths plus the 2 auth paths inherited from Story 1.6 (9 total). `redact.remove: true` drops them entirely from log entries.
- ✅ AC #3: `otel.plugin.ts` registers `onClose` shutdown only. `initOtel(env)` is called in `server.ts` BEFORE `buildApp()`. `ConsoleSpanExporter` used in dev/test or when no OTLP endpoint is set; `OTLPTraceExporter` with HTTP transport otherwise.
- ✅ AC #4: `'no-console': 'error'` added to `apiConfig()` in `packages/eslint-config-hivekitchen/src/index.ts`. Verified via deliberate-violation fixture (lint reports `Unexpected console statement  no-console`); fixture removed; lint returns 0 errors.
- ✅ AC #5: `test/integration/health.int.test.ts` uses `fastify.inject()` + `CI_INTEGRATION` guard. Three tests cover: 200/`{status:'ok'}`, `X-Request-Id` echo, Pino log contains `requestId`. All skip in standard `pnpm test`.
- ✅ AC #6: `unhandledRejection` / `uncaughtException` handlers installed in `server.ts` after SIGTERM/SIGINT block. Both route through `app?.log.fatal` and exit 1. Deferred Story 1.6 item resolved.
- ✅ AC #7: `pnpm typecheck` 9/9, `pnpm lint` 5/5, `pnpm test` 6/6 (12 passing + 11 skipped in `apps/api`; contract/eslint/ui suites all green), `pnpm build` (apps/api) emits dist including `common/logger.js`, `observability/otel.js`, `plugins/otel.plugin.js`, `middleware/request-id.hook.js`, `modules/internal/health.routes.js`.
- ℹ️ Added `logger.test.ts` (4 tests) and `otel.test.ts` (4 tests) for unit coverage of the new factories. Added `health.routes.test.ts` (4 tests) — see Debug Log note 5. Total new tests: 15 (12 passing + 3 skipped integration).
- ℹ️ `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_HEADERS` already in `env.ts` from Story 1.6 review patch (optional with empty-string preprocessing).

### File List

**New files:**
- `apps/api/src/middleware/request-id.hook.ts`
- `apps/api/src/common/logger.ts`
- `apps/api/src/common/logger.test.ts`
- `apps/api/src/observability/otel.ts`
- `apps/api/src/observability/otel.test.ts`
- `apps/api/src/plugins/otel.plugin.ts`
- `apps/api/src/modules/internal/health.routes.ts`
- `apps/api/src/modules/internal/health.routes.test.ts`
- `apps/api/test/integration/health.int.test.ts`

**Modified:**
- `apps/api/package.json`
- `apps/api/src/app.ts`
- `apps/api/src/server.ts`
- `packages/eslint-config-hivekitchen/src/index.ts`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`

## Change Log

| Date | Change | By |
|---|---|---|
| 2026-04-24 | Story created from epics.md AC + architecture analysis + Story 1.6 learnings | Story Context Engine |
| 2026-04-24 | Story 1.7 implementation — Pino factory w/ PII redaction, OTEL NodeSDK skeleton (console in dev, OTLP in prod), OTEL plugin shutdown hook, request-id hook + genReqId, /v1/health route, no-console ESLint rule, unhandled error handlers, integration + unit tests. pnpm typecheck/lint/test/build all green. | Dev Agent (claude-opus-4-7) |
| 2026-04-24 | Code review — 6 patch, 4 deferred, 4 dismissed. 2/3 subagent layers (Edge Case Hunter, Acceptance Auditor) rate-limited; orchestrator covered those layers. | Reviewer (claude-sonnet-4-6) |

### Review Findings

- [x] [Review][Patch] X-Request-Id header value not validated — no length cap or format check; arbitrary client string is bound to every Pino log line via reqId, enabling log injection [apps/api/src/app.ts:39-43]
- [x] [Review][Patch] `initOtel()` has no re-entry guard — calling twice overwrites `sdk` and leaks the first NodeSDK instance [apps/api/src/observability/otel.ts:9]
- [x] [Review][Patch] `initOtel(env)` called before try/catch in `server.ts` — a synchronous throw from `NodeSDK.start()` is unstructured (no Pino log, no uncaughtException handler yet) [apps/api/src/server.ts:7]
- [x] [Review][Patch] `request.id as string` unsafe cast — use `String(request.id)` for defensive safety if genReqId ever returns a non-string [apps/api/src/middleware/request-id.hook.ts:5]
- [x] [Review][Patch] No `service.name` / `service.version` on NodeSDK — all Grafana Cloud traces appear as `unknown_service`, making observability functionally useless in production [apps/api/src/observability/otel.ts:22-31]
- [x] [Review][Patch] SIGTERM/SIGINT handlers registered after `app.listen()` — race window where a signal before handler registration falls through to Node default (no graceful shutdown) [apps/api/src/server.ts:35-44]
- [x] [Review][Defer] `parseOtelHeaders` silently drops malformed pairs (e.g., colon-separated `Authorization:Bearer`) — operational quality; add warning log in OTEL hardening story [apps/api/src/observability/otel.ts:41]
- [x] [Review][Defer] Shallow `*` wildcard in `REDACT_PATHS` misses PII at depth >2 — spec uses `*.`; requires log-shape guarantees not yet established; address in observability hardening pass [apps/api/src/common/logger.ts:4]
- [x] [Review][Defer] `shutdownOtel()` errors not caught in `onClose` hook — graceful-shutdown hardening; add try/catch with timeout in OTEL hardening story [apps/api/src/plugins/otel.plugin.ts:6]
- [x] [Review][Defer] No `testTimeout` or pool isolation in `vitest.config.ts` — harden when CI integration is active and OTEL tests run for real [apps/api/vitest.config.ts:1]
