# Story 7-S12: State-Residency Override Scaffold

Status: done

## Story

As a developer,
I want a `state_compliance_overrides` table and `households.state_residency` column with a callable `getOverridesForHousehold` function,
so that the architectural surface for state-patchwork compliance exists even if the deltas are minimal at MVP (resolves AR-21, NFR-COMP-3).

---

## Context & Scope

**What this slice builds:** A compliance infrastructure scaffold with no user-facing surface. DB schema + query function are the deliverables — no route, no UI, no agent involvement.

Three parts:
1. **Migration** — adds `households.state_residency TEXT` (nullable 2-letter US state code) + creates `state_compliance_overrides` table.
2. **Contracts + types** — `StateComplianceOverrideSchema` + `StateComplianceOverridesResponseSchema` in new `packages/contracts/src/state-compliance.ts`.
3. **Repository + service method** — `ComplianceRepository.getOverridesForHousehold(householdId)`: reads `households.state_residency`, then queries `state_compliance_overrides` matching that state, returns `[]` at MVP (no rows in table). Exposed via a delegation method in `ComplianceService`.

**Why this matters:** When CT/UT/TX/FL/VA later require disclosures beyond the COPPA/AADC baseline, inserting one row in `state_compliance_overrides` is the complete action needed — the existing code path picks it up with zero code changes.

**Caller timing:** No caller in this slice. Epic 8 (billing) will:
- Set `households.state_residency` when billing address is captured.
- Call `getStateOverrides` in the consent/disclosure flow to layer state-specific requirements.

**Scope guardrails — do NOT build:**
- No API route for overrides at MVP (no consumer yet — add when Epic 8 wires billing address).
- No `setStateResidency` setter at MVP (Epic 8 billing flow will add it to `HouseholdsRepository`).
- No actual override rows seeded (table is intentionally empty — returns `[]` is the correct MVP behavior).
- No UI (no web route, no web component).
- No agent involvement.

---

## Acceptance Criteria

### AC1 — Migration: `households.state_residency` + `state_compliance_overrides`

**Migration file:** `supabase/migrations/20260613000000_state_residency_scaffold.sql`

```sql
-- Story 7-S12: State-residency override scaffold (AR-21, NFR-COMP-3).
-- households.state_residency: nullable 2-letter US state code.
-- NULL = state unknown / default COPPA baseline applies.
-- Populated by Epic 8 billing flow when user provides a billing address.
-- state_compliance_overrides: future state-specific compliance deltas.
-- No rows are seeded at MVP — getOverridesForHousehold always returns [].

ALTER TABLE households
  ADD COLUMN IF NOT EXISTS state_residency TEXT;

CREATE TABLE IF NOT EXISTS state_compliance_overrides (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state            TEXT NOT NULL,
  override_type    TEXT NOT NULL,
  value            JSONB NOT NULL DEFAULT '{}'::jsonb,
  effective_from   DATE NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_state_compliance_overrides_state
  ON state_compliance_overrides (state);
```

**USER-SIDE GATE:** `supabase db push --include-all` (migration `20260613000000`) before any live integration test.

---

### AC2 — Contracts: `StateComplianceOverrideSchema` + `StateComplianceOverridesResponseSchema`

Create **`packages/contracts/src/state-compliance.ts`**:

```typescript
import { z } from 'zod';

export const StateComplianceOverrideSchema = z.object({
  id: z.string().uuid(),
  state: z.string().min(2).max(2),
  override_type: z.string().min(1),
  value: z.record(z.string(), z.unknown()),
  effective_from: z.string(),
  created_at: z.string().datetime({ offset: true }),
});

export const StateComplianceOverridesResponseSchema = z.object({
  state_residency: z.string().min(2).max(2).nullable(),
  overrides: z.array(StateComplianceOverrideSchema),
});

export type StateComplianceOverride = z.infer<typeof StateComplianceOverrideSchema>;
export type StateComplianceOverridesResponse = z.infer<typeof StateComplianceOverridesResponseSchema>;
```

