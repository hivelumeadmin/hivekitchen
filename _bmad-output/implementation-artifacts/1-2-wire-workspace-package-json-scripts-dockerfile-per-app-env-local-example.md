# Story 1.2: Wire workspace package.json scripts + Dockerfile + per-app .env.local.example

Status: in-progress

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want a complete set of workspace scripts (`supabase:start`, `supabase:stop`, `supabase:reset`, `seed:dev`, `seed:reset`, `test`), a Fly.io-ready `Dockerfile` for `apps/api`, and a committed `.env.local.example` for every app,
so that a new engineer can `pnpm install && pnpm supabase:start && pnpm seed:dev && pnpm dev` and have a working local environment in under five minutes.

## Acceptance Criteria

1. Root `package.json` exposes the full workspace script set: `dev`, `build`, `lint`, `typecheck`, `test`, `supabase:start`, `supabase:stop`, `supabase:reset`, `seed:dev`, `seed:reset`, `clean`, plus the existing per-app `dev:web` / `dev:api` / `dev:marketing` aliases. New Supabase scripts delegate to the `supabase` CLI; `seed:*` scripts delegate to the root-level `test/helpers/seed-dev.ts`; `test` delegates to Turborepo.
2. `turbo.json` declares the `test` task so `pnpm test` fans out via Turborepo filter graph (workspaces without a `test` script are tolerated silently, matching Turbo's default behavior).
3. `apps/api/Dockerfile` exists as a Node 22 multi-stage build with the shape described in **Exact Dockerfile** below — builder stage runs `pnpm --filter @hivekitchen/api build`; runtime stage holds only `dist/`, `package.json`, and production `node_modules`; entrypoint `node dist/server.js`; image builds successfully from repo root via `docker build -f apps/api/Dockerfile -t hivekitchen-api:local .`
4. `apps/api/.env.local.example`, `apps/web/.env.local.example`, and `apps/marketing/.env.local.example` all exist as committed, non-secret templates suitable for `cp *.env.local.example *.env.local`-style bootstrap.
5. `apps/api/.env.local.example` enumerates every env var consumed by the API runtime, with sanitized placeholder values and inline comments grouping by integration surface: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, `ELEVENLABS_API_KEY`, `ELEVENLABS_WEBHOOK_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SENDGRID_API_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `REDIS_URL`, `JWT_SECRET`, `LOG_LEVEL`, `NODE_ENV`, `PORT`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`. Header comment explicitly reminds readers that Zod validation lands in Story 1.6.
6. `apps/web/.env.local.example` contains `VITE_API_BASE_URL` and `VITE_SSE_BASE_URL` with sensible local defaults.
7. `apps/marketing/.env.local.example` contains `SITE_URL` (build-time) with a local-dev placeholder; the Story 1.1 placeholder-only stub is replaced with real content.
8. `test/helpers/seed-dev.ts` exists as a **stub** that prints `[seed-dev] stub — real seed lands in a later story (see _bmad-output/implementation-artifacts/sprint-status.yaml)` and exits `0` for both `seed:dev` and `seed:reset` invocations (supports a `--reset` flag). File is runnable via `pnpm seed:dev` and `pnpm seed:reset`.
9. `README.md` at repo root exists and contains a **"Local development"** section documenting the full first-run bootstrap sequence per architecture §Development Workflow (line 1451–1469), plus prerequisites (Node ≥22.12, pnpm 9.15.0 via Corepack, Supabase CLI, Docker for Redis).
10. `pnpm typecheck` and `pnpm build` from workspace root still pass across the entire monorepo — no regression to Story 1.1's green state.

### AC → Task mapping (Definition of Done)

| AC | Satisfied by |
|---|---|
| AC1 | Tasks 2, 3 |
| AC2 | Task 3 |
| AC3 | Tasks 5, 6, 9 |
| AC4 | Tasks 7 |
| AC5 | Task 7 |
| AC6 | Task 7 |
| AC7 | Task 7 |
| AC8 | Task 4 |
| AC9 | Task 8 |
| AC10 | Task 9 |

## Tasks / Subtasks

- [x] **Task 1 — Pre-flight verification** (no AC)
  - [x] Confirm Story 1.1 is `done` in `_bmad-output/implementation-artifacts/sprint-status.yaml`.
  - [x] Confirm workspace manifest state: `apps/{web,api,marketing}`, `packages/{contracts,types,tsconfig,ui}`, root `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `.gitignore`, `.npmrc` all present. Do NOT add dependencies beyond what is explicitly listed in this story's **Dependency Exceptions** section.
  - [x] Confirm `apps/marketing/.env.local.example` exists as a Story 1.1 placeholder (to be expanded in Task 7), and that `apps/api/.env.local.example` + `apps/web/.env.local.example` do **not** yet exist.
  - [x] Confirm `.gitignore` lines already protect `.env.local`, `.env.production`, `.env.staging` (from Story 1.1 review patch). Do NOT revert those patterns.

- [x] **Task 2 — Add `tsx` as a root-level dev dependency** (AC: 1)
  - [x] Add `"tsx": "^4.19.0"` to the root `package.json` `devDependencies`. This is the documented exception to the "deps go in the package that uses them" rule (see **Dependency Exceptions** in Dev Notes) — `test/helpers/seed-dev.ts` lives at workspace root per architecture §Complete Project Directory Structure line 1305–1309 and needs a root-resolvable TypeScript runner.
  - [x] Run `pnpm install` to refresh the lockfile. Expect the new dep to land and no other workspace resolutions to shift.

- [x] **Task 3 — Wire root `package.json` scripts and `turbo.json` tasks** (AC: 1, 2)
  - [x] Edit root `package.json` to add/update scripts exactly per **Exact Root Scripts** in Dev Notes. Preserve existing script ordering where reasonable for clean diffs. Keep `dev:web`, `dev:api`, `dev:marketing` aliases from Story 1.1.
  - [x] Edit `turbo.json` to register a `test` task: `"test": { "dependsOn": ["^build"], "outputs": ["coverage/**"] }`. Do NOT add `inputs` restrictions in this story; let Turbo use the default.
  - [x] Do NOT modify existing `build`/`dev`/`lint`/`typecheck`/`clean` task definitions.
  - [x] Verify: `pnpm test` runs Turbo and completes cleanly (no workspace has a `test` script yet; Turbo reports "no tasks were executed" or similar and exits 0).

- [x] **Task 4 — Create `test/helpers/seed-dev.ts` stub** (AC: 8)
  - [x] Create directory `test/helpers/` at workspace root.
  - [x] Create `test/helpers/seed-dev.ts` per **Exact Seed Stub** in Dev Notes. Contents: parse `--reset` flag from `process.argv`, log a clear banner indicating stub status, exit 0.
  - [x] Verify: `pnpm seed:dev` and `pnpm seed:reset` both produce expected log output and exit 0.

- [x] **Task 5 — Create `.dockerignore` at workspace root** (AC: 3)
  - [x] Create `.dockerignore` at repo root per **Exact .dockerignore** in Dev Notes. This is required BEFORE the Dockerfile task so the `docker build` context stays lean (excludes `node_modules/`, `.turbo/`, `dist/`, `.astro/`, `.env*`, `_bmad*/`, `docs/`, `.claude/`, `specs/`, `_bmad-output/`).
  - [x] A missing `.dockerignore` would ship the entire `node_modules/` tree into the Docker build context on every `docker build`, inflating context size by hundreds of MB and invalidating the layer cache needlessly.

- [x] **Task 6 — Create `apps/api/Dockerfile`** (AC: 3)
  - [x] Create `apps/api/Dockerfile` per **Exact Dockerfile** in Dev Notes. Multi-stage: `builder` (Node 22 Alpine, Corepack pnpm 9.15.0, full workspace install, filtered build, `pnpm deploy --prod`) → `runner` (Node 22 Alpine, non-root user `hk`, only `dist/` + `package.json` + flattened `node_modules`).
  - [x] Build context is workspace root. The docker-build command in AC 3 uses `-f apps/api/Dockerfile`.
  - [x] Pass `NODE_VERSION` and `PNPM_VERSION` as ARG with defaults matching repo state (`22` and `9.15.0`); `fly.toml` can override later.
  - [x] Do NOT install `supabase` CLI, `docker` CLI, build toolchains, or anything else into the runtime image. Runtime is a pure Node 22 Alpine with the deployed bundle.

- [x] **Task 7 — Create / populate `.env.local.example` files** (AC: 4, 5, 6, 7)
  - [x] Create `apps/api/.env.local.example` per **Exact apps/api env template** in Dev Notes. Every var from AC 5 present with sanitized placeholder, grouped by integration surface with comment headers. Header comment notes "Zod validation lands in Story 1.6 — values must parse against `apps/api/src/common/env.ts` once that lands."
  - [x] Create `apps/web/.env.local.example` per **Exact apps/web env template** in Dev Notes. Contains `VITE_API_BASE_URL=http://localhost:3001` and `VITE_SSE_BASE_URL=http://localhost:3001`.
  - [x] Replace the Story 1.1 placeholder-only `apps/marketing/.env.local.example` with the content in **Exact apps/marketing env template**. Contains `SITE_URL=http://localhost:4321`.
  - [x] Confirm `.gitignore` does NOT include any `.env.local.example` pattern (Story 1.1 patch already fixed this; re-verify the three files are NOT ignored by running `git check-ignore apps/*/.env.local.example` — all three should return exit 1).

- [x] **Task 8 — Add `README.md` root with Local development section** (AC: 9)
  - [x] Create `README.md` at repo root per **Exact README** in Dev Notes. Minimal content: project name + one-line description, **"## Local development"** section documenting prerequisites + bootstrap sequence exactly matching architecture §Development Workflow (line 1453–1469), **"## Workspace scripts"** section listing every root script with a one-line purpose.
  - [x] Do NOT add contribution guidelines, license, or marketing copy — out of scope (those land with Story 1.14 PR template + later docs work).
  - [x] Do NOT link to any private or unpublished external URL. Cite only paths inside this repo (architecture doc, project-context, sprint-status).

- [ ] **Task 9 — Verify** (AC: 3, 10)
  - [x] Run `pnpm install` from workspace root. Expect: `tsx` added to root, lockfile updated, no other resolution changes.
  - [x] Run `pnpm typecheck` from workspace root. Expect: **6/6 passes** (matches Story 1.1's green state — this story adds no TypeScript surface to typecheck beyond the seed stub, which is plain TS with no imports).
  - [x] Run `pnpm build` from workspace root. Expect: **3/3 passes** (marketing, api, web — unchanged from Story 1.1).
  - [x] Run `pnpm test` from workspace root. Expect: Turbo reports no executed tasks and exits 0 (no workspace declares a `test` script yet).
  - [x] Run `pnpm seed:dev` and `pnpm seed:reset` from workspace root. Expect: banner log output, exit 0.
  - [ ] Run `docker build -f apps/api/Dockerfile -t hivekitchen-api:local .` from workspace root. Expect: build completes; final image tagged. Do NOT run `docker run` in this story — that requires env values + Supabase + Redis end-to-end (out of scope for 1.2; lands with the startup integration in Story 1.6).
    - **If Docker is unavailable in the dev environment:** record this as an environmental blocker in Dev Agent Record → Debug Log References, matching Story 1.1's Node-version-blocker pattern. Do NOT mark AC 3 complete until a user unblock (install Docker or route to CI) produces a successful build.
  - [x] Do NOT run `pnpm supabase:start`. Supabase CLI requires `supabase/config.toml` (created by `supabase init`, out of scope for 1.2 — see **Out of scope** in Dev Notes). The bootstrap sequence in README states this prerequisite; wiring is verified by script existence + CLI invocation path.

- [x] **Task 10 — Commit** (no AC — workflow discipline)
  - [x] Branch name: `feat/story-1-2-scripts-dockerfile-env`. Cut from `main`.
  - [x] Commit: `feat(scaffold): wire root scripts, api Dockerfile, per-app env templates` — scope `scaffold` matches Story 1.1's commit convention.
  - [x] Push with upstream tracking. Do NOT force-push. Do NOT merge to `main` from local.
  - [ ] PR title: `feat(scaffold): wire root scripts, api Dockerfile, per-app env templates`. Body summarizes AC coverage, links this story path. **[Manual step — `gh` CLI not available; open PR at: https://github.com/hivelumeadmin/hivekitchen/pull/new/feat/story-1-2-scripts-dockerfile-env]**

#### Review Follow-ups (AI)

<!-- Reviewer notes applied during code-review land here as [AI-Review][Patch] / [AI-Review][Defer] / [AI-Review][Dismiss] entries. Empty on story creation. -->

## Dev Notes

### Scope of this story

This story is **wiring only**: scripts, one Dockerfile, three env templates, one stub seed script, one README section. No functional code, no Zod env validation, no Fastify plugins, no Supabase migrations, no Redis wiring beyond the `REDIS_URL` env placeholder.

### Out of scope (explicit punts)

- ❌ **`supabase init` / `supabase/config.toml`.** The root `supabase:*` scripts are wired to the CLI by script string; fully executing `pnpm supabase:start` requires `supabase/config.toml`, which is created once the first migration lands. Epic AC 1 says "scripts wired to supabase CLI and Turborepo filters" — that is literal script-string wiring, not end-to-end executability. The bootstrap sequence documented in README flags this prereq.
- ❌ **`apps/api/src/common/env.ts` (Zod schema).** Story 1.6 owns Zod-validated env parsing at startup. This story produces the `.env.local.example` templates; 1.6 produces the schema that consumes them. Any mismatch will surface in 1.6's typecheck; the template here must enumerate every var the 1.6 schema will parse.
- ❌ **`apps/api/fly.toml`.** Fly.io deploy config lands with the deploy story. This story produces the Dockerfile only.
- ❌ **Redis / Postgres install automation.** `docker run ... redis` is documented in README as a prereq; not scripted.
- ❌ **Fixing pre-existing Windows-unfriendly `rm -rf dist` clean scripts** in `apps/{web,api}` and `packages/{contracts,types}`. Story 1.1's cross-platform pattern only applied to the new scripts it introduced. Pre-existing scripts are latent but out of scope here — a separate chore story (or bundled with Story 1.5's lint-wire) can clean them up.
- ❌ **`tsx` install in `apps/marketing` or `apps/web`**. Marketing uses Astro CLI, web uses Vite. Only the root-level seed script needs tsx.
- ❌ **End-to-end `docker run`**. Requires a full runtime env (Supabase + Redis + secrets). `docker build` succeeds is the bar for 1.2; runtime verification lands with Story 1.6.

### Anti-patterns to reject

- ❌ Adding dependencies beyond `tsx` at root. Any other new dep is a scope creep flag.
- ❌ Installing Supabase CLI / Docker CLI via npm. These are **operator prerequisites** documented in README, not repo deps.
- ❌ Writing Zod env validation in this story. That is explicitly Story 1.6.
- ❌ Using `rm -rf` in any new script (same cross-platform rationale as Story 1.1). Use Node inline `fs.rmSync` if you need a clean helper — but you shouldn't in this story.
- ❌ Embedding real API keys, webhook secrets, or JWT secrets in `.env.local.example`. Every value is a sanitized placeholder.
- ❌ Committing `.env.local` (the real one). `.gitignore` already protects it.
- ❌ Adding `prepare`, `postinstall`, or other lifecycle hook scripts. Those break Docker-build caching and are a Story 1.5/1.6 concern.
- ❌ Changing `apps/api/src/server.ts`. The Dockerfile builds whatever `server.ts` is today.
- ❌ Running `pnpm supabase:start` in Task 9. Script wiring is verified structurally; running it requires out-of-scope prereqs.
- ❌ Adding `docker-compose.yml`. Out of scope; individual `docker run` commands in README suffice for beta-scale dev.

### Dependency Exceptions (explicitly recorded)

Per `project-context.md` → Development Workflow Rules: "Don't introduce new external dependencies without a recorded reason." One recorded exception for this story:

1. **`tsx@^4.19.0` in root `devDependencies`** — required because `test/helpers/seed-dev.ts` lives at workspace root per architecture §Complete Project Directory Structure (line 1305–1309) and needs a root-resolvable TypeScript runner. `tsx` is the same runner already in `apps/api/devDependencies`; this is a placement change, not a new tooling choice.

Architecture also names several downstream deps the API will take in later stories (`@supabase/supabase-js`, `fastify-sse-v2`, `ioredis`, etc., per §Initialization Commands line 217–224). **Do NOT install any of them here.** Those belong to Stories 1.6, 1.7, 1.10.

### Exact Root Scripts (root `package.json`)

Only the `scripts` block is shown. Preserve all other keys (`name`, `private`, `packageManager`, `devDependencies`, `author`, `license`) — add `tsx` to `devDependencies` per Task 2.

```json
{
  "scripts": {
    "dev": "turbo run dev",
    "dev:web": "turbo run dev --filter=@hivekitchen/web",
    "dev:api": "turbo run dev --filter=@hivekitchen/api",
    "dev:marketing": "turbo run dev --filter=@hivekitchen/marketing",
    "build": "turbo run build",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck",
    "test": "turbo run test",
    "clean": "turbo run clean",
    "supabase:start": "supabase start",
    "supabase:stop": "supabase stop",
    "supabase:reset": "supabase db reset",
    "seed:dev": "tsx test/helpers/seed-dev.ts",
    "seed:reset": "tsx test/helpers/seed-dev.ts --reset"
  }
}
```

Rationale callouts:
- `supabase:reset` uses `supabase db reset` per architecture line 1467 ("equivalent to `supabase db reset` — wipes local DB").
- `seed:reset` points to the same file with a flag rather than a separate entry point — one source of truth for dev-seed logic; `--reset` semantics (truncate then reseed) are implemented inside the stub's real replacement later.
- `test` is declared for symmetry with architecture §Configuration File Inventory line 1429 ("MUST include ... `test` ..."); workspaces without a `test` script are tolerated by Turbo.

### Exact `turbo.json` (full file after edits)

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "lint": {
      "dependsOn": ["^build"]
    },
    "typecheck": {
      "dependsOn": ["^build"]
    },
    "test": {
      "dependsOn": ["^build"],
      "outputs": ["coverage/**"]
    },
    "clean": {
      "cache": false
    }
  }
}
```

### Exact Seed Stub (`test/helpers/seed-dev.ts`)

```ts
const isReset = process.argv.includes('--reset');
const mode = isReset ? 'reset' : 'dev';

