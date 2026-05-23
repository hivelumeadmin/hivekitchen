# Retrospective — Epic 2.5: Onboarding Robustness & Kitchen Map Completion

**Date:** 2026-05-23
**Facilitator:** Amelia (Developer persona)
**Project Lead:** Menon
**Format:** Full facilitated dialogue (focus: patterns worth repeating)

---

## Epic Summary

**Scope:** Pivot sprint born from a Course-Correct on 2026-05-19. Previous Epic 2 shipped onboarding components but the Kitchen Map projection was malnourished — ~20% of required structured data was actually captured at finalize. Epic 2.5 closed that gap.

**Delivery:**
- **11 / 11 slices done** (`2.5-s1` foundation through `2.5-s11` Kitchen Profile live read)
- **7 of 8 named gaps closed in-epic; 1 explicitly deferred** (structured schools → Epic 5)
- **PRD additions:** FR121–FR130; **Architecture amendments:** A1–A8; **UX additions:** U1–U5
- **6 paused Epic 3 stories** (3-23 → 3-27, 3-29) now unblocked
- **Locked 3-axis policy** (enforcement × capture-priority × interaction-style) held all 11 slices without revision

**Quality:**
- 707 contract tests passing; 66 API route tests; 342/348 web component tests (6 pre-existing failures unrelated)
- No new regressions; encryption pattern (envelope DEK) extended cleanly to 5 new structured tables
- Code review intensity: most slices 1 pass; `2.5-s10` finalize gate required 3 passes for sticky-state logic
- Technical debt incurred: all Low severity — pre-existing patterns or explicitly deferred edges

---

## What Went Well — Patterns Worth Repeating

### Wins captured

1. **Locked 3-axis policy held without revision across 11 slices** — exceptionally rare for upfront architecture; the Course-Correct on 2026-05-19 produced a framework that survived contact with reality.

2. **Stub→real migration pattern across slices** — `2.5-s1` created stub tool factories with deterministic UUIDs; each moment slice (`s5`–`s9`) replaced one stub with real DB persistence. Decoupled contract-landing from wiring; enabled parallel review.

3. **Per-row tool design for declarations** — `allergen.declare(child_id, allergen)` is one allergen per call, not batched. Multi-tool parallel inference handles N allergens → N parallel calls. Clean audit trail; idempotency via unique index; no silent drops.

4. **MOCK-REF discipline** — in-repo mockups at `apps/web/src/features/onboarding-mockups/` became canonical design authority. Stitch retired 2026-05-19; the `mock-screen-reference-check` memory holds.

5. **Kitchen Map composer cache invalidation as a free pattern** — `AFTER INSERT OR UPDATE OR DELETE` triggers on all new tables bump `households.kitchen_map_version`. Zero stale-read bugs across 11 slices; no per-slice cache-busting logic.

### Patterns adopted as formal doctrine (PM decision)

- **#2 — Stub→real slice progression** ✅
- **#4 — MOCK-REF discipline** ✅ (already encoded in `mock-screen-reference-check` memory)
- **Locked-policy upfront via Course-Correct** ✅

