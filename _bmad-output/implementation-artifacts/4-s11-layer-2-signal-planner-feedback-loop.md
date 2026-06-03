# Story 4-S11: Layer 2 Signal Weighting → Planner Feedback Loop

Status: done

**Slice key:** `4-s11-layer-2-signal-planner-feedback-loop`
**Epic:** 4 — Lunch Link & Heart Note Sacred Channel
**Source slice doc:** `_bmad-output/planning-artifacts/epic-4-vertical-slices.md` §Slice 4-S11
**Builds on:** 4-S4 (emoji rating captured in `lunch_link_sessions.rating`), 4-S10 (offline rating replay)
**Folds:** 4.14 (full) — FR124, FR125, FR126

---

## Story

As a **parent**, when I repeatedly rate a child's lunch as 😋 (loved) or 🤔 (ok),
I want those signals to **shape the next plan** so that Lumi biases toward dishes the child enjoys,
so that **planning improves over time without me having to give explicit feedback**.

---

## Acceptance Criteria

**AC1 — Migration: `child_preferences` table.**
Migration `supabase/migrations/20261011000000_child_preferences_signal.sql` creates:

```sql
CREATE TABLE child_preferences (
  id           UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  household_id UUID        NOT NULL REFERENCES households(id)  ON DELETE CASCADE,
  child_id     UUID        NOT NULL REFERENCES children(id)    ON DELETE CASCADE,
  recipe_id    UUID        NOT NULL REFERENCES recipes(id)     ON DELETE CASCADE,
  slot_kind    TEXT        NOT NULL CHECK (slot_kind IN ('main','snack','extra')),
  signal_type  TEXT        NOT NULL CHECK (signal_type IN ('loved','ok','not-really')),
  signal_date  DATE        NOT NULL,
  source       TEXT        NOT NULL DEFAULT 'layer1_emoji',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX child_preferences_dedup
  ON child_preferences(child_id, recipe_id, slot_kind, signal_date);
CREATE INDEX child_preferences_household_idx ON child_preferences(household_id);
CREATE INDEX child_preferences_child_date_idx ON child_preferences(child_id, signal_date DESC);
ALTER TABLE child_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY child_preferences_household_rw ON child_preferences
  FOR ALL
  USING (household_id = (SELECT household_id FROM users WHERE id = auth.uid()));
```

**AC2 — Signal write path: rating → `child_preferences`.**
When `POST /v1/lunch-link/:token/rate` is called with a valid rating, AFTER writing
`lunch_link_sessions.rating` (existing behaviour), the system fire-and-forgets a
`recordRatingSignals` call that:

1. Derives the Monday of the session date to find the household's committed plan
   (`guardrail_cleared_at IS NOT NULL`, highest revision, `week_of` = computed Monday).
2. Finds the `plan_days` row for the rating day (day-of-week enum from session date).
3. Reads all `plan_slots` for that `plan_day_id`.
4. For each slot with a resolvable recipe_id (snack/extra slots use `plan_slots.recipe_id` directly;
   main slots join `plan_main_assignments ON plan_main_assignments.id = plan_slots.main_assignment_id`
   to get `recipe_id`), upserts one `child_preferences` row with `signal_type = rating`.
5. If no committed plan exists for the week, logs at `debug` level and skips silently.
6. Errors in steps 1–4 are caught and logged at `warn` level — they never propagate to the rating response.

The rating endpoint response time must not increase by more than 50ms at p95 vs the 4-S4 baseline.

**AC3 — `ChildPreferencesRepository`.**
New file `apps/api/src/modules/child-preferences/child-preferences.repository.ts`.
Uses the Supabase client (same pattern as `PlansRepository`, `ChildrenRepository`).

Required methods:

- `upsertSignal(row: ChildPreferenceInsert): Promise<void>` — upsert via `child_preferences_dedup`
  index. `ON CONFLICT DO UPDATE SET signal_type = EXCLUDED.signal_type` (latest signal wins).
- `getAggregatedSignals(householdId: string, sinceDate: string): Promise<ChildPreferenceAggregate[]>` —
  groups by `(child_id, recipe_id, slot_kind)`, counts loved / ok / not-really separately, joins
  `recipes.canonical_name` for agent readability. Must NOT return rows for recipes that have zero
  signals in the window (FR125 invariant — absence must be invisible in aggregates).

```typescript
export interface ChildPreferenceInsert {
  household_id: string;
  child_id: string;
  recipe_id: string;
  slot_kind: 'main' | 'snack' | 'extra';
  signal_type: 'loved' | 'ok' | 'not-really';
  signal_date: string;   // 'YYYY-MM-DD'
  source?: string;       // defaults to 'layer1_emoji'
}

export interface ChildPreferenceAggregate {
  child_id: string;
  recipe_id: string;
  recipe_name: string;  // recipes.canonical_name join
  slot_kind: 'main' | 'snack' | 'extra';
  loved_count: number;
  ok_count: number;
  not_really_count: number;
  last_signal_at: string;  // ISO date string (MAX of signal_date)
}
```

**AC4 — `child_signal` agent tool contracts.**
New file `packages/contracts/src/child-signal.ts`. Export from `packages/contracts/src/index.ts`.

