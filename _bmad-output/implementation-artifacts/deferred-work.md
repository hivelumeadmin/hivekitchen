# Deferred Work Log

## Deferred from: code review of 1-1-scaffold-apps-marketing-astro-and-packages-ui-workspace-package (2026-04-23)

- `@astrojs/check` pinned to `"latest"` not semver — CI non-determinism risk; intentional per Story 1.1 spec ("Astro-coupled"). Revisit in Story 1.2 when env/package wiring lands.
- `packages/ui/package.json` missing `exports` field — source-import convention matches rest of monorepo; acceptable for workspace-only packages. Revisit if `@hivekitchen/ui` ever needs to be published or consumed outside the monorepo.
- `packages/ui/tailwind.config.ts` relative `../design-system` import escapes package boundary — intentional Story 1.1→1.4 bridging pattern. Story 1.4 must resolve the `packages/design-system` vs `packages/ui/src/tokens` architectural split and replace this import.
- Tailwind `content: []` empty in `packages/ui/tailwind.config.ts` — stub; content globs and token values land in Story 1.4.
- `lint` and `typecheck` scripts in `apps/marketing` both run `astro check` — ESLint wiring is Story 1.5 scope; nothing to call for lint yet.
- `packages/ui` missing `lint` and `build` scripts — intentional empty barrel; scripts added when real components land.
- `packages/tsconfig/astro.json` extends `astro/tsconfigs/strict` not workspace base — intentional forward-compat decision; watch for drift if workspace base adds options that Astro upstream doesn't inherit.
- `tokenPresets = {}` silently no-ops `theme.extend` — placeholder; Story 1.4 replaces with v2.0 semantic token system.

## Deferred from: code review of 1-2-wire-workspace-package-json-scripts-dockerfile-per-app-env-local-example (2026-04-23)

- No `HEALTHCHECK` instruction in runner stage [apps/api/Dockerfile] — Fly.io config out of scope; healthcheck requires `/healthz` endpoint. Revisit with fly.toml story.
- `node:22-alpine` floating tag — no digest pin [apps/api/Dockerfile] — standard for dev-stage Dockerfiles; harden with digest pin in productionization/deploy story.
- `packages/contracts` and `packages/types` TypeScript sources in Docker deploy closure [apps/api/Dockerfile] — documented forward concern in story Dev Notes; surfaces when Story 1.3/1.6 introduce workspace-package imports into the API. Two remediation paths: (1) add tsc build step to shared packages, (2) bundle API with esbuild/tsup.
- `PORT` hardcoded in `apps/api/src/server.ts`, not read from env [apps/api/src/server.ts] — pre-existing from Story 1.1; Story 1.6 owns Zod env validation and server binding.
- `JWT_SECRET` placeholder lacks a generation command hint [apps/api/.env.local.example] — enhancement; consider `# Generate: openssl rand -hex 32` in Story 1.6's env template alignment pass.
- `test/helpers/` has no `tsconfig.json` — latent; surfaces when real seed logic replaces the stub and adds workspace-package imports or path aliases.
- Pre-existing `rm -rf dist` in `apps/api/package.json` clean script — not introduced by this diff; cross-platform chore for Story 1.5.

## Deferred from: code review of 1-4-establish-token-system-v2-0 (2026-04-23)

- Root-relative `/fonts/...` paths in `typography.css` break on non-`/` base-path deployments — known limitation per spec; current deployment model is root-only. Revisit in productionization/deploy story if sub-path is ever needed.
- Font file tests skip in CI (`it.skipIf(!!process.env.CI)`) — spec-intentional; fonts are committed assets so divergence requires an explicit code change. Revisit if CI environment diverges from repo state (e.g., large-file storage migration).
- Tailwind opacity modifiers (`bg-sacred-500/50`) silently produce no output when color tokens are `var()` references — known architectural tradeoff of two-layer CSS-var + Tailwind-preset approach. Document as constraint; revisit if opacity modifier usage is required in Epic 2+ components.
- Dark mode has no `prefers-color-scheme` initialization — always renders light mode on first paint — explicitly deferred per Story 1.4 spec; theme toggle JS belongs in a later story (preference persistence, OS detection).

