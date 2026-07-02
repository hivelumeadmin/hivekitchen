# Story 3.S41: Family Snack Shelf — Add / Remove

Status: done

> **Source of truth:** `_bmad-output/planning-artifacts/sprint-change-proposal-2026-06-20-snack-skus.md` §6 → slice 3-s41. Option B (snacks as household-scoped SKUs) is LOCKED — do not re-open.
>
> **Depends on 3-s40 (done).** The `snack_skus` table, `plan_slots.snack_sku_id`, `created_by_household_id` column, 10 global seed rows, RLS SELECT policy, and `SnackSkuRepository` (with `findActiveForHousehold` + `findNamesByIds`) all ship in 3-s40. Do NOT recreate them. This story extends them.

## Story

As a parent managing my household's weekly plan,
I want to add my own snacks to a "My Snacks" shelf and remove ones we no longer use,
so that Lumi's snack rotation draws from snacks I actually buy, not just the 10 built-in options.

## Background

3-s40 shipped deterministic snack rotation from the 10 global seed SKUs (`created_by_household_id = NULL`). The `snack_skus` table already has `created_by_household_id` (nullable) to hold household-added rows — but there are no API routes or UI to manage them yet. The `SnackSkuRepository.findActiveForHousehold` already queries global + household rows, so adding a row automatically enters it into the next rotation.

3-s40 deferred finding **D-3S40-CR4** (the `kitchen_map_version` bump trigger on `snack_skus`) is resolved here: household-scoped writes now exist, so the Redis cache-invalidation trigger becomes live.

**Allergen doctrine:** Phase-1 (this slice) — parent-sovereign, no enforcement at add-time. `contains_*` allergen flags on household-added rows default to `false` (conservative-unknown). The guardrail exemption from 3-s40 (`attested: true`) covers all snack-SKU slots. Phase-2 (3-s43) adds `contains_*` ticks to the form and flips them into deterministic checking.

## Acceptance Criteria