```typescript
export const ChildSignalInputSchema = z.object({
  household_id: z.string().uuid(),
  lookback_days: z.number().int().min(7).max(90).default(30),
});

export const ChildSignalRecipeItemSchema = z.object({
  recipe_id: z.string().uuid(),
  recipe_name: z.string(),
  slot_kind: z.enum(['main', 'snack', 'extra']),
  count: z.number().int().min(1),
  last_at: z.string(),   // ISO date 'YYYY-MM-DD'
});

export const ChildSignalPerChildSchema = z.object({
  child_id: z.string().uuid(),
  child_name: z.string(),
  liked: z.array(ChildSignalRecipeItemSchema),    // loved_count > 0 OR ok_count > 0
  disliked: z.array(ChildSignalRecipeItemSchema), // not_really_count > 0 AND liked_count === 0
});

export const ChildSignalFamilyPatternSchema = z.object({
  recipe_id: z.string().uuid(),
  recipe_name: z.string(),
  slot_kind: z.enum(['main', 'snack', 'extra']),
  child_count: z.number().int().min(2),  // FR126: at least 2 children required
});

export const ChildSignalOutputSchema = z.object({
  per_child: z.array(ChildSignalPerChildSchema),
  family_liked: z.array(ChildSignalFamilyPatternSchema),
});
```

**AC5 — `child_signal` tool implementation.**
New file `apps/api/src/agents/tools/child-signal.tools.ts`. Tool spec:

- **Name:** `'child_signal'`
- **Description:** (verbatim for the agent) `"Get per-child recipe preference signals from recent emoji ratings. Call once at the start of each planning run. Liked recipes should be preferred in the same slot kind. Disliked recipes should be avoided. Absence of a signal = no data — never infer dislike from absence."`
- **maxLatencyMs:** `200`
- **fn:** calls `ChildPreferencesRepository.getAggregatedSignals` + `ChildrenRepository.findByHouseholdId` in
  parallel. Assembles `per_child` from grouped aggregates (name joined from children rows, using
  `children.name`). `family_liked` requires ≥2 distinct `child_id` entries in `liked` for the
  same `(recipe_id, slot_kind)` pair (FR126). Returns `ChildSignalOutputSchema.parse(result)`.

Registered in `DomainOrchestrator` constructor:
```typescript
TOOL_MANIFEST.set('child_signal', createChildSignalSpec(childPrefsRepo, childrenRepo, redis));
```
Both `childPrefsRepo` (new) and `childrenRepo` (existing — already used by other services) are added to `OrchestratorServices` interface.

**AC6 — Planner prompt v2.1.0.**
`apps/api/src/agents/prompts/planner.prompt.ts` version bumped to `'v2.1.0'`. The following block is
inserted in `PLANNING_CORE` after "Constraints you must honour" and before "Tool usage discipline":

```
Child preference signals:
- Call child_signal once at the start of each planning run to surface recent rating history.
- A child's "liked" list is a preference bias: prefer placing those recipes (or same-cuisine
  alternatives) in the same slot kind during the coming week.
- A child's "disliked" list is an avoidance hint: skip those recipes unless no safe alternative
  exists. Log a degraded reason if you must place a disliked recipe.
- "family_liked" patterns reflect ≥2 children sharing the same preference — treat these as
  strong signals when composing shared-Main assignments.
- CRITICAL (FR125): absence of a signal entry is neutral data. If a recipe has no signal for a
  child, that means no data — NEVER treat it as dislike or negative preference.
- Per-slot independence (FR124): snack signals don't affect main selection. Main signals don't
  affect snack/extra. Slot preferences are scoped to their slot_kind only.
- recipe.search is still the booking mechanism. Use child_signal output to INFORM your queries
  (e.g., include liked recipe names in the search query) — not to replace recipe.search.
- Do not call child_signal more than once per planning run.
```

`'child_signal'` is appended to `PLANNER_PROMPT.toolsAllowed`.

The `tool usage discipline` block gains a one-line addition:
```
- child_signal is called once, before any recipe.search calls. Use its output to bias queries.
```

