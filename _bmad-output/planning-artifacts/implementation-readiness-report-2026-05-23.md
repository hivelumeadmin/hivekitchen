---
date: 2026-05-23
project: hivekitchen
scope: Epic 2.6 (newly approved) + Epic 3 paused-then-unblocked slices (3-23, 3-24, 3-25, 3-26, 3-27, 3-29)
stepsCompleted: [1, 2, 3, 4, 5, 6]
status: complete
facilitator: bmad-check-implementation-readiness
---

# Implementation Readiness Assessment Report

**Date:** 2026-05-23
**Project:** HiveKitchen
**Scope:** Epic 2.6 (Personalized Onboarding Catalog) — readiness for slice authoring; Epic 3 paused-then-unblocked slices — freshness against Epic 2.5 actual delivery
**Out of scope:** full PRD/Architecture/UX audit; other Epic 3 stories already in flight; other epics

---

## 1. Document Inventory

| Document | Path | Notes |
|---|---|---|
| PRD | `_bmad-output/planning-artifacts/prd.md` | Uncommitted modifications (per git status); FR121–FR128 added by Epic 2.5 |
| Architecture | `_bmad-output/planning-artifacts/architecture.md` | Whole; Epic 2.6 amendment pending |
| UX (master) | `_bmad-output/planning-artifacts/ux-design-specification.md` | Whole |
| UX (catalog scoped) | `_bmad-output/planning-artifacts/ux-design-spec-household-food-catalog.md` | Finalized 2026-05-23; persistence-layer footnote pending |
| Epic 2.6 brief | `_bmad-output/planning-artifacts/epic-2.6-brief.md` | Rev 2 approved 2026-05-23; 6 slices unauthored |
| Epic 3 paused slices | `_bmad-output/implementation-artifacts/3-{23..29}-*.md` | 6 spec files exist; pause reasons inherited from 2026-05-19 |

No duplicates. No missing required documents.

---

## 2. Epic 3 Paused-Slice Freshness — One-Line Verdicts

| Slice | Pause reason | Verdict | Required edits before ready-for-dev |
|---|---|---|---|
| **3-23** per-slot policy scoping | "pending Epic 2.5 enforcement contract" | ✅ **READY** | None. Contracts shipped (slot_scope from 3.16; enforcement_level from 2.5-s1). |
| **3-24** allergy uncertainty | "pending FR122 (allergens-without-severity)" | ✅ **READY** (minor) | Task 5 TODO needs resolution — cross-reference to 3-25's `brief_state.plan_state` column. Non-blocking; can resolve in-slice. |
| **3-25** hard-fail escalation | "pending conflict precedence rules + enforcement gradient" | ✅ **READY** | None code-blocking. Migration + logic chain sound. |
| **3-26** graceful degradation UX | "pending enforcement strength data" | ✅ **READY** | Sequential dependency on 3-25's schema; clear dependency boundary. |
| **3-27** variant prep / active learning | "pending food_preferences + enforcement data" | ✅ **READY** | None. `food_preferences` shipped (2.5-s7); slice uses orthogonal new `variant_proposals` table. |
| **3-29** degraded propose / sovereignty toggle | "pending tight-constraints set knowledge" | ✅ **READY** (minor) | Confirm Story 3-18 (cultural priors) is shipped — **confirmed `done` in sprint-status**. Add "≥3 proteins" heuristic to AC explicitly (currently implicit in Task 2). |

**Bottom line:** All 6 paused slices can flip to `ready-for-dev` immediately. Two slices (3-24, 3-29) have non-blocking text clarifications that can be added in-slice rather than as a pre-step.

**Recommended resume order (dependency-aware):**
1. **3-25** first — precedence rules cascade into 3-24, 3-26, 3-29
2. **3-24** + **3-23** in parallel (both independent)
3. **3-26** after 3-25 (schema dependency)
4. **3-27** + **3-29** in parallel (both independent of each other; 3-29 depends on 3-18 ✓)

---

## 3. Epic 2.6 Slice-Level Gaps

