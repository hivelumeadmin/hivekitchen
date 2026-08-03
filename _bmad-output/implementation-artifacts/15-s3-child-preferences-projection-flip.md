# Story 15.3: child-preferences-projection-flip

Status: done

<!-- Epic 15: Canonical Data Model v2. Source spec: _bmad-output/planning-artifacts/canonical-data-model-v2-spec.md §4.9 (projections derive from signals), §4.13 (kitchen map — NOT touched this slice, see Scope), §7.3 (bump-trigger invariant), §8 step 2 (strangler: build projection → verify parity → flip → retire old write path). WALL slice. -->
<!-- Grounded in 2-agent codebase research 2026-08-02. Key reconciliations vs the spec's prose: (1) "kitchen-map-style refresh-on-write" is NOT literal — kitchen map is lazy recompute-on-read behind a version key, but child_preferences backs 4 live read shapes incl. a child-facing endpoint with a 200ms budget, so the projection target IS the existing child_preferences table and "refresh on write" = apply-from-signal at the write seam; (2) the "flip reads" strangler step therefore collapses — readers never move; what flips is the WRITE path (rows become derivable only from signals rows); (3) parity requires a BACKFILL first: signals started accumulating at 15-s2 (not even pushed yet) while child_preferences has historical rows — the reserved source='import' enum value exists exactly for this; (4) NO loadRaw()/kitchen-map change and NO bump trigger — child_preferences does not feed loadRaw() today (verified: kitchen-map.repository.ts:304-331 reads 14 tables, not this one) and §7.3 binds triggers to loadRaw sources only (same reasoning recorded in 20261035000200's header). -->

## Story

As the household's learning loop,
I want `child_preferences` to become a projection derived only from `signals` rows,
so that every planner-facing taste aggregate is explainable and rebuildable from the append-only log — the strangler flip that makes signals the system of record for ratings.

## Scope (strangler step: backfill → parity → flip the WRITE path → retire the direct write)

This slice: backfill historical ratings into `signals` (`source='import'`), a pure projection function + parity verification gate, `record()` returns the inserted row, the rating seam applies the projection FROM the landed signal, and the old direct `upsertSignal` call path is retired. **Readers are NOT touched**: all 4 read shapes (`getAggregatedSignals`, `getVariantEligibleChildIds`, FlavorPassport, signal-summary route) keep querying the `child_preferences` table exactly as today — zero prompt changes, zero golden-eval drift, the `child_signal` tool's 200ms budget is unaffected. **NOT this slice:** adding child_preferences/signals to `KitchenMapRepository.loadRaw()` (spec §4.13 — own slice, same deferral 15-s1/15-s2 made); replay-after-reset semantics (see AC #8); observability counters for swallowed signal failures (stays in deferred-work.md); no web changes, no REST changes.

## Acceptance Criteria

