# Story 3.S42: Per-Child Snack Rules (Pins / Bans Editing)

Status: done

> **Source of truth:** `_bmad-output/planning-artifacts/sprint-change-proposal-2026-06-20-snack-skus.md` §6 → slice 3-s42. Option B (snacks as household-scoped SKUs) is LOCKED — do not re-open.
>
> **Depends on 3-s40 (done) + 3-s41 (review).** The deterministic snack rotation (`assignSnackRotation`), `snack_skus` table, `children.extra_rules` reading, and the kitchen-profile edit surface (7-s14 deterministic / 7-s15 soft-edit) all already exist. This story **adds the per-child pins/bans editing UI** and **closes deferred finding D-3S40-CR7** (wire `pins` into snack rotation). It does **not** create new tables, contracts, audit types, or migrations.

## Story

As a parent managing my household's weekly plan,
I want to set per-child snack preferences — pin a category we always want, ban a category we never want — from my child's kitchen-profile card,
so that Lumi's snack rotation reflects each child's tastes without me touching the plan every week.

## Background

**The backend already exists.** Story 3.21 shipped `children.extra_rules` (`{pins: string[], bans: string[]}` JSONB) with a full repository, PATCH/GET routes, contracts, audit event, and a standalone form. Story 3-s40 (done) wired `extra_rules.bans` into deterministic snack rotation (`assignSnackRotation`), but **deliberately deferred `pins`** (finding **D-3S40-CR7**) pending a pin-semantics decision and an editing surface. There is no per-child editor on the canonical kitchen-profile page yet.

This story does exactly two things:

1. **Surface** a deterministic per-child pins/bans editor inside `ChildProfileCard` on `/app/kitchen-profile`, wired to the **existing** `PATCH /v1/children/:id/extra-rules` route (optimistic, mirroring the allergen-edit pattern).
2. **Honor `pins`** in `assignSnackRotation` with defined semantics (closes D-3S40-CR7).

### `extra_rules` is shared between Extras and snacks (important)

`children.extra_rules` is **one field consumed by two systems**:
- The **Extra slot** planner prompt (Story 3.21 — pins/bans of component types injected into the LLM plan prompt).
- The **snack rotation** (3-s40 — `bans` filter categories; this story adds `pins`).

So a ban/pin set here affects **both** a child's Extra slot and their snack rotation. The editor must be labeled to reflect that it governs snacks **and** extras (recommended label: "Snack & Extra preferences"), not snack-only. Do **not** fork a separate snack-only field or a separate vocabulary — that fragments the data model (see Dev Notes → "Vocabulary: reuse, do not fork").

### Allergen doctrine unchanged

Pins/bans are **taste preferences**, not safety controls. They are forward-only (affect next compose, not the current week) and carry no allergen semantics. Allergen safety remains the separate deterministic allergen edit (7-s14) and the Phase-2 fail-safe (3-s43). Do not conflate.

## Acceptance Criteria

### AC1 — Pin semantics defined & honored in snack rotation (closes D-3S40-CR7)

`apps/api/src/services/snack-rotation.service.ts` — `assignSnackRotation` now honors `extra_rules.pins` using **"prefer" semantics** (bias, never force-starve):

