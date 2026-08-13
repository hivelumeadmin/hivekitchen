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

1. **Generation fires at M3 exit.** A household advancing out of `m3_taste` enqueues chip
   generation. The existing `advancedOutOfM2` Stage-1 trigger is replaced, not
   supplemented — generation must not run twice per interview.

2. **The snapshot carries STATED preferences, not just inferred ones.** The generation
   input includes the cuisine and dietary data written during M3 (`dietary_preferences`
   rows and the M3-era `cultural_priors`), not only the inferred cultural template that
   `buildSnapshot` reads today. A test asserts a household whose M3 answers differ from its
   inferred template produces a prompt containing the M3 answers.

3. **Chips come from the generated set, not from `recipes`.** The M5 chip payload is built
   from generated suggestions. `CatalogProjectionService`'s read over
   `household_recipe_usage` is no longer the chip source. Proven by seeding a household's
   `recipes` with obviously-identifiable rows and asserting none of them appear as chips.

4. **The deterministic allergen filter runs on every generated suggestion** (decision 1),
   using the same `evaluate()` path Stage 1 uses today, covering both the household's
   declared allergens and the `FALCPA_KEYS` belt-and-suspenders list. A suggestion naming
   a declared allergen never reaches the parent.

5. **Every blocked suggestion is logged** with a structured reason
   (`action: 'catalog.chips.blocked'`, the suggestion label, the matched allergen, and
   whether the match came from the declared set or the FALCPA floor). This is the evidence
   base for revisiting decision 1 later; it must be queryable without re-running
   onboarding.

6. **Curated-50 fallback, read-only** (decision 2). When generation fails, times out, or
   leaves fewer than `CHIP_FLOOR` suggestions after filtering, chips are drawn from
   `curated_baseline_items` directly. This read MUST NOT write `recipes` or
   `household_recipe_usage` rows. Allergen and non-negotiable-dietary filtering still
   applies to fallback chips.

7. **M5 is never empty.** Forced-failure tests for each path — LLM timeout, LLM error,
   malformed response, and a filter that blocks everything — each still render a non-empty
   chip set via AC 6.

8. **Not-ready behaviour is correct, if unpolished.** If the parent reaches M5 before
   generation completes, the existing poll runs and the existing cold-start path applies.
   No blank chip grid, no crash. Presentation is 16-s2's job.

9. **No regression in what a tapped chip does.** `favorite_lunch.add` →
   `declareForHousehold` still writes `catalog_provenance='declared'`,
   `is_household_favorite=true`, `confidence_score=80`, and M5's completion gate
   (`count >= 10` / `override_fewer`) is unchanged.

10. **Diversity is enforced on the generated set.** The prompt's existing `≤4 rice` cap and
    no-near-duplicates rule carry over, AND selection applies a starch/protein diversity
    check — not only `cuisine_tags`. A generated set containing N chicken-rice dishes across
    N cuisines must not produce N chicken-rice chips.

---

## Tasks / Subtasks

- [ ] 1. Move the trigger (AC 1)
  - [ ] 1.1 Replace the `advancedOutOfM2` checkpoint with an M3-exit checkpoint in
        `onboarding.service.ts`. Keep the M5-entry re-check as the idempotent safety net —
        it is what makes AC 8 work.
  - [ ] 1.2 Confirm `stage1_attempts` / `stage1_last_error` accounting still bounds retries
        at the new trigger point. NOTE: this accounting arrived in unreleased work; check
        the working tree, not just `HEAD`.
- [ ] 2. Extend the snapshot (AC 2)
  - [ ] 2.1 Add stated M3 cuisine + dietary enforcement to `buildSnapshot`.
  - [ ] 2.2 Test: inferred template ≠ M3 answers → prompt contains the M3 answers.
- [ ] 3. Generated-suggestion path (AC 3)
  - [ ] 3.1 Persist generated suggestions somewhere the M5 surface can read WITHOUT
        writing `recipes`. See Dev Notes — this is the main open implementation question.
  - [ ] 3.2 Repoint the chip payload at the generated set.
  - [ ] 3.3 Negative control: pre-seed `recipes` with marker rows, assert zero leak.