## Deferred from: code review of 1-3-establish-foundation-gate-contracts-in-packages-contracts (2026-04-23)

- `WeeklyPlan.weekOf: z.string()` unconstrained [packages/contracts/src/plan.ts] — pre-existing from Story 1.1; not touched by 1.3.
- UUID validators across contracts accept the nil UUID `00000000-0000-0000-0000-000000000000` — sentinel-rejection policy belongs with Story 1.6 boundary/env work or global architecture guidance.
- `Turn.created_at`, `PresenceEvent.expires_at`, `ForgetCompletedEvent.completed_at` accept ISO strings without seconds — Zod `.datetime()` default; revisit when Story 1.10 pins wire-format precision.
- `PantryDelta` (unexported internal stub in `events.ts`) parses `{}` as a valid delta — Epic 3+ pantry domain will refine.
- `ApiError.fields[].code` reuses `ErrorCode` which mixes request-level and field-level semantics — future split into `FieldErrorCode` (e.g., `FIELD_REQUIRED`, `FIELD_INVALID_FORMAT`).
- `contracts:check` soft spots beyond the P3 `.tsx` fix: file-scoped `@unused-by-design` exemption; regex misses `export function` / `export type` / `export { X }` / multiline exports; `exportedNames` map silently overwrites on duplicate export names across files. All latent — no current violations.
- `z.string().datetime()` default rejects timezone offsets (accepts only `Z`-suffixed UTC) — use `{ offset: true }` if downstream producers emit offsets. Pin in Story 1.10 SSE wire-format pass.
- No `engines.node` declared at root or in `packages/contracts` — `check.ts` depends on Node 22+ (`globSync`, `import.meta.dirname`). Add `"engines": { "node": ">=22" }` in a root-hygiene or Story 1.6 pass.

## Deferred from: code review of 1-5-scope-charter-eslint-scope-allowlist-rules-dev-mode-runtime-assertions (2026-04-24)

- Shorthand `margin: '0 0 0 8px'` / `padding: '...'` with embedded physical values are not flagged by `logical-properties-only` — deferred; spec scope was long-hand properties only. Revisit when a shorthand-to-logical codemod pass is warranted.
- Physical non-margin/padding properties (`left`/`right`/`top`/`bottom`/`borderLeft`/`borderRight`/`textAlign: 'left'`) are not in the logical map — deferred; spec scope limited to margin/padding mapping.
- `import.meta.env.DEV` may be undefined under Vitest when hook tests land — deferred; handle with a test-setup shim when `useScopeGuard` hook tests are written.
- `apps/web/eslint.config.mjs` imports the scope allowlist via relative path `../../packages/ui/src/scope-allowlist.eslint.js` — deferred; fragile but functional. Replace with a proper `packages/ui/package.json#exports` entry when a subpath export is added for other reasons.
- Re-export barrel inside `apps/api/src/plugins/` would circumvent `no-restricted-imports` (a plugin could `export * from 'openai'` and be imported elsewhere) — deferred; plugins/ is small enough that a review catches this today.
- `no-cross-scope-component` does not visit dynamic `import()` or `require()` — deferred; rare pattern in Vite/React apps for components.
- Type-only imports flagged identically to runtime imports in `no-cross-scope-component` — deferred; cosmetic, type-only imports render nothing.
- Low-severity edge collection: allowlist substring match is positional-agnostic; arbitrary Tailwind values with spaces may split mid-match; computed style object keys (`{[key]: val}`) pass unchecked; `ScopeClass` has no runtime string validation for JS callers; the dev-mode scope guard does not observe subsequent DOM class mutations after mount — deferred as a batch; address if/when a real-world miss surfaces.

