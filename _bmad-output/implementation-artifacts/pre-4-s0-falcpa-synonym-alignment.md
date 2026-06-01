# Story pre-4-s0: FALCPA Synonym Alignment

Status: done

## Story

As the HiveKitchen allergy guardrail,
I want onboarding chip keys and stored allergen strings to match the canonical FALCPA_SYNONYMS keys exactly,
so that every child declared allergic via onboarding receives full synonym-expansion protection at plan-generation time.

## Safety Context

This is a **⚠️ SAFETY fix**. Story 2.6-s7 renamed the guardrail engine's canonical allergen keys from plural to singular forms (`eggs→egg`, `tree_nuts→tree_nut`). The M2 onboarding chip set and stored allergen data were not updated. As a result:

- A child declared allergic to `'eggs'` via onboarding has `allergen: 'eggs'` stored.
- At plan time, `targetsFor('eggs')` returns `['eggs']` only — `FALCPA_SYNONYMS['eggs']` does not exist as a key.
- Synonyms (mayo, albumin, aioli, meringue, hollandaise) are **never checked** for that child.
- Same for `'tree-nuts'` → almond, walnut, cashew, pecan, etc. are never checked.

**Source:** deferred-work.md → "code review of 3-24" ⚠️ SAFETY entry; "code review of 2.6-s7" stale-key entry.

## Acceptance Criteria

1. **Given** the M2 chip configuration in `onboarding.service.ts`,
   **When** a parent selects the "Eggs" chip,
   **Then** the stored allergen key is `'egg'` (canonical), not `'eggs'` (plural).

2. **Given** the M2 chip configuration in `onboarding.service.ts`,
   **When** a parent selects the "Tree nuts" chip,
   **Then** the stored allergen key is `'tree_nut'` (underscored singular), not `'tree-nuts'` (hyphenated plural).

3. **Given** all 9 M2 chip keys (peanut, tree_nut, dairy, egg, soy, wheat, fish, shellfish, sesame),
   **When** `targetsFor(key)` is called on each,
   **Then** each returns a non-empty synonym array matching `FALCPA_SYNONYMS[key]`.

4. **Given** households/children that onboarded before this fix (with `allergen: 'eggs'` or `allergen: 'tree-nuts'` stored),
   **When** the backfill migration script runs,
   **Then** all `child_allergens` rows and `households.declared_allergens` arrays with stale plural/hyphenated keys are normalized to canonical form, decrypted and re-encrypted under the same DEK.

5. **Given** an existing allergen declaration of `'egg'` (canonical) in `child_allergens`,
   **When** the backfill script runs,
   **Then** the row is untouched (idempotent).

6. **Given** all 8 FALCPA canonical allergen keys plus sesame,
   **When** a unit test calls the guardrail engine's `targetsFor` (or `evaluate`) with each canonical key as a parent_declared rule,
   **Then** at least one well-known synonym per allergen is correctly detected in ingredient text (e.g., `'mayo'` for `egg`, `'almond'` for `tree_nut`, `'butter'` for `dairy`).

## Tasks / Subtasks

### Task 1 — Fix M2 Chip Keys in `onboarding.service.ts` (AC: 1, 2, 3)

**File:** `apps/api/src/modules/onboarding/onboarding.service.ts`

The M2 chip config is returned from the `getChipConfig` switch/case at around line 258. Current (broken) values:

```typescript
{ key: 'eggs',      label: 'Eggs' },       // ← WRONG: should be 'egg'
{ key: 'tree-nuts', label: 'Tree nuts' },   // ← WRONG: should be 'tree_nut'
```

Change to:

```typescript
{ key: 'egg',      label: 'Eggs' },
{ key: 'tree_nut', label: 'Tree nuts' },
```

All other M2 keys (`peanut`, `dairy`, `soy`, `wheat`, `fish`, `shellfish`, `sesame`) already match `FALCPA_SYNONYMS` canonical keys — do NOT change them.

- [x] Update `key: 'eggs'` → `key: 'egg'` in the M2 choice options
- [x] Update `key: 'tree-nuts'` → `key: 'tree_nut'` in the M2 choice options
- [x] Verify no other `case` in the switch emits the old broken keys

