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

## Deferred from: code review of 1-14-pr-template-with-patterns-checklist-ci-orchestration (2026-04-25)

- `quality` job renamed from `ci` — admin must update required-status-check labels in GitHub branch protection after merge (documented in Dev Notes); also remove the old `Typecheck · Lint · Test · Manifest` label and add `Typecheck · Lint · Test · Contracts · Manifest`, `E2E · A11y`, `DB schema drift check`. [`.github/workflows/ci.yml`]
- `supabase/config.toml` auth defaults from `supabase init` (enable_confirmations=false, minimum_password_length=6, secure_password_change=false) are local-dev defaults and should not be pushed to remote without override. Epic 2 auth setup must configure production auth values before any remote `supabase push`. [`supabase/config.toml`]
- `supabase/.gitignore` has no `seed.sql` exclusion; `config.toml` references `./seed.sql` as a seed path. Ensure seed.sql is added to supabase/.gitignore before Epic 2 creates it, to prevent accidental commit of fixture data. [`supabase/.gitignore`]
- `contracts:check` script uses `globSync` from `node:fs` (requires Node ≥22) with no `engines` field guarding the root `package.json`. Pre-existing from Story 1.3. Add `"engines": { "node": ">=22" }` in a root-hygiene pass.
- `turbo.json` has no registered tasks for `contracts:check` or `tools:check` — these scripts bypass Turbo remote cache. Story 1.14 explicitly deferred turbo.json changes. Wire in a future CI acceleration story if build times warrant it.
- `CODEOWNERS` uses personal account `@hivelumeadmin` — a PR author who is also the sole CODEOWNERS member bypasses the review requirement. Migrate to a named GitHub team handle once teams are configured. [`.github/CODEOWNERS`]
- Playwright/LH `webServer` start timeout is 15 s in `playwright.config.ts` and `lighthouserc.json` — tight on cold GitHub free-tier runners. Pre-existing from Story 1.13. Raise to 30 000 ms if flaky server-start timeouts emerge.
- `supabase/config.toml` auth timing defaults (`refresh_token_reuse_interval=10`, session lengths, etc.) are Supabase init defaults. Review and override before linking to a remote Supabase project in Epic 2.
- Fork PRs silently receive `TURBO_TOKEN=""` (GitHub Actions does not pass secrets to fork workflows) — Turborepo falls back to local cache only on every fork/dependabot PR. Documented graceful fallback; no action needed until fork-PR CI time becomes a concern.
- `e2e` job `--ignore-glob="**/perf/**"` glob is resolved relative to Playwright `testDir` on the CI runner's OS. Currently ubuntu-latest (Linux); glob is correct. If self-hosted Windows runners are ever added, verify glob separator handling.

## Deferred from: code review of 2-1-supabase-auth-email-password-google-apple-oauth — full review (2026-04-25)

- No `/v1/auth/refresh` endpoint — access tokens expire after 15 min with no recovery path until Story 2.2 implements token rotation. [`apps/api/src/modules/auth/`]
- Expired refresh tokens not checked at query time — `expires_at` column exists but no query reads it; expiry enforcement belongs in the refresh endpoint (Story 2.2). [`apps/api/src/modules/auth/auth.repository.ts`]
- No TTL cleanup job for `refresh_tokens` — table grows unbounded; add a nightly expiry-purge job in a future ops story. [`supabase/migrations/20260501125000_create_refresh_tokens.sql`]
- Access token stored in Zustand (XSS-readable) — accepted per AC4 spec; no localStorage used. Mitigated by 15 min TTL. [`apps/web/src/stores/auth.store.ts`]
- `auth.store` not persisted across page reloads — by design per AC4; silent refresh via refresh token is Story 2.2. [`apps/web/src/stores/auth.store.ts`]
- `authRoutes` instantiates `AuthService` + `AuthRepository` directly inside the plugin — works for a once-registered plugin; migrate to `fastify.decorate` pattern in a future refactor. [`apps/api/src/modules/auth/auth.routes.ts`]
- New `family_id` per login orphans the token rotation chain — Story 2.2 reuse-detection logic must link families across re-logins. [`apps/api/src/modules/auth/auth.service.ts:75`]
- `insertRefreshToken` separate from the `create_household_and_user` RPC — low-probability partial-write on first login if the insert fails after the RPC succeeds; existing error handler prevents a response from being sent. [`apps/api/src/modules/auth/auth.service.ts:72-79`]
- OAuth PKCE state not validated server-side — server-side `exchangeCodeForSession` runs on the service-role client with no PKCE verifier; short-lived single-use codes are the practical mitigation for beta. Add explicit state/nonce storage and server-side validation in a hardening epic before public launch. [`apps/api/src/modules/auth/auth.service.ts`]

