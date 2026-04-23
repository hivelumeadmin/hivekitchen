---
project_name: 'hivekitchen'
user_name: 'Menon'
date: '2026-04-23'
sections_completed:
  [
    'technology_stack',
    'language_specific',
    'framework_specific',
    'testing',
    'code_quality',
    'workflow',
    'critical_dont_miss',
  ]
status: 'complete'
rule_count: 152
optimized_for_llm: true
---

# Project Context for AI Agents

_This file contains critical rules and patterns that AI agents must follow when implementing code in this project. Focus on unobvious details that agents might otherwise miss._

---

## Technology Stack & Versions

### Monorepo
- Turborepo ^2.4 with pnpm ^9.15 workspaces (`apps/*`, `packages/*`)
- Package manager pinned in root `package.json` — never use npm/yarn
- Node >=22 required (`@types/node` ^22)
- Node floor is NOT enforced by `engines` field; don't use Node 23-only APIs

### Apps
- **`@hivekitchen/web`** — Vite ^6 + React ^19 SPA (NOT Next.js)
  - Tailwind ^3.4, Zustand ^5, ElevenLabs client SDK (voice only), native `EventSource` for SSE
  - Path alias `@/*` → `./src/*` — **WEB ONLY**, not available in `api` or shared packages
  - Zustand 5 requires curried `create`: `create<Shape>()(set => ...)`. v4 signature breaks under strict TS.
- **`@hivekitchen/api`** — Fastify ^5.2, Pino ^9.6, Zod ^3.23; ESM (`"type": "module"`)
  - `tsx watch` in dev, compiled `node dist/server.js` in prod
  - Request validation uses schemas from `@hivekitchen/contracts`. Prefer `fastify-type-provider-zod` over hand-rolled Ajv.
  - No `console.*`; use Fastify's request logger or a Pino child logger

### Shared Packages (source-imported — no build step)
- **`@hivekitchen/contracts`** — Zod schemas ONLY. `main`/`types` → `src/index.ts`
- **`@hivekitchen/types`** — types via `z.infer<typeof schema>`
- **`@hivekitchen/tsconfig`** — base/node/react presets
- Never import from `@hivekitchen/contracts/dist/...`. Never add `dist/` outputs to `contracts` or `types`.
- Shared packages use relative imports only — no path aliases

### TypeScript
- TS ^5.5, `strict: true`, `moduleResolution: "bundler"`, `isolatedModules: true`, ESM everywhere
- `isolatedModules`: type-only re-exports require `export type { ... }`; type-only imports require `import type { ... }`. No `const enum`.
- ESM: no `require()`, no `__dirname`/`__filename`. Use `import.meta.url` + `fileURLToPath`.
- In `apps/api`, TSC-emitted code requires explicit `.js` extensions on relative imports
- `pnpm typecheck` must pass; `tsx watch` hides some errors that break `pnpm build`

### Real-time Transport (global rule)
- SSE for all server→client streaming. WebSocket is reserved for ElevenLabs voice only.

### External Services (integration boundaries, not npm deps)
- Supabase (Postgres + Auth/JWT), Redis, OpenAI (Agent Layer), ElevenLabs (voice)

### Version Constraints
- **React 19** — no class components, no legacy `ReactDOM.render`. Vite SPA context: no RSC, no Server Actions. Mutations via Zustand + `fetch`, not React 19 Actions.
- **Fastify 5** — async plugin API
- **Vite 6** — avoid Vite 4/5-only plugin APIs
- **Zod 3.23** (not Zod 4) — `z.infer<typeof schema>`

## Critical Implementation Rules

### Language-Specific Rules (TypeScript)

**Strictness & type hygiene**
- `strict: true` is non-negotiable. No `any`, no `// @ts-ignore`, no `// @ts-expect-error` without a linked issue comment explaining why.
- Prefer `unknown` over `any` at API boundaries. Narrow with Zod `.parse()`/`.safeParse()`.
- No non-null assertions (`x!`) on values that cross a Zod boundary — let the schema narrow them.

**Imports & exports**
- Always `import type` for type-only imports and `export type` for type-only re-exports (isolatedModules).
- No default exports except where the framework requires them (Vite entry, route modules). Prefer named exports.
- No barrel files inside `apps/*/src` (hurts tree-shaking and rename refactors). Shared packages MAY re-export from `src/index.ts` since that is the package entry.
- No circular imports. If two modules need each other, split the shared piece out.