- [ ] 4. Filter + logging (AC 4, 5)
  - [ ] 4.1 Reuse Stage 1's `evaluate()` + `FALCPA_KEYS` path; do not fork the logic.
  - [ ] 4.2 Structured block log with reason and match source.
- [ ] 5. Fallback (AC 6, 7)
  - [ ] 5.1 Read `curated_baseline_items` directly for chips; no materialisation.
  - [ ] 5.2 `CHIP_FLOOR` constant; apply allergen + dietary filtering to fallback too.
  - [ ] 5.3 Four forced-failure tests.
- [ ] 6. Diversity (AC 10)
  - [ ] 6.1 Add a starch/protein dimension to the diversity check.
  - [ ] 6.2 Test with a deliberately skewed generated set.
- [ ] 7. Gates
  - [ ] 7.1 API suite — expect the 4 known pre-existing failures, no new ones.
  - [ ] 7.2 turbo lint + typecheck, knip, contracts:check.
  - [ ] 7.3 E2E onboarding spec.

---

## Dev Notes

### The system after this slice (target state)

```
M3 exit   → enqueue generation (M1-M3: children, declared allergens, STATED taste + dietary)
          → LLM ~30 suggestions → deterministic allergen filter (+ block log)
M5 entry  → ready?  render generated chips
            not?    existing poll / cold-start path (16-s2 polishes the copy)
            failed / below CHIP_FLOOR?  curated_baseline_items, read-only
tap chip  → favorite_lunch.add → declareForHousehold (UNCHANGED, confidence 80)
```

Stage 0 still materialises. Recipe seeding is untouched. Both are 16-s3.

### Verified current-state facts (2026-08-12/13 research — trust these over the brief's prose)

- Stage 1 fires on `advancedOutOfM2` (`onboarding.service.ts:1171-1176`), with an M5-entry
  re-check added by unreleased retry work.
- `buildSnapshot` sources `cuisineTags` from `cultural_priors` / `cultural_identifiers` —
  the inferred template, NOT M3's stated answers. This is why AC 2 exists.
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

### Open implementation question (decide during dev, record the choice)

**Where do generated suggestions live between M3 exit and M5 render?** They must not be
`recipes` rows (AC 3), but they must survive the gap and a page reload. Candidates:

- a new `onboarding_chip_suggestions` table keyed by household — durable, queryable, adds
  schema and a cleanup story;
- the existing onboarding moment state / thread payload — no new schema, but couples chip
  data to interview state and may complicate the M5 re-entry path;
- Redis with a TTL — cheap and naturally ephemeral, but the M5 poll would need a
  cache-miss path, and dev Redis has already died once during this work.

Recommendation leans to the first for durability, but confirm against how 16-s3 will want
to read the tapped favourites at seed time.

### Doctrine (binding here)

- **Decision 1 is a safety call, already made: the filter stays.** Do not remove it to save
  latency; it does not cost latency. If it proves too blunt, the block log (AC 5) is the
  evidence to reopen the decision — not intuition.
- **Fallback reads must never write.** The whole point of decision 2 is that the curated
  set stops being a seeded catalog and becomes a last-resort display source.
- **M5 must never be empty.** This is the one guarantee Stage 0 genuinely provided; it is
  the reason AC 6 and AC 7 exist.
- Chips are a **preference-elicitation** surface, not a food-safety surface — but the ones
  a parent taps reach the planner at maximum confidence, which is why AC 4 is not optional.

### Project Structure Notes

- `apps/api/src/modules/catalog/catalog-seed.service.ts` — repurpose, do not fork.
- `apps/api/src/modules/catalog/catalog-projection.service.ts` — chip source + diversity.
- `apps/api/src/modules/catalog/curated-baseline.service.ts` — add a read-only path.
- `apps/api/src/modules/onboarding/onboarding.service.ts` — trigger move.
- `apps/api/src/agents/prompts/catalog-seed.prompt.ts` — snapshot shape, caps carry over.

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
