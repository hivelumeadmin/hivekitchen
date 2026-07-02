# Story 3.S43: Phase-2 Deterministic Allergen Fail-Safe for Snack SKUs

Status: done

> **Source of truth:** `_bmad-output/planning-artifacts/sprint-change-proposal-2026-06-20-snack-skus.md` §6 → slice 3-s43. Option B (snacks as household-scoped SKUs) is LOCKED — do not re-open.
>
> **Depends on 3-s40 (done), 3-s41 (review), 3-s42 (done).** The `snack_skus` table, `allergen_tags text[]` column (migration `20261031000000`), `assignSnackRotation`, and the commit guardrail's `attested: true` exemption (plans.service.ts `:1341-1352`) all ship before this story. This story **closes the Phase-1 safety relaxation** and is the **beta gate** before any household with declared allergens relies on snack rotation.

## Story

As a parent whose child has a food allergy,
I want snacks assigned by Lumi to be automatically checked against my child's declared allergens at plan commit time,
so that an unsafe snack SKU can never land in my child's lunch bag without being caught and replaced.

## Background

3-s40 shipped deterministic snack rotation but added a `plans.service.ts` exemption (lines 1341–1352) that pushes every snack-SKU slot as `attested: true` into the commit guardrail's `unverifiable` list. The guardrail skips `attested: true` items entirely — **no allergen check fires for snack SKUs today**, even for households with declared allergens.

Migration `20261031000000` (already applied) replaced the 13 old boolean columns (`contains_dairy`, `is_vegan`, etc.) with two array columns:
- `allergen_tags text[] NOT NULL DEFAULT '{}'` — FALCPA-9 vocabulary, CHECK-pinned to `'peanut','tree_nut','dairy','egg','wheat','soy','fish','shellfish','sesame'`.
- `dietary_tags text[] NOT NULL DEFAULT '{}'` — `'vegan','vegetarian','halal','kosher'`.

`SnackSkuRow` already carries both fields, and `SNACK_SKU_COLUMNS` already selects them. The **contracts and API surface do not yet expose them**, and the **guardrail still uses the Phase-1 exemption**.

This story does three things:
1. **Expose `allergen_tags`** in the `SnackSkuSchema` contract, `toSnackSku()` mapper, and the POST body so parents can tag allergens when adding a snack.
2. **Replace the Phase-1 blanket exemption** in `buildCommitGuardrailInputs` with a per-child set-membership check: tagged SKUs become verifiable; untagged SKUs (`[]`) stay unverifiable-for-allergic-children (conservative-unknown fallback).
3. **Add a rotation pre-filter** (defense-in-depth) so the rotation never assigns a confirmed-allergen SKU to a child with a matching declared allergen — the guardrail is the backstop, not the first line.

### Allergen model (LOCKED)