**Async & errors**
- `async`/`await` only — no raw `.then()` chains except in one-liners where `await` would be noise.
- Never `throw` untyped values. Prefer `throw new Error("...")` or a tagged error class; Fastify handlers propagate to the global error handler — don't swallow.
- API error responses are Zod-validated contract shapes, not ad-hoc JSON.

**Nullability & equality**
- `===`/`!==` only. No `==`/`!=`.
- Prefer `value ?? fallback` over `||` when falsy-vs-null matters (empty string, 0).
- Use `satisfies` to constrain objects to a schema without widening them.

**Data shapes**
- No hand-written types that duplicate a contract shape — always `z.infer<typeof schema>` from `@hivekitchen/contracts` via `@hivekitchen/types`.
- Dates cross the wire as ISO 8601 strings (`z.string().datetime()`), not `Date` objects. Convert at the edges.

**Things NOT to do**
- No `namespace` blocks, no `module` declarations outside `*.d.ts`.
- No `enum` (use `as const` unions). No `const enum` (banned by isolatedModules).
- No `require()`, `module.exports`, `__dirname`, `__filename`.
- No `process.env.FOO` reads scattered across code — centralize env parsing in one Zod-validated config module per app.

### Framework-Specific Rules

#### React 19 + Vite (apps/web)

**Components & hooks**
- Function components only. No class components.
- Hooks at the top level — never inside conditionals, loops, or callbacks.
- Don't add `useCallback`/`useMemo` reflexively; only when profiling shows a hot render or when an unstable reference causes downstream re-renders.
- `useEffect` is for syncing with external systems (subscriptions, DOM, timers). Never use it to compute derived state — compute inline or with `useMemo`.
- Prefer `use()` for unwrapping promises/context in conditional code paths (React 19).

**Data fetching & mutations**
- Fetch through a single `lib/api.ts` client that imports Zod schemas from `@hivekitchen/contracts` and parses responses before returning. Never `fetch(...).json()` raw into components.
- SSE uses the native `EventSource` via `lib/sse.ts`. Components subscribe via a hook, not by instantiating `EventSource` in a component body.
- Mutations: optimistic UI via Zustand + `fetch`. Don't adopt React 19 Actions — SPA has no route-level form boundary for them.

**State (Zustand 5)**
- Stores live in `src/stores/*`. One store per concern (e.g., `planStore`, `voiceStore`), not a single mega-store.
- Signature: `create<Shape>()((set, get) => ({ ... }))` — the curried form is required by v5 + strict TS.
- Selectors only: components subscribe with `useStore(s => s.slice)`, never pull the whole store.
- No middleware (persist/immer/devtools) unless the dep is already installed — don't introduce middleware ad hoc.
- Derived values stay in the store as getters or in component selectors; don't duplicate server state into Zustand (the API is the source of truth).

**Styling (Tailwind 3.4)**
- Tailwind utilities only. No CSS modules, no styled-components, no `.css` files except `index.css` with `@tailwind` directives.
- No inline `style={{ ... }}` except for truly dynamic values (e.g., computed transforms). Design-system tokens go through Tailwind config.
- Class ordering: layout → box → typography → color → state. Extract with `clsx`/`cn` when conditional. No long class-string concatenation by hand.
- Design constraint (from `apps/web/CLAUDE.md` + Design System spec): warm neutrals only (honey/olive/clay/oat/charcoal); editorial serif + refined sans; soft transitions; no SaaS-dashboard chrome; no chat-first layouts.

**File structure (apps/web/src)**
- `app/` routes and providers — Vite SPA entry lives here despite the Next.js-style folder name.
- `components/` — shared UI primitives. No business logic.
- `features/<name>/` — feature-scoped modules (plan, onboarding, swap…). Own their hooks, components, and local state.
- `hooks/` — cross-feature hooks.
- `stores/` — Zustand stores.
- `lib/` — api client, SSE client, utilities.
- `types/` — frontend-only types. Shared types come from `@hivekitchen/types`.

#### Fastify 5 (apps/api)