## Deferred from: code review of 2-1-supabase-auth-email-password-google-apple-oauth (2026-04-25)

- `callback.tsx` provider coercion (`?? 'google'`) fires before schema validation — any non-`'apple'` query param (including invalid values) collapses to `'google'` before the body is assembled, so `OAuthCallbackRequestSchema`'s enum check never rejects an invalid provider. Flagged in contracts/types chunk; address in web chunk review. [`apps/web/src/routes/auth/callback.tsx`]
- `next` query parameter reflected into `navigate()` with no allowlist — open redirect; `navigate()` accepts absolute URLs, so `?next=https://evil.com` after a valid OAuth exchange navigates the browser off-site. Flagged in contracts/types chunk; address in web chunk review. [`apps/web/src/routes/auth/callback.tsx`]
- Apple OAuth can return no email (`data.user.email ?? ''`) — empty string passes into `createHouseholdAndUser` and gets persisted, then fails `AuthUserSchema`'s `.email()` check on serialization, producing a 500 instead of a handled error. Flagged in contracts/types chunk; address in service chunk review. [`apps/api/src/modules/auth/auth.service.ts`]

## Deferred from: code review of 2-2-4-role-rbac-prehandler-jwt-rotation-on-use (2026-04-25)

- Partial write window between `insertRefreshToken` and `consumeRefreshToken` — crash between the two steps leaves an orphaned new-token row; the client retries with the original (unconsumed) old token and succeeds on retry. Orphaned rows are non-exploitable but accumulate. TTL cleanup job (deferred from 2-1) will purge them. [`apps/api/src/modules/auth/auth.service.ts:87-94`]
- `householdScopeHook` accepts any non-empty string as `household_id` — whitespace or non-UUID values pass the guard. JWTs are signed by this API with validated DB UUIDs, so not exploitable from the login path. Validate UUID format in a future hardening pass. [`apps/api/src/middleware/household-scope.hook.ts:8`]
- `extractZodIssues` `.validation` array check missing `statusCode === 400` narrowing — pre-existing, deferred from Story 2-1 review. Any future custom error with an array `.validation` property could be misclassified as a 400. [`apps/api/src/app.ts`]
- `login.tsx` flash of login page for already-authenticated users — `useEffect`-based redirect fires after first render; brief flash before redirect to `/app`. Address in a UX polish pass. [`apps/web/src/routes/auth/login.tsx:24`]
- TOCTOU migration `20260501120500`: orphaned household has stale `primary_parent_user_id` FK — the losing concurrent first-login inserts a `households` row whose `primary_parent_user_id` points to a user whose `current_household_id` is the winning household. Future maintenance job should clean up orphaned households. [`supabase/migrations/20260501120500_create_household_and_user_idempotent.sql`]
- RLS `households_member_select_policy` subquery creates N+1 per-row security evaluation — `SELECT current_household_id FROM users WHERE id = auth.uid()` runs under RLS per row evaluated. Use a `SECURITY DEFINER` helper function or lateral join at scale. [`supabase/migrations/20260502090000_enable_rls_users_households.sql`]
- Double-slash URL `//v1/auth/login` bypasses `authenticate.hook.ts` skip-list prefix check — Fastify normalises double slashes at the routing layer so practically unreachable. Flagged for awareness if a non-standard reverse proxy is introduced. [`apps/api/src/middleware/authenticate.hook.ts:15`]
- Coverage gaps: `revokeAllByFamilyId` not verified at route layer in `auth.routes.test.ts`; no regression test for `insertRefreshToken` failure during `refreshToken`. Service-layer tests cover revocation logic. [`apps/api/src/modules/auth/auth.routes.test.ts`]