## Deferred from: code review of 1-6-wire-fastify-plugins-zod-env-validation-in-apps-api (2026-04-24)

- SendGrid decorator uses `as unknown as MailService` double-cast instead of spec's `as MailService` [apps/api/src/plugins/sendgrid.plugin.ts:7] — cosmetic TS cast; runtime shape is correct.
- BullMQ plugin omits local `BullMQFacade` interface and imports `Processor` type instead of `Parameters<typeof Worker>[1]` [apps/api/src/plugins/bullmq.plugin.ts:3-13] — typing reaches the same shape via `fastify.d.ts`.
- No `timeout`/`maxRetries` overrides on OpenAI / ElevenLabs / Twilio / Supabase clients — SDK defaults let slow upstreams hold Fastify request handlers for minutes; tune in a later performance/observability pass.
- `remapPaths()` uses first-match `String.replace` and silently drops non-string `files`/`ignores` entries [apps/api/eslint.config.mjs:11-22] — no current patterns trip it; revisit if flat-config entries gain RegExp/array shapes.
- `SUPABASE_URL` / `REDIS_URL` schemes not validated — `z.string().url()` accepts `http://`, `ftp://`, `javascript:`. Add `.refine()` on scheme in env-hardening pass.
- `PORT=""` (empty string) produces `NaN` rather than applying `.default(3001)` — Zod semantic; `z.coerce.number()` only uses the default when the key is `undefined`.
- `JWT_SECRET: z.string().min(32)` counts characters not bytes — comment says "32 bytes" but validation is on string length. Tighten with base64/hex decoded-byte refine later.
- `OTEL_EXPORTER_OTLP_HEADERS` format (`k=v,k=v`) not validated — malformed values pass Zod and fail silently inside the exporter at runtime; address with OTEL observability story.
- `sgMail.setApiKey` is a module-global singleton mutation with no reset on `onClose` — test-scope isolation concern only; tests that rebuild the app with different keys can leak across suites.
- Integration test `if (app) await app.close()` contradicts `let app: FastifyInstance` non-nullable declaration [apps/api/test/integration/plugins.int.test.ts] — runtime safe; tighten to `let app: FastifyInstance | undefined` when integration story resumes.
- `vitest.config.ts` include has redundant glob (`test/**/*.test.ts` already matches `.int.test.ts`) — Vitest dedupes; cosmetic.
- Vitest coverage reporter omits `lcov` — add when CI coverage aggregation story lands.
- `ELEVENLABS_WEBHOOK_SECRET` / `STRIPE_WEBHOOK_SECRET` required but unused by Story 1.6 — developers populate dummies that would later pass signature checks vacuously; revisit `.min()` / format when webhook stories land.
- No Supabase service-role-key liveness check on startup [apps/api/src/plugins/supabase.plugin.ts] — invalid/revoked keys surface only at first query. Startup probe story.
- Extensive unrelated working-tree changes (`packages/ui/*`, `apps/web/*`, `_color-gen.mjs`, `packages/eslint-config-hivekitchen/*`) outside Story 1.6 scope — tracked for separate PRs or prior-story rollups. Appears to include uncommitted Story 1.5 artifacts.
- Plugin registration ordering not type-enforced (a future reorder past `app.decorate('env', env)` would give SDK plugins `undefined`) [apps/api/src/app.ts:27-30] — Fastify pattern limitation; no feasible type-level guard.
- No global `unhandledRejection` / `uncaughtException` handlers routing through Pino [apps/api/src/server.ts] — deferred to Story 1.7 (Pino structured logging / OTEL skeleton scope).

## Deferred from: code review of 1-8-single-row-audit-log-schema-monthly-partitions-composite-index-audit-service-write (2026-04-24)