### Task 2 — Write Backfill Migration Script (AC: 4, 5)

**File:** `apps/api/scripts/backfill-falcpa-allergen-keys.ts`

This is a **one-shot operator script** (same pattern as `backfill-child-allergens.ts`). It:

1. Paginates through all `child_allergens` rows
2. For each row: decrypt `allergen`, normalize if stale key, re-encrypt, UPDATE
3. Paginates through all `households` with non-null `declared_allergens`
4. For each household: decrypt array, normalize any stale keys, re-encrypt, UPDATE

**Stale key normalization map** (only these two need fixing):

```typescript
const KEY_MAP: Record<string, string> = {
  'eggs':      'egg',
  'tree-nuts': 'tree_nut',
  // all others already canonical — no entry needed
};
```

**Pattern to follow:** `apps/api/scripts/backfill-child-allergens.ts` for:
- DEK rehydration via `getHouseholdDek()`
- Pagination via Supabase range queries
- `--dry-run` flag that logs `would_update` without writing
- Stdout counters: `rows_scanned`, `rows_updated`, `rows_skipped`, `households_scanned`, `households_updated`
- No Pino — `console.log` is acceptable for operator scripts (consistent with existing backfill scripts)

**Important invariants:**
- Skip rows where decrypted allergen is already canonical (idempotent)
- Preserve ALL other fields on the row unchanged
- The `allergen_hash` in `child_allergens` stores `normalizedHash(allergen)` — recompute and UPDATE this too when the key changes (the hash uses SHA-256 of the allergen string; see `envelope-encryption.ts`)
- For `households.declared_allergens`: decrypt the JSONB array, normalize, re-encrypt the full array, UPDATE
- `kitchen_map_version` bump on households with updated `declared_allergens` — use the existing trigger (it fires on UPDATE of `households` rows, which `declared_allergens` patching will trigger)

```typescript
// Subtask checklist:
- [x] Script accepts `--dry-run` flag
- [x] Paginates child_allergens in batches of 100 ordered by household_id, then child_id
- [x] DEK cached per household_id for the run (avoid re-fetching for each row)
- [x] Normalizes 'eggs'→'egg' and 'tree-nuts'→'tree_nut' only (plus 'tree_nuts' alt spelling)
- [x] Recomputes allergen_hash after normalization
- [x] Paginates households for declared_allergens normalization
- [x] Prints summary counters at end
- [x] Script is re-runnable safely (idempotent)
```

### Task 3 — Add Synonym Expansion Test Suite (AC: 3, 6)

**File:** `apps/api/src/modules/allergy-guardrail/allergy-rules.engine.test.ts` (or colocated test)

Add a `describe('FALCPA synonym expansion — canonical key coverage')` block asserting:

For each canonical key, a known synonym in an ingredient list triggers a `blocked` verdict when a `parent_declared` rule exists for that key:

| Canonical Key | Test Ingredient | Expected Verdict |
|---|---|---|
| `peanut` | `'groundnut paste'` | `blocked` |
| `tree_nut` | `'sliced almonds'` | `blocked` |
| `dairy` | `'butter'` | `blocked` |
| `egg` | `'mayonnaise'` | `blocked` |
| `wheat` | `'semolina'` | `blocked` |
| `soy` | `'edamame'` | `blocked` |
| `fish` | `'worcestershire'` | `blocked` |
| `shellfish` | `'calamari'` | `blocked` |
| `sesame` | `'tahini'` | `blocked` |

Also assert the two previously broken keys now work:
- `egg` key + `'albumin'` ingredient → `blocked`
- `tree_nut` key + `'cashews'` ingredient → `blocked`

- [x] Write synonym expansion test suite covering all 9 canonical keys
- [x] Assert the two previously broken keys (egg, tree_nut) detect their synonyms
- [x] Tests use isolated `AllergyRulesEngine` with synthetic rules — no DB calls

### Task 4 — Verify `resolveAllergen` in onboarding tools (AC: 1, 2)

**File:** `apps/api/src/agents/tools/onboarding.tools.ts`

