# Story 7-S13: Payload-Scrubbing Primitive

Status: done

## Story

As a developer,
I want a `scrubForSharing(payload)` utility that removes all Safety-Classified-Sensitive fields from an arbitrary payload object,
so that any future trusted-circle recipe sharing surface cannot accidentally leak child PII (PRD §10, architecture cross-cutting 12).

---

## Context & Scope

**What this slice builds:** A pure API-side utility function. No migration, no contracts package, no route, no web UI, no agent involvement. One new file plus its colocated test.

Two deliverables:
1. **`apps/api/src/modules/compliance/payload-scrubber.ts`** — exports `scrubForSharing(payload)` using an exported `SAFETY_CLASSIFIED_SENSITIVE_FIELDS` constant (a `ReadonlySet<string>`) that enumerates the five fields classified as Safety-Classified-Sensitive under NFR-SEC-1.
2. **`apps/api/src/modules/compliance/payload-scrubber.test.ts`** — colocated unit tests proving the scrubber strips exactly the right fields and leaves everything else intact.

**Why this matters:** Any future sharing surface (trusted-circle recipe sharing, print export, share-by-link) must pass payloads through `scrubForSharing` before egress. Building the primitive now — while the compliance module is actively in-flight — anchors the PII boundary in a named, testable artifact rather than ad-hoc field deletions scattered across future stories.

**Built but unused at MVP:** No caller exists in this slice. The function is defined, exported, and tested. Future stories wire it in.

**Scope guardrails — do NOT build:**
- No migration (no DB change).
- No Zod schema in `packages/contracts` (the scrubber operates on `Record<string, unknown>` — no typed shape needed at this level).
- No route in `compliance.routes.ts`.
- No service or repository method.
- No changes to `packages/types`.
- No web UI.
- No agent involvement.

**Safety-Classified-Sensitive fields (NFR-SEC-1, PRD §10):**

| Field | Rationale |
|---|---|
| `child_name` | Child-identifying PII |
| `declared_allergens` | Medical-grade child health data |
| `cultural_identifiers` | Protected cultural/religious identifiers |
| `dietary_preferences` | Lifestyle/health preference data |
| `child_rating` | Per-child preference signal tied to child identity |

---

## Acceptance Criteria

### AC1 — `payload-scrubber.ts`: `SAFETY_CLASSIFIED_SENSITIVE_FIELDS` constant

Create **`apps/api/src/modules/compliance/payload-scrubber.ts`**:

```typescript
const SAFETY_CLASSIFIED_SENSITIVE_FIELDS: ReadonlySet<string> = new Set([
  'child_name',
  'declared_allergens',
  'cultural_identifiers',
  'dietary_preferences',
  'child_rating',
]);
```

- The constant is exported so tests can assert membership without duplicating the list.
- Type is `ReadonlySet<string>` — callers can check `.has(field)` but cannot mutate.
- No external dependencies. No Zod, no Supabase, no logger.

---

### AC2 — `payload-scrubber.ts`: `scrubForSharing` function

In the same file, export:

```typescript
export function scrubForSharing(payload: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (!SAFETY_CLASSIFIED_SENSITIVE_FIELDS.has(key)) {
      result[key] = value;
    }
  }
  return result;
}
```

Behavioral contract:
- **Strips** every key whose name appears in `SAFETY_CLASSIFIED_SENSITIVE_FIELDS`.
- **Preserves** every other key and its value, unchanged (including `null`, `undefined`, arrays, nested objects — no deep-clone needed beyond the top-level loop).
- **Returns a new object** — the original `payload` is not mutated.
- **Shallow only** — nested objects are not recursively scrubbed. The function operates on the top-level keys of the payload, as per the slice spec.

---

### AC3 — Tests: `payload-scrubber.test.ts` (colocated, 5 cases)

Create **`apps/api/src/modules/compliance/payload-scrubber.test.ts`**.

Follow the vitest + `describe`/`it`/`expect` pattern from `state-compliance.repository.test.ts`.

**Fixture** (shared across cases):
```typescript
const FIXTURE = {
  child_name: 'Layla',
  declared_allergens: ['peanut'],
  cultural_identifiers: ['bengali'],
  dietary_preferences: ['no-meat-tue'],
  child_rating: 4,
  // Non-sensitive recipe fields that must survive:
  recipe_id: 'rec-abc123',
  recipe_name: 'Pasta Primavera',
  prep_time_minutes: 20,
  ingredients: [{ name: 'pasta', amount: '200g' }],
};
```

**Required cases:**