- [W1] Service role key shared across all requests — pre-existing architecture decision; single Supabase client with service-role key bypasses RLS system-wide. Revisit when per-request user context / RLS story lands (Epic 2).
- [W2] No FK/RLS on `household_id`/`user_id` in `audit_log` — explicitly deferred to Epic 2 in story Dev Notes; add FK + RLS policies when auth is wired.
- [W3] BullMQ `Worker` error event not explicitly handled in `audit-partition-rotation.job.ts` — pre-existing concern in `bullmq.plugin.ts`; verify plugin attaches a global `.on('error', ...)` handler; harden when BullMQ worker story lands.
- [W4] `AuditWriteInput` UUID fields (`household_id`, `user_id`, `correlation_id`, `request_id`) have no runtime validation — only TypeScript compile-time safety; add Zod validation at API boundary when audit writes are wired to routes (Epic 2).
- [W5] `audit_log_guardrail_rejections_idx` is partition-scoped only — Postgres partial index cannot serve cross-partition queries; known architectural limitation. Ops dashboard queries must always include a partition-key filter. Note when building Epic 9 dashboard queries.
- [W6] Direct `new AuditRepository(fastify.supabase)` instantiation in `audit.hook.ts` — matches spec intent; no DI container yet. Revisit if `AuditService` gains initialization cost or needs to be shared across multiple callers (Epic 2+).
- [W7] `BaseRepository` uses untyped `SupabaseClient` (no database generic) — `.from()` calls are `any`-typed at compile time. Defer until `supabase gen types typescript` is wired against a live Supabase instance (Epic 2). [apps/api/src/repository/base.repository.ts]

## Deferred from: code review of 1-7-pino-structured-logging-opentelemetry-skeleton-grafana-cloud-otlp (2026-04-24)

- `parseOtelHeaders` silently drops malformed header pairs (e.g., `Authorization:Bearer`) without warning — add a startup warning log or throw in OTEL hardening story. [apps/api/src/observability/otel.ts]
- Shallow `*` wildcard in `REDACT_PATHS` misses PII nested deeper than two levels — requires established log-shape guarantees; address in a dedicated observability hardening pass. [apps/api/src/common/logger.ts]
- `shutdownOtel()` errors not caught in `onClose` hook — add try/catch with timeout for clean graceful shutdown in OTEL hardening story. [apps/api/src/plugins/otel.plugin.ts]
- No `testTimeout` or pool isolation in `vitest.config.ts` — harden when CI integration is active and OTEL tests run against a real SDK. [apps/api/vitest.config.ts]

## Deferred from: code review of 1-9-tools-manifest-ts-skeleton-with-ci-lint-no-tool-without-manifest (2026-04-24)

- `toolName` unsanitized in Redis key interpolation [tool-latency.histogram.ts:12] — internal caller; toolName comes from manifest (`<domain>.<verb>` convention). Re-evaluate if toolName ever becomes externally influenced.
- `zadd` same-millisecond member collision silently drops a sample [tool-latency.histogram.ts:16] — loss of one sample at sub-ms granularity irrelevant for p95. Address in Story 3.4 if precision matters.
- Negative `latencyMs` values accepted without bounds check [tool-latency.histogram.ts] — internal caller; value derives from `Date.now() - start` (always ≥ 0). Add validation in Story 3.4 when public orchestrator API is defined.
- `spec[field] === undefined` passes `null` field values [check-tool-manifest.ts:68] — TS strict mode prevents null assignment; only reachable via runtime type bypass.
- `extractManifestNames` does not verify array elements are strings [check-tool-manifest.ts:20] — TS enforces `readonly string[]`; non-string elements require deliberate type bypass.
- `mockRedis` shared at `describe` scope — future test isolation risk [tool-latency.histogram.test.ts:6] — current tests unaffected; re-evaluate when Story 3.4 adds `mockResolvedValueOnce` patterns.
- GitHub Actions pinned to major tags, not commit SHAs — supply chain risk [ci.yml] — project-wide; address in a dedicated DevSecOps hardening story.
- Node 22 `engines` field missing from root `package.json` — project-wide; carry forward to a root-hygiene pass (see also 1-3 deferred log).
- Redis failure paths not tested in histogram unit tests [tool-latency.histogram.test.ts] — Story 3.4 scope when orchestrator wires live Redis calls.

