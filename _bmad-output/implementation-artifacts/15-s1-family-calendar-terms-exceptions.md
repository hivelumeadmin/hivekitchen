# Story 15.1: family-calendar-terms-exceptions

Status: ready-for-dev

<!-- Epic 15: Canonical Data Model v2. Source spec: _bmad-output/planning-artifacts/canonical-data-model-v2-spec.md §4.6 (Calendar), §3.3 (resolver), §7 (cross-cutting), §8 step 1 (additive, ships alone). -->

## Story

As a parent,
I want HiveKitchen to know my family's school terms and no-lunch days before it plans the week,
so that Lumi composes lunches only for the days that actually need one — instead of planning a full Mon–Fri week through half-term and holidays.

## Acceptance Criteria

1. **Migration `20261035000000_create_family_calendar.sql`** creates `calendar_source` + `calendar_exception_kind` enums, `calendar_terms`, and `calendar_exceptions` per the DDL in Dev Notes — including CHECKs, the COALESCE-sentinel unique index on exceptions, lookup indexes, RLS **in the same file**, and `bump_kitchen_map_version()` triggers on **both** tables **in the same file** (spec §7.3 — this invariant has burned us before). A `-- Rollback:` comment block lists the DROP statements. **USER-SIDE GATE:** `supabase db push --include-all`.
2. **Contracts** `packages/contracts/src/family-calendar.ts` (+ `family-calendar.test.ts`) define term/exception row schemas, create-input schemas, and a wrapped `FamilyCalendarResponseSchema { terms, exceptions }`; types plumbed through `packages/types`; `contracts:check` passes.
3. **REST endpoints** on `households.routes.ts`: `GET /v1/households/:id/calendar` (both caregiver roles), `POST .../calendar/terms`, `DELETE .../calendar/terms/:termId`, `POST .../calendar/exceptions`, `DELETE .../calendar/exceptions/:exceptionId` (writes: parent-or-caregiver). Every handler 403s when the path household ≠ JWT household. Deletes return 204 and are idempotent-safe (missing row → 404 via maybeSingle-boolean, matching `extra-library.archive()`).
4. **Pure resolver** `resolveLunchDays({ terms, exceptions, weekOf })` returns `Weekday[] | undefined`: `undefined` when **no term covers the week** (= today's behavior, the fallback); otherwise the union of covering terms' weekdays mapped onto the week's dates, minus dates removed by household-wide `no_lunch` / `school_meal` / `trip` exceptions. `early_release` and `other` never remove a day. Child-scoped exception rows are stored but do NOT alter the household day set in v1 (per-child absence remains the existing pause flow). Pure date-string arithmetic, no `Date` timezone traps — follow `derive-week-id.ts` conventions.
5. **Planner integration:** `plan-generation.job.ts` loads the household's calendar alongside the other context loaders, computes `lunchDays`, intersects it with any incoming `planned_days` (mid-week on-demand window), and passes the result through the **existing `plannedDays` seam** — reaching the prompt line (orchestrator), the snack rotation, and the tracer with no new plumbing. Empty calendar ⇒ `undefined` ⇒ byte-identical current behavior (proven by existing planner tests staying green unmodified where they don't touch the new loader).
6. **Server-authoritative day set:** `buildCommitInputTree` filters `output.days` to the effective day set when one is defined — the model cannot re-add a holiday (spec §1.2: "the LLM proposes; the deterministic core disposes"). A week whose effective day set is **empty** (holiday week) skips composition gracefully: job logs `calendar_no_lunch_days`, writes no plan, does not throw.
7. **Saturday works end-to-end** when a term declares ISO weekday 6: the prompt window includes saturday AND the snack rotation covers it — `snack-rotation.service.ts` must honor a provided day set verbatim instead of intersecting with its Mon–Fri `SCHOOL_DAYS` (which today silently drops saturday).
8. **Audit:** one new event type `household.calendar_updated` (metadata: `action` ∈ term_created|term_deleted|exception_created|exception_deleted — no free-text, no dates-as-PII concerns but keep `note` OUT of metadata), added in BOTH `audit.types.ts` and migration `20261035000100_add_calendar_audit_type.sql`; the audit parity test passes.
9. **Gates:** `pnpm turbo lint typecheck test` green across packages; `knip` exit 0; API/contracts suites at documented baselines with zero new failures; **no `apps/web` source changes** (frontend surfacing is a later slice), therefore full E2E stays at baseline (425 pass / 13 skip / 0 fail) with `apps/web/test` untouched and `13-s1-ux-regression-baseline.spec.ts` unedited.

