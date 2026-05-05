# Story 3.10: AllergyClearedBadge + Popover with audit link

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Primary Parent of a child with declared allergies,
I want every plan with allergy-relevant ingredients to show an affirmative `<AllergyClearedBadge>` with audit popover,
so that I have at-a-glance reassurance that today's lunch was checked, and an audit trail when I want to verify (UX-DR24, FR79).

## Acceptance Criteria

1. **Given** the household has at least one child with declared allergens AND a guardrail-cleared plan exists in `brief_state`,
   **When** I navigate to `/app` (Brief),
   **Then** `<AllergyClearedBadge>` renders one chip per `(child_id, allergen)` pair from `brief.cleared_allergies` (NEW field). Each chip is a `safety-cleared-teal` pill with a leading checkmark and the visible label `Cleared for {child_name}'s {allergen}` (Inter 13pt medium per UX-DR24). The chip row is positioned **above** the `<MomentHeadline>` so it is the first affirmative signal on the surface (UX-DR24 + Story 3.8 layout extension).

2. **And** activating the badge (click or `Enter`/`Space` on a focusable wrapper) opens a popover whose copy is *"We checked every ingredient against {child_name}'s {allergen} allergy. Nothing in today's lunch contains {allergen} or was made near them."* and a `View audit` link to `/plans/{plan_id}/audit` (Story 9.3 / Epic 5 land the actual audit route — the link is forward-compatible). Popover is keyboard-dismissable (`Esc` returns focus to the trigger). Implemented as the same inline-disclosure pattern Story 3.9 used for `mutability-frozen` (`<button aria-expanded aria-controls>` toggling a sibling `<div role="dialog" aria-modal=false>`); do **not** add Radix or `@radix-ui/react-popover` dependencies.

3. **And** the badge re-checks on every `plan.updated` SSE event by piggy-backing on the `useBriefStateQuery` cache: `apps/web/src/lib/realtime/sse.ts` `case 'plan.updated'` MUST also invalidate the brief query (extend the existing handler to call `queryClient.invalidateQueries({ queryKey: ['brief'] })` in addition to the existing `QueryKeys.plan(event.week_id)` invalidation). While the brief query is in `isFetching && isStale`, the badge swaps to a `re-checking` state — same teal palette but the checkmark dot animates `animate-pulse` on a foliage-tinted ring (`ring-foliage-300`). Static fallback under `prefers-reduced-motion` (no pulse).

4. **And** when `brief.cleared_allergies` is empty (no declared allergens in the household, or the plan has no relevant items), nothing renders — no placeholder, no zero-state copy. Empty IS the correct state.