## Deferred from: code review of 1-10-realtime-sse-bridge-central-invalidationevent-dispatcher (2026-04-24)

- Auth on `/v1/events` — explicitly deferred to Story 2.2 per spec; stub is open and unauthenticated.
- Redis pub/sub fan-out and actual event delivery on the SSE endpoint — Story 5.2; stub only writes `:ping` heartbeats today.
- `Last-Event-ID` Redis event-log replay (≥6h retention) on the server — Story 5.2; the bridge correctly does NOT strip `Last-Event-ID` (AC #4) but the server has no replay buffer.
- `client_id` echo suppression at the server — Story 5.2; without it, optimistic-mutation echoes can race with local state.
- Server-side `thread.turn` deduplication, reordering, and cached-array cap — Story 5.x; the bridge appends faithfully per AC #2 and trusts server contract for ordering.
- `reportThreadIntegrityAnomaly` is a no-op in production (only `console.warn` in DEV) — real `POST /v1/internal/client-anomaly` beacon is Story 5.17 per spec stub note.
- `thread.resync.from_seq` plumbing into the thread loader (so refetch starts from the resync point, not the stored cursor) — Story 5.1.
- `queryClient.clear()` on logout to evict cached PII (child names, allergies, heart notes) — auth flow not yet present (Story 2.2).
- Server graceful drain on SIGTERM for long-lived SSE connections (Fastify `app.close()` will hang on open SSE handlers) — operational, post-Story 5.2.
- Rate limit / connection cap per IP on `/v1/events` — Story 5.x operational hardening; current stub allows unbounded anonymous connections.
- `audit-hook` `onResponse` fires when the SSE stream closes — recorded request duration is the entire connection lifetime, skewing dashboards. Surfaces with Story 5.2 / Epic 9.
- `App.tsx` reads `window.location.pathname` inside render — works today by accident (no SPA router triggers re-render); fragile to future react-router integration in Epic 2.
- `apps/web/vitest.config.ts` uses `__dirname` instead of `import.meta.url` + `fileURLToPath` — tooling-config drift; the project invariant targets `src/` files. Low risk; tidy in a tooling-hygiene pass.

## Deferred from: code review of 1-12-contrast-audit-harness-in-packages-design-system (2026-04-24)

- `--passWithNoTests` flag in `@hivekitchen/design-system` test script masks silent test discovery failure — test currently discovered and runs correctly (22 passed); vitest default `include` pattern already picks up `contrast-audit.test.ts` at package root. Revisit if vitest config gains explicit `include` restrictions or if a future story adds test count assertions.

## Deferred from: code review of 1-13-anchor-device-perf-budgets-lighthouse-ci-in-github-workflows-perf-yml (2026-04-24)

- `window.__hivekitchen_qc` exposure risk if `VITE_E2E=true` accidentally included in a non-test deployment — implementation is correct (Vite tree-shakes when unset); deployment hygiene concern. Revisit in a deployment/secrets hardening story.
- Lighthouse budgets audit the unauthenticated route (`/`) which is likely a login redirect, not the actual app shell — no meaningful perf signal until auth routes exist. Revisit at Epic 2 (Household Onboarding) when authenticated routes are available.
- `sse-timing` GHA job silently relies on the `VITE_E2E`-enabled `web-dist` artifact from the `build` job; if the build job ever changes, `__hivekitchen_qc` will be absent and Playwright times out with a cryptic `waitForFunction` error instead of a clear failure. Add a comment or a smoke-check step in a future CI hardening pass.
