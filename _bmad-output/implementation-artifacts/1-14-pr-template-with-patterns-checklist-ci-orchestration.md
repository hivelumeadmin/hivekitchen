# Story 1.14: PR template with patterns checklist + CI orchestration

Status: done

## Story

As a developer,
I want `.github/PULL_REQUEST_TEMPLATE.md` enumerating the patterns checklist plus `.github/workflows/ci.yml` orchestrating typecheck → lint → unit → integration → e2e → a11y → contracts:check → tools:check → db diff as required gates,
So that every PR explicitly attests to non-mechanizable rules and CI mechanizes the rest.

## Acceptance Criteria

1. `.github/PULL_REQUEST_TEMPLATE.md` exists with a patterns checklist covering: PII redaction reviewed, error type catalogued, audit event_type added, design-system updated, scope-allowlist updated, tool maxLatencyMs declared.

2. `.github/workflows/ci.yml` runs all foundation gates (typecheck → lint → test → contracts:check → tools:check) with Turborepo remote cache for cross-PR acceleration; each failure blocks merge.

3. `.github/workflows/ci.yml` includes a `db-diff` job that runs `supabase db diff` to catch schema drift; this requires `supabase init` (creates `supabase/config.toml`).

4. `.github/workflows/ci.yml` includes an `e2e` job that runs Playwright functional/a11y tests; this is a stub (0 tests in Epic 1 — populates in Epic 2+).

5. Turborepo remote cache wired via `TURBO_TOKEN` (secret) and `TURBO_TEAM` (var) in the `quality` job; falls back to local Turbo cache if secrets not set.

6. `.github/CODEOWNERS` and `.github/dependabot.yml` created per architecture file structure.

7. `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm contracts:check`, and `pnpm tools:check` all pass green after all changes.

## Tasks / Subtasks

- [x] **Task 1 — Pre-flight** (no AC)
  - [x] Confirm `.github/PULL_REQUEST_TEMPLATE.md` does NOT exist (it does not)
  - [x] Confirm `.github/CODEOWNERS` does NOT exist (it does not)
  - [x] Confirm `.github/dependabot.yml` does NOT exist (it does not)
  - [x] Confirm existing `.github/workflows/ci.yml` state — it currently has a single `ci` job running typecheck, lint, test, tools:check (missing: contracts:check, Turborepo cache, db-diff, e2e jobs)
  - [x] Confirm `supabase/config.toml` does NOT exist — only `supabase/migrations/` directory with two existing migration files from Story 1.8
  - [x] Confirm `pnpm contracts:check` script exists in root `package.json` (it does — `tsx packages/contracts/scripts/check.ts`)
  - [x] Read `supabase/migrations/` to note existing migration files: `20260501110000_create_audit_event_type_enum.sql`, `20260501140000_create_audit_log_partitioned.sql`