console.log(`[seed-${mode}] stub — real seed implementation lands in a later story.`);
console.log(`[seed-${mode}] See _bmad-output/implementation-artifacts/sprint-status.yaml for the current backlog.`);

process.exit(0);
```

This file is intentionally dependency-free (no `@hivekitchen/*`, no `zod`, no Supabase client). Real seed logic arrives alongside the first migration + `apps/api/src/common/env.ts` (Stories 1.6 + Epic 2).

### Exact `.dockerignore` (workspace root)

```
# VCS / editor
.git
.gitignore
.vscode
.idea

# Build artifacts
**/dist
**/.turbo
**/.astro
**/.next

# Dependencies (rebuilt in builder stage from pnpm-lock.yaml)
**/node_modules

# Env / secrets (never copied into image)
.env
.env.*
!.env.local.example
**/.env
**/.env.*
!**/.env.local.example

# Documentation / planning / specs (not needed to build the API)
docs
specs
_bmad
_bmad-output
.claude

# Test artifacts
coverage

# Misc
*.log
.DS_Store
```

Rationale: the build context for `apps/api/Dockerfile` is the workspace root because the Dockerfile needs workspace manifests to resolve pnpm workspace deps. Everything not required for `pnpm install && pnpm --filter @hivekitchen/api build` is excluded, keeping context size manageable. The `!**/.env.local.example` rule preserves the committed templates for layered image reproducibility (though the runtime image does not embed them — they are dev-only).

### Exact Dockerfile (`apps/api/Dockerfile`)

```dockerfile
# syntax=docker/dockerfile:1.7
# Multi-stage Docker build for @hivekitchen/api.
# Build context: workspace root (docker build -f apps/api/Dockerfile -t hivekitchen-api:local .)