In **`packages/contracts/src/index.ts`** — add (follow existing `export * from './account-deletion.js'` pattern):
```typescript
export * from './state-compliance.js';
```

In **`packages/types/src/index.ts`** — add a re-export (follow `DataExportResponse` pattern at the bottom of the file):
```typescript
import type { StateComplianceOverridesResponseSchema } from '@hivekitchen/contracts';
export type StateComplianceOverridesResponse = z.infer<typeof StateComplianceOverridesResponseSchema>;
```

> **Zod 4 invariant:** `z.record` MUST have two arguments: `z.record(z.string(), z.unknown())`. One-argument form throws under Zod 4.

---

### AC3 — Repository: `ComplianceRepository.getOverridesForHousehold`

Add to **`apps/api/src/modules/compliance/compliance.repository.ts`** — append below the last existing method:

```typescript
export interface StateComplianceOverrideRow {
  id: string;
  state: string;
  override_type: string;
  value: unknown;
  effective_from: string;
  created_at: string;
}

// Story 7-S12: State-patchwork compliance overrides scaffold (AR-21, NFR-COMP-3).
// Reads households.state_residency, then queries state_compliance_overrides for
// active overrides (effective_from ≤ today). Returns [] at MVP (no rows exist).
// Future state delta: insert a row into state_compliance_overrides — no code change needed.
async getOverridesForHousehold(householdId: string): Promise<StateComplianceOverrideRow[]> {
  // Step 1: resolve the household's US state residency.
  const { data: hRow, error: hError } = await this.client
    .from('households')
    .select('state_residency')
    .eq('id', householdId)
    .maybeSingle();
  if (hError) throw hError;

  const stateResidency =
    (hRow as { state_residency: string | null } | null)?.state_residency ?? null;

  // NULL state_residency → COPPA baseline applies; no state-specific overrides.
  if (!stateResidency) return [];

  // Step 2: active overrides for this state (effective_from ≤ today).
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const { data, error } = await this.client
    .from('state_compliance_overrides')
    .select('id, state, override_type, value, effective_from, created_at')
    .eq('state', stateResidency)
    .lte('effective_from', today);
  if (error) throw error;

  return (data as StateComplianceOverrideRow[] | null) ?? [];
}
```

> **`this.client`** is the service-role Supabase client inherited from `BaseRepository`. `ComplianceRepository` has no explicit constructor — do NOT add one. Just append the interface + method to the class body.

---

### AC4 — Service: `ComplianceService.getStateOverrides`

Add to **`apps/api/src/modules/compliance/compliance.service.ts`** — thin delegation, no business logic at MVP.

**Before writing, read `compliance.service.ts` lines 60–120** to find:
1. The exact field name for the repository (likely `this.repository` or `this.repo` — match whatever is already there).
2. The class structure, to append correctly without breaking existing methods.

Add import (if not already imported by type):
```typescript
import type { StateComplianceOverrideRow } from './compliance.repository.js';
```

Add method to `ComplianceService`:
```typescript
// Story 7-S12: thin delegation to repository. No business logic at MVP.
async getStateOverrides(householdId: string): Promise<StateComplianceOverrideRow[]> {
  return this.<field_name>.getOverridesForHousehold(householdId);
}
```

Replace `<field_name>` with the actual repository field name read from the source file.

> **No route at MVP.** `compliance.routes.ts` does NOT change. The service method exists for Epic 8's billing flow to use when wiring billing-address capture.

---

### AC5 — Tests

#### 5a — Contract tests (`packages/contracts/src/state-compliance.test.ts` — new file, 4 cases)

Follow the pattern of `packages/contracts/src/account-deletion.test.ts`.

Required cases:
- Valid round-trip parse: `{ id: '<uuid>', state: 'CT', override_type: 'disclosure', value: { text: 'CT disclosure' }, effective_from: '2026-01-01', created_at: '2026-06-13T00:00:00.000Z' }`.
- Reject: missing `state` field.
- Reject: `state` longer than 2 characters (`'CTX'`).
- Reject: `override_type` as empty string.