The `allergen.declare` tool handler calls `vocabularyService.resolveAllergen(key)` before storing. After the chip key fix in Task 1:
- `resolveAllergen('egg')` must return a valid resolved allergen (or the canonical key itself)
- `resolveAllergen('tree_nut')` must return a valid resolved allergen

If `resolveAllergen` uses the `allergen_tags` table (which 2.6-s7 updated to canonical keys), this should work. Verify with a quick test against the existing `onboarding.tools.test.ts` — the 5 pre-existing mock failures from 2.6-s1 were fixed in 2.6-s8, so the test suite should be in a known-green state.

- [x] Confirm `onboarding.tools.test.ts` is fully green before starting this story (note: 1 pre-existing failure in `createFavoriteLunchAddToolSpec > "uses explicit position when the agent supplies one"` — unrelated to this story; exists on baseline `main`)
- [x] Confirm `resolveAllergen('egg')` and `resolveAllergen('tree_nut')` succeed — both are canonical PKs in `allergen_tags` (see migration `20260820000100_create_vocabulary_tables.sql` lines 229, 231)
- [x] VocabularyService has no hardcoded allowlist; `resolveAllergen` reads from in-memory `allergens` map populated from `allergen_tags`, which carries `egg`/`tree_nut` as canonical keys

## Dev Notes

### What Changed in 2.6-s7 (Root Cause)

Story 2.6-s7 (`allergy-rules-drop-guardrail-swap-to-allergen-tags`) renamed all guardrail engine canonical keys from plural to singular: `eggs→egg`, `tree_nuts→tree_nut`, `peanuts→peanut`, `milk→dairy`. The `FALCPA_SYNONYMS` object in `allergy-rules.engine.ts` now uses the new canonical forms as keys. The onboarding chip set in `onboarding.service.ts` was NOT updated. The `allergen_tags` DB table was updated to use canonical keys.

### The Exact Lookup Failure

`FALCPA_SYNONYMS` is keyed by canonical allergen name. The engine's `targetsFor(allergen)` function does `FALCPA_SYNONYMS[allergen] ?? []` (or similar). When `allergen = 'eggs'`, `FALCPA_SYNONYMS['eggs']` is `undefined`; `FALCPA_SYNONYMS['egg']` has the synonym list. The string `'eggs'` IS listed as a value in `FALCPA_SYNONYMS.egg`, but it's not a key — so direct lookup fails.

### Files to Touch

| File | Change |
|---|---|
| `apps/api/src/modules/onboarding/onboarding.service.ts` | Fix M2 chip keys (lines ~258-277) |
| `apps/api/scripts/backfill-falcpa-allergen-keys.ts` | New script — create from scratch |
| `apps/api/src/modules/allergy-guardrail/allergy-rules.engine.test.ts` | New test block |
| (verify only) `apps/api/src/agents/tools/onboarding.tools.ts` | Confirm resolveAllergen handles canonical keys |

### Do NOT Touch

- `FALCPA_SYNONYMS` in `allergy-rules.engine.ts` — the engine is correct. Fix is in the chip layer.
- `allergen_tags` table — already updated by 2.6-s7.
- Any M2 chip labels (user-visible strings) — only the internal `key` values change.
- `peanut`, `dairy`, `soy`, `wheat`, `fish`, `shellfish`, `sesame` chip keys — already canonical.

### Encryption Pattern

Allergen values in `child_allergens.allergen` and `households.declared_allergens` are encrypted using `encryptField` / `decryptField` under the household DEK. The DEK is fetched via `getHouseholdDek(client, kek, householdId)`. Pattern is established in `backfill-child-allergens.ts` and `migrate-favorite-lunches.ts` — follow those exactly.

### allergen_hash Recomputation

`child_allergens.allergen_hash` stores `normalizedHash(plaintext_allergen)`. The hash is used for idempotency. After normalizing `'eggs'→'egg'`, the hash must be recomputed:

```typescript
import { normalizedHash } from '../../lib/envelope-encryption.js';
const newHash = normalizedHash(canonicalKey);
```

See `apps/api/src/lib/envelope-encryption.ts` for the `normalizedHash` function.

### Deploy Sequence