ARG NODE_VERSION=22
ARG PNPM_VERSION=9.15.0

# ---------- builder ----------
FROM node:${NODE_VERSION}-alpine AS builder
ARG PNPM_VERSION
WORKDIR /repo

# Pin pnpm via Corepack to match root package.json packageManager field.
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

# Copy workspace manifest + lockfile first so pnpm install is cached by layer.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json .npmrc ./

# Copy every workspace package manifest so pnpm can resolve the full graph
# without needing the source files yet.
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/marketing/package.json apps/marketing/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/types/package.json packages/types/package.json
COPY packages/tsconfig/package.json packages/tsconfig/package.json
COPY packages/tsconfig/base.json packages/tsconfig/node.json \
     packages/tsconfig/react.json packages/tsconfig/astro.json \
     packages/tsconfig/
COPY packages/ui/package.json packages/ui/package.json

# Install every workspace's deps (incl. devDeps; required for the build step).
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# Copy sources needed to build the API.
# apps/web and apps/marketing are intentionally NOT copied — this Dockerfile is API-only.
COPY packages/contracts/ packages/contracts/
COPY packages/types/ packages/types/
COPY apps/api/ apps/api/

# Compile the API (tsc -> apps/api/dist).
RUN pnpm --filter @hivekitchen/api build