## Deferred from: implementation of 2-1-supabase-auth-email-password-google-apple-oauth (2026-04-25)

- Live `pnpm supabase:reset` verification of the three new migrations was skipped because Docker Desktop was not running on the dev machine. Migrations are direct copies of the spec; next dev with Docker should run `npx supabase start && pnpm supabase:reset && pnpm seed:dev` and confirm `\d users`, `\d households`, `\d refresh_tokens`, and `SELECT typname FROM pg_type WHERE typname='user_role';` succeed. [`supabase/migrations/`]
- Live `pnpm dev:api` smoke (with real Supabase env values) was not performed in this story; only `pnpm typecheck` validates env-schema parsing. Verify before any deploy that all six new env keys (SUPABASE_ANON_KEY, four OAuth credentials, WEB_BASE_URL) are populated in `.env.local`. [`apps/api/.env.local.example`]
- The `users.role` column defaults to `'primary_parent'` on insert, but only the bootstrap `create_household_and_user` RPC explicitly sets it. Story 2.3 (secondary-caregiver invite) needs to override this default at user creation time — document the override path when wiring 2.3. [`supabase/migrations/20260501120000_create_users_and_households.sql`]
- `auth.service.logout()` revokes the HK refresh-token row but does NOT call `supabase.auth.signOut({ scope: 'global' })` for the underlying Supabase session. The Supabase JWT issued by `signInWithPassword` is therefore still valid until its natural expiry (1 h default) — a hostile-cookie scenario could replay it against Supabase directly. Acceptable for 2.1 because the API is the only consumer, but Story 2.2 should call `auth.admin.signOut(supabase_session_token, 'global')` once we persist the Supabase session token alongside the HK refresh row. [`apps/api/src/modules/auth/auth.service.ts`]
- `setRefreshCookie` reads `env.NODE_ENV !== 'development'` for the Secure flag — this means `staging` and `test` get Secure (correct for staging, accidentally broken for `test` if any future browser-based test runs against an http test server). Add a `secure: env.NODE_ENV === 'production' || env.NODE_ENV === 'staging'` guard if test breakage emerges. [`apps/api/src/modules/auth/auth.routes.ts`]
- The frontend `/` route currently `Navigate`s to `/auth/login` for everyone — once Story 2.2 adds `authenticate.hook.ts` and a session-bootstrap query, swap this for an "if authed → /app, else → /auth/login" guard. The current redirect is intentional for 2.1 because no client-side session detection exists yet. [`apps/web/src/app.tsx`]
- `apps/web/src/lib/supabase-client.ts` constructs the client at module-load even when the user never reaches the login page (e.g., direct deep-link to a public marketing route once Epic 11 lands). Consider lazy initialization if cold-start bundle size becomes a concern. [`apps/web/src/lib/supabase-client.ts`]
- The fastify-type-provider-zod validation-array branch in the global error handler hand-rolls a "ZodError-like" pseudo-issue array. If `fastify-type-provider-zod` v5+ changes the validation shape, this branch silently drifts. Replace with a direct call to the library's documented error-mapping helper if/when one ships. [`apps/api/src/app.ts`]
- **Discovered during 2.1 live smoke** (out of 2.1 scope, pre-existing from Story 1.8): `apps/api/src/jobs/audit-partition-rotation.job.ts` declares `QUEUE_NAME = 'audit:partition-rotation'`. BullMQ v5 rejects queue names containing `:` ("Queue name cannot contain :") because Redis keys are colon-separated internally — this prevents `pnpm dev:api` from booting. Rename to `audit-partition-rotation` (and update any operator dashboards/queries that reference the old name) in a Story-1.8 follow-up. [`apps/api/src/jobs/audit-partition-rotation.job.ts`]

## Deferred from: code review of 1-15-upgrade-typescript-5-to-6 (2026-04-25)

- `@hivekitchen/tsconfig` package has no `typescript` devDependency — pre-existing condition; the package is config-only and has no devDependencies at all. TypeScript version enforcement is distributed across each workspace package's own `package.json`. No blocking issue; revisit if a canonical single-pin location is ever desired. [`packages/tsconfig/package.json`]