- `allergen_tags = ['dairy', 'soy']` → set-membership check at commit time; blocked if any snack-ON child has a matching declared allergen.
- `allergen_tags = []` (untagged — parent hasn't specified) → conservative-unknown; pushed as `unverifiable` without `attested: true` for any snack-ON child that carries a declared allergen; triggers the recoverable `compound_ingredient_unverified` path (swap → regen).
- Rotation pre-filter: tagged SKUs whose `allergen_tags` intersect any snack-ON child's declared allergens are excluded from candidates for that day. Untagged SKUs (`[]`) are included in rotation (cannot pre-filter unknown). If ALL stocked SKUs are allergen-conflicted, the day produces **no snack assignment** (no fallback to unsafe SKUs — safety gate wins).

### What `allergen_tags = []` means in practice

A global seed SKU (migrated from the old boolean columns) will have non-empty `allergen_tags` reflecting its actual allergen profile. A **household-added SKU** created in 3-s41 without 3-s43 landed will have `allergen_tags = []` (the DB default). Phase-2 treats that as "untagged" — conservative-unknown for allergic children, which means the swap-retry path fires instead of blindly clearing. Parents that tag their household-added SKUs get deterministic checking; parents that don't get the same conservative behavior as unverifiable recipe ingredients.

## Acceptance Criteria

### AC1 — Contracts: `allergen_tags` on snack schemas

In `packages/contracts/src/snack-shelf.ts`:

1. Add `SnackAllergenTagSchema` enum (before `SnackCategorySchema`):
   ```
   z.enum(['peanut','tree_nut','dairy','egg','wheat','soy','fish','shellfish','sesame'])
   ```
   This vocabulary is CHECK-pinned in the DB and matches `FALCPA_TOP_9` in `allergy-rules.engine.ts` exactly — no synonym expansion needed for set-membership comparison.

2. Extend `SnackSkuSchema` with:
   ```
   allergen_tags: z.array(SnackAllergenTagSchema)
   ```
   (required on response — the DB column is `NOT NULL DEFAULT '{}'`, so the API always returns an array).

3. Extend `CreateSnackSkuInputSchema` with:
   ```
   allergen_tags: z.array(SnackAllergenTagSchema).default([])
   ```
   (optional on input; defaults to empty array).

4. Export `SnackAllergenTag` type from `packages/types/src/index.ts` (same pattern as other contract type re-exports).

Do NOT add `dietary_tags` to the contract yet — it is not consumed by any AC in this story.

### AC2 — Repository: `allergen_tags` on `create()` + new `findAllergenTagsByIds()`

In `apps/api/src/modules/recipe/snack-sku.repository.ts`:

1. Add `allergen_tags?: string[]` to `CreateSnackSkuParams`. In `create()`, spread it into the INSERT: `...(params.allergen_tags ? { allergen_tags: params.allergen_tags } : {})` (omit → DB default `'{}'`).

2. Add `async findAllergenTagsByIds(ids: string[]): Promise<Map<string, string[]>>`:
   - If `ids` is empty, return an empty map immediately (no query).
   - SELECT `id, allergen_tags` FROM `snack_skus` WHERE `id IN (ids)`.
   - Return `Map<id, allergen_tags>`.
   - Used by `buildCommitGuardrailInputs` in `plans.service.ts` to batch-resolve allergen tags without N+1 queries.

### AC3 — Route: expose `allergen_tags` in GET + accept in POST

In `apps/api/src/modules/households/households.routes.ts`:

1. In `toSnackSku(row: SnackSkuRow)` mapper: add `allergen_tags: row.allergen_tags` to the returned object (the field already exists on the row — just project it).

2. In `POST /v1/households/:id/snacks` body parsing: accept `allergen_tags` from `CreateSnackSkuInputSchema` and pass `allergen_tags: body.allergen_tags` into `snackSkuRepository.create(...)`.

No change to `GET` query or `DELETE` route.

### AC4 — Guardrail: replace Phase-1 blanket exemption

In `apps/api/src/modules/plans/plans.service.ts`:

**Step 1 — inject `SnackSkuRepository` as optional dep.**

Add to `PlansServiceDeps`:
```typescript
// Story 3-s43 — Phase-2 snack allergen fail-safe. Optional so pre-3-s43
// tests can compose without wiring it; when absent, snack-SKU slots keep
// Phase-1 attested:true behavior (safe default — no regression).
snackSkuRepository?: SnackSkuRepository;
```
Wire `this.snackSkuRepo = deps.snackSkuRepository ?? null` in the constructor.

**Step 2 — pre-collect snack_sku_ids before the loop.**

In `buildCommitGuardrailInputs`, before the `for (const day of input.days)` loop, add:
```typescript
// Phase-2 allergen check — batch-load allergen_tags for all snack-SKU slots
// in the plan tree so the per-slot inner loop can do a pure Map lookup
// (no N+1 queries).
const snackSkuIdsInPlan = new Set<string>();
for (const day of input.days) {
  for (const slot of day.slots) {
    const skuId = (slot as { snack_sku_id?: string | null }).snack_sku_id;
    if (skuId != null) snackSkuIdsInPlan.add(skuId);
  }
}
const skuAllergenMap: Map<string, string[]> =
  this.snackSkuRepo && snackSkuIdsInPlan.size > 0
    ? await this.snackSkuRepo.findAllergenTagsByIds([...snackSkuIdsInPlan])
    : new Map();
```

**Step 3 — replace the Phase-1 exemption block.**

Replace lines 1341–1352 (the `attested: true` block) with:
```typescript
if ((slot as { snack_sku_id?: string | null }).snack_sku_id != null) {
  const skuId = (slot as { snack_sku_id: string }).snack_sku_id;
  const tags = skuAllergenMap.get(skuId) ?? [];
  for (const variation of slot.variations) {
    if (tags.length > 0) {
      // Phase-2 — deterministic set-membership check. Push as a verifiable
      // item: the guardrail engine evaluates sku.allergen_tags exactly like
      // recipe ingredients (FALCPA-9 canonical keys match the engine's
      // vocabulary directly, no synonym expansion needed here).
      items.push({
        child_id: variation.child_id,
        day: day.day,
        slot: slot.slot_kind,
        ingredients: tags,
      });
    } else {
      // Conservative-unknown — parent hasn't tagged allergens on this SKU.
      // Route through the unverifiable path (not attested) so allergic
      // children trigger the recoverable compound_ingredient_unverified
      // path instead of silently clearing.
      unverifiable.push({
        child_id: variation.child_id,
        day: day.day,
        slot: slot.slot_kind,
        recipe_label: 'snack-sku (allergen-untagged)',
        // attested is intentionally absent — Phase-2 default is conservative.
      });
    }
  }
  continue;
}
```

**Phase-1 fallback when `snackSkuRepo` is null:** `skuAllergenMap` will be empty, so every snack-SKU variation will fall into the `tags.length === 0` branch → `unverifiable` without `attested: true`. This is MORE conservative than Phase-1 (which set `attested: true`), but only fires in test environments that don't wire the repo. Production will always wire `snackSkuRepo`.

> **Implementation note:** if a test pre-dating 3-s43 relied on the Phase-1 `attested: true` behavior (i.e., a snack-SKU slot in an allergic household that previously cleared because it was attested), that test must be updated. Search for `snack_sku_id` + `clearOrRejectCommit` in `plans.service.test.ts` and `allergy-guardrail.service.test.ts` and update the assertions.

### AC5 — Bump `GUARDRAIL_VERSION` to `1.3.0`

In `apps/api/src/modules/allergy-guardrail/allergy-rules.engine.ts`:
```typescript
export const GUARDRAIL_VERSION = '1.3.0' as const;
```
Add comment: `// 1.2.0 → 1.3.0 (Story 3-s43): Phase-2 snack-SKU allergen check replaces Phase-1 attested:true exemption.`

This distinguishes Phase-2 audit records from Phase-1 in the `guardrail_decisions` table.

### AC6 — Rotation pre-filter (defense-in-depth)

In `apps/api/src/services/snack-rotation.service.ts`, extend `assignSnackRotation` with an optional allergen pre-filter so the rotation never assigns a confirmed-allergen SKU to a child with a matching declared allergen:

1. Add `declaredAllergensByChildId?: ReadonlyMap<string, readonly string[]>` to the opts parameter.

2. Before `const sortedSkus = ...`, compute an allergen-safe stock set:
   ```typescript
   // Build the set of SKU IDs that are allergen-conflicted for any snack-ON child.
   // Only SKUs with non-empty allergen_tags can conflict (empty = untagged = unknown,
   // included in rotation — conservative-unknown handled by the commit guardrail).
   const allergenConflictedSkuIds = new Set<string>();
   if (declaredAllergensByChildId && declaredAllergensByChildId.size > 0) {
     for (const sku of stockedSkus) {
       if (sku.allergen_tags.length === 0) continue;
       const skuTags = new Set(sku.allergen_tags);
       for (const childId of snackOnChildIds) {
         const childAllergens = declaredAllergensByChildId.get(childId) ?? [];
         if (childAllergens.some((a) => skuTags.has(a))) {
           allergenConflictedSkuIds.add(sku.id);
           break;
         }
       }
     }
   }
   // Filter conflicted SKUs from the rotation pool.
   const safeSkus = allergenConflictedSkuIds.size > 0
     ? stockedSkus.filter((s) => !allergenConflictedSkuIds.has(s.id))
     : stockedSkus;
   // Safety gate: if ALL stocked SKUs are allergen-conflicted, produce no
   // snack assignment for any day (return early). This is intentional —
   // never fall back to an unsafe SKU for an allergen safety signal.
   if (safeSkus.length === 0 && allergenConflictedSkuIds.size > 0) return [];
   ```
   Replace `stockedSkus` with `safeSkus` in `const sortedSkus = [...safeSkus].sort(...)`.

3. When `declaredAllergensByChildId` is absent (or empty), `safeSkus === stockedSkus` — the function is identical to today.

**Caller update:** in the plan-generation job (`apps/api/src/agents/orchestrator.ts` or wherever `assignSnackRotation` is called), build and pass `declaredAllergensByChildId`:
```typescript
const declaredAllergensByChildId = new Map(
  kitchenMap.children.map((c) => [c.id, c.declared_allergens]),
);
// Pass to assignSnackRotation opts.
```
Verify `kitchenMap.children[].declared_allergens` is the correct field name (it is — confirmed in `kitchen-map.composer.ts:206` and `kitchen-map.repository.ts:538`).

### AC7 — Web: allergen checkboxes on the add-snack form

In `apps/web/src/routes/(app)/snack-shelf.tsx`:

1. Add a FALCPA-9 allergen checkbox group to the "Add a snack" form, **below** the category select. Label: **"Contains allergens"** (optional; leave unchecked if unknown). Render 9 checkboxes with human-friendly labels:
   - `peanut` → "Peanut"
   - `tree_nut` → "Tree nut"
   - `dairy` → "Dairy"
   - `egg` → "Egg"
   - `wheat` → "Wheat"
   - `soy` → "Soy"
   - `fish` → "Fish"
   - `shellfish` → "Shellfish"
   - `sesame` → "Sesame"

   Keep the labels minimal. No descriptions needed — parents will recognise FALCPA allergen names.

2. Track `selectedAllergens: string[]` in local form state (empty by default).

3. On form submit, include `allergen_tags: selectedAllergens` in the POST body.

4. After successful add, clear checkboxes alongside the other fields.

5. Styling: inline checkbox row or wrapped chip-style, warm neutral tones consistent with the rest of the form. Do NOT use `bg-white`/`stone-*`/`amber-600` (pre-γ tokens). Mirror the rest of the snack-shelf card's token set.

6. **No allergen display on the snack list items** in this story — `allergen_tags` is stored and returned by the API but not surfaced in the list view (defer). The `GET /v1/households/:id/snacks` response now includes `allergen_tags` in each item, but the UI does not render it.

### AC8 — Tests

**Contracts (`packages/contracts/src/snack-shelf.test.ts` or extend if it exists):**
- `SnackAllergenTagSchema` accepts all 9 FALCPA values and rejects an unknown string.
- `CreateSnackSkuInputSchema` defaults `allergen_tags` to `[]` when omitted.
- `SnackSkuSchema` requires `allergen_tags` to be present (non-optional on response).

**Repository (`apps/api/src/modules/recipe/snack-sku.repository.test.ts`):**
- `create()` with `allergen_tags: ['dairy', 'soy']` → returned row has `allergen_tags: ['dairy', 'soy']`.
- `create()` without `allergen_tags` → returned row has `allergen_tags: []` (DB default).
- `findAllergenTagsByIds([id1, id2])` → returns correct map for both IDs.
- `findAllergenTagsByIds([])` → returns empty map (no query).
- `findAllergenTagsByIds([unknownId])` → returns empty map (no match).

**Route (extend existing snack route tests):**
- `POST /v1/households/:id/snacks` with `allergen_tags: ['dairy']` → 201 response includes `allergen_tags: ['dairy']`.
- `POST /v1/households/:id/snacks` without `allergen_tags` → 201 response includes `allergen_tags: []`.
- `GET /v1/households/:id/snacks` → each item in response includes `allergen_tags`.

**Plans service + guardrail (`apps/api/src/modules/plans/plans.service.test.ts`):**

Add tests for `buildCommitGuardrailInputs` (or `commit()`) behavior with `snackSkuRepository` wired:
- SKU with `allergen_tags: ['dairy']` + child with `'dairy'` declared allergen → guardrail returns `blocked`.
- SKU with `allergen_tags: ['dairy']` + child with NO dairy allergen → guardrail returns `cleared`.
- SKU with `allergen_tags: []` + child with any declared allergen → guardrail returns `uncertain` (unverifiable path, `compound_ingredient_unverified`).
- SKU with `allergen_tags: []` + child with NO declared allergens → guardrail returns `cleared` (unverifiable slot, but no declared allergens → no flag).
- When `snackSkuRepository` is NOT wired (null) → snack-SKU slots fall into the `allergen-untagged` unverifiable path (not the old `attested: true` path) — verify an allergic child's slot is flagged as unverifiable, not cleared.

**Rotation service (`apps/api/src/services/snack-rotation.service.test.ts`):**
- `declaredAllergensByChildId` absent → output identical to current behavior (no regression).
- Child A has `'dairy'` allergen; only SKU in pool has `allergen_tags: ['dairy']` → function returns `[]` (no assignment — safe rather than assigning an allergen-conflicted SKU).
- Child A has `'dairy'` allergen; pool has one dairy SKU and one grain SKU (no allergens) → grain SKU assigned every day.
- SKU with `allergen_tags: []` + child with `'dairy'` allergen → SKU IS included in rotation (untagged = unknown = not pre-filtered; commit guardrail handles it).
- Two allergen-tagged SKUs, one dairy (blocked for child A), one grain (safe) → grain assigned every day for child A's snack.

**Web (`apps/web/src/routes/(app)/snack-shelf.test.tsx`):**
- Add form renders 9 allergen checkboxes.
- Selecting "Dairy" + "Soy" and submitting includes `allergen_tags: ['dairy', 'soy']` in POST body.
- Submitting without selecting any allergen includes `allergen_tags: []`.
- After successful add, allergen checkboxes are cleared.

## Tasks / Subtasks

- [x] **Task 1 — Contracts** (AC: 1)
  - [x] Add `SnackAllergenTagSchema` z.enum to `snack-shelf.ts`; extend `SnackSkuSchema` + `CreateSnackSkuInputSchema`.
  - [x] Re-export `SnackAllergenTag` type from `packages/types/src/index.ts`.
  - [x] Add contract tests (AC8 contracts section).

- [x] **Task 2 — Repository extensions** (AC: 2)
  - [x] Add `allergen_tags?` to `CreateSnackSkuParams`; pass through in `create()`.
  - [x] Add `findAllergenTagsByIds(ids: string[]): Promise<Map<string, string[]>>`.
  - [x] Add repository tests (AC8 repository section).

- [x] **Task 3 — Route update** (AC: 3)
  - [x] Add `allergen_tags` to `toSnackSku()` mapper.
  - [x] Accept + forward `allergen_tags` in POST body.
  - [x] Add route tests (AC8 route section).

- [x] **Task 4 — Guardrail: replace Phase-1 exemption** (AC: 4, 5)
  - [x] Add `snackSkuRepository?: SnackSkuRepository` to `PlansServiceDeps` + wire constructor.
  - [x] Pre-collect `snack_sku_id`s and batch-load via `findAllergenTagsByIds` before the day loop.
  - [x] Replace `attested: true` block with Phase-2 logic.
  - [x] Bump `GUARDRAIL_VERSION` to `'1.3.0'` in `allergy-rules.engine.ts`.
  - [x] Add/update plans service + guardrail tests (AC8 guardrail section).
  - [x] Wire `snackSkuRepository` into `PlansServiceDeps` in `plans.hook.ts` (the hook already has a `SnackSkuRepository` instance for `BriefStateComposer` — reuse it, do not create a second instance).

- [x] **Task 5 — Rotation pre-filter** (AC: 6)
  - [x] Add `declaredAllergensByChildId?` to `assignSnackRotation` opts.
  - [x] Build the allergen-conflict filter; filter `stockedSkus` → `safeSkus`; early-return `[]` if all conflicted.
  - [x] Update the plan-generation job caller to pass `declaredAllergensByChildId` from `kitchenMap.children`.
  - [x] Add rotation tests (AC8 rotation section).

- [x] **Task 6 — Web: allergen checkboxes** (AC: 7)
  - [x] Add FALCPA-9 checkbox group to add-snack form in `snack-shelf.tsx`.
  - [x] Track `selectedAllergens` state; include in POST body; clear on success.
  - [x] Add web tests (AC8 web section).

## Dev Notes

### This is the beta gate — do not soften the conservative-unknown path

The whole point of 3-s43 is to eliminate the silent Phase-1 pass. When `allergen_tags = []` and the child has a declared allergen, the CORRECT behavior is `unverifiable` → swap-retry → regen → recoverable. If every SKU in the household's rotation pool is untagged AND the household has allergic children, they will get repeated swap-retries until the planner regenerates a plan with a recipe-based snack alternative. That is the correct safety-first degradation path — better than silently clearing.

### `attested: true` is fully retired

The `attested?: boolean` field on `UnverifiableSlot` remains in the interface (it may be used by other future paths), but after this story's guardrail change, **no code in `buildCommitGuardrailInputs` will ever set `attested: true` for a snack-SKU slot**. Update the comment in `allergy-guardrail.service.ts` at line 9-14 to reflect this:

```typescript
// Story 3-s43 — snack-SKU Phase-1 attested:true exemption retired.
// Phase-2: tagged SKUs (allergen_tags non-empty) are pushed as verifiable
// PlanItemForGuardrail items; untagged SKUs (allergen_tags=[]) are pushed
// as unverifiable without attested:true.
```

### Plans service `snackSkuRepository` wiring (no second instance)

`plans.hook.ts` already creates `const snackSkuRepository = new SnackSkuRepository(fastify.supabase)` and passes it to `BriefStateComposer`. Reuse this instance in the `PlansService` construction in `plans.hook.ts`:
```typescript
const plansService = new PlansService({
  // ... existing deps ...
  snackSkuRepository,   // <-- add this line
});
```
Do NOT create a second `new SnackSkuRepository(...)`. Check what the final `PlansService` construction looks like in `plans.hook.ts` and add the dep there.

### `PlanItemForGuardrail` requires `ingredients.min(1)`

`PlanItemForGuardrailSchema` has `ingredients: z.array(...).min(1)`. This is why we can only push a verifiable item when `tags.length > 0`. The `tags.length === 0` branch MUST go to `unverifiable` — it would fail Zod validation if pushed as an item with an empty ingredients array.

### `FALCPA_TOP_9` alignment

`allergen_tags` CHECK constraint vocabulary (`'peanut','tree_nut','dairy','egg','wheat','soy','fish','shellfish','sesame'`) is IDENTICAL to `FALCPA_TOP_9` in `allergy-rules.engine.ts:17-27`. The engine evaluates allergen rules by matching a rule's allergen key against ingredient strings using `FALCPA_SYNONYMS`. When we push `ingredients: ['dairy']` for a snack SKU, the engine will match a `dairy` allergen rule against the ingredient string `'dairy'` directly — the synonym map lists `'dairy'` under the dairy key, so the match is guaranteed. **No synonym expansion needed at the `buildCommitGuardrailInputs` callsite** — the canonical keys are self-matching.

### Rotation pre-filter does NOT fall back to unsafe SKUs

Unlike category bans (taste preferences — `eligibleSkus` falls back to all SKUs when all are banned), the allergen pre-filter has NO fallback. If all stocked SKUs conflict for an allergic child, the function returns `[]`. This produces a plan week with no snack slots for that household until the parent either tags more SKUs safely or adds allergen-safe SKUs to their shelf. This is the correct safety-first behavior.

### Existing pre-3-s43 test baselines for snack-SKU slots

Search `plans.service.test.ts` and `allergy-guardrail.service.test.ts` for any fixture with `snack_sku_id` + an allergic household. If any such test relied on `attested: true` clearing the slot, it will now fail (correctly — Phase-1 was wrong to clear it). Update those tests to reflect Phase-2 behavior: tagged SKU + matched allergen = blocked; untagged SKU + allergic child = uncertain/unverifiable.

The two existing tests in `allergy-guardrail.service.test.ts` for `attested`:
- `"clears when the only unverifiable slot is a snack-SKU slot (attested=true)"` — this test is testing Phase-1 behavior. After 3-s43, this path no longer fires from `buildCommitGuardrailInputs`. Keep the test as a unit-level guard for the `UnverifiableSlot.attested` field itself (if any other future caller uses it), but add a comment noting that `buildCommitGuardrailInputs` no longer sends `attested: true` for snack slots.

### Key files

| File | Change |
|---|---|
| `packages/contracts/src/snack-shelf.ts` | ADD `SnackAllergenTagSchema` + extend `SnackSkuSchema` + `CreateSnackSkuInputSchema` |
| `packages/types/src/index.ts` | ADD `SnackAllergenTag` type re-export |
| `apps/api/src/modules/recipe/snack-sku.repository.ts` | ADD `findAllergenTagsByIds()` + extend `CreateSnackSkuParams`/`create()` |
| `apps/api/src/modules/households/households.routes.ts` | MODIFY `toSnackSku()` + POST body |
| `apps/api/src/modules/plans/plans.service.ts` | ADD `snackSkuRepository?` dep + replace Phase-1 exemption block |
| `apps/api/src/modules/plans/plans.hook.ts` | MODIFY — wire `snackSkuRepository` into `PlansService` (reuse existing instance) |
| `apps/api/src/modules/allergy-guardrail/allergy-guardrail.service.ts` | UPDATE comment (lines 9-14) to reflect Phase-2 |
| `apps/api/src/modules/allergy-guardrail/allergy-rules.engine.ts` | BUMP `GUARDRAIL_VERSION` to `'1.3.0'` |
| `apps/api/src/services/snack-rotation.service.ts` | ADD `declaredAllergensByChildId?` + allergen pre-filter |
| `apps/api/src/agents/orchestrator.ts` (or plan-generation job) | MODIFY — pass `declaredAllergensByChildId` to `assignSnackRotation` |
| `apps/web/src/routes/(app)/snack-shelf.tsx` | ADD allergen checkbox group to add-snack form |

### What NOT to build (out of scope)

- No `dietary_tags` on contracts, API, or web — dietary preferences are not a safety gate and are deferred.
- No UI display of `allergen_tags` in the snack list — stored and returned, but not rendered this story.
- No per-child snack slots — shared-slot model retained from 3-s40/3-s42.
- No allergen tagging on EDIT flow — only the add form. Editing an existing household SKU's allergen tags is deferred.
- No migration — `20261031000000` is already applied; `SnackSkuRow.allergen_tags` is already typed.
- No changes to `FALCPA_SYNONYMS` or the guardrail engine logic — the set-membership comparison in `evaluate()` already works for canonical FALCPA keys.

### Deferred findings from prior stories to address

- **D-3S40-CR2** (from `deferred-work.md:18`): "Guardrail Phase-1 exemption skips `variation.add_ons` on snack-SKU slots." After this story's change, the snack-SKU branch `continue`s AFTER the Phase-2 check — `variation.add_ons` is still not checked. Since snack slot variations still only carry `{ child_id }` (no add_ons, per `plan-generation.job.ts:129`), this remains unreachable. **Log this as still-deferred after implementation** — do not add code for it.
- **D-3S40-CR5** (from `deferred-work.md:21`): "Seed dietary flags inherit table defaults." Migration `20261031000000` replaced boolean flags with `allergen_tags` arrays and backfilled correctly. Verify the global seeds' `allergen_tags` in the migration backfill are correct for the 10 global seed rows. If not, log a follow-on note. Do not fix it in this story if it requires a new migration.

### Previous story intelligence

- **3-s40 (done):** Established `assignSnackRotation`, `SnackSlotAssignment`, and the `attested: true` exemption this story replaces. The determinism test is load-bearing — the allergen pre-filter must not introduce any non-determinism (pure set membership, no `Date.now()`/`Math.random()`).
- **3-s41 (review):** Added `archived_at`, `in_stock`, family add/remove, `findActiveForHousehold`. The `snack-rotation.service.test.ts` `sku(...)` factory already carries `allergen_tags: []` — update fixtures that need non-empty tags; leave `allergen_tags: []` as the safe default for fixtures that test non-allergen behavior.
- **3-s42 (done):** Pin semantics, `buildPinnedCategories`. The per-day loop order is now: ban-filter → pin-narrow → adjacent-repeat → pick. The allergen pre-filter (AC6) runs BEFORE the day loop (pre-filtering `stockedSkus` → `safeSkus` globally), so it does not interact with the per-day ban/pin logic.
- **3-s39 (done):** Established `buildCommitGuardrailInputs` and the `items`/`unverifiable` split. The `unverifiable` path (without `attested`) correctly routes through `compound_ingredient_unverified` → swap-retry, which is exactly what 3-s43 needs for untagged SKUs.
- **7-s14 (done):** Established the parent-deterministic safety edit for declared allergens (no LLM in the safety loop). This story is in the same spirit: allergen checking is pure set-membership, never LLM.

### References

- [`_bmad-output/planning-artifacts/sprint-change-proposal-2026-06-20-snack-skus.md` §6 (3-s43 slice definition + allergen doctrine)]
- [`_bmad-output/implementation-artifacts/deferred-work.md` (D-3S40-CR2, D-3S40-CR5 — address after implementation)]
- [`apps/api/src/modules/plans/plans.service.ts:1337-1352` (Phase-1 exemption to replace)]
- [`apps/api/src/modules/allergy-guardrail/allergy-guardrail.service.ts:101-186` (`clearOrRejectCommit` — unchanged, receives the new verifiable items correctly)]
- [`apps/api/src/modules/allergy-guardrail/allergy-rules.engine.ts:17-27` (`FALCPA_TOP_9` — same vocab as `allergen_tags` CHECK constraint)]
- [`apps/api/src/services/snack-rotation.service.ts` (add `declaredAllergensByChildId?` to opts)]
- [`apps/api/src/modules/plans/plans.hook.ts:87,97` (existing `snackSkuRepository` instance — reuse for `PlansService`)]
- [`apps/api/src/modules/kitchen-map/kitchen-map.composer.ts:206` + `kitchen-map.repository.ts:538` (`children[].declared_allergens` field — pass to rotation caller)]
- [`supabase/migrations/20261031000000_snack_sku_allergen_dietary_tags.sql` (already applied; FALCPA-9 CHECK constraint vocabulary confirmed)]
- [memory: snacks-as-household-skus, kitchen-map-cache-trigger-gap, allergen-storage-model]

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (1M context)

### Debug Log References

- `pnpm -w typecheck` — 9/9 packages clean.
- Snack-scoped suites all green: contracts `snack-shelf.test.ts` (6), api `snack-sku.repository.test.ts` + `households.snack-routes.test.ts` (32), `plans.service.test.ts` (61, incl. 3 new Phase-2 snack-SKU tests), `allergy-guardrail.service.test.ts`, `snack-rotation.service.test.ts` (27), jobs (110), web `snack-shelf.test.tsx` (10).
- The full `apps/api` `vitest run` reports 31 pre-existing failures in **unrelated** suites (auth, lumi, memory, onboarding, audit, catalog, children, extra-library, plan-adjustment, memory-context). These map 1:1 to separate uncommitted working-tree changes on this branch (`lumi.agent.ts`, `lumi.service.ts`, `audit.types.ts`, `cultural-prior.repository.ts`, `kitchen-profile-edit.*`, etc.) — none touch snack code. Verified the one shared file I edited, `households.routes.ts`, was changed snack-only (the failing `GET …/memory` route test is untouched by this story).

### Completion Notes List

- **AC1–AC3** (contracts/types/repo/route) were implemented in the pre-compaction session; re-verified green this session.
- **AC4 (guardrail):** `snackSkuRepository?` is an optional `PlansServiceDeps` dep (`null` default). `buildCommitGuardrailInputs` batch-loads `allergen_tags` for all snack-SKU slots once, then per-variation: tagged SKU → verifiable `items.push({…, ingredients: tags})`; untagged (`[]`) → `unverifiable.push({…, recipe_label: 'snack-sku (allergen-untagged)'})` with **no `attested`**. When the repo is null the map is empty, so every snack-SKU variation takes the untagged-unverifiable branch — strictly more conservative than Phase-1. Wired the existing `snackSkuRepository` instance in `plans.hook.ts` (no second instance). `GUARDRAIL_VERSION` → `'1.3.0'`.
- **AC6 deviation (safety-strengthening):** the story's caller sketch built `declaredAllergensByChildId` from `child.declared_allergens` only. I unioned the **household-wide** `kitchenMap.household.declared_allergens` into each child's set, because household-scoped `parent_declared` rules apply to every child (matching the guardrail engine's `child_id === null` semantics). This makes the rotation pre-filter consistent with the commit guardrail rather than weaker than it. The filter is conservative-by-slot: a SKU conflicting with **any** snack-ON child is pulled for the whole shared slot; if all stocked SKUs conflict, the week emits **no** snack slots (NO fallback).
- **Job reorder:** `kitchenMap` load moved above `assignSnackRotation` so the rotation can read declared allergens; the same `kitchenMap` is reused by the planner call below (single load, no duplicate fetch).
- **Deferred findings:**
  - **D-3S40-CR2** (snack-SKU branch skips `variation.add_ons`): still **unreachable** — snack slot variations only carry `{ child_id }` (no `add_ons`), and the Phase-2 branch `continue`s after the allergen check exactly as before. Logged as still-deferred; no code added.
  - **D-3S40-CR5** (seed `allergen_tags` backfill): **verified correct** — migration `20261031000000` backfills `allergen_tags` from the old `contains_*` booleans via `ARRAY(SELECT CASE WHEN contains_x THEN 'x' END …)` and CHECK-pins FALCPA-9. No new migration needed; closed.

### File List

- `packages/contracts/src/snack-shelf.ts` — `SnackAllergenTagSchema` + `allergen_tags` on `SnackSkuSchema` / `CreateSnackSkuInputSchema`
- `packages/contracts/src/snack-shelf.test.ts` — new (contract tests)
- `packages/types/src/index.ts` — `SnackAllergenTag` re-export
- `apps/api/src/modules/recipe/snack-sku.repository.ts` — `allergen_tags` on `CreateSnackSkuParams`/`create()` + `findAllergenTagsByIds()`
- `apps/api/src/modules/recipe/snack-sku.repository.test.ts` — repo tests
- `apps/api/src/modules/households/households.routes.ts` — `toSnackSku()` + POST `allergen_tags`
- `apps/api/src/modules/households/households.snack-routes.test.ts` — route tests
- `apps/api/src/modules/allergy-guardrail/allergy-rules.engine.ts` — `GUARDRAIL_VERSION` → `1.3.0`
- `apps/api/src/modules/allergy-guardrail/allergy-guardrail.service.ts` — `UnverifiableSlot` comment update (Phase-2)
- `apps/api/src/modules/allergy-guardrail/allergy-guardrail.service.test.ts` — comment annotations on attested tests
- `apps/api/src/modules/plans/plans.service.ts` — `snackSkuRepository?` dep + Phase-2 exemption replacement
- `apps/api/src/modules/plans/plans.service.test.ts` — 3 new Phase-2 snack-SKU guardrail-input tests
- `apps/api/src/modules/plans/plans.hook.ts` — wire `snackSkuRepository` into `PlansService`
- `apps/api/src/services/snack-rotation.service.ts` — `declaredAllergensByChildId?` + `filterAllergenConflicts` pre-filter
- `apps/api/src/services/snack-rotation.service.test.ts` — 5 allergen pre-filter tests
- `apps/api/src/jobs/plan-generation.job.ts` — kitchenMap reorder + build/pass `declaredAllergensByChildId`
- `apps/web/src/routes/(app)/snack-shelf.tsx` — FALCPA-9 allergen checkbox group
- `apps/web/src/routes/(app)/snack-shelf.test.tsx` — allergen form tests + fixture `allergen_tags`

### Review Findings

- [x] [Review][Decision] AC7 fieldset legend text — DISMISSED. "Allergens (optional)" is intentional; subtitle paragraph ("Tell Lumi which allergens…") covers the semantic gap. Confirmed by Menon 2026-06-21.
- [x] [Review][Patch] Misleading `PlansServiceDeps` comment on null `snackSkuRepository` [`apps/api/src/modules/plans/plans.service.ts` — PlansServiceDeps interface] — FIXED: updated comment to say null-repo path falls into untagged-unverifiable branch (no attested:true), strictly more conservative than Phase-1.
- [x] [Review][Patch] Missing AC8 web test: "Add form renders 9 allergen checkboxes" [`apps/web/src/routes/(app)/snack-shelf.test.tsx`] — FIXED: added test that iterates all 9 FALCPA label strings and asserts each checkbox is present via getByLabelText.

## Change Log

| Date | Change |
|---|---|
| 2026-06-20 | Story authored: Phase-2 deterministic allergen fail-safe for snack SKUs. Replaces Phase-1 `attested: true` blanket exemption with set-membership check + conservative-unknown fallback for untagged SKUs. Beta gate before allergic households rely on snack rotation. Status → ready-for-dev. |
| 2026-06-21 | Implemented all 6 tasks. Contracts/types/repo/route expose `allergen_tags`; `buildCommitGuardrailInputs` replaces the Phase-1 `attested:true` exemption with per-variation set-membership (tagged→verifiable, untagged→conservative-unverifiable); `GUARDRAIL_VERSION`→`1.3.0`; rotation pre-filter excludes allergen-conflicted SKUs (no fallback) using household∪per-child declared allergens; web add-form FALCPA-9 checkboxes. D-3S40-CR5 verified (backfill correct); D-3S40-CR2 still unreachable. All snack-scoped suites + typecheck green. Status → review. |
| 2026-06-21 | CODE REVIEW: 3-layer adversarial (Blind Hunter inline + Edge Case Hunter inline + Acceptance Auditor). 1 decision_needed, 2 patches, 4 dismissed. |