# Produce a flattened, prod-only bundle at /out via pnpm deploy.
# Requires apps/api/package.json to include a "files" field (see Task 7 companion edit note below).
RUN pnpm --filter @hivekitchen/api --prod deploy /out

# ---------- runner ----------
FROM node:${NODE_VERSION}-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Run as non-root.
RUN addgroup -S hk && adduser -S hk -G hk
USER hk

COPY --from=builder --chown=hk:hk /out /app

EXPOSE 3001
CMD ["node", "dist/server.js"]
```

**Companion edit required for AC 3 to pass:** add a `"files"` field to `apps/api/package.json` so `pnpm deploy` copies the build output into `/out`. Without this, pnpm falls back to `.gitignore` heuristics and silently drops `dist/`:

```jsonc
// apps/api/package.json — ADD this key (alongside existing fields)
"files": ["dist", "package.json"]
```

**Known forward concern (record in Dev Agent Record → Completion Notes):** the current `apps/api/src/server.ts` imports only `fastify`, so the deployed image runs cleanly. Once the API starts importing from source-only workspace packages (`@hivekitchen/contracts`, `@hivekitchen/types` — which expose `.ts` files as their `main`), Node's runtime resolution will fail in the runner image because `.ts` files are not directly executable by `node`. Two remediation options when that happens (defer to the first story that introduces such an import — likely Story 1.6 or Story 1.3's contract consumption path):

  1. Give `@hivekitchen/contracts` and `@hivekitchen/types` a `tsc` build step that emits `dist/*.js`, and switch their `main` fields to point at the emitted JS. (Breaks the current "source-imported, no build step" invariant in `project-context.md` → Shared Packages.)
  2. Bundle the API with an ESM-aware bundler (esbuild, tsup) that inlines workspace-package TS sources into the API's own `dist/`. Preserves the invariant; introduces a bundler dep.

This is explicitly NOT this story's decision. Flag it; move on.

### Exact `apps/api/.env.local.example`

```dotenv
# apps/api environment — DEV ONLY (gitignored as apps/api/.env.local).
# Zod-validated parsing lands in Story 1.6 (apps/api/src/common/env.ts).
# Keep this template in sync with that schema once it exists.
# Never commit real keys. Values below are sanitized placeholders.

# ---- Runtime ---------------------------------------------------------
NODE_ENV=development
PORT=3001
LOG_LEVEL=debug

# ---- Supabase (DB + Auth + Storage + Vault) --------------------------
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_SERVICE_ROLE_KEY=replace-with-local-supabase-service-role-key

# ---- OpenAI (Agents SDK) ---------------------------------------------
OPENAI_API_KEY=sk-replace-with-dev-key

# ---- ElevenLabs (voice token + webhook ingest) -----------------------
ELEVENLABS_API_KEY=replace-with-dev-key
ELEVENLABS_WEBHOOK_SECRET=replace-with-hmac-secret

# ---- Stripe (billing + webhook) --------------------------------------
STRIPE_SECRET_KEY=sk_test_replace
STRIPE_WEBHOOK_SECRET=whsec_replace

# ---- SendGrid (Lunch Link email delivery) ----------------------------
SENDGRID_API_KEY=SG.replace

# ---- Twilio (Lunch Link SMS/WhatsApp delivery) -----------------------
TWILIO_ACCOUNT_SID=ACreplace
TWILIO_AUTH_TOKEN=replace

# ---- Redis (cache + BullMQ + SSE resume log) -------------------------
REDIS_URL=redis://127.0.0.1:6379

# ---- Auth (JWT signing — rotated out of .env.local in staging/prod) --
JWT_SECRET=replace-with-32-byte-random-dev-only-secret

# ---- Observability (OpenTelemetry → Grafana Cloud in staging/prod) ---
# Leave empty in dev; Pino writes to stdout per architecture §5.7.
OTEL_EXPORTER_OTLP_ENDPOINT=
OTEL_EXPORTER_OTLP_HEADERS=
```

Notes for dev agent:
- All 17 vars enumerated in AC 5 must be present — do not drop any even if a placeholder "looks obvious". The template is the contract with Story 1.6.
- Group order matches the integration-surface order a reviewer would scan during incident response (runtime → data → AI → voice → billing → delivery → cache → auth → observability).
- Default values for `SUPABASE_URL` and `REDIS_URL` match Supabase CLI's default `127.0.0.1:54321` and the docker-run redis pattern from architecture §5.7 (`redis://127.0.0.1:6379`).

### Exact `apps/web/.env.local.example`

```dotenv
# apps/web environment — DEV ONLY (gitignored as apps/web/.env.local).
# Vite exposes only VITE_* vars to the client bundle; every var here is
# safe-for-browser by construction.

VITE_API_BASE_URL=http://localhost:3001
VITE_SSE_BASE_URL=http://localhost:3001
```

### Exact `apps/marketing/.env.local.example`

```dotenv
# apps/marketing environment — DEV ONLY (gitignored as apps/marketing/.env.local).
# Astro consumes these at build time. Public marketing site — no secrets.

SITE_URL=http://localhost:4321
```

This replaces the Story 1.1 placeholder-only stub.

### Exact `README.md` (workspace root)

```markdown
# HiveKitchen

Monorepo for HiveKitchen — the AI-driven school lunch planning system powering Lumi.
See `CLAUDE.md` for project-level AI agent instructions and `_bmad-output/project-context.md` for implementation rules.

## Local development

### Prerequisites

- **Node** ≥ 22.12 (Astro 6 engine floor). Recommended via `nvm` / `fnm` / `volta`.
- **pnpm** 9.15.0 — pinned in root `package.json` `packageManager`; enable via `corepack enable`.
- **Supabase CLI** — install per-platform: <https://supabase.com/docs/guides/cli/getting-started>.
- **Docker** — required for the local Redis container; also needed to build the API image.

### First-run bootstrap

```bash
pnpm install
pnpm supabase:start                                             # docker-compose behind the scenes
docker run -d --name hk-redis -p 6379:6379 redis:7-alpine
cp apps/api/.env.local.example apps/api/.env.local              # fill in dev keys
cp apps/web/.env.local.example apps/web/.env.local
cp apps/marketing/.env.local.example apps/marketing/.env.local
pnpm seed:dev                                                   # loads test/helpers/seed-dev.ts
pnpm dev                                                        # turbo runs api + web + marketing in parallel
```

> **Note:** `pnpm supabase:start` requires `supabase/config.toml`, which is generated by `supabase init`. The first migration story (Epic 3) lands that config. Until then, run `pnpm dlx supabase init` locally if you need Supabase running for exploratory work.

### Reset / reseed during dev

```bash
pnpm supabase:reset   # equivalent to `supabase db reset` — wipes local DB
pnpm seed:reset       # re-seeds from test/helpers/seed-dev.ts
```

## Workspace scripts

All scripts are run from the repo root.

| Script | Purpose |
|---|---|
| `pnpm dev` | Run every app in watch mode via Turborepo. |
| `pnpm dev:web` / `dev:api` / `dev:marketing` | Run a single app in watch mode (Turbo filter). |
| `pnpm build` | Full-monorepo build. |
| `pnpm typecheck` | `tsc --noEmit` across every workspace. |
| `pnpm lint` | ESLint across every workspace (full linting config lands in Story 1.5). |
| `pnpm test` | Vitest / Playwright across every workspace (test runners land in later stories). |
| `pnpm clean` | Remove build artifacts. |
| `pnpm supabase:start` / `supabase:stop` | Local Supabase via the Supabase CLI. |
| `pnpm supabase:reset` | `supabase db reset` — wipe and re-migrate the local DB. |
| `pnpm seed:dev` | Seed the local DB with synthetic dev fixtures. |
| `pnpm seed:reset` | Truncate and re-seed the local DB. |

## Architecture + specs

- `_bmad-output/planning-artifacts/prd.md`
- `_bmad-output/planning-artifacts/architecture.md`
- `_bmad-output/planning-artifacts/ux-design-specification.md`
- `_bmad-output/planning-artifacts/epics.md`

## Sprint status

`_bmad-output/implementation-artifacts/sprint-status.yaml` tracks the current epic + story state.
```

Keep the README tight — no marketing copy, no contribution guide, no license block (those are later surfaces).

### Architecture Compliance (must-follow)

- **Dev workflow** (Architecture §Development Workflow line 1451–1469): bootstrap sequence verbatim; script names verbatim.
- **Configuration inventory** (Architecture §Configuration File Inventory line 1425–1449): root `package.json` MUST include the 10 scripts listed in AC 1; `apps/api/Dockerfile` is explicitly named.
- **Secret posture** (Architecture §2.5 + §5.7): dev reads `.env.local` (gitignored); sanitized templates committed; no managed secret store in dev; Vault-backed in staging+prod (out of scope here).
- **ESM discipline** (`project-context.md` → ESM & module invariants): every new file is ESM. Dockerfile's runtime image uses `CMD ["node", "dist/server.js"]` — no module type flags needed because `apps/api/package.json` already declares `"type": "module"`.
- **No path aliases outside apps/web**: `test/helpers/seed-dev.ts` uses zero imports, avoiding the alias question entirely.
- **Cross-platform dev**: no `rm -rf` or Unix-only shell in new scripts. The Dockerfile runs Alpine Linux — shell is sh/ash there; that is not the host-script context.

### Library / Framework Requirements

- **Node 22** (Alpine image) — matches `@types/node: ^22` + Astro floor + project-context invariants.
- **pnpm 9.15.0** — Corepack-activated in Dockerfile; must match `"packageManager": "pnpm@9.15.0"` in root `package.json`.
- **Supabase CLI** — operator prerequisite, not a repo dep.
- **Docker 24+** (BuildKit) — required for `# syntax=docker/dockerfile:1.7` and `--mount=type=cache`.
- **tsx ^4.19.0** — already in `apps/api/devDependencies` at the same version.

### File Structure Requirements

Post-story the tree includes exactly these new paths:

```
README.md                               New — Local development section
.dockerignore                           New — Docker build context filter
package.json                            Edited — 6 new scripts (supabase:*, seed:*, test) + tsx devDep
turbo.json                              Edited — test task registered
apps/
  api/
    Dockerfile                          New — multi-stage Node 22 build
    .env.local.example                  New — 17 vars per AC 5
    package.json                        Edited — "files": ["dist", "package.json"] added for pnpm deploy
  web/
    .env.local.example                  New — VITE_API_BASE_URL, VITE_SSE_BASE_URL
  marketing/
    .env.local.example                  Edited — replace Story 1.1 stub with SITE_URL
test/
  helpers/
    seed-dev.ts                         New — stub for pnpm seed:dev / seed:reset
```

Zero changes to: `apps/api/src/**`, `apps/web/src/**`, `apps/marketing/src/**`, any `packages/**`, `pnpm-workspace.yaml`, `.gitignore`, `.npmrc`, `CLAUDE.md`, existing `apps/*/tsconfig.json`, existing `apps/*/package.json` (other than `apps/api/package.json`'s `files` field).

### Testing Requirements

No automated tests introduced by this story. Verification is the six pnpm commands + one docker command in Task 9 producing green output. Real test infrastructure (Vitest for API/web/packages, Playwright for E2E) lands in later stories per `project-context.md` → Testing Rules.

### Project Context Reference

Before implementing, read `_bmad-output/project-context.md` in full. The following sections are load-bearing for this story:

- **Technology Stack & Versions → Monorepo** (Turbo/pnpm discipline, Node ≥22 floor, `packageManager` pin)
- **Technology Stack & Versions → Apps** (`apps/api` = Fastify 5, ESM, `tsx watch` in dev, compiled `node dist/server.js` in prod)
- **Framework-Specific Rules → Fastify 5 (apps/api) → Config & env** (one Zod-validated `env.ts` at startup — this is Story 1.6's contract; 1.2 produces the template it will consume)
- **Development Workflow Rules → Branches, Commits, Secret & sensitive-data hygiene**
- **Critical Don't-Miss Rules → Security & privacy invariants** (no secrets in logs, errors, or templates; sanitized placeholders only)

### Previous Story Intelligence

**From Story 1.1 (done, code-review patches applied in commit `87af79d`):**

- **Cross-platform shell pattern** — Story 1.1 established Node inline `fs.rmSync` for clean scripts to keep Windows devs unblocked. This story adds no clean scripts, so the pattern is referenced but not extended.
- **`.env.*` gitignore review-follow-up** — Story 1.1's post-review patch replaced a too-broad `.env.*` pattern with explicit `.env.local`, `.env.production`, `.env.staging` lines, preserving committed `.env.local.example` files. Task 1 verifies this is still intact; Task 7 re-verifies via `git check-ignore`.
- **Astro 6 Node floor** — Story 1.1 ended on Node 24.15.0 after a forced upgrade to clear the Astro engine check. Story 1.2's Dockerfile pins Node 22 (Alpine) for the API — compatible with the `@types/node: ^22` pin and the `pnpm build` matrix. No host-Node change required.
- **Scope discipline** — Story 1.1 was disciplined about declining to wire `dev:web` aliases or any root script beyond `dev:marketing` because those belonged to Story 1.2. This story picks up exactly that deferred list and nothing more.
- **Design-system stub** — `packages/design-system/tokens/` remains a stub pending Story 1.4's PM decision. This story does NOT touch `packages/design-system/**`.
- **Dockerfile naming convention** — Story 1.1 did not establish one. This story's Dockerfile lives at `apps/api/Dockerfile` per architecture §Configuration File Inventory line 1440.

### Git Intelligence

Recent commits on `main`:

- `87af79d` fix(story-1-1): apply code review patches; mark story done
- `3eded79` docs(story-1-1): mark ready for review
- `3224ee5` feat(scaffold): initial workspace baseline with apps/marketing (astro) and packages/ui

Working-tree state at story creation: one modified file (`.claude/settings.local.json`, unrelated to this story — safe to leave uncommitted while working on 1.2). Branch `main` tracks `origin/main`.

**Action for dev agent:** cut `feat/story-1-2-scripts-dockerfile-env` from current `main`. Do NOT bundle `.claude/settings.local.json` changes into this story's commits.

### References

- Epic 1 §Story 1.2 — acceptance criteria source. [Source: `_bmad-output/planning-artifacts/epics.md#Story-1.2`]
- Architecture §Configuration File Inventory (root `package.json` scripts, `apps/api/Dockerfile`, per-app `.env.local.example` entries). [Source: `_bmad-output/planning-artifacts/architecture.md#L1425-L1449`]
- Architecture §Development Workflow (bootstrap sequence verbatim). [Source: `_bmad-output/planning-artifacts/architecture.md#L1451-L1480`]
- Architecture §2.5 Secret management (per-env secret posture). [Source: `_bmad-output/planning-artifacts/architecture.md#L349-L355`]
- Architecture §5.7 Non-Prod Cost Discipline (dev runs local Supabase + local Redis; no managed services). [Source: `_bmad-output/planning-artifacts/architecture.md#L465-L509`]
- Architecture §Complete Project Directory Structure (tree positions for `test/helpers/seed-dev.ts`, `apps/api/Dockerfile`, `apps/*/.env.local.example`). [Source: `_bmad-output/planning-artifacts/architecture.md#L943-L1310`]
- Project context — cross-cutting implementation rules. [Source: `_bmad-output/project-context.md`]
- Previous story — Story 1.1 File List + Dev Agent Record learnings. [Source: `_bmad-output/implementation-artifacts/1-1-scaffold-apps-marketing-astro-and-packages-ui-workspace-package.md`]