1. **Strips all five sensitive fields:**
   ```
   const result = scrubForSharing(FIXTURE);
   expect(result).not.toHaveProperty('child_name');
   expect(result).not.toHaveProperty('declared_allergens');
   expect(result).not.toHaveProperty('cultural_identifiers');
   expect(result).not.toHaveProperty('dietary_preferences');
   expect(result).not.toHaveProperty('child_rating');
   ```

2. **Preserves all non-sensitive recipe fields intact:**
   ```
   expect(result.recipe_id).toBe('rec-abc123');
   expect(result.recipe_name).toBe('Pasta Primavera');
   expect(result.prep_time_minutes).toBe(20);
   expect(result.ingredients).toEqual([{ name: 'pasta', amount: '200g' }]);
   ```

3. **Does not mutate the original payload:**
   ```
   const original = { ...FIXTURE };
   scrubForSharing(original);
   expect(original).toHaveProperty('child_name', 'Layla');
   expect(original).toHaveProperty('declared_allergens');
   ```

4. **Payload with no sensitive fields passes through unchanged:**
   ```
   const safe = { recipe_id: 'rec-xyz', calories: 350 };
   expect(scrubForSharing(safe)).toEqual({ recipe_id: 'rec-xyz', calories: 350 });
   ```

5. **Payload of only sensitive fields returns empty object:**
   ```
   const pii = { child_name: 'Layla', declared_allergens: ['peanut'] };
   expect(scrubForSharing(pii)).toEqual({});
   ```

---

## Tasks / Subtasks

### Task 1 — [x] Create `payload-scrubber.ts` (AC: #1, #2)

Create `apps/api/src/modules/compliance/payload-scrubber.ts` with:
- Exported `SAFETY_CLASSIFIED_SENSITIVE_FIELDS: ReadonlySet<string>` (the 5 fields).
- Exported `scrubForSharing(payload: Record<string, unknown>): Record<string, unknown>`.

No imports needed. File is self-contained.

---

### Task 2 — [x] Create `payload-scrubber.test.ts` (AC: #3)

Create `apps/api/src/modules/compliance/payload-scrubber.test.ts` with 5 test cases.

Import only from vitest + the local file:
```typescript
import { describe, it, expect } from 'vitest';
import { scrubForSharing } from './payload-scrubber.js';
```

---

### Task 3 — [x] Verify

Run:
```
pnpm --filter @hivekitchen/api test -- --reporter=verbose payload-scrubber
```

All 5 cases must pass. No new TypeScript errors in changed files.

### Review Findings

- [x] [Review][Decision] `child_name` key vs actual `name` field in children contracts — **Resolved: intentional.** The constant defines canonical key names for future *sharing payloads*, not raw DB/contract field names. Future sharing routes must compose a clean payload using `child_name` (not the raw `name` from children records) before calling `scrubForSharing`. Same rationale applies to `child_rating` (no current field with that exact name; sharing routes will use it as the semantic key). Callers are responsible for remapping.
- [x] [Review][Defer] Shallow scrub — no enforcement that callers pre-flatten nested PII [`apps/api/src/modules/compliance/payload-scrubber.ts`] — deferred, shallow-only is explicit spec design; future sharing-route stories must document and enforce the pre-flatten requirement at their call site
- [x] [Review][Defer] No test for shallow-only boundary — nested object whose child key is a sensitive name is preserved, not scrubbed [`apps/api/src/modules/compliance/payload-scrubber.test.ts`] — deferred, spec defines exactly 5 test cases; boundary test is out of current scope
- [x] [Review][Defer] Case-sensitive Set matching — camelCase/mixed-case variants of sensitive keys bypass scrubbing silently [`apps/api/src/modules/compliance/payload-scrubber.ts`] — deferred, snake_case is project convention; add normalization if a camelCase sharing surface is ever built
- [x] [Review][Defer] Array-of-records input unguarded — TypeScript excludes arrays but a caller-side cast bypasses the type check silently [`apps/api/src/modules/compliance/payload-scrubber.ts`] — deferred, no callers at MVP; add overload or array guard when first array-shaped sharing route is built
- [x] [Review][Defer] Null input throws runtime TypeError — `Object.entries(null)` throws; no defensive guard or test [`apps/api/src/modules/compliance/payload-scrubber.ts`] — deferred, TypeScript type excludes null; add guard if untyped call paths emerge

---

## Dev Notes

### Shallow scrub only
The function removes top-level keys. Nested objects (e.g. a `child_profile` object containing a `child_name` key) are NOT recursively scrubbed. This matches the slice spec: the primitive operates on payload-root keys. If deep scrubbing is needed in a future caller, that caller provides a pre-flattened payload or a dedicated scrubber for its shape.

