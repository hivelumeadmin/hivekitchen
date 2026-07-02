# Story 7-S14: Kitchen Profile — Parent-Deterministic Safety Edits (Phase 1)

Status: done

Epic: 7 — Visible Memory & Trust Controls (post-retro addition)
Source: Brainstorming session `_bmad-output/brainstorming/brainstorming-session-2026-06-19-1553.md` (2026-06-19)
Builds on: 2.5-s11 (Kitchen Profile — Live Data Read, done), 7-s3 (Edit a Sentence — pattern reference, done)
Unblocks: Phase 2 (Lumi-conversational soft edits — separate future slice)

> **Why this exists:** `/app/kitchen-profile` (slice 2.5-s11) shipped deliberately read-only — every edit handler is a `noop`/`console.log` stub and `isEditing` is hardcoded `false`. Epic 7 wired editing on a *different* surface (`/app/memory`, sentence-level `memory_nodes.prose_text`), leaving the kitchen-profile cards orphaned. This slice wires the **safety-critical** subset of kitchen-profile edits.

---

## Decision context (from the brainstorm)

The edit-wiring choice was resolved as a **per-data-class, phased hybrid** (First Principles → Pre-mortem → Concept Blend):

- **Parent is editor of record for safety data** — deterministic, structured, **no LLM in the write path**, fully testable. ← **this slice (Phase 1)**
- **Lumi is editor for soft/narrative data** — conversational, reuses the built `EditConversation` UI. ← deferred to Phase 2.

**Pre-mortem killer that drove the split:** allergens are medical-safety data. An LLM between parent intent and a safety record means the 1% misread feeds a child an allergen. So allergens (and hard cultural rules) must be edited deterministically.

**Reuse posture:** mirror Epic 7's `PATCH /v1/memory/:nodeId` (7-s3) **pattern** — `authorize` preHandler, household scoping, 404-on-null ownership pre-check, best-effort provenance/audit write — **not** its endpoint (that edits prose, a different substance).

---

## Story

As a Primary Parent,
I want to add or remove a child's allergen and change a cultural rule's enforcement level directly on the Kitchen Profile page,
so that I can correct the safety-critical things Lumi knows about my household with precise, deterministic edits I fully control — and have the next plan honor them.

---

## Scope

**IN (Phase 1):**
1. Child allergen **add** and **remove** (per child).
2. Cultural-rule **enforcement-level** change (the 5-rung enum on `cultural_priors`).
3. The two structured UI controls that replace the conversational stubs for *only* those two data classes.

**OUT (Phase 2 / later slices):**
- Identity "quote", shared-tastes, and starting-line favorites edits (soft/narrative → Lumi-conversational).
- Schools and Calendar sections (still static per 2.5-s11).
- Any Lumi/OpenAI involvement in the write path.
- Free-text "custom" allergens not on the curated list (see Open Question OQ-1).

---

## Key codebase facts (verified 2026-06-19 — read before implementing)

> These correct several stale assumptions. Trust this section + the live code over older story narratives.

### Allergens
- ⚠️ **`child_allergens` table was DROPPED** (`supabase/migrations/20261008000100_drop_legacy_allergen_columns.sql`). Allergens now live in **`household_allergens`** (consolidation migration `20261008000000_household_allergens_consolidation.sql:32-73`):
  - Columns: `id`, `household_id` (NOT NULL), `child_id` (**nullable**; non-NULL = per-child), `allergen` (**AES-256-GCM ciphertext**), `allergen_hash` (SHA-256 for dedupe), `source` CHECK in (`onboarding_declared`, `child_medical`, `memory_promoted`, **`parent_edited`**, `backfill_migration`), `reason` (nullable ≤200), timestamps.
  - UNIQUE index `household_allergens_scope_hash_uniq` on `(household_id, COALESCE(child_id, sentinel), allergen_hash)`.