- A new helper `buildPinnedCategories(snackOnChildIds, extraRulesByChildId)` mirrors `buildBannedCategories` (union of every snack-ON child's `pins`, each run through `normalizeCategory`).
- Per day, **after** ban-filtering (`eligibleSkus`) and **before** the no-adjacent-repeat filter, compute `preferred = candidates.filter(sku => pinnedCategories.has(normalizeCategory(sku.category)))`. **If `preferred.length > 0`, narrow `candidates = preferred`; otherwise leave `candidates` unchanged.** (No pin → no-op, identical to today.)
- The no-adjacent-repeat filter and deterministic pick run on the (possibly narrowed) `candidates` exactly as today.
- **Never throw / never empty-out:** if a pinned category has no stocked, ban-eligible SKU, fall back to the full eligible pool (preference is best-effort).
- Determinism preserved — no `Math.random()` / `Date.now()`; same inputs → same output (AC8-equivalent from 3-s40 still holds).

> **Pin-vs-ban precedence:** bans win. The mutual-exclusion `.refine` in `ExtraRulesSchema` already forbids the same token in both arrays per child, but across two children sharing a slot one may pin `fruit` while another bans `fruit`. Ban-filtering runs first, so a category banned by any snack-ON child is removed before the pin narrowing — a pinned-but-banned category simply yields no `preferred` SKUs and falls back. This is correct and conservative; add a test for it.

### AC2 — Snack-rotation tests for pins

Extend `apps/api/src/services/snack-rotation.service.test.ts`:
- Pin biases selection: child pins `['fruit']`, SKUs `[FRUIT_SKU, VEG_SKU, GRAIN_SKU]` → every assigned slot is `FRUIT_SKU` (only fruit eligible after narrowing; adjacency keeps it since it's the sole preferred SKU).
- Pin with multiple preferred SKUs still respects no-adjacent-repeat (two fruit SKUs → alternate, never the same on consecutive days).
- Empty `pins` is a no-op (output identical to a run with `pins: []` — guards against regressions to the 3-s40 behavior).
- Pin that matches no stocked SKU falls back to the full eligible pool (does not empty the day).
- Pin + ban interaction: child A pins `fruit`, child B bans `fruit` (shared slot) → ban wins, fruit never selected, falls back to other categories.
- `'veggie'`→`'vegetable'` normalization applies to pins too (pin `['veggie']` matches a `vegetable` SKU).

### AC3 — Per-child editor surfaced in `ChildProfileCard`

A deterministic pins/bans editor renders inside each child's card on `/app/kitchen-profile`:
- Lives in `SafetyAndBagColumn` of `apps/web/src/features/kitchen-profile/components/ChildProfileCard.tsx`, alongside the existing "Lunch bag" block — **not** a separate page or modal.
- Uses the **v2.0 design tokens** of the surrounding card (`text-fg-default`, `text-fg-muted`, warm neutrals). **Do NOT copy `ExtraRulesForm.tsx`'s tokens** (`bg-white`, `text-stone-*`, `amber-600`) — those are stale v1 (flagged in project-context.md γ-migration banner).
- Vocabulary = the existing component-type set `['fruit','veggie','grain','protein','dairy','sweet treat']` (the same tokens `ExtraRulesForm.tsx` writes — see Dev Notes). Each token offers a 3-state control: **neutral / pinned / banned** (a category cannot be both — enforce client-side, mirroring `ExtraRulesSchema`'s refine).
- Initial state reads from the already-loaded kitchen-map projection `kitchenMap.children[].extra_rules` (the composer projects `{ pinned, banned }` — map `pinned→pins`, `banned→bans` for the PATCH body). **Verify** `KitchenMapChild`/its contract schema includes `extra_rules`; if the web type lacks it, prefer extending the contract (coordinated contract+api+web change) over a per-child GET. See Dev Notes → "Reading initial state".
- **Gated to primary parent only** — the PATCH route is `authorize(['primary_parent'])`. Render read-only (chips show state, no toggles) for non-primary roles, mirroring `editable` gating in `ChildProfileCard` (`onAddAllergen !== undefined`). Add a parallel optional handler prop (e.g. `onSetExtraRules`); when absent, the editor is read-only.

### AC4 — Optimistic save wired through existing PATCH route

In `apps/web/src/routes/(app)/kitchen-profile.tsx`:
- Add `handleSetExtraRules(childId, nextRules)` mirroring `handleAddAllergen` (`:113-137`): snapshot `prevMap`, apply optimistic local mutation via a pure reconciler `reconcileChildExtraRules(map, childId, nextRules)` (mirror `reconcileChildAllergens`), `await hkFetch('/v1/children/${childId}/extra-rules', { method: 'PATCH', body: { pins, bans } })`, reconcile from the parsed `UpdateExtraRulesResponseSchema`, **revert to `prevMap` on catch**, clear busy in `finally`.
- Surface a per-child busy + error state (mirror `allergenBusy`/`allergenError`), threaded into `ChildProfileCard` and rendered with `role="alert"`.
- Pass `handleSetExtraRules` into `ChildProfileCard` as `onSetExtraRules`.
- Forward-only messaging (e.g. "Saved — Lumi will use these next week") consistent with `ExtraRulesForm`'s existing copy.

### AC5 — No backend schema/contract/migration changes

This story adds **zero** migrations, contracts, audit types, or repository methods. It reuses:
- Route: `PATCH /v1/children/:id/extra-rules` (`apps/api/src/modules/children/children.routes.ts:292-337`, `requirePrimaryParent`).
- Contract: `UpdateExtraRulesInputSchema` / `UpdateExtraRulesResponseSchema` (`packages/contracts/src/extra-rules.ts`).
- Audit: `child.extra_rules_updated` (already emitted by the route).
- Cache: the `children_bump_kitchen_map` trigger already bumps `households.kitchen_map_version` on any `children` UPDATE — no app-code bump needed.

If any change to these is proposed, STOP and confirm — it is out of scope.

### AC6 — Web tests

Extend/add `apps/web/src/features/kitchen-profile/components/` and/or `apps/web/src/routes/(app)/kitchen-profile.test.tsx`:
- Editor renders current pins/bans from `kitchenMap.children[].extra_rules` (one pinned, one banned token shown in correct state).
- Toggling a token to pinned then saving issues `PATCH /v1/children/:id/extra-rules` with the correct `{pins, bans}` body (msw / fetch mock).
- A category cannot be simultaneously pinned and banned (selecting one clears the other in the UI).
- Non-primary role (no `onSetExtraRules`) renders read-only — no toggle controls, no PATCH.
- PATCH failure reverts the optimistic state and shows the error (`role="alert"`).

## Tasks / Subtasks

- [x] **Task 1 — Honor pins in snack rotation** (AC: 1)
  - [x] Add `buildPinnedCategories(...)` to `snack-rotation.service.ts` (mirror `buildBannedCategories`, normalize each pin).
  - [x] In the per-day loop, after `eligibleSkus(...)` and before the adjacent-repeat filter, narrow `candidates` to pinned-category SKUs when ≥1 exists; otherwise leave unchanged.
  - [x] Confirm fallback never empties the candidate list and determinism is preserved.
- [x] **Task 2 — Snack-rotation pin tests** (AC: 2)
  - [x] Add the 6 cases listed in AC2 to `snack-rotation.service.test.ts` (reuse the `sku(...)` factory + `FRUIT_SKU`/`VEG_SKU`/`GRAIN_SKU` fixtures already in the file).
- [x] **Task 3 — Per-child editor in `ChildProfileCard`** (AC: 3)
  - [x] Add optional `onSetExtraRules?` (+ busy/error) props; gate editability on its presence.
  - [x] Render a 3-state (neutral/pin/ban) control per component type in `SafetyAndBagColumn`, using v2.0 card tokens; enforce pin⊕ban client-side.
  - [x] Read initial state from `child.extra_rules` ({pinned, banned} → display).
- [x] **Task 4 — Optimistic wiring in `kitchen-profile.tsx`** (AC: 4)
  - [x] Add `reconcileChildExtraRules` pure helper (mirror `reconcileChildAllergens`).
  - [x] Add `handleSetExtraRules` (optimistic + revert-on-catch) calling the existing PATCH route.
  - [x] Thread busy/error state + pass `onSetExtraRules` into `ChildProfileCard`.
  - [x] Verify `KitchenMapChild` web type exposes `extra_rules`; if not, extend the contract (coordinated) — see Dev Notes.
- [x] **Task 5 — Web tests** (AC: 6)
  - [x] Render-from-state, save-issues-PATCH, pin⊕ban exclusivity, read-only-for-non-primary, revert-on-failure.

### Review Findings (code review 2026-06-20 — 3-layer adversarial: Blind / Edge-Case / Acceptance)

- [x] **[Review][Decision] RESOLVED → split 3-s42 commit.** The working tree stacked 3-s41 (`in_stock` filter + 2 stock tests in snack-rotation) + 3-s42 + 7-s15 + 3-s44. Per Menon's call, the cleanly-separable 3-s42 slice was committed alone (`b63e615`): snack-rotation pin code + pin tests + `ChildProfileCard` editor. The `in_stock` filter, stock tests, and the web route wiring (`kitchen-profile.tsx/.test.tsx`, interleaved with 7-s15) were left unstaged for the 3-s41 / 7-s15 commits. **Remaining branch action:** still need distinct 3-s41 / 3-s44 / 7-s15 commits before merge.
- [x] **[Review][Patch] Added multi-child differing-pins union test** — `snack-rotation.service.test.ts` "unions pins across children…" (A pins `fruit`, B pins `grain` → preferred = both, VEG excluded). 22/22 green. Committed in `b63e615`.
- [x] **[Review][Defer] D-3S42-CR1: "ban wins" false when bans exhaust the stocked pool** — all-banned `eligibleSkus` fallback (3-s40, pre-existing) returns the full pool; pin can re-prefer a banned category. Taste-not-safety. [`snack-rotation.service.ts:80`] — deferred, pre-existing
- [x] **[Review][Defer] D-3S42-CR2: whole-map revert clobbers concurrent different-child edit** — single `extraRulesBusyChild` string; mirrors the established `handleAddAllergen` idiom. [`kitchen-profile.tsx:841,854`] — deferred, pre-existing pattern
- [x] **[Review][Defer] D-3S42-CR3: no request sequencing on rapid same-token toggles** — out-of-order PATCH responses can briefly desync UI. [`ChildProfileCard.tsx:367-374`] — deferred, low-likelihood edge

**Dismissed (14):** Blind B4 (`reconcileChildExtraRules` shape mismatch — false positive: `UpdateExtraRulesResponseSchema.extra_rules = ExtraRulesSchema` = `{pins,bans}`, matches); B7 (`'sweet treat'`/`'grain'` normalization — documented intent, spec §"Vocabulary"); B5/B6 (weak/missing minor test assertions); B8/E7 (read-only neutral renders nothing; null-role flash — cosmetic); B1/B2/B3 (real concerns but in adjacent **7-s15** code, out of scope here — see note below); E2 (single-pin daily-repeat — intended "prefer, never starve"); E3/E8/E11 (benign untested boundaries); E9 (false — error IS cleared at next edit start).

> **Adjacent 7-s15 flag (out of scope for 3-s42, surfaced for the 7-s15 review):** `handleIdentityComposite` builds `currentKeys` from `cultural.active` only but `nextKeys` from the full chip set — opt_in/forget delta is fragile if `IdentityEditValue.cultural` omits suggested chips; cultural PATCH failures + a failed reconcile GET leave changed chips shown as saved behind a generic error; `handleFavoritesComposite` revert uses a render-time `prevMap` closure. Verify in the 7-s15 review.

## Dev Notes

### Headline: this is a small story (no migration, no contract)

The temptation will be to build a new "snack rules" table/route/contract. **Don't.** Everything backend already exists from Story 3.21 + 3-s40. The only API-layer change is the **pure function** edit in `snack-rotation.service.ts`. Everything else is web + tests. Every changed line should trace to (a) honoring pins, or (b) the kitchen-profile editor.

### Design decisions (baked in; recommended defaults — flag if you disagree)

These were the three open questions in the slice definition (proposal §5.2 + D-3S40-CR7). Defaults are chosen and specced above; rationale here.

1. **Pin semantics = "prefer" (bias, best-effort), not "force ≥1 day" or "force every day".**
   - "Force every day" collides with no-adjacent-repeat, multiple pins, and variety — and starves when a pinned category has one SKU. "Force ≥1 day" needs cross-day bookkeeping for marginal value. "Prefer" is deterministic, composes cleanly with existing ban + adjacency logic, and never starves a day. It satisfies the demo ("always include fruit" → fruit dominates that child's days).

2. **Shared-slot model retained; the proposal's 3-s42 demo "B still can" is reframed.** 3-s40 assigns **one snack SKU per day shared by all snack-ON children** (`SnackSlotAssignment { day, snack_sku_id, child_ids[] }`), with bans applied as a conservative union (a ban by *any* child removes that category for the shared slot — already implemented & tested at `snack-rotation.service.test.ts:206`). The literal proposal demo ("ban dairy for A → A never gets dairy; **B still can**") is **not achievable** without per-child snack slots, which would require changing the plan tree + `commit_plan` model — out of scope for an editing-surface slice. Reframed behavior: *"ban dairy for A → the family's shared snack is never dairy on days A has a snack."* Conservative-union bans are the correct safety posture anyway. **Surface this to Menon** (see below).

3. **Vocabulary: reuse, do not fork.** The editor must write the **same tokens** `ExtraRulesForm.tsx` writes — `['fruit','veggie','grain','protein','dairy','sweet treat']` — because `extra_rules` is a single field shared by Extra composition and snack rotation. The rotation service already bridges `'veggie'`→`'vegetable'` via `normalizeCategory`. Introducing a snack-only enum (`SnackCategorySchema`: `vegetable`/`other`) into this field would split it (`veggie` vs `vegetable`, `sweet treat` vs `other`) and corrupt the Extra-planner read. Consequence: banning `'sweet treat'` affects only Extras (no snack SKU has that category); banning `'fruit'/'grain'/'protein'/'dairy'/'veggie'` affects both. This is acceptable and honest.

### Reading initial state (kitchen-map projection)

`kitchen-map.composer.ts:212-215` projects `extra_rules: { pinned: row.extra_rules.pins, banned: row.extra_rules.bans }` onto each child. So the kitchen-profile page (which already loads the full kitchen-map) has per-child rules client-side — **no new fetch needed**. Note the **rename**: composer exposes `pinned`/`banned`; the PATCH body needs `pins`/`bans`. Map at the boundary.

**Verification step:** confirm the web `KitchenMap`/`KitchenMapChild` contract type actually surfaces `extra_rules` (the composer projects it, but the Zod contract schema must include it for the web type to see it). If the schema omits it, the clean fix is to add `extra_rules: { pinned: string[], banned: string[] }` to `KitchenMapChildSchema` (coordinated contracts+api+web change in one PR per project-context schema rule) — preferable to a per-child `GET /v1/children/:id/extra-rules` round-trip. Decide based on what the schema actually contains.

### Editor implementation guidance

- **Prefer mirroring the kitchen-profile optimistic handler pattern** (`handleAddAllergen` / `reconcileChildAllergens`) over reusing the `useExtraRules` hook. `useExtraRules` eagerly loads the **extra-library** (`GET /v1/households/:id/extra-library`) on mount — irrelevant to pins/bans and an extra network call per card. The direct PATCH + optimistic-revert pattern is the established kitchen-profile idiom and integrates with the existing per-card busy/error threading.
- 3-state control: a category is `pin` | `ban` | `neutral`. Selecting pin clears ban and vice-versa (mirrors `ExtraRulesSchema` mutual-exclusion). The full rules object sent to PATCH is the union across all categories' states (full-replacement semantics — `UpdateExtraRulesInputSchema = ExtraRulesSchema`, the route replaces the whole `{pins,bans}`).
- Forward-only: copy the existing reassurance "Lumi will use these for next week." Do not imply the current committed plan changes.

### Critical correctness notes (disaster prevention)

- **Full-replacement PATCH.** `PATCH /v1/children/:id/extra-rules` replaces the **entire** `{pins, bans}`. Always send the complete current state, never a partial diff, or you'll wipe the other category's selections.
- **Pin⊕ban exclusivity is enforced server-side** by `ExtraRulesSchema.refine` (a token in both arrays → 400). Enforce it client-side too so the user never hits a 400.
- **Bans run before pins in rotation.** Keep that order (`eligibleSkus` → pin-narrow → adjacent-repeat → pick). Reordering could let a pinned-but-(other-child-)banned category slip through.
- **Determinism is load-bearing.** The 3-s40 determinism test asserts identical output for identical inputs. The pin narrowing is pure set-membership on already-sorted candidates — keep it free of `Date.now()`/`Math.random()`.
- **Do not touch `findActiveForHousehold` / `in_stock` / adjacency logic.** Out of scope; they work.

### Key files

| File | Change |
|---|---|
| `apps/api/src/services/snack-rotation.service.ts` | MODIFIED — `buildPinnedCategories` + per-day pin narrowing |
| `apps/api/src/services/snack-rotation.service.test.ts` | MODIFIED — 6 pin cases |
| `apps/web/src/features/kitchen-profile/components/ChildProfileCard.tsx` | MODIFIED — pins/bans editor in `SafetyAndBagColumn` + optional `onSetExtraRules` props |
| `apps/web/src/routes/(app)/kitchen-profile.tsx` | MODIFIED — `reconcileChildExtraRules` + `handleSetExtraRules` (optimistic) + state threading |
| `apps/web/src/routes/(app)/kitchen-profile.test.tsx` (and/or a card test) | MODIFIED/NEW — AC6 cases |
| `packages/contracts/src/*kitchen-map*` + `packages/types` | MODIFIED **only if** `KitchenMapChildSchema` lacks `extra_rules` (verify first) |

### What NOT to build (out of scope)

- No new migration, no new table/column, no new contract file, no new audit event type, no new repository method (AC5).
- No per-child snack **slots** / per-child snack assignment (shared-slot model retained — decision #2).
- No allergen logic on pins/bans (that is 7-s14 / 3-s43).
- No `SnackCategorySchema` in the `extra_rules` field (decision #3).
- No Extra-library editing in the card (the standalone `ExtraRulesForm`/`child-extra-rules.tsx` page already covers library CRUD; leave it).
- Do not refactor `ExtraRulesForm.tsx` or migrate its v1 tokens — untouched.

### Previous story intelligence

- **3-s40 (done):** Shipped `assignSnackRotation` with ban-only honoring; explicitly deferred pins as **D-3S40-CR7**. Determinism test + conservative shared-slot ban union are established and must keep passing.
- **3-s41 (review):** Added `archived_at`, `created_by_household_id`, family add/remove, `in_stock`. The rotation test fixture (`sku(...)`) already carries `archived_at`/`created_at`/`in_stock`/`allergen_tags`/`dietary_tags`/`upc_code`/`package_type` — reuse it; don't recreate.
- **7-s14 / 7-s15 (done):** Established the kitchen-profile deterministic + optimistic edit pattern this story mirrors (`handleAddAllergen`, `reconcileChildAllergens`, per-card busy/error, `role="alert"`). 7-s15 patch P1 (partial chip-state failures must not be swallowed — inspect `Promise.allSettled`, surface a threaded error) is the precedent for AC4's revert-on-catch + error surfacing.
- **Stale-token warning:** project-context.md γ-migration banner — production kitchen-profile is v2.0 tokens (`text-fg-*`); `ExtraRulesForm.tsx` is pre-γ v1. Copy the card's tokens, not the form's.

### References

- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-06-20-snack-skus.md §6 (3-s42 slice definition); §5.2 (rotation policy open question)]
- [Source: _bmad-output/implementation-artifacts/deferred-work.md (D-3S40-CR7 — pins not honored; define semantics here)]
- [Source: apps/api/src/services/snack-rotation.service.ts:38-144 (buildBannedCategories, eligibleSkus, per-day pick — mirror for pins)]
- [Source: apps/api/src/services/snack-rotation.service.test.ts (sku factory + ban tests to mirror for pins)]
- [Source: apps/api/src/agents/orchestrator.ts:70-75 (PlannerExtraRules: child_id, child_name, pins, bans)]
- [Source: supabase/migrations/20260800000000_add_extra_rules_and_extra_library.sql:5-6 (children.extra_rules JSONB default {"pins":[],"bans":[]})]
- [Source: apps/api/src/modules/children/children.routes.ts:292-361 (PATCH/GET /v1/children/:id/extra-rules — requirePrimaryParent; audit child.extra_rules_updated)]
- [Source: apps/api/src/modules/children/extra-rules.repository.ts:11-94 (updateExtraRules / findExtraRules)]
- [Source: packages/contracts/src/extra-rules.ts:9-31,63-66 (ExtraRulesSchema, Update/Get schemas, pin⊕ban refine)]
- [Source: apps/api/src/modules/kitchen-map/kitchen-map.composer.ts:212-215 (extra_rules → {pinned, banned} projection)]
- [Source: apps/web/src/routes/(app)/kitchen-profile.tsx:113-164,337-351 (handleAddAllergen / reconcileChildAllergens / ChildProfileCard wiring — mirror)]
- [Source: apps/web/src/features/kitchen-profile/components/ChildProfileCard.tsx:117-199 (SafetyAndBagColumn — editor home; `editable` gating idiom)]
- [Source: apps/web/src/features/children/ExtraRulesForm.tsx:15-22,55-73 (component-type vocab + pin/ban toggle logic — reuse vocab, NOT tokens)]
- [Source: apps/web/src/hooks/useExtraRules.ts:87-114 (saveRules PATCH wrapper — reference, prefer direct optimistic handler)]
- [Source memory: snacks-as-household-skus, kitchen-profile-edit-architecture, kitchen-map-cache-trigger-gap, three-slot-weighted-structure]

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (bmad-dev-story workflow)

### Debug Log References

- `vitest run src/services/snack-rotation.service.test.ts` → 21/21 pass (15 prior + 6 new pin cases).
- `vitest run "src/routes/(app)/kitchen-profile.test.tsx"` → 19/19 pass (14 prior + 5 new AC6 cases).
- `pnpm --filter @hivekitchen/web typecheck` → clean. `pnpm --filter @hivekitchen/api typecheck` → clean.
- Web feature/route sweep (`src/features/kitchen-profile src/routes`) → 107/107 pass.
- `vitest run src/services` (api) → 2 failures in `memory-context.service.test.ts` (node_type column assertion) — **pre-existing baseline, unrelated to this story** (file untouched; snack-rotation 21/21 within the same run).

### Completion Notes List

- **AC1/AC2 (pins honored).** Added pure `buildPinnedCategories` (mirrors `buildBannedCategories`, normalizes each pin via the existing `normalizeCategory`). Per-day narrowing runs **after** ban-filtering and **before** the no-adjacent-repeat filter, with "prefer" semantics: narrow to pinned-category SKUs only when ≥1 eligible match exists, else no-op. Never empties a day; determinism preserved (pure set-membership on already-sorted candidates, no `Date.now()`/`Math.random()`). Closes **D-3S40-CR7**.
- **Pin-vs-ban precedence** is structural: bans filter first, so a pinned-but-(other-child-)banned category yields zero `preferred` SKUs and falls back. Covered by the cross-child pin+ban test (ban wins).
- **AC3 (editor).** New `ExtraRulesEditor` + `ToggleChip` inside `ChildProfileCard.tsx`, rendered in `SafetyAndBagColumn` below "Lunch bag". Labeled **"Snack & Extra preferences"** (governs both systems). Vocabulary reuses `['fruit','veggie','grain','protein','dairy','sweet treat']` (same tokens `ExtraRulesForm` writes — no fork). 3-state neutral/pin/ban with client-side mutual exclusion (pin clears ban, vice-versa). v2.0 card tokens only (`text-fg`, `text-fg-muted`, `bg-surface-2`, `border-foliage`, `text-safety-red`) — no v1 `stone-*`/`amber-600`/`bg-white`. Fully controlled by `extraRules` prop; read-only (state labels, no toggles) when `onSetExtraRules` absent.
- **AC4 (optimistic wiring).** `reconcileChildExtraRules` pure helper (mirrors `reconcileChildAllergens`) maps PATCH-body `{pins,bans}` → projection `{pinned,banned}`. `handleSetExtraRules` does optimistic local mutation → `PATCH /v1/children/:id/extra-rules` → reconcile from parsed `UpdateExtraRulesResponse.extra_rules` → revert to `prevMap` on catch → per-child busy/error cleared in `finally`. Error surfaced with `role="alert"`. Forward-only copy: "Lumi will use these for next week."
- **Role gating (AC3).** `onSetExtraRules` is passed only when `auth user.role === 'primary_parent'`; non-primary roles get read-only chips (no toggles, no PATCH). Mirrors the route's `requirePrimaryParent`.
- **AC5 verified — zero backend changes.** `KitchenMapChildSchema` already carries `extra_rules: { pinned, banned }` (contracts `kitchen-map.ts:83-86`) and the composer already projects it — **no contract/type/migration change needed**. Reused the existing PATCH route, `ExtraRulesSchema`, `child.extra_rules_updated` audit, and the `children` kitchen_map_version trigger.

### File List

- `apps/api/src/services/snack-rotation.service.ts` — MODIFIED: `buildPinnedCategories` + per-day pin narrowing.
- `apps/api/src/services/snack-rotation.service.test.ts` — MODIFIED: 6 pin cases.
- `apps/web/src/features/kitchen-profile/components/ChildProfileCard.tsx` — MODIFIED: `extraRules`/`onSetExtraRules`/busy/error props + `ExtraRulesEditor` + `ToggleChip` in `SafetyAndBagColumn`.
- `apps/web/src/routes/(app)/kitchen-profile.tsx` — MODIFIED: `reconcileChildExtraRules` + `handleSetExtraRules` (optimistic) + role gating + state threading into `ChildProfileCard`.
- `apps/web/src/routes/(app)/kitchen-profile.test.tsx` — MODIFIED: 5 AC6 cases.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — MODIFIED: status ready-for-dev → in-progress → review.
- `_bmad-output/implementation-artifacts/3-s42-per-child-snack-rules.md` — MODIFIED: tasks checked, Dev Agent Record, Status.

## Change Log

| Date | Change |
|---|---|
| 2026-06-20 | Implemented 3-s42: honored `extra_rules.pins` in `assignSnackRotation` with "prefer" semantics (closes D-3S40-CR7) + per-child Snack & Extra preferences editor in `ChildProfileCard` (optimistic, primary-parent-gated). No migration/contract/audit/repo changes. Status → review. |
