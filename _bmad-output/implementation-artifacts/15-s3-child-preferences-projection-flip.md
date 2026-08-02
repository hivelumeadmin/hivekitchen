# Story 15.3: child-preferences-projection-flip

Status: ready-for-dev

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

- [ ] Task 1 — Contracts (AC: #1)
  - [ ] 1.1 `LunchRatingSubjectRefSchema` in `packages/contracts/src/signals.ts` (`.strict()`, uuid + slot enum); export via `index.ts`; `z.infer` alias in `packages/types` (both blocks); update the `subject_ref` convention comment (`signals.ts:78-85`) to point at the schema for lunch_rating.
  - [ ] 1.2 Colocated tests in `signals.test.ts`; `contracts:check`.
- [ ] Task 2 — SignalsService return value + repository read (AC: #2, #3)
  - [ ] 2.1 `record(): Promise<SignalRow | null>` — return the repository row on success, `null` from the catch. Touch nothing else in the method.
  - [ ] 2.2 `findLunchRatingsByHousehold` on `SignalsRepository`; amend the class doctrine comment ("reads arrive with the 15-s3 projection" → arrived).
  - [ ] 2.3 Update `signals.service.test.ts` (returned row asserted; failure paths null). Other seams need no changes — verify by diff.
- [ ] Task 3 — Projection module (AC: #4)
  - [ ] 3.1 `child-preferences.projection.ts`: `projectLunchRatings(rows)` pure collapse + `applyLunchRatingSignal(row)` (validates via the per-kind schemas, maps to `ChildPreferenceInsert`, calls `ChildPreferencesRepository.upsertSignal`).
  - [ ] 3.2 Unit tests: last-write-wins by occurred_at, tie-breaks (created_at, id), re-rate collapse (N→1), skip-and-warn on bad subject_ref/payload/null child_id, slot_kind isolation, source mapping to 'layer1_emoji'.
- [ ] Task 4 — Seam flip (AC: #5, #6)
  - [ ] 4.1 Rewire `recordRatingSignals`: per slot `const row = await record(...)`; `if (row) await applyLunchRatingSignal(row)` (per-slot try/catch on apply, warn-and-continue). Retire the direct upsert call; leave the 3-DM-C1-style retirement comment.
  - [ ] 4.2 `signalsService` required in the constructor; update `lunch-link.routes.ts` construction; sweep test constructions.
  - [ ] 4.3 Reshape `child-preferences.service.test.ts`: delete the retired "not wired" test; invert the failing-signals test (no projection write); keep and re-point the per-slot/subject_ref/re-rate tests at the new flow (re-rate now asserts BOTH stores: signal appended AND upsert overwrote).
- [ ] Task 5 — Backfill + parity script (AC: #7, #8)
  - [ ] 5.1 `apps/api/scripts/backfill-lunch-rating-signals.ts` per AC #7; env handling copied from `backfill-household-allergens.ts` `main()` (no KEK needed — lunch_rating payloads are plaintext); header carries the do-not-rerun-after-reset warning (AC #8).
  - [ ] 5.2 Unit tests for `runBackfill` dedup predicate + `verifyParity` set-equality (mock client, exported-pure-function precedent).
  - [ ] 5.3 Append the replay-after-reset deferral to `deferred-work.md` under this story's heading.
- [ ] Task 6 — Verification & gates (AC: #9, #10)
  - [ ] 6.1 `pnpm turbo lint typecheck test`, `knip`, `contracts:check`; full API suite vs 2479/0/39.
  - [ ] 6.2 Reader-untouched proof: confirm the diff contains no changes under flavor-passport, child-signal assembler/tools, render/prompt files; run planner golden evals.
  - [ ] 6.3 Negative control (AC #10); full E2E vs 425/13/0; zero `apps/web` diff.
  - [ ] 6.4 Dev Record: files, decisions, deviations, baselines; update `sprint-status.yaml`.

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

### Debug Log References

### Completion Notes List

### File List