1. **Contracts — per-kind subject_ref schema arrives with the first reader** (closes the 15-s2 deferral): `packages/contracts/src/signals.ts` adds `LunchRatingSubjectRefSchema = z.object({ recipe_id: z.string().uuid(), slot_kind: z.enum(['main','snack','extra']) }).strict()` (+ type in `packages/types`, + colocated tests: round-trip, unknown-key rejection, bad slot_kind). `SignalRowSchema`/`RecordSignalInputSchema` keep the loose `subject_ref` record (writers unchanged); the projection boundary parses with the per-kind schema.
2. **`SignalsService.record()` returns the landed row**: signature `Promise<SignalRow | null>` — the repository's insert already returns the row (`signals.repository.ts:23-39` selects `SIGNAL_COLUMNS`); return it on success, `null` on any swallowed failure. Never-throws contract unchanged; all other seams ignore the return value untouched. Service tests updated: happy path asserts the returned row's `id`/`kind`; failure paths assert `null`.
3. **`SignalsRepository` gains its first read** (amend the insert-only doctrine comment, keep NO update/delete): `findLunchRatingsByHousehold(householdId, { limit, afterId }? )` — keyset-paginated over `(household_id, kind='lunch_rating')` ordered `occurred_at ASC, id ASC`, using the existing `signals_household_kind_occurred_idx`. Used by the backfill/parity script only; no route exposes it.
4. **Pure projection function** in `apps/api/src/modules/child-preferences/child-preferences.projection.ts`: `projectLunchRatings(rows: SignalRow[]): ChildPreferenceInsert[]` collapses signals to last-write-wins per `(child_id, subject_ref.recipe_id, subject_ref.slot_kind, payload.date)` — latest `occurred_at`, tie-break `created_at` then `id` (reproduces the `child_preferences_dedup` upsert semantics; N appended re-ratings → 1 row). Rows whose `subject_ref` fails `LunchRatingSubjectRefSchema.safeParse`, whose `payload` fails the lunch_rating member, or whose `child_id` is null are **skipped with a warn** (count surfaced), never thrown. `source` maps to `'layer1_emoji'` for parity with the live writer (`child-preferences.repository.ts:66` default; signals' own `source` stays `lunch_link|import` — different vocabularies, do NOT copy it across). Unit tests: collapse semantics, tie-breaks, skip paths, FR124 slot_kind isolation (same recipe as main vs snack → 2 rows).
5. **Write-seam flip** in `ChildPreferencesService.recordRatingSignals` (`child-preferences.service.ts:87-126`): per slot, the seam calls `record()` FIRST; if it returns a row, apply the projection from that row via `applyLunchRatingSignal(row)` (new method on the projection module calling the existing `ChildPreferencesRepository.upsertSignal` — reuse it, do not reimplement the upsert); if it returns `null`, **skip the projection write** (the warn already fired inside `record()`). The direct `upsertSignal` call with seam-local data is retired — after this slice, **nothing writes `child_preferences` except the projection applier consuming a `SignalRow`** (leave a named-story comment at the seam mapping old→new, 3-DM-C1 retirement style, `plans.service.ts:477-489` precedent). `signalsService` becomes a REQUIRED constructor dependency of `ChildPreferencesService` (it is the source of truth now; the only production constructor at `lunch-link.routes.ts:53-61` already wires it — update it to positional-required, and delete the 15-s2 "not wired (optional dep)" test whose premise is retired).
6. **Disclosed behavior change (deliberate):** a rating whose signals insert fails no longer lands in `child_preferences` at all (today it does). This is the honest meaning of the flip — the projection derives from the log, so `log ⊇ stores` now holds *by construction* at this seam. Test: real `SignalsService` with failing insert → zero `upsertSignal` calls + warn (inverts the 15-s2 AC#9 test for this seam; the other seams' AC#9 tests are untouched). A per-slot `upsertSignal` failure after a landed signal is still caught-and-continue per slot (warn), preserving the 15-s2 fire-and-forget doctrine downstream of the log.
7. **Backfill + parity gate** `apps/api/scripts/backfill-lunch-rating-signals.ts` (follow `backfill-household-allergens.ts` structure: `#!/usr/bin/env tsx`, numbered-steps header docblock, exported pure `runBackfill({client})` + `verifyParity({client})` returning typed summaries, `main()` guard on `import.meta.url`, `// eslint-disable-next-line no-console` per console line, non-zero exit on failure):
   - **Backfill:** for every `child_preferences` row with no matching lunch_rating signal on `(child_id, recipe_id, slot_kind, date)` (any source — so post-deploy dual-written ratings are not duplicated), insert a signal via plain inserts: `payload {kind:'lunch_rating', rating: signal_type, date: signal_date}`, `subject_ref {recipe_id, slot_kind}`, `occurred_at = created_at`, `source: 'import'` (the reserved enum value's designed purpose). Idempotent — safe to re-run.
   - **Parity gate:** `projectLunchRatings(all signals)` compared against the live `child_preferences` table per household — set-equality on `(child_id, recipe_id, slot_kind, signal_date, signal_type)`. Any mismatch → print the diff rows (ids only, no PII) and `process.exit(1)` (verification-gate precedent). No silent-skip escape hatches (the `enforcement-enum-parity` PGRST202 `return` is an anti-precedent — do not copy).
   - Unit tests on the exported pure functions (script-test precedent: `backfill-falcpa-allergen-keys.test.ts`).
   - **USER-SIDE GATE:** `supabase db push --include-all` (three Epic-15 migrations still unpushed), then run the script; the parity gate inside it is the cutover proof. Until then dev/CI behavior is covered by unit tests only — disclose in Dev Record.
8. **Reset semantics recorded, not solved:** `deleteByChild` (7-S7 flavor-journey reset, `flavor-journey-reset.service.ts:56`) and the account-deletion table sweep (`account-deletion.job.ts:131`) still hard-delete projection rows; signals survive a flavor reset (append-only; direct DELETE raises except under FK cascade — `20261035000200:103-115`). Standing invariant after this slice: **the projection is forward-apply-only** — nothing replays history at runtime, so a reset stays effective; the backfill/parity script is a cutover-time tool and MUST NOT be re-run after any flavor-journey reset has occurred (say so in the script header). Full replay-after-reset semantics (watermark on `children`) → record in `deferred-work.md`. Account deletion is already safe: household cascade deletes signals (15-s2 review patch).
9. **Zero reader/prompt drift proof:** `getAggregatedSignals`, `getVariantEligibleChildIds`, `FlavorPassportRepository`, `child-signal.assembler.ts`, `render.ts`, `planner.prompt.ts` all byte-untouched (reviewable from the diff); planner golden evals pass unchanged; `deleteByChild` untouched. No migration ships in this slice (no DDL change; no bump trigger — child_preferences still does not feed `loadRaw()`).
10. **Gates:** `pnpm turbo lint typecheck test` green; `knip` exit 0; `contracts:check` passes; API suite zero new failures vs baseline **2479 passed / 0 failed / 39 skipped**; zero `apps/web` changes; full E2E at baseline **425 passed / 13 skipped / 0 failed** (contracts shape changed → full suite, 15-s1/15-s2 precedent). Negative control per repo doctrine (e.g. break the tie-break order in `projectLunchRatings` → collapse test fails; restore → passes).

## Tasks / Subtasks

- [x] Task 1 — Contracts (AC: #1)
  - [x] 1.1 `LunchRatingSubjectRefSchema` in `packages/contracts/src/signals.ts` (`.strict()`, uuid + slot enum); export via `index.ts`; `z.infer` alias in `packages/types` (both blocks); update the `subject_ref` convention comment (`signals.ts:78-85`) to point at the schema for lunch_rating.
  - [x] 1.2 Colocated tests in `signals.test.ts`; `contracts:check`.
- [x] Task 2 — SignalsService return value + repository read (AC: #2, #3)
  - [x] 2.1 `record(): Promise<SignalRow | null>` — return the repository row on success, `null` from the catch. Touch nothing else in the method.
  - [x] 2.2 `findLunchRatingsByHousehold` on `SignalsRepository`; amend the class doctrine comment ("reads arrive with the 15-s3 projection" → arrived).
  - [x] 2.3 Update `signals.service.test.ts` (returned row asserted; failure paths null). Other seams need no changes — verify by diff.
- [x] Task 3 — Projection module (AC: #4)
  - [x] 3.1 `child-preferences.projection.ts`: `projectLunchRatings(rows)` pure collapse + `applyLunchRatingSignal(row)` (validates via the per-kind schemas, maps to `ChildPreferenceInsert`, calls `ChildPreferencesRepository.upsertSignal`).
  - [x] 3.2 Unit tests: last-write-wins by occurred_at, tie-breaks (created_at, id), re-rate collapse (N→1), skip-and-warn on bad subject_ref/payload/null child_id, slot_kind isolation, source mapping to 'layer1_emoji'.
- [x] Task 4 — Seam flip (AC: #5, #6)
  - [x] 4.1 Rewire `recordRatingSignals`: per slot `const row = await record(...)`; `if (row) await applyLunchRatingSignal(row)` (per-slot try/catch on apply, warn-and-continue). Retire the direct upsert call; leave the 3-DM-C1-style retirement comment.
  - [x] 4.2 `signalsService` required in the constructor; update `lunch-link.routes.ts` construction; sweep test constructions.
  - [x] 4.3 Reshape `child-preferences.service.test.ts`: delete the retired "not wired" test; invert the failing-signals test (no projection write); keep and re-point the per-slot/subject_ref/re-rate tests at the new flow (re-rate now asserts BOTH stores: signal appended AND upsert overwrote).
- [x] Task 5 — Backfill + parity script (AC: #7, #8)
  - [x] 5.1 `apps/api/scripts/backfill-lunch-rating-signals.ts` per AC #7; env handling copied from `backfill-household-allergens.ts` `main()` (no KEK needed — lunch_rating payloads are plaintext); header carries the do-not-rerun-after-reset warning (AC #8).
  - [x] 5.2 Unit tests for `runBackfill` dedup predicate + `verifyParity` set-equality (mock client, exported-pure-function precedent).
  - [x] 5.3 Append the replay-after-reset deferral to `deferred-work.md` under this story's heading.
- [x] Task 6 — Verification & gates (AC: #9, #10)
  - [x] 6.1 `pnpm turbo lint typecheck test`, `knip`, `contracts:check`; full API suite vs 2479/0/39.
  - [x] 6.2 Reader-untouched proof: confirm the diff contains no changes under flavor-passport, child-signal assembler/tools, render/prompt files; run planner golden evals.
  - [x] 6.3 Negative control (AC #10); full E2E vs 425/13/0; zero `apps/web` diff.
  - [x] 6.4 Dev Record: files, decisions, deviations, baselines; update `sprint-status.yaml`.

### Review Findings

- [x] [Review][Patch] Backfill script's offset pagination has no `ORDER BY`, risking skipped/duplicated rows across pages [apps/api/scripts/backfill-lunch-rating-signals.ts: loadPreferences ~106-119, listHouseholdIds ~148-163] — fixed: `loadPreferences` orders by `id`; `listHouseholdIds` orders by `household_id, id`
- [x] [Review][Patch] `ScriptDeps.logger` is declared but never threaded into `projectLunchRatings(...)` calls, so a live cutover run produces zero skip-warnings [apps/api/scripts/backfill-lunch-rating-signals.ts: runBackfill, verifyParity] — fixed: `logger` retyped to `{warn}`, threaded into both call sites, `main()` wires a console logger; 2 new tests
- [x] [Review][Patch] Stale log message in the per-slot catch still says "upsertSignal failed" though the call is now `applyLunchRatingSignal` [apps/api/src/modules/child-preferences/child-preferences.service.ts] — fixed: message renamed
- [x] [Review][Defer] `pageSize: 0` on the backfill script's paginated helpers causes an infinite loop (invalid `.range()` + `offset` never advances) [apps/api/scripts/backfill-lunch-rating-signals.ts] — deferred, pre-existing pattern class, not reachable from any current caller (CLI always uses the default)
- [x] [Review][Defer] `isLater()`'s final tie-break (raw UUID `id` comparison) doesn't correlate with true chronological insertion order when `occurred_at` and `created_at` are both equal [apps/api/src/modules/child-preferences/child-preferences.projection.ts] — deferred, this is exactly the AC #4-specified tie-break order; fixing needs a monotonic sequence, not a code change
- [x] [Review][Defer] `verifyParity`'s `mismatches` array accumulates unbounded before the CLI truncates it at print time [apps/api/scripts/backfill-lunch-rating-signals.ts] — deferred, low real-world risk given the repo's documented "per-household volume is tiny"
- [x] [Review][Defer] No test exercises the actual multi-page continuation loop for the script's paginated helpers or `findLunchRatingsByHousehold`'s default page size [apps/api/scripts/backfill-lunch-rating-signals.ts, apps/api/src/modules/signals/signals.repository.ts] — deferred, coverage gap not a bug; bundle with the ORDER BY patch's test update

## Dev Notes

### The system after this slice (target state)

```
POST /v1/lunch-link/:token/rate
  └─ recordRatingSignals (per slot on the rated day)
       ├─ SignalsService.record({kind:'lunch_rating', ...})   ← system of record (append-only)
       │     └─ returns SignalRow | null
       └─ if row: applyLunchRatingSignal(row)                 ← projection (child_preferences upsert)
             └─ if null: skip (signal warn already fired)

child_preferences = projectLunchRatings(signals WHERE kind='lunch_rating')   ← provable via parity script
readers (4 shapes) — UNCHANGED, still query child_preferences directly
```

### Verified current-state facts (2026-08-02 research — trust these over spec prose)

- **child_preferences DDL** (`supabase/migrations/20261013000000_child_preferences_signal.sql`): columns `(id, household_id, child_id, recipe_id, slot_kind CHECK main|snack|extra, signal_type CHECK loved|ok|not-really, signal_date DATE, source DEFAULT 'layer1_emoji', created_at)`; UNIQUE `child_preferences_dedup (child_id, recipe_id, slot_kind, signal_date)` — **household_id NOT in the dedup key** (the projection carries it from the signal row); no triggers.
- **The ONLY writer** is `ChildPreferencesRepository.upsertSignal` (`child-preferences.repository.ts:59-73`, `onConflict: 'child_id,recipe_id,slot_kind,signal_date'`, last-write-wins) with exactly one caller: `recordRatingSignals`. Deletes: `deleteByChild` (7-S7 reset) + account-deletion sweep — both stay.
- **The 4 readers** (all stay byte-identical): `getAggregatedSignals` (windowed 30d, in-process group to loved/ok/not-really counts → planner `<child_signals>` block via `child-signal.assembler.ts` + `GET /v1/children/:childId/signal-summary`), `getVariantEligibleChildIds` (DISTINCT signal_date ≥ 3 in 30d → variant eligibility in both plan jobs), `FlavorPassportRepository.getStampsForChild` (**unbounded window**, `signal_type IN ('loved','ok')`, one row per recipe — this is why a windowed projection would be wrong), `child_signal` agent tool (registered `orchestrator.ts:185`, `maxLatencyMs: 200`, planner prompt forbids calling it — pre-loaded instead).
- **Planner coupling:** `render.ts:372-403` emits `<child_signals>`; FR124 (slot_kind never bleeds across grouping), FR125 (zero signals ⇒ absent entirely, never a zero row), FR126 (family_liked ≥ 2 distinct children) live in `child-signal.assembler.ts:22-95`. Untouched readers ⇒ these hold automatically; the projection's collapse must preserve the table shape they assume.
- **15-s2 signal write shape** (`child-preferences.service.ts:115-125`): per-slot, `subject_ref {recipe_id, slot_kind}`, `payload {kind, rating, date}`, `occurred_at` = wall-clock submission time (NOT signal_date — the rated day lives ONLY in `payload.date`; never key the projection on `occurred_at::date`), `source 'lunch_link'`. Re-rate APPENDS a new signal while the upsert overwrites — hence the collapse function.
- **`signals` DDL** (`20261035000200`): index `(household_id, kind, occurred_at DESC)` serves the rebuild read; append-only trigger allows DELETE only at `pg_trigger_depth() > 1` (FK cascade); RLS is SELECT-only; `lunch_rating` payloads are **plaintext** (only `lunch_request.text` / `preference_edit.item` encrypt) — the projection and script need NO DEK/KEK.
- **Kitchen map is NOT involved:** `loadRaw()` (`apps/api/src/modules/kitchen-map/kitchen-map.repository.ts:304-331`) reads 14 tables — not child_preferences, not signals, not calendar. Kitchen-map "refresh" is lazy recompute-on-read behind `kitchen_map_version`; do not imitate it here and do not add bump triggers (§7.3 binds them to loadRaw sources only).
- **Zod 4.3.6** (project-context.md's "3.23" is stale — 15-s2 Dev Record): `z.record` needs two args (`z.record(z.string(), z.unknown())`); discriminated unions and `.strict()` per 15-s2's `signals.ts` precedent.
- **Suite baselines** (post-15-s2-review): API **2479/0/39**, E2E **425/13/0**, contracts:check 553 exports, knip 0.

### Doctrine (15-s2 review, user-resolved — binding here)

**Signal-always / log ⊇ stores:** the log records the EVENT. 15-s3's parity check assumes `log ⊇ stores`; after this slice the rating seam makes it hold by construction (projection applies only from landed signals). The known deliberate exception (Lumi shared-tastes skip-on-declare-fail) does not involve lunch_rating and is out of scope.

### Constraints & conventions

- Reuse, don't rebuild: `upsertSignal` stays the single physical write primitive; the projection wraps it. `ChildPreferencesRepository` read methods untouched.
- `record()`'s never-throws contract is load-bearing at 6 seams — the return-type change must not add a throw path (return `null` from the existing catch).
- Script conventions: `apps/api/scripts/` (near its module imports), exported pure functions + `main()` guard, verification gate exits non-zero, no PII in output. Note the repo's existing KEK-encoding divergence (`hex` in routes vs `base64` in the allergens backfill) — irrelevant here (no KEK), don't propagate confusion by adding KEK handling.
- No new deps. No migration. No `apps/web` changes. Conventional commit: `feat(signals): 15-s3 — child_preferences becomes a projection over the signals log`.

### Previous story intelligence (15-s2 + its code review, 2026-08-02)

- 15-s2 shipped the dual-write + table; its review (same day) applied 8 patches — the ones that bind here: cascade-delete escape on the append-only trigger, SELECT-only RLS, `record()` null-hardening, per-seam AC#9 failing-write tests **through the real SignalsService** (copy that harness: mock supabase `from('signals')` → failing `insert().select().single()`, kek `null`, warn spy — `signals.service.test.ts:12-57`).
- Deferred items THIS slice closes: per-kind `subject_ref` schema for lunch_rating ("arrives with the first reader"). Deferred items this slice does NOT close (leave in deferred-work.md): swallowed-failure observability/dead-letter; approve-path `subject_ref: null`; signals column-name drift test (the parity script substantially covers it for lunch_rating — note that when updating deferred-work).
- 15-s1/15-s2 pattern that worked: negative controls on every behavior flip; disclose gaps explicitly; USER-SIDE GATE called out in sprint-status.

### Project Structure Notes

- New files: `apps/api/src/modules/child-preferences/child-preferences.projection.ts` (+ colocated test), `apps/api/scripts/backfill-lunch-rating-signals.ts` (+ colocated test).
- Modified: `packages/contracts/src/signals.ts` (+test), `packages/types/src/index.ts`, `apps/api/src/modules/signals/signals.service.ts` (+test), `signals.repository.ts`, `apps/api/src/modules/child-preferences/child-preferences.service.ts` (+test), `apps/api/src/modules/lunch-link/lunch-link.routes.ts` (constructor arity only), `_bmad-output/implementation-artifacts/deferred-work.md`.
- kebab-case files, colocated `*.test.ts`, `.js` extensions on relative imports (api ESM), `import type` for type-only edges.

### References

- [Source: _bmad-output/planning-artifacts/canonical-data-model-v2-spec.md §4.9, §4.13, §7.3, §8 step 2]
- [Source: _bmad-output/implementation-artifacts/15-s2-signals-log-dual-write.md — Dev Record, Review Findings (doctrine + deferrals)]
- [Source: supabase/migrations/20261013000000_child_preferences_signal.sql; 20261035000200_create_signals.sql]
- [Source: apps/api/src/modules/child-preferences/{child-preferences.repository.ts,child-preferences.service.ts}]
- [Source: apps/api/src/modules/signals/{signals.repository.ts,signals.service.ts}]
- [Source: apps/api/scripts/backfill-household-allergens.ts (script + verification-gate precedent)]
- [Source: apps/api/src/agents/planner/context/render.ts:354-403; apps/api/src/agents/tools/child-signal.tools.ts; apps/api/src/modules/flavor-passport/flavor-passport.repository.ts]
- [Source: _bmad-output/implementation-artifacts/3-dm-c1-plan-structure-cutover.md (strangler cutover + retirement-comment precedent)]

## Dev Agent Record

### Agent Model Used

claude-opus-5 (1M context) — dev-story workflow, 2026-08-02.

### Debug Log References

- Negative control (AC #10): inverted the `occurred_at` comparison in `isLater()` → 2 projection tests failed (`collapses N re-ratings…`, `is order-independent…`); restored → 12/12 green. The collapse ordering is genuinely under test.
- RED phases observed: `signals.service.test.ts` 4 failed before the return-type change; `child-preferences.projection.test.ts` failed to resolve the module before it existed.

### Completion Notes List

**What flipped.** `child_preferences` is now a projection over the `signals` log. The rating seam (`recordRatingSignals`) writes the signal FIRST, and the projection applies from the row the DB returned. The direct `upsertSignal` call built from seam-local data is retired — after this slice the only code path that writes `child_preferences` is `applyLunchRatingSignal(row)`. Readers are byte-untouched: `getAggregatedSignals`, `getVariantEligibleChildIds`, `FlavorPassportRepository`, `child-signal.assembler.ts`, `render.ts`, `planner.prompt.ts`, `deleteByChild` — none appear in the diff, and the planner golden evals pass unchanged.

**Disclosed behavior change (AC #6, deliberate).** A rating whose signals insert fails now lands in NO store (previously it still landed in `child_preferences`). `log ⊇ stores` holds by construction at this seam. Covered by an inverted AC#9 test driving the REAL `SignalsService` against a failing insert: zero `upsertSignal` calls, two warns. A per-slot upsert failure AFTER a landed signal is still caught-and-continue.

**Deviations from the story text (3, all disclosed):**
1. **AC #3 — cursor shape.** `findLunchRatingsByHousehold(householdId, { limit, after })` takes a COMPOSITE cursor `{occurredAt, id}`, not the story's bare `afterId`. An id-only cursor cannot page an `occurred_at`-ordered scan: the seam stamps `occurred_at` per slot from wall-clock time, so the three slots of one rating routinely share a millisecond and an id-only cursor would skip or repeat rows. Ordering, index usage, and the "no route exposes it" constraint are as specified.
2. **AC #4 — `applyLunchRatingSignal` arity.** Signature is `(repository, row, logger)`, not `(row)` — the projection module is a pure module, not a class, so the repository and logger are passed in rather than captured. Still reuses `ChildPreferencesRepository.upsertSignal` as the single physical write primitive.
3. **AC #7 — parity diff contents.** Mismatches print `{household_id, child_id, recipe_id, slot_kind, signal_date, reason}` where `reason ∈ {missing_in_projection, extra_in_projection, signal_type_mismatch}`. Rating VALUES are deliberately never printed (a test asserts this) — the reason code says what is wrong without emitting a child's preference. Diff output is capped at 50 rows with a total count; `process.exit(1)` on any mismatch, no skip-on-error escape hatch.

**Design notes.** The projection function doubles as the backfill's dedup predicate (a signal exists for a key iff the projection produces that key), so the two can never disagree. `projectLunchRatings` is order-independent — it compares rather than assuming sorted input — and skips unprojectable rows with a counted warn rather than throwing, because a poisoned row in an immutable log must not be able to block a rebuild. `child_preferences.source` is pinned to `'layer1_emoji'` (the live writer's default); `signals.source` (`lunch_link`/`import`) is a different vocabulary and is deliberately not copied across.

**Reset semantics (AC #8) recorded, not solved.** The projection is forward-apply-only, so a flavor-journey reset stays effective; the backfill/parity script is a cutover-time tool and its header carries a prominent DO-NOT-RE-RUN-AFTER-RESET warning. Replay-after-reset (a watermark on `children`) is in `deferred-work.md`.

**USER-SIDE GATE (unchanged from 15-s1/15-s2, now load-bearing).** `supabase db push --include-all` for the three unpushed Epic-15 migrations (20261035000000 / …000100 / …000200), THEN run:
`pnpm --filter @hivekitchen/api exec tsx scripts/backfill-lunch-rating-signals.ts`
The parity gate inside that script IS the cutover proof. Until it is run against a real database, the flip is covered by unit tests only — no integration evidence exists that the live table is reproducible from the log.

**Gates.** API suite **2504 passed / 0 failed / 39 skipped** (baseline 2479/0/39 → +25 tests, zero failures). `pnpm turbo lint typecheck` 14/14. `contracts:check` 555 exports (was 553). `knip` exit 0. Planner golden evals green. Full E2E **425 passed / 13 skipped / 0 failed** — exactly baseline, re-verified after code review. `git diff -- apps/web` EMPTY throughout. No migration ships in this slice.

**Code review (2026-08-02, 3-layer adversarial pass: Blind Hunter + Edge Case Hunter + Acceptance Auditor).** 3 patches applied: backfill script's offset pagination now orders by `id` / `(household_id, id)` (two independent layers converged on this as the headline finding — unordered `.range()` paging can skip/duplicate rows across pages, which would have silently undermined the parity gate's role as "the cutover proof"); `ScriptDeps.logger` is now actually threaded into `projectLunchRatings(...)` so a live cutover surfaces skipped/unprojectable signals instead of dead-lettering them silently; a stale log message renamed. 4 findings deferred (see Review Findings + deferred-work.md): `isLater()`'s UUID tie-break is exactly the AC #4-specified order, not a defect; `pageSize:0` latent infinite-loop hazard, unreachable from any current caller; unbounded in-memory mismatch accumulation before CLI truncation; missing multi-page-continuation test coverage. 7 findings dismissed as noise (false-positive injection risk on system-generated timestamp/uuid values; already-disclosed items; precedent-matching patterns). Post-patch: API 2504/0/39, E2E 425/13/0 re-verified, turbo/knip/contracts:check all green.

### File List

**New**
- `apps/api/src/modules/child-preferences/child-preferences.projection.ts`
- `apps/api/src/modules/child-preferences/child-preferences.projection.test.ts`
- `apps/api/src/modules/signals/signals.repository.test.ts`
- `apps/api/scripts/backfill-lunch-rating-signals.ts`
- `apps/api/scripts/backfill-lunch-rating-signals.test.ts`

**Modified**
- `packages/contracts/src/signals.ts`
- `packages/contracts/src/signals.test.ts`
- `packages/types/src/index.ts`
- `apps/api/src/modules/signals/signals.service.ts`
- `apps/api/src/modules/signals/signals.service.test.ts`
- `apps/api/src/modules/signals/signals.repository.ts`
- `apps/api/src/modules/child-preferences/child-preferences.service.ts`
- `apps/api/src/modules/child-preferences/child-preferences.service.test.ts`
- `_bmad-output/implementation-artifacts/deferred-work.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`

**Not modified (deliberately, AC #9):** `child-preferences.repository.ts`, `flavor-passport.repository.ts`, `child-signal.assembler.ts`, `child-signal.tools.ts`, `render.ts`, `planner.prompt.ts`, `flavor-journey-reset.service.ts`, `account-deletion.job.ts`, `lunch-link.routes.ts` (its construction was already positional), all of `apps/web`.

## Change Log

- 2026-08-02 — 15-s3 implemented (dev-story, claude-opus-5). `child_preferences` becomes a projection over the append-only `signals` log: `record()` returns the landed row, a new pure projection module collapses/applies it, and the direct write path is retired. Adds `LunchRatingSubjectRefSchema` (closes the 15-s2 per-kind `subject_ref` deferral), the repository's first read, and a cutover backfill + parity-gate script. Readers, prompts, and `apps/web` untouched. Status → review.