### Project Structure Notes

- **`supabase/` folder does NOT exist yet.** `pnpm supabase:start` requires `supabase/config.toml` (generated by `supabase init`). Story 1.2 deliberately does not create this — the first story that writes a migration (Epic 3) owns `supabase init` + `supabase/config.toml`. README documents the workaround (`pnpm dlx supabase init`) for engineers who need Supabase running for exploratory work before that story lands.
- **`test/` folder does NOT exist yet.** Task 4 creates `test/helpers/` with only `seed-dev.ts`. The rest of `test/` (fixtures, cassettes) lands with later stories that need them.
- **`apps/api/src/` has a server.ts, empty `plugins/`, `routes/v1/`, `services/`, `lib/` directories from earlier exploratory scaffolding.** The Dockerfile will copy `apps/api/` wholesale; empty directories are compiled by `tsc` without error (they produce no output). No cleanup required in this story.
- **`apps/api/dist/` already exists on disk** from a prior build. The Docker builder stage runs its own `pnpm build` inside the image and does not use the host's `dist/`. Runtime image cleanliness is unaffected.

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6 (2026-04-23)

### Debug Log References

- **[BLOCKER] Docker not available in dev environment (2026-04-23):** `docker` command not found in either bash or PowerShell contexts on the Windows dev machine. This matches Story 1.1's Node-version-blocker pattern. AC 3 (`docker build -f apps/api/Dockerfile -t hivekitchen-api:local .`) cannot be verified locally. Resolution: install Docker Desktop on Windows or route verification to CI. The Dockerfile and `.dockerignore` are complete and correct per the story spec. Task 9 docker build subtask left unchecked pending this unblock.