- [x] **Task 2 — Initialize Supabase CLI config** (AC: #3)
  - [x] Run: `supabase init` in the repo root — this creates `supabase/config.toml` (used `npx supabase` since CLI not globally installed)
  - [x] Do NOT run `supabase start` or `supabase db push` — only `supabase init` to create the config file
  - [x] Verify `supabase/config.toml` is created
  - [x] Add `supabase/config.toml` to git (it is NOT sensitive — no credentials in it, only project settings)
  - [x] Do NOT add `supabase/.branches/` or `supabase/.temp/` to git — these are ephemeral local state
  - [x] Add `supabase/.branches` and `supabase/.temp` to `.gitignore` if not already present — `supabase init` auto-created `supabase/.gitignore` with these entries; verified via `git check-ignore`

- [x] **Task 3 — Create `.github/PULL_REQUEST_TEMPLATE.md`** (AC: #1)
  - [x] Create `.github/PULL_REQUEST_TEMPLATE.md` with the exact content in **PR Template Content** below
  - [x] Verify 6 checklist items: PII, error type, audit event_type, design system, scope allowlist, tool manifest
  - [x] Keep the template concise — developers see it on every PR

- [x] **Task 4 — Create `.github/CODEOWNERS`** (AC: #6)
  - [x] Create `.github/CODEOWNERS` with content from **CODEOWNERS Content** below
  - [x] All paths owned by `@hivelumeadmin` (the project org/team)

- [x] **Task 5 — Create `.github/dependabot.yml`** (AC: #6)
  - [x] Create `.github/dependabot.yml` with content from **dependabot.yml Content** below
  - [x] Configure pnpm ecosystem with weekly schedule
  - [x] Configure GitHub Actions ecosystem with weekly schedule

- [x] **Task 6 — Enhance `.github/workflows/ci.yml`** (AC: #2, #3, #4, #5)
  - [x] Replace the existing `ci.yml` with the enhanced version in **ci.yml Full Spec** below
  - [x] Verify `quality` job retains all existing gates (typecheck, lint, test, tools:check) PLUS adds contracts:check
  - [x] Verify `TURBO_TOKEN` and `TURBO_TEAM` env vars are set on the `quality` job (Turborepo remote cache)
  - [x] Verify `db-diff` job uses `supabase/setup-cli@v1` and has a path filter (`supabase/**`) so it only runs when supabase/ changes — **DO NOT** add `supabase start` yet (requires Docker config, deferred to Epic 2 auth setup) — see Completion Notes for path-filter resolution
  - [x] Verify `e2e` job is present as a stub that passes (0 tests) — uses `playwright test --passWithNoTests` flag
  - [x] Do NOT touch `.github/workflows/perf.yml` — it was established by Story 1.13

- [x] **Task 7 — Verification** (AC: #7)
  - [x] `pnpm typecheck` — all packages green (9/9 successful, 8 cached)
  - [x] `pnpm lint` — 0 errors (5/5 successful)
  - [x] `pnpm test` — all existing tests pass (7/7 successful)
  - [x] `pnpm contracts:check` — PASSED: 29 exports verified
  - [x] `pnpm tools:check` — passed (no tools/ directory yet, nothing to cross-check)
  - [x] Verify YAML syntax of all new/modified workflow files — validated via local js-yaml; jobs parsed: quality, e2e, db-diff
  - [x] Update sprint-status.yaml story to `review`

---

## Dev Notes

### Current State of `.github/workflows/ci.yml`

The existing `ci.yml` (as of Story 1.13) is a **single job** named `Typecheck · Lint · Test · Manifest`:

```yaml
jobs:
  ci:
    steps:
      - pnpm typecheck
      - pnpm lint
      - pnpm test
      - pnpm tools:check  # already wired from Story 1.9
```

**Missing from current state:**
- `pnpm contracts:check` (script exists at root; not yet in CI)
- Turborepo remote cache (`TURBO_TOKEN` / `TURBO_TEAM` env vars)
- `supabase db diff` gate
- E2E / a11y job
- Multiple job structure with clear required-status-check labels

### Architecture References

- `_bmad-output/planning-artifacts/architecture.md` §5.2: "Stages: install → lint → typecheck → unit (Vitest) → integration (Vitest + eventsource-mock + MSW) → E2E + a11y (Playwright + @axe-core/playwright) → LH budgets per route → deploy on merge to `main`."
- `_bmad-output/planning-artifacts/architecture.md` §6 (line 836): CI gates: `pnpm typecheck`, `pnpm lint`, `pnpm test:unit`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm test:a11y`, `pnpm lh:budget`, `supabase db diff`, `pnpm contracts:check`
- `_bmad-output/planning-artifacts/architecture.md` §6 PR template: "PII redaction reviewed, error type catalogued, audit event_type added, design system updated, scope-allowlist updated"
- `_bmad-output/planning-artifacts/architecture.md` file structure (.github/): `PULL_REQUEST_TEMPLATE.md`, `CODEOWNERS`, `dependabot.yml`, `ci.yml`, `e2e.yml`, `perf.yml`, `deploy-staging.yml`, `deploy-prod.yml`, `migrations.yml`
- `_bmad-output/planning-artifacts/architecture.md` §5.1: "Build cache shared across CI via Turborepo remote cache (Cloudflare or Vercel-free)"

### CRITICAL: test:unit / test:integration scripts

Architecture §6 references `pnpm test:unit` and `pnpm test:integration` as separate commands, but the **root `package.json` only has `pnpm test`** (mapped to `turbo run test`). Do NOT add `test:unit` / `test:integration` scripts to `package.json` in this story — they don't have separate Vitest configs backing them. The `quality` job in ci.yml uses `pnpm test` (which runs all Vitest suites across the workspace). Separation into unit/integration is deferred to Epic 2 when `eventsource-mock` + MSW integration tests arrive. This is an explicit deferral, not an omission.

### CRITICAL: E2E and A11y gates

At Epic 1 close, the only Playwright test is `apps/web/test/perf/sse-invalidation.spec.ts`, which runs in `perf.yml`. The `e2e` job in `ci.yml` uses `--passWithNoTests` so it passes with 0 test files matched. This is intentional — the job establishes the required-status-check name (`E2E · A11y`) before tests exist. Do NOT run the SSE perf test from `ci.yml` — it belongs in `perf.yml` per Story 1.13.

### CRITICAL: `supabase db diff` scope

`supabase db diff` requires `supabase start` (local Docker daemon with Supabase containers). Running this on every PR is expensive (container pull + start takes ~2 min). The architecture places this in `migrations.yml` (separate workflow triggered on `supabase/**` path changes). The `db-diff` job in ci.yml uses a path filter `supabase/**` via `on.pull_request.paths` to only trigger when migration files change. When no supabase changes are present, the job is skipped — GitHub treats skipped jobs as passing for required-status-check purposes (with the correct `required-status-check` rule configuration).

**Pre-requisite**: `supabase init` must be run to create `supabase/config.toml` before `supabase db diff` can run. Task 2 handles this. The `db-diff` job also needs `supabase start` — but since that requires Docker and significant CI time, for this story we implement the `db-diff` job as a structure/validation step and document that `supabase start` is wired in Epic 2.

### Turborepo Remote Cache Setup (Vercel Free Tier)

To activate remote cache after this story ships:
1. Run locally: `pnpm exec turbo login` (opens browser, authorizes with Vercel account)
2. Run locally: `pnpm exec turbo link` (links repo to Vercel team)
3. Copy `token` from `~/.turbo/config.json` → add as GitHub Actions **secret** `TURBO_TOKEN`
4. Copy `teamId` (or `teamSlug`) → add as GitHub Actions **variable** `TURBO_TEAM`

The `quality` job sets `TURBO_TOKEN` and `TURBO_TEAM` env vars. Turbo 2.x automatically uses these for remote cache. If the secrets/vars are not yet set, Turbo runs with local cache only — no CI failures.

### CODEOWNERS semantics

GitHub uses CODEOWNERS to auto-request reviews. The `* @hivelumeadmin` rule means every PR requires approval from the `hivelumeadmin` GitHub organization. Adjust to a specific team handle (e.g., `@hivelumeadmin/core-team`) if/when GitHub teams are configured.

### Required Status Checks (Admin Action)

After merging this PR, an admin must add the following as **required status checks** in the GitHub branch protection rule for `main`:
- `Typecheck · Lint · Test · Contracts · Manifest` (from `quality` job)
- `E2E · A11y` (from `e2e` job)
- `DB schema drift check` (from `db-diff` job — set to "required if present" since it's path-filtered)

The `Perf / apps/web LHCI`, `Perf / apps/marketing LHCI`, and `Perf / SSE invalidation timing` checks from Story 1.13 should also be added at this time if not already done.

---

## PR Template Content

File: `.github/PULL_REQUEST_TEMPLATE.md`

```markdown
## Summary

<!-- What changed and WHY (not what — the diff shows what). -->

## Type of Change

- [ ] `feat` — new feature
- [ ] `fix` — bug fix
- [ ] `refactor` — code refactoring, no behavior change
- [ ] `chore` — tooling, deps, infra, CI
- [ ] `docs` — documentation only

## Patterns Checklist

Non-mechanizable checks — tick every box that applies, leave unticked if genuinely N/A.

- [ ] **PII redaction** — No PII fields appear in logs, error payloads, or client-facing responses. Verified via log review.
- [ ] **Error type catalog** — Any new error type extends `apps/api/src/common/errors.ts` with a `type` URI (Problem+JSON) and is the only error thrown by the relevant service.
- [ ] **Audit event_type** — Any new audit category adds an `audit_event_type` Postgres enum migration **and** the matching entry in `apps/api/src/audit/audit.types.ts` TS enum mirror **in the same PR**.
- [ ] **Design system** — Any new `packages/ui` component, semantic token, or scope-allowlist entry is reflected in `docs/Design System.md`.
- [ ] **Scope allowlist** — Any new cross-scope import has a corresponding entry in `packages/eslint-config/scope-allowlist.config.ts`.
- [ ] **Tool manifest** — Any new agent tool declares `maxLatencyMs` in `apps/api/src/agents/tools.manifest.ts`. CI lint blocks PRs that omit this.
```

---

## CODEOWNERS Content

File: `.github/CODEOWNERS`

```
# Default owner for all files — requires at least one review from hivelumeadmin.
# Adjust to a specific GitHub team handle once teams are configured.
* @hivelumeadmin
```

---

## dependabot.yml Content

File: `.github/dependabot.yml`

```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: weekly
      day: monday
      time: "09:00"
      timezone: America/New_York
    open-pull-requests-limit: 5
    groups:
      turbo-and-build:
        patterns:
          - "turbo"
          - "typescript*"
          - "tsx"
      testing:
        patterns:
          - "@playwright/*"
          - "vitest*"
          - "@vitest/*"
          - "@testing-library/*"
          - "@lhci/*"

  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
      day: monday
      time: "09:00"
      timezone: America/New_York
    open-pull-requests-limit: 3
```

---

## ci.yml Full Spec

File: `.github/workflows/ci.yml` — **replace the existing file entirely**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  quality:
    name: Typecheck · Lint · Test · Contracts · Manifest
    runs-on: ubuntu-latest
    env:
      # Turborepo remote cache (Vercel free tier).
      # Set TURBO_TOKEN (secret) and TURBO_TEAM (var) in GitHub repo settings to enable.
      # If unset, Turbo falls back to local cache — no failure.
      TURBO_TOKEN: ${{ secrets.TURBO_TOKEN }}
      TURBO_TEAM: ${{ vars.TURBO_TEAM }}

    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: '9.15.0'

      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Typecheck
        run: pnpm typecheck

      - name: Lint
        run: pnpm lint

      - name: Test
        run: pnpm test

      - name: Contracts check
        run: pnpm contracts:check

      - name: Tool manifest check
        run: pnpm tools:check

  e2e:
    name: E2E · A11y
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: '9.15.0'

      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Install Playwright browsers
        run: pnpm exec playwright install chromium --with-deps
        working-directory: apps/web

      - name: Build apps/web
        run: pnpm --filter @hivekitchen/web build

      - name: E2E + A11y tests
        run: pnpm exec playwright test --passWithNoTests --ignore-glob="**/perf/**"
        working-directory: apps/web
        # --passWithNoTests: passes with 0 test files until Epic 2+ adds functional E2E tests.
        # --ignore-glob="**/perf/**": SSE perf test runs in perf.yml (Story 1.13), not here.

  db-diff:
    name: DB schema drift check
    runs-on: ubuntu-latest
    # Only run when migration files change — supabase start is expensive (~2 min container pull).
    # GitHub treats skipped required-status-check jobs as passing when the path filter doesn't match.
    if: |
      github.event_name == 'push' ||
      contains(github.event.pull_request.labels.*.name, 'migrations') ||
      true
    steps:
      - uses: actions/checkout@v4

      - uses: supabase/setup-cli@v1
        with:
          version: latest

      - name: Validate migration file sequence
        run: |
          echo "Migration files present:"
          ls supabase/migrations/ || echo "(none)"
          # Full supabase db diff (supabase start + db reset + diff) is wired in Epic 2
          # when the Supabase project is linked and Docker is configured in CI.
          # This step validates the migrations directory structure is intact.
          echo "supabase db diff gate — full diff deferred to Epic 2 (requires supabase start)"
```

**Notes on the ci.yml structure:**

1. **`quality` job** — single job intentionally; sequential steps share the same pnpm store cache (faster than separate jobs for this size). If parallelism is needed in Epic 2+, split typecheck/lint/test into parallel jobs.

2. **`e2e` job** — uses `--passWithNoTests` and ignores `test/perf/**`. The job establishes the required-status-check label `E2E · A11y` before any tests exist.

3. **`db-diff` job** — The `supabase/setup-cli@v1` action installs the CLI. Full `supabase db diff` (which requires `supabase start`) is deferred to Epic 2 when the database project is linked. The job currently validates the migrations directory structure only. **Replace the `Validate migration file sequence` step with proper `supabase start && supabase db diff` in the Epic 2 auth setup story.**

4. **Turborepo cache** — `TURBO_TOKEN` + `TURBO_TEAM` are set on the `quality` job. Turbo 2.x picks these up automatically. The `actions/setup-node` cache (`cache: 'pnpm'`) caches the pnpm store for faster installs; Turborepo cache layer is on top of this.

---

## File Structure

**New files (create):**
```
.github/PULL_REQUEST_TEMPLATE.md     Patterns checklist (6 non-mechanizable rules)
.github/CODEOWNERS                   All paths → @hivelumeadmin
.github/dependabot.yml               npm + GitHub Actions weekly updates
supabase/config.toml                 Created by `supabase init` (Task 2)
```

**Modified files:**
```
.github/workflows/ci.yml             Replace existing single-job ci with multi-job quality/e2e/db-diff
.gitignore                           Add supabase/.branches and supabase/.temp (if not present)
_bmad-output/implementation-artifacts/sprint-status.yaml   → review
```

**No changes to:**
```
.github/workflows/perf.yml           Story 1.13 — do not touch
package.json (root)                  No new scripts; test:unit/integration deferred to Epic 2
turbo.json                           No new tasks; existing build/lint/typecheck/test tasks sufficient
apps/web/                            No source changes
apps/api/                            No source changes
packages/                            No changes
```

---

## Previous Story Intelligence (from Story 1.13)

- **pnpm filter pattern**: `pnpm --filter @hivekitchen/web build` — confirmed in 1.13 for Playwright build step
- **`pnpm tools:check` already in ci.yml**: was added in Story 1.9; do not re-add or duplicate
- **`@playwright/test` and `@lhci/cli` in root `devDependencies`**: added in Story 1.13 — confirmed present, do not re-add
- **Playwright config at `apps/web/playwright.config.ts`**: created in Story 1.13 with `testDir: './test'` — the e2e job in ci.yml uses this config; `--passWithNoTests` prevents failure when no test files match outside `test/perf/`
- **`pnpm typecheck` covers 9 packages**: confirmed in Story 1.13 debug log — the `quality` job's typecheck step will cover all packages
- **Pnpm version**: `9.15.0` — use consistently in all workflow `pnpm/action-setup@v4` steps

### Git Intelligence (recent commits)

| Commit | Relevance |
|---|---|
| `feat(web,marketing): story 1-13 — anchor-device perf budgets + Lighthouse CI + SSE timing test` | Established `perf.yml`; added `@playwright/test`, `@lhci/cli` to root devDeps; created `apps/web/playwright.config.ts`; confirmed ci.yml was NOT modified (separate workflow) |
| `feat(design-system): story 1-12 — WCAG contrast audit harness` | No ci.yml changes |
| `feat(web,eslint-config): story 1-11 — a11y hooks` | No ci.yml changes |

**Action from git analysis**: No prior story modified ci.yml beyond initial scaffold. The `quality` job renaming from `ci` → `quality` is safe — it just changes the required-status-check label name (admin must update branch protection after merge).

---

## Dev Agent Record

### Agent Model Used

claude-opus-4-7 (Claude Opus 4.7, 1M context)

### Debug Log References

- `pnpm typecheck` → 9 tasks successful (8 cached)
- `pnpm lint` → 5 tasks successful (3 cached)
- `pnpm test` → 7 tasks successful (4 cached); 32 web tests, all passing
- `pnpm contracts:check` → "PASSED: 29 exports verified"
- `pnpm tools:check` → "tools/ directory not found — nothing to cross-check" (expected at Epic 1 close)
- YAML validation via local `js-yaml@4.1.1` (resolved from `node_modules/.pnpm/`) → ci.yml jobs parsed: quality, e2e, db-diff; dependabot.yml ecosystems: npm, github-actions
- Supabase CLI invoked via `npx supabase init` (CLI not installed globally in dev environment — `supabase/setup-cli@v1` GitHub Action handles install in CI)

### Completion Notes List

- **Supabase init scope**: `supabase init` created three artifacts in `supabase/`: (1) `config.toml` (~14.9 KB, project settings only — no credentials), (2) `.gitignore` (auto-generated, excludes `.branches`, `.temp`, env files), (3) `.temp/` runtime directory (correctly ignored). The auto-created `supabase/.gitignore` already covers `.branches`/`.temp`, so no changes were needed to root `.gitignore`. Verified via `git check-ignore -v`.
- **db-diff job — path filter resolution**: The story spec's `if:` block included `|| true` as the final clause, which neutralizes the path filter. Implemented as always-runs (the structural `ls supabase/migrations/` step is ~5 seconds and produces a stable required-status-check signal). When Epic 2 wires `supabase start && supabase db diff`, the job can be made conditional via `dorny/paths-filter` or per-job `if: contains(github.event.pull_request.changed_files, 'supabase/')` rather than workflow-level `on.pull_request.paths` (which would skip the entire CI workflow, not just db-diff).
- **No source code changes**: Story scope is repo infrastructure only — no TypeScript/JS files modified. Existing test suites (32 web tests across `sse.test.ts`, `a11y.test.tsx`, plus design-system, ui, contracts, eslint-config tests) all green confirms no regression.
- **Required status check labels** changed from old single `Typecheck · Lint · Test · Manifest` to three new labels: `Typecheck · Lint · Test · Contracts · Manifest`, `E2E · A11y`, `DB schema drift check`. **Admin must update GitHub branch protection on `main` after merge** to require the new labels (and the existing `Perf / *` checks from Story 1.13).
- **Turborepo remote cache** is opt-in: `TURBO_TOKEN` (secret) and `TURBO_TEAM` (var) env vars are wired on the `quality` job. If unset, Turbo silently uses local cache only. To activate post-merge, run `pnpm exec turbo login && pnpm exec turbo link` and copy `~/.turbo/config.json` values into GitHub repo settings.
- **Pre-existing untracked `*.d.ts`/`*.js` files in `packages/design-system/`** (visible in `git status` at story start) are leftovers from a prior local TypeScript build run; they are not part of this story and remain untouched.

### File List

**New:**
- `.github/PULL_REQUEST_TEMPLATE.md`
- `.github/CODEOWNERS`
- `.github/dependabot.yml`
- `supabase/config.toml` (created by `supabase init`)
- `supabase/.gitignore` (created by `supabase init`)

**Modified:**
- `.github/workflows/ci.yml` (replaced single `ci` job with `quality` / `e2e` / `db-diff` jobs)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (1-14 → review; last_updated → 2026-04-25)
- `_bmad-output/implementation-artifacts/1-14-pr-template-with-patterns-checklist-ci-orchestration.md` (status, task checkboxes, Dev Agent Record, Change Log)

**Untouched (per story constraints):**
- `.github/workflows/perf.yml` (Story 1.13 territory)
- `package.json` (no new scripts; `test:unit`/`test:integration` deferred to Epic 2)
- `turbo.json` (existing tasks sufficient)
- `apps/`, `packages/` source trees

### Review Findings

Code review conducted 2026-04-25 (3-layer adversarial: Blind Hunter, Edge Case Hunter, Acceptance Auditor).

**Decision-Needed:**
- [x] [Review][Decision] `db-diff` job installs Supabase CLI but never calls it — pure echo stub — AC3 says "runs `supabase db diff`"; Dev Notes document intentional deferral to Epic 2; confirm: is the current stub acceptable or should at minimum `supabase --version` or a dry-run be added to verify CLI install? **→ Resolved: replaced echo stub with `supabase --version` smoke-check + `ls supabase/migrations/`**

**Patches:**
- [x] [Review][Patch] `e2e` and `db-diff` jobs lack `needs: [quality]` — all three jobs run in parallel; a broken typecheck/lint/test does not block E2E or db-diff from passing [`.github/workflows/ci.yml`] **→ Fixed: added `needs: [quality]` to both jobs**
- [x] [Review][Patch] `db-diff` job pins `version: latest` for Supabase CLI — non-deterministic; pin to a specific version [`.github/workflows/ci.yml`] **→ Fixed: pinned to `2.0.0`**
- [x] [Review][Patch] PR template "Design system" item references `docs/Design System.md` — file is at `specs/Design System.md` [`.github/PULL_REQUEST_TEMPLATE.md`] **→ Fixed: corrected path**
- [x] [Review][Patch] `dependabot.yml` `open-pull-requests-limit: 5` — too low for this monorepo's dependency surface; Dependabot silently stops opening PRs when limit is hit [`.github/dependabot.yml`] **→ Fixed: raised to 10**
- [x] [Review][Patch] `e2e` job does not cache Playwright browser binaries — Chromium (~120 MB) re-downloaded on every run [`.github/workflows/ci.yml`] **→ Fixed: added `actions/cache@v4` step for `~/.cache/ms-playwright`**

**Deferred:**
- [x] [Review][Defer] `quality` job renamed from `ci` — admin must update required-status-check in branch protection after merge [`.github/workflows/ci.yml`] — deferred, documented in Dev Notes (admin action post-merge)
- [x] [Review][Defer] `supabase/config.toml` auth defaults from `supabase init` (enable_confirmations=false, password_length=6, secure_password_change=false) [`supabase/config.toml`] — deferred, pre-existing local-dev defaults; Epic 2 auth setup will configure production values
- [x] [Review][Defer] `supabase/.gitignore` has no `seed.sql` exclusion; `config.toml` references `./seed.sql` as seed path [`supabase/.gitignore`] — deferred, no seed.sql exists yet; Epic 2 concern
- [x] [Review][Defer] `contracts:check` uses `globSync` (Node ≥22) with no `engines` field in `package.json` — pre-existing from Story 1.3 — deferred, pre-existing; not introduced by this story
- [x] [Review][Defer] `turbo.json` has no tasks for `contracts:check`/`tools:check` — these bypass Turbo remote cache — deferred, pre-existing; story explicitly excludes turbo.json changes
- [x] [Review][Defer] `CODEOWNERS` uses personal account handle `@hivelumeadmin` instead of a team — author can self-approve [`.github/CODEOWNERS`] — deferred, acknowledged in file; pending GitHub team configuration
- [x] [Review][Defer] Playwright/LH `webServer` 15 s start timeout — tight on cold runners [`apps/web/playwright.config.ts`] — deferred, pre-existing from Story 1.13
- [x] [Review][Defer] `supabase/config.toml` `refresh_token_reuse_interval = 10` and other auth timing defaults [`supabase/config.toml`] — deferred, local-dev defaults; Epic 2 will set production auth config
- [x] [Review][Defer] Fork PRs silently drop Turborepo remote cache (secrets not passed to fork workflows) [`.github/workflows/ci.yml`] — deferred, documented; graceful fallback to local cache
- [x] [Review][Defer] `--ignore-glob="**/perf/**"` glob resolution is platform-relative — not an issue on ubuntu-latest CI [`.github/workflows/ci.yml`] — deferred, pre-existing; CI uses Linux runners

---

## Change Log

| Date | Story | Description |
|---|---|---|
| 2026-04-25 | 1.14 | PR template with 6-item patterns checklist; CODEOWNERS; weekly Dependabot for npm + GitHub Actions; ci.yml split into quality/e2e/db-diff jobs with Turborepo remote-cache env vars and Supabase CLI install. Status → review. |
| 2026-04-25 | 1.14 | Code review: 1 decision-needed, 5 patches, 10 deferred, 11 dismissed. Status → in-progress pending resolution. |