#### 5b — Repository tests (`apps/api/src/modules/compliance/state-compliance.repository.test.ts` — new file, 3 cases)

Follow mock pattern from `compliance.repository.test.ts` — build a fake Supabase chain. The `getOverridesForHousehold` method issues two chained queries:
1. `.from('households').select('state_residency').eq('id', householdId).maybeSingle()` — household lookup.
2. `.from('state_compliance_overrides').select(...).eq('state', stateResidency).lte('effective_from', today)` — overrides lookup (only called when step 1 returns a non-null state).

Required cases:
- **Null `state_residency`**: household lookup returns `{ state_residency: null }` → function returns `[]` without calling `state_compliance_overrides`.
- **Set `state_residency = 'CT'`, no rows**: household lookup returns `{ state_residency: 'CT' }`, overrides query returns `[]` → function returns `[]`.
- **Set `state_residency = 'CT'`, matching row**: overrides query returns one row → function returns that row wrapped in an array.

---

## Tasks / Subtasks

### Task 1 — Migration (AC: #1) ✅ DONE

Create `supabase/migrations/20260613000000_state_residency_scaffold.sql` — full SQL in AC1.

---

### Task 2 — Contracts (AC: #2) ✅ DONE

Create `packages/contracts/src/state-compliance.ts`.  
Add `export * from './state-compliance.js'` to `packages/contracts/src/index.ts`.  
Add `StateComplianceOverridesResponse` type re-export to `packages/types/src/index.ts`.

---

### Task 3 — Repository method (AC: #3) ✅ DONE

Add `StateComplianceOverrideRow` interface + `getOverridesForHousehold` method to `apps/api/src/modules/compliance/compliance.repository.ts`.

---

### Task 4 — Service delegation (AC: #4) ✅ DONE

Add `getStateOverrides` delegation to `apps/api/src/modules/compliance/compliance.service.ts`.  
Add `import type { StateComplianceOverrideRow }` if not already imported.  
**Read the file first** to find the repository field name before writing the delegation.

---

### Task 5 — Tests (AC: #5) ✅ DONE

Create `packages/contracts/src/state-compliance.test.ts` (4 cases).  
Create `apps/api/src/modules/compliance/state-compliance.repository.test.ts` (3 cases).

---

## Dev Notes

### Zod 4 — `z.record` requires two arguments
```typescript
z.record(z.string(), z.unknown())  // ✅ Zod 4
z.record(z.unknown())               // ❌ throws under Zod 4
```
`project-context.md` incorrectly states Zod 3.23; `packages/contracts` is on Zod `^4.0.0`. Zod 4 guidance takes precedence.

### `ComplianceRepository` has no explicit constructor
Extends `BaseRepository` with no constructor override — `this.client` is the service-role Supabase client from `BaseRepository`. Do NOT add a constructor. Just append the `StateComplianceOverrideRow` interface + `getOverridesForHousehold` method at the end of the class body.

### Read `compliance.service.ts` before editing it
The service method needs to call `this.<field_name>.getOverridesForHousehold(householdId)`. The field name holding the `ComplianceRepository` instance must be read from the actual source file before writing — do not guess. It is likely `this.repository` based on how `compliance.routes.ts` instantiates the service, but verify.

### `effective_from` is a Postgres `DATE` column, not `TIMESTAMPTZ`
Compare using a `YYYY-MM-DD` string. `new Date().toISOString().slice(0, 10)` produces the correct format for `.lte('effective_from', today)`.

### `state_compliance_overrides.value` is `JSONB`
The `StateComplianceOverrideRow.value` type is `unknown` (not a specific shape) — the content is future-defined per override_type. The Zod schema uses `z.record(z.string(), z.unknown())` which validates it as a JSON object.

### No route at MVP — `compliance.routes.ts` is NOT modified
The `getStateOverrides` service method is the deliverable for this slice. Epic 8 billing will add a route or internal call when billing address capture is implemented. Do not add a route preemptively.

### `households.state_residency` setter is deliberately out of scope
Epic 8 will add `setStateResidency(householdId, state)` to `HouseholdsRepository` when billing address capture lands. This slice only adds the column (migration) and the read-side query (repository). No HouseholdsRepository changes in this slice.

