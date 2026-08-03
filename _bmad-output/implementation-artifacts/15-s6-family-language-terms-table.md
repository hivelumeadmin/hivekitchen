# Story 15.6: family-language-terms-table

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

<!-- Epic 15: Canonical Data Model v2. Source spec: _bmad-output/planning-artifacts/canonical-data-model-v2-spec.md §2 ("New JSONB escape hatches crept back in: preferred_family_language_terms..."), §4.1 ("households, users — KEEP. Two changes: Remove preferred_family_language_terms jsonb. Promote to satellite table family_language_terms(household_id, term, added_at, source) — it's a growing set with provenance, which is a table, not a jsonb array."), §5 row 7, §7.3 (Kitchen Map trigger invariant), §7.4 (JSONB policy), §8 step 3 (JSONB removals — small independent PRs), §10 (NEW tables / retired columns). -->
<!-- Grounded in codebase research 2026-08-02. Key facts that override/extend the spec's brevity:
  (1) The spec's DDL sketch — family_language_terms(household_id, term, added_at, source) — is stale against what actually shipped in Story 5-S10 (2026-06-08, "cultural-recognition-family-language-ratchet"). The live element shape (FamilyLanguageTermSchema, packages/contracts/src/family-language.ts) is `{term, maps_to, usage_count, state: candidate|active|forgotten, first_seen_at, ratified_at}` — richer than the spec's 4-column sketch, and the repository/routes/web layers all depend on this exact shape today. DECISION (made explicit here, not silently, same pattern as 15-s5's extra_library FK call): the real target DDL is `family_language_terms(id, household_id, term, maps_to, usage_count, state, first_seen_at, ratified_at)`, not the spec's terse sketch. `added_at`/`source` are not reproduced — no code anywhere reads or writes those field names.
  (2) 5-S10 itself already deviated from the PRD/epics docs, which say `users.preferred_family_language_terms` (epic-5-vertical-slices.md:222, epics.md:1984) — it shipped as `households.preferred_family_language_terms` instead, because detection in LumiService.submitTextTurn is keyed by householdId (no userId in scope) and UX-DR47 mandates household-wide, not per-user, ratcheting. The v2 spec's §4.1 already reflects the shipped household-scoped reality, not the stale per-user PRD text — no reconciliation needed here, just noting the history.
  (3) `FamilyLanguageRepository` (apps/api/src/modules/family-language/family-language.repository.ts) is the ONLY module that touches the column directly — confirmed by grep, zero other production references. Every consumer (lumi.service.ts's submitTextTurn/fetchHouseholdSnapshot, lumi.routes.ts, lumi-nudge.job.ts, family-language.routes.ts) calls only the repository's public methods (getTerms/recordUsage/ratify). Same encapsulation shape 15-s5 exploited for ExtraRulesRepository: storage can flip JSONB→rows with zero downstream code change and zero contract change, PROVIDED the public method signatures and return shapes stay identical.
  (4) UNLIKE 15-s5, KitchenMapRepository.loadRaw() does NOT read this column today (confirmed: zero matches for preferred_family_language_terms in kitchen-map.repository.ts) — Lumi's household snapshot reads active terms via a separate call to FamilyLanguageRepository.getTerms(), not via the Kitchen Map projection. This slice therefore does NOT touch loadRaw() or kitchen-map.composer.ts at all — same "no Kitchen Map change" shape as 15-s4, not 15-s5.
  (5) No trigger gap to close, and none to open. households is explicitly excluded from Kitchen-Map self-triggering (20260820000000_add_kitchen_map_version.sql:24-27, "self-trigger would recurse") — writing preferred_family_language_terms today does NOT bump kitchen_map_version and never has. Since the new table isn't read by loadRaw() either (point 4), it does not need a bump trigger per §7.3's own wording ("any table READ BY loadRaw() MUST have a trigger" — this one isn't). Do not add one speculatively; if a future slice adds family-language terms to the Kitchen Map projection, that slice adds the trigger then, using the existing bump_kitchen_map_version() generic function (direct-household_id variant — exact precedent: cultural_priors_bump_kitchen_map, extra_library_bump_kitchen_map, 20260820000000_add_kitchen_map_version.sql:226-229/236-239).
  (6) recordUsage() today does a whole-array JSONB read-modify-write across potentially several detected terms in one call, guarded only by an in-process async lock (withHouseholdLock) — the code's own comment discloses this is NOT safe across multiple API instances ("a multi-instance deployment would still need a DB-level guard"). A row-based table lets each term's read-modify-write become a real Postgres row lock (SELECT ... FOR UPDATE inside a SECURITY DEFINER function), which is safe across instances — this migration closes that disclosed gap for real, not just relocates it. Same category of incidental improvement as 15-s5 retiring append_extra_ban's workaround.
  (7) The forward-only ratchet (UX-DR47) is safety-critical to preserve exactly: candidate→active (opt_in, sets ratified_at, idempotent on active), candidate→forgotten (forget), and — the load-bearing invariant — `active` NEVER demotes, under any action, ever. This must be re-verified against the new row-based storage with the same test rigor 5-S10 used, not assumed to carry over silently.
  (8) Two review-patch-added surfaces exist that postdate 5-S10's original story text and only surface via a fresh grep of current repo state (already done): `GET /v1/households/:id/family-language` (family-language.routes.ts, requireMember) and `apps/web/src/hooks/useFamilyLanguageTerms.ts` (suppresses a resolved ratification card on rehydration). Both go through FamilyLanguageRepository.getTerms() — zero web/route changes needed here, but they are load-bearing for the "current readers" inventory and must not be missed. -->

## Story

As the platform's data model owner,
I want `households.preferred_family_language_terms` retired in favor of a `family_language_terms` table (one row per recognized kinship term, with usage/state provenance),
so that the 5-S10 family-language ratchet's growing per-household term set is queryable rows instead of a JSONB blob — closing the escape-hatch the spec calls out (§2, §4.1, §5 row 7) and completing the last of Epic 15's three independent JSONB-removal slices (§8 step 3), continuing directly from 15-s5's `child_extra_rules` retirement.

## Scope (small independent JSONB removal — create table → backfill → drop → coordinated cleanup, per §8 step 3)

**This slice:** a new `family_language_terms` table, two `SECURITY DEFINER` RPC functions that give `recordUsage`/`ratify` real per-row atomicity (replacing the in-process-only `withHouseholdLock`), a one-shot backfill script copying every household's `preferred_family_language_terms` array entries into rows verbatim, a value-consistent verification gate, a migration that drops the column (gated on the backfill's success, USER-SIDE), and rewriting `FamilyLanguageRepository`'s internals to read/write the new table while preserving the exact same public method signatures and `FamilyLanguageTerm[]` shape every consumer already expects.

**NOT this slice:**
- Any change to the wire contract (`packages/contracts/src/family-language.ts`) or the REST route shapes (`GET`/`POST /v1/households/:id/family-language`) — both keep returning the same `FamilyLanguageTerm` shape.
- Any change to `apps/web/**` — `useFamilyLanguageTerms.ts`, `useRatifyFamilyLanguage.ts`, `FamilyLanguageRatificationCard.tsx`, `FamilyLanguagePanel.tsx` all consume the unchanged REST responses.
- Any change to `KitchenMapRepository.loadRaw()` or `kitchen-map.composer.ts` — see Dev Notes point (4); this table is not, and does not become, a Kitchen Map source in this slice.
- Any change to the family-language *detector* (`family-language.detector.ts`, the curated `KINSHIP_TERMS` dictionary) or to threshold/UX-DR47 semantics — only storage changes.
- Adding `family_language_terms` to the Kitchen Map projection — out of scope; if wanted later, it is its own slice (and would need its own bump trigger then, per Dev Notes point 5).
- Resolving any other epic-15 slice's deferred items.

## Acceptance Criteria

1. **Create-table migration** `supabase/migrations/20261036000000_create_family_language_terms.sql`:
   - `CREATE TYPE family_language_state_enum AS ENUM ('candidate', 'active', 'forgotten')` (guarded with the `DO $$ ... EXCEPTION WHEN duplicate_object` idiom — exact precedent `slot_scope_enum`, `20260700000000_create_school_policies.sql:14-17`).
   - `family_language_terms(id uuid PK default gen_random_uuid(), household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE, term text NOT NULL CHECK (char_length(term) BETWEEN 1 AND 40), maps_to text NOT NULL CHECK (char_length(maps_to) BETWEEN 1 AND 40), usage_count integer NOT NULL DEFAULT 0 CHECK (usage_count >= 0), state family_language_state_enum NOT NULL DEFAULT 'candidate', first_seen_at timestamptz NOT NULL DEFAULT now(), ratified_at timestamptz NULL)`. Length caps mirror `FamilyLanguageTermSchema` exactly (`term`/`maps_to` both `min(1).max(40)`). No `updated_at` — every field-level mutation is expressed through the two RPCs below, which set `ratified_at`/`usage_count`/`state` directly.
   - `CREATE UNIQUE INDEX ... ON family_language_terms (household_id, term)` — the natural key (one row per distinct term per household), the RPCs' conflict/lookup target, and the backfill's idempotency key.
   - RLS enabled, no policy defined (service-role bypass only) — exact precedent `school_policies` (`20260700000000_create_school_policies.sql:38-41`, not `extra_library`'s member-select policy: `FamilyLanguageRepository` already only ever runs through the service-role client, no direct SDK access is wired for this data).
   - **No Kitchen Map trigger** — per Dev Notes point (5): this table is not read by `KitchenMapRepository.loadRaw()`, so §7.3's trigger requirement does not apply. State this explicitly in the migration's header comment so it reads as a verified decision, not an oversight (mirrors `20261035000300_drop_school_policy_notes.sql`'s "column was never read by..." framing).
   - **`record_family_language_usage(p_household_id uuid, p_detected jsonb, p_threshold integer) RETURNS jsonb`** — `SECURITY DEFINER`, locked down (`REVOKE ... FROM PUBLIC; GRANT ... TO service_role;`, same as `append_extra_ban`/`replace_child_extra_rules`). `p_detected` is a JSON array of `{"term": text, "maps_to": text, "occurrences": integer}`. For each element, inside one function invocation: `SELECT ... FOR UPDATE` the existing `(household_id, term)` row if present; if absent, `INSERT` a new `state='candidate'` row and add it to the result set if `occurrences >= p_threshold`; if present, capture the pre-update `usage_count`, `UPDATE usage_count = usage_count + occurrences`, and add the row to the result set only if `state = 'candidate' AND prev_usage_count < p_threshold AND new_usage_count >= p_threshold` (the exact "crossing" semantics `recordUsage`'s doc comment already specifies — reproduce them in SQL, do not change them). Returns a JSON array of the newly-candidate rows in the full column shape. Per-term `FOR UPDATE` inside this one function replaces `withHouseholdLock` — see Dev Notes point (6): this is the real fix for the disclosed in-process-only-lock caveat, not a relocation of the same gap.
   - **`ratify_family_language_term(p_household_id uuid, p_term text, p_action text) RETURNS TABLE(term text, maps_to text, usage_count integer, state family_language_state_enum, first_seen_at timestamptz, ratified_at timestamptz, transitioned_from family_language_state_enum)`** — `SECURITY DEFINER`, same lockdown. Locks the `(household_id, term)` row `FOR UPDATE`; if no row, returns zero rows (repository maps this to `{updated: null, from: null}`, same as today's "term not found" case). Reproduces `ratify()`'s exact forward-only logic (family-language.repository.ts:97-134) inside the function: `tell_lumi_more` never mutates, `transitioned_from` is `NULL`; `opt_in` on `candidate` → `state='active', ratified_at=now()`, `transitioned_from='candidate'`; `opt_in` on `active`/`forgotten` → no-op, `transitioned_from IS NULL`; `forget` on `candidate` → `state='forgotten'`, `transitioned_from='candidate'`; `forget` on `active`/`forgotten` → no-op (the forward-only lock — **no code path may ever set `state` from `active` to anything else**), `transitioned_from IS NULL`. `transitioned_from IS NULL` is how the repository distinguishes a real transition from a no-op, matching today's `from: FamilyLanguageState | null` contract exactly.

2. **Backfill script** `apps/api/scripts/backfill-family-language-terms.ts` (same shape as `backfill-child-extra-rules.ts`/`backfill-school-policy-notes.ts` — `#!/usr/bin/env tsx`, numbered-steps header docblock, exported pure `runBackfill({client})` + `verifyParity({client})`, `main()` guarded by `import.meta.url`, non-zero exit on failure, idempotent, `ScriptDeps.logger` threaded into every skip/warn path):
   - Pages `households` selecting `id, preferred_family_language_terms`, `ORDER BY id ASC` (every paginated `.range()` scan carries an explicit stable-key `ORDER BY` — the repeatedly-cited 15-s3 lesson two independent review layers caught; do not reintroduce the bug here).
   - For each household, parse `preferred_family_language_terms` (tolerant: treat a malformed/missing/non-array value as `[]`, count and warn, don't throw) and validate each element (`term`/`maps_to` present, 1–40 chars; `usage_count` a non-negative integer; `state` one of `candidate`/`active`/`forgotten`) — skip (count, don't insert) any element that fails validation, mirroring 15-s4's `skipped_too_long` pattern. This is a **structural copy**, not a re-derivation: `term`, `maps_to`, `usage_count`, `state`, `first_seen_at`, `ratified_at` all carry over byte-for-byte from the JSONB element to the new row.
   - Batched `.upsert(rows, { onConflict: 'household_id,term', ignoreDuplicates: true })` per page (idempotent — a re-run never clobbers a row a human has since ratified/forgotten via the live RPCs).
   - **Verification gate**, stronger than one-directional count parity (established house style, 15-s4/15-s5 precedent): for every household, the set of `(household_id, term)` pairs from the JSONB source must equal the set of `family_language_terms` rows (`missing_term_row` / `orphan_term_row`), **and** for every matched pair, `state` and `usage_count` must be identical between source and row (`state_mismatch` / `usage_count_mismatch`) — a divergence here would mean the forward-only ratchet's safety invariant did not survive the copy, which is a correctness bug, not just a completeness gap. Mismatch → print diff (household ID + term + reason only, no `maps_to` text — kinship words are not sensitive but keep the no-PII discipline consistent with sibling scripts) and `process.exit(1)`. No skip-on-error escape hatch.
   - Unit tests on the exported pure functions (same fake-Supabase-client pattern as the sibling backfill tests): empty-array skip, idempotent re-run (including a re-run after a human has since ratified a term live — must not clobber `state`/`ratified_at`), invalid-element skip (bad length, negative count, unknown state), malformed/missing JSONB tolerance, multi-page continuation (`pageSize: 1`), parity pass/fail for all four mismatch reasons, no-PII diff output.

3. **Drop migration** `supabase/migrations/20261036000100_drop_preferred_family_language_terms.sql`:
   ```sql
   ALTER TABLE households
     DROP COLUMN IF EXISTS preferred_family_language_terms;
   ```
   Header comment mirrors `20261035000300_drop_school_policy_notes.sql`'s convention: states this runs AFTER `apps/api/scripts/backfill-family-language-terms.ts` has executed against the target database and its verification gate has passed; applying it first is a data-loss event by design. **USER-SIDE GATE**, same doctrine as 15-s1 through 15-s5: authored and reviewed in this slice, applied outside this dev session. Sorts after `20261036000000` (this story) and after every still-unpushed migration from 15-s1 through 15-s5 by filename order — no manual sequencing action needed.

4. **`FamilyLanguageRepository` rewrite** (`apps/api/src/modules/family-language/family-language.repository.ts`) — same public method signatures and return shapes, internals only:
   - `getTerms(householdId)`: `SELECT id excluded, household_id excluded, term, maps_to, usage_count, state, first_seen_at, ratified_at FROM family_language_terms WHERE household_id = $1 ORDER BY first_seen_at ASC` (mirrors the JSONB array's insertion order — see Dev Notes point on read-ordering below) — map rows to `FamilyLanguageTerm[]`. Returns `[]` for a household with zero rows (same as today's `?? []`).
   - `recordUsage(householdId, detected, threshold)`: single `.rpc('record_family_language_usage', { p_household_id: householdId, p_detected: detected.map(d => ({ term: d.term, maps_to: d.maps_to, occurrences: d.occurrences })), p_threshold: threshold })` call, map the returned jsonb array into `{ newlyCandidate: FamilyLanguageTerm[] }`. `withHouseholdLock` and the module-level `householdLocks` map are **retired entirely** — the RPC's per-row `FOR UPDATE` is the real concurrency guard now (Dev Notes point 6). Delete the lock helper, do not keep it as dead code.
   - `ratify(householdId, term, action)`: single `.rpc('ratify_family_language_term', { p_household_id: householdId, p_term: term, p_action: action })` call. Empty result array → `{ updated: null, from: null }` (term not found, same as today). Otherwise map the single returned row to `FamilyLanguageTerm` and set `from` from the row's `transitioned_from` column (`null` when no real transition happened) — preserves the exact `{ updated, from }` contract `family-language.routes.ts` already depends on for its audit-write gate (`if (result.audit)` in `family-language.service.ts`/`.routes.ts` — confirm which module owns the audit-gate mapping and that it still receives a real `from` only on a real transition).
   - `writeTerms` (the private JSONB-array writer) is retired — no row-based equivalent needed; both RPCs write directly.

5. **`FamilyLanguageService`** (`apps/api/src/modules/family-language/family-language.service.ts`) — read this file first; it is expected to need **zero changes**, since it only calls the repository's public methods (`getTerms`/`recordUsage`/`ratify`), whose signatures and return shapes are unchanged by AC #4. Confirm this by reading the file, not by assuming from this story text — if it does reference the JSONB shape directly anywhere, update it and note the deviation.

6. **Test sweep** — every test that stubs/asserts `preferred_family_language_terms`, `FamilyLanguageRepository`, or `withHouseholdLock` gets updated for the new storage shape. Known sites (confirm exhaustively via a final grep for `preferred_family_language_terms`/`withHouseholdLock`/`householdLocks` across `apps/`, `packages/` — zero matches expected outside this story's new files and the retained wire-contract file `packages/contracts/src/family-language.ts`, which does not reference the column name and is not a match target):
   - `apps/api/src/modules/family-language/family-language.repository.test.ts` (rewrite around the new fake-client/RPC shape — lines 26, 32, 35, 215, 222, 226 currently stub `data.preferred_family_language_terms`/`.update()`).
   - `apps/api/src/modules/family-language/family-language.routes.test.ts` (lines 33, 39, 42 currently stub the same shape via the repository's underlying client — confirm whether this file mocks the repository directly, which would need zero changes, or the raw client, which would need the same rewrite).
   - `apps/api/src/modules/family-language/family-language.detector.test.ts` — pure function, no storage involved; expect zero changes, confirm.
   - `apps/api/src/modules/lumi/lumi.service.test.ts` (or equivalent) — if it doubles `FamilyLanguageRepository` at the method level (not the DB), expect zero changes; confirm rather than assume.
   - `apps/web/src/**` (`FamilyLanguageRatificationCard.test.tsx`, `layout.test.tsx`, any hook tests for `useFamilyLanguageTerms`/`useRatifyFamilyLanguage`) — the wire shape is unchanged, so these should need zero changes; confirm, don't assume.

7. **Gates:** `pnpm turbo lint typecheck test` green; `knip` exit 0; `contracts:check` passes with **zero export-path changes** (no contract file touched — assert this explicitly, not just hope); API suite zero new failures vs. the 15-s5 post-review baseline (**confirm exact current baseline at implementation time**, ~2546 passed / 0 failed / 39 skipped); full E2E vs. baseline (**confirm exact current baseline**, ~425 passed / 13 skipped / 0 failed) — run any E2E spec that exercises the family-language ratchet end-to-end if one exists (grep `test/e2e` for `family-language`/`ratify`), otherwise note explicitly that none does and this slice's E2E coverage is unit/integration only. Negative control per repo doctrine (e.g., break `ratify_family_language_term`'s forward-only guard so `active → forgotten` succeeds → a specific test must fail; restore → passes; break the RPC's `FOR UPDATE` row-scoping → a concurrency test must fail).

## Tasks / Subtasks

- [x] Task 1 — Create-table migration (AC: #1)
  - [x] 1.1 `supabase/migrations/20261036000000_create_family_language_terms.sql`: `family_language_state_enum`, `family_language_terms` table, unique index, RLS (no policy). No Kitchen Map trigger (documented decision, not an omission).
  - [x] 1.2 `record_family_language_usage(p_household_id, p_detected, p_threshold)` SECURITY DEFINER function — per-term `FOR UPDATE`, crossing-threshold detection, locked to `service_role`.
  - [x] 1.3 `ratify_family_language_term(p_household_id, p_term, p_action)` SECURITY DEFINER function — forward-only transition logic, `transitioned_from` column, locked to `service_role`.
- [x] Task 2 — Backfill script (AC: #2)
  - [x] 2.1 `apps/api/scripts/backfill-family-language-terms.ts`: `runBackfill({client})` pages `households ORDER BY id`, parses/validates array elements, upserts rows verbatim.
  - [x] 2.2 `verifyParity({client})`: two-directional set equality + per-row `state`/`usage_count` value checks (four mismatch reasons); non-zero exit on any mismatch.
  - [x] 2.3 `main()` CLI entry (env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`; no KEK — term/maps_to are plaintext, same as `policy_description`).
  - [x] 2.4 Unit tests: empty-array skip, invalid-element skip, malformed-JSONB tolerance, idempotent re-run (incl. never clobbering a live ratify), multi-page continuation (`pageSize: 1`), parity pass/fail for all four mismatch reasons, no-PII diff output.
- [x] Task 3 — Drop migration (AC: #3)
  - [x] 3.1 `supabase/migrations/20261036000100_drop_preferred_family_language_terms.sql` with the gated-sequencing header comment.
  - [x] 3.2 Disclose the USER-SIDE GATE and its ordering in the Dev Record.
- [x] Task 4 — `FamilyLanguageRepository` rewrite (AC: #4)
  - [x] 4.1 `getTerms()` → row read, `ORDER BY first_seen_at` (+ `term` tiebreak — see Deviation D2).
  - [x] 4.2 `recordUsage()` → `record_family_language_usage` RPC; retire `withHouseholdLock`/`householdLocks`.
  - [x] 4.3 `ratify()` → `ratify_family_language_term` RPC; map `transitioned_from` → `from`.
  - [x] 4.4 Retire `writeTerms`.
- [x] Task 5 — `FamilyLanguageService` verification (AC: #5)
  - [x] 5.1 Read the file; confirm zero changes needed, or make the minimal change and note it. → **Zero changes.** Verified by reading `family-language.service.ts` end to end: it only calls `repository.ratify()` and destructures `{updated, from}`, never touching storage shape. The audit gate lives in the SERVICE (`result.audit` is built there from `from !== null`); the route only reads `result.audit`. Both still receive a real `from` only on a real transition.
- [x] Task 6 — Test sweep (AC: #6)
  - [x] 6.1 Rewrite `family-language.repository.test.ts` around the new RPC shape.
  - [x] 6.2 Update `family-language.routes.test.ts` — it mocked the RAW client, so it needed the rewrite; now drives the shared double.
  - [x] 6.3 Exhaustive final grep for `preferred_family_language_terms`/`withHouseholdLock`/`householdLocks`.
  - [x] 6.4 Confirm/run any E2E coverage of the ratify flow — `apps/web/test/e2e/5-s10-family-language-ratchet.spec.ts` exists; 6/6 pass, zero changes needed (it mocks at the network boundary).
- [x] Task 7 — Verification & gates (AC: #7)
  - [x] 7.1 `pnpm turbo lint typecheck`, `knip`, `contracts:check` (zero export-path changes asserted).
  - [x] 7.2 Full API suite vs. current baseline, full E2E vs. current baseline, negative controls (forward-only guard break, household row-scoping break, parity `state`-check break).
  - [x] 7.3 Dev Record: files, decisions, deviations, USER-SIDE GATE sequencing; update `sprint-status.yaml`.

### Review Findings

- [x] [Review][Patch] `verifyParity` doesn't check `ratified_at` divergence, only `state`/`usage_count` — a corrupted/mismatched `ratified_at` copied during backfill would go undetected by the parity gate. User decided (2026-08-03) to extend the gate with a `ratified_at_mismatch` reason. [apps/api/scripts/backfill-family-language-terms.ts] — fixed: new `ratified_at_mismatch` reason added to `MismatchReason` and `verifyParity`, plus a covering test and a fix to the pre-existing `state_mismatch` test (its row now sets a matching `ratified_at` so it isolates the one field under test).
- [x] [Review][Patch] `record_family_language_usage` aborts the entire RPC call on a malformed `occurrences` value (non-numeric string, or a value that drives `usage_count` negative) instead of skipping just the bad element [supabase/migrations/20261036000000_create_family_language_terms.sql — `v_occ := coalesce(nullif(v_detected ->> 'occurrences','')::integer, 0)` cast + missing `usage_count >= 0` guard before UPDATE/INSERT] — fixed: the cast is now wrapped in a `BEGIN...EXCEPTION WHEN invalid_text_representation THEN CONTINUE END` block, plus a `CONTINUE WHEN v_occ < 0` guard, so one bad element is skipped rather than aborting the whole call.
- [x] [Review][Patch] `ratify_family_language_term` silently no-ops on an unrecognized `p_action` (returns the row unchanged, `transitioned_from` NULL) instead of raising — indistinguishable from a legitimate no-op, masking a caller bug/typo [supabase/migrations/20261036000000_create_family_language_terms.sql — the `IF p_action = 'opt_in' ... ELSIF p_action = 'forget' ... END IF` block has no `ELSE RAISE EXCEPTION`] — fixed: an explicit `IF p_action NOT IN ('opt_in','forget','tell_lumi_more') THEN RAISE EXCEPTION ...` guard runs before the row lock.
- [x] [Review][Patch] `record_family_language_usage` has no deterministic lock ordering across terms processed in one call — two concurrent calls touching overlapping terms in different array order is a real Postgres deadlock setup (no retry logic in the repository, surfaces as a raw 500) [supabase/migrations/20261036000000_create_family_language_terms.sql — `FOR v_detected IN SELECT value FROM jsonb_array_elements(...)` loop with no `ORDER BY term`] — fixed: the loop now adds `ORDER BY value ->> 'term'`, giving every call the same total lock-acquisition order.
- [x] [Review][Patch] `getTerms()` lacks the defensive `Array.isArray` guard that `recordUsage`/`ratify` both have and are explicitly tested for — an unexpected non-array PostgREST payload throws a raw `TypeError` instead of degrading to `[]` [apps/api/src/modules/family-language/family-language.repository.ts — `getTerms`] — fixed: `getTerms` now guards with the same `Array.isArray(data) ? data : []` pattern, with a new covering test.
- [x] [Review][Patch] Test double's `first_seen_at` is stamped per-iteration with real wall-clock `new Date()` calls inside the detected-terms loop, so it cannot faithfully reproduce the "one transaction, one timestamp" scenario that motivates the `term` tiebreak (D2) — the tiebreak is only proven via manually-constructed rows, not through `recordUsage` itself [apps/api/src/modules/family-language/family-language.test-double.ts] — fixed: one `callTimestamp` is captured before the loop and reused for every row created in that `recordUsage` call.
- [x] [Review][Patch] Dev Agent Record's "Deploy-then-backfill race" paragraph misdescribes the observable failure mode for a brand-new term recorded live during the gap — it surfaces as a permanent `orphan_term_row` (the JSONB source never contained it), not a `state_mismatch` as currently stated [_bmad-output/implementation-artifacts/15-s6-family-language-terms-table.md — USER-SIDE GATE section] — fixed: the paragraph now distinguishes the two failure modes (existing term ratified live → `state_mismatch`; brand-new term recorded live → permanent `orphan_term_row`).

- [x] [Review][Defer] Backfill's duplicate-term collapsing (`expectedTerms()`) keeps the first occurrence of a repeated `(household_id, term)` pair in a household's JSONB array rather than the most-advanced state, or failing outright — only reachable via pre-existing data corruption, not through any current write path [apps/api/scripts/backfill-family-language-terms.ts] — deferred, pre-existing data-shape assumption, no evidence current write paths can produce duplicates
- [x] [Review][Defer] `record_family_language_usage`'s `CONTINUE WHEN v_term IS NULL OR v_maps_to IS NULL` silently drops a malformed detected element with no error or log signal [supabase/migrations/20261036000000_create_family_language_terms.sql] — deferred, RPC is locked to `service_role` and the only caller (repository) always sends well-typed elements; risk is theoretical absent a non-TS caller

## Dev Notes

### The system after this slice (target state)

```
households.preferred_family_language_terms   ← GONE (column dropped)
withHouseholdLock() / householdLocks          ← GONE (superseded by real per-row
                                                  Postgres locking inside the RPCs)
family_language_terms (term, maps_to,
  usage_count, state, first_seen_at,
  ratified_at)                                ← one row per recognized kinship term
record_family_language_usage(...)             ← RPC: atomic per-term upsert + bump
ratify_family_language_term(...)              ← RPC: atomic forward-only transition

FamilyLanguageRepository's public contract (getTerms/recordUsage/ratify — types
and shapes) is IDENTICAL before/after. Every downstream consumer (LumiService's
submitTextTurn + fetchHouseholdSnapshot, the two REST routes, lumi-nudge.job.ts)
keeps calling the same repository methods and gets the same FamilyLanguageTerm[]
shape back — only the repository's internals know storage changed from a JSONB
column on households to rows in family_language_terms.

Unlike 15-s5, KitchenMapRepository.loadRaw() is NOT touched — this table was
never, and is still not, a Kitchen Map source.
```

### Verified current-state facts (2026-08-02 research — trust these over the spec's brevity)

- **`households.preferred_family_language_terms`** (`supabase/migrations/20261020000000_add_household_family_language_terms.sql`): `jsonb NOT NULL DEFAULT '[]'::jsonb`, one array per household. No DB-level shape enforcement — only `FamilyLanguageTermSchema` (contract layer) constrains it.
- **Only reader/writer module**: `FamilyLanguageRepository` (`getTerms`/`recordUsage`/`ratify`/private `writeTerms`). Confirmed by grep: zero other production references to the column.
- **Every current consumer** of the repository's public methods (none need code changes per Dev Notes above, only re-verification their tests still pass): `apps/api/src/modules/lumi/lumi.service.ts` (`submitTextTurn` calls `recordUsage`; `fetchHouseholdSnapshot` calls `getTerms` to build the agent-prompt "use these exact words" block), `apps/api/src/modules/lumi/lumi.routes.ts` and `apps/api/src/jobs/lumi-nudge.job.ts` (both construct `FamilyLanguageRepository` and wire it into `LumiService` deps), `apps/api/src/modules/family-language/family-language.routes.ts` (`GET /v1/households/:id/family-language`, `POST .../ratify`).
- **`KitchenMapRepository.loadRaw()`** does not, and after this slice still does not, read family-language data — confirmed by grep, zero matches. This is the key structural difference from 15-s5 (which had to rewrite `loadRaw()`'s extra-rules fetch): this slice touches no Kitchen Map code at all.
- **`households` is explicitly excluded from Kitchen-Map self-triggering** (`20260820000000_add_kitchen_map_version.sql:24-27`) — writing this column has never bumped `kitchen_map_version`, and moving the data to a new table that also isn't a `loadRaw()` source changes nothing about that. No trigger is added in this slice (Dev Notes header point 5).
- **Concurrency gap this migration closes for real**: `recordUsage`'s whole-array JSONB read-modify-write is currently guarded only by an in-process `withHouseholdLock` — the code's own comment discloses this does not hold across multiple API instances. The `record_family_language_usage`/`ratify_family_language_term` RPCs use per-row `SELECT ... FOR UPDATE` inside `SECURITY DEFINER` functions, which is a real Postgres-level guard, safe across any number of instances. This is a genuine correctness improvement, not scope creep — it is what "the JSONB read-modify-write becomes rows" mechanically implies once the RPC is written correctly.
- **Forward-only ratchet (UX-DR47)**: `candidate → active` (opt_in, idempotent), `candidate → forgotten` (forget), and `active` never demotes under any action — this is the single most safety-critical invariant in this slice and must be re-proven against the new storage with equivalent test rigor to 5-S10's own suite, not assumed to carry over.
- **Review-patch-added surfaces** (postdate 5-S10's original story text, only visible via a fresh repo grep): `GET /v1/households/:id/family-language` route + `FamilyLanguageTermsResponseSchema`, and the web `useFamilyLanguageTerms.ts` hook that suppresses an already-resolved ratification card on rehydration. Both consume `getTerms()` only — zero changes needed to either, but they belong in the "current readers" inventory.
- **Suite baseline** (post-15-s5-review, 2026-08-02): API ~2546/0/39, E2E 425/13/0, `contracts:check` 555 exports, `knip` 0 — **confirm exact counts at implementation time**, since intervening slices may have shifted them.

### Doctrine (binding here)

- **JSONB/text removal steps are independent, small PRs** (spec §8 step 3): this is the **last** of the three independent small-removal slices (`school_policy_notes` → 15-s4, `extra_rules` → 15-s5, `preferred_family_language_terms` → 15-s6). The next slice, 15-s7, is the real cutover (slot-polymorphic reference) and is explicitly a different, larger category of change.
- **No contract change this time** — like 15-s5, unlike 15-s4: `packages/contracts/src/family-language.ts` is untouched. Verify this explicitly at gate-check time (AC #7) rather than assuming it from this story text.
- **Backfill-then-drop sequencing** (established 15-s1 through 15-s5 precedent): script runs and its verification gate passes BEFORE the drop migration is ever applied to a real database. Both migrations in this story ship reviewed-but-unapplied; applying them is the USER-SIDE GATE.
- **Row-based writes need the same (or better) atomicity the JSONB write had** — do not silently downgrade `recordUsage`/`ratify` to unguarded multi-statement API-layer read-then-write. Use the two `SECURITY DEFINER` RPCs (AC #1), not sequential PostgREST calls from the repository.
- **Two-directional + value-consistency parity is the house style** for this story family (established 15-s4/15-s5, extended here with a `state`/`usage_count` equality check because a forward-only invariant demands stronger proof than existence alone) — apply it directly, don't re-derive a weaker version.
- **Zod 4, not 3.23** — `project-context.md` is stale on this point (confirmed by 15-s3's Dev Notes). Only relevant if a new Zod schema is introduced; per the "no contract change" doctrine above, none should be.

### Previous story intelligence (15-s5 + its code review, 2026-08-02)

- 15-s5's review caught a real bug: a batch upsert that throws on one bad row aborts the whole page. This story's backfill (AC #2) pre-empts that: validate/skip-and-count **before** building the batch, exactly like the fixed sibling scripts do.
- 15-s5's review confirmed the two-directional (`missing`/`orphan`) parity pattern is house style; this story extends it with value-consistency checks because, unlike pin/ban labels, a term's `state` carries a safety invariant (forward-only) that existence-only parity cannot catch a violation of.
- 15-s3 established: thread `logger` into every backfill/projection call that can silently drop data; every paginated `.range()` scan needs an explicit `ORDER BY` on a stable key (two independent review layers caught this exact bug in 15-s3's own script).
- 15-s5's headline finding was a literal NUL byte inside a backfill script's template literal that made `git diff` treat the file as binary, hiding it from review entirely. No specific action item transfers directly, but it is a strong argument for reviewing this story's backfill script with a raw byte/encoding check in mind, not just a normal diff read.
- 15-s5 disclosed a "deploy-then-backfill race window" (a live-mutated row can be resurrected by the backfill's stale-source upsert) as a systemic, accepted Epic 15 pattern. The same risk applies here: a term ratified live via the new RPC during the gap between migration deploy and backfill run will not appear in the JSONB source and cannot be resurrected in the wrong direction (rows are the new source of truth once deployed) — but the reverse is also true: the backfill still writes from the stale JSONB, so a term that only exists in the JSONB (never re-recorded live in the gap) is correctly caught, and a term ratified live in the gap is simply not re-written by the backfill (its `ignoreDuplicates: true` upsert no-ops on the existing row). Confirm this reasoning holds during implementation rather than assuming it transfers unchanged from 15-s5's column-drop shape.

### Project Structure Notes

- New files: `supabase/migrations/20261036000000_create_family_language_terms.sql`, `supabase/migrations/20261036000100_drop_preferred_family_language_terms.sql`, `apps/api/scripts/backfill-family-language-terms.ts` (+ colocated test).
- Modified: `apps/api/src/modules/family-language/family-language.repository.ts` (+ test), `apps/api/src/modules/family-language/family-language.routes.test.ts` (if it mocks the client rather than the repository).
- **Not modified (deliberately, unless the exhaustive grep in Task 6.3 proves otherwise):** `packages/contracts/src/family-language.ts`, `apps/api/src/modules/family-language/family-language.service.ts`, `apps/api/src/modules/family-language/family-language.routes.ts`, `apps/api/src/modules/family-language/family-language.detector.ts` (+ test), `apps/api/src/modules/lumi/**`, `apps/api/src/jobs/lumi-nudge.job.ts`, `apps/api/src/modules/kitchen-map/**`, `apps/web/**` (all of it — the wire contract is unchanged).
- kebab-case files, colocated `*.test.ts`, `.js` extensions on relative imports (api ESM), `import type` for type-only edges.

### References

- [Source: _bmad-output/planning-artifacts/canonical-data-model-v2-spec.md §2, §4.1, §5 row 7, §7.3, §7.4, §8 step 3, §10]
- [Source: _bmad-output/implementation-artifacts/5-s10-cultural-recognition-family-language-ratchet.md — original storage decision (households, not users), UX-DR47 forward-only semantics, `withHouseholdLock` caveat]
- [Source: _bmad-output/implementation-artifacts/15-s5-child-extra-rules-table.md — backfill/verify/drop pattern, two-directional parity-gate doctrine, SECURITY DEFINER RPC pattern for preserving write atomicity]
- [Source: supabase/migrations/20261020000000_add_household_family_language_terms.sql; 20260700000000_create_school_policies.sql (RLS + enum pattern precedent); 20260820000000_add_kitchen_map_version.sql (generic `bump_kitchen_map_version()` for direct-household_id tables, lines 62-96, 226-229; households self-trigger exclusion, lines 24-27)]
- [Source: apps/api/src/modules/family-language/family-language.repository.ts; family-language.routes.ts; family-language.service.ts; family-language.detector.ts]
- [Source: packages/contracts/src/family-language.ts (FamilyLanguageTermSchema — the wire shape this story must not change)]
- [Source: apps/api/src/modules/lumi/lumi.service.ts (submitTextTurn, fetchHouseholdSnapshot); lumi.routes.ts; apps/api/src/jobs/lumi-nudge.job.ts]
- [Source: apps/web/src/hooks/useFamilyLanguageTerms.ts; useRatifyFamilyLanguage.ts; apps/web/src/components/FamilyLanguageRatificationCard.tsx]

## Dev Agent Record

### Agent Model Used

claude-opus-5[1m] (dev-story workflow), 2026-08-02 → 2026-08-03.

### Debug Log References

- Baseline captured before any edit: API **2546 passed / 0 failed / 39 skipped** — matches the figure the story predicted exactly, so no intervening slice shifted it.
- `contracts:check` **555 exports** before and after — identical, so "zero contract change" is verified, not assumed.
- Three negative controls run (see Completion Notes §Negative controls).
- One **pre-existing, unrelated** API test failure surfaced mid-session — analysed and left untouched (see §Pre-existing failure).

### Completion Notes List

#### What landed

`households.preferred_family_language_terms` (JSONB array) is retired in favour of `family_language_terms` rows, behind a `FamilyLanguageRepository` whose **public contract is byte-identical** — same three method signatures, same `FamilyLanguageTerm[]` shape. Consequently `family-language.service.ts`, `family-language.routes.ts`, `family-language.detector.ts`, `lumi.service.ts`, `lumi.routes.ts`, `lumi-nudge.job.ts`, `packages/contracts/**` and **all of `apps/web`** are untouched — `git status` on `apps/web` and `packages` is empty.

The two whole-array read-modify-writes became two `SECURITY DEFINER` RPCs (`record_family_language_usage`, `ratify_family_language_term`) that take `SELECT … FOR UPDATE` on the affected row. The module-level `withHouseholdLock` / `householdLocks` in-process async lock is **deleted, not kept as dead code** — its own comment disclosed it did not hold across API instances, and the row lock supersedes it for real.

Per Dev Notes point (4)/(5), **no Kitchen Map code was touched and no bump trigger was added** — this table is not a `loadRaw()` source. The migration header states that as a verified decision so it does not read as an oversight.

#### Disclosed deviations

- **D1 — parity diff prints `maps_to`, not `term` (AC #2 says the opposite).** AC #2 asked for "household ID + term + reason … no `maps_to` text". That inverts the PII doctrine 5-S10 established and the code still enforces: `family-language.service.ts:18-26` and `family-language.routes.ts:64-66` both state the family-language **word is NEVER written to audit — `maps_to` + state codes only**. Printing the parent's kinship term into cutover logs would be the one thing the module deliberately avoids. The gate therefore prints `household_id + maps_to + reason`, which is enough to locate a row and matches what the audit trail already carries. A test asserts neither term appears in the diff.
- **D2 — `getTerms()` orders by `first_seen_at`, then `term`.** AC #4 specified `ORDER BY first_seen_at ASC` alone. `first_seen_at` is **not unique**: one `record_family_language_usage` call inserting several terms stamps them all with the same transaction timestamp, so the tail order would be arbitrary and the agent-prompt bytes would drift between reads. The `term` tiebreak makes it deterministic. This is the 15-s5 "nondeterministic prompt bytes" lesson applied pre-emptively; test coverage included.
- **D3 — `record_family_language_usage` uses insert-first (`ON CONFLICT DO NOTHING`) then `FOR UPDATE` on the bump path.** AC #1 described `SELECT … FOR UPDATE` first, then insert-if-absent. That ordering has a race: two concurrent calls both find nothing to lock and both insert. Letting the unique index arbitrate creation, then locking only on the pre-existing-row path, is race-free and still gives every count bump a real row lock. Crossing semantics are unchanged — a brand-new row has prev=0, so it crosses iff `occurrences >= threshold`, exactly as the retired TypeScript did.
- **D4 — the RPCs return whole rows (`to_jsonb`), including `id`/`household_id`.** AC #1 said "full column shape"; the repository projects down to the six contract fields, and two tests assert the wire shape never leaks `id`, `household_id` or `transitioned_from`.
- **D5 — the ratchet test double lives in a non-test file.** `family-language.test-double.ts` is shared by the repository and routes tests. Two divergent hand-copies of the forward-only semantics would be strictly worse. It carries no production imports and knip is clean.

#### Coverage gap (stated plainly, not worked around)

**The SQL function bodies are not executed by any test.** This repo has no Postgres test harness — no `pg-mem`, no testcontainers, no PGlite, and no test anywhere loads `supabase/migrations`. The two RPCs, including their `SELECT … FOR UPDATE` row locking, are verified by review only. This is the same gap `replace_child_extra_rules` shipped with in 15-s5.

What *is* covered: the repository's exact RPC names and argument payloads, its result mapping in every branch, and the full ratchet semantics against an in-memory double that mirrors the SQL. The negative controls below break the **double**, which proves the tests are load-bearing against the semantics — it does not prove the SQL matches the double. A reviewer should read the two function bodies as the primary artifact.

Neither migration was executed in this session: no Supabase CLI and no local Postgres are available here (`supabase: command not found`). First execution happens at the USER-SIDE GATE below.

#### Negative controls

| Break | Expected | Result |
|---|---|---|
| Allow `forget` on an `active` term (forward-only guard removed) | a ratchet test fails | **2 failed / 47 passed** ✓ |
| Drop the `household_id` filter in `ratify` row lookup | the cross-household test fails | **1 failed / 48 passed** ✓ |
| Disable `verifyParity`'s `state` comparison | the `state_mismatch` tests fail | **2 failed / 29 passed** ✓ |

All three restored to green afterwards.

#### Gates

| Gate | Baseline | After | Verdict |
|---|---|---|---|
| API suite | 2546 / 0 / 39 | **2596 passed / 1 failed / 39 skipped** | +51 tests, **0 new failures** — the 1 failure is pre-existing and unrelated (below) |
| family-language module | — | 49 / 49 | ✓ |
| backfill script | — | 31 / 31 | ✓ |
| web unit | 727 / 727 | 727 / 727 | ✓ unchanged |
| E2E `5-s10-family-language-ratchet` | 6 / 6 | 6 / 6 | ✓ zero spec changes |
| E2E full suite | 425 / 13 / 0 | **425 passed / 13 skipped / 0 failed** | ✓ exactly baseline |
| turbo lint + typecheck | green | 14 / 14 successful | ✓ |
| knip | 0 | 0 | ✓ (one finding on my new file — an unused exported `RpcCall` type — fixed by un-exporting it) |
| `contracts:check` | 555 | **555** | ✓ zero contract change proven |
| `git status apps/web packages` | — | empty | ✓ |

#### Pre-existing failure (NOT caused by this story, deliberately not fixed)

`src/modules/voice/voice-transcript.repository.test.ts > defaults retention_until to ~now + 90 days` fails with `expected 3600000 to be less than 60000` — exactly one hour.

It is a **local-timezone DST artifact that went live during this session**, not a regression:
- The file is untouched by this story (`git status` confirms) and imports nothing from the family-language module.
- It **passes under `TZ=UTC`** (verified: 4/4 pass).
- Cause: the test compares `now + 90 days` computed in local time against fixed-millisecond arithmetic. The baseline ran at 23:29 on Aug 2 (+90d = Oct 31, before US DST ends); the re-run was at 09:11 on Aug 3 (+90d = **Nov 1, 2026**, the DST boundary), so the two computations diverge by exactly one hour.

Left untouched per the surgical-changes rule — it is a different module and out of this story's scope. It will fail for the next ~two months on any machine in a DST-observing timezone and is worth its own one-line fix.

#### USER-SIDE GATE — THREE ORDERED STEPS, not one push

1. `supabase db push --include-all` — applies `20261036000000_create_family_language_terms.sql` **plus** every still-unpushed migration from 15-s1 through 15-s5 (`20261035000000`…`20261035000500`).
2. `pnpm --filter @hivekitchen/api exec tsx scripts/backfill-family-language-terms.ts` — its verification gate is the cutover proof. It exits non-zero on any mismatch; do not proceed past a failure.
3. **ONLY THEN** apply `20261036000100_drop_preferred_family_language_terms.sql`.

Steps 2 and 3 cannot be merged: `verifyParity` reads `households.preferred_family_language_terms`, so once the column is dropped the cutover is permanently unverifiable.

**Deploy-then-backfill race (Dev Notes point on 15-s5's systemic pattern — confirmed, not assumed).** Between step 1 and step 2 the API writes rows while the JSONB source goes stale. Reasoning re-checked for this slice's shape: the backfill's `ignoreDuplicates: true` upsert only ever ADDS, so it cannot demote or corrupt anything a live write already made — the forward-only invariant survives the gap. Two distinct failure modes fall out of this, both fail-loud rather than silently corrupting:
- A term that **already existed** in the stale JSONB and was ratified live during the gap (`candidate` → `active`) shows up as a `state_mismatch` (source says `candidate`, row says `active`) — benign, the row is simply *more* advanced than the source, and can be re-verified after re-reading the source.
- A **brand-new** term recorded live during the gap (never present in the stale JSONB at all, since it didn't exist before step 1) has no source entry to match against and shows up as a permanent `orphan_term_row` instead — the JSONB snapshot can never retroactively contain it. This is also benign (the row is correct; the source is just stale), but it will not resolve itself the way a `state_mismatch` might on a re-read — treat any `orphan_term_row` surfaced right after the deploy window as expected, not as data loss.

Run step 2 promptly after step 1 to keep both windows small.

### File List

**New**
- `supabase/migrations/20261036000000_create_family_language_terms.sql`
- `supabase/migrations/20261036000100_drop_preferred_family_language_terms.sql`
- `apps/api/scripts/backfill-family-language-terms.ts`
- `apps/api/scripts/backfill-family-language-terms.test.ts`
- `apps/api/src/modules/family-language/family-language.test-double.ts`

**Modified**
- `apps/api/src/modules/family-language/family-language.repository.ts`
- `apps/api/src/modules/family-language/family-language.repository.test.ts`
- `apps/api/src/modules/family-language/family-language.routes.test.ts`
- `_bmad-output/implementation-artifacts/15-s6-family-language-terms-table.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`

**Deliberately unmodified (verified, not assumed)** — `packages/contracts/src/family-language.ts`, `family-language.service.ts`, `family-language.routes.ts`, `family-language.detector.ts` (+ test), `apps/api/src/modules/lumi/**`, `apps/api/src/jobs/lumi-nudge.job.ts`, `apps/api/src/modules/kitchen-map/**`, all of `apps/web/**`.

## Change Log

- 2026-08-03 — 15-s6 CODE REVIEW -> done: 3-layer adversarial pass (Blind Hunter/Edge Case Hunter/Acceptance Auditor). 1 decision resolved (user chose to extend `verifyParity` with a new `ratified_at_mismatch` reason); 6 patches applied: `record_family_language_usage` no longer aborts its whole call on a malformed/negative `occurrences` value (per-element `EXCEPTION WHEN invalid_text_representation` + `usage_count >= 0` guard), `ratify_family_language_term` now `RAISE EXCEPTION`s on an unrecognized `p_action` instead of silently no-op'ing, the per-term lock loop gained a deterministic `ORDER BY value ->> 'term'` closing a real cross-call deadlock risk, `getTerms()` gained the same `Array.isArray` defensive guard `recordUsage`/`ratify` already had, the test double's `first_seen_at` now uses one timestamp per `recordUsage` call instead of per-row wall-clock stamps, and the story's own "deploy-then-backfill race" paragraph was corrected to distinguish `state_mismatch` (existing term ratified live) from a permanent `orphan_term_row` (brand-new term recorded live). 2 deferred (duplicate-term-in-JSONB collapsing keeps first-seen not most-advanced; `record_family_language_usage`'s silent drop of a null term/maps_to element) — both logged in `deferred-work.md`. 4 dismissed as noise (doc-phrasing nitpicks, one false positive from the blind-hunter's restricted context later confirmed correct by the full-access layers). Post-patch gates: API 2598 passed/39 skipped (+2 new tests, same 1 pre-existing unrelated DST failure), turbo lint+typecheck green, full E2E suite green (user-confirmed). Status → done.
- 2026-08-03 — 15-s6 IMPLEMENTED (dev-story, claude-opus-5[1m]). `households.preferred_family_language_terms` retired into `family_language_terms` rows behind an UNCHANGED `FamilyLanguageRepository` public contract, so every consumer (LumiService, the nudge job, both REST routes, all of `apps/web`) is byte-untouched and `contracts:check` stays at 555 exports. `withHouseholdLock`/`householdLocks` DELETED — two new `SECURITY DEFINER` RPCs take real `SELECT … FOR UPDATE` row locks, closing the multi-instance concurrency gap the old comment disclosed. No Kitchen Map change and no bump trigger (not a `loadRaw()` source — recorded as a verified decision in the migration header). 5 disclosed deviations: parity diff prints `maps_to` not `term` (AC #2 inverted the 5-S10 PII doctrine that the service/route code still enforces); `getTerms` adds a `term` tiebreak because `first_seen_at` is not unique within one RPC call; `record_family_language_usage` inserts-first then locks, because AC #1's lock-then-insert ordering races on creation; RPCs return whole rows and the repository projects down; the ratchet test double lives in a shared non-test file. STATED GAP: the SQL bodies are not executed by any test — this repo has no Postgres harness (same gap as `replace_child_extra_rules`); the double mirrors them and 3 negative controls prove the tests are load-bearing, but the function bodies need review, not a runner. GATES: API 2596 passed/39 skipped (+51 tests, 0 new failures; 1 PRE-EXISTING unrelated failure in `voice-transcript.repository.test.ts` — a local-DST artifact that passes under `TZ=UTC`, left untouched), web unit 727/727, family-language E2E 6/6, turbo lint+typecheck 14/14, knip 0, `contracts:check` 555 UNCHANGED, `apps/web` + `packages` diff EMPTY. USER-SIDE GATE = 3 ORDERED STEPS: (1) `supabase db push --include-all`; (2) run `scripts/backfill-family-language-terms.ts` — its four-reason parity gate is the cutover proof; (3) ONLY THEN apply `20261036000100` (the drop). Steps 2 and 3 cannot be merged — `verifyParity` reads the dropped column. Status → review.
- 2026-08-02 — 15-s6 story authored (create-story). Grounded in codebase research: unlike 15-s5's `extra_rules`, this table is not, and does not become, a Kitchen Map source, so `KitchenMapRepository.loadRaw()` is untouched — the smallest-scope slice of the three JSONB removals. Key decision (made explicit, not silently): the real target DDL reproduces 5-S10's shipped `FamilyLanguageTerm` shape (`term, maps_to, usage_count, state, first_seen_at, ratified_at`), not the spec's terser 4-column sketch (`household_id, term, added_at, source`), since the richer shape is what the repository/routes/web layers actually depend on today. Two new `SECURITY DEFINER` RPCs (`record_family_language_usage`, `ratify_family_language_term`) replace the in-process-only `withHouseholdLock`, closing a disclosed multi-instance-concurrency gap for real via per-row Postgres locking. Status → ready-for-dev.