| Slice | Status | Gap class | Specifically missing |
|---|---|---|---|
| **2.6-s1** Foundation + migration | 🟡 Mostly ready | Process | (a) Encryption-drop security sign-off gate not enumerated in slice AC; (b) Decryption procedure for live `favorite_lunches` rows (DEK loading + error quarantine); (c) Rollback procedure semantics in forward-deployed Supabase context |
| **2.6-s2** Stage 0 baseline | 🟡 Engineering ready / content pending | Content | ~50 hand-tagged items in `apps/api/src/seeds/curated-baseline.ts` must be authored before slice can ship (parallelizable with s1 engineering); "global subset" default for households skipping M3 undefined |
| **2.6-s3** Stage 1 seeding worker | 🟡 Mostly ready | Engineering inputs | (a) `apps/api/src/agents/prompts/catalog-seed.prompt.ts` must be authored (Layer 1 structured output schema: name + tags only); (b) Guardrail call-site + mass-block fallback path not specified; (c) Idempotency normalization rule (case/diacritic/whitespace handling) needs locking |
| **2.6-s4** M5 chip personalization | 🟡 Engineering ready / mockup pending | UX deliverable | (a) Personalized M5 chip-card mockup with 2–3 cohort variants (per `mock-screen-reference-check` memory); (b) Diversity-constraint edge case (what if <15 items survive max-3-per-cuisine?); (c) Override-logic confirmation against 2.5-s10 sticky pattern |
| **2.6-s5** Stage 2 recovery | 🟡 Mostly ready | Operational definition | (a) Floor-breach scope: per household or per cuisine bucket? (b) Mass-block trigger scope: per household or globally? (c) "Trigger or not at all" discipline assertion in code-review checklist artifact (not just brief) |
| **2.6-s6** Cold-start fallback | 🟡 Engineering ready / mockup pending | UX + operational | (a) Cold-start fallback conversational mockup; (b) Confidence threshold heuristic ("<5 items per bucket") locked or marked TBD-with-owner; (c) M5 finalize threshold relaxation to `>=3` confirmed safe |

**Bottom line:** All 6 slices have engineering paths clear. Blocking work is **UX (2 mockups), content (1 seed file), and prompt-authoring (1 file)** — none of which require engineering capacity. `2.6-s1` can start today; `2.6-s2` through `2.6-s6` unblock as the listed deliverables land.

---

## 4. Cross-Cutting Gaps (Apply Across Epic 2.6)

### 4.1 PRD amendments (pre-2.6-s1 ideally)

Three FR-level updates required:

| FR | Action | Wording sketch |
|---|---|---|
| **FR129** | **Amend** | Currently "10 favorite lunches"; reword to reference catalog as `recipes` + `household_recipe_usage` with `catalog_provenance` |
| **New FR** | **Add — Stage 0 baseline** | "System provides a curated baseline of ~50 lunch items for every household at signup, ensuring no household begins with a barren catalog." |
| **New FR** | **Add — cold-start fallback** | "When Stage 1 catalog confidence-per-cuisine-bucket falls below threshold, M5 entry surfaces a conversational tail instead of a sparse chip card." |

### 4.2 Architecture amendment (pre-2.6-s1 ideally)

New §X.X covering:
- Two-layer catalog model: Layer 1 (name+tags at Stage 1) vs. Layer 2 (full ingredients lazily via story 3-31 at plan-time)
- `catalog_provenance` enum semantics on `household_recipe_usage`
- Stage 0 / Stage 1 / Stage 2 worker descriptions (triggers, fallback paths, "trigger or not at all" discipline)
- Planner source-pool ordering rule (recommend: `declared` > `parent_added` > `plan_promoted` > `inferred`, within `confidence_score DESC`)

### 4.3 UX spec footnote

`ux-design-spec-household-food-catalog.md` is silent on persistence — currently the implementation-architecture detail is only in the Epic 2.6 brief. Add a one-paragraph footnote: catalog persists via `recipes` + `household_recipe_usage`, not a new `lunch_catalog` table; brief at `epic-2.6-brief.md` for rationale.

### 4.4 Terminology mismatch (minor, acceptable)

UX spec (lines 122–132) defines 5 provenance tiers: `parent_added` / `plan_promoted` / `curated_baseline` / `llm_refined` / `llm_seeded`. Brief uses 4-value enum: `declared` / `inferred` / `parent_added` / `plan_promoted` (`inferred` subsumes both `llm_seeded` and `llm_refined`).

**Resolution:** acceptable. The provenance *event log* (deferred to Epic 7 per UX spec line 276) captures Stage-of-origin granularity; the enum on `household_recipe_usage` is the coarse-grained planner-input field. Document this mapping in the architecture amendment.

---

## 5. Final Readiness Verdict

### Epic 3 paused slices

✅ **CLEARED TO RESUME.** All 6 slices have their contracts. Recommend starting with 3-25 (cascade head), then parallelizing 3-23/3-24, then 3-26/3-27/3-29 in dependency order.

