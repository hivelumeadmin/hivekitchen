# Story 16.1: chips-from-generation-not-catalog

Status: ready-for-dev

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
   `ensureStage1Seeded` can enqueue twice: its only guard is
   `stage1_completed_at !== null`, which is still NULL while a job is queued or in flight.
   `CATALOG_SEED_JOB_OPTS` (`jobs/catalog-seed.job.ts:25-30`) carries **no `jobId`**, so
   BullMQ does not dedup. Add household-scoped dedup —
   `jobId: \`seed-catalog:${householdId}\`` — mirroring what
   `CatalogSeedService.enqueueRecovery()` already does for the recovery queue
   (`catalog-seed.service.ts:210`). This is almost certainly the cause of the red
   `catalogSeedCalls` golden (2 vs 1); a test must assert one enqueue across an interview
   that crosses both checkpoints.

3. **The snapshot carries STATED preferences at full fidelity.** Two verified, specific
   defects in `buildSnapshot` (`catalog-seed.service.ts:674-730`), both of which survive a
   trigger move and must be fixed explicitly:
   - **Cuisine is aliased to culture.** `cuisineTags` is populated from
     `map.cultural.active[].key` — the same source as `culturalTags` (lines 699-704). There
     is no distinct cuisine axis, so the prompt's `cuisine_tags` and `cultural_tags` lines
     are identical strings.
   - **Enforcement is discarded.** `map.dietary[]` carries `enforcement`
     (`KitchenMapDietarySchema`, `packages/contracts/src/kitchen-map.ts:232-242`), but
     line 695-698 flattens to bare tags. The M5 projection filter *does* read
     `enforcement === 'non_negotiable'` (`onboarding.service.ts:550-556`), so today the
     prompt can be asked for dishes the filter will then silently discard.

   The snapshot must carry non-negotiable dietary tags distinctly from soft ones, and a
   cuisine axis distinct from the cultural one. Test: a household whose M3 answers differ
   from its inferred cultural template produces a prompt containing the M3 answers, and a
   `non_negotiable` dietary tag appears in the prompt as a hard exclusion.

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

- [ ] 1. Move the trigger (AC 1, 2)
  - [ ] 1.1 Replace the `advancedOutOfM2` half of `stage1Checkpoint`
        (`onboarding.service.ts:1171-1174`) with an M3-exit edge. **Keep the M5-entry
        half** — M3 is optional and its exit edge can never fire for a re-anchored
        household. Do not "simplify" this to one trigger.
  - [ ] 1.2 Add `jobId: \`seed-catalog:${householdId}\`` to the enqueue in
        `ensureStage1Seeded` (line 480). Test: one enqueue across an interview crossing
        both checkpoints.
  - [ ] 1.3 Confirm `stage1_attempts` / `stage1_last_error` accounting still bounds retries
        at the new trigger point. NOTE: this accounting arrived in unreleased work; check
        the working tree, not just `HEAD`. Watch the interaction with 1.2 — a deduped
        `add` that BullMQ no-ops must not still consume an attempt.
- [ ] 2. Extend the snapshot (AC 3)
  - [ ] 2.1 Give `CatalogSeedSnapshot` a cuisine axis distinct from `cultural_tags`, and
        split dietary into non-negotiable vs soft. Update `buildCatalogSeedPrompt` to
        render the hard exclusions as exclusions.
  - [ ] 2.2 Test: inferred template ≠ M3 answers → prompt contains the M3 answers.
  - [ ] 2.3 Test: a `non_negotiable` dietary tag renders as a hard exclusion in the prompt.
- [ ] 3. Generated-suggestion path (AC 4, 5)
  - [ ] 3.1 Create `onboarding_chip_suggestions` (see Dev Notes for the resolved shape) and
        its repository. Migration + a `kitchen_map_version` decision (it does NOT need a
        bump trigger — the KitchenMap does not read it).
  - [ ] 3.2 Repoint the chip payload at the generated set.
  - [ ] 3.3 **Extend the chip-key resolution in `submitTextTurn` (lines 748-804)** to hit
        the suggestion store before `recipesRepository.findById()`. This is AC 5 and it is
        the easiest thing in the slice to forget.
  - [ ] 3.4 Negative control: pre-seed `recipes` with marker rows, assert zero leak.
  - [ ] 3.5 Test: tapped generated chip → `declareForHousehold` receives the label.
- [ ] 4. Filter + logging (AC 6, 7)
  - [ ] 4.1 Reuse Stage 1's `evaluate()` + `catalogItemToPlanItem` + `FALCPA_KEYS` path; do
        not fork the logic and do not substitute the projection's `allergen_flags.includes`.
  - [ ] 4.2 Structured block log with reason and match source.
- [ ] 5. Fallback (AC 8, 9)
  - [ ] 5.1 Read `curated_baseline_items` directly for chips; no materialisation.
  - [ ] 5.2 `CHIP_FLOOR = 12`; apply allergen + dietary filtering to fallback too.
  - [ ] 5.3 Four forced-failure tests + the fallback-also-underflows → cold-start case.
- [ ] 6. Diversity (AC 12)
  - [ ] 6.1 Add `primary_starch` / `primary_protein` to the generated-item schema.
  - [ ] 6.2 Bucket the selection on those dimensions alongside cuisine.
  - [ ] 6.3 Test with a deliberately skewed generated set.
- [ ] 7. Already-tapped favourites on re-entry (AC 13)
  - [ ] 7.1 Union declared favourites into the chip set, deduped via
        `canonicalizeFavoriteName`, sorted first, exempt from the diversity cap.
  - [ ] 7.2 Test: 3 declared favourites (one declared by free text, not by tapping) all
        render, at the head, exactly once each, alongside a full generated set.
- [ ] 8. Gates
  - [ ] 8.1 API suite — expect the 4 known pre-existing failures, no new ones. The golden
        `catalogSeedCalls` 2 vs 1 should go GREEN via task 1.2; if it does not, stop and
        diagnose rather than editing the golden.
  - [ ] 8.2 turbo lint + typecheck, knip, contracts:check.
  - [ ] 8.3 E2E onboarding spec — needs `VITE_E2E=true` in the web build.

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
  `enforcement` is present on the KitchenMap and thrown away at line 695-698. This is why
  AC 3 exists, and it is not fixed by moving the trigger.
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
- `apps/api/src/modules/onboarding/onboarding.service.ts` carries ~135 uncommitted lines
  and currently fails `turbo lint` at line 463. Coordinate before editing it.

### References

- Brief: `_bmad-output/planning-artifacts/catalog-seeding-redesign-generate-at-onboarding.md`
- `c256ab2` — symptom relief already shipped (baseline 39/50 → 8/50 rice; M5
  acknowledge-AND-ask). Explicitly NOT the fix this slice delivers.
- `20261039000000_reseed_curated_baseline_starch_diversity.sql` — the rebalanced fallback
  content this slice reads.

---

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

---

## Change Log

| Date | Change |
|---|---|
| 2026-08-13 | Story authored from the Epic 16 brief after all five design decisions were resolved. |
| 2026-08-13 | M5 re-entry resolved: already-tapped favourites stay visible — pinned, uncapped, deduped, free-text declarations included (AC 13). |
| 2026-08-13 | Context pass against the working tree: M3-optional trigger hazard, queue dedup, chip-key resolution path, snapshot enforcement/cuisine defects, `CHIP_FLOOR`/count-gate values, and the suggestion-store decision all pinned to verified line references. |