Per-row tool design (#3) noted as "useful tactic, not doctrine" — works for declarations but may not generalize to all multi-item domains.

---

## What Didn't — Recurring Friction

1. **Race-condition fallback proliferation on encrypted-text upserts.** Functional-index upsert conflicts (Postgres 42P10) forced the same hand-rolled insert→23505→SELECT fallback in `2.5-s6` (`child_allergens`), `2.5-s7` (`food_preferences`, `household_rules`), and `2.5-s9` (`favorite_lunches`). Safe and idempotent but four hand-rolled instances signals a missing abstraction.

2. **`2.5-s10` finalize gate required 3 review passes for sticky-state logic.** The `m5_complete` sticky path (once true, stay true, even after override-fewer) was conceptually correct but kept drifting in implementation. The slice spec listed acceptance criteria but no state diagram; transitions were discovered in review.

3. **Mockup ↔ contract reconciliation friction in early slices** (`2.5-s3`, `2.5-s5`, `2.5-s8`). Chip keys, enum values, copy verbatim — these came up at review time, not at slice-spec time. MOCK-REF helped enormously but didn't eliminate the work.

---

## Significant Discovery — Architectural Collision (Mid-Retro)

**Discovered during retrospective dialogue 2026-05-23.**

The Household Food Catalog UX spec (`_bmad-output/planning-artifacts/ux-design-spec-household-food-catalog.md`, finalized 2026-05-23) supersedes two Epic 2.5 design choices:

1. **Static 18-chip global M5 catalog** sourced from `apps/api/src/agents/prompts/onboarding.prompt.ts` — violates the *"only suggests things that fit"* promise for non-Anglo households.
2. **Standalone `favorite_lunches` table** — disconnected from the structured `recipes` + `household_recipe_usage` tables that story 3-31 had shipped two weeks earlier. The architecturally-honest version of the catalog concept is `household_recipe_usage` + a `catalog_provenance` column, NOT a parallel table.

Pre-approval schema review while drafting the Epic 2.6 brief surfaced the second collision: the brief's first revision proposed a new `lunch_catalog` table that was redundant with shipped infrastructure. Revision 2 replaced this with minimal extensions to `recipes` + `household_recipe_usage` and adopted a **two-layer model** (Layer 1 name+tags at Stage 1; Layer 2 full ingredients lazily via story 3-31).

**Resolution:** Epic 2.6 brief authored, revised, and approved 2026-05-23 (`_bmad-output/planning-artifacts/epic-2.6-brief.md`). Epic 2.6 added to `sprint-status.yaml` with 6 slices.

**Lesson encoded:** schema cross-check before new tables (Action #6 below).

---

## Epic 3 Resume Readiness

**Verdict:** All 6 paused Epic 3 stories (3-23, 3-24, 3-25, 3-26, 3-27, 3-29) have their data contracts ready. Resume is safe.

| Paused Story | Required Contract | Delivered By |
|---|---|---|
| 3-23 per-slot policy scoping / bag-wide allergy rule | `child_allergens` + `enforcement_level` + `household_rules` | 2.5-s1, 2.5-s6, 2.5-s7 |
| 3-24 allergy uncertainty / safe substitution | `allergens-without-severity` contract; allergenConfidence on recipes | 2.5-s1 AC; 3-31 (already done) |
| 3-25 hard-fail escalation | Enforcement gradient (precedence logic is in-Epic-3 scope) | 2.5-s1 |
| 3-26 graceful degradation state UX | Enforcement strength populated | 2.5-s5 through 2.5-s9 |
| 3-27 variant prep / active learning | `food_preferences` + enforcement data | 2.5-s7 |
| 3-29 degraded propose / sovereignty toggle | Tight-constraints set | 2.5-s5 through 2.5-s10 |

**Recommended resume order:** 3-25 first (precedence rules) — decisions cascade into 3-24, 3-26, 3-29.

**Worth tracking (non-blocking):**
- Cultural-template CHECK constraint dropped in 2.5-s7 — re-add when vocabulary service exists (Epic 3+ hardening)
- 5 pre-existing `child.upsert` mock failures in `onboarding.tools.test.ts` — clean up during 3-25 or as housekeeping
- DEK zeroing pattern — security hardening pass

---

## Readiness Assessment (Epic 2.5 As Actually-Done)

| Dimension | Status |
|---|---|
| Testing & Quality | ✅ All targeted tests passing; no new regressions |
| Deployment | ✅ CI-gated branch; reviews complete |
| Stakeholder Acceptance | ✅ PM approved each slice's code review; no escalations |
| Technical Health | ✅ No new architectural inconsistencies beyond what Epic 2.6 brief now addresses |
| Unresolved Blockers | ✅ None for Epic 3 resume |

**Epic 2.5 is genuinely complete.** The catalog architectural collision was a successor-architecture issue, not a 2.5 defect.

---

## Action Items

### Process — Doctrine Adoption

| # | Action | Owner | Trigger |
|---|---|---|---|
| 1 | Codify **stub→real slice pattern** in `_bmad-output/project-context.md` | Dev | Next epic with ≥4 tool slices (Epic 6 grocery / Epic 7 memory) |
| 2 | Codify **locked-policy upfront via Course-Correct** as practice | PM | At next epic-defining Course-Correct |
| 3 | MOCK-REF discipline — already encoded in `mock-screen-reference-check` memory; keep applying | — | ongoing |

### Process — Friction Fixes

| # | Action | Owner | Trigger |
|---|---|---|---|
| 4 | **State diagrams in slice specs** for gates with override/sticky-state paths — add to slice template | Dev | Any 2.6 slice with sticky-state (notably 2.6-s4 inherits 2.5-s10 finalize logic) |
| 5 | **Contract↔mockup mapping table** in slice specs for UI-touching slices — chip-key/enum/copy mapping before implementation | Dev | 2.6-s4, 2.6-s6 |
| 6 | **Schema cross-check before new tables** — when a slice introduces a new persistence table, grep `supabase/migrations/` for adjacent shipped tables first | Dev | 2.6-s1, then ongoing |

### Technical Debt (Deferred, Not Blocking)

| # | Item | Notes |
|---|---|---|
| 7 | Extract race-condition fallback helper OR commit to projection tables for hash-keyed sensitive data | Reaching the right cost threshold (Epic 2.6 will add a 5th instance via 2.6-s1 migration) |
| 8 | Cultural-template CHECK constraint dropped in 2.5-s7 — re-add when vocabulary service exists | Epic 3+ hardening |
| 9 | 5 pre-existing `child.upsert` mock failures in `onboarding.tools.test.ts` | Test cleanup |
| 10 | DEK zeroing pattern | Security hardening pass |

### Significant Discovery Follow-Through

| # | Action | Status |
|---|---|---|
| 11 | Epic 2.6 brief created + approved | ✅ done 2026-05-23 |
| 12 | Sprint-status updated with Epic 2.6 block | ✅ done 2026-05-23 |
| 13 | Architecture amendment for two-layer catalog model | Open (pre-2.6-s1) |
| 14 | PRD amendment (FR129 + new FRs) | Open (pre-2.6-s1) |
| 15 | UX spec footnote on persistence layer | Open (pre-2.6-s1) |

---

## Key Takeaways

1. **MVP work that ships and exposes the next iteration is a feature, not a bug.** Epic 2.5's static M5 catalog and standalone `favorite_lunches` table both worked; they made the successor architecture (catalog UX spec, Epic 2.6) possible by making the gaps concrete.

2. **Schema cross-check before new tables is now non-negotiable.** Both Epic 2.5 collisions (favorite_lunches vs recipes; lunch_catalog vs household_recipe_usage) stemmed from missing this step. Action #6 codifies it.

3. **State diagrams in slice specs would have saved review passes** on `2.5-s10`. Action #4 adds them to the slice template.

4. **The Course-Correct → locked-policy pattern paid off.** The 3-axis policy held 11 slices. Worth keeping for future cross-cutting work.

5. **Per-slice review intensity was a signal.** Slices needing >1 review pass clustered around state machinery (`2.5-s10`) and mockup reconciliation (early slices) — the same patterns Actions #4 and #5 address.

---

## Next Steps

1. **Epic 3 resume:** Start with 3-25 (precedence rules); 3-23/24/26/27/29 follow in dependency order.
2. **Epic 2.6 pre-flight:** Author M5 personalized chip mockup (cohort variants), cold-start fallback mockup, PRD amendment (FR129 + new FRs), Architecture amendment (two-layer model), UX spec footnote, ~50 curated baseline items hand-tagged.
3. **Epic 2.6 execution:** 2.6-s1 (schema + migration + Kitchen Profile read swap) is clear to start immediately; other slices unblock as pre-flight items land.
4. **Action items 1–6:** roll into ongoing practice; review at next retro.
