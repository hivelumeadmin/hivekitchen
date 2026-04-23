# Story 1.1: Scaffold apps/marketing (Astro) and packages/ui workspace package

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want the missing top-level workspaces (`apps/marketing`, `packages/ui`) scaffolded and registered with Turborepo + pnpm,
So that subsequent stories can add Astro pages and shadcn-copied-in components without hitting "package not found" errors.

## Acceptance Criteria

1. `apps/marketing/` exists, scaffolded via the exact Astro CLI invocation below, with package name `@hivekitchen/marketing`, registered in `pnpm-workspace.yaml` (already covered by the `apps/*` glob) and added to `turbo.json` tasks (`dev`, `build`, `lint`, `typecheck`, `clean`).
2. `packages/ui/` exists as an empty workspace package with:
   - `package.json` (name `@hivekitchen/ui`, private, ESM, workspace-versioned)
   - `tsconfig.json` extending `@hivekitchen/tsconfig/react.json`
   - `src/index.ts` as an empty barrel (no exports yet)
   - `tailwind.config.ts` consuming token presets from `packages/design-system/tokens` (see **Cross-story resolution** in Dev Notes)
3. `pnpm install` succeeds at workspace root with both new packages discovered.
4. `pnpm dev:marketing` (root alias → `turbo run dev --filter=@hivekitchen/marketing`) starts the Astro dev server on a configurable port without errors.
5. `pnpm typecheck` passes across the entire monorepo including the new packages.
6. `pnpm build` (no filter, from workspace root) passes across the entire monorepo — verifying no regression in `apps/web`, `apps/api`, `packages/contracts`, `packages/types`.

### AC → Task mapping (Definition of Done)

| AC | Satisfied by |
|---|---|
| AC1 | Tasks 2, 6 |
| AC2 | Tasks 3, 5 |
| AC3 | Task 7 |
| AC4 | Tasks 6, 7 |
| AC5 | Tasks 2, 3, 4, 7 |
| AC6 | Task 7 |

## Tasks / Subtasks

- [x] **Task 1 — Pre-flight verification** (no AC)
  - [x] Confirm existing monorepo layout: `apps/{web,api}`, `packages/{contracts,types,tsconfig}`. Abort if unexpected state.
  - [x] Confirm `pnpm-workspace.yaml` contains `apps/*` and `packages/*` globs. No edit needed.
  - [x] Confirm `packages/tsconfig/` has `base.json`, `node.json`, `react.json`. Note: no `astro.json` preset exists — see Task 4.

- [x] **Task 2 — Scaffold `apps/marketing` via Astro CLI** (AC: 1, 5)
  - [x] From workspace root, run the exact command:
    ```bash
    pnpm create astro@latest apps/marketing -- --template minimal --typescript strict --no-git --no-install --skip-houston
    ```
  - [x] Edit `apps/marketing/package.json`: set `"name": "@hivekitchen/marketing"`, `"private": true`, confirm `"type": "module"`, remove any git/hook scripts Astro injected.
  - [x] Remove any Astro-generated `.gitignore`, `README.md`, `public/favicon.svg` artifacts that duplicate root-level files. Keep `src/`, `astro.config.mjs`, `tsconfig.json`, `package.json`.
  - [x] Verify `astro.config.mjs` has no telemetry/analytics integrations (Astro defaults to clean minimal).
  - [x] Add `.env.local.example` placeholder (actual env vars land in Story 1.2 — just create the file with a comment header).
  - [x] Add `@astrojs/check` and `typescript` as devDependencies in `apps/marketing/package.json`. These are **implicit companions** to `astro check` — the Astro CLI does not install them, but `astro check` exits non-zero without them, which blocks AC 5. `typescript ^5.5.0` matches repo convention; `@astrojs/check` uses its latest (Astro-coupled).
  - [x] Add `tailwind.config.ts` stub to `apps/marketing/` per architecture §Complete Project Directory Structure (line 1155). Content: `export default {};` — the file exists for tree-consistency; real Tailwind integration lands in Story 1.4.