**AC7 — `variantEligibleChildren` derives from real rating counts.**
The comment block at `orchestrator.ts` L91–L95 ("Epic 4 will derive this from real
lunch_link_sessions rating counts; today it is a manually-flipped MVP stub") is resolved.
`apps/api/src/jobs/planner-context.loader.ts` derives `variantEligibleChildren` from children
in the household who have `COUNT(DISTINCT signal_date) >= 3` in `child_preferences` within the
past 30 days. The manual stub boolean is removed.

**AC8 — FR125 unit test.**
`ChildPreferencesRepository.getAggregatedSignals` is unit-tested to confirm it returns zero rows
for a child who has no entries in the window (absence = invisible, not a zero-score row).

**AC9 — FR124 unit test.**
Unit test verifies that a `loved` signal for `(recipe_id=X, slot_kind='main')` does NOT appear in
the aggregated output for `slot_kind='snack'` even if the same recipe appears in both slots. The
unique index key includes `slot_kind`; the aggregation groups by `slot_kind` independently.

**AC10 — FR126 unit test.**
`child_signal` tool unit test verifies `family_liked` is empty when only one child has liked a
recipe, and populates when two or more children have liked the same `(recipe_id, slot_kind)` pair.

**AC11 — Signal summary API endpoint.**
`GET /v1/children/:childId/signal-summary` added to children routes (auth: `primary_parent` role).
Returns `ChildSignalOutputSchema` output for the single child (30-day lookback).
No web UI is required for this slice — the endpoint is the verification surface.

**AC12 — Typecheck and tests.**
`pnpm typecheck` introduces no new errors. Existing lunch-link route tests, planner prompt tests,
and brief-state tests pass. New tests cover:
- `ChildPreferencesRepository`: upsert idempotency (on-conflict overwrites signal_type),
  aggregation HAVING clause (no zero-row leak), 30-day window cutoff.
- `child_signal` tool: empty household → `{ per_child: [], family_liked: [] }`, FR124/FR125/FR126 invariants.
- `planner.prompt.ts`: version string is `'v2.1.0'`, `toolsAllowed` includes `'child_signal'`.

---

## Demo Path

> 1. Rate three different weekday lunches for child "Layla" as 😋 (loved) via the Lunch Link
> 2. In Supabase: `SELECT * FROM child_preferences WHERE child_id = '<layla-uuid>' ORDER BY signal_date DESC`
>    — confirm rows exist (one per slot per rated day)
> 3. Call `GET /v1/children/<layla-id>/signal-summary` with a valid parent JWT
>    — confirm `per_child[0].liked` includes the loved recipes with their slot_kind
> 4. Trigger plan generation for next week (manually or wait for the scheduled job)
> 5. In the audit_log or planner debug output: confirm `child_signal` tool was called during planning
> 6. Open the next-week plan in `/app` — Layla's tile for the same days shows previously-loved
>    recipes or same-cuisine alternatives biased toward her likes
>
> **Timebox note (slice doc guidance):** If the planner does not visibly bias toward liked recipes
> after two prompt-tuning iterations (AC6 prompt adjustments), accept the infrastructure ACs
> (AC1–AC5, AC7–AC12) as complete and defer prompt tuning to 4-S11b. The infrastructure ships
> regardless.

---

## Critical Guardrails

**Signal write is fire-and-forget — never block the rating response.**
Use `void childPrefsService.recordRatingSignals(...).catch(...)` in the route handler. The child's
emoji tap is optimistically locked in `FeedbackBlock` (4-S4 behaviour). Adding latency to the
`POST /v1/lunch-link/:token/rate` response path would degrade the child's experience.

**No committed plan = no signal write, no error.**
If `guardrail_cleared_at IS NOT NULL` finds no plan for the rating week, log at `debug` and
return. Do NOT throw or surface an error to the rating endpoint. This is a normal state when
the plan hasn't been generated yet for that week.

**`child_preferences` stores no PII.**
`recipe_id`, `slot_kind`, and `signal_type` are not PII. `child_id` is a UUID — child names
are NOT stored here. Names are joined at tool output time only for agent readability.

**FR125 is non-negotiable: absence = no signal.**
`getAggregatedSignals` MUST use `HAVING COUNT(*) > 0` (or equivalent) so zero-signal recipes
never appear in the output. The planner prompt explicitly states the FR125 rule. Test it.

**FR126: per-child signals are never auto-propagated to siblings.**
`per_child` in `ChildSignalOutputSchema` is scoped to each child's own rows. The ONLY cross-child
aggregation is `family_liked`, which requires an explicit ≥2-child threshold.

**`child_signal` goes to the planner only — NOT the swap agent.**
`swap.prompt.ts` handles per-slot substitutions and does not need preference history. Only
`PLANNER_PROMPT.toolsAllowed` gains `'child_signal'`.

**Main slot recipe resolution requires joining `plan_main_assignments`.**
`plan_slots` rows with `slot_kind='main'` have `recipe_id = NULL`. The recipe comes from
`plan_main_assignments WHERE plan_main_assignments.id = plan_slots.main_assignment_id`.
The signal write must follow this join; otherwise main-slot signals are silently skipped.

**Do NOT change `RecipeSearchInputSchema`.**
The planner biases its `recipe.search` queries by including liked recipe names in the natural-
language `query` field. No new fields are added to `RecipeSearchInputSchema` — that is a
contract change requiring web + API coordination and is out of scope for this slice.

**Planner prompt version bump only.**
Increment `planner.prompt.ts` to `v2.1.0`. The rollback procedure documented in the existing
v2.0.0 header comment (`§10.7`) still applies — if bad-output rate exceeds 5% in 24h, revert
the PLANNING_CORE text. Do not change the rollback comment itself.

---

## What Already Exists (Do Not Recreate)

**`lunch_link_sessions.rating`** — `apps/api/src/modules/lunch-link/lunch-link.repository.ts`.
Already writes `'loved'|'ok'|'not-really'` on `POST /v1/lunch-link/:token/rate`. Do NOT move
this write. The child_preferences write is ADDITIVE after the existing behaviour.

**`POST /v1/lunch-link/:token/rate`** — `apps/api/src/modules/lunch-link/lunch-link.routes.ts`.
Fully implemented (4-S4). Only change: add fire-and-forget signal write AFTER the existing
`briefStateComposer.refreshTree(...)` call, following the same `void` + `catch` pattern.

**`briefStateComposer.refreshTree()`** — `apps/api/src/modules/plans/brief-state.composer.ts`.
Already fire-and-forget after the rating. The child_preferences service call follows the same
pattern: `void childPrefsService.recordRatingSignals({...}).catch(...)`.

**`PlansRepository`** — `apps/api/src/modules/plans/plans.repository.ts`.
Has `findDaysByPlanId`, `findSlotsByDayId`, `findMainAssignmentsByPlanId`. These existing methods
cover the three-step resolution for signal write (plan → day → slots → main_assignment join).
Do NOT add a new `findSlotsForPlanDay` wrapper if the existing methods compose cleanly.
If a wrapper is more readable, add it — but don't duplicate the Supabase query pattern.

**`ChildrenRepository`** — `apps/api/src/modules/children/children.repository.ts`.
Has `findByHouseholdId(householdId)` returning `DecryptedChildRow[]`. `DecryptedChildRow.name`
is the child's display name (not `first_name`). Use this method in the `child_signal` tool to
populate `child_name` in the output.

**`DomainOrchestrator` + `TOOL_MANIFEST`** — `apps/api/src/agents/orchestrator.ts`.
Existing `TOOL_MANIFEST.set(...)` pattern in the constructor. `OrchestratorServices` interface
(L135–L142) gets two additions: `childPrefs: ChildPreferencesRepository` and
`children: ChildrenRepository` (the children repo is already injected elsewhere in the codebase;
check the DI wiring in the API bootstrap file before assuming you need to create a new instance).

**`planner-context.loader.ts`** — `apps/api/src/jobs/planner-context.loader.ts`.
Loads `variantEligibleChildren` for each `planWeek` call. Currently a manual-stub boolean
(per the L91–L95 comment). Replace the stub with a real `child_preferences` count query.

**`PLANNER_PROMPT`** — `apps/api/src/agents/prompts/planner.prompt.ts`.
Version `v2.0.0`. The version history comment format (inline `// vX.Y.Z (story-id) — description`)
is the pattern to follow. Increment to `v2.1.0`. Add the version comment entry above `v2.0.0`.

---

## Tasks

### T1 — Migration

**T1.1** Create `supabase/migrations/20261011000000_child_preferences_signal.sql` per AC1.

**T1.2** Apply locally: `pnpm supabase db push` (or `supabase migration up` if using the CLI
directly). Confirm the table, indexes, and RLS policy exist via `\d child_preferences`.

---

### T2 — Repository

**T2.1** Create `apps/api/src/modules/child-preferences/child-preferences.repository.ts`
with `upsertSignal` and `getAggregatedSignals` per AC3. Use the Supabase client pattern
(constructor takes the typed Supabase client, same as `PlansRepository`).

For `getAggregatedSignals`, the `recipes.canonical_name` join cannot be done inline with
`supabase-js`'s `.select()` across tables unless using a view or RPC. Options (pick the
simplest for the data volume):
- A PostgreSQL view `child_preference_aggregates` (joins `child_preferences` + `recipes`);
  query the view with supabase-js.