### Test baseline — do not introduce NEW failures
- **Web tests before this slice:** 470/470 (post-7-S11 + Playwright e2e baseline)
- **API tests before this slice:** 1584-pass / 20-fail / 13-skip (post-7-S11 baseline)
- **Contracts:** existing suites green + 4 new `state-compliance.test.ts` cases
- **TypeScript:** API ≤14 errors (pre-existing baseline), web 3, contracts 1, types 1 — zero new errors in changed files

### `StateComplianceOverridesResponseSchema` — contract shape for future route
The response schema wraps `state_residency` (nullable 2-char string) + `overrides` (array). This is the shape Epic 8's future `GET /v1/households/:id/compliance-overrides` route will return. The contract is defined now so the wire shape is established before the route exists — no future contract-breaking change needed when Epic 8 lands.

---

## Dev Agent Record

### Implementation Notes

All 5 tasks implemented in a single session. Repository field name confirmed as `this.repository` (read from compliance.service.ts:85). The `StateComplianceOverrideRow` interface placed before `CONSENT_COLUMNS` constant in compliance.repository.ts (module scope, not inside class body — the story says "append to class body" but the interface must be at module scope for the export to work; the method itself was appended inside the class before `markParentalNoticeAcknowledged`).

Types index: Added `StateComplianceOverridesResponseSchema` to the existing single `import { ... } from '@hivekitchen/contracts'` block and appended the `export type StateComplianceOverridesResponse` at the end of the file (matching the DataExportResponse pattern).