- [x] **Task 3 — Scaffold `packages/ui`** (AC: 2)
  - [x] Create `packages/ui/package.json` (see **Exact Package Specs** in Dev Notes).
  - [x] Create `packages/ui/tsconfig.json` extending `@hivekitchen/tsconfig/react.json`; `include: ["src"]`; no emit (types-only workspace consumer).
  - [x] Create `packages/ui/src/index.ts` containing only `export {};` to satisfy TS isolatedModules.
  - [x] Create `packages/ui/tailwind.config.ts` per **Exact Tailwind Config** in Dev Notes. This is a *preset producer* — apps import and extend it.

- [x] **Task 4 — Add `packages/tsconfig/astro.json` preset** (AC: 1, 5)
  - [x] Architecture §Complete Project Directory Structure (line 1294) lists an `astro.json` preset that doesn't exist today. Create it by **extending Astro's own strict preset**: `{ "extends": "astro/tsconfigs/strict", "compilerOptions": { "types": ["astro/client"] } }`. Inheriting from `astro/tsconfigs/strict` (rather than from `./base.json`) picks up Astro-critical options — `jsxImportSource: "astro"`, `allowJs: true`, `isolatedModules: true`, verbatim module syntax — that Astro maintains upstream, so future Astro upgrades flow through automatically.
  - [x] Update `packages/tsconfig/package.json` `files` array to include `"astro.json"`.
  - [x] Rewrite `apps/marketing/tsconfig.json` to `{ "extends": "@hivekitchen/tsconfig/astro.json", "include": ["src"] }` (replacing Astro's generated `extends`).
  - [x] Note: `astro` must be resolvable from `packages/tsconfig` for the `extends` to work. Since `apps/marketing/package.json` takes `astro` as a dep, and tsconfig `extends` resolves via Node module resolution from the consuming project, this works. No `astro` dep needed in `packages/tsconfig`.

- [x] **Task 5 — Scaffold forward-dependency stub for design tokens** (AC: 2)
  - [x] Create `packages/design-system/` as a stub directory (NOT a workspace package yet) with:
    - `packages/design-system/tokens/.gitkeep` (empty directory marker)
    - `packages/design-system/tokens/index.ts` exporting `export const tokenPresets = {};` as a typed placeholder. Story 1.4 replaces this with real token definitions.
  - [x] Do NOT create `packages/design-system/package.json` in this story — Story 1.4 decides the final shape.
  - [x] See **Cross-story resolution** in Dev Notes for rationale.

- [x] **Task 6 — Register in Turborepo** (AC: 1, 4, 5)
  - [x] `turbo.json` already declares `dev`, `build`, `lint`, `typecheck`, `clean` tasks — no schema change needed. Each app/package inherits by having its own `package.json` scripts.
  - [x] Add `dev`, `build`, `lint`, `typecheck`, `clean` scripts to `apps/marketing/package.json` mapped to Astro CLI (see **Exact Package Specs** for precise content including cross-platform clean command).
  - [x] Add `typecheck` and `clean` scripts to `packages/ui/package.json` (no `dev`/`build`/`lint` yet — empty barrel).
  - [x] Add `dev:marketing` root-package alias: `"dev:marketing": "turbo run dev --filter=@hivekitchen/marketing"` — matches existing `dev:web` / `dev:api` pattern in root `package.json` and satisfies epic AC 4 verbatim. (Other root scripts like `supabase:start`, `seed:dev`, `test` still belong to Story 1.2 — only this one alias lands here.)

- [x] **Task 7 — Verify** (AC: 3, 4, 5, 6)
  - [x] Run `pnpm install` from workspace root. Expect: both new packages discovered, no resolution errors.
  - [x] Run `pnpm dev:marketing` from workspace root. Expect: Astro dev server starts, binds to a port (default 4321), no compile errors. Stop with Ctrl+C.
  - [x] Run `pnpm typecheck` from workspace root. Expect: all packages pass — including existing `apps/web`, `apps/api`, `packages/contracts`, `packages/types` (no regression from `packages/tsconfig/package.json` `files` array edit).
  - [x] Run `pnpm build` from workspace root (**no filter** — full-monorepo build). Expect: every package builds, no regressions anywhere in the workspace.
  - [x] Run `pnpm build --filter=@hivekitchen/marketing`. Expect: `apps/marketing/dist/` produced. (Verified via full-monorepo `pnpm build` run — `apps/marketing/dist/{index.html,favicon.ico}` emitted.)

- [x] **Task 8 — Commit** (no AC — workflow discipline)
  - [x] ~~Branch name: `feat/story-1-1-scaffold-marketing-ui`~~ — **Waived for this story only**: pre-initial-commit repo state. Per user instruction (2026-04-23), a single genesis commit on `main` establishes the baseline; no feature branch or PR for Story 1.1. Future stories use the standard feat/*-branch → PR → main flow.
  - [x] Commit: `feat(scaffold): initial workspace baseline with apps/marketing (astro) and packages/ui` — commit `3224ee5` on `main`.
  - [x] Pushed to `origin/main` with upstream tracking set. Dependency discipline held: scaffold installs (astro ^6.1.9 runtime + transitive), `@astrojs/check` + `typescript` (documented exception, `apps/marketing/devDependencies`), `tailwindcss` ^3.4 + `typescript` (documented exception, `packages/ui/devDependencies`), `@hivekitchen/tsconfig` `workspace:*` (implicit companion for tsconfig extends, also added to marketing). No other deps.

## Dev Notes

### Scope of this story
This story is **scaffolding only**. No shadcn components, no pages beyond Astro's minimal default, no Tailwind token values, no env wiring. Those land in Stories 1.2 (scripts + Dockerfile + env), 1.4 (tokens), and later epics (pages). Resist scope creep.

### Anti-patterns to reject
- ❌ Adding dependencies beyond the three documented exceptions (`@astrojs/check` + `typescript` in `apps/marketing`, `tailwindcss` in `packages/ui/devDependencies`, plus Astro CLI's own installs). Anything else is out of scope.
- ❌ Creating `packages/design-system/package.json` (Story 1.4 owns that decision).
- ❌ Wiring `dev:web` alias or any root script beyond `dev:marketing` (Story 1.2 owns the rest: `supabase:start`, `seed:dev`, `test`, etc.).
- ❌ Touching `apps/web` or `apps/api` — they are already scaffolded and this story doesn't change them.
- ❌ Running `pnpm install` with `--prod` or any lockfile-freezing flag. We WANT the lockfile to update.
- ❌ Committing `node_modules/`, `.astro/`, `dist/`, or any build output.
- ❌ Introducing an `eslint.config.js` or `.eslintrc` — lint wiring is Story 1.5's scope.

### Cross-platform shell assumption (clean scripts)

All `clean` scripts in this story use `rimraf`-style semantics via Node's `fs.rmSync` to stay cross-platform. Do NOT write raw `rm -rf` — the user's primary development environment is Windows 11, where pnpm's default script shell is `cmd.exe` (no `rm`). Use the inline Node form shown in **Exact Package Specs**.

### Cross-story resolution: `packages/design-system/tokens` forward dependency

**⚠️ Spec conflict flagged — dev agent should read this before proceeding.**

- **Epic says** (Stories 1.1, 1.4, 1.5, 1.12): there is a separate `packages/design-system/` workspace package owning tokens, scope charter, and contrast audit.
- **Architecture says** (§Complete Project Directory Structure, line 1284–1292): tokens live *inside* `packages/ui/src/tokens/`, and scope-allowlist lives at `packages/ui/src/scope-allowlist.config.ts`. There is NO `packages/design-system` in the architecture tree.

**Resolution for THIS story:**
- Create `packages/design-system/tokens/` as a **non-workspace stub folder** (no `package.json`). `packages/ui/tailwind.config.ts` references `../design-system/tokens/index.ts` via a *relative path*, not via a workspace dependency. This keeps Story 1.1 compilable without pre-deciding the packages/ui-vs-packages/design-system split.
- Story 1.4 (authored next) must resolve the conflict definitively by either:
  - (a) Promoting `packages/design-system/` to a full workspace package with its own `package.json`, or
  - (b) Moving tokens into `packages/ui/src/tokens/` per architecture and deleting the stub.

**Dev agent: do NOT attempt to resolve the conflict here.** Leave a TODO comment in `packages/ui/tailwind.config.ts` pointing to Story 1.4.

**🔔 User escalation required before Story 1.4 dev begins:** Confirm with the PM whether `packages/design-system/` becomes a full workspace package (epic's model — also matches Story 1.5 `packages/design-system/SCOPE_CHARTER.md` and Story 1.12 contrast-audit harness references) or whether tokens collapse into `packages/ui/src/tokens/` (architecture's model — lines 1288, 1292). The dev agent executing Story 1.4 cannot make this call alone; it is a cross-epic architectural commitment. Prefer option (a) unless the PM explicitly rules for (b), because three separate stories (1.4, 1.5, 1.12) reference `packages/design-system/` as a distinct home.

### Exact Package Specs

**`apps/marketing/package.json`** (post-Astro-CLI edits):
```json
{
  "name": "@hivekitchen/marketing",
  "type": "module",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "preview": "astro preview",
    "lint": "astro check",
    "typecheck": "astro check",
    "clean": "node -e \"import('node:fs').then(fs => { fs.rmSync('dist', { recursive: true, force: true }); fs.rmSync('.astro', { recursive: true, force: true }); })\""
  },
  "devDependencies": {
    "@astrojs/check": "latest",
    "typescript": "^5.5.0"
  }
}
```
Astro's install will add `astro` as a runtime dep. The two devDeps above are the **documented exception** to the no-new-deps rule (required for `astro check` to execute — without them, `pnpm typecheck` fails AC 5). No other deps in this story.

**`packages/ui/package.json`:**
```json
{
  "name": "@hivekitchen/ui",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "clean": "node -e \"import('node:fs').then(fs => fs.rmSync('dist', { recursive: true, force: true }))\""
  },
  "devDependencies": {
    "@hivekitchen/tsconfig": "workspace:*",
    "tailwindcss": "^3.4.0",
    "typescript": "^5.5.0"
  }
}
```
Source-imported (no build step) — matches `@hivekitchen/contracts` / `@hivekitchen/types` pattern per `project-context.md`. `tailwindcss` is required as a devDep here because `tailwind.config.ts` imports `type { Config } from 'tailwindcss'`; under pnpm 9's strict isolation, phantom-dep resolution is off, so the type must resolve from this package's own deps. Tailwind ^3.4 is the repo-pinned version — not a new dep choice.

**`packages/ui/tsconfig.json`:**
```json
{
  "extends": "@hivekitchen/tsconfig/react.json",
  "include": ["src"]
}
```

**`packages/ui/src/index.ts`:**
```ts
export {};
```

**`apps/marketing/tsconfig.json`** (rewritten from Astro default):
```json
{
  "extends": "@hivekitchen/tsconfig/astro.json",
  "include": ["src"]
}
```

### Exact Tailwind Config (packages/ui/tailwind.config.ts)

```ts
import type { Config } from 'tailwindcss';
// TODO(story-1.4): replace relative path with final packages/design-system
// resolution once Story 1.4 decides whether design-system is a workspace package
// or folded into packages/ui/src/tokens. Epic vs architecture conflict — see
// Story 1.1 Dev Notes §Cross-story resolution.
import { tokenPresets } from '../design-system/tokens/index.js';

const config: Config = {
  content: [],
  theme: {
    extend: tokenPresets,
  },
  plugins: [],
};

export default config;
```
Note: `tokenPresets` is `{}` in Story 1.1; Story 1.4 fills it with the semantic tokens.

### packages/design-system/tokens/index.ts (stub, created in Task 5)

```ts
// Placeholder — Story 1.4 replaces this with the v2.0 token system.
// This file exists so packages/ui/tailwind.config.ts can compile in Story 1.1
// without forward-declaring an unresolved module.
export const tokenPresets = {};
```

### `packages/tsconfig/astro.json` (new preset, Task 4)

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "extends": "astro/tsconfigs/strict",
  "compilerOptions": {
    "types": ["astro/client"]
  }
}
```

Why extend `astro/tsconfigs/strict` (not `./base.json`)? The Astro-strict preset ships with — and maintains upstream — the options Astro's own tooling expects: `jsxImportSource: "astro"` (required for `.astro` JSX syntax to type-resolve), `allowJs: true`, `isolatedModules: true`, verbatim module syntax, bundler module resolution, and matching `target`/`module`/`lib` triple. Inheriting from it means future Astro upgrades flow through without us manually re-syncing compiler options. `astro` itself is resolved via Node module resolution from the consuming project (`apps/marketing` has it as a dep), so no `astro` dep is needed in `packages/tsconfig`.

Then update `packages/tsconfig/package.json` `files` array:
```json
"files": ["base.json", "node.json", "react.json", "astro.json"]
```

### Architecture Compliance (must-follow)

- **Monorepo layout** (Architecture §Complete Project Directory Structure): `apps/marketing/` and `packages/ui/` land at the locations shown in the tree. Do not invent new top-level folders.
- **Shared-package discipline** (`project-context.md` — Shared Packages): `packages/ui` is source-imported, no `dist/`, no build step. Never reference `@hivekitchen/ui/dist/...`.
- **ESM everywhere** (`project-context.md` — TypeScript + ESM & module invariants): `"type": "module"` on every new `package.json`. No `require()`, no `__dirname`, no `__filename`.
- **isolatedModules compliance** (`project-context.md` — Language-Specific Rules): `packages/ui/src/index.ts` must be valid as a module — `export {};` satisfies TS.
- **TypeScript strict** (inherited from `@hivekitchen/tsconfig`): do not disable strictness in any new tsconfig.
- **Dep exceptions this story (explicitly recorded):** (`project-context.md` — Development Workflow Rules): "Don't introduce new external dependencies without a recorded reason." Three recorded exceptions, each required to satisfy AC 5:
  1. `astro` (and whatever the Astro CLI installs into `apps/marketing`) — required by the story's primary scaffold mandate.
  2. `@astrojs/check` + `typescript` in `apps/marketing/devDependencies` — required for `astro check` to run (used by both `lint` and `typecheck` scripts).
  3. `tailwindcss` ^3.4 in `packages/ui/devDependencies` — required for `packages/ui/tailwind.config.ts` typed Config import to resolve under pnpm's strict isolation.
  
  All three match existing repo conventions (TS ^5.5, Tailwind ^3.4) — they are not new *choices*, only new *placements*.

### Library / Framework Requirements

- **Astro**: latest `@latest` at time of scaffold. Template: `minimal`. TypeScript strictness: `strict`. Keep Astro's `astro.config.mjs` default — no integrations in this story. Islands model adopted per Architecture §Decision Priority Analysis (zero-JS default, LCP target on landing).
- **TypeScript ^5.5** (matching repo convention).
- **Tailwind CSS ^3.4** (matching repo convention) — `packages/ui/tailwind.config.ts` is a preset producer; don't install Tailwind itself in `packages/ui` (apps that consume it already have it).
- **No shadcn/ui in this story.** Architecture §Initialization Commands says `shadcn@latest init --base radix --template vite --yes` runs in `apps/web` — that's a separate story. Do not run it here.

### File Structure Requirements

Post-story, the tree should include exactly these new paths (nothing more):

```
apps/
  marketing/
    src/                          Astro CLI scaffolded
    astro.config.mjs              Astro CLI scaffolded (minimal, no integrations)
    package.json                  Edited: name → @hivekitchen/marketing, devDeps (@astrojs/check, typescript)
    tsconfig.json                 Rewritten: extends @hivekitchen/tsconfig/astro.json
    tailwind.config.ts            Stub (export default {}) — real integration in Story 1.4
    .env.local.example            Stub (populated in Story 1.2)
packages/
  ui/
    src/
      index.ts                    "export {};"
    package.json                  New (incl. tailwindcss devDep)
    tsconfig.json                 New
    tailwind.config.ts            New
  tsconfig/
    astro.json                    New preset (Task 4; extends astro/tsconfigs/strict)
    package.json                  Edited: files array includes "astro.json"
  design-system/
    tokens/
      .gitkeep                    New
      index.ts                    Stub (Story 1.4 replaces)
package.json                      Edited: +1 root script "dev:marketing"
```

### Testing Requirements

No automated tests introduced by this story. Verification is the four `pnpm` commands in Task 7 producing green output. Test infrastructure (Vitest, Playwright) lands in later stories per `project-context.md` — **Testing Rules**.

### Project Context Reference

Before implementing, read `_bmad-output/project-context.md` in full. The following sections are load-bearing for this story:

- **Technology Stack & Versions → Monorepo** (Turbo/pnpm discipline, Node >=22)
- **Technology Stack & Versions → Shared Packages** (source-imported, no `dist/`)
- **Technology Stack & Versions → TypeScript** (strict, bundler resolution, isolatedModules, ESM)
- **Framework-Specific Rules → Fastify 5 / React 19 + Vite** — NOT applicable to marketing app; marketing is Astro
- **Code Quality & Style Rules → Naming / File organization**
- **Development Workflow Rules → Branches, Commits, Turborepo discipline**
- **Critical Don't-Miss Rules → ESM & module invariants**

### Previous Story Intelligence

N/A — this is the first story in Epic 1 and the first story in the project.

### Git Intelligence

Repository status at story creation (from `git status` snapshot):
- Branch: `master` (note: PR target is `main` per root `CLAUDE.md` — coordinate branch strategy before first PR)
- All existing top-level files (`apps/`, `packages/`, `_bmad/`, `_bmad-output/`, `docs/`, `.claude/`, etc.) are untracked
- No prior commits visible

**Action required:** The dev agent should confirm with the user whether this repo is in pre-initial-commit state (first-ever commit will establish `main`) or whether there is a missed initial commit. Do NOT create an empty initial commit on the scaffolding branch.

### References

- Epic 1 §Story 1.1 — acceptance criteria source. [Source: `_bmad-output/planning-artifacts/epics.md#Story-1.1`]
- Architecture §Initialization Commands — exact Astro CLI invocation + notes on CLI selection. [Source: `_bmad-output/planning-artifacts/architecture.md#L207-L228`]
- Architecture §Core Architectural Decisions — monorepo + tech stack locked decisions. [Source: `_bmad-output/planning-artifacts/architecture.md#L266-L278`]
- Architecture §Complete Project Directory Structure — canonical post-scaffold tree (including `packages/tsconfig/astro.json` preset). [Source: `_bmad-output/planning-artifacts/architecture.md#L943-L1310`]
- Architecture §Decisions (shadcn/ui placement) — shadcn lands in `packages/ui` in a later story; `packages/ui` starts empty here. [Source: `_bmad-output/planning-artifacts/architecture.md#L172`]
- Project context — cross-cutting implementation rules. [Source: `_bmad-output/project-context.md`]

### Project Structure Notes

- `pnpm-workspace.yaml` already has `apps/*` and `packages/*` globs — both new packages are auto-discovered. Verified in `F:/development/hivekitchen/pnpm-workspace.yaml`.
- `turbo.json` already declares `dev`, `build`, `lint`, `typecheck`, `clean` tasks. No `turbo.json` changes needed for Task 6.
- **Variance from architecture (documented, intentional):** Architecture §1294 lists `packages/tsconfig/astro.json` as existing. It does not exist today. Task 4 creates it — this is the first story to need it, which is why it lands here.
- **Variance to resolve in Story 1.4:** `packages/design-system/` is a deliberate stub in this story — see Cross-story resolution above.

## Dev Agent Record

### Agent Model Used

Claude Opus 4.7 (1M context) — `claude-opus-4-7[1m]`

### Debug Log References

- 2026-04-23 (pre-unblock) — `pnpm typecheck` at workspace root: 5/6 pass; `@hivekitchen/marketing` exits 1 via `astro check` with `Node.js v22.11.0 is not supported by Astro! Please upgrade Node.js to a supported version: ">=22.12.0"`. Root cause: `pnpm create astro@latest` installed `astro@^6.1.9` (engine floor 22.12.0); local Node was 22.11.0.
- 2026-04-23 (user unblock) — Node upgraded to v24.15.0 (exceeds Astro floor). Note: `project-context.md` cautions against Node-23-only APIs — Node 24 is above that line and should be re-confirmed if any Node 23+ API becomes load-bearing.
- 2026-04-23 (post-unblock) — `pnpm typecheck`: **6/6 successful**. `astro check` on `apps/marketing` reports `0 errors, 0 warnings, 0 hints`. Other five packages `tsc --noEmit` clean.
- 2026-04-23 (post-unblock) — `pnpm build` (no filter, full monorepo): **3/3 successful** (marketing, api, web; tsconfig-presets and source-imported packages are no-build by design). `apps/marketing/dist/{index.html,favicon.ico}` emitted; `apps/web/dist/` emitted (one Tailwind warning about no utility classes detected, which is expected given the empty design-system stub — not a Story 1.1 regression).
- 2026-04-23 (post-unblock) — `pnpm dev:marketing`: Astro v6.1.9 `ready in 1499ms`, bound to `http://localhost:4321/`, no compile errors. Stopped cleanly.
- 2026-04-23 — `astro telemetry disable` invoked once for `apps/marketing` to silence the anonymous-usage prompt that surfaced in the first `astro check` run. Keeps the scaffold aligned with the story's "no integrations" stance.

### Completion Notes List

Ultimate context engine analysis completed — comprehensive developer guide created. Validation pass applied (2026-04-23): (1) Astro `check` deps (`@astrojs/check` + `typescript`) and Tailwind devDep on `packages/ui` explicitly added to satisfy AC 5; (2) `packages/tsconfig/astro.json` now extends `astro/tsconfigs/strict` for upstream-maintained Astro compiler options; (3) all `clean` scripts use Node `fs.rmSync` for Windows compatibility; (4) root `dev:marketing` alias added to match epic AC wording; (5) full-monorepo `pnpm build` added to Task 7 verification; (6) AC-to-Task mapping added; (7) design-system cross-story conflict escalated for PM confirmation before Story 1.4; (8) branch renamed to story-scoped `feat/story-1-1-scaffold-marketing-ui`. Key flags for reviewer: (a) `packages/design-system` stub is intentional pending Story 1.4 PM decision; (b) `packages/tsconfig/astro.json` preset is new and not previously extant; (c) pre-initial-commit repo state may need user confirmation before first PR.

**2026-04-23 — Dev execution summary (Tasks 1–6 complete, Task 7 blocked, Task 8 deferred):**

- Tasks 1–6 implemented per spec. Scaffold edits, new packages, design-system stub, tsconfig preset, and Turborepo script wiring all landed.
- **Task 7 blocker (Node engine mismatch):** `pnpm create astro@latest` installed `astro@^6.1.9`, which hard-requires Node `>=22.12.0`. Installed Node is `v22.11.0`, so `astro check` (both `lint` and `typecheck` in marketing) and `astro dev` refuse to run. AC 4, 5, and 6 cannot currently be evidenced end-to-end. All other workspaces (`@hivekitchen/web`, `@hivekitchen/api`, `@hivekitchen/contracts`, `@hivekitchen/types`, `@hivekitchen/ui`) typecheck clean in isolation — verified via filtered runs.
- **Dev-added implicit dep (documented exception):** `@hivekitchen/tsconfig` `workspace:*` added to `apps/marketing/devDependencies`. Required so `apps/marketing/tsconfig.json`'s `extends: "@hivekitchen/tsconfig/astro.json"` resolves under pnpm's strict isolation — mirrors `apps/web`'s pattern. The story's Exact Package Specs for marketing omitted this workspace dep; without it the extends silently can't resolve and AC 5 would fail even with a compatible Node runtime.
- **Safety addition:** `.astro/` added to root `.gitignore`. Astro's own `.gitignore` was removed per Task 2 spec, but the anti-pattern list explicitly forbids committing `.astro/`. Root-level ignore preserves that invariant.
- **Artifact removals beyond the explicit list:** Astro CLI also emitted `apps/marketing/.vscode/` (editor config). The Task 2 spec lists `.gitignore`, `README.md`, `public/favicon.svg` as removals, and says "Keep `src/`, `astro.config.mjs`, `tsconfig.json`, `package.json`" — the VS Code folder was removed as a non-listed keep item. No functional impact; flagging for reviewer.
- **Deferred — Task 8 (commit + branch):** Git repo is pre-initial-commit (`master` has no commits yet). Per story Git Intelligence, user confirmation required before (a) establishing `main` via first commit and (b) reconciling `master` ↔ `main` branch names against the `feat/story-1-1-scaffold-marketing-ui` target. Awaiting user direction.

**Open questions for user (blocking completion):**

1. Upgrade local Node to `>=22.12.0` to unblock AC 4/5/6, OR pin `astro` to a pre-6.0 release (e.g. `astro@^5`) that supports Node `>=18.17.1`? The story spec calls for `@latest`, so the preferred path is the Node upgrade, but this is an environmental change I cannot make on the user's behalf.
2. Pre-initial-commit repo: should the first commit create `main` (and this branch rebase onto it), or should the story-1-1 branch be cut off `master` with a later rename?

### File List

**Added**
- `apps/marketing/astro.config.mjs` (Astro CLI scaffolded; no integrations)
- `apps/marketing/package.json` (renamed to `@hivekitchen/marketing`; scripts + devDeps added)
- `apps/marketing/tsconfig.json` (rewritten to extend `@hivekitchen/tsconfig/astro.json`)
- `apps/marketing/tailwind.config.ts` (stub: `export default {};`)
- `apps/marketing/.env.local.example` (placeholder; populated in Story 1.2)
- `apps/marketing/src/pages/index.astro` (Astro CLI minimal default)
- `apps/marketing/public/favicon.ico` (retained; not listed in spec removals)
- `packages/ui/package.json`
- `packages/ui/tsconfig.json`
- `packages/ui/src/index.ts`
- `packages/ui/tailwind.config.ts`
- `packages/tsconfig/astro.json` (new preset extending `astro/tsconfigs/strict`)
- `packages/design-system/tokens/.gitkeep`
- `packages/design-system/tokens/index.ts` (stub, Story 1.4 replaces)

**Modified**
- `package.json` (+1 root script `dev:marketing`)
- `packages/tsconfig/package.json` (`files` array now includes `"astro.json"`)
- `.gitignore` (added `.astro/` to preserve build-output protection after Astro's own `.gitignore` was removed per Task 2)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (`1-1-…` → `in-progress`)

**Removed** (Astro scaffold artifacts per Task 2)
- `apps/marketing/.gitignore`
- `apps/marketing/README.md`
- `apps/marketing/public/favicon.svg`
- `apps/marketing/.vscode/` (editor config; not in spec's explicit keep list — removed for minimal footprint)

### Change Log

| Date | Change | By |
|---|---|---|
| 2026-04-23 | Tasks 1–6 implemented; Task 7 initially blocked on Node engine mismatch (`astro@6.1.9` requires `>=22.12.0`, local was `22.11.0`); Task 8 deferred for pre-initial-commit branch-strategy confirmation. Story status set to `in-progress`. | Dev (Opus 4.7) |
| 2026-04-23 | Node upgraded to v24.15.0 by user; re-ran verification: `pnpm typecheck` 6/6 pass, `pnpm build` 3/3 pass, `pnpm dev:marketing` binds to :4321. All AC satisfied. | Dev (Opus 4.7) |
| 2026-04-23 | Per user direction, Task 8 feature-branch/PR workflow waived for genesis commit only. Renamed unborn `master` → `main`; single genesis commit `3224ee5` on `main` containing baseline + Story 1.1 scaffold; pushed to `origin/main` with upstream tracking. Story status → `review`. | Dev (Opus 4.7) |
