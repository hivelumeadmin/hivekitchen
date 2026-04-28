# HiveKitchen

Monorepo for HiveKitchen — the AI-driven school lunch planning system powering Lumi.
See `CLAUDE.md` for project-level AI agent instructions and `_bmad-output/project-context.md` for implementation rules.

## Development

> HiveKitchen **always** targets the Supabase **cloud** project — there is no local Supabase stack. The API and web client connect directly to the cloud project via the `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_ANON_KEY` env vars. Schema changes can be applied either through the Supabase dashboard SQL editor or, if you choose, via the Supabase CLI (`supabase:link` + `supabase:push`) — neither is required for running the app once the env is populated.

### Prerequisites

- **Node** ≥ 22.12 (Astro 6 engine floor). Recommended via `nvm` / `fnm` / `volta`.
- **pnpm** 9.15.0 — pinned in root `package.json` `packageManager`; enable via `corepack enable`.
- **Docker** — required for the local Redis container; also needed to build the API image.
- A Supabase **cloud** project, with the URL + service-role + anon keys from Settings → API.
- *(Optional)* **Supabase CLI** — only needed if you want to apply migrations from `supabase/migrations/` via the toolchain instead of pasting SQL into the dashboard.

### First-run bootstrap

```bash
pnpm install
docker run -d --name hk-redis -p 6379:6379 redis:7-alpine       # Redis remains local in dev
cp apps/api/.env.local.example apps/api/.env.local              # fill with cloud project URL + keys
cp apps/web/.env.local.example apps/web/.env.local              # cloud URL + anon key only
cp apps/marketing/.env.local.example apps/marketing/.env.local
pnpm dev                                                        # turbo runs api + web + marketing in parallel
```

> The `apps/api` server connects directly to the cloud Supabase instance via `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`. There is **no** `supabase start` step — local Supabase is not supported.

### Apply schema changes

The cloud project already carries existing tables (users, households, audit_log, threads, thread_turns, …). To add new ones from `supabase/migrations/`, choose one path:

**Option A — dashboard (no CLI required):** open the cloud dashboard → SQL editor, paste the contents of the new migration file, run.

**Option B — Supabase CLI (one-time link, then push):**

```bash
pnpm supabase:link    # one-time: prompts for project-ref + db password
pnpm supabase:diff    # preview drift between repo migrations and cloud schema
pnpm supabase:push    # apply pending migrations to the linked cloud DB
pnpm seed:reset       # re-run dev fixtures against the cloud DB (DESTRUCTIVE)
```

If `pnpm supabase:link` is failing for you, paste the migration SQL into the dashboard instead — the runtime code does not depend on the CLI being linked.

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
| `pnpm supabase:link` | One-time: `supabase link` the repo to a cloud project ref. |
| `pnpm supabase:push` | `supabase db push --linked` — apply pending migrations to the linked cloud DB. |
| `pnpm supabase:diff` | `supabase db diff --linked` — preview drift between repo migrations and cloud schema. |
| `pnpm supabase:status` | `supabase projects list` — confirm which project is linked. |
| `pnpm seed:dev` | Seed the **cloud** DB with synthetic dev fixtures. |
| `pnpm seed:reset` | Truncate and re-seed the **cloud** DB (destructive). |

## Architecture + specs

- `_bmad-output/planning-artifacts/prd.md`
- `_bmad-output/planning-artifacts/architecture.md`
- `_bmad-output/planning-artifacts/ux-design-specification.md`
- `_bmad-output/planning-artifacts/epics.md`

## Sprint status

`_bmad-output/implementation-artifacts/sprint-status.yaml` tracks the current epic + story state.