```
1. Apply no migrations (no schema changes needed)
2. Deploy updated code (new chip keys, new script)
3. Run: pnpm --filter @hivekitchen/api exec tsx scripts/backfill-falcpa-allergen-keys.ts --dry-run
4. Verify dry-run output — rows_scanned > 0, would_update shows only 'eggs'/'tree-nuts' rows
5. Run: pnpm --filter @hivekitchen/api exec tsx scripts/backfill-falcpa-allergen-keys.ts
6. Verify counters match dry-run would_update counts
```

### Project Structure Notes

- Script lives in `apps/api/scripts/` — consistent with `backfill-child-allergens.ts`, `migrate-favorite-lunches.ts`
- ESM: use `import.meta.url` + `fileURLToPath` if `__dirname` needed; no `require()`
- No `console.*` in API source files — but scripts are exempt (operator visibility)
- Import path: relative `.js` extensions required in `apps/api` emitted JS

### References

- Deferred-work: [Source: `_bmad-output/implementation-artifacts/deferred-work.md` — "code review of 3-24" ⚠️ SAFETY entry]
- Deferred-work: [Source: `_bmad-output/implementation-artifacts/deferred-work.md` — "code review of 2.6-s7" stale-key entry]
- FALCPA_SYNONYMS: [Source: `apps/api/src/modules/allergy-guardrail/allergy-rules.engine.ts` lines 38–94]
- M2 chip config: [Source: `apps/api/src/modules/onboarding/onboarding.service.ts` lines ~258–277]
- Backfill pattern: [Source: `apps/api/scripts/backfill-child-allergens.ts`]
- Hash function: [Source: `apps/api/src/lib/envelope-encryption.ts` — `normalizedHash`]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.7 (1M context) — bmad-dev-story workflow

### Debug Log References

- Targeted regression (touched modules): `pnpm --filter @hivekitchen/api exec vitest run src/modules/onboarding scripts/backfill-falcpa-allergen-keys.test.ts src/modules/allergy-guardrail` → **149/149 pass**.
- New backfill script tests: `pnpm --filter @hivekitchen/api exec vitest run scripts/backfill-falcpa-allergen-keys.test.ts` → **8/8 pass**.
- New synonym expansion tests: `pnpm --filter @hivekitchen/api exec vitest run src/modules/allergy-guardrail/allergy-rules.engine.test.ts` → **61/61 pass** (50 prior + 11 new).
- Web suite for OnboardingText mocks: `pnpm --filter @hivekitchen/web exec vitest run src/features/onboarding/OnboardingText.test.tsx` → **32/32 pass**.
- Full API suite delta (this branch vs baseline `main` HEAD `ad93cbd`): **1158 vs 1129 passing** (+29 new tests), same 30 pre-existing failures across 11 unrelated test files (plans, voice, memory, etc.).

### Completion Notes List

1. **AC1 + AC2 + AC3 — M2 chip keys aligned.** `apps/api/src/modules/onboarding/onboarding.service.ts:268,270` now emits `key: 'tree_nut'` and `key: 'egg'`. The remaining 7 M2 keys were already canonical (verified). After the change, `FALCPA_SYNONYMS[key]` returns a non-empty synonym array for all 9 keys.
2. **AC4 + AC5 — Backfill script.** `apps/api/scripts/backfill-falcpa-allergen-keys.ts` decrypts each `child_allergens.allergen` under the household DEK, normalizes via the `KEY_MAP` (`eggs→egg`, `tree-nuts→tree_nut`, `tree_nuts→tree_nut`), recomputes the `allergen_hash`, and re-encrypts. The `households.declared_allergens` JSONB array is similarly normalized and de-duplicated. Already-canonical rows are skipped (idempotent). Triggers `child_allergens_bump_kitchen_map` and the households-row trigger from `20260820000000_add_kitchen_map_version.sql` fire automatically — no manual `kitchen_map_version` bump needed.
   - One edge case the spec didn't fully cover: if a household has BOTH `'egg'` (canonical) and `'eggs'` (stale) for the same child, normalizing the stale row to the canonical hash would collide with the `UNIQUE (child_id, allergen_hash)` constraint. The script handles this by DELETING the stale row instead of fighting the index (counter: `rows_deleted_dup`). Test coverage at `scripts/backfill-falcpa-allergen-keys.test.ts` `"deletes the stale row when canonical row already exists for same child"`.