Two non-blocking text edits:
- **3-24 Task 5**: resolve TODO with cross-reference to 3-25's `brief_state.plan_state`
- **3-29 AC**: add "≥3 distinct protein options" heuristic explicitly

These can land in-slice during implementation, not as a pre-step.

### Epic 2.6

🟡 **CONDITIONALLY READY.** Engineering paths are clear for all 6 slices. The blocking dependencies are:

**Critical-path before any slice ships (low engineering cost, high coordination cost):**
1. PRD amendment (FR129 + 2 new FRs)
2. Architecture amendment (§X.X two-layer model)
3. UX spec footnote (persistence layer)

**Slice-specific pre-flight (parallelizable, non-engineering):**
4. M5 personalized chip mockup (cohort variants) — blocks 2.6-s4
5. Cold-start fallback mockup — blocks 2.6-s6
6. ~50 curated baseline items in `curated-baseline.ts` — blocks 2.6-s2
7. `catalog-seed.prompt.ts` authoring — blocks 2.6-s3

**Operational definitions to lock (during slice authoring, not before):**
8. Stage 2 floor-breach scope (per household / per cuisine bucket)
9. Stage 2 mass-block scope (per household / globally)
10. Cold-start confidence threshold heuristic (`<5 items per bucket`?)
11. Encryption-drop security sign-off process for 2.6-s1
12. Catalog-seed normalization rules (case/diacritic/whitespace)

**2.6-s1 can start today** without items 4–11 — it's the schema + migration + Kitchen Profile read swap; nothing in its scope depends on mockups or prompts. The 3 critical-path items (PRD/Arch/UX) should land in parallel with 2.6-s1 implementation.

### Combined recommendation

Two streams can run in parallel:

**Stream A (engineering, starts now):**
- 2.6-s1 implementation
- 3-25 implementation (Epic 3 resume)

**Stream B (coordination + UX + content, in parallel):**
- PRD/Architecture/UX amendments
- Mockup authoring (M5 personalized + cold-start fallback)
- Curated baseline content authoring
- `catalog-seed.prompt.ts` authoring

When Stream B items land, the corresponding 2.6 slices unblock. By the time 2.6-s1 ships, most Stream B inputs should be in place for 2.6-s2 onward.

---

## 6. Edge-Case Hunter Pass (Appendix A)

Second pass: `bmad-review-edge-case-hunter` walked branching paths on the same scope. 31 unhandled paths identified — none are blockers, but several should be folded into slice ACs before authoring. Grouped by impact below; full JSON output in Appendix A.

### 6.1 Top critical paths (fold into slice ACs)

| # | Path | Slice to touch | Why it matters |
|---|---|---|---|
| 1 | M5 chip render fires before Stage 1 completes (5s timeout race) | `2.6-s4` | If Stage 1 LLM is still running, what does M5 render? Brief says "5s timeout → cold-start fallback" but doesn't say what blocks vs falls-through |
| 2 | `favorite_lunches` → `recipes` migration: row decrypt fails on corrupt ciphertext | `2.6-s1` | Single bad row aborts batch, or quarantine + continue? AC silent |
| 3 | `household_recipe_usage` INSERT succeeds but `recipes` INSERT fails on UNIQUE | `2.6-s1` | Transaction scope required; orphan rows otherwise |
| 4 | M5 finalize gate: 9 declared + override taken — does override force finalize-eligible or finalize-possible? | `2.6-s4` | Edge case in sticky logic inherited from 2.5-s10 |
| 5 | M5 chip tapped after server soft-forgot it between render and tap | `2.6-s4` | Inconsistent state — needs "chip still exists at tap-time" guard or graceful 410 |
| 6 | Layer 2 trigger at `PlansService.commit()`: 3-31 Tavily extraction fails for `source='catalog_seeded'` row | `2.6-s3` | Does plan commit fail, or fall back to alternative recipe, or surface to parent? Brief says "trigger" but not "on failure" |
| 7 | 3-25 hard-fail state persists in `brief_state` after next plan succeeds | `3-25` | Missing `clearIfSet()` on new plan path → parent still sees error after resolution |
| 8 | 3-25 audit + `brief_state` update not transactional | `3-25` | Audit shows failed, brief empty → silent failure mode |
| 9 | 3-26 `formatEstimatedTime()` uses server TZ instead of parent local | `3-26` | UX shows midnight instead of "~1 hour from now" |
| 10 | 3-27 variant passes base guardrail but variant itself introduces new allergen | `3-27` | "Try variant" tap → plan commit fails with allergen block, jarring UX |
| 11 | 3-27 `variant_proposal.plan_item_id` ambiguous when child has multiple items same day | `3-27` | Variant attached to wrong base item |