- Fetch raw aggregates first (without name), then batch-fetch recipe names via
  `recipes WHERE id IN (...)`.
- RPC function `get_child_preference_aggregates(p_household_id, p_since_date)` returning
  the aggregate shape — most efficient, avoids N+1.

Whichever approach, the result MUST include `recipe_name` and MUST use `HAVING COUNT(*) > 0`
equivalent to satisfy FR125.

**T2.2** Create unit tests at `apps/api/src/modules/child-preferences/child-preferences.repository.test.ts`
covering:
- `upsertSignal` idempotency: two upserts with the same key and different `signal_type`
  → second overwrites first (ON CONFLICT DO UPDATE).
- `getAggregatedSignals` 30-day window: signal older than `sinceDate` is excluded.
- AC8 (FR125): query returns zero rows for a child with no signals in window.
- AC9 (FR124): aggregation groups `slot_kind` independently; main-signal rows don't appear
  in snack aggregates.

---

### T3 — Service and signal write wiring

**T3.1** Create `apps/api/src/modules/child-preferences/child-preferences.service.ts` with
`recordRatingSignals(opts: { householdId, childId, rating, signalDate })`.

The method:
1. Computes the Monday of `signalDate` (the `week_of` for the plan lookup).
2. Calls `PlansRepository.findCurrentByHousehold({ householdId, weekId })` — note that
   `weekId` in the plans table is a derived key (the week's UUID from `plan_weeks`). You may
   need to call `findActiveFuturePlanIds` or an equivalent to look up by `week_of` date.
   Use the existing Supabase query pattern: `SELECT id FROM plans WHERE household_id = $1
   AND week_of = $2 AND guardrail_cleared_at IS NOT NULL ORDER BY revision DESC LIMIT 1`.
3. If no plan found: logs `debug` and returns.
4. Finds the `plan_days` row matching the day-of-week derived from `signalDate`.
5. Reads slots via `PlansRepository.findSlotsByDayId(planDayId)`.
6. For `slot_kind='snack'|'extra'`: uses `slot.recipe_id` directly.
7. For `slot_kind='main'`: fetches `plan_main_assignments WHERE id = slot.main_assignment_id`,
   reads `recipe_id`. Use `PlansRepository.findMainAssignmentsByPlanId(planId)` and filter
   by the `main_assignment_id` on the slot.
8. For each resolved `recipe_id`, calls `repo.upsertSignal(...)`. Errors per-slot are caught
   and logged at `warn` — never re-thrown.

**T3.2** Inject `ChildPreferencesService` into the lunch-link Fastify plugin
(`apps/api/src/modules/lunch-link/lunch-link.routes.ts`). Follow the same constructor injection
pattern as `briefStateComposer`.

**T3.3** In `POST /v1/lunch-link/:token/rate`, AFTER `briefStateComposer.refreshTree(...)`:
```typescript
void childPrefsService.recordRatingSignals({
  householdId: session.household_id,
  childId: session.child_id,
  rating: validatedBody.rating,
  signalDate: session.date,   // 'YYYY-MM-DD' from the session row
}).catch(err => {
  request.log.warn({ err }, 'child_preferences: recordRatingSignals failed');
});
```

---

### T4 — `child_signal` agent tool

**T4.1** Create `packages/contracts/src/child-signal.ts` per AC4. Add all four schemas.
Export from `packages/contracts/src/index.ts`.

**T4.2** Create `apps/api/src/agents/tools/child-signal.tools.ts` per AC5.

The tool fn:
1. Parses input with `ChildSignalInputSchema.parse(input)`.
2. Computes `sinceDate` from `lookback_days`: `new Date(Date.now() - lookback_days * 86_400_000).toISOString().slice(0, 10)`.
3. Calls `childPrefsRepo.getAggregatedSignals(household_id, sinceDate)` and
   `childrenRepo.findByHouseholdId(household_id)` in parallel.
4. Builds `per_child` from aggregates grouped by `child_id`:
   - `liked`: rows where `loved_count > 0 || ok_count > 0`, sorted descending by `loved_count + ok_count`.
   - `disliked`: rows where `not_really_count > 0 && loved_count === 0 && ok_count === 0`.
5. Builds `family_liked`: for each `(recipe_id, slot_kind)` pair, count how many distinct
   `child_id` entries appear in `liked`. Include only pairs where count ≥ 2.
6. Returns `ChildSignalOutputSchema.parse({ per_child, family_liked })`.

**T4.3** Register in `DomainOrchestrator` constructor (after existing `TOOL_MANIFEST.set` calls):
```typescript
TOOL_MANIFEST.set('child_signal', createChildSignalSpec(services.childPrefs, services.children, redis));
```

**T4.4** Add `childPrefs: ChildPreferencesRepository` and `children: ChildrenRepository` to the
`OrchestratorServices` interface. Update all construction sites (bootstrap, tests).

**T4.5** Add `'child_signal'` to `PLANNER_PROMPT.toolsAllowed` in `planner.prompt.ts`.

**T4.6** Create `apps/api/src/agents/tools/child-signal.tools.test.ts`:
- Empty household → `{ per_child: [], family_liked: [] }`
- AC10 (FR126): `family_liked` is empty when only 1 child has the signal; populates when ≥2
- `liked` excludes recipes where ONLY `not_really_count > 0`
- `disliked` excludes recipes that also have any `loved_count > 0` or `ok_count > 0`

---

### T5 — Planner prompt v2.1.0

**T5.1** In `apps/api/src/agents/prompts/planner.prompt.ts`, increment `version` to `'v2.1.0'`.
Add version history comment:
```typescript
// v2.1.0 (4-s11) — child_signal tool added; preference-bias instructions + FR124/FR125/FR126
//   rules. Per-slot independence, absence-neutrality, and sibling-scoping documented.
```

**T5.2** Insert the "Child preference signals" block into `PLANNING_CORE` per AC6.

**T5.3** Extend the "Tool usage discipline" block with the `child_signal` one-liner per AC6.

**T5.4** Update `planner.prompt.test.ts` version assertion to `'v2.1.0'`.

---

### T6 — Real `variantEligibleChildren` derivation (AC7)

**T6.1** In `apps/api/src/jobs/planner-context.loader.ts`, replace the manual stub with:
```typescript
// Children with ≥3 distinct signal dates in the past 30 days are eligible
// for variant proposals (Story 3.27). Threshold is conservative: 3 signals
// implies the family has used the rating feature meaningfully.
const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
const variantEligibleChildren = await childPrefsRepo
  .getVariantEligibleChildIds(householdId, thirtyDaysAgo, 3);
```

Add `getVariantEligibleChildIds(householdId, sinceDate, minSignalDates)` to
`ChildPreferencesRepository` — returns `PlannerVariantEligibleChild[]`. The query:
```sql
SELECT cp.child_id, c.name AS child_name
FROM child_preferences cp
JOIN children c ON c.id = cp.child_id
WHERE cp.household_id = $1 AND cp.signal_date >= $2
GROUP BY cp.child_id, c.name
HAVING COUNT(DISTINCT cp.signal_date) >= $3
```

---

### T7 — Signal summary endpoint (AC11)

**T7.1** Add `GET /v1/children/:childId/signal-summary` to
`apps/api/src/modules/children/children.routes.ts` (or the route file that handles per-child
routes — check what already exists before creating a new file). Auth guard: `primary_parent`.

Handler: calls `child_signal` tool logic directly (reuse the service layer, not the tool spec)
for the single child. Returns the `ChildSignalOutputSchema` output filtered to
`per_child.filter(c => c.child_id === childId)`.

---

### T8 — Final verification

**T8.1** `pnpm typecheck` — no new errors.

**T8.2** `pnpm --filter @hivekitchen/api test -- child-preferences` — all new tests pass.

**T8.3** `pnpm --filter @hivekitchen/api test -- child-signal` — all new tool tests pass.

**T8.4** `pnpm --filter @hivekitchen/api test -- lunch-link` — existing tests pass (rating write
path change is additive; existing mocks are unchanged).

**T8.5** `pnpm --filter @hivekitchen/api test -- planner.prompt` — version assertion passes.

---

## Project Structure Notes

**New files:**
- `supabase/migrations/20261011000000_child_preferences_signal.sql`
- `apps/api/src/modules/child-preferences/child-preferences.repository.ts`
- `apps/api/src/modules/child-preferences/child-preferences.repository.test.ts`
- `apps/api/src/modules/child-preferences/child-preferences.service.ts`
- `apps/api/src/agents/tools/child-signal.tools.ts`
- `apps/api/src/agents/tools/child-signal.tools.test.ts`
- `packages/contracts/src/child-signal.ts`

**Modified files:**
- `packages/contracts/src/index.ts` — add `child-signal.ts` exports
- `apps/api/src/agents/prompts/planner.prompt.ts` — v2.1.0, preference block, `child_signal` in toolsAllowed
- `apps/api/src/agents/orchestrator.ts` — register `child_signal` in TOOL_MANIFEST; add `childPrefs` +
  `children` to `OrchestratorServices`; update `planWeek` to accept `childPrefs` in services
- `apps/api/src/jobs/planner-context.loader.ts` — real `variantEligibleChildren` derivation
- `apps/api/src/modules/lunch-link/lunch-link.routes.ts` — fire-and-forget signal write after rating
- `apps/api/src/modules/child-preferences/child-preferences.repository.ts` — (new, listed above for clarity)

**Possibly modified (check before assuming):**
- `apps/api/src/modules/plans/plans.repository.ts` — only if a new convenience method is needed;
  prefer composing existing `findDaysByPlanId` + `findSlotsByDayId` + `findMainAssignmentsByPlanId`
- `apps/api/src/modules/children/children.routes.ts` — signal-summary endpoint addition

**Not modified:**
- `packages/contracts/src/recipe.ts` — `RecipeSearchInputSchema` unchanged
- `apps/api/src/agents/prompts/swap.prompt.ts` — no `child_signal` in swap agent
- `apps/api/src/modules/lunch-link/lunch-link.repository.ts` — session write path unchanged
- `apps/web/` — no web changes in this slice

---

## Task Completion Checklist

- [x] T1.1 — Migration `20261013000000_child_preferences_signal.sql` created (timestamp bumped from prescribed `20261011000000` — that slot was taken by `20261011000000_brief_state_payload.sql` (3-DM-D1) after this story was authored; collision avoided)
- [~] T1.2 — Migration apply is a USER-SIDE GATE (no local Supabase stack in this env; same pattern as 3-DM-D1/E1 — `supabase db push --include-all`). Tests are mock-based and pass without the live table.
- [x] T2.1 — `child-preferences.repository.ts`: `upsertSignal` + `getAggregatedSignals` (+ `getVariantEligibleChildIds` for AC7)
- [x] T2.2 — Repository tests: idempotency (on-conflict dedup key), 30-day window cutoff, FR125 (no zero-row), FR124 (slot-kind isolation) — 9/9 pass
- [x] T3.1 — `child-preferences.service.ts`: `recordRatingSignals` with plan lookup (`findCommittedPlanIdByWeekOf`) + day/slot resolution + main-assignment join
- [x] T3.2 — `ChildPreferencesService` constructed in lunch-link plugin
- [x] T3.3 — Fire-and-forget signal write added after `briefStateComposer.refreshTree()` in rate route
- [x] T4.1 — `packages/contracts/src/child-signal.ts` created + exported (contracts index + `packages/types` inferred types)
- [x] T4.2 — `child-signal.tools.ts` created; assembly logic in `child-signal.assembler.ts` (shared with the endpoint); builds per_child + family_liked correctly
- [x] T4.3 — `TOOL_MANIFEST.set('child_signal', ...)` in orchestrator constructor (+ manifest stub for the Story 1.9 CI lint)
- [x] T4.4 — `OrchestratorServices` gains `childPrefs` + `children`; all 3 construction sites updated (hook + 2 test files)
- [x] T4.5 — `'child_signal'` added to `PLANNER_PROMPT.toolsAllowed`
- [x] T4.6 — Tool tests: empty household, FR126 family threshold, liked/disliked exclusion rules — all pass
- [x] T5.1 — `planner.prompt.ts` version `'v2.1.0'` with history comment
- [x] T5.2 — Preference signal block inserted in PLANNING_CORE
- [x] T5.3 — Tool usage discipline updated with `child_signal` one-liner
- [x] T5.4 — `planner.prompt.test.ts` + `plan.tools.test.ts` version assertions updated to v2.1.0
- [x] T6.1 — `planner-context.loader.ts` derives `variantEligibleChildren` from real `child_preferences` counts (≥3 distinct dates / 30d); both jobs rewired; dead `findVariantEligibleByHousehold` removed; orchestrator stub comment resolved
- [x] T7.1 — `GET /v1/children/:childId/signal-summary` endpoint added (primary_parent, 30-day lookback, per_child filtered to the child)
- [x] T8.1–T8.5 — API typecheck introduces no new errors (11 pre-existing baseline errors, none in 4-S11 files); full API suite 19 failed / 1312 passed — all 19 failures proven pre-existing via stash comparison; all 4-S11 tests green

---

## Dev Notes

### Why not extend `RecipeSearchInputSchema` with preference weights?

The slice doc states "planner.tools.recipe.search reads per-child weights only" — the cleanest
interpretation is that the planner AGENT uses `child_signal` output to bias its `recipe.search`
query strings (e.g., including a liked recipe name in the query), not that the search schema
gains preference parameters. Adding a `preferred_recipe_ids` field to `RecipeSearchInputSchema`
would be a coordinated contract change (web + API must both update), and the search service would
need weighted-ranking logic. The agent-driven approach keeps the contract stable: agent calls
`child_signal`, gets liked recipe names, includes them in natural-language `recipe.search` queries.
If this doesn't produce visible plan bias, the prompt (T5) is the tuning lever.

### Main slot recipe resolution

`plan_slots` rows with `slot_kind='main'` have `recipe_id = NULL` — the FK is `main_assignment_id`
pointing to `plan_main_assignments.id`. The signal write MUST join through this to get the actual
`recipe_id`. Forgetting this means main-slot signals are silently skipped, leaving only snack and
extra signals in `child_preferences`. Test with a 3-slot day (main + snack + extra) to confirm all
three rows appear in `child_preferences` after a rating.

### `not-really` signal is stored, not suppressed

FR125 governs ABSENT ratings ("skipped or not swiped = no signal"). An explicit `'not-really'`
tap IS a deliberate signal — the child chose to communicate. We store it and expose it in the
`disliked` array. The planner prompt uses it as an avoidance hint, not a hard block (allergen
guardrail is the hard block). If future user research shows negative-signal storage causes plan
quality issues, the `disliked` array can be dropped from `child_signal` output without a
migration (data stays in the table for historical analysis).

### `family_liked` threshold is ≥2 children

The threshold is set to 2 by the FR126 contract. In single-child households, `family_liked` is
always empty — that is correct and expected. The planner prompt should handle this gracefully
(no `family_liked` entries → plan as normal using `per_child` signals only).

### `variantEligibleChildren` threshold: 3 signals in 30 days

Arbitrary; matches the "meaningful usage" intuition. The TODO comment in orchestrator.ts was
explicit that "Epic 4 will derive this from real counts" — this is the resolution. If the threshold
proves too conservative (users with 1–2 ratings never get variants), lower to 2. The threshold
is a single constant in `planner-context.loader.ts`.

### Timebox guidance from the slice doc

This is the "most research-y slice." The infrastructure (AC1–AC5, AC7–AC12) is deterministic and
should ship. The prompt tuning (AC6) is the variable. If the planner doesn't visibly bias toward
liked recipes in the live system after two iterations of T5 prompt adjustment, the story is
complete with a note: "Prompt bias not yet visible — deferred to 4-S11b." Do not hold the
infrastructure indefinitely waiting for perfect planner behaviour.

---

## References

- [Source: `_bmad-output/planning-artifacts/epic-4-vertical-slices.md` §Slice 4-S11]
- [Source: `_bmad-output/planning-artifacts/epics.md` §Story 4.14 — FR124, FR125, FR126 BDD + §Epic 4 Scope]
- [Source: `apps/api/src/agents/orchestrator.ts`] — `DomainOrchestrator`, `PlanWeekOptions`, `OrchestratorServices`, `PlannerVariantEligibleChild` (L91–L95 stub comment)
- [Source: `apps/api/src/agents/prompts/planner.prompt.ts`] — v2.0.0 baseline; rollback procedure §10.7
- [Source: `apps/api/src/agents/tools/recipe.tools.ts`] — `ToolSpec` pattern to follow
- [Source: `apps/api/src/modules/lunch-link/lunch-link.routes.ts`] — rating write path + fire-and-forget pattern
- [Source: `apps/api/src/modules/plans/plans.repository.ts`] — `findDaysByPlanId`, `findSlotsByDayId`, `findMainAssignmentsByPlanId`
- [Source: `apps/api/src/modules/children/children.repository.ts`] — `findByHouseholdId`, `DecryptedChildRow.name`
- [Source: `apps/api/src/modules/plans/brief-state.composer.ts`] — fire-and-forget pattern (`void ... .catch(...)`)
- [PRD FR124] — Layer 2 per-slot signals weighted independently
- [PRD FR125] — Absence of rating = "no signal", never negative
- [PRD FR126] — Sibling-specific vs family-wide preference patterns

---

## Dev Agent Record

### Implementation Plan / Notes

Built bottom-up: migration → contracts → repository → service+route → tool+orchestrator → prompt → variant-eligibility rewire → endpoint → verify.

Key decisions and deviations:

- **Migration timestamp bumped** `20261011000000` → `20261013000000`. AC1's prescribed
  slot was claimed by `20261011000000_brief_state_payload.sql` (3-DM-D1) after this story
  was authored. A duplicate timestamp would break migration ordering, so the next free
  slot (after `20261012000000_plan_day_context_rename.sql`) was used. The table/index/RLS
  SQL is otherwise verbatim per AC1. **Live apply is a user-side gate** (no local Supabase
  stack in this environment — same pattern as 3-DM-D1/E1).

- **Aggregation done in-process over a windowed fetch**, not via an RPC/view. `supabase-js`
  can't `GROUP BY`, and the FR124/FR125 invariants are far more deterministically testable
  when the grouping is plain TypeScript. Per-household 30-day volume is tiny. The
  `recipes.canonical_name` / `children.name` joins use FK-embedded selects
  (`recipes(canonical_name)` / `children(name)`), normalized for the object|array typing.
  FR125 (absence invisible) and FR124 (slot-kind isolation) fall out of the group key
  naturally — no `HAVING` needed because empty groups are never created.

- **Shared assembler** (`child-signal.assembler.ts`, one extra file not in the story's
  explicit list). AC11's endpoint must "reuse the service layer, not the tool spec", so the
  per_child/family_liked assembly + parallel load live in a module function consumed by BOTH
  the `child_signal` tool and the `/signal-summary` route. Keeps the agent tool a thin
  ToolSpec wrapper and respects layering (agents → modules; routes → modules; nobody imports
  agents/).

- **Manifest stub added** for `child_signal` in `tools.manifest.ts`. The Story 1.9 CI lint
  (`check-tool-manifest.ts`) imports the static `TOOL_MANIFEST` map and requires every name
  exported by a `*.tools.ts` `MANIFESTED_TOOL_NAMES` to be present with all 6 fields; the
  constructor `.set()` runs only at runtime, so a stub entry is required (matches the
  established Stub→Real doctrine). Lint passes (the only violation is a pre-existing one in
  `onboarding.tools.ts`, untouched by this slice).

- **AC7** rewired `loadVariantEligibleChildrenForHousehold` to read `child_preferences`
  signal counts (≥3 distinct dates / 30d) via the new
  `getVariantEligibleChildIds`. Both BullMQ jobs construct a `ChildPreferencesRepository`
  and pass it. The now-unused `ChildrenRepository.findVariantEligibleByHousehold` was
  removed; the `children.variant_eligible` column is left in place (dropping it is a
  separate migration, out of scope) and the orchestrator stub comment (L91-95) is resolved.

### Completion Notes

- All 12 ACs satisfied (AC1 migration shipped; live apply is a user-side gate).
- Latency guardrail (AC2, ≤50ms p95): the signal write is `void …catch` fire-and-forget after
  the rating is persisted, so the rate response path is unchanged.
- `pnpm --filter @hivekitchen/api typecheck`: 11 errors, ALL in untouched files (evals/runner,
  households/health/voice tests, heart-notes contract — the known zod-v4/audit-type baseline).
  Zero new errors in any 4-S11 file.
- `pnpm --filter @hivekitchen/api test`: 19 failed / 1312 passed / 13 skipped. All 19 failures
  proven pre-existing via a `git stash -u` baseline run (identical failures with the slice
  stashed). The slice added 31 net passing tests.
- 4-S11-specific suites green: child-preferences repository (9), child-preferences service (6),
  child-signal tool (12), planner.prompt (6), plan.tools (7) — 40/40.

### USER-SIDE GATE (remaining)

- Apply migration `20261013000000_child_preferences_signal.sql` to the linked Supabase project
  via `supabase db push --include-all`. Until applied, the runtime signal write + `child_signal`
  tool + `/signal-summary` endpoint will error against the missing table; all unit/integration
  tests are mock-based and pass without it.

## File List

**New:**
- `supabase/migrations/20261013000000_child_preferences_signal.sql`
- `packages/contracts/src/child-signal.ts`
- `apps/api/src/modules/child-preferences/child-preferences.repository.ts`
- `apps/api/src/modules/child-preferences/child-preferences.repository.test.ts`
- `apps/api/src/modules/child-preferences/child-preferences.service.ts`
- `apps/api/src/modules/child-preferences/child-preferences.service.test.ts`
- `apps/api/src/modules/child-preferences/child-signal.assembler.ts`
- `apps/api/src/agents/tools/child-signal.tools.ts`
- `apps/api/src/agents/tools/child-signal.tools.test.ts`

**Modified:**
- `packages/contracts/src/index.ts` — export `child-signal.js`
- `packages/types/src/index.ts` — `child_signal` inferred type exports
- `apps/api/src/agents/tools.manifest.ts` — `child_signal` stub spec + map entry + schema imports
- `apps/api/src/agents/orchestrator.ts` — `OrchestratorServices.childPrefs`/`children`; register `child_signal`; resolve variant-eligible stub comment
- `apps/api/src/agents/orchestrator.hook.ts` — construct + inject `childPrefs` + `children`
- `apps/api/src/agents/orchestrator.test.ts` — `childPrefs`/`children` mocks at both construction sites
- `apps/api/src/agents/orchestrator.planweek.test.ts` — `childPrefs`/`children` mocks
- `apps/api/src/agents/prompts/planner.prompt.ts` — v2.1.0; preference block; tool-usage line; `child_signal` in toolsAllowed
- `apps/api/src/agents/prompts/planner.prompt.test.ts` — v2.1.0 + FR125 assertions; 9-tool list
- `apps/api/src/agents/tools/plan.tools.test.ts` — v2.1.0 assertion
- `apps/api/src/modules/plans/plans.repository.ts` — `findCommittedPlanIdByWeekOf`
- `apps/api/src/modules/lunch-link/lunch-link.routes.ts` — fire-and-forget signal write after rating
- `apps/api/src/modules/children/children.repository.ts` — remove dead `findVariantEligibleByHousehold`
- `apps/api/src/modules/children/children.routes.ts` — `GET /v1/children/:childId/signal-summary`
- `apps/api/src/jobs/planner-context.loader.ts` — real variant-eligible derivation
- `apps/api/src/jobs/plan-generation.job.ts` — construct + pass `childPreferencesRepository`
- `apps/api/src/jobs/plan-regeneration.job.ts` — construct + pass `childPreferencesRepository`

---

### Review Findings

- [x] [Review][Patch] RLS policy references `users.household_id` but column is `current_household_id` [`supabase/migrations/20261013000000_child_preferences_signal.sql:39`] — fixed: `household_id` → `current_household_id`

- [x] [Review][Defer] `heart_notes` migration (20260901) has the same wrong `users.household_id` column — pre-existing from 4-S3; fix in a separate migration cleanup slice [`supabase/migrations/20260901000000_create_heart_notes.sql`] — deferred, pre-existing

---

## Change Log

- 2026-06-03 — 4-S11 implemented: Layer 2 emoji-rating signals → `child_preferences` →
  `child_signal` planner tool + preference-bias prompt (v2.1.0) + real variant-eligibility
  derivation + per-child `/signal-summary` endpoint. Status → review.
