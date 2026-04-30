# Story 2.12: Per-child Lunch Bag slot declaration

Status: done

## Story

As a Primary Parent,
I want to declare per child whether the Snack slot and Extra slot are active
during onboarding (Main is always active),
So that the plan generator knows which slots to fill before the first plan is composed (FR107).

## Architecture Overview

### Bag Composition Data Model

`bag_composition` is a non-PII JSONB column on `children`. Shape is fixed:

```json
{ "main": true, "snack": boolean, "extra": boolean }
```

`main` is always `true` — the API enforces this; it is not user-settable. `snack` and `extra` default to `true` (permissive default — plan generator fills all slots unless explicitly disabled).

The column does **not** use envelope encryption (not PII, confirmed by project-context.md §Encryption).

### Route Map (New)

| Method | Path | Auth | Description |
|---|---|---|---|
| PATCH | `/v1/children/:id/bag-composition` | primary_parent | Set snack/extra flags for a child |

The child `:id` is looked up by the repository using both `id` AND `household_id` from the JWT — cross-household writes return 403.

### Post-onboarding Change Semantics (FR108)

Changes take effect on the **next plan-generation cycle**, not retroactively. The plan generator (Epic 3) reads `bag_composition` at generation time. This story establishes the data contract; the plan generator is out of scope.

### Web Integration Point

The `BagCompositionCard` renders immediately after `AddChildForm` succeeds on the `/app` home page (`index.tsx`). It is not part of the onboarding flow (`onboarding.tsx`) — children are added post-onboarding on the home page.

```
AddChildForm.onSuccess(child)
  → show BagCompositionCard(child.id)
  → PATCH /v1/children/:id/bag-composition
  → onSaved() → add child to savedChildren list, close
```

The card is dismissible (skip = keep defaults). Defaults are `snack: true, extra: true`.

## Acceptance Criteria

1. **Given** Story 2.10 is complete, **When** the API starts, **Then** the `children` table has a `bag_composition JSONB NOT NULL DEFAULT '{"main":true,"snack":true,"extra":true}'::jsonb` column (via new migration). Existing rows receive the default.

2. **Given** a primary_parent JWT for household H, **When** `PATCH /v1/children/:id/bag-composition` with body `{ snack: bool, extra: bool }`, **Then** the row is updated with `{ main: true, snack, extra }`, `updated_at` is refreshed, and `200 { child: ChildResponse }` is returned (full child object including `bag_composition`).

3. **Given** `PATCH /v1/children/:id/bag-composition` called with any body containing `main: false`, **Then** `400 /errors/validation` — `main` is not a user-settable field.

4. **Given** a valid request by primary_parent whose JWT `household_id` does not match the child's `household_id`, **Then** `403 /errors/forbidden`.

5. **Given** a secondary_caregiver token, **When** `PATCH /v1/children/:id/bag-composition`, **Then** `403 /errors/forbidden`.

6. **Given** a child is added via `AddChildForm` on the home page, **When** `onSuccess(child)` fires, **Then** the `BagCompositionCard` renders for that child showing: Main slot always-on (non-interactive), Snack toggle (default on), Extra toggle (default on), a Save button, and a Skip link.

7. **Given** the parent adjusts toggles and taps Save, **When** `PATCH` succeeds, **Then** the card closes and the child appears in the saved list with updated `bag_composition`.

8. **Given** the parent taps Skip, **Then** the card closes immediately (child retains the `{"main":true,"snack":true,"extra":true}` default from the DB), and the child appears in the saved list.

9. **Given** `GET /v1/households/:id/children/:childId`, **Then** the response `ChildResponse` includes `bag_composition: { main: boolean, snack: boolean, extra: boolean }`.

10. **Given** the PATCH succeeds, **Then** an audit event `child.bag_updated` is written with `{ child_id, household_id, old: BagComposition, new: BagComposition }`.

## Tasks / Subtasks