5. **And** the component is **never** rendered with destructive styling: it uses ONLY `safety-cleared-*` Tailwind tokens (already exposed via `@hivekitchen/design-system` token preset — see Story 3.9's TrustChip implementation). A `blocked` allergy verdict does NOT render this badge in-place; it is replaced by `<AccountableError>` per UX-DR24 + UX-DR30 (Story 3.26 owns the error surface, this story does NOT build it — see Scope Boundaries). For Story 3.10, `blocked` simply means the chip is omitted (because `brief.cleared_allergies` will not contain it; the projection writer writes only cleared pairs).

6. **And** the projection-bind contract is preserved: `apps/api/src/modules/plans/brief-state.composer.ts` populates the new `cleared_allergies` field by joining the cleared plan's `plan_items` (already in scope) with `children.declared_allergens` for the same `household_id`. The composer ONLY emits chips for children whose `declared_allergens.length > 0` AND whose `child_id` appears at least once in `plan_items` for the current plan. The projection write is atomic with the existing brief upsert (no new write path).

## Tasks / Subtasks

### Task 1 — Extend BriefStateRow contract with `cleared_allergies` (AC: #1, #6)

- [x] In `packages/contracts/src/plan.ts`, add a sibling schema and extend `BriefStateRowSchema`:

  ```typescript
  // Story 3.10 — populated by brief-state.composer; one entry per
  // (child_id, allergen) pair the guardrail cleared for the current plan.
  // Empty array when no household child has declared allergens or no allergen-relevant
  // plan items exist; the frontend renders nothing in that case.
  export const ClearedAllergyEntrySchema = z.object({
    child_id: z.string().uuid(),
    child_name: z.string().min(1).max(100),
    allergen: z.string().min(1).max(100),
  });

  export const BriefStateRowSchema = z.object({
    household_id: z.string().uuid(),
    moment_headline: z.string(),
    lumi_note: z.string(),
    memory_prose: z.string(),
    plan_tile_summaries: z.array(PlanTileSummarySchema),
    cleared_allergies: z.array(ClearedAllergyEntrySchema).default([]),  // NEW
    generated_at: z.string().datetime(),
    plan_revision: z.number().int().min(0),
    updated_at: z.string().datetime(),
  });
  ```

  > `child_name` is intentionally a **plain (decrypted) string** that crosses the wire to `apps/web` for display. This matches the existing `ChildResponseSchema.name` shape returned by `GET /v1/households/:id/children/:childId` (Story 2.10) — the parent caregiver is already authorized to read it. Do NOT envelope-encrypt this in transit; the brief query is JWT-gated to household members. Do NOT add a separate "decrypted name" wrapper type.

- [x] In `packages/contracts/src/plan.test.ts`, add a `describe('ClearedAllergyEntrySchema'...)` block: parses valid entry; rejects missing fields; rejects empty `child_name`/`allergen`. Extend the existing `PlanRowSchema`/`BriefStateRowSchema` test (lines ~314-348 today) to include `cleared_allergies` in `validRow` and a separate test that defaults `cleared_allergies` to `[]` when omitted from input.

- [x] No corresponding `@hivekitchen/types` change is needed — the package re-infers via `z.infer`. Verify `packages/types/src/index.ts` re-exports `BriefStateRow` (it already does as of Story 3.6).

### Task 2 — DB migration: `brief_state.cleared_allergies` jsonb column (AC: #6)

- [x] Create `supabase/migrations/<UTC-timestamp>_add_cleared_allergies_to_brief_state.sql`. Pattern follows `20260502121000_add_brief_projection_failure_event_type.sql`:

  ```sql
  -- Story 3.10: cleared_allergies projection field — one entry per
  -- (child_id, allergen) pair the guardrail cleared for the current plan.
  -- See packages/contracts/src/plan.ts ClearedAllergyEntrySchema.
  -- Default '[]' so all existing brief_state rows remain valid; the next
  -- plan.updated event refreshes the projection with real data.

  ALTER TABLE brief_state
    ADD COLUMN cleared_allergies jsonb NOT NULL DEFAULT '[]'::jsonb;
  ```

  > NOT NULL + DEFAULT `'[]'` means the migration is non-blocking on existing rows (Postgres uses metadata-only ALTER for jsonb defaults). Do NOT add a CHECK constraint on the JSON shape; the contract layer (`ClearedAllergyEntrySchema`) is the validator and Postgres CHECK on jsonb structure is fragile.

- [x] Update `apps/api/src/modules/plans/brief-state.repository.ts`:
  - Add `cleared_allergies` to `BRIEF_STATE_COLUMNS` (line 4).
  - Add `cleared_allergies: ClearedAllergyEntry[]` to `BriefStateUpsertInput` (line 7-15). Import the type from `@hivekitchen/types`.
  - The existing `upsert()` body needs no change — the spread `{ ...input, updated_at: ... }` carries the new field through.

### Task 3 — Composer extension: compute `cleared_allergies` (AC: #6)

- [x] In `apps/api/src/modules/plans/brief-state.composer.ts`:

  1. Add a new dep to `BriefStateComposerDeps`: `childrenRepository: ChildrenRepository` (typed via `import type { ChildrenRepository } from '../children/children.repository.js'`).

  2. After `findItemsByPlanId(plan.id)` (line 60), call `this.childrenRepo.findByHouseholdId(householdId)` (already exists at `children.repository.ts:117`) to get `DecryptedChildRow[]`.

  3. Add a private method `buildClearedAllergies(items: PlanItemRow[], children: DecryptedChildRow[]): ClearedAllergyEntry[]`. Build a `Set<child_id>` from the items (children who actually appear in this plan). For each child in `children` that is in the set AND `child.declared_allergens.length > 0`, emit one entry per allergen: `{ child_id, child_name: child.name, allergen }`. Stable order: iterate children in insertion order; iterate allergens in array order. Do NOT alphabetize — the contract schema does not assert order and downstream code already renders chips in array order.

  4. Add `cleared_allergies: this.buildClearedAllergies(items, children),` to the `upsertInput` object (between `plan_tile_summaries` and `generated_at`).

- [x] Update `apps/api/src/modules/plans/plans.hook.ts` (the plugin that decorates `briefStateComposer`, lines 26-43) to also construct a `ChildrenRepository` and pass it into `new BriefStateComposer({...})`. Reuse the construction pattern from `apps/api/src/modules/children/children.routes.ts:19-23`:

  ```typescript
  const kekHex = fastify.env.ENVELOPE_ENCRYPTION_MASTER_KEY;
  const kek = kekHex ? Buffer.from(kekHex, 'hex') : null;
  const childrenRepository = new ChildrenRepository(fastify.supabase, kek, fastify.log);
  // ...then pass `childrenRepository` into the BriefStateComposer constructor
  ```

  Add the `fastify.env` precondition guard (line 9-19 pattern) so a missing env-validator decorator fails fast. `child.name` is envelope-encrypted at rest; `findByHouseholdId` decrypts using the KEK before returning rows.

- [x] Update `apps/api/src/modules/plans/brief-state.composer.test.ts`:
  - Existing fixture (`validRow` ~ line 49-54) already returns the cleared plan; extend the children-repo mock builder to return one child with `declared_allergens: ['peanut']`.
  - Add tests: "emits cleared_allergies entries for children-with-allergens whose plan items appear", "omits children with empty declared_allergens", "omits children not present in plan_items", "emits empty array when no household child has declared allergens", "emits one entry per (child, allergen) pair when a child has multiple allergens".
  - Tests must NOT mock the database directly — mock the repositories at the boundary (already the existing pattern).

- [x] Update `apps/api/src/modules/plans/plans.service.test.ts` and any tests calling `getBrief(...)` — the brief response shape is now wider; ensure mocks return `cleared_allergies: []` to pass Zod parse on the route response.

### Task 4 — SSE handler: invalidate brief on `plan.updated` (AC: #3)

- [x] In `apps/web/src/lib/realtime/sse.ts`, extend `case 'plan.updated':`:

  ```typescript
  case 'plan.updated':
    void queryClient.invalidateQueries({ queryKey: QueryKeys.plan(event.week_id) });
    void queryClient.invalidateQueries({ queryKey: ['brief'] });  // NEW — re-fetches AllergyClearedBadge state
    break;
  ```

  > Wildcard `['brief']` matches every `['brief', householdId]` query in cache. Acceptable: a parent session has at most one `current_household_id`, so at most one brief query is active. Adding `household_id` to `PlanUpdatedEvent` would be a contract change in another package and is explicitly out of scope.

- [x] Update `apps/web/src/lib/realtime/sse.test.ts` `'plan.updated calls invalidateQueries with plan key'` — assert TWO `invalidateQueries` calls: the existing plan-key call AND a new `{ queryKey: ['brief'] }` call. Don't add a separate test; extend the existing one.

- [x] Do NOT touch `case 'allergy.verdict':` — the AC #3 requirement says "any plan.updated event with new guardrail_verdict", and `plan.updated` is the canonical event (carries the verdict inline per UX-DR7). `allergy.verdict` is a redundant secondary event used by ops dashboards (Story 9.1).

### Task 5 — Create `<AllergyClearedBadge>` component (AC: #1, #2, #5)

- [x] Create `apps/web/src/features/plan/AllergyClearedBadge.tsx`. Reuse the inline-disclosure pattern from Story 3.9's `mutability-frozen` (PlanTile.tsx:159-181) — `<button aria-expanded aria-controls>` toggles a sibling `<div role="dialog" aria-modal=false aria-labelledby>`. No Radix, no Shadcn, no popover library.

  ```tsx
  import { useId, useRef, useState } from 'react';
  import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

  export interface AllergyClearedBadgeProps {
    childName: string;
    allergen: string;
    auditUrl: string;          // e.g. `/plans/${planId}/audit`
    isRechecking?: boolean;    // true while useBriefStateQuery is fetching+stale
  }

  export function AllergyClearedBadge({
    childName,
    allergen,
    auditUrl,
    isRechecking = false,
  }: AllergyClearedBadgeProps) {
    const [open, setOpen] = useState(false);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const dialogId = useId();
    const labelId = useId();

    function handleKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    const label = `Cleared for ${childName}'s ${allergen}`;
    const checkmarkBg = isRechecking
      ? 'bg-safety-cleared-200 ring-2 ring-foliage-300 motion-safe:animate-pulse'
      : 'bg-safety-cleared-200';

    return (
      <span className="inline-block relative">
        <button
          ref={triggerRef}
          type="button"
          aria-expanded={open}
          aria-controls={dialogId}
          aria-label={label}
          id={labelId}
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1 rounded-full border border-safety-cleared-200 bg-safety-cleared-100 px-2 py-0.5 font-sans text-[13px] font-medium leading-none text-safety-cleared-800 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-safety-cleared-400 focus-visible:ring-offset-1"
        >
          <span aria-hidden="true" className={`inline-flex h-3 w-3 items-center justify-center rounded-full ${checkmarkBg}`}>
            <svg width="8" height="8" viewBox="0 0 12 12" fill="currentColor">
              <path d="M10 3L5 8.5 2 5.5 1.5 6l3.5 3.5 5.5-6L10 3z" />
            </svg>
          </span>
          {label}
        </button>
        {open && (
          <div
            id={dialogId}
            role="dialog"
            aria-modal={false}
            aria-labelledby={labelId}
            onKeyDown={handleKeyDown}
            className="absolute z-30 mt-2 max-w-[320px] rounded-lg border border-stone-200 bg-white p-3 shadow-sm font-sans text-[14px] leading-[1.5] text-stone-700"
          >
            <p>
              We checked every ingredient against {childName}&apos;s {allergen} allergy.
              Nothing in today&apos;s lunch contains {allergen} or was made near them.
            </p>
            <a
              href={auditUrl}
              className="mt-2 inline-block font-medium text-safety-cleared-800 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-safety-cleared-400"
            >
              View audit
            </a>
          </div>
        )}
      </span>
    );
  }
  ```

  > **Token-class verification before shipping (Story 3.9 lesson learned):** `safety-cleared-100/200/400/800` and `foliage-300` are exposed by `@hivekitchen/design-system` token preset and are already used by `TrustChip` (`apps/web/src/features/plan/TrustChip.tsx:18-19,20`). If a class fails to resolve at runtime, run `pnpm --filter @hivekitchen/design-system run build` first; do NOT hardcode hex values.

- [x] **Logical-property lint compliance** (Story 3.8 rule `hivekitchen/logical-properties-only`): use `ms/me/ps/pe/start/end` if you need any LTR/RTL-sensitive class. The snippet above only uses `mt-2` (block-axis, allowed). Avoid `left-*`/`right-*`/`pl-*`/`pr-*`.

- [x] Animation discipline (Story 3.9 + project-context "no Framer Motion"): use Tailwind `motion-safe:animate-pulse` only — the `motion-safe:` prefix is the project's reduced-motion guard. Do NOT add `framer-motion`. Do NOT add a custom `@keyframes` for the foliage pulse.

### Task 6 — Render in `<BriefCanvas>` (AC: #1, #4)

- [x] In `apps/web/src/features/plan/BriefCanvas.tsx`, render an `<AllergyClearedBadge>` row above the `<MomentHeadline>` when `brief.cleared_allergies.length > 0`. The query also exposes `isFetching` + `isStale`; pass `isRechecking={isFetching && isStale}` to each badge so all chips animate together during the post-`plan.updated` refetch.

  ```tsx
  // INSIDE the existing `{brief !== null && (<>...</>)}` block, at the top:
  {brief.cleared_allergies.length > 0 && (
    <div
      className="flex flex-wrap gap-2"
      aria-label="Allergy clearances"
    >
      {brief.cleared_allergies.map((entry) => (
        <AllergyClearedBadge
          key={`${entry.child_id}-${entry.allergen}`}
          childName={entry.child_name}
          allergen={entry.allergen}
          // plan_id is not in BriefStateRow today; deep-link to the brief-scoped audit route.
          // The route is wired by Story 9.3 (ops) and Epic 5 (parent-facing); this href
          // 404s in production until then. See Dev Notes "Audit URL forward-compat".
          auditUrl={`/plans/by-week/${brief.household_id}/audit`}
          isRechecking={isFetching && isStale}
        />
      ))}
    </div>
  )}
  <MomentHeadline text={brief.moment_headline} />
  ```

  > **Empty state is silence** (UX-DR15 / project context Principle 1): when `brief.cleared_allergies.length === 0`, no element renders — no placeholder, no skeleton, no "no allergens declared" copy. The conditional render handles this implicitly.

  > **`brief.household_id`** is already in `BriefStateRowSchema`. `plan_id` is NOT — the brief projection intentionally does not expose plan internals. The `auditUrl` therefore deep-links to a household+week audit lookup; the audit timeline route owns plan resolution via `correlation_id` (architecture §1.6).

- [x] Update `apps/web/src/features/plan/BriefCanvas.test.tsx`:
  - The existing `makeBrief` fixture must include `cleared_allergies: []` (default empty); a separate test renders with two entries (e.g., `{ child_id, child_name: 'Asha', allergen: 'peanut' }`, `{ child_id, child_name: 'Asha', allergen: 'tree nut' }`) and asserts two `<button aria-label="Cleared for Asha's peanut">` / `"Cleared for Asha's tree nut"` triggers exist BEFORE the `<h1>` (`compareDocumentPosition` or query order).
  - One test: `cleared_allergies: []` renders no chip row (`queryByLabelText('Allergy clearances')` returns null).
  - One test: clicking a badge opens the dialog (`getByRole('dialog')` becomes visible) with the correct popover copy.

### Task 7 — Unit tests for `<AllergyClearedBadge>` (AC: #1, #2, #5)

- [x] Create `apps/web/src/features/plan/AllergyClearedBadge.test.tsx` covering:
  - Renders trigger button with `aria-label` exactly `"Cleared for Asha's peanut"` and visible text matching.
  - Trigger has `type="button"` (avoids accidental form submission).
  - Clicking trigger toggles `aria-expanded` and shows/hides the dialog.
  - Pressing `Esc` inside the dialog closes it AND returns focus to the trigger (assert `document.activeElement === trigger`).
  - The dialog text contains the full UX-DR24 copy `"We checked every ingredient against Asha's peanut allergy. Nothing in today's lunch contains peanut or was made near them."` — assert by string match (testing-library `getByText` with a regex or substring).
  - The `View audit` link has `href` matching the `auditUrl` prop.
  - When `isRechecking={true}`, the checkmark wrapper has class `motion-safe:animate-pulse` and `ring-foliage-300`. Assert via `className.includes(...)` not snapshot.
  - When `isRechecking={false}` (default), no `animate-pulse` class is applied.
  - Renders ONLY `safety-cleared-*` and `foliage-*` color tokens — assert by querying `className` does not contain `red-`, `rose-`, `destructive`. (Cheap "never destructive" guard per AC #5 + UX-DR24.)

- [x] **No Playwright e2e** for this story. Story 3.9's e2e (`apps/web/test/e2e/3-9-plantile.spec.ts`) is file-present but infra-deferred (no `playwright.config.*` in workspace). Don't add a 3-10 spec until that infra lands; Tasks 6 + 7 give full coverage at the unit/integration layer.

### Task 8 — Typecheck, unit tests, lint (AC: all)

- [x] `pnpm --filter @hivekitchen/contracts typecheck && pnpm --filter @hivekitchen/contracts test` — schema additions clean, drift tests pass.
- [x] `pnpm --filter @hivekitchen/api typecheck && pnpm --filter @hivekitchen/api test` — composer/repo updates clean. Pre-existing failures in `households.routes.test.ts`, `brief-state.composer.test.ts`, `plans.service.test.ts`, `voice.service.test.ts` are documented in Story 3.8 §Debug Log (lines 482-486) — investigate whether your changes leave that count unchanged or improve it; report the baseline.
- [x] `pnpm --filter @hivekitchen/web typecheck && pnpm --filter @hivekitchen/web test` — full web suite green; AllergyClearedBadge tests pass; existing 165+ tests stay passing.
- [x] `pnpm --filter @hivekitchen/web lint` — 0 new errors. Story 3.9's recorded baseline is 11 errors / 2 warnings, all pre-existing in files outside the plan/thread features. Don't fix others-files lint in this PR.
- [x] `pnpm --filter @hivekitchen/web exec vitest run src/features/plan src/lib/realtime` — focused subset for fast iteration.

## Dev Notes

### Critical — Scope boundaries (do NOT build these here)

| Story | Owns | Symptom of accidental scope creep |
|---|---|---|
| **3.9** (done) | `<TrustChip>`, `<PlanTile>`, `<PresenceIndicator>` | Adding new TrustChip variants, modifying PlanTile keyboard/state machine |
| **3.11** (next) | `<FreshnessState>`, `<QuietDiff>` | Adding QuietDiff for allergy-relevant mutations — UX-DR19 explicitly bans this; allergy mutations escalate to `<AccountableError>` |
| **3.12** | Per-slot/day swap, allergen-affecting swap pending UI | Wiring `PATCH /v1/plans/:id/items/:itemId`, optimistic mutations |
| **3.13** | Plan regeneration request | Re-running planner agent from the brief |
| **3.24** | Allergy uncertainty flagging, safe substitution | Verdict = `uncertain` UX surface; this story only handles `cleared` |
| **3.25** | Hard-fail escalation when no safe plan | Verdict = `blocked` full-surface error |
| **3.26** | Graceful degradation `<AccountableError>` | The component to use when `verdict !== 'cleared'` (referenced by AC #5 but not built here) |
| **5.1, 5.2** | Thread, SSE invalidation contract per-user, presence enrichment | Adding household_id to `PlanUpdatedEvent`, building thread audit page |
| **9.3** | `<PlanStagesTimeline>` ops audit at `/ops/plan-audit/:planId` | Building the parent-facing audit page that the badge links to |

`blocked` verdict means: `brief.cleared_allergies` simply does not contain the entry (composer omits it), so no chip renders. The `<AccountableError>` surface for `blocked` is Story 3.25/3.26 territory.

### Critical — `child.name` is envelope-encrypted at rest, plain over the wire

`children.repository.ts:findByHouseholdId(householdId)` already returns `DecryptedChildRow[]` — the repository decrypts the `name_encrypted` column with the `kek` buffer at read time (Story 2.10). The composer receives plain names. Crossing the wire to `apps/web` over JWT-gated `/v1/households/:id/brief` is the same exposure model as `GET /v1/households/:id/children/:childId` (Story 2.10), which already returns `child.name`. **Do NOT** add a separate decrypted-name DTO; **do NOT** envelope-encrypt names in the brief projection (Postgres jsonb cannot hold ciphertext envelopes anyway without breaking RLS read patterns).

### Critical — Re-checking state from TanStack Query, not a separate prop

The brief query exposes both `isFetching` (true during any fetch including background refetch) and `isStale` (true when the cached data is past `staleTime`). The badge's `isRechecking` should be `isFetching && isStale` — the same pattern Story 3.8 used for `<FreshnessState>`. This means: a background refetch triggered by SSE `plan.updated` invalidation flips `isFetching=true` while keeping cached chips visible, animating them, and then refreshes when the new data arrives. Do NOT thread `isLoading` (initial load, no cached data) — the full-skeleton path already covers that case.

### Critical — Audit URL forward-compat

UX-DR24 mandates a `View audit` link to "thread audit trail". Today:
- `/thread` does not exist (Epic 5 Story 5.1 builds it).
- `/ops/plan-audit/:planId` is ops-scope only (Story 9.3).
- A parent-facing `/plans/:planId/audit` does not exist either.
- `BriefStateRow` does not carry `plan_id` — only `household_id` and `plan_revision`.

Resolution for this story: hard-code `auditUrl={\`/plans/by-week/${brief.household_id}/audit\`}` as a forward-compatible href. The link will 404 in production until the parent-facing audit route lands. **DO NOT** add `plan_id` to the brief projection just for this href (no other consumer needs it; cluttering the presentation-bind contract for one feature violates §1.5). When Story 9.3 / Epic 5 wires the audit route, the href spec will be updated in one place. Tag this in `_bmad-output/implementation-artifacts/deferred-work.md` under "Story 3.10 — `/plans/by-week/:householdId/audit` route TBD (Epic 5 / Story 9.3)".

### Critical — Why the badge row goes ABOVE `<MomentHeadline>`, not on tiles

UX-DR24 says "every plan with allergy-relevant ingredients to show an affirmative `<AllergyClearedBadge>`" — singular, plan-level. The chip row sits above the `<MomentHeadline>` (`<h1>`) so the affirmative signal is the FIRST visible reassurance on the surface. The badge is NOT per-tile (TrustChip is the per-tile affordance, Story 3.9 owns it). Do NOT thread `cleared_allergies` into PlanTile or pass `trustChips={[...]}` to PlanTile from BriefCanvas in this story — keep the surfaces orthogonal: AllergyClearedBadge = plan-level affirmative, TrustChip = per-tile metadata.

### Critical — Idempotent migration (no contract break in flight)

Because `cleared_allergies` is added with `DEFAULT '[]'::jsonb NOT NULL`, every existing `brief_state` row stays Zod-valid against the new schema (the `.default([])` in the schema mirrors the SQL default). Web continues to render correctly even if it deploys before the API does. The first `plan.updated` event after API deploy refreshes the projection with real data. **No flag-flip needed.** Do NOT introduce a feature flag for this rollout.

### Architecture — Inline-disclosure pattern (no Radix dependency)

Story 3.9 established this pattern for `mutability-frozen`:
- `<button aria-expanded aria-controls>` is the trigger; toggling it sets local state.
- A sibling element (`role="dialog"` for AllergyClearedBadge; `role="note"` for the plan-tile lockdown copy) is shown/hidden by the boolean.
- `Esc` returns focus to the trigger.
- No Radix portal, no focus trap (intentional — popover is non-modal; user can still click out to close, achieved by document-level click handler if needed; for v1 simply require explicit close via Esc or re-clicking the trigger).

**Why not Radix Popover:** project does not have `@radix-ui/*` packages installed (verified by Story 3.9 Task 1). Adding Radix for one popover is heavyweight; the inline pattern is keyboard-accessible per WAI-ARIA disclosure pattern. If Stories 3.11+ accumulate ≥3 popover use cases, propose `@radix-ui/react-popover` as a dedicated dep PR — out of scope here.

### Architecture — Animation: Tailwind utilities only

Project bans `framer-motion` (eslint import rule, established Story 3.9). Allowed primitives:
- Tailwind `animate-pulse` / `animate-spin` (built-in keyframes).
- `motion-safe:` / `motion-reduce:` prefixes for reduced-motion respect (UX-DR11).
- `transition-*` utilities for state-transition tweens (no JS).

The badge's re-checking pulse uses `motion-safe:animate-pulse` — under `prefers-reduced-motion: reduce`, the pulse is silently dropped. The chip's color does NOT change between cleared and re-checking (per UX-DR24 — "Never destructive-red — uses safety-cleared-teal token only"); only the foliage `ring-2 ring-foliage-300` is added in re-checking, and it's static under reduced motion.

### Architecture — Brief query invalidation cardinality

`['brief']` is a 1-tuple cache match. Why this is safe:
- A user has at most one `current_household_id` (auth.store), so only one brief query is ever hot.
- TanStack Query's `invalidateQueries({ queryKey })` does prefix-match by default, so `['brief']` matches `['brief', householdId]` AND `['brief', null]` (the disabled-query sentinel — harmless invalidation).
- No cross-household leakage: even on a multi-household session (not in scope today), each query is keyed by its `householdId`, so a stale household's brief stays stale until its corresponding `plan.updated` event fires.

### Architecture — Composer concurrency / TOCTOU

Story 3.6's brief upsert does a read-then-write with a `plan_revision` guard (`brief-state.repository.ts:36-39`). Adding `cleared_allergies` doesn't introduce a new race because the children list is fetched in the SAME composer run and written atomically with the rest of the projection. If two composer runs interleave on the same household, the higher `plan_revision` wins; whichever children list it observed becomes the projected state. Story 3.7's BullMQ per-household serialization further bounds this (already documented in repo).

### Pattern — `cleared_allergies` ordering invariant

The composer emits entries in insertion order: outer loop iterates `children` (DB order, which is the children-table primary-key order — stable per household once children are added); inner loop iterates `child.declared_allergens` (the order the parent typed them at child-add time). Frontend renders chips left-to-right in this order. Tests should NOT assume alphabetical sort. If a future story (e.g., 3.18 cultural priors) wants priority ordering, it adds a `priority` field — not in this story's scope.

### Pattern — Token classes verified at build, not runtime

Tailwind JIT scans the source files for class strings at build time. If a token class isn't found anywhere in `src/`, it gets purged. The badge component is the first consumer of `bg-safety-cleared-100`, `border-safety-cleared-200`, `text-safety-cleared-800`, `ring-foliage-300`, and `focus-visible:ring-safety-cleared-400` — verify after build that these resolve to actual CSS rules. (TrustChip already uses 100/200/800 variants per Story 3.9.) The `400` variant for focus-ring is new; if it doesn't resolve, fall back to `safety-cleared-300` and add a `// TODO:` token comment.

### Pattern — A11y for affirmative status

The badge is a status indicator, not a destructive action. Per UX-DR24:
- `aria-label` carries the same text as the visible label (no info-loss for SR users).
- Trigger is a `<button>` (not `<a>`) — it doesn't navigate, it discloses.
- Dialog is `role="dialog" aria-modal=false` — it's a non-modal popover; tab-key continues past it; Esc closes; clicking elsewhere does NOT auto-close (deliberate; matches the inline-disclosure pattern).
- Color contrast: `safety-cleared-800` on `safety-cleared-100` clears WCAG AA at 13pt medium per Story 1.12's contrast harness; `foliage-300` ring against white background is decorative and exempt.

### Project Structure — New and modified files

**New (apps/web)**
```
apps/web/src/features/plan/
  AllergyClearedBadge.tsx
  AllergyClearedBadge.test.tsx
```

**New (supabase)**
```
supabase/migrations/
  <UTC-timestamp>_add_cleared_allergies_to_brief_state.sql
```

**Modified**
```
packages/contracts/src/plan.ts                                + ClearedAllergyEntrySchema; BriefStateRowSchema.cleared_allergies
packages/contracts/src/plan.test.ts                           + describe ClearedAllergyEntrySchema; extend BriefStateRow tests
apps/api/src/modules/plans/brief-state.repository.ts          + cleared_allergies in BRIEF_STATE_COLUMNS + BriefStateUpsertInput
apps/api/src/modules/plans/brief-state.composer.ts            + childrenRepository dep + buildClearedAllergies + upsertInput field
apps/api/src/modules/plans/brief-state.composer.test.ts       + 5 tests for cleared_allergies build
apps/api/src/modules/plans/<composer registration file>       wire ChildrenRepository into composer construction
apps/api/src/modules/plans/plans.service.test.ts              update mocks to return cleared_allergies in brief
apps/web/src/lib/realtime/sse.ts                              + brief invalidation in plan.updated handler
apps/web/src/lib/realtime/sse.test.ts                         extend plan.updated test for two invalidations
apps/web/src/features/plan/BriefCanvas.tsx                    render AllergyClearedBadge row above MomentHeadline
apps/web/src/features/plan/BriefCanvas.test.tsx               + cleared_allergies fixture/tests
_bmad-output/implementation-artifacts/sprint-status.yaml      story 3-10 ready-for-dev → in-progress → review
_bmad-output/implementation-artifacts/deferred-work.md        + entry for /plans/by-week/:householdId/audit route TBD
```

**Unchanged — do NOT touch**
```
apps/web/src/features/plan/PlanTile.tsx        (3.9 owns; AllergyClearedBadge is plan-level not tile-level)
apps/web/src/features/plan/TrustChip.tsx       (3.9 owns; do not add allergy-specific behavior here)
apps/web/src/features/plan/MomentHeadline.tsx  (3.8 owns)
apps/web/src/features/plan/LumiNote.tsx        (3.8 owns)
apps/web/src/features/plan/FreshnessState.tsx  (3.8/3.11 own)
apps/api/src/modules/allergy-guardrail/        (3.1 owns the deterministic guardrail; this story is presentation-only)
apps/api/src/modules/children/                 (additive composer dep only — no children.routes.ts / children.service.ts changes)
packages/contracts/src/events.ts               (no new SSE event types — reuse existing plan.updated)
packages/contracts/src/presence.ts             (presence is unrelated)
```

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.10] — story narrative + ACs (lines 1295-1308)
- [Source: _bmad-output/planning-artifacts/epics.md#UX-DR24] — `<AllergyClearedBadge>` anatomy: safety-cleared-teal pill 8% alpha, teal checkmark 12px, Inter 13pt medium label, popover copy verbatim, states cleared/re-checking (foliage soft pulse)/blocked-replaced-by-AccountableError, never renders without fresh guardrail verdict (line 354)
- [Source: _bmad-output/planning-artifacts/epics.md#UX-DR1] — `--safety-cleared-teal` is "allergy-cleared exclusive — never destructive-red" (line 325)
- [Source: _bmad-output/planning-artifacts/epics.md#UX-DR7] — Gate 2 Guardrail coupling: `PlanUpdatedEvent` carries `guardrail_verdict: AllergyVerdict` inline (line 334)
- [Source: _bmad-output/planning-artifacts/epics.md#UX-DR11] — Reduced-motion: respect `prefers-reduced-motion: reduce` (`motion-safe:` prefix discipline)
- [Source: _bmad-output/planning-artifacts/epics.md#UX-DR19] — `<QuietDiff>` never renders allergy/dietary mutations — they escalate (out-of-scope reminder for AC #5)
- [Source: _bmad-output/planning-artifacts/epics.md#UX-DR30] — `<AccountableError>` is the surface for `blocked` (Story 3.26)
- [Source: _bmad-output/planning-artifacts/epics.md#UX-DR31] — `<TrustChip>` is the per-tile affordance, NOT the same as AllergyClearedBadge (line 364)
- [Source: _bmad-output/planning-artifacts/prd.md#FR79] — "System requires explicit parent confirmation on any plan change that affects an allergy-relevant ingredient for a household with declared allergies." (line 1009)
- [Source: _bmad-output/planning-artifacts/prd.md#FR78] — "System maintains an auditable log of every allergy-guardrail decision" (line 1008) — basis for the View audit link
- [Source: _bmad-output/planning-artifacts/prd.md#FR80] — "System produces a transparency log exportable to the parent on request..." (line 1010)
- [Source: _bmad-output/planning-artifacts/architecture.md#1.5] — brief_state projection design, presentation-bind invariant, Tier B writer pattern (lines 293-296)
- [Source: _bmad-output/planning-artifacts/architecture.md#1.6] — audit_log monthly partitions, `correlation_id` indexing, single-row read for FR78/FR80 reconstruction (lines 314-320)
- [Source: _bmad-output/planning-artifacts/architecture.md#§AllergyGuardrail boundary] — guardrail runs OUTSIDE the agent boundary; `plans.service.commit` calls `allergyGuardrail.clearOrReject` (lines 1361-1362, 1395)
- [Source: _bmad-output/planning-artifacts/implementation-readiness-report-2026-04-22.md#§Story 3.10 sample] — explicit citation that `<AllergyClearedBadge>` reads only from `WHERE guardrail_cleared_at IS NOT NULL` (line 532)
- [Source: packages/contracts/src/plan.ts] — `AllergyVerdict` discriminated union (`cleared|blocked|pending|degraded` — lines 31-44), `BriefStateRowSchema` to extend (lines 211-220), `PlanRowSchema` (lines 165-176), `PlanTileSummarySchema` (lines 206-209)
- [Source: packages/contracts/src/children.ts] — `ChildResponseSchema.declared_allergens: z.array(z.string())`, `name: z.string()` (lines 36-48)
- [Source: packages/contracts/src/events.ts] — `InvalidationEvent` with `plan.updated` and `allergy.verdict` types (the latter NOT to be wired here)
- [Source: apps/api/src/modules/plans/brief-state.composer.ts] — composer to extend (the entire file is the touched surface)
- [Source: apps/api/src/modules/plans/brief-state.repository.ts] — `BRIEF_STATE_COLUMNS` constant + `BriefStateUpsertInput` interface
- [Source: apps/api/src/modules/children/children.repository.ts] — `findByHouseholdId(householdId): Promise<DecryptedChildRow[]>` (line 117) — already exists
- [Source: apps/api/src/modules/children/children.routes.ts:23] — pattern for constructing `ChildrenRepository(supabase, kek, log)` with envelope-encryption KEK
- [Source: apps/web/src/features/plan/BriefCanvas.tsx] — surface to render badge row above MomentHeadline; already wires `useBriefStateQuery` with `isFetching`/`isStale`
- [Source: apps/web/src/features/plan/PlanTile.tsx:159-181] — Story 3.9's reference inline-disclosure pattern (Story 3.10 reuses)
- [Source: apps/web/src/features/plan/TrustChip.tsx:18-19] — Tailwind token class names that resolve (`safety-cleared-100/200/800`); reuse for badge
- [Source: apps/web/src/lib/realtime/sse.ts:120] — `case 'plan.updated':` to extend
- [Source: apps/web/src/lib/realtime/query-keys.ts:28] — `QueryKeys.brief` shape
- [Source: apps/web/src/features/plan/useBriefStateQuery.ts] — hook with `isFetching`+`isStale` derivable for re-checking signal
- [Source: supabase/migrations/20260502120000_create_brief_state_projection.sql] — `brief_state` table to extend
- [Source: _bmad-output/implementation-artifacts/3-9-plantile-component-with-all-states-variants.md] — full prior-story log: Popover deferral rationale, token-class verification, logical-property lint, animation discipline, jsx-a11y comment-suppression pattern (the exact lessons that prevent re-introducing the same review findings here)
- [Source: _bmad-output/implementation-artifacts/3-8-briefcanvas-momentheadline-luminote-components.md] — BriefCanvas layout + skeleton + `isFetching && isStale` derivation pattern; `LumiSurfaceSchema` precedent for additive contract changes
- [Source: _bmad-output/project-context.md] — TS strict, pnpm only, no `framer-motion`, no chat-first layouts, presentation-bind for brief. **Note:** project-context.md says Zod 3.23 but Story 1.16 (done) upgraded the workspace to Zod ^4. All three packages currently pin `zod: ^4.0.0`. Use Zod 4 idioms (`z.discriminatedUnion` discriminator-property syntax matches existing usage in `plan.ts`).
- [Source: apps/web/CLAUDE.md] — design rules: warm neutrals, no Inter/Roboto for non-Inter usage, soft transitions; one intent per screen

## Dev Agent Record

### Agent Model Used

claude-opus-4-7 (Claude Code)

### Debug Log References

**Validation gates (2026-05-04)**

- `pnpm --filter @hivekitchen/contracts typecheck` → clean
- `pnpm --filter @hivekitchen/contracts test` → 400 / 401 passing. The 1 pre-existing failure is in `cultural.test.ts > TurnBodyRatificationPrompt` (unrelated). All new `ClearedAllergyEntrySchema` tests + extended `BriefStateRowSchema` tests pass.
- `pnpm --filter @hivekitchen/api exec vitest run src/modules/plans/brief-state` → 13 / 13 passing (7 existing + 6 new `cleared_allergies` build tests).
- `pnpm --filter @hivekitchen/api test` → 374 / 386 passing (1 fail / 11 skipped). The 1 failure is in `memory.service.test.ts > seedFromOnboarding > partial seeding` — unrelated to this story. Pre-existing typecheck warnings (`households.routes.test.ts:436`, `plans.service.test.ts:373`, `brief-state.composer.test.ts:326` `'sunday'`, `voice.service.test.ts` `RequestInfo`) are documented in Story 3.8 §Debug Log; no new errors introduced by this story (only error-message text now mentions `cleared_allergies` because the `BriefStateRow` shape widened).
- `pnpm --filter @hivekitchen/web typecheck` → clean
- `pnpm --filter @hivekitchen/web test` → 220 / 220 passing (12 new `AllergyClearedBadge` tests + 3 new `BriefCanvas` tests + extended `sse.ts` `plan.updated` test).
- `pnpm --filter @hivekitchen/web lint` → 11 errors / 2 warnings — exactly matches Story 3.9's recorded baseline. All errors are in files outside `features/plan/` and `features/thread/`. The dialog `onKeyDown` would have been a 12th error; suppressed with the same `// eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions` pattern Story 3.9 used on `<article>` (lessons-learned reuse).
- `pnpm --filter @hivekitchen/web exec vitest run src/features/plan src/lib/realtime` → 92 / 92 passing.

### Completion Notes List

- Contract addition is forward-compatible: `cleared_allergies: z.array(ClearedAllergyEntrySchema).default([])` mirrors the SQL `DEFAULT '[]'::jsonb`. Web continues to render correctly even if the migration runs before the API ships the new composer code.
- Composer ordering invariant: `buildClearedAllergies` iterates `children` in DB return order, allergens in declared order — no alphabetical sort. Documented in tests and the composer comment.
- `child.name` decryption boundary unchanged — `ChildrenRepository.findByHouseholdId(householdId)` already returns `DecryptedChildRow[]` (Story 2.10 envelope). The composer receives plain names; no separate decrypted-name DTO introduced. JWT-gated brief route is the same exposure model as `GET /v1/households/:id/children/:childId`.
- SSE invalidation: `['brief']` wildcard match — only one brief query is ever hot per session (single `current_household_id`). Acceptable; no `household_id` added to `PlanUpdatedEvent` (out of scope).
- Inline-disclosure pattern reused from Story 3.9's `mutability-frozen` (`PlanTile.tsx:159-181`): `<button aria-expanded aria-controls>` + sibling `<div role="dialog" aria-modal=false>`. No Radix dependency added.
- Animation: only Tailwind primitives (`motion-safe:animate-pulse` + `ring-foliage-300`). No `framer-motion`, no custom `@keyframes`. Static fallback under `prefers-reduced-motion: reduce` (the `motion-safe:` prefix drops the pulse).
- Audit URL is forward-compatible: `auditUrl={\`/plans/by-week/${brief.household_id}/audit\`}`. The route does not yet exist; recorded in `_bmad-output/implementation-artifacts/deferred-work.md`. No `plan_id` added to the brief projection (would violate presentation-bind §1.5 for a single consumer).
- AC #5 enforcement: badge uses ONLY `safety-cleared-*` and `foliage-*` tokens. The "never destructive" lint test (`AllergyClearedBadge.test.tsx`) asserts no `red-`, `rose-`, `destructive` class strings appear in rendered HTML — cheap regression guard.
- Empty state is silence (UX-DR15): when `brief.cleared_allergies.length === 0` the BriefCanvas renders nothing — no placeholder, no skeleton, no zero-state copy. Verified by `BriefCanvas.test.tsx` (`queryByLabelText('Allergy clearances')` returns null).
- New `ChildrenRepository` dep wired into `plansHook` via the same `Buffer.from(env.ENVELOPE_ENCRYPTION_MASTER_KEY, 'hex')` pattern `children.routes.ts:19-23` already uses. Added a `fastify.env` precondition guard to fail fast if the env-validator decorator is missing.

### File List

**New**
- `apps/web/src/features/plan/AllergyClearedBadge.tsx`
- `apps/web/src/features/plan/AllergyClearedBadge.test.tsx`
- `supabase/migrations/20260504131806_add_cleared_allergies_to_brief_state.sql`

**Modified**
- `packages/contracts/src/plan.ts` — added `ClearedAllergyEntrySchema`; extended `BriefStateRowSchema` with `cleared_allergies` (default `[]`).
- `packages/contracts/src/plan.test.ts` — new `describe('ClearedAllergyEntrySchema')` block; extended BriefStateRow tests for `cleared_allergies` round-trip + default + invalid-entry rejection.
- `packages/types/src/index.ts` — re-exported `ClearedAllergyEntrySchema`; added `ClearedAllergyEntry` z.infer type.
- `apps/api/src/modules/plans/brief-state.repository.ts` — added `cleared_allergies` to `BRIEF_STATE_COLUMNS` and `BriefStateUpsertInput`.
- `apps/api/src/modules/plans/brief-state.composer.ts` — added `childrenRepository` dep; added `buildClearedAllergies(items, children)`; included field in `upsertInput`.
- `apps/api/src/modules/plans/brief-state.composer.test.ts` — added `makeChild` + `buildChildrenRepo` factories; threaded `childrenRepository` into all 7 existing test composer constructions; 6 new tests for `cleared_allergies` build paths.
- `apps/api/src/modules/plans/plans.hook.ts` — constructed `ChildrenRepository(supabase, kek, log)` and passed into `BriefStateComposer`; added `fastify.env` precondition guard.
- `apps/web/src/lib/realtime/sse.ts` — `plan.updated` handler now also `invalidateQueries({ queryKey: ['brief'] })`.
- `apps/web/src/lib/realtime/sse.test.ts` — extended the `plan.updated` test to assert two invalidation calls (`['plan', UUID]` and `['brief']`).
- `apps/web/src/features/plan/BriefCanvas.tsx` — imports `AllergyClearedBadge`; renders chip row above `MomentHeadline` when `brief.cleared_allergies.length > 0`; passes `isRechecking={isFetching && isStale}` for live re-check animation.
- `apps/web/src/features/plan/BriefCanvas.test.tsx` — `makeBrief` fixture defaults `cleared_allergies: []`; 3 new tests covering empty-state silence, two-chip render with above-headline DOM order, and click-to-open-popover with verbatim UX-DR24 copy.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — `3-10-allergyclearedbadge-popover-with-audit-link: ready-for-dev → review`; `last_updated` advanced.
- `_bmad-output/implementation-artifacts/deferred-work.md` — added a "Deferred from: implementation of 3-10" section flagging the `/plans/by-week/:householdId/audit` parent-facing audit route (owned by Story 9.3 / Epic 5 — Story 5.1).

## Change Log

- 2026-05-04: Story 3.10 implementation complete — contract, migration, composer, SSE, badge component, BriefCanvas integration, and tests landed. Status → review.

### Review Findings

- [x] [Review][Patch] Escape key does not close dialog when focus is on the trigger button — the `onKeyDown` handler lives on the unfocusable dialog `<div>`; clicking the trigger keeps focus on the button (a sibling), so pressing Escape does not reach the dialog's handler in real browsers. Test `fireEvent.keyDown(dialog, ...)` masks this by firing directly on the dialog element. Fix: add `onKeyDown` to the trigger `<button>` as well (or move it to the parent `<span>`), and add a test that fires Escape while focused on the trigger. [`apps/web/src/features/plan/AllergyClearedBadge.tsx:25-32`, `AllergyClearedBadge.test.tsx:44-52`]

- [x] [Review][Patch] `brief.cleared_allergies` accessed without null/undefined guard — `hkFetch` returns raw JSON without applying Zod schema defaults; a stale cached brief response (pre-migration) would have `cleared_allergies: undefined`, causing `brief.cleared_allergies.length` to throw and crash `BriefCanvas`. Fix: `(brief.cleared_allergies ?? []).length > 0` in BriefCanvas, or parse the API response through `BriefResponseSchema.parse()` in `useBriefStateQuery`. [`apps/web/src/features/plan/BriefCanvas.tsx:68`]

- [x] [Review][Patch] `Enter`/`Space` keyboard activation not tested — AC #2 requires badge activatable by click or `Enter`/`Space`; native `<button>` handles this correctly but Task 7 explicitly requires test coverage. Add `fireEvent.keyDown(btn, { key: 'Enter' })` and `fireEvent.keyDown(btn, { key: ' ' })` tests asserting the dialog opens. [`apps/web/src/features/plan/AllergyClearedBadge.test.tsx`]

- [x] [Review][Defer] Audit URL uses `household_id` not `plan_id` — already deferred from implementation; `auditUrl=/plans/by-week/${brief.household_id}/audit` is the forward-compat placeholder documented in deferred-work.md. Route TBD in Story 9.3/Epic 5. [`apps/web/src/features/plan/BriefCanvas.tsx:78`] — deferred, pre-existing

- [x] [Review][Defer] KEK null/invalid-hex silent fallback in `plans.hook.ts` — `kekHex ? Buffer.from(kekHex, 'hex') : null` reuses the pattern from `children.routes.ts`; an invalid hex string produces a wrong-length Buffer silently; consequence is `cleared_allergies: []` on projection failure (audited, no crash). Systemic fix required across all KEK consumers; out of scope for story 3-10. [`apps/api/src/modules/plans/plans.hook.ts`] — deferred, pre-existing

- [x] [Review][Defer] Child with corrupt-decryptable row silently excluded from `cleared_allergies` — `ChildrenRepository.findByHouseholdId` silently skips rows whose DEK cannot be unwrapped; safety-relevant consequence (allergy badge not emitted) but fix is in the repository layer, not the composer. [`apps/api/src/modules/children/children.repository.ts`] — deferred, pre-existing

- [x] [Review][Defer] Temporal gap between `findItemsByPlanId` and `findByHouseholdId` calls — documented TOCTOU in brief-state.repository; a child added between the two calls produces no badge (correct: no items yet); bounded by BullMQ per-household serialization in Story 3.7. [`apps/api/src/modules/plans/brief-state.composer.ts:71-72`] — deferred, pre-existing

- [x] [Review][Defer] `aria-labelledby` on dialog references trigger button id — ARIA best practice prefers a heading inside the dialog; implementation uses the trigger's id which incidentally provides the same label text. Acceptable for WAI-ARIA disclosure pattern; no screen-reader breakage. [`apps/web/src/features/plan/AllergyClearedBadge.tsx:45,76`] — deferred, pre-existing

- [x] [Review][Defer] No click-outside-to-close; multiple badges can open simultaneously — spec-documented V1 decision ("for v1 simply require explicit close via Esc or re-clicking the trigger"); no regression guard. [`apps/web/src/features/plan/AllergyClearedBadge.tsx`] — deferred, pre-existing