## Deferred from: code review of 2-1-supabase-auth-email-password-google-apple-oauth (chunk 3: migrations, 2026-04-25)

- `LoginRequestSchema.password` uses `.min(12)` — matches Supabase `minimum_password_length = 12` so registered users always satisfy it; low risk for greenfield beta. Revisit if users are ever migrated from a lower-minimum Supabase project. [`packages/contracts/src/auth.ts:6`]
- RLS migration `20260502090000_enable_rls_users_households.sql` shipped in Story 2.1 despite AC8 deferring RLS to Story 2.2. Migration was needed to support Story 2.2.4 (RBAC preHandler) shipped simultaneously; justified scope creep. Track for retrospective note. [`supabase/migrations/20260502090000_enable_rls_users_households.sql`]

## Deferred from: code review of 2-1-supabase-auth-email-password-google-apple-oauth (chunk 4: auth module, 2026-04-25)

- `revokeAllByFamilyId` on reuse-detection path swallows all errors with `catch {}` — family tokens remain live on transient DB failure with no log visibility. Requires logger injection into `AuthService` (currently no logger constructor param). [`apps/api/src/modules/auth/auth.service.ts:113-119`]
- `account.created` audit is fire-and-forget (void + catch) — silently unrecorded on transient DB failure. Consistent with fire-and-forget audit pattern throughout, but not durable. [`apps/api/src/modules/auth/auth.routes.ts:34-41`]
- `POST /v1/auth/logout` returns 204 when no cookie present — unauthenticated callers generate null-user audit rows; idempotent logout accepted as deliberate design choice. [`apps/api/src/modules/auth/auth.routes.ts:113`]
- `auth.token_reuse_revoked` audit set via `request.auditContext` then immediately throws — event written via `onResponse` hook after error response; process death between response and hook loses a security-critical event. Inherent in fire-and-forget hook architecture. [`apps/api/src/modules/auth/auth.routes.ts:86-91`]
- `create_household_and_user` SQL function relies on schema column defaults for `tier_variant='beta'` and `timezone='America/New_York'` rather than explicit INSERT values — correct today but fragile to future default changes. [`supabase/migrations/20260501120500_create_household_and_user_idempotent.sql:31`]

## Deferred from: code review of 2-1-supabase-auth-email-password-google-apple-oauth (chunk 5: web layer, 2026-04-25)