- [x] Task 1 — DB migration: add `bag_composition` column (AC: #1)
  - [x] Create `supabase/migrations/<timestamp>_add_bag_composition_to_children.sql`
  - [x] `ALTER TABLE children ADD COLUMN bag_composition JSONB NOT NULL DEFAULT '{"main":true,"snack":true,"extra":true}'::jsonb`
  - [x] Add `CHECK (bag_composition->>'main' = 'true')` constraint to enforce main=true invariant at DB level

- [x] Task 2 — Contracts: add `BagCompositionSchema` and update `ChildResponseSchema` (AC: #2, #3, #9)
  - [x] Add `BagCompositionSchema = z.object({ main: z.literal(true), snack: z.boolean(), extra: z.boolean() })` to `packages/contracts/src/children.ts`
  - [x] Add `SetBagCompositionBodySchema = z.object({ snack: z.boolean(), extra: z.boolean() }).strict()` (no `main` field — enforced server-side)
  - [x] Add `SetBagCompositionResponseSchema = z.object({ child: ChildResponseSchema })`
  - [x] Add `bag_composition: BagCompositionSchema` to `ChildResponseSchema`
  - [x] Export new schemas via existing `packages/contracts/src/index.ts` `export *` (no edit needed)
  - [x] Add inferred types in `packages/types/src/index.ts` (source-imported — no build step required)

- [x] Task 3 — Audit types: add `child.bag_updated` (AC: #10)
  - [x] Add `'child.bag_updated'` to the `AuditEventType` union in `apps/api/src/audit/audit.types.ts`
  - [x] Add migration `20260520000100_add_child_bag_updated_audit_type.sql` to extend the `audit_event_type` Postgres enum (mirrors prior child.add migration pattern)

- [x] Task 4 — Repository: add `bag_composition` support (AC: #2, #4, #9)
  - [x] Add `bag_composition` to `CHILD_COLUMNS` constant in `apps/api/src/modules/children/children.repository.ts`
  - [x] Add a structured `RawBagComposition` field type to `ChildRow` (PostgREST returns JSONB pre-parsed; the parser also accepts a string for forward-compat with raw drivers) — see Completion Notes for the deviation from the story spec
  - [x] Add `bag_composition: BagComposition` to `DecryptedChildRow` interface
  - [x] Add `parseBagComposition` helper in `decryptRow` to defensively narrow snack/extra and force `main: true`
  - [x] Add `updateBagComposition(id, householdId, composition)` — single scoped UPDATE with `.eq('id').eq('household_id')`, returns null on zero rows

- [x] Task 5 — Service: add `setBagComposition` method (AC: #2, #4, #5, #10)
  - [x] Add `setBagComposition({ householdId, childId, body })` to `apps/api/src/modules/children/children.service.ts`
  - [x] Read current `bag_composition` via `findById` before update (for audit `old` value, also collapses missing-or-cross-household into a uniform 403)
  - [x] Call `repository.updateBagComposition(childId, householdId, body)` — if null, throw `ForbiddenError`
  - [x] Return `{ child, audit: { old, new } }` so the route assembles the `auditContext` (matches the cultural-prior pattern)

- [x] Task 6 — Routes: add `PATCH /v1/children/:id/bag-composition` (AC: #2, #3, #4, #5)
  - [x] Add new route in `apps/api/src/modules/children/children.routes.ts`
  - [x] Apply `requirePrimaryParent` prehandler
  - [x] Validate body with `SetBagCompositionBodySchema` (`.strict()`); additionally reject any body with a `main` key explicitly (defense in depth)
  - [x] Extract `household_id` from JWT, call `childrenService.setBagComposition`
  - [x] Set `request.auditContext` to `child.bag_updated` with `{ child_id, old, new }` PII-free metadata
  - [x] Return `200` (idempotent update)

- [x] Task 7 — Web hook: `useSetBagComposition` (AC: #7)
  - [x] Create `apps/web/src/hooks/useSetBagComposition.ts`
  - [x] Pattern: `{ submit(childId, body): Promise<SetBagCompositionOutcome>, pending: boolean }` matching `useAddChild.ts` conventions
  - [x] `SetBagCompositionOutcome = { ok: true; child: ChildResponse } | { ok: false; message: string }`

- [x] Task 8 — Web component: `BagCompositionCard` (AC: #6, #7, #8)
  - [x] Create `apps/web/src/features/children/BagCompositionCard.tsx`
  - [x] Props: `{ childId: string; childName: string; onSaved: (child: ChildResponse) => void; onSkip: () => void }`
  - [x] Local state: `snack: boolean` (default true), `extra: boolean` (default true)
  - [x] Render: card header "How does [name]'s lunch bag look?", three slot rows: Main (locked + "Always included"), Snack toggle, Extra toggle
  - [x] Save button calls `useSetBagComposition.submit`, then `onSaved(child)`
  - [x] Skip link calls `onSkip()` immediately (no API call)
  - [x] Tailwind only, warm neutral palette (stone/amber)

- [x] Task 9 — Web integration: index.tsx (AC: #6, #7, #8)
  - [x] In `apps/web/src/routes/(app)/index.tsx`, track `pendingBagChild: ChildResponse | null` state (kept the full child rather than just the id so Skip can re-emit the original child to the saved list)
  - [x] In `AddChildForm.onSuccess(child)`: set `pendingBagChild = child` and close the form
  - [x] When `pendingBagChild !== null`, render `<BagCompositionCard ... />`
  - [x] `onSaved(updatedChild)` → push `updatedChild` to `savedChildren`, clear `pendingBagChild`
  - [x] `onSkip()` → push original `pendingBagChild` to `savedChildren`, clear `pendingBagChild`

## Dev Notes

### Encryption scope
`bag_composition` is NOT PII and must NOT be envelope-encrypted. Do not pass `kek` to any repository method for this field. Only `declared_allergens`, `cultural_identifiers`, and `dietary_preferences` are encrypted. [Source: project-context.md §Envelope Encryption]

### DB constraint for `main` invariant
Add a `CHECK` constraint at the DB level in addition to the API validation (AC #3), so data integrity is enforced even if the API layer is bypassed:
```sql
ALTER TABLE children ADD CONSTRAINT children_bag_main_true
  CHECK ((bag_composition->>'main')::boolean = true);
```

### Repository scoping
`updateBagComposition` MUST filter by both `id` AND `household_id` (from JWT). Do not rely on a separate lookup + ownership check — scope the `UPDATE` itself: `WHERE id = $1 AND household_id = $2`. Return `null` when zero rows are updated (child not found or wrong household → caller throws 403). [Source: pattern established in children.routes.ts `GET /v1/households/:id/children/:childId`]

### Zod schema for `main`
`SetBagCompositionBodySchema` must NOT include a `main` field. The route handler must additionally reject any body that contains a `main` key (even if Zod strips it via `.strict()` or explicit rejection). Use `z.object({ snack: z.boolean(), extra: z.boolean() }).strict()` — `.strict()` in Zod 4 rejects unknown keys including `main`.

### `ChildResponseSchema` addition
`bag_composition` is a new required field. Any existing callers of `toChildResponse` will need the repository to populate it. Since we're adding it to `CHILD_COLUMNS`, all existing `SELECT` calls will return it. Verify the `AddChildResponse` (Story 2.10) also returns `bag_composition` — if `AddChildResponseSchema` wraps `ChildResponseSchema`, it is automatic.

### Default values
The DB default `{"main":true,"snack":true,"extra":true}` means a newly-created child already has a valid `bag_composition`. The `BagCompositionCard` allows the parent to change it post-creation. If skipped, the DB default is the final value. [Source: epics.md Story 2.12 AC]

### Web toggle UX
The Main slot row should be visually distinct (muted, "Always included" secondary label) to make it clear it is not interactive. Snack and Extra use a simple toggle/checkbox — no complex state machine. Keep the card minimal and non-blocking; the parent may skip without losing their child profile.

### Project Structure Notes

- New migration file: `supabase/migrations/<timestamp>_add_bag_composition_to_children.sql`
- New contracts in: `packages/contracts/src/children.ts` (existing file, add schemas)
- Contracts re-export: `packages/contracts/src/index.ts`
- Audit type: `apps/api/src/audit/audit.types.ts` (add to union)
- Repository: `apps/api/src/modules/children/children.repository.ts` (existing)
- Service: `apps/api/src/modules/children/children.service.ts` (existing)
- Routes: `apps/api/src/modules/children/children.routes.ts` (existing)
- New hook: `apps/web/src/hooks/useSetBagComposition.ts`
- New component: `apps/web/src/features/children/BagCompositionCard.tsx`
- Modified: `apps/web/src/routes/(app)/index.tsx` (integration)
- Note: `children.schema.ts` mentioned in architecture.md does not exist; slot type definitions belong in `packages/contracts/src/children.ts`

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.12]
- [Source: _bmad-output/planning-artifacts/prd.md#FR107, FR108]
- [Source: _bmad-output/planning-artifacts/architecture.md — children module ownership]
- [Source: supabase/migrations/20260510000000_create_children_table.sql — current children schema]
- [Source: packages/contracts/src/children.ts — current ChildResponseSchema]
- [Source: apps/api/src/modules/children/children.repository.ts — CHILD_COLUMNS, DecryptedChildRow]
- [Source: apps/api/src/modules/children/children.routes.ts — existing route patterns]
- [Source: apps/web/src/routes/(app)/index.tsx — AddChildForm integration point]
- [Source: apps/web/src/features/children/AddChildForm.tsx — onSuccess callback shape]
- [Source: apps/web/src/hooks/useAddChild.ts — hook pattern to mirror]
- [Source: apps/api/src/audit/audit.types.ts — AuditEventType union]
- [Source: _bmad-output/project-context.md — Zod 4, no `any`, envelope encryption scope]

## Dev Agent Record

### Agent Model Used

claude-opus-4-7 (1M context)

### Debug Log References

- `pnpm typecheck` — clean across all 9 packages.
- `pnpm --filter @hivekitchen/contracts test` — 13 files, 265 tests, all green.
- `pnpm --filter @hivekitchen/api test` — 19 files, 167 tests passed (11 pre-existing skips, none touched), all green.
- `pnpm --filter @hivekitchen/web test` — 12 files, 82 tests, all green.
- `pnpm lint` reported pre-existing issues in unrelated files (`CulturalRatificationStep.tsx`, `OnboardingConsent.tsx`, `OnboardingText.test.tsx`, `account.tsx`, `households.repository.ts`, `voice.service.ts`, and a `_fnName` unused-arg in the existing `children.routes.test.ts` mock predating this story). Targeted ESLint over the files this story authored or modified — `BagCompositionCard.tsx`, `BagCompositionCard.test.tsx`, `useSetBagComposition.ts`, `routes/(app)/index.tsx`, `children.routes.ts`, `children.service.ts`, `children.repository.ts`, `audit/audit.types.ts` — emits zero errors.

### Completion Notes List

- **JSONB read shape (deviation from story Task 4 wording).** Story Task 4 said to type `bag_composition: string` on `ChildRow` and `JSON.parse` it inside `decryptRow`. PostgREST (and `@supabase/supabase-js`) returns JSONB columns pre-parsed as JS values, so a `JSON.parse(object)` would coerce-and-throw in production. Implemented `RawBagComposition = object | string | null` and a `parseBagComposition` helper that handles both, plus an `undefined` field for safety. Defaults absorb a missing column (forward-compat) and the literal-true on `main` is reasserted unconditionally. The DB CHECK constraint guarantees no row will ever store `main: false`.
- **Audit assembly site.** The story Task 5 wording put the audit write inside the service. I followed the project's established split (see `cultural-prior.routes.ts`): the service returns `{ child, audit: { old, new } }`, and the route sets `request.auditContext`. `audit.hook` writes after response. This keeps the service free of Fastify request internals and matches the existing audit pattern in this codebase.
- **Cross-household 403 vs 404.** `setBagComposition` returns `ForbiddenError` for both "child does not exist" and "child belongs to another household." Returning a 404 in the first case would leak existence across households via timing/error type. The repository's scoped UPDATE collapses both cases to `null`, so this is enforced naturally.
- **Defense-in-depth for `main`.** `SetBagCompositionBodySchema` uses `.strict()`, which causes Zod to reject any extra key including `main`. The route also performs an explicit `Object.prototype.hasOwnProperty.call(rawBody, 'main')` guard before Zod sees the body so the response is a deterministic `ValidationError` (`/errors/validation`) rather than a generic Zod-derived 400. Tested both `main: true` and `main: false` bodies — both 400.
- **No envelope encryption applied to `bag_composition`.** Confirmed via project-context.md: only `declared_allergens`, `cultural_identifiers`, and `dietary_preferences` are encrypted. `bag_composition` is non-PII and stored plaintext as JSONB.
- **Index.tsx state shape.** Stored the full `ChildResponse` in `pendingBagChild` (not just the id). Skip then re-emits the original child object into `savedChildren`, keeping AC #8 (DB default retained) consistent without an extra GET.
- **Web hook outcome shape.** Used `{ ok: true | false }` per the story spec. `useAddChild` uses `{ status: 'ok' | ... }` — these intentionally differ because `useAddChild` has three outcomes (ok, parental_notice_required, error) and `useSetBagComposition` has only two.
- **Pre-existing test mock.** Updated `apps/api/src/modules/children/children.routes.test.ts` mock so the children table responds to `update().eq().eq().select().maybeSingle()` and stores `bag_composition` on inserted rows (default `{main:true,snack:true,extra:true}`). Also updated `AddChildForm.test.tsx` mock response payload to include `bag_composition` so it satisfies the now-stricter `AddChildResponseSchema`.

### File List

**New files**
- `supabase/migrations/20260520000000_add_bag_composition_to_children.sql`
- `supabase/migrations/20260520000100_add_child_bag_updated_audit_type.sql`
- `apps/api/src/modules/children/children.repository.ts` (modified — see below)
- `apps/web/src/hooks/useSetBagComposition.ts`
- `apps/web/src/features/children/BagCompositionCard.tsx`
- `apps/web/src/features/children/BagCompositionCard.test.tsx`

**Modified files**
- `packages/contracts/src/children.ts` — added `BagCompositionSchema`, `SetBagCompositionBodySchema`, `SetBagCompositionResponseSchema`; extended `ChildResponseSchema` with `bag_composition`.
- `packages/contracts/src/children.test.ts` — added round-trip tests for the new schemas; extended existing happy-path test with `bag_composition`.
- `packages/types/src/index.ts` — added `BagComposition`, `SetBagCompositionBody`, `SetBagCompositionResponse` inferred types.
- `apps/api/src/audit/audit.types.ts` — added `'child.bag_updated'` to `AUDIT_EVENT_TYPES`.
- `apps/api/src/modules/children/children.repository.ts` — added `BagComposition` interface, extended `ChildRow`/`DecryptedChildRow`/`CHILD_COLUMNS`, added `parseBagComposition` helper, added `updateBagComposition` method.
- `apps/api/src/modules/children/children.service.ts` — added `setBagComposition` returning `{ child, audit: { old, new } }`.
- `apps/api/src/modules/children/children.routes.ts` — added `PATCH /v1/children/:id/bag-composition` route with `requirePrimaryParent` + explicit `main`-key rejection + `child.bag_updated` audit context.
- `apps/api/src/modules/children/children.routes.test.ts` — updated mock supabase to support `update()` chain and store `bag_composition`; added `PATCH /v1/children/:id/bag-composition` describe block (8 new tests covering happy path, audit metadata, `main: true/false` rejection, non-boolean rejection, cross-household 403, secondary_caregiver 403, unauthenticated 401, GET-after-PATCH consistency).
- `apps/web/src/features/children/AddChildForm.test.tsx` — updated mock success response to include `bag_composition` so the now-stricter `AddChildResponseSchema` parses successfully.
- `apps/web/src/routes/(app)/index.tsx` — added `pendingBagChild` state, swapped `onSuccess` to defer `savedChildren` push until after `BagCompositionCard` resolves, added `onSaved`/`onSkip` handlers.

### Change Log

- 2026-04-29 — Story 2.12 implemented end-to-end (DB migration, contracts, audit type + Postgres enum migration, repository, service, route, web hook, web card, home-page integration). All AC verified by automated tests; typecheck and targeted lint pass clean.

### Review Findings

- [x] [Review][Decision] `kek=null` silently permits no-encryption in production — `ENVELOPE_ENCRYPTION_MASTER_KEY` absence propagates as `null` to `ChildrenRepository`. Dev/test intent is clear (NOOP mode), but if the env var is optional in `env.ts`, production misconfiguration would store sensitive fields in plaintext with no error. Confirm: is null-kek intentionally valid in production, or should `ChildrenRepository` hard-fail when `kek` is null?

- [x] [Review][Patch] Dead `main`-key guard in PATCH handler — `hasOwnProperty('main')` check runs AFTER Zod `.strict()` has already rejected the body; the handler body is never reached with `main` present. Guard is unreachable dead code and the comment claiming it runs "before Zod sees the body" is incorrect. [apps/api/src/modules/children/children.routes.ts:109-112]
- [x] [Review][Patch] `console.error` in `findByHouseholdId` — violates project rule (no `console.*` in API; use Pino). Bypasses structured log pipeline and request-correlation IDs. [apps/api/src/modules/children/children.repository.ts:128]
- [x] [Review][Patch] `parseBagComposition` doesn't guard against non-object JSON parse result — if `raw` is a string that parses to an array, number, or boolean, the cast to `{ main?, snack?, extra? }` silently succeeds and defaults both fields to `true`, returning wrong data without any error. [apps/api/src/modules/children/children.repository.ts:184-192]
- [x] [Review][Patch] `BagCompositionCard` Main slot locked state not conveyed to screen readers — the "Locked" badge is `aria-hidden="true"` with no alternative text conveying the slot is non-interactive to assistive technology. [apps/web/src/features/children/BagCompositionCard.tsx:54-59]
- [x] [Review][Patch] `handleBagSkip` captures stale `pendingBagChild` via closure — `pendingBagChild` is read from the closed-over value inside `setSavedChildren`'s updater. If React batches a concurrent `handleSuccess` state update before the skip fires, the wrong child (or `null`) could be appended to `savedChildren`. Use a ref to read the current value at call time. [apps/web/src/routes/(app)/index.tsx:43-46]
- [x] [Review][Patch] Missing route test: partial body with one required field absent — `{ extra: true }` (no `snack`) and `{ snack: false }` (no `extra`) return 400, but this path is untested end-to-end. [apps/api/src/modules/children/children.routes.test.ts]
- [x] [Review][Patch] Missing hook tests: `ZodError` and network-failure branches in `useSetBagComposition` — the `ZodError` catch path and the bare `TypeError`/rejected-fetch path are never exercised by the test suite. [apps/web/src/hooks/useSetBagComposition.ts]
- [x] [Review][Patch] Missing component test: `BagCompositionCard` `pending` disabled state — no test asserts that Save and Skip are both `disabled` while a PATCH is in-flight; this is the only UI guard against double-submission. [apps/web/src/features/children/BagCompositionCard.test.tsx]

- [x] [Review][Defer] TOCTOU double-read in `setBagComposition` — `findById` + `updateBagComposition` are two round-trips; a concurrent update between them can produce a stale `old` value in the audit log. Fix requires a DB-level CTE (`UPDATE ... RETURNING` with pre-image). [apps/api/src/modules/children/children.service.ts:58-69] — deferred, architectural improvement outside story scope
- [x] [Review][Defer] `assertCallerInHousehold` return type — should be typed as an assertion function (`asserts callerHouseholdId is string`) for TypeScript narrowing; currently `void` provides no compile-time control-flow guarantee. [apps/api/src/modules/children/children.routes.ts:141-145] — deferred, TypeScript refinement not a correctness defect
- [x] [Review][Defer] DB CHECK constraint doesn't validate `snack`/`extra` field types — constraint only enforces `main=true`; a direct DB write could store `{"main":true,"snack":"yes"}` and bypass application-layer validation. [supabase/migrations/20260520000000_add_bag_composition_to_children.sql] — deferred, complex JSONB constraint; Zod guards at API boundary are sufficient for current access patterns
- [x] [Review][Defer] Double-tap submit concurrency — two clicks within the same event-loop tick (before `pending` re-renders) could launch two concurrent PATCH requests, both resolving to `onSaved` and duplicating the child in `savedChildren`. Current `disabled={pending}` is standard practice. [apps/web/src/features/children/BagCompositionCard.tsx] — deferred, edge case requiring a ref-based in-flight guard; low practical risk given React's rendering model
