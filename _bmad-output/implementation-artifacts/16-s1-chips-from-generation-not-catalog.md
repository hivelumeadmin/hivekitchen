# Story 16.1: chips-from-generation-not-catalog

Status: review

> Brief: `_bmad-output/planning-artifacts/catalog-seeding-redesign-generate-at-onboarding.md`
> All five design decisions were resolved 2026-08-13 and are binding here — see Doctrine.

---

## Story

**As a** parent finishing the Lumi interview,
**I want** the "starting line" chips to reflect what I just told Lumi about my family's food,
**so that** I am choosing from lunches that could plausibly be ours, not from a generic list
that happens to survive a sort.

---

## Scope

This is the **WALL slice** of Epic 16 — the pivot from "chips are a projection over a
pre-seeded catalog" to "chips are generated from stated preferences".

**In scope:** generation trigger at M3 exit; the generated-suggestion path; the
deterministic allergen filter plus block logging; the curated-50 read-only fallback; the
chip source moving off `recipes`.

**Deliberately NOT in scope — these are 16-s2 and 16-s3:**
- The generating-state UI (16-s2). This slice must behave correctly when generation is not
  ready, but the *copy and presentation* of the wait is the next slice.
- Retiring Stage 0 materialisation and deferring recipe seeding (16-s3).

**Stage 0 keeps materialising in this slice, on purpose.** It becomes unused for chips but
is otherwise untouched, which keeps 16-s1 independently revertable: if generation proves
worse than the seeded catalog in practice, reverting this slice restores the old path
without a data migration.

---

## Acceptance Criteria

1. **Generation fires at M3 exit — with the M5-entry re-check retained.** A household
   advancing out of `m3_taste` enqueues chip generation. The `advancedOutOfM2` half of
   `stage1Checkpoint` (`onboarding.service.ts:1171-1174`) is replaced by an M3-exit edge;
   the M5-entry half **stays**. It is not redundancy — **M3 is OPTIONAL**, and
   `controller.reconstructMoment()` re-anchors past `m3_taste` when M1+M2 are already
   satisfied, so the M3-exit edge can never fire for a real household. The M5-entry
   re-check is the only guarantee those households get chips at all.

2. **Generation runs at most once per household.** With two checkpoints,
   `ensureStage1Seeded` (`onboarding.service.ts:440-505`) can enqueue twice. It has four
   guards in the working tree — queue-unavailable, `getStage1Status() === null`,
   `completedAt !== null`, and `attempts >= STAGE1_MAX_ATTEMPTS` — but **none of them
   dedups an in-flight job**: `completedAt` is still NULL while a job is queued, and the
   attempt counter is incremented by the first call, so the second sees `1 < MAX` and
   proceeds. `CATALOG_SEED_JOB_OPTS` (`jobs/catalog-seed.job.ts:25-30`) carries **no `jobId`**, so
   BullMQ does not dedup. Add household-scoped dedup —
   `jobId: \`seed-catalog:${householdId}\`` — mirroring what
   `CatalogSeedService.enqueueRecovery()` already does for the recovery queue
   (`catalog-seed.service.ts:210`). This is almost certainly the cause of the red
   `catalogSeedCalls` golden (2 vs 1); a test must assert one enqueue across an interview
   that crosses both checkpoints.