**Route shape**
- Routes are registered via async plugin functions, one file per resource under `src/routes/<resource>.ts`.
- Every route declares `schema: { body, querystring, params, response }` sourced from `@hivekitchen/contracts`. Untyped `request.body` is a bug.
- Handlers stay thin — call a service function and return the result. No DB calls, no agent orchestration in the handler body.

**Plugins & encapsulation**
- Use Fastify's plugin encapsulation for scoping (auth, rate-limit, agent context). Don't hang state off `fastify.myThing` unless it's registered via `fastify.decorate`.
- Async plugin API only — no callback-style plugins.

**Errors & logging**
- Throw from handlers; let Fastify's error handler serialize. Register a global error handler that maps known error classes to the contract error shape.
- Use `request.log` (Pino child logger auto-bound with requestId). Never `console.*`. Never log PII or raw ElevenLabs audio.

**Real-time**
- SSE endpoints use `reply.raw` with `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`. Heartbeat every ~15s. Clean up on `request.raw.on('close')`.
- WebSocket endpoints exist only for ElevenLabs voice bridging. Never add a general-purpose WS route.

**Agent Layer boundary**
- Routes invoke the Agent Orchestrator via an injected service. The Agent Layer is stateless and MUST NOT read/write the DB directly — it returns a response + resource payload; the API layer persists.

**Config & env**
- One Zod-validated `env.ts` at startup. All `process.env` reads go through it. Crash fast on invalid env.

### Testing Rules