### AC1 — DB migration
New migration `20261029000000_snack_shelf_family_add_remove.sql`:
- `ALTER TABLE snack_skus ADD COLUMN archived_at timestamptz` (nullable; NULL = active, non-null = soft-deleted by family).
- New trigger function `bump_kitchen_map_from_snack_sku()` — reads `created_by_household_id` (not `household_id`, which `snack_skus` doesn't have) and bumps `households.kitchen_map_version`. Pattern mirrors `bump_kitchen_map_version()` in `20260820000000_add_kitchen_map_version.sql` but resolves the FK alias. Global seed rows (`created_by_household_id IS NULL`) → no-op.
- `CREATE TRIGGER snack_skus_bump_kitchen_map AFTER INSERT OR UPDATE OR DELETE ON snack_skus FOR EACH ROW EXECUTE FUNCTION bump_kitchen_map_from_snack_sku()` — resolves 3-s40 deferred finding D-3S40-CR4.

### AC2 — Audit event types
Add `'household.snack_sku_added'` and `'household.snack_sku_archived'` to `AUDIT_EVENT_TYPES` in `apps/api/src/audit/audit.types.ts` (mirrors `household.extra_library_item_created` / `household.extra_library_item_archived`).

### AC3 — Contracts
New file `packages/contracts/src/snack-shelf.ts`:

```
SnackSkuSchema            { id, name, brand: nullable, category, created_by_household_id: nullable, created_at }
CreateSnackSkuInputSchema { name: string.min(1).max(100), brand?: string.max(100), category: enum }
ListSnackSkusResponseSchema { items: SnackSkuSchema[] }
SnackShelfHouseholdIdParamSchema { id: uuid }
```

**Category enum** (matches `snack_skus.category` values from global seeds + normalization in `snack-rotation.service.ts`):
`'fruit' | 'vegetable' | 'grain' | 'protein' | 'dairy' | 'other'`

Export from `packages/contracts/src/index.ts`. Infer types and re-export from `packages/types/src/index.ts`.

### AC4 — SnackSkuRepository extensions
In `apps/api/src/modules/recipe/snack-sku.repository.ts`:

- Add `archived_at: string | null` to `SnackSkuRow` interface.
- Add `'archived_at'` to `SNACK_SKU_COLUMNS`.
- `async create(input: CreateSnackSkuParams): Promise<SnackSkuRow>` — INSERT with `name`, `brand`, `category`, `created_by_household_id`; `is_active = true` (default); `archived_at = null` (default). All FALCPA `contains_*` flags default to `false` (conservative-unknown, Phase-1 doctrine). Returns the inserted row via `.select(SNACK_SKU_COLUMNS).single()`.
- `async archive(skuId: string, householdId: string): Promise<boolean>` — `UPDATE snack_skus SET is_active = false, archived_at = now() WHERE id = skuId AND created_by_household_id = householdId`. Scoped to household-owned rows: if `skuId` is a global seed (`created_by_household_id = NULL`) or another household's row, the WHERE clause finds nothing → returns `false` (→ 404 in route). Use `.maybeSingle()` + return `data !== null`.
- The existing `findActiveForHousehold` (`.eq('is_active', true)`) already excludes archived rows — no change needed.

### AC5 — API routes
Added to `apps/api/src/modules/households/households.routes.ts` (mirrors extra-library routes at lines 638–743; instantiate `SnackSkuRepository` alongside `ExtraLibraryRepository`):

**`GET /v1/households/:id/snacks`**
- `preHandler: authorize(['primary_parent', 'secondary_caregiver'])`
- Cross-household guard: `householdId !== request.user.household_id` → 403
- `snackSkuRepository.findActiveForHousehold(householdId)` → map to `SnackSkuSchema` shape
- Response `200: ListSnackSkusResponseSchema`
- No audit event (read-only)

**`POST /v1/households/:id/snacks`**
- `preHandler: authorize(['primary_parent'])`
- Cross-household guard → 403
- `snackSkuRepository.create({ householdId, name, brand, category })` → 201 + `SnackSkuSchema`
- Audit: `household.snack_sku_added` with `{ sku_id, name, category }` in metadata (name is parent-authored text — include only if low-PII risk; omit brand)
- Response `201: SnackSkuSchema`

**`DELETE /v1/households/:id/snacks/:skuId`**
- `preHandler: authorize(['primary_parent'])`
- Cross-household guard → 403
- `snackSkuRepository.archive(skuId, householdId)` → if `false` → 404 (not found OR global seed)
- Audit: `household.snack_sku_archived` with `{ sku_id }` in metadata
- Response 204 (no body)

### AC6 — Rotation pool automatically updated
No code change required. After a family adds a snack (`is_active=true`, `created_by_household_id=householdId`), `findActiveForHousehold` returns it in the next plan-generation job. After archiving (`is_active=false`), it is excluded. Manual verification: add → compose → SKU appears; archive → compose → SKU absent.

### AC7 — Web: "My Snacks" screen
New file `apps/web/src/routes/(app)/snack-shelf.tsx`:

- Route: `/app/kitchen/snacks` — registered in `apps/web/src/app.tsx` (same pattern as other `/app/*` routes; import + add to route array alongside `KitchenProfileRoute`)
- Uses `useLumiContext({ surface: 'general' })`
- Load on mount: `GET /v1/households/:id/snacks` via `hkFetch`; pattern mirrors `household-settings.tsx` (`useRef` didLoad guard, AbortController cleanup)
- **List section:** renders all items. Items where `created_by_household_id === null` show a "(built-in)" badge and NO remove button. Household-owned items show a remove button (primary parent only — check `role === 'primary_parent'` from auth store).
- **Add form** (primary parent only): name input (required), brand input (optional), category select (`fruit/vegetable/grain/protein/dairy/other`). On submit: `POST /v1/households/:id/snacks`, append to list on success, clear form.
- **Remove action:** `DELETE /v1/households/:id/snacks/:skuId`, remove item from list on 204.
- Styling: calm household system — `text-fg-default`, `text-fg-muted`, warm neutrals; no SaaS dashboard aesthetics. One-intent screen. Mirror button + input patterns from existing household settings page.
- No pagination needed at launch (family snack shelves stay small; global seeds = 10).

### AC8 — Tests
- `apps/api/src/modules/recipe/snack-sku.repository.test.ts` (NEW or extends if exists): `create` inserts row with correct columns; `archive` returns `true` for household row, `false` for global seed (NULL `created_by_household_id`), `false` for unknown id.
- Route tests for `GET/POST/DELETE /v1/households/:id/snacks`: 200 list (global + household), 201 create with correct body, 204 archive, 403 cross-household on all three verbs, 404 on archiving global seed, 403 secondary_caregiver on POST/DELETE.
- Web `snack-shelf.test.tsx`: list renders global (no remove button) + household items (remove button), add form submits, remove triggers DELETE and removes from list.

## Tasks / Subtasks

- [x] **Task 1 — DB migration** (AC: 1)
  - [x] Create `supabase/migrations/20261029000000_snack_shelf_family_add_remove.sql`
  - [x] `ALTER TABLE snack_skus ADD COLUMN archived_at timestamptz`
  - [x] Write `bump_kitchen_map_from_snack_sku()` trigger function (reads `created_by_household_id`; NULL = no-op; SECURITY DEFINER + locked search_path; pattern mirrors `bump_kitchen_map_version()`)
  - [x] Create trigger `snack_skus_bump_kitchen_map` on snack_skus

- [x] **Task 2 — Audit event types** (AC: 2)
  - [x] Add `'household.snack_sku_added'` and `'household.snack_sku_archived'` to `AUDIT_EVENT_TYPES` in `apps/api/src/audit/audit.types.ts`

- [x] **Task 3 — Contracts** (AC: 3)
  - [x] Create `packages/contracts/src/snack-shelf.ts` with 4 schemas
  - [x] Add `export * from './snack-shelf.js'` to `packages/contracts/src/index.ts`
  - [x] Add inferred type re-exports to `packages/types/src/index.ts`

- [x] **Task 4 — SnackSkuRepository extensions** (AC: 4)
  - [x] Add `archived_at: string | null` to `SnackSkuRow` + `SNACK_SKU_COLUMNS`
  - [x] Add `CreateSnackSkuParams` interface
  - [x] Implement `create(input: CreateSnackSkuParams): Promise<SnackSkuRow>`
  - [x] Implement `archive(skuId: string, householdId: string): Promise<boolean>`

- [x] **Task 5 — API routes** (AC: 5)
  - [x] Import `SnackSkuRepository` + new contracts into `households.routes.ts`
  - [x] Instantiate `snackSkuRepository` in route plugin body (alongside `extraLibraryRepository`)
  - [x] Implement `GET /v1/households/:id/snacks`
  - [x] Implement `POST /v1/households/:id/snacks`
  - [x] Implement `DELETE /v1/households/:id/snacks/:skuId`

- [x] **Task 6 — Web** (AC: 7)
  - [x] Create `apps/web/src/routes/(app)/snack-shelf.tsx`
  - [x] Register route in `apps/web/src/app.tsx`

- [x] **Task 7 — Tests** (AC: 8)
  - [x] `snack-sku.repository.test.ts` — create, archive (household row), archive (global seed → false), archive (unknown id → false)
  - [x] Route tests — GET/POST/DELETE happy path + auth guard + cross-household + 404
  - [x] `snack-shelf.test.tsx` — list render, add submit, remove click

## Dev Notes

### Critical correctness notes (disaster prevention)

**`snack_skus` column naming mismatch with `bump_kitchen_map_version()`.** The generic trigger function reads `to_jsonb(NEW)->>'household_id'`, but `snack_skus` uses `created_by_household_id`. Do NOT attach the generic function — write a bespoke `bump_kitchen_map_from_snack_sku()` that reads `created_by_household_id`. See migration `20260820000000_add_kitchen_map_version.sql:72-96` for the generic pattern to adapt.

**Archive scope guard is safety-critical.** `SnackSkuRepository.archive()` MUST scope the UPDATE to `WHERE created_by_household_id = householdId`. Without this, a primary parent could archive a global seed (which would break every household's rotation) or another household's row. The PostgREST call: `.update(...).eq('id', skuId).eq('created_by_household_id', householdId)`.

**`findActiveForHousehold` raw string interpolation (known low-pri risk).** The existing `.or(`created_by_household_id.is.null,created_by_household_id.eq.${householdId}`)` interpolates `householdId` into a PostgREST filter string (3-s40 deferred D-3S40-CR6). `householdId` is a server-resolved trusted UUID from `request.user.household_id`, not user input, so not exploitable. Do not change it in this slice; it is a pre-existing pattern.

**`archived_at` vs `is_active` — use BOTH.** Soft-delete must set `is_active = false` (so `findActiveForHousehold`'s existing `.eq('is_active', true)` filter excludes it) AND `archived_at = now()` (to distinguish family-removed from future Phase-2 system-disabled). Do not change `findActiveForHousehold` — it already works correctly.

**Global seeds are not removable.** `archive()` scopes to `created_by_household_id = householdId`. A global seed has `created_by_household_id = NULL`. The WHERE clause finds nothing → returns `false` → route returns 404. This is correct and intentional: a household cannot remove the 10 global seeds. The web UI should suppress the remove button for items where `created_by_household_id === null`.

**Category enum must match `snack-rotation.service.ts` normalization.** The rotation service normalizes `'veggie'` → `'vegetable'` (`snack-rotation.service.ts` — the `CATEGORY_NORMALIZE` map). The contract enum should use the canonical DB values: `'fruit' | 'vegetable' | 'grain' | 'protein' | 'dairy' | 'other'`. Do NOT use `'veggie'` in the enum.

**Migration timestamp.** The last snack-related migration is `20261028000000_snack_sku_rotation_unfold.sql`. Use `20261029000000_snack_shelf_family_add_remove.sql`. Check `supabase/migrations/` for any intervening migrations before finalizing.

**households.routes.ts is 997 lines.** Adding 3 more routes is fine per the established `extra_library` pattern. Do NOT refactor or reorganize the file — that is out of scope.

### Key files

| File | Change |
|---|---|
| `supabase/migrations/20261029000000_snack_shelf_family_add_remove.sql` | NEW — `archived_at` col, trigger function, trigger |
| `apps/api/src/audit/audit.types.ts` | MODIFIED — 2 new audit event types |
| `packages/contracts/src/snack-shelf.ts` | NEW — 4 Zod schemas |
| `packages/contracts/src/index.ts` | MODIFIED — `export * from './snack-shelf.js'` |
| `packages/types/src/index.ts` | MODIFIED — inferred type re-exports |
| `apps/api/src/modules/recipe/snack-sku.repository.ts` | MODIFIED — `archived_at` field + `create` + `archive` methods |
| `apps/api/src/modules/households/households.routes.ts` | MODIFIED — import SnackSkuRepository + 3 new routes |
| `apps/web/src/routes/(app)/snack-shelf.tsx` | NEW — "My Snacks" screen |
| `apps/web/src/app.tsx` | MODIFIED — register `/app/kitchen/snacks` route |
| `apps/api/src/modules/recipe/snack-sku.repository.test.ts` | NEW — create + archive tests |
| `apps/web/src/routes/(app)/snack-shelf.test.tsx` | NEW — list/add/remove tests |

### Previous story intelligence (3-s40)

- `snack-sku.repository.ts` is at `apps/api/src/modules/recipe/snack-sku.repository.ts` (not in the `households` module — keep it there; just import from there into the routes).
- The `SnackSkuRow.created_by_household_id` field is `string | null` (already typed).
- `SNACK_SKU_COLUMNS` is a string const — append `', archived_at'` to it.
- 3-s40 dev note: `tree-adapter.ts` was not found at the specified path — the `snack_sku_id` propagation is handled via `PlanSlotRow` through `brief_state`. Not relevant to 3-s41.
- 3-s40 code review fixed the typecheck issue where `PlanSlotRowSchema.snack_sku_id` (required `string|null`) broke fixtures — `snack_sku_id: null` was added as default in test factories. Any new test fixtures creating `PlanSlotRow` should also include `snack_sku_id: null`.

### Relationship to other stories

- **3-s40 (done):** Foundation. `snack_skus` table, `created_by_household_id`, `SnackSkuRepository.findActiveForHousehold`, global seeds, Phase-1 guardrail exemption all exist.
- **3-s42 (next):** Per-child pins/bans editing UI. The rotation already reads `extra_rules`; 3-s42 only adds the UI for editing them.
- **3-s43 (beta gate):** Phase-2 allergen fail-safe. Adds `contains_*` ticks to the add form; flips the Phase-1 `attested` exemption into deterministic checking. The `archived_at`/`is_active` soft-delete model from this story is safe for 3-s43 to build on.

### Out of scope

Per-child pins/bans editing UI (3-s42), allergen flag ticks on the add form (3-s43), surfacing the snack shelf in the kitchen map planner prompt block, advanced rotation variety (week-long no-repeat windows), barcode/curated allergen enrichment, pagination of the snack list, Extras/Mains behavior.

### References

- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-06-20-snack-skus.md §6 (3-s41 slice definition)]
- [Source: _bmad-output/implementation-artifacts/3-s40-snack-sku-rotation-unfold.md (AC list, Dev Notes, Review Findings — esp. D-3S40-CR4, D-3S40-CR6)]
- [Source: apps/api/src/modules/recipe/snack-sku.repository.ts (SnackSkuRow, SNACK_SKU_COLUMNS, findActiveForHousehold, findNamesByIds)]
- [Source: apps/api/src/modules/households/extra-library.repository.ts (create/findByHousehold/archive pattern)]
- [Source: apps/api/src/modules/households/households.routes.ts:638-743 (extra_library routes — mirror pattern for snack routes)]
- [Source: supabase/migrations/20261028000000_snack_sku_rotation_unfold.sql (snack_skus table, RLS policy, snack_sku_idx)]
- [Source: supabase/migrations/20260820000000_add_kitchen_map_version.sql:72-96 (bump_kitchen_map_version generic function — adapt for created_by_household_id)]
- [Source: supabase/migrations/20261008000200_household_allergens_kitchen_map_trigger.sql (trigger pattern)]
- [Source: apps/api/src/audit/audit.types.ts:112-113 (extra_library audit event types to mirror)]
- [Source: packages/contracts/src/extra-rules.ts:36-60 (ExtraLibraryItem schemas — mirror for SnackSku)]
- [Source: packages/contracts/src/index.ts (export pattern)]
- [Source: apps/api/src/services/snack-rotation.service.ts (CATEGORY_NORMALIZE map — category enum must match DB canonical values)]
- [Source: apps/web/src/routes/(app)/household-settings.tsx (useRef/useEffect/hkFetch/AbortController load pattern)]
- [Source memory: snacks-as-household-skus, kitchen-map-cache-trigger-gap]

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (dev-story)

### Debug Log References

- `pnpm typecheck` — clean across all 9 packages after adding `archived_at` + `created_at` to `SnackSkuRow` (fixed the one downstream fixture in `snack-rotation.service.test.ts`).
- API targeted suites: `snack-sku.repository.test.ts` + `households.snack-routes.test.ts` + `snack-rotation.service.test.ts` → 27/27 pass.
- Web targeted suite: `snack-shelf.test.tsx` → 4/4 pass.
- Pre-existing baseline failures (NOT introduced by this story, verified via TS↔SQL diff and route ownership):
  - `audit.types.test.ts` enum-parity — already failing on HEAD with 16 TS-only drifts (sovereignty, account.deletion_requested, plan.* variants, voice tokens, lunch_link suppress/unsuppress, …). This story ADDS the two snack values to the Postgres enum, so it reduces the drift by 2 rather than adding to it.
  - `households.routes.test.ts > GET …/memory > returns 200 with the active nodes` — memory route, untouched by this story; listed as a known baseline in sprint-status.

### Completion Notes List

- All 8 ACs implemented. Two intentional, necessary deviations from the literal AC text, both documented here:
  1. **`created_at` added to `SnackSkuRow` + `SNACK_SKU_COLUMNS`** (AC4 only names `archived_at`). Required because `SnackSkuSchema` (AC3) returns `created_at`, and both GET (`findActiveForHousehold`) and POST (`create`) map repo rows to that contract. Harmless to the rotation service, which ignores it.
  2. **`ALTER TYPE audit_event_type ADD VALUE` added to the migration** for both new event types. AC2 only names the TS const, but `audit_log.event_type` is a live Postgres ENUM extended per-story (mirrors `20261027000000`). Without the enum values, the audit insert would throw at runtime. This also keeps the parity test from gaining 2 new mismatches.
- **Disaster-prevention notes honored:** `archive()` scopes the UPDATE to `created_by_household_id = householdId` (global seed / other-household → 0 rows → `false` → 404); soft-delete sets BOTH `is_active = false` AND `archived_at = now()`; bespoke `bump_kitchen_map_from_snack_sku()` reads `created_by_household_id` (not `household_id`) and no-ops on NULL; category enum uses canonical DB values (no `'veggie'`); `findActiveForHousehold` left unchanged. Resolves 3-S40 deferred finding D-3S40-CR4 (the kitchen_map_version trigger).
- Web "My Snacks" screen at `/app/kitchen/snacks`: built-in rows (`created_by_household_id === null`) show a "(built-in)" badge and no remove button; household rows show a remove button gated to `role === 'primary_parent'`; add form is primary-parent-only. Mirrors `household-settings.tsx` load pattern (didLoad ref + AbortController) and button/input styling.
- AC6 (rotation pool auto-update) required no code change — `findActiveForHousehold` already unions global + household active rows.

### File List

- `supabase/migrations/20261029000000_snack_shelf_family_add_remove.sql` (NEW)
- `apps/api/src/audit/audit.types.ts` (MODIFIED)
- `packages/contracts/src/snack-shelf.ts` (NEW)
- `packages/contracts/src/index.ts` (MODIFIED)
- `packages/types/src/index.ts` (MODIFIED)
- `apps/api/src/modules/recipe/snack-sku.repository.ts` (MODIFIED)
- `apps/api/src/modules/households/households.routes.ts` (MODIFIED)
- `apps/web/src/routes/(app)/snack-shelf.tsx` (NEW)
- `apps/web/src/app.tsx` (MODIFIED)
- `apps/api/src/modules/recipe/snack-sku.repository.test.ts` (NEW)
- `apps/api/src/modules/households/households.snack-routes.test.ts` (NEW)
- `apps/web/src/routes/(app)/snack-shelf.test.tsx` (NEW)
- `apps/api/src/services/snack-rotation.service.test.ts` (MODIFIED — fixture gains `archived_at`/`created_at`)

### Review Findings

- [x] [Review][Patch] handleRemove has no user feedback on failure — FIXED: added `removeError` state + `setRemoveError` in catch + `role="alert"` display after list [`apps/web/src/routes/(app)/snack-shelf.tsx` handleRemove]
- [x] [Review][Defer] D-3S41-CR1: Double-remove race: two rapid clicks before button disables issue two DELETEs [`apps/web/src/routes/(app)/snack-shelf.tsx` handleRemove] — deferred, benign (second DELETE returns 404, swallowed silently; no data corruption)
- [x] [Review][Defer] D-3S41-CR2: 401 during mutation handlers (handleAdd/handleRemove) not redirected to login [`apps/web/src/routes/(app)/snack-shelf.tsx`] — deferred, pre-existing pattern across all mutation handlers in the app
- [x] [Review][Defer] D-3S41-CR3: householdId=null during auth hydration leaves screen stuck in loading state if householdId never resolves [`apps/web/src/routes/(app)/snack-shelf.tsx` useEffect] — deferred, pre-existing pattern across all screens using this load pattern
- [x] [Review][Defer] D-3S41-CR4: Rapid double-add before setAdding state re-renders can create duplicate rows [`apps/web/src/routes/(app)/snack-shelf.tsx` handleAdd] — deferred, narrow timing window; button disabled pattern is consistent with existing screens
- [x] [Review][Defer] D-3S41-CR5: Trigger fires as no-op on every global seed INSERT/UPDATE/DELETE (NULL check exits immediately but adds row-lock overhead at seed time) [`supabase/migrations/20261029000000_snack_shelf_family_add_remove.sql`] — deferred, trivial overhead; correct behaviour
- [x] [Review][Patch] Test category assertion coincidentally passes — FIXED: added `fireEvent.change('Category', 'protein')` + updated assertion to `category: 'protein'` — `snack-shelf.test.tsx:153` asserts `category: 'fruit'` for a "Hummus Cup" add test without firing a `fireEvent.change` on the category select; the assertion passes because the form default is `'fruit'`, not because the wire-up was verified [`apps/web/src/routes/(app)/snack-shelf.test.tsx:143-157`]
- [x] [Review][Defer] D-3S41-CR6: `setInStock()` has no match path for global SKUs via direct API — PATCH on a global seed (created_by_household_id = NULL) always 404s; UI correctly gates toggle button to `!isBuiltIn` so this is API-only [`apps/api/src/modules/recipe/snack-sku.repository.ts:setInStock`] — deferred, UI guards the path; D-3S44-CR3 covers the archived-row variant
- [x] [Review][Defer] D-3S41-CR7: `bump_kitchen_map_from_snack_sku` fires on every `snack_skus` UPDATE including `in_stock` toggles — each stock toggle increments `kitchen_map_version` and evicts the Redis KitchenMap cache unnecessarily [`supabase/migrations/20261029000000_snack_shelf_family_add_remove.sql`] — deferred, performance concern not correctness; consider column-level `IF OLD.is_active IS DISTINCT FROM NEW.is_active` guard
- [x] [Review][Defer] D-3S41-CR8: `is_active`/`archived_at` two-column soft-delete invariant not enforced by DB CHECK — correctness relies on `archive()` always setting both fields together; a future migration could produce contradictory state without rejection [`supabase/migrations/20261029000000_snack_shelf_family_add_remove.sql`] — deferred, schema hardening; pre-existing pattern across snack_skus
- [x] [Review][Defer] D-3S41-CR9: `allergen_tags` array accepts duplicate values — `z.array(SnackAllergenTagSchema)` in `CreateSnackSkuInputSchema` has no `.refine` uniqueness guard; DB array column has no uniqueness constraint; duplicates don't break the guardrail (membership-based) but produce noisy data [`packages/contracts/src/snack-shelf.ts:CreateSnackSkuInputSchema`] — deferred, data quality
- [x] [Review][Defer] D-3S41-CR10: Simultaneous toggle+remove in-flight for same SKU shows ghost `toggleError` after remove succeeds — `removingId` and `togglingId` are independent; after DELETE filters item from list, in-flight PATCH 404s and renders `toggleError` for a now-absent row [`apps/web/src/routes/(app)/snack-shelf.tsx:handleToggleStock,handleRemove`] — deferred, narrow timing window; related to D-3S41-CR1

### Change Log

| Date | Change |
|---|---|
| 2026-06-20 | Story 3-S41 implemented: family snack shelf add/remove. Migration (`archived_at` col + bespoke kitchen_map_version trigger + audit enum values), contracts `snack-shelf.ts`, `SnackSkuRepository.create`/`archive`, 3 routes on `households.routes.ts`, web `/app/kitchen/snacks` screen, repo + route + web tests. Resolves 3-S40 D-3S40-CR4. Status → review. |