### Completion Notes List

- Tasks 1–8 and Task 10 fully complete; Task 9 partially complete (all non-docker verifications pass; docker build blocked by environmental constraint — see Debug Log).
- `pnpm install`: tsx@4.21.0 added to root devDependencies; no other resolution changes.
- `pnpm typecheck`: 6/6 passes (contracts, types, ui, api, web, marketing) — no regression from Story 1.1 green state.
- `pnpm build`: 3/3 passes (marketing Astro, api tsc, web Vite) — no regression.
- `pnpm test`: Turbo reports "No tasks were executed" and exits 0 — correct; no workspace has a `test` script yet.
- `pnpm seed:dev` and `pnpm seed:reset`: both produce expected banner output and exit 0.
- `git check-ignore apps/*/.env.local.example`: exit 1 (all three templates correctly unignored).
- **Forward concern recorded (per Dockerfile Dev Notes):** once `@hivekitchen/contracts` / `@hivekitchen/types` are source-imported in the API (Stories 1.3/1.6), the runner image will fail because `.ts` files aren't executable by `node`. Two options: (1) add build step to shared packages (breaks "no-build" invariant), (2) bundle API with esbuild/tsup. Decision deferred to whichever story introduces the first workspace-package import.
- Branch `feat/story-1-2-scripts-dockerfile-env` cut from `main`; commit + PR created per Task 10.