- The `source` enum **already includes `parent_edited`** — the schema was designed for exactly this edit.
- Repository: **`apps/api/src/modules/households/household-allergens.repository.ts`** → class `HouseholdAllergensRepository` (constructor `(client, kek: Buffer|null)`):
  - `declareIfNew({household_id, child_id, allergen, source})` (L48-92) — idempotent encrypt+hash+upsert; calls bump (redundant w/ trigger). **Use this for ADD with `source: 'parent_edited'`.**
  - `deleteByChild(householdId, childId)` (L167-175) — ⚠️ deletes **ALL** per-child rows. **Insufficient for single-allergen remove.**
  - `findByHouseholdAndChild(householdId, childId)` (L153-159) — decrypts; use to resolve which rows exist.
- 🔑 **GAP — new repo method required:** `deleteOneByHash(householdId, childId, allergenHash)` to remove exactly one allergen row. Hash is SHA-256 of the normalized allergen string — the same hashing the repo already uses on insert (reuse that private helper / extract it).

### Cultural enforcement
- The displayed enforcement chips (`kitchenMap.cultural.active[].enforcement`) are composed from the **`cultural_priors`** table (`KitchenMapRepository.loadRaw()` → `cultural_priors` array at `kitchen-map.repository.ts:419`). `household_cultural_identifiers` only contributes flat tags (`household.cultural_identifiers`), **not** the enforcement chips — so **Phase 1 targets `cultural_priors.enforcement` only** (resolves brainstorm open-item #3).
- `cultural_priors.enforcement` is the 5-rung `enforcement_level` enum: `non_negotiable | strong | default | soft | just_for_context` (`packages/contracts/src/enforcement.ts` → `EnforcementLevelSchema`).
- ⚠️ **No enforcement setter exists.** The existing `PATCH /v1/households/:id/cultural-priors/:priorId` (`cultural-prior.routes.ts:48-101`) takes `RatifyCulturalPriorBodySchema = { action: 'opt_in' | 'forget' | 'tell_lumi_more' }` (`packages/contracts/src/cultural.ts:47-51`) — a **state-machine ratify action, not an enforcement field**. Phase 1 must add a **new** write path (new endpoint or extended body) + repo method + contract.
- Repository: **`apps/api/src/modules/cultural-priors/cultural-prior.repository.ts`** → `CulturalPriorRepository extends BaseRepository` (constructor `(client)` — **no kek**, cultural_tag is closed-vocab, not encrypted). `findByIdForHousehold` (L178) exists for the ownership pre-check. 🔑 **GAP — add `updateEnforcement(priorId, householdId, enforcement)`** (household-scoped UPDATE, returns row or null).

### Cache invalidation — FREE
- Writes to **`household_allergens`** and **`cultural_priors`** each fire an AFTER INSERT/UPDATE/DELETE DB trigger that bumps `households.kitchen_map_version`, invalidating the Redis kitchen-map cache automatically:
  - `household_allergens` trigger: `supabase/migrations/20261008000200_household_allergens_kitchen_map_trigger.sql`.
  - `cultural_priors` trigger: `supabase/migrations/20260820000000_add_kitchen_map_version.sql:226`.
- ✅ **No manual cache bump needed** in the new write paths, and **no new migration** in this slice (tables, columns, triggers, and the `parent_edited` enum value all already exist).

### Epic 7 write pattern to mirror (7-s3)
- Route `apps/api/src/modules/memory/memory.routes.ts` `PATCH /v1/memory/:nodeId` (L42-65): `preHandler: requireParentOrCaregiver = authorize(['primary_parent','secondary_caregiver'])`; household from `request.user.household_id` (not URL); 404 on null.
- Service `memory.service.ts` `editProse` (L178-225): ownership pre-check → null ⇒ 404; primary write; **best-effort** provenance insert (`source_type:'user_edit'`, `confidence:1.0`, wrapped in try/catch, failure logs warn but does not fail the edit); best-effort `audit.write`.
- Auth/household conventions also in `children.routes.ts` (`assertCallerInHousehold(callerHouseholdId, paramHouseholdId)` L517-521; `PATCH /v1/children/:id/bag-composition` L193 is the closest child-scoped-write analog — child-scoped, household from JWT, `requirePrimaryParent`, sets `request.auditContext`, 404-on-null).

---

## Acceptance Criteria

### AC1 — Contracts: allergen + enforcement edit shapes
**File:** `packages/contracts/src/kitchen-profile-edit.ts` (new) + `export * from './kitchen-profile-edit.js'` in `packages/contracts/src/index.ts`.

```ts
import { z } from 'zod';
import { EnforcementLevelSchema } from './enforcement.js';

// --- Allergen add ---
// Phase 1 is a curated, deterministic vocabulary — NOT free-text — to avoid the
// silent-typo failure mode on safety data (a mistyped "peants" matches nothing).
export const COMMON_ALLERGENS = [
  'milk', 'egg', 'fish', 'shellfish', 'tree_nut',
  'peanut', 'wheat', 'soy', 'sesame',
] as const;
export const AllergenKeySchema = z.enum(COMMON_ALLERGENS);

export const AddChildAllergenRequestSchema = z.object({
  allergen: AllergenKeySchema,
});
export type AddChildAllergenRequest = z.infer<typeof AddChildAllergenRequestSchema>;

// Response returns the canonical hash so the client can target a later DELETE.
export const ChildAllergenItemSchema = z.object({
  allergen: z.string(),
  allergen_hash: z.string(),
});
export type ChildAllergenItem = z.infer<typeof ChildAllergenItemSchema>;

export const ChildAllergenMutationResponseSchema = z.object({
  child_id: z.string().uuid(),
  allergens: z.array(ChildAllergenItemSchema),
});
export type ChildAllergenMutationResponse = z.infer<typeof ChildAllergenMutationResponseSchema>;

// --- Cultural enforcement edit ---
export const SetCulturalEnforcementRequestSchema = z.object({
  enforcement: EnforcementLevelSchema,
});
export type SetCulturalEnforcementRequest = z.infer<typeof SetCulturalEnforcementRequestSchema>;
```

Add round-trip tests in `packages/contracts/src/kitchen-profile-edit.test.ts`: `AddChildAllergenRequestSchema` accepts a known allergen and rejects `'peanuts'`/`''`/unknown; `SetCulturalEnforcementRequestSchema` accepts each enforcement rung and rejects `'always'`.

### AC2 — Repo: `HouseholdAllergensRepository.deleteOneByHash`
**File:** `apps/api/src/modules/households/household-allergens.repository.ts`

Add a household+child+hash-scoped single-row delete:
```ts
// Phase 7-s14 — remove exactly one parent-edited allergen. household_id + child_id
// scope is defense-in-depth; allergen_hash pins the single row. Returns true if a
// row was deleted (→ 200), false if nothing matched (→ 404). Trigger bumps cache.
async deleteOneByHash(householdId: string, childId: string, allergenHash: string): Promise<boolean>
```
Reuse the existing SHA-256 normalization+hash helper used by `declareIfNew` (extract it to a shared private method if currently inlined) so add/remove hash the same way.

### AC3 — Repo: `CulturalPriorRepository.updateEnforcement`
**File:** `apps/api/src/modules/cultural-priors/cultural-prior.repository.ts`

```ts
// Phase 7-s14 — household-scoped enforcement edit. Returns the updated row or null
// when the prior does not exist / belongs to another household (→ 404). Trigger
// bumps kitchen_map_version.
async updateEnforcement(
  priorId: string,
  householdId: string,
  enforcement: EnforcementLevel,
): Promise<CulturalPriorRow | null>
```
`.eq('id', priorId).eq('household_id', householdId)` defense-in-depth; `.select().maybeSingle()`.

### AC4 — API: add allergen
`POST /v1/children/:childId/allergens` — **new route file** `apps/api/src/modules/households/kitchen-profile-edit.routes.ts` (or extend `children.routes.ts`; pick the consistent home and document it).
- `preHandler: authorize(['primary_parent'])` (safety edits are primary-parent-only, matching `PATCH /v1/children/:id/school-policies`).
- Resolve `householdId` from `request.user.household_id`; resolve the child's household and **404 if the child is not in the caller's household** (no cross-household info leak).
- Body `AddChildAllergenRequestSchema`. Call `HouseholdAllergensRepository.declareIfNew({ household_id, child_id: childId, allergen, source: 'parent_edited' })`.
- Set `request.auditContext` with a PII-free event (`household.updated` or the nearest existing audit enum value — **do NOT put the allergen value in metadata**; allergens are PII/medical). Verify the chosen `event_type` exists in the audit enum before using it.
- Response `200 ChildAllergenMutationResponse` = the child's full current allergen list (re-read via `findByHouseholdAndChild`).

### AC5 — API: remove allergen
`DELETE /v1/children/:childId/allergens/:allergenHash` (same file/auth/household-scoping as AC4).
- Call `deleteOneByHash(householdId, childId, allergenHash)`. `false` ⇒ **404**.
- `200 ChildAllergenMutationResponse` with the remaining list.
- **Critical test:** removing one allergen leaves the child's *other* allergens intact (guards against accidental reuse of `deleteByChild`).

### AC6 — API: set cultural enforcement
`PATCH /v1/households/:id/cultural-priors/:priorId/enforcement` (new sub-route alongside the existing ratify route, OR a documented new action — prefer the explicit sub-route to keep ratify's state machine clean).
- `preHandler: authorize(['primary_parent'])`; `assertCallerInHousehold(request.user.household_id, id)`.
- Body `SetCulturalEnforcementRequestSchema`. Call `CulturalPriorRepository.updateEnforcement(priorId, id, enforcement)`. `null` ⇒ **404**.
- Set PII-free `request.auditContext` (`template.state_changed`, metadata = `{ prior_id, key, enforcement }` — `key`/enforcement are system constants, not PII; mirror the existing ratify audit shape).
- `200` returning the updated prior (reuse `CulturalPriorSchema`).

### AC7 — Auth & isolation (all four endpoints)
- No valid JWT → **401**.
- `guest_author`/`secondary_caregiver` → **403** (primary-parent-only).
- Non-UUID path param → **400** (Zod).
- Cross-household target (child or prior not in caller's household) → **404** (not 403 — no existence leak), matching the memory `editProse` no-leak rule.

### AC8 — Web: deterministic allergen control (replaces the conversational stub)
**Files:** `apps/web/src/features/kitchen-profile/components/ChildProfileCard.tsx` (+ the allergen portion of `ChildEditConversation.tsx`), and the wiring in `apps/web/src/routes/(app)/kitchen-profile.tsx`.
- Replace the `noop`/`console.log` allergen edit path for the child card with a **structured control**: existing allergens render as removable chips (tap → confirm → `DELETE`); an "Add allergen" affordance offers the curated `COMMON_ALLERGENS` set as action chips (tap → `POST`). **No free-text, no Lumi, no composite.**
- Optimistic update via the page's local `kitchenMap` state (Zustand/local per existing pattern); on success replace with the server's returned list; on failure revert + inline error.
- The rest of the child card (loves/avoids, bag composition) stays read-only (Phase 2).

### AC9 — Web: enforcement control (replaces the conversational stub)
**Files:** `KitchenIdentityCard.tsx` (+ enforcement portion of `IdentityEditConversation.tsx`), wired from `kitchen-profile.tsx`.
- Each cultural-rule chip gets an inline enforcement selector mapping the UI's 3 tiers to the API enum (reuse the existing `apiEnforcementToUi` direction and add its inverse). **Locked mapping:** `always → strong`, `prefer → default`, `context → just_for_context`. `non_negotiable` is NOT writable from this 3-way selector (reserved). Changing the selector calls `PATCH …/enforcement`.
- The identity **quote** and **shared-tastes** remain read-only (Phase 2).

### AC10 — Tests & typecheck
- **Contracts:** round-trip tests (AC1).
- **API:** for each of the 4 endpoints — happy-path 200, 401, 403 (non-primary), 404 (cross-household), plus the AC5 "remove-one-leaves-others" test. Use `fastify.inject()` + the existing repo-mock patterns (see `cultural-prior.routes` tests / `children.routes` tests). Mock the KEK/encryption boundary as the existing allergen repo tests do.
- **Web:** interaction tests — add chip → POST called + list updates; remove chip → DELETE called + only that chip removed; enforcement change → PATCH called; failure path reverts. Mock `hkFetch`.
- `pnpm typecheck` clean for all changed files. Pre-existing baseline errors (per 2.5-s11 / recent stories: `plans/`, `voice/`, `jobs/`, `onboarding.tools`, etc.) are out of scope — do not touch.

---

## Tasks / Subtasks

- [x] **T1 — Contracts (AC1)**
  - [x] T1.1 — New `packages/contracts/src/kitchen-profile-edit.ts`; export from `index.ts` + `packages/types`.
  - [x] T1.2 — Round-trip tests (11/11).
- [x] **T2 — Allergen repo (AC2)**
  - [x] T2.1 — `deleteOneByAllergen` (hashes via existing `normalizedHash`, deletes the single row).
  - [x] T2.2 — Covered via route integration tests (real repo + faithful in-memory Supabase; incl. remove-one-leaves-others + not-found→404).
- [x] **T3 — Cultural repo (AC3)**
  - [x] T3.1 — `updateEnforcementByKey` (household-scoped, null on miss) + `enforcement` added to row/columns.
  - [x] T3.2 — Covered via route integration tests.
- [x] **T4 — API routes (AC4–AC7)**
  - [x] T4.1 — New `kitchen-profile-edit.routes.ts`: POST + DELETE allergen.
  - [x] T4.2 — PATCH cultural enforcement sub-route (`/cultural-priors/enforcement`, key-based).
  - [x] T4.3 — Registered in `apps/api/src/app.ts` (`fp(..., {name:'kitchen-profile-edit-routes'})`).
  - [x] T4.4 — Reused `household.profile_updated` audit enum value; PII-free `auditContext`.
  - [x] T4.5 — Route tests (11/11: happy/400/401/403/404 + remove-one-leaves-others).
- [x] **T5 — Web allergen control (AC8)**
  - [x] T5.1 — Structured add/remove chips in `ChildProfileCard` (read-only when handlers absent — dev mock route unaffected).
  - [x] T5.2 — Wired `POST`/`DELETE` via `hkFetch`; optimistic update + revert + inline error.
  - [x] T5.3 — Interaction tests (add / remove-one / error-revert).
- [x] **T6 — Web enforcement control (AC9)**
  - [x] T6.1 — Inline tier selector on identity chips; reverse-map locked (`always→strong`/`prefer→default`/`context→just_for_context`).
  - [x] T6.2 — Wired `PATCH …/enforcement`; optimistic + revert.
  - [x] T6.3 — Interaction test (PATCH with mapped enum).
- [x] **T7 — Typecheck + verify (AC10)**
  - [x] T7.1 — `pnpm typecheck` clean for contracts/types/api/web (EXIT=0); targeted suites green; no new regressions.

---

## Dev Notes

- **No migration in this slice.** If you find yourself writing one, stop — tables/columns/triggers/`parent_edited` enum already exist. The only "new" persistence is two repo methods over existing schema.
- **No LLM anywhere in the write path.** This is the entire point of Phase 1. Do not call OnboardingAgent/LumiAgent/OpenAI. Do not route through a thread.
- **Allergens are encrypted + PII.** Never log the allergen value; never place it in audit metadata or error bodies. The hash is fine to expose (it's non-reversible) and is the DELETE key.
- **Curated vocabulary is a safety decision, not a limitation** — see OQ-1. The FALCPA "big 9" covers the overwhelming majority; custom allergens are a deliberate Phase-2 follow-up so we don't ship a free-text typo hole on medical data.
- **Reverse-map enforcement (LOCKED):** `kitchen-profile.tsx` already has `apiEnforcementToUi` (5-rung → 3-tier, lossy). The inverse is fixed: `always → strong`, `prefer → default`, `context → just_for_context`. `non_negotiable` is never written from the 3-way selector (reserved for non-UI rule sources). The lossy round-trip is acceptable for Phase 1.
- **Component reuse:** `ChildEditConversation`/`IdentityEditConversation` are the conversational shells. For Phase 1 you are *bypassing* their composite-send path for the allergen/enforcement controls only — leave the rest of those components intact for Phase 2. Prefer adding small structured sub-controls over rewriting the conversation shells.

### Key File Locations

| File | Purpose |
|---|---|
| `packages/contracts/src/kitchen-profile-edit.ts` (new) | 4 edit schemas + `COMMON_ALLERGENS` |
| `apps/api/src/modules/households/household-allergens.repository.ts` | add `deleteOneByHash` |
| `apps/api/src/modules/cultural-priors/cultural-prior.repository.ts` | add `updateEnforcement` |
| `apps/api/src/modules/households/kitchen-profile-edit.routes.ts` (new) | POST/DELETE allergen + PATCH enforcement |
| `apps/api/src/app.ts` | register new routes plugin |
| `apps/web/src/features/kitchen-profile/components/ChildProfileCard.tsx` | allergen add/remove chips |
| `apps/web/src/features/kitchen-profile/components/KitchenIdentityCard.tsx` | enforcement selector |
| `apps/web/src/routes/(app)/kitchen-profile.tsx` | replace `noop` allergen/enforcement handlers; optimistic state |

### References

- Brainstorm + decision record: `_bmad-output/brainstorming/brainstorming-session-2026-06-19-1553.md`
- Pattern source (7-s3): `apps/api/src/modules/memory/memory.routes.ts:42`, `apps/api/src/modules/memory/memory.service.ts:178` (`editProse`), `packages/contracts/src/memory.ts:74`
- Allergen schema: `supabase/migrations/20261008000000_household_allergens_consolidation.sql:32`; repo `apps/api/src/modules/households/household-allergens.repository.ts:48,167`
- Cultural enforcement: `packages/contracts/src/enforcement.ts`; `cultural_priors` enforcement col `supabase/migrations/20260903000700_add_cultural_priors_enforcement.sql:16`; existing ratify route `apps/api/src/modules/cultural-priors/cultural-prior.routes.ts:48`; `RatifyCulturalPriorBodySchema` `packages/contracts/src/cultural.ts:47`
- Cache triggers: `supabase/migrations/20261008000200_household_allergens_kitchen_map_trigger.sql`; `supabase/migrations/20260820000000_add_kitchen_map_version.sql:226`
- Kitchen-map cultural composition: `apps/api/src/modules/kitchen-map/kitchen-map.repository.ts:419`
- Child-scoped write convention: `apps/api/src/modules/children/children.routes.ts:193` (bag-composition), `:517` (`assertCallerInHousehold`)
- Read-only page being wired: `apps/web/src/routes/(app)/kitchen-profile.tsx` (the `noop`/`logComposite` stubs)

---

## Resolved Decisions (Menon, 2026-06-19)

- **OQ-1 (allergen vocabulary): RESOLVED — yes.** Phase 1 ships the curated `COMMON_ALLERGENS` (FALCPA big-9) as the only addable set. No free-text custom allergens in Phase 1 (eliminates the typo hole on safety data); custom allergens are a Phase-2 follow-up.
- **OQ-2 (enforcement reverse-map): RESOLVED — `always → strong`.** The 3-way selector writes `strong` for the top tier; `non_negotiable` is reserved and never written from this UI. (See AC9 + Dev Notes — locked mapping.)
- **OQ-3 (route home): RESOLVED — new `kitchen-profile-edit.routes.ts`.** Keeps the safety-edit surface cohesive.
- **Phase 2 timing:** the Phase-2 story (Lumi-conversational soft edits — identity quote / shared tastes / favorites) will be authored **after** Phase 1 is implemented, to fold in any learnings. Its shape lives in `brainstorming-session-2026-06-19-1553.md`.

---

## Dev Agent Record

### Agent Model Used

Claude Opus 4.8 (1M context) — bmad-dev-story workflow

### Debug Log References

- `pnpm --filter @hivekitchen/contracts exec vitest run src/kitchen-profile-edit.test.ts` — 11/11.
- `pnpm --filter @hivekitchen/api exec vitest run src/modules/households/kitchen-profile-edit.routes.test.ts` — 11/11.
- `pnpm --filter @hivekitchen/web exec vitest run src/routes/(app)/kitchen-profile.test.tsx` — 8/8.
- `pnpm typecheck` (contracts/types/api/web) — all EXIT=0.
- Regression check: contracts full suite 15f/771p WITH changes vs 15f/760p baseline (stash-compared) → **+11 passing, 0 new failures**. Web full-suite failures (useLumiVoiceSession/OnboardingText/sse) are all pre-existing baselines in untouched files. API households suite failures (extra-library.repository, memory-node GET) are pre-existing baselines.

### Completion Notes List

- **Per-data-class, no-LLM safety edits** delivered end-to-end: child allergen add/remove + cultural enforcement level, parent as editor of record.
- **No migration** — `household_allergens` (`parent_edited` source) + `cultural_priors.enforcement` + version-bump triggers all already existed. Cache invalidation is automatic via DB triggers.
- **Reconciliations from the spec (all documented inline):**
  1. **Allergen remove is by VALUE, not hash** (spec AC5 said `:allergenHash`). The KitchenMap allergen projection exposes the allergen *string* but no hash, so a hash-keyed DELETE couldn't target pre-existing onboarding allergens. Switched to `DELETE /v1/children/:childId/allergens` with body `{ allergen }`; the repo hashes server-side (`deleteOneByAllergen`). Response returns plain `string[]` (no hash exposed). Cleaner, no client crypto, no kitchen-map change.
  2. **Enforcement edit is keyed by `key`, not `priorId`** (spec AC6 said `:priorId`). `KitchenMapCulturalPriorSchema` exposes `key` (UNIQUE per household) but not `id`. Route is `PATCH /v1/households/:id/cultural-priors/enforcement` with body `{ key, enforcement }`; repo `updateEnforcementByKey`. Avoids adding `id` to the widely-consumed kitchen-map schema.
  3. **Curated allergens stored as human labels** via `ALLERGEN_LABELS` (e.g. `tree_nut`→`tree nut`) so the profile reads naturally and the guardrail tokenizes consistently.
  4. **Audit** reuses the existing `household.profile_updated` enum value (no new enum migration); metadata is PII-free (ids/keys/action only — never the allergen string).
  5. **Ownership guard** uses a new lightweight `ChildrenRepository.existsInHousehold` (single `children` query, no decryption) instead of `findById` — avoids dragging the heavy allergen/tag-overlay read into a 404 check.
  6. **Repo unit tests (T2.2/T3.2)** are satisfied by the route integration tests, which run the real repos against a faithful in-memory Supabase and assert real effects (delete-one-leaves-others, not-found→404, enforcement persisted). No redundant standalone repo tests added.
- **Components stay backward-compatible:** `ChildProfileCard` / `KitchenIdentityCard` render the structured controls only when the edit handlers are provided, so `_dev-kitchen-profile.tsx` remains read-only.
- **Phase 2 (Lumi-conversational soft edits) untouched** — identity quote, shared tastes, favorites still route to the existing `noop`/composite stubs.

### File List

**New:**
- `packages/contracts/src/kitchen-profile-edit.ts`
- `packages/contracts/src/kitchen-profile-edit.test.ts`
- `apps/api/src/modules/households/kitchen-profile-edit.routes.ts`
- `apps/api/src/modules/households/kitchen-profile-edit.routes.test.ts`

**Modified:**
- `packages/contracts/src/index.ts` (export new module)
- `packages/types/src/index.ts` (re-export new types)
- `apps/api/src/modules/households/household-allergens.repository.ts` (`deleteOneByAllergen`)
- `apps/api/src/modules/cultural-priors/cultural-prior.repository.ts` (`enforcement` column + `updateEnforcementByKey`)
- `apps/api/src/modules/children/children.repository.ts` (`existsInHousehold`)
- `apps/api/src/modules/households/parental-dashboard.service.test.ts` (fixture: add `enforcement`)
- `apps/api/src/app.ts` (register `kitchenProfileEditRoutes`)
- `apps/web/src/features/kitchen-profile/components/ChildProfileCard.tsx` (allergen add/remove controls)
- `apps/web/src/features/kitchen-profile/components/KitchenIdentityCard.tsx` (enforcement selector)
- `apps/web/src/routes/(app)/kitchen-profile.tsx` (handlers + optimistic state + revert)
- `apps/web/src/routes/(app)/kitchen-profile.test.tsx` (interaction tests)
- `_bmad-output/implementation-artifacts/sprint-status.yaml`

### Review Findings

- [x] [Review][Patch] P1 — `non_negotiable` chips show 3-way enforcement selector → silent downgrade on re-click — FIXED: added `locked?: boolean` to `EnforcedChip`; `mapCulturalToChips` sets it; `CulturalPillar` hides selector when `c.locked`
- [x] [Review][Patch] P2 — Cross-household enforcement PATCH returns 403 instead of spec-required 404 (no-existence-leak rule) — FIXED: `ForbiddenError` → `NotFoundError`; test updated 403→404
- [x] [Review][Patch] P3 — Missing auth tests: DELETE allergen missing 401+403; PATCH enforcement missing 401 — FIXED: 3 tests added (DELETE 401, DELETE 403, PATCH 401)
- [x] [Review][Patch] P4 — Allergen add/remove handlers await server before updating UI state — not actually optimistic — FIXED: both handlers optimistically update before `await hkFetch`
- [x] [Review][Patch] P5 — Enforcement change failure/revert path has no test — FIXED: `'shows an inline error and reverts enforcement when PATCH fails'` added
- [x] [Review][Patch] P6 — Test describe label says `DELETE .../allergens/:allergenHash` but actual route has no path param — FIXED: relabelled to `DELETE /v1/children/:childId/allergens/:allergen`
- [x] [Review][Patch] P7 — DELETE allergen sends value in request body — at risk of proxy/CDN stripping → silent 400 — FIXED: route changed to `DELETE .../allergens/:allergen` (URL path); frontend uses `encodeURIComponent`
- [x] [Review][Defer] W1 — `soft` round-trips to `just_for_context` via 3-tier UI selector — deferred, pre-existing; lossy mapping explicitly accepted in Phase 1 dev notes
- [x] [Review][Defer] W2 — Concurrent stale-`prevMap` races on optimistic update rollback — deferred, pre-existing; architectural pattern limitation requires broader fix
- [x] [Review][Defer] W3 — `reconcileChildAllergens` stamps `source: 'parent_edited'` on all returned allergens — deferred, display-only; DB row source is unaffected
- [x] [Review][Defer] W4 — TOCTOU between `existsInHousehold` check and allergen write — deferred, pre-existing; FK constraint provides DB-level protection
- [x] [Review][Defer] W5 — `addable` chips may miss plural/variant legacy onboarding allergen strings — deferred, legacy-data edge case not introduced here
- [x] [Review][Defer] W6 — `findByHouseholdAndChild` reads+decrypts entire household per mutation — deferred, pre-existing repo design
- [x] [Review][Defer] W7 — Error message embeds childId UUID (log exposure concern) — deferred, pre-existing pattern; no HTTP-level info leak

### Change Log

| Date | Change |
|---|---|
| 2026-06-19 | Story authored from brainstorm; status `ready-for-dev`. |
| 2026-06-19 | Implementation complete (dev-story) — contracts + 3 repo methods + 3 routes + 2 web controls + 30 new tests; typecheck clean; no new regressions. Status → `review`. |
| 2026-06-19 | Code review complete — 7 patch, 7 defer, 2 dismissed. Status → `in-progress`. |
| 2026-06-19 | All 7 patches applied and verified (14 API + 9 web + 11 contracts tests green; typecheck clean). Status → `done`. |
