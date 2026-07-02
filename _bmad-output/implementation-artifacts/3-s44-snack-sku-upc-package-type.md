# Story 3.S44: Snack SKU — UPC Barcode + Package Type

Status: done

> **Depends on 3-s41 (done or review).** The `snack_skus` table, `SnackSkuRepository.create`, API routes (`GET/POST/DELETE /v1/households/:id/snacks`), and the "My Snacks" web screen all ship in 3-s41. This story extends them with two optional metadata fields — do NOT recreate anything from 3-s41.

## Story

As a parent managing my household's snack shelf,
I want to optionally record the UPC barcode and package type when I add a snack,
so that Lumi has richer product context and I can identify the exact product I buy.

## Acceptance Criteria

### AC1 — DB migration
New migration `20261030000000_snack_sku_upc_package_type.sql`:
- `ALTER TABLE snack_skus ADD COLUMN upc_code TEXT` — nullable. Freeform UPC/EAN barcode string entered by parent (no format enforcement at DB level; validation lives in the contract).
- `ALTER TABLE snack_skus ADD COLUMN package_type TEXT CHECK (package_type IN ('bag','box','cup','pouch','other'))` — nullable CHECK constraint. NULL means "not specified".
- No trigger changes needed — the kitchen_map_version trigger already fires on UPDATE from 20261029000000.

### AC2 — Contracts
Extend `packages/contracts/src/snack-shelf.ts` (in-place edit, do NOT create a new file):
- `SnackSkuSchema`: add `upc_code: z.string().nullable()` and `package_type: SnackPackageTypeSchema.nullable()`.
- New `SnackPackageTypeSchema = z.enum(['bag','box','cup','pouch','other'])` — export it.
- `CreateSnackSkuInputSchema`: add `upc_code: z.string().max(20).optional()` and `package_type: SnackPackageTypeSchema.optional()`.
- Export `SnackPackageTypeSchema` from `packages/contracts/src/index.ts` (it re-exports everything from snack-shelf.ts via `export * from './snack-shelf.js'` — no index.ts change needed if the schema is exported from snack-shelf.ts).
- Add inferred types `SnackPackageType` to `packages/types/src/index.ts`.