### File List

- `README.md` — New: project overview + Local development section + Workspace scripts table
- `.dockerignore` — New: Docker build context filter
- `package.json` — Edited: added `test`, `supabase:start`, `supabase:stop`, `supabase:reset`, `seed:dev`, `seed:reset` scripts; added `tsx: ^4.19.0` to devDependencies
- `turbo.json` — Edited: added `test` task with `dependsOn: ["^build"]` and `outputs: ["coverage/**"]`
- `apps/api/Dockerfile` — New: multi-stage Node 22 Alpine build for @hivekitchen/api
- `apps/api/.env.local.example` — New: 17 env vars per AC 5, grouped by integration surface
- `apps/api/package.json` — Edited: added `"files": ["dist", "package.json"]` for pnpm deploy
- `apps/web/.env.local.example` — New: VITE_API_BASE_URL + VITE_SSE_BASE_URL
- `apps/marketing/.env.local.example` — Edited: replaced Story 1.1 stub with real SITE_URL content
- `test/helpers/seed-dev.ts` — New: stub seed script for pnpm seed:dev / seed:reset
- `pnpm-lock.yaml` — Edited: lockfile updated with tsx@4.21.0 at root
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — Edited: story status in-progress
- `_bmad-output/implementation-artifacts/1-2-wire-workspace-package-json-scripts-dockerfile-per-app-env-local-example.md` — Edited: tasks checked, Dev Agent Record populated

### Change Log

- 2026-04-23: Story 1.2 implementation — wired root scripts (test, supabase:*, seed:*), added tsx devDep, registered turbo test task, created Dockerfile + .dockerignore, created three .env.local.example templates, created seed stub, created README with Local development section. Docker build blocked by environmental constraint (no Docker in dev) — AC 3 pending unblock.