### `ReadonlySet<string>` — the field list is the right export
Exporting `SAFETY_CLASSIFIED_SENSITIVE_FIELDS` allows future callers to check `.has(field)` for gating decisions without coupling to the implementation. Tests import it to assert membership. The export is intentional — it's the canonical source of truth for what "Safety-Classified-Sensitive" means in this codebase.

### No Zod schema — `Record<string, unknown>` is the right type
The scrubber accepts any payload shape. Adding a Zod schema would require callers to know the exact shape up front, which contradicts the "applies to any sharing surface" design. `Record<string, unknown>` is the appropriate TypeScript type for a shape-agnostic utility.

### No service or repository method
The function is a pure utility — no dependency on `ComplianceService`, `ComplianceRepository`, or any Supabase client. It is colocated in the compliance module because its concern (PII boundary on sharing) is compliance-domain, not because it needs any compliance infrastructure.

### No changes to `compliance.routes.ts`, `compliance.service.ts`, or `compliance.repository.ts`
This slice adds exactly two files. No existing compliance module files change.

### Test baseline — do not introduce NEW failures
- **Web tests before this slice:** 470/470 (post-7-S12 baseline)
- **API tests before this slice:** 1588-pass / 20-fail / 13-skip (post-7-S12 baseline)
- **TypeScript before this slice:** API 11 / contracts 1 / types 1 / web 3 — all pre-existing
- The 5 new test cases add to the passing count; the failing 20 are pre-existing unrelated failures
- Zero new errors in changed files

### `child-level rating` → `child_rating`
The epics.md spec says "child-level rating" as the display name; the snake_case field name for the payload key is `child_rating`. Both the constant and the tests use `child_rating`.

---

## Dev Agent Record

### Implementation Notes

Implemented exactly as specified — two self-contained files, no existing compliance module files touched.

- **`payload-scrubber.ts`**: exports `SAFETY_CLASSIFIED_SENSITIVE_FIELDS` (`ReadonlySet<string>`, 5 fields) and `scrubForSharing(payload)`. No imports — zero external dependencies (no Zod, Supabase, or logger). Shallow strip via `Object.entries` loop into a fresh object; original payload never mutated.
- **`payload-scrubber.test.ts`**: 5 colocated vitest cases following the `describe/it/expect` pattern from `state-compliance.repository.test.ts` (no mocking framework needed — pure function).

### Completion Notes

- **Tests:** 5/5 pass (`pnpm --filter @hivekitchen/api test -- --reporter=verbose payload-scrubber`).
- **TypeScript:** zero errors in either new file (`tsc --noEmit`, grep for `payload-scrubber` → none). Pre-existing baseline errors elsewhere untouched.
- **Scope:** No migration, no contracts, no route, no service/repository change, no `packages/types` change, no web UI, no agent involvement — per the slice guardrails.
- **Built but unused at MVP:** no caller wires `scrubForSharing` in yet; the primitive is defined, exported, and tested for future sharing surfaces.

---

## File List

**New files:**
- `apps/api/src/modules/compliance/payload-scrubber.ts`
- `apps/api/src/modules/compliance/payload-scrubber.test.ts`

**Modified files:** _none_

---

## References

- [`_bmad-output/planning-artifacts/epic-7-vertical-slices.md#Slice 7-S13`] — demo path (negative-test: fixture with child_name/declared_allergens/cultural_identifiers/dietary_preferences → all stripped, recipe data intact), layers (API only), PRD codes
- [`_bmad-output/planning-artifacts/epics.md` §Story 7.10] — original AC: `scrubForSharing(payload)` removes all Safety-Classified-Sensitive fields, built but unused at MVP
- [PRD NFR-SEC-1] — canonical list of Safety-Classified-Sensitive fields (allergens, Heart Note content, cultural identifiers, dietary preferences, caregiver relationships)
- [PRD §10 / architecture cross-cutting 12] — payload-scrubbing primitive requirement for future sharing surface
- [`apps/api/src/modules/compliance/state-compliance.repository.test.ts`] — vitest pattern for compliance module tests (describe/it/expect, no mocking framework)
- [`_bmad-output/implementation-artifacts/7-s12-state-residency-override-scaffold.md`] — previous story: compliance module colocation, test baseline, no-constructor pattern

---

## Change Log

| Date       | Change                                                                         |
| ---------- | ------------------------------------------------------------------------------ |
| 2026-06-05 | Story file authored for 7-S13 Payload-Scrubbing Primitive. Status → ready-for-dev. |
| 2026-06-05 | Implemented payload-scrubber.ts + payload-scrubber.test.ts (5/5 pass, 0 new TS errors). All 3 tasks / 3 ACs complete. Status → review. |