3. **AC3 + AC6 — Synonym expansion test suite.** New `describe('FALCPA synonym expansion — canonical key coverage')` block in `allergy-rules.engine.test.ts` data-driven over the 9 canonical keys + the two regression-guard cases (`egg`+`albumin`, `tree_nut`+`cashews`). All 11 new tests pass.
4. **Web mock alignment.** Two web test files mocked the API chip_config response with the pre-fix keys: `apps/web/src/features/onboarding/OnboardingText.test.tsx` and `apps/web/test/e2e/2.5-s6-moment-2-what-i-need-to-keep-safe.spec.ts`. Updated to canonical keys to keep the mocks honest. (The static dev-only mockup files under `apps/web/src/features/onboarding-mockups/Moment*.tsx` were left untouched — per the story's "Do NOT Touch" guidance and per surgical-change scope; those screens don't talk to the API.)

### File List

**Modified:**
- `apps/api/src/modules/onboarding/onboarding.service.ts` — M2 chip keys: `eggs`→`egg`, `tree-nuts`→`tree_nut`
- `apps/api/src/modules/allergy-guardrail/allergy-rules.engine.test.ts` — appended `FALCPA synonym expansion — canonical key coverage` describe block (11 tests)
- `apps/web/src/features/onboarding/OnboardingText.test.tsx` — mock chip config updated to canonical keys
- `apps/web/test/e2e/2.5-s6-moment-2-what-i-need-to-keep-safe.spec.ts` — mock chip config updated to canonical keys

**New:**
- `apps/api/scripts/backfill-falcpa-allergen-keys.ts` — operator script for stored-allergen normalization (--dry-run supported)
- `apps/api/scripts/backfill-falcpa-allergen-keys.test.ts` — 8 unit tests covering normalize, idempotency, dry-run, duplicate collapse, household-array normalization, pagination, defensive non-array decrypt

### Change Log

- 2026-05-25 — Story shipped to review. M2 chip keys re-aligned to FALCPA_SYNONYMS canonical form; one-shot backfill script + tests added; synonym expansion regression suite added; web-side mocks updated to match new API contract.

### Review Findings

Code review completed 2026-05-25 — 3-layer adversarial pass (Blind Hunter, Edge Case Hunter, Acceptance Auditor).

