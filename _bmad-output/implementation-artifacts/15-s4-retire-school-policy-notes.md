# Story 15.4: retire-school-policy-notes

Status: done

> **⚠️ SUPERSEDED 2026-08-12 — do not follow the USER-SIDE GATE instructions below.**
> This document is a point-in-time record and is preserved unedited. Its gate text
> (run `apps/api/scripts/backfill-school-policy-notes.ts` first, *then* push the drop
> migration) is no longer actionable, and the order it warned about was not honoured:
> **`20261035000300` was applied without the backfill ever running.** The script's
> `verifyParity` reads the now-dropped `children.school_policy_notes`, so it could never
> run again and was **deleted in `53f41ff`**. Data impact was nil — the target was an
> effectively empty dev database. Current state of record:
> `_bmad-output/implementation-artifacts/sprint-status.yaml` (MIGRATION-GATE
> RECONCILIATION) and §3 of `epic-15-retro-2026-08-03.md`.

<!-- Epic 15: Canonical Data Model v2. Source spec: _bmad-output/planning-artifacts/canonical-data-model-v2-spec.md §4.2 ("Remove children.school_policy_notes text... Migrate any surviving free-text into a school_policies row with policy_type='note'"), §4.5, §5 row 5, §10 (retired-columns list), §8 step 3 ("JSONB removals — each is a small, independent migration + repo change + contract update in one PR"). -->
<!-- Grounded in codebase research 2026-08-02. Key facts that override the spec's brevity: (1) children.school_policy_notes is a DEAD END today — it is read/written ONLY by the Children REST API and the onboarding agent's child.upsert tool; it is NEVER read by KitchenMapRepository.loadRaw(), the planner prompt, or the guardrail engine (confirmed by direct grep of apps/api/src/agents/** and apps/api/src/modules/allergy-guardrail/**). The parenthetical in deferred-work.md:885 ("today they [free-text policies] do [affect plan generation] via the legacy school_policy_notes column") is STALE/INACCURATE — verified false by this research; corrected in Task 6. (2) school_policies.policy_type is PLAIN TEXT with a length CHECK (1-100 chars), NOT a Postgres enum — 'note' requires zero schema/enum change, it's already a legal value. (3) The planner DOES read every ACTIVE school_policies row today (render.ts:233, all policy_type values, no filter) — so backfilled 'note' rows must ship is_active:false or previously-invisible free text starts appearing in the planner prompt as an unplanned side effect of a data-hygiene slice. This is the story's one deliberate decision (Task 1). -->

## Story

As the platform's data model owner,
I want `children.school_policy_notes` retired in favor of a `school_policies` row with `policy_type='note'`,
so that school-constraint data has exactly one representation — closing the dual-representation gap the spec calls out (§4.2, §5 row 5) and the JSONB-removal step of the Epic 15 strangler sequence (§8 step 3).

## Scope (small independent JSONB/text removal — backfill → drop → coordinated contract change, per §8 step 3)

This slice: a one-shot backfill script that copies every non-empty `children.school_policy_notes` value into a `school_policies` row (`policy_type='note'`, `is_active=false` — see AC #1 for why), a verification gate, a migration that drops the column (gated on the backfill's success, USER-SIDE), and the coordinated contract + code + test sweep that removes every reference to the retired field. **NOT this slice:** a UI free-text input for `policy_description` (still deferred — see AC #7); any change to `SchoolPoliciesForm.tsx`'s `COMMON_POLICY_TYPES` UI presets; any change to how the planner renders `school_policies` (zero prompt-content changes — AC #6); a `kitchen_map_version` bump trigger on `school_policies` (none exists today for either table involved — pre-existing gap, out of scope, noted in Dev Notes so a reviewer doesn't mistake it for a regression).

## Acceptance Criteria

1. **Backfill script** `apps/api/scripts/backfill-school-policy-notes.ts` (mirrors `backfill-household-allergens.ts` structure — `#!/usr/bin/env tsx`, numbered-steps header docblock, exported pure `runBackfill({client})` + `verifyParity({client})`, `main()` guard on `import.meta.url`, non-zero exit on failure, idempotent):
   - Pages `children` where `school_policy_notes IS NOT NULL`. Rows whose trimmed value is the empty string are treated as "nothing to migrate" (skip, do not insert) — the column allows an empty string today (`z.string().trim().max(500).nullish()` has no `.min(1)`).
   - For each remaining row: upsert into `school_policies` via the existing unique index `(child_id, policy_type)` — `policy_type='note'`, `policy_description=<the trimmed text, already ≤500 chars so no truncation needed — matches the CHECK on both columns>`, `slot_scope='bag_wide'`, `is_active=false`.
   - **`is_active=false` is a deliberate, disclosed decision, not an oversight:** `school_policy_notes` was never read by the planner (see codebase-research note above); `SchoolPoliciesRepository.findActiveByChildId` — the only read path into the Kitchen Map / planner prompt (`render.ts:233`, `renderPlannerKitchenMapBlock`) — filters `is_active=true`. Backfilling as active would make previously-invisible free text start appearing in the planner prompt as a side effect of a data-hygiene slice — out of scope and untested. `is_active=false` preserves current behavior exactly: the text is preserved (not lost) but stays planner-invisible until a human explicitly activates it via the existing `PATCH /v1/children/:id/school-policies` route.
   - Idempotent: re-running the script does not double-insert (upsert on the existing `(child_id, policy_type)` conflict target) and does not re-copy text that's already landed.
   - **Verification gate:** count `children` rows with a non-empty `school_policy_notes` vs `school_policies` rows with `policy_type='note'` whose `child_id` is one of those children. Mismatch → print diff (child IDs only, no PII) and `process.exit(1)`. No skip-on-error escape hatch (repo doctrine, 15-s3 precedent).
   - Unit tests on the exported pure functions (script-test precedent: `backfill-falcpa-allergen-keys.test.ts`, `backfill-lunch-rating-signals.test.ts`).

2. **Drop migration** `supabase/migrations/20261035000300_drop_school_policy_notes.sql`:
   ```sql
   ALTER TABLE children DROP COLUMN IF EXISTS school_policy_notes;
   ```
   Header comment mirrors `20261008000100_drop_legacy_allergen_columns.sql`'s convention: states this runs AFTER `apps/api/scripts/backfill-school-policy-notes.ts` has executed against the target database and its verification gate has passed; re-applying before the gate passes is a data-loss event by design. No `CREATE TYPE`/enum changes needed (see codebase-research note: `policy_type` is plain text). **USER-SIDE GATE**, same doctrine as 15-s1/15-s2/15-s3: the migration is authored and reviewed in this slice but the `supabase db push` that actually applies it — and the backfill script run that must precede it — happens outside this dev session. Disclose in Dev Record. Note this migration must apply AFTER the three still-unpushed Epic-15 migrations from 15-s1/15-s2 (`20261035000000`/`…000100`/`…000200`) and the 15-s3 cutover — migrations apply in filename order, so no action needed, just don't reorder.

3. **Coordinated contract change** (same PR as the drop migration, per repo doctrine — "never ship a contract change that only one side of the wire implements"): remove `school_policy_notes` from
   - `AddChildBodySchema` (`packages/contracts/src/children.ts:28`)
   - `ChildResponseSchema` (`packages/contracts/src/children.ts:62`)
   - `ChildUpsertInputSchema` (`packages/contracts/src/onboarding-tools.ts:52`, plus its doc comment at lines 49-51 referencing `children.school_policy_notes`)
   Colocated contract tests updated: `packages/contracts/src/children.test.ts` (2 fixture objects, ~lines 54, 159), `packages/contracts/src/heart-notes.test.ts` (1 fixture object, ~line 206). `contracts:check` passes with one fewer export path touched (no export removed — the schemas themselves stay exported, just smaller).
   **`packages/types` needs no manual edit** — every affected type is `z.infer<typeof Schema>`, so removing the field from the Zod shape automatically narrows the inferred type.

4. **Repository / service / agent-tool cleanup** — remove every read/write site (exhaustive list, verified by grep, no others exist in `apps/api/src`):
   - `apps/api/src/modules/children/children.repository.ts`: `InsertChildParams` type (~line 19), `DecryptedChildRow` type (~line 48), `ChildRow` type (~line 66), `CHILD_COLUMNS` select string (~line 80 — remove `school_policy_notes` from the comma list), `insert()` write (~line 117), `updateProfile()` params type (~line 299) + write (~line 311), `decodeRow()` mapping (~line 475).
   - `apps/api/src/modules/children/children.service.ts`: `UpsertByNameBody` type + doc comment (~lines 17, 25), `addChild()` (~line 66), `upsertByName()`'s PATCH-merge logic — the undefined-preserves/explicit-overwrites branch (~lines 107-120) and its two insert paths (~lines 133, 150), `toChildResponse()` (~line 222).
   - `apps/api/src/agents/tools/onboarding.tools.ts:165` — remove from the `childrenService.upsertByName({ body: {...} })` call.
   - `docs/OnboardingPrompt.md:386,400` — remove the tool-arg documentation for `school_policy_notes`.
   No route file changes (`children.routes.ts` never referenced the field directly — it flows through the service).

5. **Test sweep** — every fixture/assertion referencing `school_policy_notes` removed or updated. **Caution: `ChildResponseSchema` and `AddChildBodySchema` are NOT `.strict()`** — an unremoved `school_policy_notes: null` in a test fixture will NOT fail TypeScript compilation or Zod parsing in every case (TS excess-property checks only fire on fresh object literals assigned directly to an explicitly-typed target). Do not rely on "the compiler will catch it" — grep for `school_policy_notes` across `apps/`, `packages/` after the contract change and confirm zero matches outside this story's own new files (the backfill script + its test, and the story file itself). Known sites (verified by research, confirm exhaustively via the final grep):
   - `apps/api/test/factories/index.ts:84` — `buildChild()` default (highest-leverage single fix; most API tests below consume this factory).
   - `apps/api/src/agents/onboarding.agent.test.ts` (~lines 310, 378, 401) — remove the `school_policy_notes` assertions; `declared_allergens` remains as the nullable-field example in the same tests, so the strict-mode/null-strip coverage is unaffected.
   - `apps/api/src/agents/eval/onboarding-eval.harness.ts` (~lines 228, 295, 514, 526-527, 542) — remove the type field and its PATCH-merge mirror logic.
   - `apps/api/src/modules/children/children.repository.test.ts` (~lines 53, 92, 125, 157), `children.routes.test.ts` (~lines 32, 273), `children.service.test.ts` (~line 14).
   - `apps/api/src/modules/households/households.routes.test.ts` (~lines 1605, 1630), `parental-dashboard.service.test.ts` (~line 58), `kitchen-map/kitchen-map.composer.test.ts`, `allergy-guardrail/allergy-rules.engine.test.ts`, `catalog/catalog-seed.service.test.ts`, `onboarding/onboarding-zero-call.test.ts`, `jobs/plan-generation.job.test.ts`, `agents/orchestrator.test.ts`, `agents/planner/context/render.test.ts`, `agents/planner/post-compose.test.ts`, `agents/eval/planner-eval.builders.ts` — fixture-only references (child factory/builder objects), remove the field.
   - `apps/web/src/features/children/BagCompositionForm.test.tsx`, `apps/web/src/features/onboarding/KitchenMapHero.test.tsx`, `apps/web/src/features/onboarding/recognition-prose.test.ts`, `apps/web/src/features/onboarding/RecognitionEnding.test.tsx`, `apps/web/src/routes/(app)/kitchen-profile.test.tsx` — fixture-only.
   - E2E: `apps/web/test/e2e/3-20-bag-composition-settings.spec.ts:30`, `apps/web/test/e2e/2-12-bag-composition.spec.ts:38`, `apps/web/test/e2e/14-s4-day-detail.spec.ts:203,204`.
   - `apps/web/src/features/children/SchoolPoliciesForm.tsx:11-13` — stale comment referencing the now-retired column; update, no functional change (the form never had a control bound to it).

6. **Zero planner/prompt drift proof:** `render.ts` (`renderPlannerKitchenMapBlock`), `child-signal.assembler.ts`, `planner.prompt.ts`, `KitchenMapRepository.loadRaw()`, the guardrail engine — all byte-untouched (none of them ever referenced `school_policy_notes`; confirmed by this story's research). Planner golden evals pass unchanged. `is_active=false` on backfilled rows means `SchoolPoliciesRepository.findActiveByChildId` output — and therefore the planner's `school_policies` JSON block per child — is byte-identical before and after the backfill runs.

7. **`deferred-work.md:885` correction, not resolution:** the entry's parenthetical — *"today they [free-text policies] do [affect plan generation] via the legacy school_policy_notes column"* — is factually stale (this story's research proves `school_policy_notes` was never planner-visible) and becomes more so once the column is gone. Correct the parenthetical to reflect reality; do **not** mark the entry resolved — the underlying UI gap (no free-text input for `policy_description`, and no UX decision on whether user-authored notes should ever reach the planner) is untouched by this slice.

8. **Gates:** `pnpm turbo lint typecheck test` green; `knip` exit 0; `contracts:check` passes; API suite zero new failures vs baseline **2504 passed / 0 failed / 39 skipped**; full E2E vs baseline **425 passed / 13 skipped / 0 failed** (contract shape changed → full suite, 15-s1/15-s2/15-s3 precedent); zero unintended `apps/web` behavior changes (only fixture/comment edits, no component logic touched). Negative control per repo doctrine (e.g., break the backfill's empty-string skip → the "skips an empty-string note" test fails; restore → passes).

## Tasks / Subtasks

- [x] Task 1 — Backfill script (AC: #1)
  - [x] 1.1 `apps/api/scripts/backfill-school-policy-notes.ts`: `runBackfill({client})` pages `children`, skips null/empty-after-trim, upserts `school_policies(policy_type='note', is_active=false, ...)` on the existing `(child_id, policy_type)` conflict target.
  - [x] 1.2 `verifyParity({client})`: count parity between source and `policy_type='note'` target rows; non-zero exit on mismatch; no skip-on-error escape hatch.
  - [x] 1.3 `main()` CLI entry (env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`; no KEK — `policy_description` is plaintext, unlike `household_allergens.allergen`).
  - [x] 1.4 Unit tests: empty-string skip, idempotent re-run, is_active always false, parity pass/fail cases, no-PII diff output (mirror `backfill-lunch-rating-signals.test.ts`'s in-memory fake-client pattern; remember its ORDER BY fix from the 15-s3 review — page consistently).
- [x] Task 2 — Drop migration (AC: #2)
  - [x] 2.1 `supabase/migrations/20261035000300_drop_school_policy_notes.sql` with the gated-sequencing header comment.
  - [x] 2.2 Disclose the USER-SIDE GATE and its ordering relative to the still-unpushed 15-s1/15-s2/15-s3 migrations in the Dev Record.
- [x] Task 3 — Contract change (AC: #3)
  - [x] 3.1 Remove `school_policy_notes` from `AddChildBodySchema`, `ChildResponseSchema` (`packages/contracts/src/children.ts`), `ChildUpsertInputSchema` (`packages/contracts/src/onboarding-tools.ts`, incl. doc comment).
  - [x] 3.2 Update `children.test.ts` + `heart-notes.test.ts` fixtures; `contracts:check`.
- [x] Task 4 — Repository / service / tool cleanup (AC: #4)
  - [x] 4.1 `children.repository.ts`: types, `CHILD_COLUMNS`, `insert()`, `updateProfile()`, `decodeRow()`.
  - [x] 4.2 `children.service.ts`: types, `addChild()`, `upsertByName()` (both insert paths + PATCH-merge branch), `toChildResponse()`.
  - [x] 4.3 `onboarding.tools.ts:165`; `docs/OnboardingPrompt.md`.
- [x] Task 5 — Test sweep (AC: #5)
  - [x] 5.1 `apps/api/test/factories/index.ts` `buildChild()` default.
  - [x] 5.2 Sweep every file listed in AC #5 (apps/api unit/integration, apps/web unit, E2E specs); final exhaustive grep for zero remaining `school_policy_notes` references outside this story's new files.
  - [x] 5.3 `SchoolPoliciesForm.tsx` stale-comment update.
- [x] Task 6 — Doc correction + verification & gates (AC: #6, #7, #8)
  - [x] 6.1 Correct `deferred-work.md:885`'s stale parenthetical (do not mark resolved).
  - [x] 6.2 Reader/prompt-untouched proof: confirm the diff contains no changes under `render.ts`, `child-signal.assembler.ts`, `planner.prompt.ts`, `kitchen-map.repository.ts`, `allergy-rules.engine.ts` (production code, not their test fixtures — those DO change per AC #5); run planner golden evals.
  - [x] 6.3 `pnpm turbo lint typecheck test`, `knip`, `contracts:check`; full API suite vs 2504/0/39; negative control; full E2E vs 425/13/0.
  - [x] 6.4 Dev Record: files, decisions, deviations, USER-SIDE GATE sequencing; update `sprint-status.yaml`.

### Review Findings

- [x] [Review][Patch] Notes >500 chars abort the entire upsert batch [apps/api/scripts/backfill-school-policy-notes.ts:141-143,174-194] — `school_policies.policy_description` has a CHECK (≤500 chars), but `children.school_policy_notes` has no DB-level length limit (only the API contract layer caps writes at 500 via `AddChildBodySchema`). A note written before that cap existed, or via a non-API path, can exceed 500 chars. `runBackfill` batches every candidate into one `.upsert()` call, so a single over-length note throws a CHECK violation and fails the whole page's insert, not just the offending row. Fixed: mirrors the existing whitespace-only skip — guards `trimmed.length > 500`, skip + warn (new `skipped_too_long` counter, same shape as `skipped_empty`); skipped children now surface as `missing_note_row` in `verifyParity` so a human looks before the drop migration runs. 3 new tests added (16/16 pass).
- [x] [Review][Defer] No test exercises the `main()` CLI entry point [apps/api/scripts/backfill-school-policy-notes.ts:233-284] — deferred, pre-existing pattern shared by sibling backfill scripts (e.g. `backfill-lunch-rating-signals.ts`); coverage stops at the two exported pure functions, `main()`'s env-check/exit/catch control flow is unverified. Not a regression introduced by this story.

## Dev Notes

### The system after this slice (target state)

```
children.school_policy_notes            ← GONE (column dropped)
school_policies (policy_type='note')    ← historical free text, is_active=false, planner-invisible
school_policies (policy_type=<preset>)  ← unchanged, UI-authored, is_active=true, planner-visible
                                            (nut_free | no_heating | no_pork | no_shellfish | vegetarian_only)

Both live in the same table, same repository, same read path
(SchoolPoliciesRepository.findActiveByChildId → render.ts:233 → planner prompt).
Only the ACTIVE ones ever reach the planner — that was already true before this slice
for the UI-authored presets, and stays true for the migrated notes.
```

### Verified current-state facts (2026-08-02 research — trust these over the spec's brevity)

- **`children.school_policy_notes`** (`supabase/migrations/20260510000000_create_children_table.sql:12`): nullable `text`, no CHECK, no DB-level length limit (contract layer caps at 500). Its own creating migration's header explains it was an interim stand-in before `school_policies` shipped (Story 3.16); the `school_policies` migration (`20260700000000`) explicitly left it "untouched" at the time rather than migrating it.
- **`school_policies` DDL** (`20260700000000_create_school_policies.sql`): `(id, child_id NOT NULL REFERENCES children, policy_type text CHECK 1-100 chars, policy_description text CHECK ≤500 chars NULL, slot_scope slot_scope_enum DEFAULT 'bag_wide', is_active bool DEFAULT true, created_at, updated_at)`. **`policy_type` is plain text, not a Postgres enum** — only `slot_scope` is a real `CREATE TYPE`. Unique index `(child_id, policy_type)` is the upsert key. RLS on; API uses the service-role client (bypasses RLS, matches every other table in this repo).
- **The only writer** is `SchoolPoliciesRepository.upsertPolicy` (`school-policies.repository.ts:19-36`), called from `SchoolPoliciesService.updatePolicy` (`school-policies.service.ts:57-121`), which on `is_active:true` also triggers `PlanAdjustmentService.triggerAdjustment({type:'school_policy_changed', ...})` for plan regeneration. **Deactivation never triggers regeneration** (line 96-98) — this is why backfilling `is_active=false` is inert: no regen storm on cutover.
- **The only reader into the planner** is `SchoolPoliciesRepository.findActiveByChildId` (`school-policies.repository.ts:38-47`, `.eq('is_active', true)`), consumed by `KitchenMapRepository.loadRaw()`'s `fetchSchoolPoliciesForHousehold()` (`kitchen-map.repository.ts:458-478`, columns `child_id, policy_type, policy_description, slot_scope`), which lands in `renderPlannerKitchenMapBlock` (`render.ts:233`) as one JSON blob per child: `school_policies: ${JSON.stringify(c.school_policies)}` — **every** active row, all `policy_type` values, no filter. This is the single fact that makes `is_active=false` load-bearing for AC #6.
- **`children.school_policy_notes` has NEVER been read by the planner, guardrail, or Kitchen Map** (confirmed by direct grep of `apps/api/src/agents/**`, `apps/api/src/modules/allergy-guardrail/**`, `kitchen-map.repository.ts`'s `CHILD_COLUMNS` at line ~245 which selects `id, name, age_band, bag_composition_pattern, extra_rules` — no `school_policy_notes`). It round-trips ONLY through the Children REST API and the onboarding agent's `child.upsert` tool.
- **No `kitchen_map_version` bump trigger exists on `children` or `school_policies` today** (grepped all migrations for `CREATE TRIGGER ... ON (children|school_policies)` — zero matches). This is a pre-existing gap unrelated to this slice (school-policy changes bypass the Kitchen Map cache entirely, driven instead by `PlanAdjustmentService.triggerAdjustment`). Do not add a trigger here — out of scope, and adding one now would be an untested, unrequested behavior change.
- **Suite baselines** (post-15-s3-review, 2026-08-02): API **2504/0/39**, E2E **425/13/0**, `contracts:check` 555 exports, `knip` 0.

### Doctrine (binding here)

- **JSONB/text removal steps are independent, small PRs** (spec §8 step 3): this slice does NOT touch the slot-polymorphic cutover (15-s7), `child_extra_rules` (15-s5), or `family_language_terms` (15-s6). One column, one migration, one coordinated contract change.
- **Coordinated contract change** (project-context.md "Schema changes"): the contract, `apps/api`, and every consumer update in the same PR — never ship a contract change only one side implements.
- **Backfill-then-drop sequencing** (3-DM-B2 precedent, `backfill-household-allergens.ts` + `20261008000100_drop_legacy_allergen_columns.sql`): script runs and its verification gate passes BEFORE the drop migration is ever applied to a real database. The drop migration ships in this PR (reviewed, not applied) — applying it is the USER-SIDE GATE, exactly like 15-s1/15-s2/15-s3's unpushed migrations.
- **`ChildResponseSchema` / `AddChildBodySchema` are not `.strict()`** — do not assume the compiler catches every stale fixture. The final exhaustive grep (Task 5.2) is the real gate, not TypeScript.

### Previous story intelligence (15-s3 + its code review, 2026-08-02)

- 15-s3's code review caught an unordered `.range()` pagination bug in its backfill script (two independent review layers found it independently) — when writing this slice's `runBackfill`/`verifyParity` pagination, order by a stable key (`id`) from the start; don't repeat the mistake.
- 15-s3 also established the "thread the logger into every projection/backfill call so a live run surfaces warnings" pattern — if this backfill skips any malformed row, log it (warn), don't drop it silently.
- 15-s1/15-s2/15-s3 all disclose their USER-SIDE GATE prominently in both the story's Dev Record and `sprint-status.yaml`'s `last_updated` comment — follow the same pattern; this slice's gate is additive to those, not a replacement.

### Project Structure Notes

- New files: `apps/api/scripts/backfill-school-policy-notes.ts` (+ colocated test), `supabase/migrations/20261035000300_drop_school_policy_notes.sql`.
- Modified: `packages/contracts/src/children.ts` (+test), `packages/contracts/src/onboarding-tools.ts`, `packages/contracts/src/heart-notes.test.ts`, `apps/api/src/modules/children/children.repository.ts` (+test), `apps/api/src/modules/children/children.service.ts` (+test), `apps/api/src/agents/tools/onboarding.tools.ts`, `apps/api/src/agents/onboarding.agent.test.ts`, `apps/api/src/agents/eval/onboarding-eval.harness.ts`, `apps/api/test/factories/index.ts`, ~10 more `apps/api` test files (fixture-only, see AC #5), ~5 `apps/web` test files + 3 E2E specs (fixture-only), `apps/web/src/features/children/SchoolPoliciesForm.tsx` (comment only), `docs/OnboardingPrompt.md`, `_bmad-output/implementation-artifacts/deferred-work.md`.
- kebab-case files, colocated `*.test.ts`, `.js` extensions on relative imports (api ESM), `import type` for type-only edges.

### References

- [Source: _bmad-output/planning-artifacts/canonical-data-model-v2-spec.md §4.2, §4.5, §5 row 5, §8 step 3, §10]
- [Source: _bmad-output/implementation-artifacts/15-s3-child-preferences-projection-flip.md — Dev Record, Review Findings (pagination ORDER BY + logger-threading patterns)]
- [Source: supabase/migrations/20260510000000_create_children_table.sql; 20260700000000_create_school_policies.sql; 20261008000100_drop_legacy_allergen_columns.sql (drop-migration precedent)]
- [Source: apps/api/scripts/backfill-household-allergens.ts (backfill + verification-gate precedent); apps/api/scripts/backfill-lunch-rating-signals.ts (most recent backfill-script precedent, incl. its 15-s3 review fixes)]
- [Source: apps/api/src/modules/children/{children.repository.ts,children.service.ts,school-policies.repository.ts,school-policies.service.ts}]
- [Source: apps/api/src/modules/kitchen-map/kitchen-map.repository.ts:245,458-478; apps/api/src/agents/planner/context/render.ts:233]
- [Source: packages/contracts/src/{children.ts,onboarding-tools.ts,school-policy.ts}]
- [Source: _bmad-output/implementation-artifacts/deferred-work.md:885]

## Dev Agent Record

### Agent Model Used

claude-opus-5 (1M context) — dev-story workflow, 2026-08-02.

### Debug Log References

- RED phases observed: `backfill-school-policy-notes.test.ts` failed to resolve the module before it existed (13 tests, no-tests-collected).
- Negative control (AC #8): removed the empty-string guard in `migratableNote()` (`return trimmed` instead of `trimmed.length === 0 ? null : trimmed`) → 2 tests failed (`skips a whitespace-only note and warns`, `treats a whitespace-only note as nothing to migrate`); restored → 13/13 green.

### Completion Notes List

**What changed.** `children.school_policy_notes` is retired. A cutover script copies every surviving non-empty note into a `school_policies` row (`policy_type='note'`), a drop migration removes the column, and the contract + repository + service + agent-tool + test surface drops the field in the same PR (coordinated contract change per repo doctrine).

**The load-bearing decision: `is_active=false` on backfilled rows.** `school_policy_notes` was never planner-visible — verified by grep across `apps/api/src/agents/**`, the guardrail module, and `KitchenMapRepository`'s `CHILD_COLUMNS`. But `school_policies` *is*: `findActiveByChildId` (filtering `is_active=true`) feeds `loadRaw()` → `renderPlannerKitchenMapBlock` (`render.ts:233`), which serializes **every** active row regardless of `policy_type`. Backfilling as active would have pushed previously-invisible free text into the planner prompt as a side effect of a data-hygiene slice. Inactive keeps the prompt byte-identical; a human can activate a note through the existing PATCH route once the UX question is settled. Secondary benefit: `SchoolPoliciesService.updatePolicy` skips regeneration on inactive policies, so the cutover cannot trigger a plan-regeneration storm.

**Idempotency is stronger than "don't double-insert."** The upsert uses `ignoreDuplicates: true` (`ON CONFLICT DO NOTHING`) on the existing `(child_id, policy_type)` index, so a re-run also never clobbers a row a human edited or activated after an earlier run. A test asserts exactly that (`never clobbers a note row a human already edited`), and the fake client throws if the script ever passes `ignoreDuplicates: false`.

**Applied 15-s3's review lessons pre-emptively:** every paged scan carries an explicit `ORDER BY` (`children.id`, `school_policies.child_id`) — the unordered-`.range()` bug two review layers caught in 15-s3's script; and `ScriptDeps.logger` is threaded into the one place that can silently drop data (whitespace-only notes), with a test asserting the warn fires. A `pageSize: 1` test genuinely exercises the multi-page continuation loop, closing the coverage gap 15-s3 deferred.

**Deviations from the story text (2, both minor):**
1. **AC #1 wording said "upsert ... does not re-copy text that's already landed."** Implemented as `ON CONFLICT DO NOTHING` rather than a read-then-filter pre-check — same observable behavior, one round-trip instead of two, and race-safe.
2. **`verifyParity` reports `orphan_note_row` as a gate failure**, not just `missing_note_row`. AC #1 specified count parity in one direction; set-equality in both directions is strictly stronger and matches 15-s3's `extra_in_projection` precedent. An orphan is not data loss, so the script header explains why it still fails the gate (the two representations diverged since a prior run — a human should look before the column disappears).

**Onboarding agent test repointed, not deleted.** `onboarding.agent.test.ts` used `school_policy_notes` as its worked example for two OpenAI strict-mode behaviors (every property forced into `required`; null-valued keys stripped before the handler). Both assertions now use `bag_composition_pattern`, which is still an originally-optional nullish field on `ChildUpsertInputSchema` — the strict-mode/null-strip coverage is preserved rather than weakened.

**`deferred-work.md:885` corrected, deliberately NOT resolved (AC #7).** Its parenthetical claimed free-text policies reach plan generation via `school_policy_notes`; that was never true and is now impossible. The entry stays open because the actual gap — no free-text input in `SchoolPoliciesForm`, and no UX decision on whether a parent-authored note should ever reach the planner — is untouched by this slice.

**USER-SIDE GATE (two steps, in order).** Nothing here has run against a real database:
1. `pnpm --filter @hivekitchen/api exec tsx scripts/backfill-school-policy-notes.ts` — its parity gate is the cutover proof.
2. `supabase db push --include-all` to apply `20261035000300_drop_school_policy_notes.sql`.
The script CANNOT run after the migration (`verifyParity` reads the dropped column). This is additive to the still-outstanding 15-s1/15-s2/15-s3 gates — migrations apply in filename order, so `…000300` naturally lands after `…000000`/`…000100`/`…000200`; do not reorder. Until step 1 runs, the flip is covered by unit tests against an in-memory fake only.

**Gates.** API **2517 passed / 0 failed / 39 skipped** (baseline 2504/0/39 → +13 tests, zero failures). Web unit **727/727**. Full E2E **425 passed / 13 skipped / 0 failed** — exactly baseline. `pnpm turbo lint typecheck` all tasks green. `contracts:check` 555 exports. `knip` exit 0. Reader-untouched proof: `render.ts`, `planner.prompt.ts`, `kitchen-map.repository.ts`, `child-signal.assembler.ts`, `allergy-rules.engine.ts`, `school-policies.{repository,service}.ts` absent from the diff. Final grep confirms zero `school_policy_notes` references outside this story's own new files (excluding stale `apps/api/dist/` build artifacts, which are gitignored).

### File List

**New**
- `apps/api/scripts/backfill-school-policy-notes.ts`
- `apps/api/scripts/backfill-school-policy-notes.test.ts`
- `supabase/migrations/20261035000300_drop_school_policy_notes.sql`

**Modified**
- `packages/contracts/src/children.ts` (+`children.test.ts`)
- `packages/contracts/src/onboarding-tools.ts`
- `packages/contracts/src/heart-notes.test.ts`
- `apps/api/src/modules/children/children.repository.ts` (+`children.repository.test.ts`)
- `apps/api/src/modules/children/children.service.ts` (+`children.service.test.ts`)
- `apps/api/src/modules/children/children.routes.test.ts`
- `apps/api/src/agents/tools/onboarding.tools.ts`
- `apps/api/src/agents/onboarding.agent.test.ts`
- `apps/api/src/agents/eval/onboarding-eval.harness.ts`
- `apps/api/src/modules/households/households.routes.test.ts`
- `apps/api/src/modules/households/parental-dashboard.service.test.ts`
- `apps/api/test/factories/index.ts`
- `apps/web/src/features/children/SchoolPoliciesForm.tsx` (comment only)
- `apps/web/src/features/children/BagCompositionForm.test.tsx`
- `apps/web/test/e2e/{14-s4-day-detail,2-12-bag-composition,3-20-bag-composition-settings}.spec.ts`
- `docs/OnboardingPrompt.md`
- `_bmad-output/implementation-artifacts/deferred-work.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`

**Not modified (deliberately, AC #6):** `render.ts`, `planner.prompt.ts`, `child-signal.assembler.ts`, `kitchen-map.repository.ts`, `allergy-rules.engine.ts`, `school-policies.repository.ts`, `school-policies.service.ts`, `packages/contracts/src/school-policy.ts`, `packages/types/src/index.ts` (every affected type is `z.infer<>`, so it narrowed automatically).

## Change Log

- 2026-08-02 — 15-s4 implemented (dev-story, claude-opus-5). `children.school_policy_notes` retired: cutover backfill script + parity gate, drop migration `20261035000300`, and the coordinated contract/repository/service/agent-tool/test sweep. Surviving notes land as inactive `school_policies` rows (`policy_type='note'`) so the planner prompt is byte-identical. Status → review.
- 2026-08-02 — code review: 1 patch fixed (notes >500 chars no longer abort the whole upsert batch — skip+warn added, 3 new tests), 1 item deferred (no `main()` CLI test coverage), 24 dismissed. **E2E gate was skipped by explicit user decision — full Playwright suite was NOT run against this change.** Status → done.