### 6.2 Architecture-level decisions to lock (operational definitions)

| # | Path | Decision needed |
|---|---|---|
| 12 | Floor-breach `<35`: pre-guardrail (raw 50) or post-guardrail (survivors)? | Lock denominator in 2.6-s5 AC |
| 13 | Mass-block `>50%`: same denominator question | Lock denominator in 2.6-s5 AC |
| 14 | Cold-start fallback: per-cuisine threshold or all-or-nothing? | Lock in 2.6-s6 AC — UX implication: parent could see chips for Anglo + fallback for Tibetan in same session |
| 15 | Stage 1 LLM emits item matching `curated_baseline_items` with **different** `allergen_flags` than baseline | Reconcile precedence: prefer baseline (deterministic) vs LLM (current-context)? — 2.6-s3 |
| 16 | Stage 1 idempotency: normalization of `canonical_name` for collision detection (case / diacritic / whitespace) | Lock in 2.6-s3 AC |
| 17 | `catalog_provenance` state transitions: `declared → forgotten`? `inferred → declared` on chip tap? `declared → parent_added` on Kitchen Profile rename? | Document state diagram in architecture amendment — Action #4 from retro applies here |
| 18 | 3-23 + 3-25 interaction: allergen in snack-only slot — full plan hard-fails or just snack? | Spec says allergy is bag-wide (FR113); confirm 3-23 + 3-25 both honor this |
| 19 | 3-25 retry counter: what counts as "attempt"? guardrail-block vs LLM-error vs uncertain-substitute-fail? | Lock definition in 3-25 AC |

### 6.3 Process / operational gaps (lower urgency)

| # | Path | Owner |
|---|---|---|
| 20 | Stage 0 materialization fires at household creation, before M1/M2 — baseline uses defaults | 2.6-s2 should specify what "defaults" means |
| 21 | Stage 2 recovery fires while Stage 1 still in-flight (race) | 2.6-s5 sequencing |
| 22 | Stage 2 produces zero items (cascade fail) | 2.6-s5 needs terminal fallback |
| 23 | 3-24 `isIngredientUncertain` false-negative on novel ingredient not in heuristic patterns | Acceptable for MVP per 3-24; doc as known limitation |
| 24 | 3-24 substitution succeeds but substituted plan blocks on different allergen | Re-run guardrail on substituted plan — confirm 3-24 Task 2-3 does this |
| 25 | 3-25 concurrent retries (cron + manual regen) | Idempotent stage tracking via attempt_id |
| 26 | 3-26 `plan_state` oscillation (`hard_failed → cleared → hard_failed`) — `plan_state_set_at` monotonic? | 3-25 migration should clarify |
| 27 | 3-26 rendered with `plan_state='hard_failed'` but no `plan_tile_summaries` in brief | UX placement test |
| 28 | 3-29 `sovereignty_mode='alternating'` rotation at year boundary | Operational edge — define week numbering |
| 29 | 3-29 mode toggle while Stage 2 recovery in-flight for prior mode | Cancel pending recovery on mode change |
| 30 | Post-M5 micro-survey partial response (Likert started, not finished) | Survey instrument spec for Bet #1 measurement |
| 31 | M5 connection drops mid-selection — partial selections persisted or rolled back? | 2.6-s4 resume semantics |

---

## Appendix A — Edge-Case Hunter Raw Output

Strict JSON from the second-pass skill run:

```json
[
  {"location":"epic-2.6-brief:S1.M5","trigger_condition":"M5 entry fires before Stage 1 completes","guard_snippet":"block or render cold-start?","potential_consequence":"race: 5s timeout vs async LLM still running"},
  {"location":"epic-2.6-brief:S4-AC","trigger_condition":"Stage 1 → Stage 2 floor-breach (<35 items post-guardrail)","guard_snippet":"guardrail filter applied?","potential_consequence":"who counts: all 50 before guardrail or post-guardrail?"},
  {"location":"epic-2.6-brief:S4-AC","trigger_condition":"mass-block >50% of Stage 1 items","guard_snippet":"denominator for %: all 50 or filtered?","potential_consequence":"different cohorts hit different thresholds on denominator"},
  {"location":"epic-2.6-brief:S4.2.6-s3-AC","trigger_condition":"LLM response incomplete or schema-invalid","guard_snippet":"schema validation before persist?","potential_consequence":"partial rows inserted, items=[empty]"},
  {"location":"epic-2.6-brief:S4.2.6-s3-AC","trigger_condition":"Idempotency: re-run Stage 1 for same household","guard_snippet":"normalized canonical_name collision detection?","potential_consequence":"duplicate recipes rows or silent no-op depending on impl"},
  {"location":"epic-2.6-brief:S4.2.6-s4-AC","trigger_condition":"M5 finalize gate: 9 declared OR override taken","guard_snippet":"override means finalize-eligible or finalize-possible?","potential_consequence":"is override sticky for the turn or per-tap?"},
  {"location":"epic-2.6-brief:S4.2.6-s2-AC","trigger_condition":"Stage 0 materialization at household creation, before M1/M2 complete","guard_snippet":"M1/M2 signals exist yet?","potential_consequence":"baseline uses defaults; M1-M4 later overrides don't re-validate Stage 0"},
  {"location":"epic-2.6-brief:S3.migration","trigger_condition":"favorite_lunches decryption fails on a row (corrupt ciphertext)","guard_snippet":"rollback for single bad row or abort all?","potential_consequence":"partial migration or downtime"},
  {"location":"epic-2.6-brief:S4.2.6-s4-AC","trigger_condition":"parent taps a chip, between render and tap it becomes soft-forgotten","guard_snippet":"chip still exists in query or filtered out?","potential_consequence":"inconsistent state: chip shown but can't tap, or taps succeed on deleted row"},
  {"location":"epic-2.6-brief:S4.2.6-s3","trigger_condition":"Stage 1 LLM call timeout (>5s p95)","guard_snippet":"fallback to Stage 0 baseline or cold-start?","potential_consequence":"M5 renders empty or stale catalog, parent gets generic experience"},
  {"location":"ux-design:Stage1","trigger_condition":"LLM generates items matching curated_baseline but with DIFFERENT allergen_flags","guard_snippet":"take LLM flags or baseline flags?","potential_consequence":"guardrail verdict differs on same item depending on source"},
  {"location":"ux-design:cold-start","trigger_condition":"confidence-per-cuisine below threshold in SOME cuisines but not others","guard_snippet":"all-or-nothing fall-through or per-cuisine?","potential_consequence":"parent gets fallback for Tibetan but chips for Anglo — inconsistent UX"},
  {"location":"3-23:AC2","trigger_condition":"allergen in snack slot, school policy is snack-scoped only","guard_snippet":"guardrail bag-wide applies to snack?","potential_consequence":"full plan blocked or snack only fails and main committed?"},
  {"location":"3-24:Task1","trigger_condition":"isIngredientUncertain() matches AMBIGUOUS_PATTERNS but parent already knew risk","guard_snippet":"parent-declared allergen vs inferred?","potential_consequence":"false positive: spices flagged unsafe when parent has no known allergen risk"},
  {"location":"3-24:Task2-3","trigger_condition":"verdict='uncertain' + attempted substitution succeeds + substituted plan then blocks on allergen","guard_snippet":"re-run guardrail on substituted plan?","potential_consequence":"escalates to hard-fail despite successful substitution"},
  {"location":"3-25:AC1","trigger_condition":"hard-fail fired, then ops resolves constraint, next plan generation succeeds","guard_snippet":"clearIfSet() called on new plan?","potential_consequence":"hard-fail state persists in brief_state, parent still sees error"},
  {"location":"3-25:Task3","trigger_condition":"hard-fail escalation writes audit but brief_state update fails","guard_snippet":"transaction or separate calls?","potential_consequence":"audit shows failed, brief empty, parent sees no error on frontend"},
  {"location":"3-25:Task4","trigger_condition":"concurrent retries: one from scheduled cron, one from manual regen request","guard_snippet":"idempotent stage tracking?","potential_consequence":"duplicate attempts logged, different attempt counts in audit metadata"},
  {"location":"3-26:Task4","trigger_condition":"plan_state=hard_failed, but no plan_tile_summaries in brief","guard_snippet":"<FreshnessState> placement with no tiles?","potential_consequence":"<AccountableError> floats orphaned above empty plan area"},
  {"location":"3-26:Task2","trigger_condition":"formatEstimatedTime() called with failedAt from different timezone","guard_snippet":"parent's local timezone vs server TZ?","potential_consequence":"estimated time shows midnight instead of local 1-hour estimate"},
  {"location":"3-27:Task5-6","trigger_condition":"variant_proposal confirmed, plan committed, but parent re-visits M5 before variant ships","guard_snippet":"variant_proposal.confirmed_at but plan not yet persisted?","potential_consequence":"double-tap risk: parent confirms twice or variant orphaned"},
  {"location":"3-27:Task3","trigger_condition":"variant_proposal references plan_item_id for a child with multiple items same day","guard_snippet":"which plan_item_id is base?","potential_consequence":"variant attached to wrong item or ambiguous base recipe"},
  {"location":"3-27:Task7","trigger_condition":"variant proposal passes guardrail on base but fails on variant (e.g., variant contains new allergen)","guard_snippet":"variant passes guardrail check before render?","potential_consequence":"parent taps [Try variant], plan commit fails with uncertainty/block"},
  {"location":"3-29:Task2","trigger_condition":"sovereignty_mode='alternating' with even cultural rules, rotating by day leaves one rule unhosted","guard_snippet":"rotation logic defined or LLM discretion?","potential_consequence":"some traditions never lead a day, inconsistent household experience"},
  {"location":"3-29:Task4","trigger_condition":"parent toggles sovereignty_mode but Stage 2 recovery in-flight for prior mode","guard_snippet":"mode switch cancels pending recovery?","potential_consequence":"recovery finishes with unified rules after mode changed to alternating"},
  {"location":"3-29:Task1","trigger_condition":"households.sovereignty_mode_updated_at is NULL after toggle","guard_snippet":"update atomicity of sovereignty_mode + timestamp?","potential_consequence":"race: timestamp missing, ops can't order concurrent mode switches"},
  {"location":"epic-2.6:2.6-s1 migration","trigger_condition":"household_recipe_usage INSERT for M5 favorite succeeds but recipes INSERT fails on UNIQUE","guard_snippet":"transaction scope or separate INSERTs?","potential_consequence":"orphaned household_recipe_usage without recipe_id FK"},
  {"location":"epic-2.6:S4.2.6-s4","trigger_condition":"M5 chip card renders, parent selects 8 chips, connection drops mid-finalize","guard_snippet":"partial selections persisted or rolled back?","potential_consequence":"on resume, M5 shows <8 items, parent re-selects, confidence_score inflated"},
  {"location":"ux-design:Moment1","trigger_condition":"post-M5 micro-survey: parent abandons before completing Likert","guard_snippet":"partial response counts as signal or null?","potential_consequence":"incomplete survey data biases Bet #1 falsification metrics"},
  {"location":"epic-2.6:S2","trigger_condition":"Stage 0 baseline materialization skips items after guardrail blocks some","guard_snippet":"materialized count < ~50 baseline items, ever?","potential_consequence":"M5 fall-through triggered from Stage 0 alone if Stage 1 also low"},
  {"location":"3-24:Task4","trigger_condition":"SafeSubstitutionService replaces 'spices' but recipe still has 'spice blend' (spelling variant)","guard_snippet":"exact string match or fuzzy normalization?","potential_consequence":"partial substitution, some ambiguous ingredients remain"}
]
```

---

## 7. Final Verdict (Combined Passes)

**Epic 3 paused slices:**
- ✅ All 6 cleared to resume
- 7 edge-case findings to fold into slice ACs before authoring (items 7–11, 18–19, 23–29 above)
- None are blockers; all can be addressed during slice authoring

**Epic 2.6:**
- 🟡 Engineering paths clear; pre-flight items (mocks, content, prompt, amendments) parallelizable with `2.6-s1`
- 14 edge-case findings to fold into slice ACs (items 1–6, 12–17 above)
- Critical: chip render race (#1), migration atomicity (#2, #3), Layer 2 trigger failure path (#6) — these need explicit AC language before `2.6-s1` ships
- Operational definitions (#12–17) need locking during slice authoring, can be deferred to slice spec authoring

**Combined recommendation:**
1. Update Epic 2.6 brief or per-slice specs to fold findings #1–#6 and #12–#17 into AC language
2. Update Epic 3 slice specs (3-24, 3-25, 3-26, 3-27, 3-29) to address findings #7–#11, #18–#19, #23–#29 during authoring
3. Proceed with Stream A (2.6-s1 + 3-25 engineering) in parallel with Stream B (PRD/Arch/UX + mocks + content)