**Patches (9):**
- [x] [Review][Patch] P1: OFFSET pagination skips rows on delete — both Pass 1 and Pass 2 use `.range(offset, ...)` while mutating the table; any deleted row in page N shifts page N+1, silently skipping rows and leaving stale allergen keys in production [apps/api/scripts/backfill-falcpa-allergen-keys.ts:121-148,154-180] — fix: order by `id`, use keyset pagination `gt('id', lastId)` instead of `range(offset, ...)`
- [x] [Review][Patch] P2: `canonicalize()` is case-sensitive and doesn't trim — `'Eggs'`, `'TREE-NUTS'`, `' eggs '` all fall through to identity; fix: `key.trim().toLowerCase()` before KEY_MAP lookup [apps/api/scripts/backfill-falcpa-allergen-keys.ts:56-58]
- [x] [Review][Patch] P3: Missing negative regression test — no test asserts that a rule with legacy key `'eggs'` does NOT expand to `'mayonnaise'`; an incomplete backfill is undetectable; fix: add a test in `allergy-rules.engine.test.ts` asserting `declareRule('eggs')` produces `cleared` (documents the known hazard) [apps/api/src/modules/allergy-guardrail/allergy-rules.engine.test.ts]
- [x] [Review][Patch] P4: Dry-run under-reports deletes — dry-run path skips the canonical-row existence check and increments `rows_updated` for rows that would be DELETED in a live run; operator sees "N updates, 0 deletions" then the real run deletes rows; fix: perform the existence check in dry-run and log `would_delete_stale_dup` [apps/api/scripts/backfill-falcpa-allergen-keys.ts:202-215]
- [x] [Review][Patch] P5: `kitchen_map_version` not invalidated after Pass 2 — Dev Completion Notes claim households trigger fires automatically, but migration `20260820000000_add_kitchen_map_version.sql` explicitly documents that `households` is NOT triggered (would recurse); script must call `bump_kitchen_map_version_for_household(id)` RPC after each `UPDATE households SET declared_allergens` [apps/api/scripts/backfill-falcpa-allergen-keys.ts:302-307]
- [x] [Review][Patch] P6: `updated_at` not set on households UPDATE — Pass 1 sets `updated_at: new Date().toISOString()` on child_allergens but Pass 2 omits it from the households update payload; inconsistent audit trail [apps/api/scripts/backfill-falcpa-allergen-keys.ts:302-307]
- [x] [Review][Patch] P7: Pre-existing duplicate canonical entries not deduplicated — `changed` flag uses element-wise inequality against `allergens`; if `declared_allergens = ['egg','egg']` (duplicate canonical keys, no stale keys), `changed` is false and dedup never runs; fix: also check `new Set(normalized).size < normalized.length` [apps/api/scripts/backfill-falcpa-allergen-keys.ts:281]
- [x] [Review][Patch] P8: Existence check for duplicate collision missing `household_id` filter — `.eq('child_id', row.child_id).eq('allergen_hash', newHash)` without `.eq('household_id', row.household_id)` could match a canonical row belonging to a different household (defensive, low probability in practice) [apps/api/scripts/backfill-falcpa-allergen-keys.ts:220-225]
- [x] [Review][Patch] P9: Windows `entryUrl` guard fragile — `file://${process.argv[1]}` produces `file://F:/...` (two slashes) while `import.meta.url` is `file:///F:/...` (three slashes) on Windows; `main()` never fires on Windows; fix: use `url.pathToFileURL(process.argv[1]).href` [apps/api/scripts/backfill-falcpa-allergen-keys.ts:352]

**Deferred (9):**
- [x] [Review][Defer] D1: Race window between existence check and UPDATE (check-then-update not atomic) — a concurrent onboarding write between the `maybeSingle()` and `update()` calls could produce a unique-violation error caught by `decrypt_failures`; acceptable for a maintenance-window script but worth noting [apps/api/scripts/backfill-falcpa-allergen-keys.ts:220-257] — deferred: one-shot operator script; run in a maintenance window or accept the transient skip
- [x] [Review][Defer] D2: Concurrent backfill runs double-count rows_updated — two instances of the script processing the same row in parallel both increment counters; deferred: document in script header that the script is not safe for concurrent execution
- [x] [Review][Defer] D3: Plaintext allergen emitted in `deleted_duplicate_stale_row` log — `{ from: plaintext, canonical }` logs decrypted allergen alongside household_id and child_id; deferred: operator script, operator has DB access; acceptable per existing backfill script conventions
- [x] [Review][Defer] D4: `decrypt_failures` counter overloaded — incremented on DB errors, unique violations, and network blips, not just decryption failures; deferred: cosmetic; op can read the log messages for context
- [x] [Review][Defer] D5: DEK `null` cached as valid — if `getHouseholdDek` returns `null` transiently, every subsequent row for that household uses the NOOP cipher; deferred: `null` DEK is a design-level contract of the cipher layer; add a guard to validate `null` only when `deps.kek === null` in a future hardening pass
- [x] [Review][Defer] D6: NOOP cipher runs silently in prod if KEK env var is unset — `console.warn` is emitted but the script continues; deferred: add `if (kek === null && process.env.NODE_ENV === 'production') throw` in a future hardening pass
- [x] [Review][Defer] D7: Stale row deletion loses `source` field audit trail — deleted row's provenance is not logged before deletion; deferred: hash integrity is sufficient; add source to the info log in a future pass
- [x] [Review][Defer] D8: DEK cache grows unboundedly — Map holds a Buffer per household for the run; deferred: one-shot script, acceptable for expected dataset sizes
- [x] [Review][Defer] D9: Empty table produces all-zero summary with no sanity warning — cannot distinguish "nothing to do" from "wrong Supabase project"; deferred: low-risk; operator should verify dry-run output shows expected row count