**Status:** No test runner is installed yet. These rules apply once a runner is added (recommended: Vitest for `web`, `api`, and shared packages; Playwright for web E2E; Fastify's `inject()` for API integration).

**Test placement**
- Unit tests: colocated as `*.test.ts` / `*.test.tsx` next to the source file.
- Integration tests (API): under `apps/api/test/integration/<resource>.test.ts`, one file per resource route.
- E2E (web): under `apps/web/e2e/<flow>.spec.ts`, organized by user flow (onboarding, plan-review, voice-session).
- Shared contracts get round-trip schema tests in `packages/contracts/test/*.test.ts`.

**What to test (by layer)**
- **Contracts** — schema parses accept valid shapes and reject invalid ones at known edges (missing required, extra fields if `.strict()`, datetime format, enum values).
- **API services** — business logic in `src/services/*`. Unit-test with real dependencies where cheap, fake DB only at the repository boundary.
- **API routes** — use `fastify.inject()` for full request/response cycles. Never mount a real HTTP server in tests.
- **Agent Layer** — unit-test orchestration logic with stubbed OpenAI responses. Test decisions (which tool was called, which payload was produced), not LLM output verbatim.
- **Web components** — render + interaction tests with `@testing-library/react`. Test behavior, not markup structure.
- **Web stores** — Zustand stores are plain functions; test state transitions directly, no React needed.

**Mocking discipline**
- Do NOT mock `@hivekitchen/contracts` or `@hivekitchen/types` — they're source-imported and deterministic.
- Do NOT mock the database in integration tests that claim to validate persistence. Use a real Postgres (test container or local) and truncate between tests. Mocks there produce green-but-broken migrations.
- DO mock external services at the network boundary: OpenAI, ElevenLabs webhooks, Supabase Auth (for unit scope). Use `msw` for web fetch mocks.
- No snapshot tests for rendered markup — too noisy, too easy to rubber-stamp. Snapshot only structured data (parsed contract output, agent decision logs).

**Test structure**
- Arrange/Act/Assert, with blank lines between. No shared mutable state across tests in the same file.
- `describe` per unit under test; `it` per behavior ("returns 400 when body is missing", not "test1").
- Each test is independent and can run in any order. No `beforeAll` that leaks state into other tests.
- No conditional logic (`if` / `try`) in test bodies — if the path branches, write two tests.

**Coverage expectations**
- No hard percentage gate. Required: every route has at least one happy-path and one validation-failure test; every service function has unit coverage for its branches; every contract has a round-trip test.
- Coverage reports are a diagnostic, not a gate. Don't game the number.

**Things NOT to do**
- No network calls to real external services in CI (OpenAI, ElevenLabs, Supabase hosted). Use fixtures or local containers.
- No `sleep`/`setTimeout`-based waits. Use event-driven waits (`waitFor`, Fastify `inject` promise, Playwright auto-wait).
- No tests that only assert "it doesn't throw". Assert the actual effect.
- No shared test fixtures that hide setup across files — readable tests over DRY tests.

### Code Quality & Style Rules

**Linting & formatting (status: not yet configured)**
- When added, use a single flat `eslint.config.js` at the repo root (ESLint 9 flat config), extended by per-package overrides. Don't introduce per-app `.eslintrc.cjs` files.
- Prettier is the formatter. No hand-formatted alignment, no commented-out code left in commits.
- TypeScript is the source of truth for types — ESLint should NOT run `@typescript-eslint` rules that duplicate TSC (e.g., `no-unused-vars` uses the TS-aware variant, ESLint's own is off).
- One rule that must be on: `@typescript-eslint/consistent-type-imports` — enforces `import type` (required by `isolatedModules`).

**Naming**
- **Files**
  - React components: `PascalCase.tsx` (e.g., `PlanCard.tsx`).
  - Hooks: `useXxx.ts` (camelCase, `use` prefix).
  - Zustand stores: `xxxStore.ts` (camelCase).
  - Everything else (services, utils, route files): `kebab-case.ts` (e.g., `plan-service.ts`, `auth-plugin.ts`).
  - Tests mirror the source filename with `.test.ts`/`.test.tsx`.
- **Symbols**
  - Types & interfaces: `PascalCase`. No `I` prefix on interfaces.
  - Constants (module-scope, truly constant): `SCREAMING_SNAKE_CASE`. Runtime-derived "constants" stay `camelCase`.
  - Zod schemas: `PascalCaseSchema` (e.g., `PlanSchema`); the inferred type drops the suffix (`Plan`).
  - Boolean variables/props: affirmative + predicate form (`isOpen`, `hasError`, `canSubmit`). No negatives (`isNotLoading`).
- **API routes & resources**
  - URL paths: `kebab-case`, plural nouns (`/lunch-plans`, `/heart-notes`).
  - Route handlers: one file per resource under `apps/api/src/routes/<resource>.ts`.

**File organization**
- Max ~300 lines per file. Over that, split by concern.
- One top-level export per file where practical; exceptions for tightly coupled helpers.
- Never cross feature boundaries laterally: `features/plan/` should not import from `features/voice/`. Shared code promotes to `lib/`, `components/`, or a shared package.
- `apps/web` never imports from `apps/api`, and vice versa. The only shared surface is `packages/*`.

**Comments & documentation**
- Default: no comments. Let identifiers carry the meaning.
- Write a comment only when the *why* is non-obvious: a hidden constraint, a workaround for a specific bug (link the issue), a subtle invariant, or surprising behavior.
- No "what" comments (`// increment counter`). No commit-log comments (`// added for story-123`). No commented-out code.
- JSDoc only on public exports from `packages/contracts` and `packages/types` where consumers need the hint. Not on internal functions.

**Imports**
- Order (enforced by ESLint import plugin when configured):
  1. Node built-ins (`node:fs`, `node:path`)
  2. External packages (`react`, `fastify`, `zod`)
  3. Shared workspace packages (`@hivekitchen/contracts`, `@hivekitchen/types`)
  4. App-local aliased imports (`@/...`, web only)
  5. Relative imports (`./`, `../`)
- Blank line between groups. `import type` stays in its own block at the top of its group.
- No wildcard imports (`import * as X`) except for namespace libraries that require it.

**Dead code & dependencies**
- Remove unused exports, unused imports, unused files. Don't leave "might need later" code.
- Before adding a dependency: check if it's already installed elsewhere in the monorepo; check if the std lib or existing util covers it; confirm ESM compatibility. No CJS-only packages without a documented reason.
- Dependencies go in the package that uses them, not the root. Root `package.json` holds only build-tool devDeps (Turbo).

**Formatting defaults (Prettier, when added)**
- 2 spaces, single quotes for JS/TS, double quotes for JSX attributes, trailing commas (all), semicolons on, print width 100.

### Development Workflow Rules

**Branches**
- `main` is the integration branch. Never commit directly to `main`.
- Branch names: `feat/<short-slug>`, `fix/<short-slug>`, `docs/<short-slug>`, `refactor/<short-slug>`, `chore/<short-slug>`.
- Slug is kebab-case, ≤40 chars, descriptive (`feat/lunch-link-onboarding`, not `feat/stuff`).
- One concern per branch. Don't bundle an unrelated fix into a feature branch.

**Commits (Conventional Commits)**
- Format: `<type>(<optional-scope>): <subject>`
- Types in use: `feat`, `fix`, `docs`, `refactor`, `chore`, `test`, `perf`, `style`.
- Subject: imperative mood, lowercase, ≤72 chars, no trailing period. (`feat(plan): add weekly swap flow`)
- Scope, when used, matches the package or feature area: `web`, `api`, `contracts`, `types`, `plan`, `voice`, `agent`.
- Body (optional): explain WHY, not WHAT. Wrap at 100 cols.
- Breaking changes: append `!` after the type/scope and include a `BREAKING CHANGE:` footer.
- One logical change per commit. Don't squash unrelated work together; don't split a single change into noisy micro-commits.

**Pull requests**
- Target `main`. Rebase on top of `main` before opening (no merge commits in the branch).
- Title follows the same Conventional Commits format as commits.
- Description includes: summary of the change, why it's needed (link the story/epic), manual verification steps, and any follow-ups deferred.
- Keep PRs reviewable — aim for <500 changed lines where possible. Split mechanical refactors from behavior changes.
- A PR must pass `pnpm typecheck` and `pnpm lint` locally before opening. CI re-runs these; don't rely on CI to find errors you could find in 10 seconds.

**Running the stack locally**
- Install: `pnpm install` at the repo root.
- Dev: `pnpm dev` (runs all apps via Turbo) or `pnpm dev:web` / `pnpm dev:api` for a single app.
- Typecheck everything: `pnpm typecheck`.
- Lint everything: `pnpm lint`.
- Build: `pnpm build`.
- Do not run scripts from inside `apps/*` directly unless debugging Turbo itself — use the root scripts so cache + dependency order are honored.

**Turborepo discipline**
- If you add a new package-level script that Turbo should orchestrate, register it in `turbo.json` with correct `dependsOn` and `outputs`.
- `dev` tasks are `persistent: true` and uncached — don't add them to a `dependsOn` chain.
- Build outputs go to `dist/` — if a package writes elsewhere, update `turbo.json` `outputs` or Turbo's cache will go stale.

**Secret & sensitive-data hygiene**
- Never commit `.env`, `.env.local`, service-account JSON, or Supabase service-role keys. `.gitignore` is authoritative — if a tempting file isn't ignored, add it before staging.
- Every runtime secret is read through the Zod-validated `env.ts` in each app, not via ad-hoc `process.env` reads.
- No secret values in logs, error messages, or commit messages. Log secret *names* if you must, never values.
- PII (child names, school IDs, allergies, heart notes) must not appear in Pino logs or error bodies. Hash or omit.
- Don't paste production data into test fixtures.

**Schema changes (contracts)**
- A contract change is a coordinated change: update the Zod schema in `packages/contracts`, adjust `packages/types` consumers if needed, then update `apps/web` and `apps/api` in the same PR.
- Never ship a contract change that only one side of the wire implements. That's a runtime break disguised as a passing typecheck.
- For breaking contract changes, version the field or add a new endpoint rather than mutating existing shapes silently.

**Migrations & data layer**
- Database migrations land via Supabase migration files, not ad-hoc SQL. One migration per behavior change, never squashed mid-stream.
- Migrations run before the API deploy that depends on them. Never ship an API change that assumes a column that isn't live yet.
- All DB access lives in `apps/api` only — never from web, never from the Agent Layer. If a feature seems to need agent-side DB access, surface a new API endpoint instead.

**Agent & AI workflow (build-time rules)**
- AI-generated code is a draft. Run `pnpm typecheck` and `pnpm lint` before committing. If tests exist for the touched area, run those too.
- Never commit AI-authored code that wasn't read end-to-end. "It compiles" is not a review.
- Don't introduce new external dependencies in an AI-generated change without explicit confirmation from the reviewer.

### Critical Don't-Miss Rules

These are the invariants that silently break HiveKitchen if violated. If any are unclear in a task, stop and ask.

**Architectural invariants**
- **API is the only door to the Data Layer.** No Postgres/Supabase calls from `apps/web`. No DB calls from the AI Agent Layer. If a need seems to require this, add an API endpoint instead.
- **Agent Layer is stateless.** It takes input, returns a response + resource payload. It never persists, never schedules, never caches across invocations.
- **One conversation thread model.** Text and voice share the same thread. Never fork storage or identity between modalities — the thread ID is the join key.
- **SSE for server→client streaming; WS is voice-only.** Don't add a general-purpose WebSocket route. Don't wrap SSE in a WS bridge "for consistency."
- **Contracts are the wire truth.** If `apps/web` and `apps/api` disagree on a shape, the `packages/contracts` schema is correct and the apps are wrong. Fix the apps.

**Type & validation invariants**
- **Every inbound boundary is Zod-parsed.** API request bodies, ElevenLabs webhooks, OpenAI tool-call arguments, env vars. No `as SomeType` shortcuts on untrusted input.
- **No hand-written types that duplicate a contract.** Always `z.infer<typeof Schema>` via `@hivekitchen/types`.
- **No `any`, no non-null assertions across a validation boundary.** If TS complains, add the Zod narrowing — don't silence it.

**ESM & module invariants**
- No `require()`, no `__dirname`, no `__filename`. Use `import.meta.url` + `fileURLToPath` when needed.
- `isolatedModules`: always `import type` / `export type` for type-only edges. No `const enum`.
- Shared packages (`contracts`, `types`) are **source-imported** — never reference a `dist/` path. Never add a build step without updating this doc and every consumer.
- In `apps/api`, emitted JS needs `.js` extensions on relative imports. `tsx` hides this in dev; `pnpm build` catches it.

**Design & UX invariants (apps/web)**
- HiveKitchen is a **system-led, weekly-rhythm** experience. The UI presents ready answers — it is not a form-builder or a chat surface.
- No chat-first layouts. No SaaS-dashboard chrome. No futuristic "AI" aesthetics.
- Tailwind utilities only. Warm-neutral palette. Editorial serif + refined sans. No Inter, no Roboto.
- Each screen answers: what decision is being removed, what reassurance is being provided, what is the ONE thing to do.

**Voice pipeline invariants**
- **ElevenLabs owns the audio pipeline.** STT, TTS, and turn management belong to them. HiveKitchen orchestrates text-level turns and transcript persistence.
- Never send raw audio to OpenAI or log it. Never store audio blobs in the API's DB.
- Voice and text updates to the same thread must arrive in order; the API is the serializer.

**Security & privacy invariants**
- JWT validation lives in a Fastify preHandler plugin, not inside route handlers. No route bypasses it except explicitly documented public endpoints.
- PII (child names, school identifiers, allergies, heart notes, addresses) must never appear in: Pino log lines, error response bodies, OpenAI prompts outside scoped agent context, test fixtures committed to git.
- No secrets in logs, errors, or client-reachable payloads. The web bundle must not embed any non-public key.
- Don't weaken RLS to make a query easier. If RLS blocks you, the query shape is wrong.

**Workflow invariants**
- Never skip Git hooks (`--no-verify`). If a hook fails, fix the underlying issue.
- Never force-push to `main`. Never commit directly to `main`.
- Never introduce a new external dependency without a recorded reason. "LLM suggested it" is not a reason.
- Never bundle a contract change that only one side of the wire implements in one PR — update contract + web + api together.

**Anti-patterns to actively reject**
- Adding `useEffect` to compute derived state.
- Fetching JSON into a component without Zod parsing.
- Creating a global Zustand store because two features "might" share state.
- Writing a service that the API calls AND the agent calls — services live in the API; agents receive outcomes, not services.
- Adding a `console.log` "temporarily."
- Generating Tailwind class strings via template concatenation that spans 4+ lines — extract to a variant helper.
- Snapshot-testing rendered DOM.
- Using `sleep`/`setTimeout` in tests.

---

## Usage Guidelines

**For AI Agents:**
- Read this file before implementing any code in the HiveKitchen repo.
- Follow ALL rules as written; prefer the more restrictive option when ambiguous.
- If a task appears to require violating an invariant (especially in the "Critical Don't-Miss Rules"), stop and ask before proceeding.
- Treat contracts + types as the wire truth. When in doubt, fix the code — not the schema.

**For Humans:**
- Keep this file lean and focused on what agents actually miss.
- Update when the stack changes (new framework version, new shared package, new transport).
- Review periodically (e.g., at each epic retrospective) and remove rules that have become obvious or obsolete.
- If you find yourself giving an agent the same correction twice, that correction belongs here.

Last Updated: 2026-04-23