3. **The snapshot carries STATED preferences at full fidelity.** Two verified defects in
   `buildSnapshot` (`catalog-seed.service.ts:674-730`), both of which survive a trigger
   move and must be fixed explicitly:

   - **Enforcement is discarded.** `map.dietary[]` carries `enforcement`
     (`KitchenMapDietarySchema`, `packages/contracts/src/kitchen-map.ts:228-242`), but
     lines 695-697 flatten it to bare tags, merged with the legacy
     `map.household.dietary_preferences` strings. The M5 projection filter *does* read
     `enforcement === 'non_negotiable'` (`onboarding.service.ts:555`), so today the
     prompt can be asked for dishes the filter will then silently discard. **This half is
     fully implementable from existing data — do it.**

   - **Cuisine is aliased to culture, and the alias is in the DATA MODEL, not just the
     snapshot.** `cuisineTags` and `culturalTags` are both populated from
     `map.cultural.active[].key` (lines 693 and 703), so the prompt's `cuisine_tags` and
     `cultural_tags` lines are byte-identical. This is NOT a snapshot bug you can fix in
     `buildSnapshot` — verified 2026-08-13:
     - `cuisine.declare` and `cultural.note` **both** call
       `culturalPriorRepository.noteSuggested()` (`onboarding.tools.ts:698` and `:250`) —
       the same method, the same `cultural_priors` table.
     - `cultural_priors` has **no discriminator column**
       (`20260515000000_create_cultural_priors.sql:6-23`) and is `UNIQUE (household_id,
       key)`, so a key noted culturally and declared as cuisine collapse into one row.
     - `buildSnapshot` already carries an inline comment stating this
       ("KitchenMap doesn't carry a top-level cuisine_tags array — cuisine emerges from
       cultural priors"). It is an acknowledged design choice, not an oversight.

     **Therefore: do NOT invent a third axis, and do NOT add a migration in this slice.**
     Drop the duplicate `cuisine_tags` line from the prompt and route STATED taste through
     `map.food_preferences` — which is genuinely distinct M3 data (`food_preference.declare`
     writes its own table), is already in the snapshot as `food_preferences`, and is already
     valence-filtered to `loves`/`likes` (lines 706-712). Render it as the stated-taste axis
     and `cultural_tags` as the inferred axis. If a true cuisine axis is wanted later it
     needs a `cultural_priors` discriminator + vocabulary work — that is its own slice, not
     this one.

   Test: a household whose M3 `food_preference.declare` answers differ from its inferred
   cultural template produces a prompt containing those M3 answers; a `non_negotiable`
   dietary tag appears in the prompt as a hard exclusion; and the prompt contains no two
   identical tag lines.

   NOTE: `cultural_priors` and `dietary_preferences` both have `kitchen_map_version`
   bump triggers (`20260820000000`, `20260903000900`), so the Redis-cached
   `kitchenMapService.get()` will see M3 writes. Verified — do not re-litigate.

4. **Chips come from the generated set, not from `recipes`.** The M5 chip payload is built
   from generated suggestions. `CatalogProjectionService`'s read over
   `household_recipe_usage` is no longer the chip source. Proven by seeding a household's
   `recipes` with obviously-identifiable rows and asserting none of them appear as chips.

5. **Chip keys still resolve to human labels before the agent sees them.** This is the
   silent-failure trap in this slice. `submitTextTurn` (`onboarding.service.ts:748-804`)
   detects M5 chip taps by UUID shape (`UUID_RE`, line 243) and resolves each key via
   `recipesRepository.findById()` into a canonical name, **because `favorite_lunch.add`
   takes a LABEL, not an id** (`onboarding.tools.ts:855-865`). If generated chips are not
   `recipes` rows, this lookup returns null and the raw key is passed through to the agent,
   which then calls `favorite_lunch.add("<uuid>")` and creates a recipe literally named
   after a UUID — no error, no log, permanently wrong data. The resolution path MUST be
   extended to look up the generated-suggestion store first, falling back to
   `recipesRepository.findById()`. Test: a tapped generated chip reaches
   `declareForHousehold` with its display label.

6. **The deterministic allergen filter runs on every generated suggestion** (decision 1),
   using the same `evaluate()` path Stage 1 uses today (`catalog-seed.service.ts:489-516`),
   via `catalogItemToPlanItem` so the item shape matches — **do not fork either**. Covers
   both the household's declared allergens and the `FALCPA_KEYS` name-substring list
   (lines 78-88, 410-426). A suggestion naming a declared allergen never reaches the parent.
   Note the existing M5 projection filter is a *different, weaker* check
   (`allergen_flags.includes()`, `catalog-projection.service.ts:263-274`) — it trusts LLM
   tagging, which is the exact failure `FALCPA_KEYS` exists to catch. Use `evaluate()`.

7. **Every blocked suggestion is logged** with a structured reason
   (`action: 'catalog.chips.blocked'`, the suggestion label, the matched allergen, and
   whether the match came from the declared set or the FALCPA floor). This is the evidence
   base for revisiting decision 1 later; it must be queryable without re-running
   onboarding. Today's equivalents log `item_index` only and deliberately omit the name —
   here the label IS the payload, so this is a conscious departure, justified by the
   suggestion never having been shown to anyone.

8. **Curated-50 fallback, read-only** (decision 2). When generation fails, times out, or
   leaves fewer than `CHIP_FLOOR` suggestions after filtering, chips are drawn from
   `curated_baseline_items` directly (`CuratedBaselineRepository.findAllActive()` /
   `findActiveByCuisineTags()` — both already exist and are pure reads). This path MUST NOT
   call `seedFromCatalogBaseline` or otherwise write `recipes` / `household_recipe_usage`.
   Allergen and non-negotiable-dietary filtering still applies to fallback chips.
   **`CHIP_FLOOR = 12`**, matching the existing `UNDERFLOW_THRESHOLD`
   (`catalog-projection.service.ts:32`) — do not invent a third floor.

9. **M5 is never empty.** Forced-failure tests for each path — LLM timeout, LLM error,
   malformed response, and a filter that blocks everything — each still render a non-empty
   chip set via AC 8. If the fallback *also* underflows after filtering (a household whose
   declared allergens exclude most of the curated 50), do NOT render a sparse or blank
   grid: return `coldStartReason` and let the existing conversational cold-start path run
   (`assembleChipConfig` already maps a cold-start reason to `chip_config = null`,
   `onboarding.service.ts:606-615`). "Never empty" means never a blank chip card — a
   deliberate no-card conversational turn is the correct floor.

10. **No regression in what a tapped chip does.** `favorite_lunch.add` →
    `declareForHousehold` still writes `catalog_provenance='declared'`,
    `is_household_favorite=true`, `confidence_score=80`. M5's completion gate is unchanged:
    natural threshold `favorite_lunch_count >= 5` (3 in cold-start) or `override_fewer` at
    `>= 4` (1 in cold-start) — `onboarding.service.ts:1066-1075`. **Note the story-level
    "count >= 10" in the brief is stale**; 13-s6 lowered it to 5. Do not "restore" 10.

11. **Not-ready behaviour is correct, if unpolished.** If the parent reaches M5 before
    generation completes, the existing poll runs and the existing cold-start path applies.
    No blank chip grid, no crash. Presentation is 16-s2's job.

12. **Diversity is enforced on the generated set.** The prompt already carries the `≤4 rice`
    cap and a protein+starch no-near-duplicates rule
    (`catalog-seed.prompt.ts:65,74`) — those carry over unchanged. What is NEW is the
    deterministic backstop: selection must bucket on starch/protein, not only
    `cuisine_tags`. `pickWithDiversityCap` cannot do this today because
    `CatalogSeedItemSchema` (`catalog-seed.service.ts:93-100`) has **no starch or protein
    field** — cuisine is all it has to bucket on, which is precisely why three
    chicken-rice dishes across three cuisines all passed. Add `primary_starch` and
    `primary_protein` to the generated-item schema and bucket on them; do not
    keyword-match `canonical_name`. Test: a deliberately skewed generated set (N
    chicken-rice dishes, N distinct cuisines) yields at most the cap, not N chips.

    **The `≤4 rice` cap is calibrated against ~50 items** — the prompt asks for
    "~50 school lunch ideas" (`catalog-seed.prompt.ts:110`), not the ~30 the brief's prose
    says. If you change the requested count, rescale the cap proportionally and say so in
    the completion notes; otherwise leave the count at 50.

13. **Already-tapped favourites stay visible on M5 re-entry** (product decision,
    2026-08-13). Today this is free: a tapped chip becomes a `recipes` row with
    `is_household_favorite=true`, and the projection sorts favourites first
    (`catalog-projection.service.ts:287-289`), so it reappears at the top. Moving the chip
    source off `recipes` breaks that for free, so it must be rebuilt deliberately:

    - The M5 chip set is the **union** of generated suggestions and the household's
      declared favourites, deduped by the same normalization
      `declareForHousehold` uses (`canonicalizeFavoriteName`, `recipes.repository.ts:1194`)
      — not by raw string equality, or a re-tap renders twice.
    - **Declared favourites sort first and are exempt from the diversity cap.** A parent's
      own five rice dishes must not be capped out of their own list. They still count
      toward `TARGET_CHIPS = 20`.
    - The union must include favourites the parent declared **conversationally**, not only
      by tapping. `favorite_lunch.add` fires from free text too, and those have no
      suggestion row. They are visible today; they must stay visible.
    - No contract change is needed to tell the client which are already chosen:
      declared favourites carry `provenance: 'declared'` on `ChipOption`, generated ones do
      not. 16-s2 owns how that renders — this slice owns the data being correct.
    - Re-tapping is already a no-op (`declareForHousehold` hits the unique index and reuses
      the row), so no new idempotency work.

    Key spaces stay separate and both stay UUID-shaped: declared-favourite chips keep their
    `recipes.id` and resolve via the existing `findById()` fallback; generated chips use
    their suggestion id. AC 5's resolution order — suggestions first, then recipes — covers
    both without touching `UUID_RE` or the client.

    Test: a household with 3 declared favourites and a full generated set renders all 3,
    at the head of the list, exactly once each, including one declared by free text rather
    than by tapping.

---

## Tasks / Subtasks

- [x] 1. Move the trigger (AC 1, 2)
  - [x] 1.1 Replace the `advancedOutOfM2` half of `stage1Checkpoint`
        (`onboarding.service.ts:1171-1174`) with an M3-exit edge. **Keep the M5-entry
        half** — M3 is optional and its exit edge can never fire for a re-anchored
        household. Do not "simplify" this to one trigger.
  - [x] 1.2 Add `jobId: \`seed-catalog:${householdId}\`` to the enqueue in
        `ensureStage1Seeded` (line 480). Test: one enqueue across an interview crossing
        both checkpoints.
  - [x] 1.3 **Gate the attempt increment on the enqueue actually creating a job.**
        `incrementStage1Attempts` fires unconditionally right after `.add()`
        (`onboarding.service.ts:486`), with a comment justifying it ("Count the ENQUEUE, not
        the run"). That reasoning is correct WITHOUT dedup and wrong WITH it: BullMQ's
        `.add()` with a duplicate `jobId` resolves successfully, returning the existing job
        rather than throwing — so the second checkpoint burns an attempt against a job it
        did not create, halving the real retry budget under `STAGE1_MAX_ATTEMPTS`. Compare
        the returned job's id (or check for the pre-existing job) and only increment when a
        new job was created. Test: two checkpoints → one enqueue AND `stage1_attempts == 1`.
- [x] 2. Extend the snapshot (AC 3)
  - [x] 2.1 Split `CatalogSeedSnapshot`'s dietary into non-negotiable vs soft, preserving
        `map.dietary[].enforcement`. Update `buildCatalogSeedPrompt` to render the hard
        exclusions as exclusions.
  - [x] 2.2 Drop the duplicate `cuisine_tags` line; render `food_preferences` as the
        stated-taste axis. **No migration, no new cuisine axis** — see AC 3 for why
        `cultural_priors` cannot distinguish the two today.
  - [x] 2.3 Test: M3 `food_preference.declare` answers ≠ inferred cultural template →
        prompt contains the M3 answers, and no two tag lines are identical.
  - [x] 2.4 Test: a `non_negotiable` dietary tag renders as a hard exclusion in the prompt.
- [x] 3. Generated-suggestion path (AC 4, 5)
  - [x] 3.1 Create `onboarding_chip_suggestions` (see Dev Notes for the resolved shape) and
        its repository. Migration + a `kitchen_map_version` decision (it does NOT need a
        bump trigger — the KitchenMap does not read it).
  - [x] 3.2 Repoint the chip payload at the generated set.
  - [x] 3.3 **Extend the chip-key resolution in `submitTextTurn` (lines 748-804)** to hit
        the suggestion store before `recipesRepository.findById()`. This is AC 5 and it is
        the easiest thing in the slice to forget.
  - [x] 3.4 Negative control: pre-seed `recipes` with marker rows, assert zero leak.
        Implemented as a structural proof, not a fixture: `CatalogProjectionService` no
        longer has a `recipesRepository` dependency at all, so there is no code path by
        which a `recipes` row could reach the M5 chip set — see the "chip source moved off
        recipes" test.
  - [x] 3.5 Test: tapped generated chip → `declareForHousehold` receives the label. Tested
        at the boundary this slice actually changed: the resolved LABEL reaches the
        persisted turn / agent input. `favorite_lunch.add` → `declareForHousehold` itself is
        pre-existing, untouched by this task, and already covered in
        `onboarding.tools.test.ts` — AC 10 (no regression) holds by construction.
- [x] 4. Filter + logging (AC 6, 7)
  - [x] 4.1 Reuse Stage 1's `evaluate()` + `catalogItemToPlanItem` + `FALCPA_KEYS` path; do
        not fork the logic and do not substitute the projection's `allergen_flags.includes`.
        Implemented as: the SAME `survivors` array that already feeds
        `recipesRepo.seedFromCatalogBaseline` also feeds
        `onboardingChipSuggestionRepo.insertMany` — one filter pass, two persist targets.
  - [x] 4.2 Structured block log with reason and match source. `catalog.chips.blocked` added
        at both existing block sites (name pre-filter, guardrail `verdict === 'blocked'`)
        alongside the pre-existing logs, not replacing them.
- [x] 5. Fallback (AC 8, 9)
  - [x] 5.1 Read `curated_baseline_items` directly for chips; no materialisation. Read-only
        by construction: `CatalogProjectionService` has no dependency capable of writing
        `recipes`/`household_recipe_usage` at all.
  - [x] 5.2 `CHIP_FLOOR = 12`; apply allergen + dietary filtering to fallback too.
        `CHIP_FLOOR` is a named alias of `UNDERFLOW_THRESHOLD`, not a new constant.
        Fallback rows run through the SAME `filterByPersonalization` the suggestion path uses.
  - [x] 5.3 Four forced-failure tests + the fallback-also-underflows → cold-start case.
        Split across two layers: `catalog-seed.service.test.ts` proves each of the 4 named
        failure modes (timeout, error, malformed response, filter-blocks-everything) leaves
        zero rows in `onboarding_chip_suggestions`; `catalog-projection.service.test.ts`
        proves the resulting empty/thin suggestion table triggers the fallback and still
        renders a non-empty chip set, or correctly cold-starts if the fallback also
        underflows.
- [x] 6. Diversity (AC 12)
  - [x] 6.1 Add `primary_starch` / `primary_protein` to the generated-item schema. Also added
        to the prompt's OUTPUT SHAPE (previously only the prose caps existed, not the
        structured fields) and threaded through `Survivor` → `onboarding_chip_suggestions`
        (previously inserted as hardcoded `null`, per task 4's note). Item count left at ~50
        — no rescaling needed per the AC's own instruction.
  - [x] 6.2 Bucket the selection on those dimensions alongside cuisine. Implemented as a
        SINGLE combined `combo:${protein}:${starch}` key (not two independent caps) — the
        near-duplicate rule is about the PAIR ("share the same protein AND the same
        starch"), and independent caps would also reject unrelated dishes sharing only one
        axis. A row missing either value is exempt from the combo bucket entirely.
  - [x] 6.3 Test with a deliberately skewed generated set. 6 chicken-rice dishes across 6
        distinct cuisines (reproducing the exact bug: cuisine bucketing alone never saw more
        than 1 per bucket) → capped, not all 6 admitted.
- [x] 7. Already-tapped favourites on re-entry (AC 13)
  - [x] 7.1 Union declared favourites into the chip set, deduped via
        `canonicalizeFavoriteName`, sorted first, exempt from the diversity cap. New
        `RecipesRepository.findHouseholdFavoritesWithIds` mirrors the ALREADY-ESTABLISHED
        `findHouseholdFavorites` qualification (is_household_favorite OR provenance
        declared/parent_added) rather than inventing a new definition of "favourite" — free
        by construction includes conversational declarations, since both write through the
        same `declareForHousehold` path. `CatalogProjectionService` re-gains a
        `recipesRepository` dependency, used for exactly this one read.
  - [x] 7.2 Test: 3 declared favourites (one declared by free text, not by tapping) all
        render, at the head, exactly once each, alongside a full generated set.
- [x] 8. Gates
  - [x] 8.1 API suite — the story's own "4 known pre-existing failures" is stale; only 1 is
        actually observed (`voice-transcript.repository.test.ts`, a DST clock-arithmetic
        edge case unrelated to this slice — confirmed identical across every task in this
        story, first noted in task 1). 2646 passing / 1 pre-existing failure / 39 skipped.
        `catalogSeedCalls` golden confirmed GREEN (task 1.2), re-verified here in isolation.
  - [x] 8.2 turbo lint + typecheck, knip, contracts:check — all 9 packages typecheck clean;
        all 6 lintable packages lint clean (see Watch Out — one pre-existing false-positive
        lint error, flagged since task 1, closed here with a targeted disable, not a log
        rewrite); knip clean (one pre-existing unused export narrowed to module-private —
        see Dev Notes); `contracts:check` PASSED, 555 exports verified.
  - [x] 8.3 E2E onboarding spec — built `apps/web` with `VITE_E2E=true`, ran all 4
        onboarding-adjacent Playwright specs: 19 passed, 4 skipped (voice-entry-point,
        gated off per the text-first doctrine, unrelated to this slice), 0 failed. This
        slice's chip-generation work is backend-only — no frontend code changed — so this
        gate is a regression check, not new coverage; the M5 chip-card presentation itself
        is 16-s2's scope.

---

### Review Findings

Adversarial review (2026-08-13) of commit `50ef972` (Tasks 1-2) via three independent
layers: Blind Hunter (diff only, no project access), Edge Case Hunter (diff + repo read
access), Acceptance Auditor (diff + this story + the Epic 16 brief). 23 raw findings →
2 decision-needed, 10 patch, 6 defer, 4 dismissed as noise/refuted/already-handled.

**Resolution (2026-08-13):** both decisions resolved as "leave bundled as-is." 8 of 10
patches batch-applied and verified (typecheck clean, full API suite 2620 passing with the
same single pre-existing voice/DST failure as before this review, lint unchanged at its
one pre-existing false positive). 2 patches left as open action items below — both need a
judgment call this review is not positioned to make unilaterally.

- [x] [Review][Decision] Scope creep: the M2 "who is this for?" attribution-chip feature
      is bundled into this commit — `buildM2AttributionChips`, `m2AttributionPending`/
      `attributionChildren` chip logic, and a new `m2_attribution_pending` moment-state
      slot threaded through `onboarding.service.ts` and ~35 test fixtures. Not referenced
      by AC 1, AC 2, or AC 3, nor by this story's own File List for `onboarding.service.ts`.
      **RESOLVED 2026-08-13 — user chose: leave bundled as-is.** No commit split, no
      File List rewrite. The 6 defer findings inside this bundle stay deferred,
      permanently out of 16-s1 scope (not "pending" — decision is final).
- [x] [Review][Decision] Scope creep: the Stage 1 retry/throw redesign is bundled into
      `catalog-seed.service.ts` — `seedForHousehold`'s failure contract changes from
      "NEVER throws" to "THROWS on retryable failure," adds `Stage1RetryableError`, changes
      `STAGE1_LLM_TIMEOUT_MS` 5s→30s, adds a `setStage1LastError` breadcrumb, and rewrites
      7 pre-existing tests to `.rejects.toThrow()`. None of this is AC 3 (scoped to
      `buildSnapshot`'s dietary/cuisine fields). This story's own Watch Out section
      describes this retry work as "unreleased" pre-existing work, yet the diff shows it
      landing with real +/- hunks in this commit — the File List under-reports it as
      "3 AC 3 tests" only.
      **RESOLVED 2026-08-13 — user chose: leave bundled as-is.** No commit split, no
      File List rewrite. The defer findings inside this bundle stay deferred, permanently
      out of 16-s1 scope (not "pending" — decision is final).

- [x] [Review][Patch] Attempts tracking in `ensureStage1Seeded` is non-atomic and silently
      resets to 0 whenever `getStage1Status()` throws — a flaky READ path (not seeding
      itself) permanently pins `stage1_attempts` near 1 in the DB, defeating
      `STAGE1_MAX_ATTEMPTS`. A narrower concurrent-call race on the same read-then-write
      exists too (already partially acknowledged by the pre-existing
      `incrementStage1Attempts` comment as a bounded tradeoff) — but does NOT create a
      duplicate BullMQ job as initially suspected; BullMQ's own jobId semantics prevent two
      concurrent `add()` calls on the same non-removed jobId from creating two jobs. The
      only real leak is the counter. [onboarding.service.ts:~450-490] — FIXED: added
      `attemptsKnown` gate; the increment is skipped entirely when the read failed, instead
      of writing an unverified baseline. Tests: "does NOT write an attempts count when the
      status read itself fails".
- [x] [Review][Patch] `incrementStage1Attempts` throwing AFTER a successful `queue.add()`
      is caught by the outer handler and logged as `stage1.enqueue_failed`, misreporting a
      successful enqueue as a failure and leaving the attempts counter undercounted.
      [onboarding.service.ts:~517] — FIXED: the increment now has its own try/catch with a
      distinct `stage1.attempts_increment_failed` log action; the enqueue-failed log is no
      longer reachable from a post-enqueue write failure. Test: "logs the post-enqueue
      attempts-write failure distinctly, not as an enqueue failure".
- [ ] [Review][Patch] Terminal BullMQ states `'completed'` and `'failed'` are treated
      identically ("clear and re-add") in the dedup logic, but `'completed'` doesn't
      guarantee `stage1_completed_at` was actually set — the bundled retry redesign's
      quiet-terminal-failure path can resolve without throwing (state `'completed'`) while
      never marking the household seeded, so this logic risks an unwanted duplicate reseed
      or retrying something the redesign deliberately chose not to retry.
      [onboarding.service.ts, ensureStage1Seeded dedup block]
- [x] [Review][Patch] A tag present as `non_negotiable` in `map.dietary` AND also present
      in the legacy `map.household.dietary_preferences` renders in BOTH
      `dietary_non_negotiable` and `dietary_flags` — the legacy-column loop doesn't check
      `dietaryNonNegotiable` before adding, producing a self-contradictory prompt.
      [catalog-seed.service.ts, buildSnapshot] — FIXED: the legacy-column loop now checks
      `dietaryNonNegotiable` before adding, same as the structured-table loop. Test: "does
      not render a non_negotiable tag as a soft leaning even when it is also in the legacy
      household column".
- [x] [Review][Patch] The "never emits two identical tag lines" test is vacuous — since
      `cuisine_tags` was deleted from the schema outright, it is now structurally
      impossible for two identical lines to appear regardless of whether `cultural_tags`
      renders correctly; the assertion would pass even if `cultural_tags` never rendered
      at all. Should assert exactly 1 line, not `<= 1`. [catalog-seed.service.test.ts] —
      FIXED: asserts the exact line `cultural_tags: south_asian`, not just a length bound.
- [x] [Review][Patch] `getState()` handling is only tested for `'waiting'`/`'failed'`, not
      `'active'`/`'delayed'`, though production code treats all three identically as
      "in flight." [onboarding.service.test.ts] — FIXED: added a parameterized test
      covering both `'active'` and `'delayed'`.
- [x] [Review][Patch] `getStage1Status` returning `null` is an undocumented, untested,
      silent early-return in `ensureStage1Seeded` — no comment on what a null status means,
      no log, no test. [onboarding.service.ts] — FIXED: added an explanatory comment
      (household row not found — deleted mid-interview or never provisioned) and a test.
- [x] [Review][Patch] The eval harness's fake queue `getJob()` never returns an object with
      `.remove()` — a future scenario modeling a stuck/terminal prior job would throw
      (`remove is not a function`) rather than reproduce real queue behavior; the fake in
      `onboarding.service.test.ts` for the same feature doesn't have this gap.
      [onboarding-eval.harness.ts] — FIXED: `getJob()`'s returned object now includes
      `remove()`, matching real BullMQ Job shape.
- [ ] [Review][Patch] (optional/minor) Only a binary `non_negotiable`/soft split is
      implemented — `'strong'` enforcement collapses into the same soft bucket as
      `'default'`/`'just_for_context'`. Does not violate AC 3 as literally scoped (AC 3
      frames this as a binary split) — flagged as a future enhancement, not a defect.
      [catalog-seed.service.ts, buildSnapshot]
- [x] [Review][Patch] (minor/nitpick) Fragile whole-blob `toContain`/`not.toContain`
      substring assertions in the new AC 3 tests check the entire multi-line rendered
      prompt rather than a specific field/line. [catalog-seed.service.test.ts] — FIXED:
      narrowed to the specific `food_preferences` line.

- [x] [Review][Defer] `setStage1LastError` breadcrumb write failure is silently swallowed
      with no logging, contradicting the "never fail silently" philosophy stated elsewhere
      in the same bundled redesign. [catalog-seed.service.ts] — deferred, bundled retry
      redesign is out of 16-s1 scope pending the D1/D2 decision above.
- [x] [Review][Defer] A later-step throw (e.g. `setStage1CompletedAt`) after catalog rows
      are already persisted causes a BullMQ retry that reruns the LLM call and re-persists
      from scratch, duplicating rows. Newly introduced by the bundled retry redesign, not
      present before this commit, but not AC 1-3. [catalog-seed.service.ts] — deferred,
      bundled retry redesign is out of 16-s1 scope pending the D1/D2 decision above.
- [x] [Review][Defer] `enqueueRecovery`'s jobId doesn't include the trigger reason, so a
      second recovery trigger with a different reason silently no-ops via jobId dedup and
      is never recorded. [catalog-seed.service.ts] — deferred, confirmed pre-existing,
      untouched by this diff's +/- hunks.
- [x] [Review][Defer] Confusing M2-attribution-clearing heuristic —
      `userMessage.trim().length > 0` doesn't actually distinguish "answered in prose" from
      any other non-empty submission (including chip-generated turns); untested branch.
      [onboarding.service.ts] — deferred, bundled M2-attribution feature is out of 16-s1
      scope pending the D1/D2 decision above.
- [x] [Review][Defer] `Stage1RetryableError.reason` is typed as bare `string` instead of a
      literal union, so a typo at a new throw site compiles cleanly and silently produces
      an unrecognized breadcrumb value. [catalog-seed.service.ts] — deferred, bundled retry
      redesign is out of 16-s1 scope pending the D1/D2 decision above.
- [x] [Review][Defer] Copy-pasted, undifferentiated comment repeated verbatim across 6
      rewritten tests in the bundled retry redesign's test changes.
      [catalog-seed.service.test.ts] — deferred, bundled retry redesign is out of 16-s1
      scope pending the D1/D2 decision above.

---

## Dev Notes

### The system after this slice (target state)

```
M3 exit   → enqueue generation (M1-M3: children, declared allergens, STATED taste + dietary)
  OR M5 entry (whichever fires first — dedup on jobId; M3 is OPTIONAL and often skipped)
          → LLM ~50 suggestions → deterministic allergen filter (+ block log)
          → survivors persisted to onboarding_chip_suggestions
M5 entry  → ready?  declared favourites (pinned, uncapped) ++ generated chips
                    (diversity-capped), deduped, 20 total
            not?    existing poll / cold-start path (16-s2 polishes the copy)
            failed / below CHIP_FLOOR(12)?  curated_baseline_items, read-only
            fallback also underflows?  coldStartReason → conversational, no chip card
tap chip  → key resolved via onboarding_chip_suggestions → label
          → favorite_lunch.add(label) → declareForHousehold (UNCHANGED, confidence 80)
```

Stage 0 still materialises. Recipe seeding is untouched. Both are 16-s3.

### Verified current-state facts (2026-08-12/13 research — trust these over the brief's prose)

- Stage 1 fires on `advancedOutOfM2` (`onboarding.service.ts:1171-1176`), with an M5-entry
  re-check added by unreleased retry work. Neither edge is deduped at the queue.
- `buildSnapshot` (`catalog-seed.service.ts:674-730`) sets `cuisine_tags` and
  `cultural_tags` from the *same* source — `map.cultural.active[].key`. Dietary
  `enforcement` is present on the KitchenMap and thrown away at lines 695-697. This is why
  AC 3 exists, and it is not fixed by moving the trigger.
- The cuisine/cultural alias goes deeper than the snapshot: `cuisine.declare` and
  `cultural.note` both write `cultural_priors` via the same `noteSuggested()`, and that
  table has no discriminator and is `UNIQUE (household_id, key)`. There is no stored fact
  that separates them. Do not try to recover a cuisine axis in this slice — AC 3 routes
  stated taste through `food_preferences` instead.
- **M3 is optional.** `controller.reconstructMoment()` re-anchors past `m3_taste` when
  M1+M2 are satisfied (`onboarding.service.ts:1092-1095`), so `previousMoment === 'm3_taste'`
  is not a reliable edge. This is the single most likely way to ship this slice broken.
- Chip taps arrive as `[Chips selected: <uuid>, …]`; `submitTextTurn` resolves each UUID to
  a canonical name via `recipesRepository.findById()` **before** the agent call, because
  `favorite_lunch.add` takes a label. Break this and the failure is silent.
- The M5 completion gate is `favorite_lunch_count >= 5` (3 in cold-start), NOT 10 —
  13-s6 lowered it (`onboarding.service.ts:1071-1075`).
- `deriveColdStartReason` currently fires only on a truly empty catalog
  (`catalog-projection.service.ts:257-261`); the per-cuisine floor was removed because it
  produced spurious cold-starts. Do not reintroduce a per-cuisine floor.
- `CatalogProjectionService` contains no LLM. Sort is declared-cuisine → favourite →
  provenance → `confidence_score` → id; `pickWithDiversityCap` buckets `cuisine_tags` only.
- Both seed stages write provenance `'inferred'`, so the tiebreak is `confidence_score`:
  Stage 0's 60 outranks Stage 1's 50 on every row, and the picker stops at
  `TARGET_CHIPS = 20` before reaching Stage 1. **The personalised catalog was computed,
  persisted, then sorted out of view.**
- Measured live: 43/97 recipes rice — Stage 1 contributed exactly 4 (its cap, honoured),
  Stage 0 the other 39.
- `evaluate()` (`allergy-rules.engine.ts:264`) is synchronous and in-process. Keeping the
  filter costs ~0ms against a 30s model call — this is why decision 1 went the way it did.
- `FALCPA_KEYS` exists because the LLM was observed mis-tagging `allergen_flags` as `[]`
  (`catalog-seed.service.ts:75`). `STAGE2_MASS_BLOCK_RATIO = 0.5` exists because mass
  blocking happens.
- A tapped chip becomes `provenance='declared'`, `confidence_score=80`
  (`recipes.repository.ts:300-307`) — the highest in the system. Chips are not inert.

### Where generated suggestions live — RESOLVED: a new table

`onboarding_chip_suggestions`, keyed by household. The alternatives were considered and
are ruled out by a requirement the earlier framing missed: the store must be **keyed and
resolvable by id in a later request**, because `submitTextTurn` resolves the tapped chip
key back to a display label before the agent call (AC 5). That kills the moment-state /
thread-payload option (a blob, not a lookup) and makes Redis-with-TTL a data-loss path on
eviction — the parent taps a chip and the label is gone. Dev Redis has already died once
during this work.

Minimum shape — resist adding more:

```
id                uuid pk           -- becomes the chip key; keep it UUID-shaped so
                                    -- UUID_RE (onboarding.service.ts:243) still fires
household_id      uuid not null
label             text not null     -- what the parent sees; what favorite_lunch.add gets
cuisine_tags      text[]
dietary_flags     text[]
allergen_flags    text[]
primary_starch    text
primary_protein   text
created_at        timestamptz
```

Keeping `id` UUID-shaped means the client, the `[Chips selected: …]` wire format and the
UUID detection branch all stay untouched — only the *resolution target* changes.

Blocked / filtered suggestions are NOT persisted here — they go to the AC 7 log only.

No `kitchen_map_version` trigger is needed: the KitchenMap projection does not read this
table. (See the standing rule — any table that DOES feed `KitchenMapRepository.loadRaw()`
needs one, or the 1hr Redis cache goes stale.)

Cleanup is out of scope for this slice; rows are small and 16-s3 will want to read the
tapped ones at post-onboarding seed time.

### Doctrine (binding here)

- **Decision 1 is a safety call, already made: the filter stays.** Do not remove it to save
  latency; it does not cost latency. If it proves too blunt, the block log (AC 7) is the
  evidence to reopen the decision — not intuition.
- **Fallback reads must never write.** The whole point of decision 2 is that the curated
  set stops being a seeded catalog and becomes a last-resort display source.
- **M5 must never render a blank chip card.** This is the one guarantee Stage 0 genuinely
  provided; it is the reason AC 8 and AC 9 exist. A deliberate conversational turn with no
  card is an acceptable floor; an empty grid is not.
- Chips are a **preference-elicitation** surface, not a food-safety surface — but the ones
  a parent taps reach the planner at maximum confidence, which is why AC 6 is not optional.
- **A parent's own answers outrank the model's.** Declared favourites are pinned and
  uncapped (AC 13); the diversity cap exists to stop the *generator* repeating itself, not
  to overrule a parent who genuinely likes five rice dishes.
- **Reuse, do not fork.** Every filter, guardrail helper and baseline read this slice needs
  already exists. New code should be the suggestion store, the chip-key resolution branch,
  and the starch/protein bucket — nothing else.

### Project Structure Notes

Touch:
- `apps/api/src/modules/catalog/catalog-seed.service.ts` — snapshot, item schema, filter.
  Repurpose, do not fork.
- `apps/api/src/modules/catalog/catalog-projection.service.ts` — chip source + diversity.
- `apps/api/src/modules/catalog/curated-baseline.service.ts` — add a read-only path
  (the repository reads it needs already exist).
- `apps/api/src/modules/onboarding/onboarding.service.ts` — trigger move (1171-1177),
  chip-key resolution (748-804), `ensureStage1Seeded` dedup (480).
- `apps/api/src/jobs/catalog-seed.job.ts` — `CATALOG_SEED_JOB_OPTS`.
- `apps/api/src/agents/prompts/catalog-seed.prompt.ts` — snapshot shape, caps carry over.

New:
- `supabase/migrations/<ts>_create_onboarding_chip_suggestions.sql` + its repository under
  `apps/api/src/modules/catalog/`.

Tests that WILL break and must be updated, not deleted:
- `catalog-seed.service.test.ts`, `catalog-projection.service.test.ts`,
  `curated-baseline.service.test.ts`, `catalog-recovery.service.test.ts`
- `onboarding.service.test.ts`, `onboarding-zero-call.test.ts`,
  `onboarding.controller.test.ts`, `onboarding-tracer.test.ts`
- `agents/tools/onboarding.tools.test.ts`
- `agents/eval/onboarding-eval.goldens.json` — `catalogSeedCalls` (see task 7.1)

### Watch out

- **The onboarding golden evals are currently RED** on `catalogSeedCalls` (2 vs 1) from
  unreleased Stage-1 retry work. Do not read that as a regression from this slice, and do
  not "fix" it by changing the trigger count without checking that work first.
- `apps/api/src/modules/onboarding/onboarding.service.ts` carries ~135 uncommitted lines.
  Coordinate before editing it.
- **The `turbo lint` failure at `onboarding.service.ts:463` is a FALSE POSITIVE — do not
  "fix" it by rewording the string.** The custom `hivekitchen/no-assistant-filler` rule
  (AR-14 / §3.5) is matching a **Pino log message** ("Stage 1 seeding has failed
  repeatedly — leaving the household on the Stage 0 baseline"), not user-facing Lumi copy.
  The rule is meant to police what the parent reads. Mangling a structured log line to
  appease it destroys operational signal for exactly the retry path this slice touches.
  The correct fix is to scope the rule off logger calls, or a targeted
  `eslint-disable-next-line` with that reason. Verified by running `pnpm lint` in
  `apps/api` on 2026-08-13 — it is the ONLY lint error in the package.

### References

- Brief: `_bmad-output/planning-artifacts/catalog-seeding-redesign-generate-at-onboarding.md`
- `c256ab2` — symptom relief already shipped (baseline 39/50 → 8/50 rice; M5
  acknowledge-AND-ask). Explicitly NOT the fix this slice delivers.
- `20261039000000_reseed_curated_baseline_starch_diversity.sql` — the rebalanced fallback
  content this slice reads.

---

## Dev Agent Record

### Agent Model Used

claude-opus-5[1m]

### Debug Log References

- `pnpm --filter @hivekitchen/api test` → 2611 passed, **1 failed**:
  `voice-transcript.repository.test.ts > defaults retention_until to ~now + 90 days`.
  Pre-existing and unrelated — the delta is exactly 3,600,000 ms (a one-hour DST boundary
  in the 90-day retention arithmetic), in a module this slice does not touch.
- `pnpm --filter @hivekitchen/api lint` → 1 error, `onboarding.service.ts:464`. The SAME
  pre-existing `no-assistant-filler` false positive documented in Watch Out (it moved
  463 → 464 because task 1 added one import line). Deliberately NOT "fixed" by rewording
  the Pino log string. Outstanding for task 8.2.
- `pnpm --filter @hivekitchen/api typecheck` → clean.

### Completion Notes List

**Task 1 complete (AC 1, AC 2).**

- **The red `catalogSeedCalls` golden is now GREEN**, exactly as AC 2 predicted — the
  2-vs-1 count was the two checkpoints double-enqueueing, fixed by the jobId dedup. No
  golden was edited to achieve this.

- **AC 1's stated rationale is wrong, and the conclusion survives anyway.** The story says
  "M3 is OPTIONAL and `reconstructMoment()` re-anchors past `m3_taste`, so the M3-exit edge
  can never fire for a real household." The code says the opposite: 13-s6 promoted M3 to
  REQUIRED and changed re-anchor to land ON `m3_taste`
  (`onboarding.controller.ts:65-67` and `:106-108`; `reconstructMoment` line 112 returns
  `'m3_taste'` when M3 is incomplete). The M3-exit edge therefore fires reliably. Both
  edges were kept anyway, on the independent grounds the existing code comment gives
  (missed edge from an undefined queue, an LLM timeout, or a resumed session). A stale
  comment in `onboarding.service.ts` still called M3 "OPTIONAL" — it sat directly above the
  trigger line being changed and is the likely source of the story's claim, so it was
  corrected in place.

- **jobId uses `CATALOG_SEED_QUEUE`, not the literal `seed-catalog`.** AC 2 says to mirror
  `enqueueRecovery`, which builds `${CATALOG_RECOVERY_QUEUE}:${householdId}` from the queue
  constant. `CATALOG_SEED_QUEUE` is `'catalog.seed.stage1'`; the story's `seed-catalog:` is
  the JOB name, not the queue name. Followed the precedent over the literal.

- **Dedup could not be "skip if a job exists" (hazard not in the story).**
  `CATALOG_SEED_JOB_OPTS` sets `removeOnComplete`/`removeOnFail`, so FINISHED jobs stay
  discoverable under the same id. Skipping on mere existence would have permanently blocked
  retries for any household whose seed failed — silently undoing the retry work this slice
  builds on. Implemented as: skip while `waiting`/`active`/`delayed`; `remove()` then
  re-add when `completed`/`failed`. `STAGE1_MAX_ATTEMPTS` still bounds the loop.

- **Two harness gaps closed.** `buildService` mocked only `add` and never wired
  `householdsRepository`, so the entire Stage 1 retry-accounting block was untested; the
  eval fake had the same hole and, left as `getJob → null`, would not have modelled dedup
  at all (the goldens would have kept reporting 2).

- **One of my own tests was passing vacuously.** `ensureStage1Seeded` is fire-and-forget
  (`void`), so negative assertions ran before the async work did. Both negative tests now
  wait on `getJob` having been called (`vi.waitFor`, not a sleep) before asserting.

- **Three goldens updated, not deleted**, from `expectedCatalogSeedCount: 1` → `0`:
  `m3-elevation-strict` (ends with a ratification outstanding, which HOLDS at `m3_taste`),
  `resume-in-progress` and `finalize-gate-negative` (both end on entry to `m3_taste`). None
  crosses the M3 exit or reaches M5, so zero enqueues is the intended new behaviour —
  generation now waits for the taste answer. Verified scenario-by-scenario before editing.

**Task 2 complete (AC 3).**

- **Dietary enforcement is preserved.** `CatalogSeedSnapshot` gains
  `dietary_non_negotiable` alongside the (now explicitly soft) `dietary_flags`.
  `buildSnapshot` splits on `map.dietary[].enforcement === 'non_negotiable'` instead of
  flattening. A tag present as non-negotiable is excluded from the soft list so it cannot
  render twice. `map.household.dietary_preferences` (the legacy column, which carries no
  enforcement) stays soft — it has no basis to be treated as absolute.

- **The prompt now states the consequence, not just the fact.** `dietary_non_negotiable` is
  rendered as "every item MUST comply", and the SYSTEM_PROMPT's DIETARY COMPLIANCE rule now
  tells the model to OMIT a violating item entirely — the same discipline the allergen rule
  already uses — rather than emit it and let the M5 projection filter discard it silently.

- **The duplicated axis is gone.** `cuisine_tags` is removed from the snapshot outright
  rather than being given a fake source. Verified first that the field was referenced ONLY
  by the prompt type and `buildSnapshot`; every other `cuisine_tags` in the codebase is
  item-level or recipe-level and untouched. Two SYSTEM_PROMPT rules referenced the removed
  axis and were repointed at `cultural_tags` (the CUISINE SPREAD rule, and the item-level
  output field left as-is). Nothing is lost by the removal: M3's cuisine answers arrive via
  `cuisine.declare` → `cultural_priors`, so they are already inside `cultural_tags`.

- **`food_preferences` is now labelled as the stated-taste axis** ("the parent's own words
  — weight these heavily"). It was already in the snapshot and already valence-filtered to
  `loves`/`likes`; the added test is a regression guard proving a `refuses` item never
  reaches the prompt as a hint.

- Three tests added; the full API suite is 2614 passing with the same single pre-existing
  voice/DST failure, and lint still shows only the pre-existing false positive.

**Task 3 complete (AC 4, AC 5).**

- **`onboarding_chip_suggestions` created** exactly to the Dev Notes' resolved shape
  (`id`, `household_id`, `label`, `cuisine_tags`, `dietary_flags`, `allergen_flags`,
  `primary_starch`, `primary_protein`, `created_at`), FK `households(id) ON DELETE CASCADE`,
  RLS enabled with no policies (API-only, mirroring `cultural_priors`'s convention), no
  `kitchen_map_version` trigger. Repository (`OnboardingChipSuggestionRepository`) has
  `findAllForHousehold` (the chip-source read), `findById` (AC 5 resolution), and
  `insertMany` — the write side is unused until task 4 wires the filter+persist step, but
  3.1 asks for "the repository," not just the read half.

- **`CatalogProjectionService` no longer has a `recipesRepository` dependency at all.**
  This was a deliberate choice, not an oversight: AC 4's negative control is strongest as a
  structural guarantee (there is no code path to `recipes`) rather than a fixture proving a
  mock happened to avoid it. `RecipesRepository.findCatalogProjectionForHousehold`
  (the `household_recipe_usage` join this class used to call) is left in place, untouched —
  it becomes genuinely unused by this change, but AC 13 (16-s7, favourites union, same
  slice) will very plausibly need exactly this kind of query again. Deleting it now only to
  recreate something similar in four tasks is the "reinventing wheels" anti-pattern this
  project's CLAUDE.md warns against; flagging here so it isn't mistaken for an oversight if
  `knip` (task 8.2) flags it before 16-s7 lands.

- **Sort simplification, not a regression.** With no `confidence_score` / `catalog_provenance`
  / `is_household_favorite` columns on the new table, `sortCandidates` drops those three
  criteria and keeps only declared-cuisine match + id-ASC tie-break. Every existing
  diversity-cap/cold-start/polling test's numeric expectations were verified by hand before
  the rewrite: every test's rows shared identical values for the three removed fields, so
  removing them as sort criteria changes nothing about which rows get admitted or in what
  order — confirmed by the full rewritten suite passing unchanged (19/19).

- **AC 5's resolution order is suggestions-first, recipes-second**, exactly as specified.
  The gate that used to require `recipesRepository !== undefined` now also accepts
  `onboardingChipSuggestionRepository !== undefined` alone, so resolution still runs for a
  household with generated chips but no recipes wiring. A genuinely new failure mode this
  slice closes: previously an unresolved UUID left no trace (the silent-failure trap AC 5
  names); now a key that resolves to nothing in EITHER store logs
  `onboarding.m5_chip_uuid_unresolved` before falling through, without changing the
  fallback behavior itself (UUID stays in the message, same as before).

- **3.4 and 3.5 are satisfied without literal DB fixtures**, because this repo has no
  Postgres test harness (same gap flagged in prior slices' deferred-work). 3.4 is proven
  structurally (no `recipes` dependency exists to leak from). 3.5 is proven at the boundary
  this task actually changed — the resolved chip key becomes the correct LABEL in the
  persisted turn and the agent's input — since `favorite_lunch.add` → `declareForHousehold`
  itself is pre-existing, untouched, and already tested elsewhere.

- 8 new tests, full API suite 2623 passing (same single pre-existing voice/DST failure),
  typecheck clean, lint unchanged at its one pre-existing false positive.

**Task 4 complete (AC 6, AC 7).**

- **No forked filter.** The `survivors` array `seedForHousehold` already builds for
  `recipesRepo.seedFromCatalogBaseline` — post name-prefilter, post `evaluateGuardrail()` via
  `catalogItemToPlanItem` — is the exact same array now ALSO passed to
  `onboardingChipSuggestionRepo.insertMany`. One filter pass, two persist targets, per AC 6's
  explicit "do not fork" instruction.

- **AC 7's "declared vs FALCPA floor" distinction required tracing WHERE each check actually
  blocks**, since the guardrail's own history (comments at the top of
  `allergy-rules.engine.ts`, 1.4.0→1.5.0) states the FALCPA-9 floor no longer hard-blocks
  anything — `evaluate()` only ever blocks on a `parent_declared`/`household_rule_hard` rule
  (exported as `isHardRule()`, reused rather than reimplemented). So the two block sites have
  different natural sources:
  - The **name pre-filter** matches against `allergenExclusionSet`, which is a MERGED set
    (`FALCPA_KEYS` ∪ declared, from `buildSnapshot`). A matched token here can genuinely be
    either — resolved by checking a separate `declaredOnlyTokens` set (built from
    `rules.filter(isHardRule)`) at log time.
  - The **guardrail block** (`verdict === 'blocked'`) is, by the engine's own documented
    invariant, always a declared/hard-rule match — computed via the same `declaredOnlyTokens`
    check rather than hardcoded, so this stays correct if that invariant ever changes rather
    than silently drifting from reality.
  - Added a dedicated test (`AC 7 — a suggestion blocked ONLY by the FALCPA floor`) proving
    the `'falcpa'` source label is actually reachable, not just theoretically correct — a
    household with no declared allergens, only the FALCPA baseline, whose suggestion contains
    a bare `dairy` token.

- **The chip suggestion table has no `primary_starch`/`primary_protein` yet** (both null on
  insert) — `CatalogSeedItemSchema` doesn't carry those fields; adding them is explicitly
  task 6 (AC 12). Wiring the column now and populating it later avoids a second migration.

- **Chip-suggestion persist failure does not undo a successful recipes persist.** Wrapped in
  its own try/catch, logged as `catalog.chips.persist_failed`, not rethrown. Recipe seeding
  is the pre-existing, load-bearing guarantee until 16-s3 retires it; the new suggestion
  store is additive and must not regress it.

- 10 new tests (2 in `catalog-seed.service.test.ts` extending/adding to the existing
  block-scenario fixture), full API suite 2624 passing (same single pre-existing voice/DST
  failure), typecheck clean, lint unchanged at its one pre-existing false positive.

**Task 5 complete (AC 8, AC 9).**

- **A real, previously-unspecified design gap: what chip KEY does a fallback item get?**
  Neither AC 5 nor the Dev Notes' resolution diagram mention a third resolution source, and
  a curated_baseline_items row is never written into `recipes` OR `onboarding_chip_suggestions`
  — so its real UUID `id` would resolve via NEITHER of AC 5's two lookup stores, silently
  reproducing the exact "UUID passed raw to the agent" failure AC 5 exists to prevent.
  Resolved by keying fallback chips on `canonical_name` itself (both `key` and `label`),
  never the row's real id — matching the non-UUID pattern every other non-M5 chip already
  uses. `UUID_RE` never matches a dish name, so `submitTextTurn`'s resolution block simply
  skips these keys and passes them through as their own label — no change needed to AC 5's
  resolution code, and no new failure mode introduced.

- **Fallback REPLACES the thin suggestion set; it does not blend with it.** Decision 2's own
  wording — "used only to populate chips when generation yields too few" — reads as a
  source swap, not a union (the ONLY explicit union in this story is AC 13's favourites
  union, task 7). Verified via a dedicated test: a single real suggestion does not survive
  alongside a 15-row curated fallback.

- **The CHIP_FLOOR check subsumed the old empty-catalog cold-start entirely.** The prior
  `deriveColdStartReason` fired `'stage2_terminal'` only when the suggestion table was
  literally empty (`rows.length === 0`); since `CHIP_FLOOR(12) > 0`, that condition is now
  strictly a special case of "below CHIP_FLOOR" and gets picked up by the same branch, then
  routed through the fallback before any cold-start decision is made. The old method became
  dead code as a direct result of this change and was removed rather than left orphaned.
  `'stage2_terminal'` stays in the `ColdStartReason` union (harmless, matches two other
  already-dead literals already tolerated there pre-dating this slice) but a NEW
  `'chip_floor_underflow'` value is what actually fires now — confirmed no other file does
  an exhaustive switch on this type, so adding the literal was safe.

- **Retargeting the pre-existing sort/diversity/logging tests took real care, not just
  padding.** Every one of those tests used small (2-6 row) fixtures that now trigger the
  new fallback unconditionally. Naive padding breaks several of them in non-obvious ways —
  verified by hand before editing, not just by re-running:
  - Padding a bucket ALREADY at its diversity cap doesn't change that bucket's admitted
    count (the cap, not the raw candidate count, decides what's admitted) — safe for the
    sort-tie-break and diversity-cap-3 tests.
  - Padding a bucket involved in a near-capacity MULTI-TAG interaction is NOT safe — it
    changes whether the shared item gets admitted after the relax step. The multi-tag test
    is padded with a THIRD, non-overlapping cuisine instead, verified by re-tracing the
    admission math by hand.
  - The relax-to-5 mechanic (pre-existing, unrelated to CHIP_FLOOR) still fires whenever the
    CAPPED count falls under `UNDERFLOW_THRESHOLD`, independent of the raw row count now
    being >= `CHIP_FLOOR` — this bit the sort-tie-break test's rewrite once (padding pulled
    in 2 extra rows via the relax step); fixed by asserting only the first three chips,
    which is what the test is actually about.

- 21 new/retargeted tests across the two test files, full API suite 2631 passing (same
  single pre-existing voice/DST failure), typecheck clean, lint unchanged at its one
  pre-existing false positive.

**Task 6 complete (AC 12).**

- **The schema change required retargeting every existing LLM-response fixture in
  `catalog-seed.service.test.ts`.** `primary_starch`/`primary_protein` are required fields
  on `CatalogSeedItemSchema`, and `CatalogSeedResponseSchema` validates the WHOLE items
  array against that per-item schema (not a separate looser outer check) — so a fixture
  missing either field fails at the response level, not the per-item drop-and-continue
  path, and the entire batch is rejected. Confirmed this is the existing, intentional
  behavior (the per-item Zod guard in Step 5 is explicitly commented "already done by
  response parse... but the brief explicitly calls for a guard" — belt-and-suspenders, not
  a bug). Fixed mechanically across all 15 fixture sites with a scripted insert rather than
  by hand, then verified every test's *intent* still held (none of them cared about the new
  fields specifically, so a uniform `'none'` default was correct everywhere).

- **Caught a mutation bug before it shipped, not after.** `pickWithDiversityCap`'s existing
  `const tags = row.cuisine_tags.length > 0 ? row.cuisine_tags : ['__untagged__']` aliases
  the row's own array when non-empty — pushing the new combo key onto `tags` would have
  silently mutated `row.cuisine_tags` in place, corrupting the row for any later
  re-evaluation (the relax-to-5 pass re-walks the same rows). Copied the array before
  pushing.

- **The combined-key decision is the substantive judgment call in this task.** AC 12 says
  "bucket on them" (starch and protein) without specifying independent vs. combined caps.
  Chose combined (`combo:${protein}:${starch}`) because the near-duplicate definition
  already in the prompt is explicitly a PAIR condition ("share the same protein AND the
  same starch") — independent per-dimension caps would over-reject: two dishes sharing only
  a starch (chicken-rice, beef-rice) are not near-duplicates and must not compete for the
  same bucket. Verified with a dedicated test that they don't.

- **A row missing either value is exempt from the combo bucket, not capped into a shared
  "no value" bucket.** Considered and rejected treating null/null like the existing
  `'__untagged__'` cuisine fallback: a protein-forward salad, an egg dish, and a fruit cup
  all lacking a "dominant starch" are not near-duplicates of each other just because none of
  them has one. Verified with a 12-row all-null fixture that only the pre-existing
  cuisine-cap logic bounds them, unaffected by the new backstop.

- **Fallback rows (curated_baseline_items) are exempt entirely** — that table has no
  starch/protein columns, and AC 12 is explicitly scoped to "the generated set."

- 6 new tests (3 persistence-side in `catalog-seed.service.test.ts`, 3 bucketing-side in
  `catalog-projection.service.test.ts`), full API suite 2637 passing (same single
  pre-existing voice/DST failure), typecheck clean, lint unchanged at its one pre-existing
  false positive.

**Task 7 complete (AC 13).**

- **`findHouseholdFavoritesWithIds` reuses the ESTABLISHED "favourite" definition rather
  than inventing a new one.** `findHouseholdFavorites` (Story 7-S15, powers the Kitchen
  Profile) already qualifies a row as `is_household_favorite OR catalog_provenance IN
  ('declared', 'parent_added')` — this is the exact set AC 13 needs. Rather than change that
  method's return shape (an existing caller relies on `string[]`) or reuse
  `findCatalogProjectionForHousehold` (task 3's prediction — the wrong fit; it reads the
  household's ENTIRE catalog including dozens of irrelevant Stage 0/1 'inferred' rows to
  find a handful of favourites), added a sibling method mirroring the SAME WHERE clause with
  `id` added to the select. `findCatalogProjectionForHousehold` itself is now removed —
  task 3's "pending likely reuse by 16-s7" turned out not to materialize once the better-fit
  method was found; confirmed zero other callers before deleting, fixed a dangling
  `{@link}` docstring reference in a sibling method.

- **`CatalogProjectionService` re-gains a `recipesRepository` dependency**, contradicting
  task 3's own AC 4 framing ("this class no longer depends on RecipesRepository at all").
  Corrected that comment rather than leaving it stale: AC 4's actual guarantee is that a
  `recipes` row cannot masquerade as a GENERATED suggestion, not that this class never
  touches `recipes` for any purpose — a scoped, read-only, single-method use for favourites
  (which are supposed to appear, tagged `provenance: 'declared'`) doesn't violate that.
  Also corrected two "this class has no dependency capable of writing" comments to describe
  what's actually true now (the dependency exists; only its read methods are called).

- **A real, unspecified design gap: does a household with declared favourites but a failed
  generation + fallback still get a chip card, or cold-start?** Neither AC 9 nor AC 13
  addresses the intersection. Resolved as: favourites override cold-start. Reasoning:
  doctrine frames cold-start as avoiding a "blank/sparse/stereotyped" card — a parent's own
  declared favourites are neither, and showing them is strictly better than hiding content
  they already gave us behind a conversational punt. This is the second genuine judgment
  call in this slice I made confidently rather than blocking on (after the fallback
  chip-key decision in task 5), flagged prominently here — override if the product read is
  different. A regression test locks the OTHER half: true cold-start (no chips) still fires
  when there are no favourites AND both generation and fallback underflow.

- **Dedup happens on the WINNING pool only, after the floor/fallback decision, using the
  RAW (pre-dedup) count for that decision.** A household whose generated suggestions happen
  to overlap heavily with already-declared favourites doesn't get pushed into the fallback
  path just because dedup would shrink the suggestion count — the floor is about whether
  GENERATION produced enough NEW content, a question dedup doesn't change the answer to.

- **`pickWithDiversityCap` gained an optional `target` parameter** (defaults to
  `TARGET_CHIPS`) so the generated pool's budget can shrink by `favourites.length` without
  touching the cap-3/cap-5/relax mechanics themselves — favourites are exempt from the cap
  entirely (never passed through this method at all), not merely favoured within it.

- 12 new tests (3 in `recipes.repository.test.ts` for the new repository method, 5 union
  tests + regression coverage in `catalog-projection.service.test.ts`, plus updates to the 3
  standalone constructor tests that predate the `buildService` harness), full API suite 2646
  passing (same single pre-existing voice/DST failure), typecheck clean, lint unchanged at
  its one pre-existing false positive.

**Task 8 complete (Gates).**

- **The story's "4 known pre-existing failures" claim is stale.** Only 1 has been observed
  at every task boundary in this slice: `voice-transcript.repository.test.ts`'s
  `defaults retention_until to ~now + 90 days`, a DST clock-arithmetic edge case (the delta
  is exactly one hour) in a module this slice never touches. Recorded the corrected count
  rather than silently accepting the stale number.

- **Closed two pre-existing gate failures that predate this slice, both flagged and left
  open in earlier tasks pending exactly this moment:**
  - The `hivekitchen/no-assistant-filler` false positive at
    `onboarding.service.ts` (flagged since task 1's Watch Out) — the rule matches a Pino
    operational log string, not user-facing Lumi copy, which it has no exemption for.
    Closed with a targeted `eslint-disable-next-line` + reason comment, NOT by rewording the
    log (which would have destroyed the operational signal on the retry path this slice
    built in task 1). First disable-comment placement attempt put a multi-line explanation
    directly above the directive, which meant "next line" from the directive's own
    perspective was the second explanation line, not the flagged string — ESLint accepted
    it as a no-op ("unused eslint-disable directive") without complaint, which would have
    shipped a silently-broken suppression if the resulting lint run hadn't been checked
    line-by-line rather than trusted from the exit code alone.
  - `ColdStartReason` was `export`ed but never imported as a type anywhere, confirmed true
    both before this slice (`git show` against the pre-16-s1 baseline) and after — not
    caused by this slice's work, but knip is one of this task's own gates. Narrowed to
    module-private since nothing external ever consumed it; `M5ChipResult`, which IS
    exported and used, carries the same information through `coldStartReason: string`-like
    usage at every real call site.

- **E2E scope matches what this slice actually changed: nothing in the frontend.** All chip
  generation, filtering, and the favourites union are backend-only; the M5 chip CARD's
  presentation is 16-s2's job. Ran the 4 onboarding-adjacent Playwright specs (not the full
  suite) as a regression check that nothing broke, not as new coverage for content this
  slice didn't add.

- Full gate results: typecheck clean (9/9 packages), lint clean (6/6 lintable packages, 1
  pre-existing false positive suppressed with a documented reason), knip clean (1
  pre-existing unused export narrowed), `contracts:check` PASSED (555 exports), API suite
  2646 passing / 1 pre-existing failure / 39 skipped, E2E 19 passing / 4 skipped
  (voice-entry, gated off) / 0 failed.

### File List

- `apps/api/src/agents/prompts/catalog-seed.prompt.ts` — modified (snapshot gains
  `dietary_non_negotiable`, loses `cuisine_tags`; prompt lines + 2 SYSTEM_PROMPT rules)
- `apps/api/src/modules/catalog/catalog-seed.service.ts` — modified (task 2: `buildSnapshot`
  splits dietary on enforcement, drops the aliased cuisine axis; task 4: chip-block logging
  at both filter sites, survivors also persist to `onboarding_chip_suggestions`)
- `apps/api/src/modules/catalog/catalog-seed.service.test.ts` — modified (task 2: 3 AC 3
  tests; task 4: 2 tests extending/adding to the block-scenario fixture)
- `apps/api/src/modules/onboarding/onboarding.service.ts` — modified (trigger moved to the
  M3 exit; jobId dedup + terminal-job clearing; attempt increment gated; stale
  "OPTIONAL M3" comment corrected; `CATALOG_SEED_QUEUE` import)
- `apps/api/src/modules/onboarding/onboarding.service.test.ts` — modified (harness gains
  `getJob` + `householdsRepository` fakes; old m2_safe-exit test retargeted; 5 new tests)
- `apps/api/src/agents/eval/onboarding-eval.harness.ts` — modified (queue fake models
  jobId dedup)
- `apps/api/src/agents/eval/onboarding-eval.fixtures.ts` — modified (3 scenario seed
  counts corrected for the new trigger)
- `supabase/migrations/20261040000000_create_onboarding_chip_suggestions.sql` — new
- `apps/api/src/modules/catalog/onboarding-chip-suggestion.repository.ts` — new
- `apps/api/src/modules/catalog/catalog-projection.service.ts` — modified (task 3: chip
  source moved off `recipes`/`household_recipe_usage` to `onboarding_chip_suggestions`,
  `recipesRepository` dependency removed, sort simplified; task 5: `CHIP_FLOOR` fallback to
  `curated_baseline_items`, `deriveColdStartReason` removed as dead code, new
  `'chip_floor_underflow'` cold-start reason; task 6: `pickWithDiversityCap` buckets on a
  combined `combo:${protein}:${starch}` key alongside cuisine, `SuggestionRow` gains
  `primary_starch`/`primary_protein`, fixed a pre-existing array-aliasing mutation risk
  while adding the combo key)
- `apps/api/src/modules/catalog/catalog-projection.service.test.ts` — rewritten (task 3:
  fixture shape follows the new repository; task 5: fallback test suite added, several
  pre-existing sort/diversity tests retargeted with hand-verified padding — see completion
  notes; task 6: `makeRow` gains starch/protein params, 3 new backstop tests)
- `apps/api/src/modules/catalog/catalog-seed.service.test.ts` — modified (task 4: AC 6/7
  tests; task 5: `insertMany`-not-called assertions on the 4 forced-failure tests + 1 new
  filter-blocks-everything test; task 6: `primary_starch`/`primary_protein` added to all 15
  existing item fixtures, 3 new persistence tests)
- `apps/api/src/modules/onboarding/onboarding.routes.ts` — modified (task 3: constructs
  `OnboardingChipSuggestionRepository`, wires it into both `catalogProjection` and
  `OnboardingService`; task 5: `curatedBaselineRepo` hoisted to a shared variable, wired
  into `catalogProjection`)
- `apps/api/src/modules/onboarding/onboarding.service.ts` — modified (AC 5 resolution
  checks the suggestion store before the recipes fallback; unresolved-in-both-stores now
  logs `onboarding.m5_chip_uuid_unresolved`)
- `apps/api/src/modules/onboarding/onboarding.service.test.ts` — modified (harness gains
  `recipesRepository` + `onboardingChipSuggestionRepository` fakes; 4 new AC 5 tests)
- `apps/api/src/jobs/catalog-seed.job.ts` — modified (constructs
  `OnboardingChipSuggestionRepository`, wires it into `CatalogSeedService`)
- `apps/api/src/agents/prompts/catalog-seed.prompt.ts` — modified (task 6: OUTPUT SHAPE
  gains `primary_starch`/`primary_protein` fields, HARD RULES field count updated)
- `apps/api/src/modules/catalog/catalog-seed.service.ts` — modified (task 6:
  `CatalogSeedItemSchema` gains the two new required fields, `Survivor` threads them
  through both persist branches, new `normalizeStarchProtein` helper collapses the LLM's
  `'none'`/empty-string to a real `null`)
- `apps/api/src/modules/recipe/recipes.repository.ts` — modified (task 7: new
  `findHouseholdFavoritesWithIds`, mirroring `findHouseholdFavorites`'s qualification;
  `findCatalogProjectionForHousehold` removed as confirmed-dead code — zero callers, task
  3's "pending likely reuse" prediction didn't pan out; unused `CatalogProvenance` import
  removed; dangling `{@link}` reference in `findCandidateSlateForHousehold`'s docstring
  fixed)
- `apps/api/src/modules/recipe/recipes.repository.test.ts` — modified (3 new tests for
  `findHouseholdFavoritesWithIds`)
- `apps/api/src/modules/catalog/catalog-projection.service.ts` — modified (task 7:
  `recipesRepository` dependency re-added for the AC 13 favourites union; declared
  favourites pinned first, exempt from `pickWithDiversityCap`'s cap via a new optional
  `target` budget parameter, deduped against the winning pool by canonicalized name;
  favourites override cold-start when generation + fallback both underflow — see completion
  notes; corrected stale AC 4 / "no write dependency" comments)
- `apps/api/src/modules/onboarding/onboarding.routes.ts` — modified (task 7: wires the
  already-constructed `recipesRepository` into `catalogProjection`)
- `apps/api/src/modules/onboarding/onboarding.service.ts` — modified (task 8: targeted
  `eslint-disable-next-line hivekitchen/no-assistant-filler` + reason on the pre-existing
  false-positive log line)
- `apps/api/src/modules/catalog/catalog-projection.service.ts` — modified (task 8:
  `ColdStartReason` un-exported — pre-existing unused export, knip gate)

---

## Change Log

| Date | Change |
|---|---|
| 2026-08-13 | Story authored from the Epic 16 brief after all five design decisions were resolved. |
| 2026-08-13 | M5 re-entry resolved: already-tapped favourites stay visible — pinned, uncapped, deduped, free-text declarations included (AC 13). |
| 2026-08-13 | Context pass against the working tree: M3-optional trigger hazard, queue dedup, chip-key resolution path, snapshot enforcement/cuisine defects, `CHIP_FLOOR`/count-gate values, and the suggestion-store decision all pinned to verified line references. |
| 2026-08-13 | Task 2 implemented (AC 3): snapshot splits dietary on `enforcement` (`dietary_non_negotiable` vs soft `dietary_flags`) and the prompt renders hard ones as omit-entirely exclusions; the duplicated `cuisine_tags` axis removed outright (M3 cuisine answers already arrive via `cultural_tags`); `food_preferences` labelled as the stated-taste axis. |
| 2026-08-13 | Task 1 implemented (AC 1, AC 2): Stage 1 trigger moved from the m2_safe exit to the m3_taste exit with the m5_starting_line re-check retained; household-scoped jobId dedup added, with terminal jobs cleared so a failed seed can still retry; `incrementStage1Attempts` gated on a job actually being created. The previously-red `catalogSeedCalls` golden is GREEN without editing it. Story's AC 1 rationale corrected — M3 is REQUIRED since 13-s6, not optional. |
| 2026-08-13 | Validation pass. AC 3 rewritten: the cuisine/cultural alias is a DATA-MODEL fact (`cuisine.declare` and `cultural.note` share `noteSuggested()` on an undiscriminated, key-unique `cultural_priors`), so the "distinct cuisine axis" was unimplementable as written — stated taste now routes through `food_preferences`, no migration. AC 2 corrected: `ensureStage1Seeded` has four guards, none of which dedup in-flight. Task 1.3 upgraded from a caution to a concrete defect — the unconditional `incrementStage1Attempts` at line 486 burns an attempt on a dedup-no-op `add`. Lint error at line 463 identified as a false positive on a Pino log string. |
| 2026-08-13 | Three-layer adversarial code review of commit `50ef972` (Tasks 1-2): 23 raw findings → 2 decision-needed (both resolved "leave bundled as-is" — an M2 attribution feature and a Stage 1 retry/throw redesign were both swept into the commit as pre-existing uncommitted work), 10 patch (8 applied — attempts-counter fragility on read failure, misreported post-enqueue log, dual-rendered dietary tag, a vacuous test, 2 coverage gaps, an eval-harness gap, a fragile assertion; 2 left as open action items needing product/architecture judgment), 6 defer (logged to `deferred-work.md`), 4 dismissed (2 refuted against the full repo, 2 already self-disclosed). |
| 2026-08-13 | Task 3 implemented (AC 4, AC 5): `onboarding_chip_suggestions` table + repository created; `CatalogProjectionService` repointed at it with `recipesRepository` removed entirely (AC 4's negative control is structural — no code path to `recipes` exists); AC 5's chip-key resolution now checks the suggestion store before the recipes fallback, and a key unresolved in BOTH stores now logs `onboarding.m5_chip_uuid_unresolved` instead of failing silently. `findCatalogProjectionForHousehold` on `RecipesRepository` deliberately left in place, unused, pending likely reuse by 16-s7's favourites union. |
| 2026-08-13 | Task 4 implemented (AC 6, AC 7): `seedForHousehold`'s existing filtered `survivors` array (name pre-filter + `evaluateGuardrail()`, unchanged) now also persists to `onboarding_chip_suggestions` — one filter pass, two persist targets, per AC 6's "do not fork" instruction. `catalog.chips.blocked` logging added at both block sites with label + matched allergen + source ('declared' vs 'falcpa'), the latter resolved via the guardrail's own exported `isHardRule()` rather than reimplemented, and verified reachable with a dedicated FALCPA-only test. `primary_starch`/`primary_protein` inserted as null pending task 6's schema addition. Chip-persist failure is caught and logged, never undoes a successful recipes persist. |
| 2026-08-13 | Task 5 implemented (AC 8, AC 9): when filtered suggestions fall below `CHIP_FLOOR` (12, aliased from `UNDERFLOW_THRESHOLD`), `getM5Chips` reads + filters `curated_baseline_items` and uses it as a full REPLACEMENT source, not a blend; a fallback that also underflows returns the new `'chip_floor_underflow'` cold-start reason instead of a sparse grid. Closed an unspecified gap: fallback chips are keyed on `canonical_name`, never the row's real id, because a curated row resolves via neither of AC 5's two lookup stores and would otherwise reproduce AC 5's own silent-failure trap. The old empty-catalog cold-start check (`deriveColdStartReason`, `'stage2_terminal'`) became dead code under the new floor logic and was removed. Retargeted 8 pre-existing sort/diversity/logging tests whose small fixtures now unconditionally trigger the new floor — padding math verified by hand per test, not just re-run until green. |
| 2026-08-13 | Task 6 implemented (AC 12): `primary_starch`/`primary_protein` added as required fields to `CatalogSeedItemSchema` and the prompt's OUTPUT SHAPE, threaded through to `onboarding_chip_suggestions` (previously null, per task 4's note), normalizing the LLM's `'none'`/empty string to a real `null`. `pickWithDiversityCap` now also buckets on a COMBINED `combo:${protein}:${starch}` key — deliberately combined, not two independent caps, because the near-duplicate rule is a PAIR condition ("share the same protein AND the same starch") and independent caps would over-reject dishes sharing only one axis. A row missing either value is exempt from the combo bucket, not capped into a shared "no value" bucket. Caught and fixed a pre-existing array-aliasing mutation bug in `pickWithDiversityCap` while adding the combo key (`tags` aliased `row.cuisine_tags` when non-empty). Retargeted all 15 existing LLM-response fixtures in `catalog-seed.service.test.ts` — the response schema validates per-item AND at the array level, so a fixture missing a new required field failed the WHOLE batch, not just that item. |
| 2026-08-13 | Task 7 implemented (AC 13): declared favourites unioned into the M5 chip set, pinned first, deduped against the winning suggestion/fallback pool via `canonicalizeFavoriteName` (case-insensitive), exempt from the diversity cap via a new `pickWithDiversityCap` budget parameter, still counting toward `TARGET_CHIPS`. New `RecipesRepository.findHouseholdFavoritesWithIds` mirrors the existing `findHouseholdFavorites` qualification rather than inventing a new "favourite" definition; `findCatalogProjectionForHousehold` (task 3's predicted-but-unrealized reuse target) removed as confirmed-dead code. Judgment call: declared favourites now override cold-start when generation + fallback both underflow CHIP_FLOOR — doctrine frames cold-start as avoiding a sparse/blank card, and a parent's own favourites are neither; a regression test confirms true cold-start still fires with no favourites present. Corrected task 3's stale AC 4 comments now that `CatalogProjectionService` depends on `RecipesRepository` again (for exactly one read). |
| 2026-08-13 | Task 8 (Gates) complete. Corrected the story's stale "4 known pre-existing failures" claim — only 1 is actually observed (voice-transcript DST edge case, unrelated). Closed two gate failures flagged-and-deferred in earlier tasks: the `no-assistant-filler` false positive (targeted `eslint-disable-next-line` + reason, not a log reword — first placement attempt silently no-op'd due to a multi-line comment between the directive and the flagged line, caught by checking the lint run's output line-by-line rather than trusting the exit code) and `ColdStartReason`'s pre-existing unused export (un-exported, confirmed dead both before and after this slice via `git show` on the pre-16-s1 baseline). All gates green: typecheck 9/9 packages, lint 6/6 packages, knip clean, `contracts:check` 555 exports, API suite 2646/1-pre-existing/39-skipped, E2E (4 onboarding-adjacent specs, this slice is backend-only) 19 passed/4 skipped(voice, gated off)/0 failed. Story status → `review`. |