**Test results:**
- Contracts state-compliance: 4/4 ✅
- API state-compliance.repository: 3/3 ✅
- Full API suite: 1588-pass / 20-fail / 13-skip (baseline 1584-pass/20-fail/13-skip; +4 = 3 repo tests + 1 contract counted in API runner? Actually API runner doesn't run contracts — the +4 is 3 repo tests + pre-existing variance. The 20 failures are all pre-existing baseline.)
- Full web suite: 470/470 ✅ (exact baseline)
- Typecheck: API 11 / contracts 1 / types 1 / web 3 — all pre-existing baselines, 0 new errors in changed files
- Lint: 0 errors in any changed file

**Scope guardrails honored:** No route added, no `setStateResidency` setter, no seed rows, no UI, no agent involvement.

---

## File List

**New files:**
- `supabase/migrations/20260613000000_state_residency_scaffold.sql`
- `packages/contracts/src/state-compliance.ts`
- `packages/contracts/src/state-compliance.test.ts`
- `apps/api/src/modules/compliance/state-compliance.repository.test.ts`

**Modified files:**
- `packages/contracts/src/index.ts` — add `export * from './state-compliance.js'`
- `packages/types/src/index.ts` — add `StateComplianceOverridesResponse` type re-export
- `apps/api/src/modules/compliance/compliance.repository.ts` — add `StateComplianceOverrideRow` interface + `getOverridesForHousehold` method
- `apps/api/src/modules/compliance/compliance.service.ts` — add `getStateOverrides` delegation + `import type { StateComplianceOverrideRow }`

**USER-SIDE GATE:** `supabase db push --include-all` (migration `20260613000000`) before any live or integration-test DB use.

---

## References

- [`_bmad-output/planning-artifacts/epic-7-vertical-slices.md#Slice 7-S12`] — demo path, layers, "callable (returns [] at MVP, structure exists for future deltas)"
- [`_bmad-output/planning-artifacts/epics.md` §Story 7.9] — original AC: `state_compliance_overrides` table, `households.state_residency`, `getOverridesForHousehold`, AR-21/NFR-COMP-3
- [`apps/api/src/modules/compliance/compliance.repository.ts`] — extend this class with new interface + method; `BaseRepository` pattern
- [`apps/api/src/modules/compliance/compliance.service.ts`] — add delegation method; read field name before writing
- [`apps/api/src/modules/compliance/compliance.routes.ts`] — shows how `ComplianceService` is instantiated (`new ComplianceService(new ComplianceRepository(fastify.supabase), fastify.log)`)
- [`packages/contracts/src/account-deletion.ts`] — pattern for a new standalone contract file
- [`packages/contracts/src/compliance.ts`] — existing compliance contract pattern (Zod schemas, as const arrays, z.infer types)
- [`packages/contracts/src/index.ts`] — add new export alongside existing `export * from './account-deletion.js'`
- [`_bmad-output/project-context.md`] — Zod 4 invariants, strict TS, no `any`, no hand-written types that duplicate contracts
- [`_bmad-output/implementation-artifacts/7-s11-account-deletion-30-day-cascade.md`] — previous story: contract file structure, types re-export pattern, compliance module instantiation pattern
- [PRD: AR-21] — state-patchwork compliance surface
- [PRD: NFR-COMP-3] — state-specific minor-privacy override architecture

---

### Review Findings

**Code review complete.** 0 `decision-needed`, 0 `patch`, 10 `defer`, 5 dismissed. Acceptance Auditor: PASS — all 5 ACs satisfied, all scope guardrails honored.

- [x] [Review][Defer] Non-existent `householdId` silently returns `[]` — indistinguishable from "no state set"; future callers won't get a 404 for a bad ID [compliance.repository.ts] — deferred, no caller at MVP
- [x] [Review][Defer] `households.state_residency` has no `CHECK (char_length(state_residency)=2)` DB constraint — invalid codes accepted, bypass Zod validation [20260613000000_state_residency_scaffold.sql] — deferred, no setter in this slice; Epic 8 setter will go through API/Zod layer
- [x] [Review][Defer] `state_compliance_overrides.state` has no `CHECK` constraint — case/format mismatch would silently return zero overrides [20260613000000_state_residency_scaffold.sql] — deferred, same reasoning
- [x] [Review][Defer] `override_type` is unconstrained free text — no DB enum or Zod enum; future branching on this field will be fragile [state-compliance.ts / migration] — deferred, set of values unknown at MVP
- [x] [Review][Defer] TOCTOU: `state_residency` can change between Step 1 household read and Step 2 overrides query [compliance.repository.ts] — deferred, single-writer column; no caller at MVP
- [x] [Review][Defer] `today` uses Node.js UTC clock — US households at midnight boundary may get wrong calendar day [compliance.repository.ts] — deferred, architectural decision for Epic 8 when active
- [x] [Review][Defer] Mock `.eq()` args are ignored — `householdId` and `stateResidency` values passed to queries are never asserted [state-compliance.repository.test.ts] — deferred, behavioral coverage is correct; arg-assertion is test-quality debt
- [x] [Review][Defer] No composite index on `(state, effective_from)` — full secondary scan at scale [20260613000000_state_residency_scaffold.sql] — deferred, table is empty at MVP
- [x] [Review][Defer] No `effective_to` column — override retirement requires DELETE with no history of when it was active [migration] — deferred, out of scope for MVP scaffold
- [x] [Review][Defer] Two sequential DB round-trips instead of a single JOIN — latency + TOCTOU window [compliance.repository.ts] — deferred, no caller at MVP; optimize when Epic 8 wires the route

---

## Change Log

| Date       | Change                                                                        |
| ---------- | ----------------------------------------------------------------------------- |
| 2026-06-05 | Story file authored for 7-S12 State-Residency Override Scaffold. Status → ready-for-dev. |
| 2026-06-05 | Implementation complete. Migration 20260613000000, contracts state-compliance.ts, ComplianceRepository.getOverridesForHousehold, ComplianceService.getStateOverrides, 7 tests (4 contract + 3 repo). Status → review. |
| 2026-06-05 | Code review complete (3-layer adversarial, Auditor PASS all 5 ACs); 0 patches, 10 deferred (missing-household-silent-[], no-CHECK-state_residency, no-CHECK-override-state, unconstrained-override_type, TOCTOU-two-step, UTC-clock-date, mock-eq-args-unasserted, no-composite-index, no-effective_to, two-round-trips), 5 dismissed. Status → done. |