### AC3 — SnackSkuRepository extensions
In `apps/api/src/modules/recipe/snack-sku.repository.ts`:
- Add `upc_code: string | null` and `package_type: string | null` to `SnackSkuRow` interface.
- Append `', upc_code, package_type'` to `SNACK_SKU_COLUMNS`.
- Add `upc_code?: string | null` and `package_type?: string | null` to `CreateSnackSkuParams` interface (optional — callers that don't supply them pass nothing and DB defaults to NULL).
- Extend `create()` INSERT payload: include `upc_code` and `package_type` only when present in input (pass them through as-is; they may be `undefined`, which Supabase client omits from the INSERT, leaving DB NULL default).

### AC4 — API route extension
In `apps/api/src/modules/households/households.routes.ts` (the existing `POST /v1/households/:id/snacks` handler):
- Pass `upc_code: body.upc_code ?? null` and `package_type: body.package_type ?? null` into the `snackSkuRepository.create()` call.
- The `toSnackSku()` mapper already maps from `SnackSkuRow` to `SnackSku` — add `upc_code` and `package_type` to its return object.
- No new routes needed. GET already returns the full row via `toSnackSku`; DELETE is unaffected.

### AC5 — Web: add form extensions
In `apps/web/src/routes/(app)/snack-shelf.tsx`:
- Add two new optional state fields: `upcCode` (string, default `''`) and `packageType` (SnackPackageType | '', default `''`).
- UPC input: `<label htmlFor="snack-upc">UPC (optional)</label>` + `<input id="snack-upc" type="text" maxLength={20} />`. Include it in the POST body as `upc_code: upcCode.trim() || undefined`.
- Package type select: `<label htmlFor="snack-package-type">Package type (optional)</label>` + `<select id="snack-package-type">` with options: `''` → "Not specified" (default), then `bag/box/cup/pouch/other`. Include in POST body as `package_type: packageType || undefined`.
- Clear both fields on successful add (alongside name/brand/category reset).
- List rendering: display `upc_code` (if non-null) as small muted text below name — same muted style as `brand`. Display `package_type` as small muted text if non-null.
- Styling: match existing muted text pattern (`font-sans text-xs text-fg-muted ml-2`).

### AC6 — Tests
- `snack-sku.repository.test.ts`: extend the `create` test to verify `upc_code` and `package_type` pass through to the INSERT payload when supplied; verify they are absent from the payload when not supplied (undefined = omitted by Supabase client).
- `households.snack-routes.test.ts`: extend the POST 201 test to assert `upc_code` and `package_type` are returned in the response body when provided. Add one test for omitted fields (default null in response).
- `snack-shelf.test.tsx`: extend the add-form submit test to verify `upc_code` and `package_type` appear in the POST body when filled in. Add one test verifying they appear in the rendered list when present in the GET response.

## Tasks / Subtasks

- [x] **Task 1 — DB migration** (AC: 1)
  - [x] Create `supabase/migrations/20261030000000_snack_sku_upc_package_type.sql`
  - [x] `ALTER TABLE snack_skus ADD COLUMN upc_code TEXT`
  - [x] `ALTER TABLE snack_skus ADD COLUMN package_type TEXT CHECK (...)`

- [x] **Task 2 — Contracts** (AC: 2)
  - [x] Add `SnackPackageTypeSchema` to `packages/contracts/src/snack-shelf.ts`
  - [x] Extend `SnackSkuSchema` with `upc_code` + `package_type`
  - [x] Extend `CreateSnackSkuInputSchema` with optional `upc_code` + `package_type`
  - [x] Add `SnackPackageType` type to `packages/types/src/index.ts`

- [x] **Task 3 — SnackSkuRepository** (AC: 3)
  - [x] Add `upc_code` + `package_type` to `SnackSkuRow`
  - [x] Append to `SNACK_SKU_COLUMNS`
  - [x] Add optional fields to `CreateSnackSkuParams`
  - [x] Pass them through in `create()` INSERT

- [x] **Task 4 — API route** (AC: 4)
  - [x] Extend POST handler to pass `upc_code` + `package_type` to `create()`
  - [x] Extend `toSnackSku()` mapper to include both fields

- [x] **Task 5 — Web** (AC: 5)
  - [x] Add `upcCode` + `packageType` state to `snack-shelf.tsx`
  - [x] Add UPC input + package type select to add form
  - [x] Clear on success; include in POST body
  - [x] Render in list item when non-null

- [x] **Task 6 — Tests** (AC: 6)
  - [x] `snack-sku.repository.test.ts` — create with/without new fields
  - [x] `households.snack-routes.test.ts` — POST with/without new fields
  - [x] `snack-shelf.test.tsx` — form includes fields in body; list renders them

## Dev Notes

### Critical correctness notes

**Migration timestamp.** The last snack migration is `20261029000000_snack_shelf_family_add_remove.sql`. Use `20261030000000_snack_sku_upc_package_type.sql`. Check `supabase/migrations/` for any intervening migrations.

**`upc_code` is TEXT not NUMERIC.** UPC-A is 12 digits, EAN-13 is 13 digits, but parents may type partial codes, add dashes, or use other formats. Store as TEXT. The contract enforces `.max(20)` to prevent abuse. Do NOT add a CHECK constraint at the DB level — the contract layer is the enforcement point.

**`package_type` DB CHECK constraint.** The five values `'bag','box','cup','pouch','other'` must match exactly the `SnackPackageTypeSchema` enum. If they diverge (e.g. a typo in the migration), the INSERT will throw a Postgres CHECK violation at runtime.

**`toSnackSku()` mapper must include new fields.** The mapper in `households.routes.ts` currently maps 6 fields from `SnackSkuRow` to `SnackSku`. It must be extended to include `upc_code` and `package_type` — otherwise the GET response and POST 201 response will silently omit them even after the contract schema declares them.

**`CreateSnackSkuParams.upc_code` and `package_type` are optional (`?:`).** When the web form submits without filling these fields, `body.upc_code` will be `undefined`. The route passes `body.upc_code ?? null` → `create()` receives `null`. The INSERT payload should include `upc_code: null` in this case (not omit it), so that explicit null is written rather than relying on DB default. Either approach is correct since the DB default is NULL anyway, but explicit is cleaner.

**Existing `snack-rotation.service.ts` fixture.** The `SnackSkuRow` fixture in `snack-rotation.service.test.ts` was updated in 3-s41 to include `archived_at` and `created_at`. It must now also gain `upc_code: null` and `package_type: null` to satisfy the updated interface. Check this file before running typecheck.

**`packages/contracts/src/snack-shelf.ts` is in-place edit.** Do NOT create a new contracts file. The existing file already exports `SnackCategorySchema`, `SnackSkuSchema`, `CreateSnackSkuInputSchema`, `ListSnackSkusResponseSchema`, and `SnackShelfHouseholdIdParamSchema`. Add `SnackPackageTypeSchema` and extend the existing schemas.

**`packages/contracts/src/index.ts` does NOT need changing.** It already has `export * from './snack-shelf.js'` which re-exports everything from `snack-shelf.ts`. Adding `SnackPackageTypeSchema` to `snack-shelf.ts` is sufficient.

**No new API routes.** GET already returns the full `SnackSku` shape. POST already returns 201 + the created row. DELETE is unaffected. No new endpoints are needed.

**Web form field order:** UPC input goes after Brand, before Category. Package type select goes after Category. This ordering keeps the most common fields (name, brand) at the top.

**No audit metadata change.** The `POST` route audit metadata currently records `{ sku_id, name, category }`. UPC and package type are informational metadata — no PII concern — but the AC does not require updating the audit payload. Do not change it.

### Key files

| File | Change |
|---|---|
| `supabase/migrations/20261030000000_snack_sku_upc_package_type.sql` | NEW — 2 new columns |
| `packages/contracts/src/snack-shelf.ts` | MODIFIED — SnackPackageTypeSchema + extend 2 schemas |
| `packages/types/src/index.ts` | MODIFIED — SnackPackageType inferred type |
| `apps/api/src/modules/recipe/snack-sku.repository.ts` | MODIFIED — SnackSkuRow + COLUMNS + CreateSnackSkuParams + create() |
| `apps/api/src/modules/households/households.routes.ts` | MODIFIED — POST handler + toSnackSku() |
| `apps/web/src/routes/(app)/snack-shelf.tsx` | MODIFIED — form fields + list rendering |
| `apps/api/src/modules/recipe/snack-sku.repository.test.ts` | MODIFIED — create tests |
| `apps/api/src/modules/households/households.snack-routes.test.ts` | MODIFIED — POST tests |
| `apps/web/src/routes/(app)/snack-shelf.test.tsx` | MODIFIED — form + list tests |
| `apps/api/src/services/snack-rotation.service.test.ts` | MODIFIED — fixture gains upc_code/package_type |

### Previous story intelligence (3-s41)

- `SnackSkuRow` now has `archived_at: string | null` and `created_at: string` (added in 3-s41). The new fields add two more: `upc_code: string | null` and `package_type: string | null`.
- `SNACK_SKU_COLUMNS` is a string constant — append `', upc_code, package_type'`.
- The `snack-rotation.service.test.ts` fixture `sku()` was patched in 3-s41 to include `archived_at: null, created_at: '...'`. It must now also include `upc_code: null, package_type: null`.
- `CreateSnackSkuParams` interface was introduced in 3-s41 with `{ householdId, name, brand, category }`. Extend it with optional `upc_code?` and `package_type?`.
- Route test harness in `households.snack-routes.test.ts` uses an in-memory `SkuRow` interface and a `snackSkusTable` mock. Extend the `SkuRow` interface with `upc_code: string | null` and `package_type: string | null`. Update `insert()` mock to capture and store both fields (default null).
- Web test uses `hkFetchMock` — the add form submit test asserts `postCall?.[1].body` shape. Extend the assertion to include the two new fields when present.

### Relationship to other stories

- **3-s41 (done/review):** Foundation — snack_skus table, SnackSkuRepository, API routes, web screen.
- **3-s42 (next after 3-s41):** Per-child pins/bans editing UI — unaffected by this story.
- **3-s43 (beta gate):** Phase-2 allergen fail-safe — adds `contains_*` ticks. UPC and package type are independent of allergen flags.

### Out of scope

Barcode scanning (camera input), automatic product lookup by UPC, allergen enrichment from UPC, package quantity tracking, display of UPC/package_type in the rotation planner prompt, pagination.

### References

- [Source: _bmad-output/implementation-artifacts/3-s41-family-snack-shelf-add-remove.md (full story — AC list, Dev Notes, file list)]
- [Source: apps/api/src/modules/recipe/snack-sku.repository.ts (SnackSkuRow, SNACK_SKU_COLUMNS, CreateSnackSkuParams, create())]
- [Source: packages/contracts/src/snack-shelf.ts (SnackSkuSchema, CreateSnackSkuInputSchema — extend these)]
- [Source: apps/api/src/modules/households/households.routes.ts (toSnackSku() mapper + POST handler)]
- [Source: apps/web/src/routes/(app)/snack-shelf.tsx (form state, handleAdd, list rendering)]
- [Source: supabase/migrations/20261029000000_snack_shelf_family_add_remove.sql (pattern for ADD COLUMN)]
- [Source: apps/api/src/services/snack-rotation.service.test.ts (sku() fixture — must gain upc_code/package_type)]

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (Claude Opus 4.8, 1M context)

### Debug Log References

- Typecheck: `pnpm -w typecheck` → 9/9 packages clean.
- Targeted tests: `vitest run` on `snack-sku.repository.test.ts`, `households.snack-routes.test.ts`,
  `snack-rotation.service.test.ts` → 30 passed; web `snack-shelf.test.tsx` → 6 passed.

### Completion Notes List

All 6 ACs implemented. Summary of decisions and deviations:

- **AC1 migration** `20261030000000_snack_sku_upc_package_type.sql`: `upc_code TEXT` (no DB
  format CHECK — contract enforces `.max(20)`) and `package_type TEXT CHECK (... IN bag/box/cup/pouch/other)`.
  No trigger changes — the `snack_skus_bump_kitchen_map` trigger from 20261029000000 already fires
  on INSERT/UPDATE. **USER-SIDE GATE:** `supabase db push --include-all` must be run to apply it.
- **AC2 contracts**: `SnackPackageTypeSchema` enum + `upc_code`/`package_type` added to `SnackSkuSchema`
  (`.nullable()`) and `CreateSnackSkuInputSchema` (`.optional()`). `SnackPackageType` inferred type added
  to `packages/types/src/index.ts`. No `index.ts` change needed (re-exports via `export *`).
- **AC3 repository**: `SnackSkuRow` + `CreateSnackSkuParams` gained both fields; `SNACK_SKU_COLUMNS`
  appended. `create()` conditionally spreads `upc_code`/`package_type` into the INSERT **only when
  non-null** — when omitted they are absent from the payload and the DB NULL default applies (verified
  by a dedicated "omits…" repo test).
- **AC4 route**: POST handler passes `body.upc_code ?? null` / `body.package_type ?? null`;
  `toSnackSku()` mapper extended with both fields. No new routes. Audit metadata unchanged (per Dev Notes).
- **AC5 web**: `upcCode`/`packageType` state; UPC input after Brand, package-type select after Category
  (default option "Not specified" → `''` → omitted from body). Cleared on successful add. List renders
  `upc_code` and `package_type` as muted text (`font-sans text-xs text-fg-muted ml-2`) when non-null.
- **AC6 tests**: repo create with/without new fields (pass-through + omission); routes POST with fields
  (201 returns them) + omitted (null in response); web form submits fields in body + list renders them.
  Pre-existing 3-s41 web/route fixtures updated to carry `upc_code`/`package_type` (now required by the
  schema as `.nullable()`), plus the `snack-rotation.service.test.ts` `sku()` fixture (interface change).

**Baseline note (not regressions):** the branch (`feat/3-s32-planner-kitchenmap-context-injection`)
carries unrelated uncommitted work that fails 16 contracts tests (e.g. `LumiSurfaceSchema` 9-vs-10 drift
guard after `kitchen-profile` was added) and 31 API tests (memory/auth/onboarding/audit-enum/children/
extra-library/households-memory-route). None touch snack code; verified my edits to the one shared file
(`households.routes.ts`) are purely additive snack routes. All snack-specific tests pass; typecheck clean.

### File List

**New**
- `supabase/migrations/20261030000000_snack_sku_upc_package_type.sql`

**Modified**
- `packages/contracts/src/snack-shelf.ts`
- `packages/types/src/index.ts`
- `apps/api/src/modules/recipe/snack-sku.repository.ts`
- `apps/api/src/modules/households/households.routes.ts`
- `apps/web/src/routes/(app)/snack-shelf.tsx`
- `apps/api/src/modules/recipe/snack-sku.repository.test.ts`
- `apps/api/src/modules/households/households.snack-routes.test.ts`
- `apps/web/src/routes/(app)/snack-shelf.test.tsx`
- `apps/api/src/services/snack-rotation.service.test.ts`

## Review Findings

_Code review 2026-06-20 — 3-layer adversarial (Blind Hunter / Edge Case Hunter / Acceptance Auditor). All 6 ACs verified satisfied by the Auditor. 2 patch, 3 defer, 7 dismissed (incl. 2 verified false positives)._

- [x] [Review][Patch] Empty-string `upc_code` from a non-web API client persists as `''` instead of NULL [apps/api/src/modules/households/households.routes.ts:823] — FIXED: route now normalizes via `body.upc_code?.trim() || null`, so `''`/whitespace-only → NULL for all callers. Regression test added (`households.snack-routes.test.ts` "normalizes a whitespace-only upc_code to null").
- [x] [Review][Patch] List renders raw enum value `package_type` ("pouch") not the human label ("Pouch") [apps/web/src/routes/(app)/snack-shelf.tsx:188-192] — FIXED: list now maps through `PACKAGE_TYPES` label lookup (falls back to raw value). Test assertion updated + scoped to the list row via `within()`.
- [x] [Review][Defer] `SnackCategorySchema` read-path can reject real rows (`'veggie'` vs `'vegetable'`) [packages/contracts/src/snack-shelf.ts] — deferred, pre-existing (3-s41), out of 3-s44 scope.
- [x] [Review][Defer] `archive()` is not idempotent — double-DELETE re-archives and clobbers `archived_at` [apps/api/src/modules/recipe/snack-sku.repository.ts:291] — deferred, pre-existing (3-s41).
- [x] [Review][Defer] `setInStock()` has no `is_active` guard — PATCH returns 200 on a soft-deleted SKU [apps/api/src/modules/recipe/snack-sku.repository.ts:306] — deferred, pre-existing (3-s42).

## Change Log

| Date | Change |
|---|---|
| 2026-06-20 | Code review (3-layer adversarial) — all 6 ACs verified satisfied. 2 patch (empty-string upc_code → '' instead of NULL; list shows raw enum vs label), 3 defer (pre-existing 3-s41/s42 snack issues), 7 dismissed incl. 2 verified false positives (contracts barrel export DOES exist at index.ts:44; migration ordering 030 is correctly between 029/031). |
| 2026-06-20 | Implemented 3-s44 — snack SKU `upc_code` (TEXT) + `package_type` (CHECK enum) optional metadata. Migration, contracts (+`SnackPackageTypeSchema`/`SnackPackageType`), repository, POST route + `toSnackSku()`, web add-form + list rendering, and tests (repo/routes/web + rotation fixture). Typecheck clean 9/9; +6 new tests (4 API, 2 web). Status → review. |