## Tasks / Subtasks

- [ ] Task 1 — Migration (AC: #1)
  - [ ] 1.1 `supabase/migrations/20261035000000_create_family_calendar.sql`: enums (DO-block idempotent form) → `calendar_terms` → `calendar_exceptions` → unique index → lookup indexes → RLS → kitchen-map triggers → `-- Rollback:` block. Full DDL in Dev Notes.
  - [ ] 1.2 `supabase/migrations/20261035000100_add_calendar_audit_type.sql`: `ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'household.calendar_updated';` + rollback note (enum values can't be dropped — document as such, precedent 20260700000100).
- [ ] Task 2 — Contracts + types (AC: #2)
  - [ ] 2.1 `packages/contracts/src/family-calendar.ts`: `CalendarTermSchema`, `CalendarExceptionSchema`, `CreateCalendarTermInputSchema`, `CreateCalendarExceptionInputSchema`, `FamilyCalendarResponseSchema`, `CalendarHouseholdIdParamSchema`, `CalendarTermIdParamSchema`, `CalendarExceptionIdParamSchema`. snake_case wire fields; `z.string().date()` for dates; `.datetime({ offset: true })` for `created_at`; `weekdays: z.array(z.number().int().min(1).max(6)).min(1)` (ISO 1=Mon; NO sunday — the `weekday` enum has none); `.refine(end_date >= start_date)`. Open with the standard story/migration header comment.
  - [ ] 2.2 Export from `packages/contracts/src/index.ts` (append, `.js` extension); `z.infer` aliases in `packages/types/src/index.ts` (both the import block and the alias block); run `contracts:check`.
  - [ ] 2.3 `family-calendar.test.ts`: valid shapes, rejects weekday 0/7, rejects end<start, rejects bad kind/source, wrapped-response round-trip.
- [ ] Task 3 — Repository + routes (AC: #3, #8)
  - [ ] 3.1 `apps/api/src/modules/households/family-calendar.repository.ts` extending `BaseRepository`: `createTerm`, `createException`, `findByHousehold` (both tables, ordered), `findForWeek(householdId, weekOf)` (date-range overlap query — copy `cultural-calendar.service.ts:43-80` `.lte('start_date', weekEnd).gte('end_date', weekOf)` for terms; `.gte('on_date', weekOf).lte('on_date', weekEnd)` for exceptions), `deleteTerm`/`deleteException` (eq id + eq household_id → maybeSingle boolean, `extra-library.archive()` pattern).
  - [ ] 3.2 Five routes in `households.routes.ts` (plugin-scope `new FamilyCalendarRepository(fastify.supabase)`, no app.ts change). Guards: reads `requireMember`, writes `requireParentOrCaregiver` (packers precedent — calendar entries are day-logistics both caregivers manage, unlike extra-library's primary-parent-only food decisions). JWT-vs-path 403 check in every handler. `request.auditContext` on all four writes (route-set pattern, `households.routes.ts:686-697`).
  - [ ] 3.3 Route tests: extend the in-file `buildMockSupabase` in `households.routes.test.ts` with `calendarTermsTable`/`calendarExceptionsTable` factories modelling only the chains the repo calls. Cover: happy path each route, cross-household 403, guest_author 403 on writes, 404 on missing delete target, response parses against the real contract schema.
  - [ ] 3.4 `audit.types.ts`: add `household.calendar_updated` to `AUDIT_EVENT_TYPES` (parity test will fail until 1.2 exists — that is the test working).
- [ ] Task 4 — Resolver (AC: #4)
  - [ ] 4.1 `apps/api/src/modules/households/family-calendar.resolver.ts`: pure `resolveLunchDays({ terms, exceptions, weekOf }): Weekday[] | undefined`. Week dates = `weekOf` (Monday) + 0..5 offsets as `YYYY-MM-DD` strings (UTC-midnight arithmetic per `derive-week-id.ts:69` comment). A date is covered by a term when `start_date <= date <= end_date` AND its ISO weekday ∈ `weekdays`. Union across ALL terms (child-scoped or household-wide — any child in school that day means a lunch is needed). Then remove dates with a household-wide (`child_id IS NULL`) exception of kind `no_lunch`|`school_meal`|`trip`. Return long-form `Weekday` values (`'monday'`…`'saturday'` — NEVER the 3-letter plan-intent forms).
  - [ ] 4.2 Unit tests (colocated): no-terms → undefined; term covering part of week; term boundary days (start/end date inclusive); weekday-subset term; saturday term; each exception kind (removing vs non-removing); child-scoped exception ignored; multi-term union; fully-excepted week → `[]` (empty array, NOT undefined — the caller distinguishes "no calendar" from "calendar says no lunch").
- [ ] Task 5 — Planner wiring (AC: #5, #6)
  - [ ] 5.1 `plan-generation.job.ts`: load calendar via `FamilyCalendarRepository.findForWeek` in the existing context `Promise.all` block (~:409-449, `loadCulturalContextForHousehold` precedent — failure → undefined + warn log, never fails the job). Compute `lunchDays = resolveLunchDays(...)`. Effective set = `lunchDays` ∩ `planned_days` when both defined; whichever is defined otherwise; undefined when neither.
  - [ ] 5.2 Empty effective set → log `calendar_no_lunch_days`, return without composing (before any LLM call or snack rotation). Test this path.
  - [ ] 5.3 Pass the effective set as `plannedDays` into `assignSnackRotation` (~:490-497) and BOTH `planWeek` calls (~:561 initial, ~:651 guardrail-retry regen). Do NOT touch `plan-regeneration.job.ts` (day-scoped regen) — `orchestrator.ts:301-303` throws on `plannedDays`+`dayScope` together; calendar applies to full-week composition only in this slice.
  - [ ] 5.4 `buildCommitInputTree` (~:113-158): when an effective day set is defined, filter `output.days` to it before building the commit tree. Test: model emits a holiday day → committed tree lacks it.
  - [ ] 5.5 Generalize the orchestrator context line (`orchestrator.ts:462-468`): the current text says "the plan starts mid-week", which is wrong framing for a term holiday. Reword to cover both (e.g. "the omitted days do not need a lunch (mid-week start or family-calendar day off)"). Update `planner.prompt.ts:57-61` + `:170-175` prose ("Monday through Friday by default…") to mention the family calendar as the authority when present; bump `PLANNER_PROMPT.version` per its header convention.
- [ ] Task 6 — Snack rotation Saturday (AC: #7)
  - [ ] 6.1 `snack-rotation.service.ts` (~:169-171): when `plannedDays` is provided, use it verbatim as the rotation day list (ordered by `WEEKDAY_ORDER`); keep Mon–Fri `SCHOOL_DAYS` ONLY as the no-input fallback. Update its unit tests; add a saturday-included case.
- [ ] Task 7 — Verification & gates (AC: #9)
  - [ ] 7.1 `pnpm turbo lint typecheck test` (all packages), `knip` exit 0, `contracts:check`.
  - [ ] 7.2 Full API suite: zero NEW failures vs the documented pre-existing baseline; audit parity test green.
  - [ ] 7.3 Confirm zero `apps/web/src` + `apps/web/test` changes (`git diff --stat` empty for both); E2E therefore not re-gated — record this reasoning, run the full suite anyway if any shared package changed shape (contracts DID change → run it; expect 425/13/0).
  - [ ] 7.4 Dev Record: files, decisions, deviations, baselines; update `sprint-status.yaml` note.

## Dev Notes

### DDL (AC #1 — authoritative; deviations must be recorded)

```sql
-- Enums: DO-block idempotent form (precedent 20260700000000_create_school_policies.sql:15)
DO $$ BEGIN
  CREATE TYPE calendar_source AS ENUM ('manual', 'google_readonly', 'school_import');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE calendar_exception_kind AS ENUM ('no_lunch', 'early_release', 'school_meal', 'trip', 'other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS calendar_terms (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  child_id     uuid REFERENCES children(id) ON DELETE CASCADE,  -- NULL = whole household
  label        text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 80),
  start_date   date NOT NULL,
  end_date     date NOT NULL,
  weekdays     smallint[] NOT NULL DEFAULT '{1,2,3,4,5}',
  source       calendar_source NOT NULL DEFAULT 'manual',
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date),
  CHECK (weekdays <@ ARRAY[1,2,3,4,5,6]::smallint[] AND array_length(weekdays, 1) >= 1)
);

CREATE TABLE IF NOT EXISTS calendar_exceptions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  child_id     uuid REFERENCES children(id) ON DELETE CASCADE,  -- NULL = whole household
  on_date      date NOT NULL,
  kind         calendar_exception_kind NOT NULL,
  note         text CHECK (char_length(note) <= 200),
  source       calendar_source NOT NULL DEFAULT 'manual',
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Postgres table-level UNIQUE cannot take expressions; COALESCE form requires a
-- UNIQUE INDEX (in-repo precedent + rationale: 20261008000000:51-67)
CREATE UNIQUE INDEX calendar_exceptions_scope_date_uniq
  ON calendar_exceptions (
    household_id,
    COALESCE(child_id, '00000000-0000-0000-0000-000000000000'::uuid),
    on_date
  );
CREATE INDEX calendar_terms_household_idx ON calendar_terms (household_id);
CREATE INDEX calendar_terms_range_idx ON calendar_terms (household_id, start_date, end_date);
CREATE INDEX calendar_exceptions_household_date_idx ON calendar_exceptions (household_id, on_date);

-- RLS: canonical inline-subquery pattern (20261013000000:37-40). There is NO
-- current_household_id() SQL function in this codebase. child_id needs no predicate.
ALTER TABLE calendar_terms ENABLE ROW LEVEL SECURITY;
CREATE POLICY calendar_terms_household_rw ON calendar_terms FOR ALL
  USING (household_id = (SELECT current_household_id FROM users WHERE id = auth.uid()));
ALTER TABLE calendar_exceptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY calendar_exceptions_household_rw ON calendar_exceptions FOR ALL
  USING (household_id = (SELECT current_household_id FROM users WHERE id = auth.uid()));

-- Kitchen-map version bump: REUSE bump_kitchen_map_version() (20260820000000:72-96),
-- trigger DDL per 20261008000200:18-21. Spec §7.3: same migration, no exceptions.
CREATE TRIGGER calendar_terms_bump_kitchen_map
  AFTER INSERT OR UPDATE OR DELETE ON calendar_terms
  FOR EACH ROW EXECUTE FUNCTION bump_kitchen_map_version();
CREATE TRIGGER calendar_exceptions_bump_kitchen_map
  AFTER INSERT OR UPDATE OR DELETE ON calendar_exceptions
  FOR EACH ROW EXECUTE FUNCTION bump_kitchen_map_version();

-- Rollback:
--   DROP TRIGGER IF EXISTS calendar_terms_bump_kitchen_map ON calendar_terms;
--   DROP TRIGGER IF EXISTS calendar_exceptions_bump_kitchen_map ON calendar_exceptions;
--   DROP TABLE IF EXISTS calendar_exceptions; DROP TABLE IF EXISTS calendar_terms;
--   DROP TYPE IF EXISTS calendar_exception_kind; DROP TYPE IF EXISTS calendar_source;
```

No `updated_at` / `set_updated_at` trigger — v1 has no UPDATE operation (delete + recreate); spec DDL carries none either.

### Reconciliations against codebase reality (read before coding — Epic 14 retro made this section mandatory)

1. **The LLM currently decides the day set.** There is no server-side lunch-day computation; the planner prompt says "Monday through Friday by default" in prose (`planner.prompt.ts:57-61`) and nothing validates the model's `days[]` against any intended set (`plan.ts:666` accepts any 1–6 days). This story introduces the FIRST deterministic day authority — AC #6's filter is not optional hardening, it is the point of the slice.
2. **`plannedDays` is the designed, tested seam** (`planner.prompt.ts:28-29` says so explicitly). It already reaches the prompt (`orchestrator.ts:462-468`, unshifted to position 0), snack rotation (`snack-rotation.service.ts:169-171`), and the tracer (`plan-tracer.ts:70,91` renders `'(default week)'` when absent). Reuse it; do NOT invent a parallel `lunchDays` option on `PlanWeekOptions`.
3. **Weekday vocabulary hazard:** long form (`'monday'`…`'saturday'`, `WeekdaySchema`, `plan.ts:357-364`) is DB/contract canon; the 3-letter forms live ONLY in plan-intent + web store. The resolver and everything in this slice keys on the long form.
4. **Snack rotation silently drops Saturday** (`SCHOOL_DAYS` is Mon–Fri and the plannedDays path *intersects* with it). Without Task 6, AC #7 is impossible — a saturday term would produce a saturday plan day with no snack slot.
5. **Omit, don't pause.** Calendar-excluded days must be OMITTED from `days[]` (the partial-week path), never composed-then-paused: `pauseDayTree` throws for days absent from the plan (`plans.service.ts:1356-1361`) and paused days render as parent-intent prose — "paused, just as you asked" (`brief-state.composer.ts:737-740`) — which would be a false claim about a school holiday. The existing pause flow stays untouched and orthogonal.
6. **`plannedDays` and `dayScope` are mutually exclusive** (`orchestrator.ts:301-303` throws). Calendar day sets apply only to the full-week compose paths inside `plan-generation.job.ts` (initial + guardrail-retry); day-scoped regen (`plan-regeneration.job.ts`) is out of scope and must not receive one.
7. **On-demand mid-week composes already narrow days** via `deriveCompositionWindow` (`plans.service.ts:703` → `derive-week-id.ts:50-95`). The calendar INTERSECTS with that window; it does not replace it. Cron path window = full week, so intersection is a no-op there.
8. **`cultural_calendar_observances` is the structural precedent**, not a collision: global (not household-scoped) observance ranges, loaded via `cultural-calendar.service.ts:43-80` date-overlap queries and fanned in through `planner-context.loader.ts:255-278`. Copy its query shape and loader wiring style; do not extend that table.
9. **Kitchen-map projection is DEFERRED** (deliberate scope cut): `loadRaw()` does NOT gain calendar reads in this slice, so no `KitchenMapSchema`/`SCHEMA_VERSION` change. The bump triggers ship NOW anyway (spec §7.3: triggers land in the same migration that creates a future `loadRaw` source — a missing trigger = 1-hour stale cache, a bug class this repo has already shipped once). When a later slice adds the projection: 5 coordinated edits in `kitchen-map.repository.ts` (row interface, COLUMNS const, Promise.all entry, error guard, RawKitchenMapData field) + composer + contract + bump `SCHEMA_VERSION` in `kitchen-map.service.ts:10`.
10. **No frontend work.** `CalendarSummary.tsx` renders hard-coded mock data (`kitchen-profile/data/mockData.ts:138-143`) and `apps/web/src/features/calendar/` is an empty reserved namespace — both stay as-is. Wiring the UI to this API is a later Kitchen-Profile slice.
11. **Zod is v4** in contracts/types (`"zod": "^4.0.0"`) — project-context.md's "Zod 3.23" note is stale. Follow current contracts conventions: snake_case fields, wrapped list responses, `z.string().date()`, `.datetime({ offset: true })`, param-schema name prefixes to avoid barrel collisions.
12. **`contracts:check` enforces plumbing**: every exported schema must be consumed by an app or have a real `z.infer` site in `packages/types/src/index.ts` (`contracts/scripts/check.ts:1-33`). Do both blocks in types (schema import + alias).

### Semantics locked by this story (record deviations in Dev Record)

- **Fallback:** no term covers the week → resolver returns `undefined` → effective set absent → behavior byte-identical to today. This is spec §8's "falls back to all weekdays when empty" — implemented as *absence of narrowing*, not as a literal mon–fri array (which would flip the tracer to "PARTIAL WEEK" framing and subtly change prompts for every empty-calendar household).
- **`[]` vs `undefined` is load-bearing:** empty array = "calendar says zero lunch days this week" → skip composition (AC #6); undefined = "no calendar" → default week.
- **Union semantics for terms** (any child in school ⇒ lunch day); **household-wide-only exceptions** affect the set. Child-scoped rows are accepted and stored for forward-compat but inert in the resolver this slice — document this in the resolver's header comment.
- **Non-removing kinds:** `early_release` (kid still eats lunch) and `other` (annotation) never remove a day.
- **Auth split:** writes = `requireParentOrCaregiver` (packers/day-logistics precedent, NOT extra-library's primary-parent-only), reads = both roles. Guest authors: no access.
- **Audit metadata:** `{ action }` only. `note` is potentially-PII free text — keep it out (precedent: `households.routes.ts:682-685`).

### Testing standards

- Colocated `*.test.ts`; Arrange/Act/Assert; no conditional logic in test bodies; route tests via bare-Fastify harness + in-file `buildMockSupabase` extension (`households.routes.test.ts` conventions — fixed UUID constants, JWT_SECRET `'a'.repeat(32)`, contract-schema response parsing).
- Resolver tests are pure-function tests — no mocks, table-driven over date fixtures.
- Job tests: follow existing `plan-generation.job.test.ts` patterns for loader-failure tolerance (calendar load failure → warn + undefined, job proceeds).
- Prior-story discipline that applies here: verify claims against reality with a negative control (chore-s1's probe lied 4 times before it was controlled); pre-existing suite failures are confirmed pre-existing via `git stash` before being called baseline.

### Project Structure Notes

- New API files live in `apps/api/src/modules/households/` (calendar is household-scoped): `family-calendar.repository.ts`, `family-calendar.resolver.ts` (+ tests). Routes extend `households.routes.ts` — no `app.ts` change.
- One new contracts file + index export; types additions in `packages/types/src/index.ts`. No new deps, no web changes, no SSE events (Brief updates arrive through the existing compose→SSE path, unchanged).

### References

- Spec: `_bmad-output/planning-artifacts/canonical-data-model-v2-spec.md` §3.3, §4.6, §7.2–7.3, §8-1, §9
- Planner seam: `apps/api/src/agents/orchestrator.ts:125,301-303,416-473`; `apps/api/src/agents/prompts/planner.prompt.ts:28-29,57-61,170-175`; `apps/api/src/jobs/plan-generation.job.ts:71,113-158,409-449,490-497,549-565,637-655`
- Week/date math: `apps/api/src/lib/derive-week-id.ts:10-95`; `packages/contracts/src/plan.ts:352,357-364,661,666`
- Snack: `apps/api/src/services/snack-rotation.service.ts:12,169-171`
- Pause (stays orthogonal): `apps/api/src/modules/plans/plans.service.ts:1348-1400`; `brief-state.composer.ts:506-520,737-740`
- Migration patterns: `supabase/migrations/20260700000000_create_school_policies.sql`, `20261008000000:51-67` (COALESCE unique-index rationale), `20261008000200:18-21` (bump trigger DDL), `20260820000000:72-96` (trigger fn), `20261013000000:37-40` (RLS)
- CRUD precedent: `apps/api/src/modules/households/extra-library.repository.ts:19-59`; `households.routes.ts:86-119,224,657-753,1034-1081`; `apps/api/src/middleware/authorize.hook.ts:7-17`
- Date-overlap query precedent: `apps/api/src/services/cultural-calendar.service.ts:43-80`; loader wiring `apps/api/src/jobs/planner-context.loader.ts:255-278`
- Audit: `apps/api/src/audit/audit.types.ts`; parity test `audit.types.test.ts`; `supabase/migrations/20260700000100_add_school_policy_audit_types.sql`
- Contracts conventions: `packages/contracts/src/packer.ts`, `school-policy.ts`, `extra-rules.ts`; `packages/contracts/scripts/check.ts:1-33`

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
