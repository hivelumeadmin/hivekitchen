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