- No test file for `callback.tsx` — most complex web route (async effect, navigation side-effects, single-use OAuth code). Requires jsdom + React Testing Library + mocked `hkFetch`. Medium effort; no security impact — all auth logic is server-side. [`apps/web/src/routes/auth/callback.tsx`]
- `supabase-client.ts` casts `import.meta.env.VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to `string` with no runtime check — undefined env var produces a confusing SDK error at runtime. Add Zod/explicit env validation on web app bootstrap (similar to `apps/api/src/common/env.ts`). [`apps/web/src/lib/supabase-client.ts:10-11`]

## Deferred from: code review of 1-16-upgrade-zod-3-to-4 (2026-04-25)

- `zod-resolver.ts` silently drops root-level schema refinement errors — `if (path && !errors[path])` skips issues with empty `path` array; no root-level `.refine()` currently in `LoginRequestSchema`, so latent only. [`apps/web/src/lib/zod-resolver.ts:15`]
- `zod-resolver.ts` flat dot-path keys for nested errors (`"address.zip"` instead of `{ address: { zip: {...} } }`) — RHF resolver contract expects nested `FieldErrors<T>`; requires `toNestErrors` equivalent. Not active with current flat schemas but breaks any future nested form. [`apps/web/src/lib/zod-resolver.ts:14`]
- `zod-resolver.ts` missing `context` and `options` params — `criteriaMode: 'all'` and native validation silently ignored; cast `as unknown as Resolver<T>` suppresses type error. [`apps/web/src/lib/zod-resolver.ts:9`]
- Old-format UUIDs (`1111-1111`, `2222-2222`) surviving in `auth.service.test.ts`, `authenticate.hook.test.ts`, `login.test.tsx` — inconsistent with RFC 4122 v4 fix applied elsewhere; not causing current test failures (IDs don't flow through `.uuid()` validation in affected tests).
- `lists.ts` and `voice.ts` not explicitly audited per AC2 — both compile correctly under Zod 4 with no breaking changes; documentation gap only. [`packages/contracts/src/lists.ts`, `packages/contracts/src/voice.ts`]
- `z.discriminatedUnion()` and `ZodError.issues` Zod 4 compatibility not explicitly documented — implicitly verified by passing typecheck and tests.
- pnpm patch for `fastify-type-provider-zod` fixes a runtime bug not covered by AC3 (typecheck only); no integration test exercises a body-validation-failure → patched `createValidationError` path end-to-end. [`patches/fastify-type-provider-zod@4.0.2.patch`]

## Deferred from: code review of 2-4-account-profile-management-recovery (2026-04-26)

- No rate limiting on `POST /v1/auth/password-reset` — free email-bombing vector against any address; infra/middleware concern outside story scope. [`apps/api/src/modules/users/user.routes.ts`]
- `preferred_language` accepts any 2–10 char string with no locale validation — garbage values stored and returned silently. Locale validation is a future story concern. [`packages/contracts/src/users.ts`]
- `fastify-plugin` (`fp`) scoping means `/v1/auth/password-reset` auth-skip depends on global SKIP_PREFIXES — footgun if auth is ever moved to a plugin-scoped preHandler. [`apps/api/src/modules/users/user.routes.ts`]
- `.single()` in `updateUserProfile` throws PGRST116 if the user row is deleted between auth check and DB update — unmapped raw error, extremely unlikely race. [`apps/api/src/modules/users/user.repository.ts`]
- `updateUser` Zustand action silently no-ops when `state.user` is null (e.g., concurrent logout during a slow PATCH) — acceptable silent behaviour for this race. [`apps/web/src/stores/auth.store.ts`]
- `/v1/auth/` blanket `SKIP_PREFIXES` entry is an implicit convention — any future route added under `/v1/auth/` is unauthenticated by default without any explicit marker. Architectural doc concern. [`apps/api/src/middleware/authenticate.hook.ts`]
- Supabase mock chain in tests hardcodes method-chaining order — column name changes or query restructuring pass tests undetected. Accepted test-mock pattern in codebase. [`apps/api/src/modules/users/user.routes.test.ts`]
- Password-reset test does not assert that no auth token is required — nice-to-have assertion to confirm public-route intent. [`apps/api/src/modules/users/user.routes.test.ts`]

## Deferred from: implementation of 2-3-secondary-caregiver-invite-primitive (2026-04-26)

- Pre-existing baseline `pnpm typecheck` failure on `main` from Dependabot bump #21 (`stripe` 16.12.0 → 22.1.0): `apps/api/src/plugins/stripe.plugin.ts:6` sets `apiVersion: '2026-04-22.dahlia'` but the installed `stripe@22.1.0` types pin to `'2024-06-20'`. Not introduced by Story 2.3; confirmed by stash-and-typecheck against pristine main. Blocks the Story 2.3 exit gate `pnpm typecheck`. Suggested fix: bump `stripe` SDK to a version that recognizes the configured apiVersion, OR cast through `Stripe.LatestApiVersion`. [`apps/api/src/plugins/stripe.plugin.ts:6`]

## Deferred from: code review of 2-3-secondary-caregiver-invite-primitive-signed-jwt-single-use-jti-14-day-ttl (2026-04-26)

- **OAuth → `is_first_login` → onboarding redirect silently discards invite** — if a new user signs up via OAuth while following an invite link, `callback.tsx` redirects to `/onboarding` on `is_first_login: true`, permanently discarding the `?next=/invite/:token` destination. The invite token is never redeemed. Requires Story 5.5's full invite UX to fix correctly. [`apps/web/src/routes/auth/callback.tsx:37`]
- **DB insert orphan if JWT signing fails after `insertInvite`** — `createInvite` commits the invite row to the DB before `jwt.sign()` executes. If signing throws (e.g., during a secret rotation mid-request), the row exists with no corresponding token and cannot be redeemed until TTL expiry. Low probability in production. Architectural constraint: supabase-js does not support multi-statement transactions. [`apps/api/src/modules/auth/invite.service.ts:43-61`]

## Deferred from: code review of 2-5-notification-preferences-cultural-language-preference (2026-04-26)

- Service-layer read-modify-write on `notification_prefs` has no row lock — concurrent PATCHes from the same user both read the same stale row, compute divergent merged objects, and the last write wins, silently discarding the first write. Fix requires DB-side `jsonb_set` (atomic JSONB merge) or `SELECT ... FOR UPDATE` row locking in the repository. [`apps/api/src/modules/users/user.service.ts:95-107`]
- Ratchet check for family-language is service-only — not enforced by a DB CHECK constraint. Two concurrent forward-move PATCHes that both read `cultural_language = 'default'` both pass the guard and proceed to write; the 'default'-reversal protection also has this gap. Add a DB-level trigger or CHECK if the ratchet must be unconditionally durable. [`apps/api/src/modules/users/user.service.ts:121`]
- `UnauthorizedError` (401) for user-not-found after a valid JWT — semantically incorrect; should be 404 or 403. Pre-existing pattern throughout `user.service.ts` (`getMyProfile`, `updateMyProfile`, `updateMyNotifications`, `updateMyPreferences`). [`apps/api/src/modules/users/user.service.ts:96`]
- `updateMyPreferences` writes to the DB even when the input value exactly matches the current stored value (`fieldsChanged` = `[]`). No early-exit guard results in an unnecessary DB write + `fetchAuthProviders` Admin API call. [`apps/api/src/modules/users/user.service.ts:130`]

## Deferred from: code review of 2-6-voice-first-onboarding-interview-via-elevenlabs-three-signal-questions (2026-04-26)

- **`/v1/voice/llm` IDOR via leaked `ELEVENLABS_CUSTOM_LLM_SECRET`** — bearer secret is the only public auth gate. With the secret + an observed `conversation_id`, an attacker can drive an LLM response into any household. Operational mitigation: secret rotation policy + secret-storage hygiene; defense-in-depth via the `agent_id` verification patch (review item #14). Standard ElevenLabs Custom LLM auth model — full architectural fix (e.g., per-request signature, JTI nonce) is out of scope for this story. [`apps/api/src/modules/voice/voice.routes.ts`]
- **`getNextSeq` + `appendTurn` is non-atomic** — read `MAX(server_seq)+1` then `INSERT` is two round-trips with no transaction or RPC. Sequential webhook processing avoids the race today, but Story 5.x (concurrent text-mode appends to shared family thread) will hit the `UNIQUE (thread_id, server_seq)` constraint. Fix path: Postgres RPC or per-thread sequence with default expression. [`apps/api/src/modules/voice/voice.repository.ts`]
- **`extractSummary` accepts unbounded transcript length** — joins entire transcript and sends to gpt-4o without max-token clipping. Onboarding's 10-minute budget caps real-world size, low risk for this story. Add token-clipping when text-mode (Story 2.7) and longer threads land. [`apps/api/src/agents/onboarding.agent.ts`]
- **Real Supabase integration test for `UNIQUE (thread_id, server_seq)` collision** — current vitest mocks return `{ error: null }` regardless of duplicate `server_seq`, so the race-condition contract is unenforced by tests. Needs Supabase test-DB infra. [`apps/api/src/modules/voice/voice.routes.test.ts`]
- **Scoped content-type parser isolation test** — no test asserts that the `parseAs: 'string'` parser scoped to the webhook route does NOT bleed into other JSON routes. A regression that globalised the parser would not be caught. [`apps/api/src/modules/voice/voice.routes.test.ts`]

## Deferred from: code review of 2-7-text-equivalent-onboarding-path (2026-04-26)

- **F02 — `getNextSeq` starts at seq 1**: pre-existing pattern from Story 2.6; if DB schema uses 0-based `server_seq`, the first turn gets seq 1 instead of 0. Not confirmed without schema inspection. [`apps/api/src/modules/threads/thread.repository.ts:130`]
- **F15 — `onboarding.routes.ts` direct instantiation**: `ThreadRepository`, `OnboardingAgent`, and `OnboardingService` are created inline in the plugin without Fastify DI decorators or `onClose` lifecycle hooks. Consistent with existing route patterns in this codebase; revisit when a DI / lifecycle hardening pass is warranted.
