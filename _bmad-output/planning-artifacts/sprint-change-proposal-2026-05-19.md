# Sprint Change Proposal — Onboarding Robustness & Kitchen Map Completion

**Date:** 2026-05-19
**Author:** John (PM persona via `bmad-correct-course` workflow)
**Triggered by:** Menon (PM-led requirements review)
**Scope classification:** **Major** (per checklist 5.5 — fundamental replan needed)
**Status:** Awaiting approval

---

## Section 1 — Issue Summary

### Problem statement

Onboarding was specified and shipped against a **narrow 3-signal-question contract** ("grandmother's food / Friday rhythm / child's refusal") with three structured tools (`child.upsert`, `cultural.note`, `memory.note`). The end-to-end acceptance gate was never specified as **"Kitchen Map populated at finalize"** — only as "components shipped."

A PM-led requirements review on 2026-05-19 surfaced that the **shipped onboarding produces only ~20% of the data the Kitchen Profile / Kitchen Map projection requires**. Eight specific gaps were enumerated, and three product-policy axes were locked: enforcement strength × capture priority × interaction style.

### How discovered

Cross-referencing the Kitchen Profile UI (already scaffolded under `apps/web/src/features/kitchen-profile/`, backed by the `KitchenMapSchema` contract in `packages/contracts/src/kitchen-map.ts`) against what the OnboardingAgent's tool surface can actually write. The UI rendering needs a structured shape that the tools cannot produce. The mismatch had been masked by the kitchen-profile mock data file (`mockData.ts`) which renders convincingly without real data flowing through.

### Evidence (8 specific gaps)

1. **Bag composition** — Present in `KitchenMapChildSchema` but no onboarding tool writes it. Kitchen Profile rendering would show null/default.
2. **Household-scope food identity** — Schema moved to household level (story 2-s27) but `child.upsert` still writes per-child; a backfill script does the rollup post-hoc. Onboarding never natively captures "this is a Halal household" as a household fact.
3. **Cultural ratification state mismatch** — Onboarding produces only `'suggested'` priors. Kitchen Profile UI mock renders ratified copy. At end of onboarding, `cultural.active = []`.
4. **Structured schools** — UI assumes structured schools entity; onboarding only writes free-text `school_policy_notes`. (Deferred to Epic 5.)
5. **Constraint-strength dimension** — Entirely missing from current schema and tools. No way to distinguish *"Halal — non-negotiable"* from *"we cook Punjabi but try new things."*
6. **Allergen disambiguation** — `declared_allergens` is `string[]` with no routing between "medical allergen" and "hates that food."
7. **10 favorite lunch items** — No tool, no flow, no storage today. Cold-start plan generation has no seed corpus to draw from.
8. **Chip-driven turn model** — Agent prompt + turn contract + chat UI are all prose-only. No structured choice chips, no bundled-payload submission.

### Categorization

Per checklist item 1.2: **Misunderstanding of original requirements.** The original Epic 2 acceptance reflected per-story completion (each component shipped + unit tests pass) but the end-state contract was never an explicit gate. This is a contract-design oversight, not a build defect.

---

## Section 2 — Impact Analysis

### Epic Impact

| Epic | Status before | Status after | Notes |
|---|---|---|---|
| **Epic 2 — Household Onboarding & Profile** | `in-progress` (most stories `done`) | Unchanged — Epic 2 stays as-is. Epic 2.5 carries the new work. | Epic 2 acceptance retained; "components-done" history preserved. |
| **Epic 2.5 — Onboarding Robustness & Kitchen Map Completion** | — | **NEW. `backlog` → in-progress when first slice begins.** | 11 vertical slices. Single focused sprint. |
| **Epic 3 — Weekly Plan & Ready-Answer Open** | `in-progress`; 23 stories `done`, 8 `ready-for-dev` | **6 of 8 ready-for-dev stories PAUSED.** 2 proceed in parallel. | Pause: 3-23, 3-24, 3-25, 3-26, 3-27, 3-29 (all touch enforcement contract). Proceed: 3-28 (lunch link pause infra), 3-30 (LLM failover infra). |
| **Epic 7 — Visible Memory & Trust** | `backlog` | **Unblocked by Epic 2.5 completion.** | 7-s1 (Visible Memory read) can start immediately after 2.5-s10 + 2.5-s11. |
| **Epic 12 — Ambient Lumi** | `in-progress` (Phase 1+2 done); 12-s8+ `backlog` | **12-s9 gains an acceptance note** — must honor `enforcement` field when started. No pause. | Soft dependency only. |
| **Epics 4, 5, 6, 8, 9, 10, 11** | `backlog` (mostly) | No change. | No direct contract dependency. |

### Story Impact

**Paused (Epic 3):** 6 stories
- `3-23-per-slot-policy-scoping-bag-wide-allergy-rule`
- `3-24-allergy-uncertainty-flagging-safe-substitution`
- `3-25-hard-fail-escalation-no-safe-plan-possible`
- `3-26-graceful-degradation-state-ux`
- `3-27-variant-preparation-active-learning-visible-to-parent-before-delivery`
- `3-29-degraded-propose-state-with-try-alternating-sovereignty-toggle`

All flip from `ready-for-dev` → `backlog` with pause comment citing Epic 2.5 dependency.

**Added (Epic 2.5):** 11 slices (see Section 4 Pass A for full detail)

**Status unchanged (Epic 2 historical):** All shipped Epic 2 stories stay `done`. The Epic 2.5 work is additive, not retroactive.

### Artifact Conflicts

| Artifact | Conflict | Pass | Action |
|---|---|---|---|
| **PRD** (`_bmad-output/planning-artifacts/prd.md`) | FR6, FR7, FR107 need amendment; FR121–FR130 to add; MVP narrative for Onboarding & Profile group | B.1 | 4 amendments + 10 new FRs |
| **Architecture** (`_bmad-output/planning-artifacts/architecture.md`) | §1.2 (memory_nodes enum), §1.2b (new structured tables), encrypted field set, OnboardingAgent contract, guardrail precedence rules, tool manifest, KitchenMapSchema docs | B.2 | 8 amendments |
| **UX Spec** (`_bmad-output/planning-artifacts/ux-design-specification.md`) | Emotional Journey copy, design system token family, component inventory, chaptered conversation mental model, Kitchen Profile visual treatment | B.3 | 5 amendments |
| **Sprint Status** (`_bmad-output/implementation-artifacts/sprint-status.yaml`) | 6 Epic 3 pauses, new Epic 2.5 block, mock-screen reference annotations | C.1, C.2, C.4 | Direct edits |
| **Epic 2 verification thread catalog** | New VT entries for Epic 2.5 acceptance gates | C.3 | 10 new VT entries (VT-2.5-T1 through VT-2.5-T10) |
| **Contracts** (`packages/contracts/src/`) | `kitchen-map.ts` extensions; `onboarding-tools.ts` extensions; new contract files | A.2.5-s1 | Code change via slice 2.5-s1 |
| **DB migrations** (`supabase/migrations/`) | New enum, 5 new tables, column additions, backfill | A.2.5-s1, A.2.5-s2 | Code changes via slices 2.5-s1 and 2.5-s2 |
| **Agent prompt** (`apps/api/src/agents/prompts/onboarding.prompt.ts`) | Full rewrite v1 → v2 | A.2.5-s4 | Code change via slice 2.5-s4 |
| **Web feature** (`apps/web/src/features/onboarding/`) | Chip rendering, bundled payload, explicit Send, 5 moment views + summary | A.2.5-s3 through s10 | Code changes via moment slices |
| **Kitchen Profile UI** (`apps/web/src/features/kitchen-profile/`) | Replace mock data with live KitchenMapSchema reads; enforcement visual treatment; drop allergen severity | A.2.5-s11 | Code change via slice 2.5-s11 |
| **Project Context** (`_bmad-output/project-context.md`) | Add invariant: required-set completion gate | (post-approval) | One-line edit |

### Technical Impact

- **DB schema growth:** 1 new enum (`enforcement_level`), 5 new tables (`child_allergens`, `food_preferences`, `dietary_preferences`, `favorite_lunches`, `household_rules`), 2 column additions (`households.display_name`, `onboarding_state.current_moment`/`required_set_status`), 1 backfill migration with data movement.
- **Tool surface growth:** From 3 onboarding tools to ~9. Each new tool has clear single responsibility.
- **Composer query change:** Kitchen Map composer goes from ~7 source tables to ~12. Performance mitigation: single CTE-based SQL query, ~20–80ms cold path (Pass B.2 A2 performance note).
- **Encryption scope shift:** Allergens move from `children.declared_allergens` JSONB to `child_allergens.allergen` (encrypted column-level). `food_preferences.item` added to encryption set.
- **Realtime / SSE:** No new realtime channels needed. Existing onboarding turn SSE channel carries the extended chip payload.
- **Cost impact:** Negligible. More tool calls per turn (parallel) but same overall token volume per onboarding session. No new external services.

---

## Section 3 — Recommended Approach

### Selected path: Hybrid — Direct Adjustment + PRD MVP Review

**Concretely:** Create **Epic 2.5** to carry the new work AND amend the PRD MVP definition for onboarding to include the required-set completion gate. Pause downstream Epic 3 stories that depend on the new contract; unblock Epic 7 by Epic 2.5 completion.

### Why this path over alternatives

**Why not Direct Adjustment alone (Option 1).** The new policy is too large to be a tweak to Epic 2's existing stories. Reopening Epic 2 muddles the "components-done" narrative. New work deserves a clean container.

**Why not Rollback (Option 2).** Nothing shipped is wrong. Existing stories built foundational capability that Epic 2.5 extends. Rollback would discard work that doesn't conflict with the new policy.

**Why not PRD MVP Review alone (Option 3).** MVP definition needs to shift, but redefinition without a delivery vehicle is paperwork. Epic 2.5 is the delivery vehicle that makes the redefinition real.

**Why the hybrid works.** Clean narrative: Epic 2 = "components built." Epic 2.5 = "onboarding actually populates Kitchen Map." Future retrospectives can analyze the two epics separately to extract the lesson about upfront contract design.

### Trade-offs accepted

- **+1 sprint of work** inserted ahead of Epic 3 resumption. Net delivery delay for Epic 3 features is bounded.
- **6 Epic 3 stories paused** rather than allowed to ship against the old contract. Prevents double-work but delays planner-side polish.
- **Larger tool surface** (~9 tools vs 3). More surface area but each tool is unambiguous and matches its data model.
- **More structured DB tables** (5 new). Composer touches more tables; mitigated by single CTE pattern.

### Risk assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Chip turn UX is genuinely new pattern; may require iteration | Medium | Medium | Slice 2.5-s3 is gated as the "chip UX wall" — first slice that touches the new pattern. Iterate against the in-repo mock screen at `apps/web/src/routes/_dev-onboarding-mockups.tsx` before downstream moment slices commit. |
| Agent state-awareness contract is non-trivial to implement | Medium | High | Slice 2.5-s4 is a dedicated slice. Includes prompt-level required-set tracker design, not just code. Reviewed independently before moment slices. |
| Backfill migration could lose data | Low | High | Slice 2.5-s2 is a dedicated migration slice with explicit verification (VT-2.5-T10). Migrated rows are soft-forgotten (not deleted) and provenance preserved. |
| Kitchen Map composer cold-path latency at scale | Low | Medium | Single CTE query pattern documented; evolution path to projection table documented; defer evolution until measured p95 >150ms. |
| Mock screens may not yet cover all 5 moments | Medium | Low | MOCK-REF annotation on every UI-touching slice: dev agent checks `apps/web/src/features/onboarding-mockups/` first and only pauses to confirm with user if it is not 100% clear which mock screen is the foundation for the slice. |

### Timeline impact

- **Epic 2.5 sprint:** New work, single focused sprint.
- **Epic 3 resumption:** +1 sprint delay for 6 paused stories.
- **Epic 7 readiness:** Unchanged — Epic 7 was always waiting on the Kitchen Map data shape.
- **Net delivery delta to beta MVP:** Marginal. Onboarding quality compounds across every downstream epic — earlier investment pays back across the program.

---

## Section 4 — Detailed Change Proposals

### 4.A — Epic 2.5 slice list (11 slices)

| Slice | Demo path summary | Layers | Wall? | Mock-ref? |
|---|---|---|---|---|
| **2.5-s1** Foundation: enforcement contracts + DB schema | Run migrations + contract tests; new enums/tables exist; tools registered in `tools.manifest.ts`. No user-facing change. | DB, contracts, tool registry | — | No |
| **2.5-s2** memory.note narrowing + backfill | Existing memory_nodes rows with removed types migrate to new structured tables; soft-forget with migration provenance; enum tightened. | DB migration, agent contract | — | No |
| **2.5-s3** Chip turn UX primitive | Mock onboarding question renders chip group + freetype + Send button; tap chips, type extra, hit Send → bundled `{ chip_selections, text }` payload received by backend. | UI, contracts, tokens | 🚧 Chip UX wall | **Yes** |
| **2.5-s4** Agent prompt v2 + required-set tracker | Invoke OnboardingAgent with various pre-populated household states; agent picks next moment correctly; multi-tool parallel inference verified. Prompt v1 archived. | Agent, API, contracts | — | No |
| **2.5-s5** Moment 1 — "Who's at the table" | Fresh signup → Moment 1 view → household name capture (chips + freetype) → children + age bands (chip-driven) → tools fire parallel → resume mid-Moment-1 works. | UI, agent, tools, DB | — | **Yes** |
| **2.5-s6** Moment 2 — "What I need to keep safe" | Allergen chips render with "No known allergens"; explicit-response gate; `allergen.declare(child_id, allergen)` writes structured rows; no severity capture. | UI, agent, tools, DB | 🚧 Safety wall | **Yes** |
| **2.5-s7** Moment 3 — "How your kitchen tastes" | Cultural & Religious Identity multi-select; dietary; cuisine; food-preference chips; "Skip this moment" available; elevation chip appears when language signals strength; all tools fire parallel. | UI, agent, tools, DB | — | **Yes** |
| **2.5-s8** Moment 4 — "What goes in the bag" | Per-child bag composition chip group; selection writes via `child.upsert(... bag_composition)`. | UI, agent, tools, DB | — | **Yes** |
| **2.5-s9** Moment 5 — "A starting line for Lumi" | Lunch-item chips (multi-select) + freetype; target counter; `favorite_lunch.add` writes; gate enforces ≥10 (override available with confirm). | UI, agent, tools, DB | — | **Yes** |
| **2.5-s10** Summary + hard-elevation confirmation + finalize gate | Summary moment reads back captured data; hard elevations confirmed per chip; finalize transitions `is_onboarded=true`; refused finalize routes back to incomplete moment. | UI, agent, tools, DB, finalize gate | 🚧 **EPIC MVP WALL** | **Yes** |
| **2.5-s11** Kitchen Profile read against live data | `/kitchen-profile` reads from real `KitchenMapSchema`; enforcement visual treatment renders; allergens render uniformly (no severity tiers); skipped placeholders render with "Tell Lumi anytime" affordance. | UI, API | Unblocks Epic 7 | **Yes** |

**Sequencing graph:**

```
2.5-s1 (Foundation) ──┬──→ 2.5-s2 (Backfill)
                      │
                      ├──→ 2.5-s3 (Chip UX wall) ──┐
                      │                            │
                      └──→ 2.5-s4 (Agent v2) ──────┴──→ 2.5-s5 (M1)
                                                          │
                                                          ↓
                                                       2.5-s6 (M2 — SAFETY WALL)
                                                          │
                                                          ↓
                                                       2.5-s7 (M3) → 2.5-s8 (M4) → 2.5-s9 (M5)
                                                                                      │
                                                                                      ↓
                                                                            2.5-s10 (EPIC WALL)
                                                                                      │
                                                                                      ↓
                                                                            2.5-s11 (KP read)
```

**Out of scope (explicitly deferred):**
- Voice path (`2-s21`) — stays Epic 2 backlog per text-first policy
- Secondary caregiver capture — deferred
- Structured Schools entity — deferred to Epic 5
- Family rhythm capture as a primary moment — stays in `memory.note(rhythm)` if volunteered
- Cold-start plan generation logic consuming 10 favorites — that's Epic 3's job; Epic 2.5 only delivers the data

### 4.B — PRD amendments (Pass B.1)

**Amendments to existing FRs:**

| FR | Section | Change |
|---|---|---|
| **FR6** | Family Profile & Onboarding | Cultural templates list expanded to the merged Cultural & Religious Identity catalog; each entry carries `enforcement`. Full new text in Pass B.1. |
| **FR7** | Family Profile & Onboarding | Cultural inference + confirmation → hybrid ratification: soft signals committed as `suggested`; hard elevations confirmed at summary moment. Full new text in Pass B.1. |
| **FR107** | Lunch Bag Composition | "Can declare" → "must declare" with chip-suggested patterns; cited as gate condition for FR123. Full new text in Pass B.1. |
| **MVP narrative — Onboarding & Profile (Group 1)** | MVP Feature Set (Phase 1 — Closed Beta) | Reflects chaptered conversation, required-set gate, 10-lunch cold start. Full new text in Pass B.1. |

**New FRs (FR121–FR130) added to Family Profile & Onboarding section:**

| FR | Topic |
|---|---|
| **FR121** | Enforcement gradient (5 rungs); class floor + user elevation; planner/guardrail interpretation |
| **FR122** | Allergens always hard, no severity gradient; conversational routing for "allergic vs hates" disambiguation |
| **FR123** | Required-set completion gate (definition, refusal behavior) |
| **FR124** | Cold-start favorite-lunches seed (≥10 items, household-scoped) |
| **FR125** | Chip turn model (chip + freetype coexistence, explicit Send, bundled payload, structured-vs-inference routing) |
| **FR126** | Cultural & Religious Identity merged bucket (3 levels, default Just for context) |
| **FR127** | Skipped good-to-have placeholders in Kitchen Profile |
| **FR128** | Household name capture (`households.display_name`, used across surfaces) |
| **FR129** | Chaptered conversation structure (5 moments + summary, out-of-order accepted) |
| **FR130** | Agent state-awareness contract (required-set in system context, parallel tool inference, finalize refusal) |

Full text per FR in Pass B.1.

### 4.C — Architecture amendments (Pass B.2)

| ID | Section | Change |
|---|---|---|
| **A1** | §1.2 Visible Memory data model | `memory_nodes.node_type` enum narrowed to `('rhythm','child_obsession','other')`. Scope clarification: qualitative narrative only. |
| **A2** | NEW §1.2b — Structured signal tables | Five new tables: `child_allergens`, `food_preferences`, `dietary_preferences`, `favorite_lunches`, `household_rules`. `enforcement_level` enum. Composer performance contract: single CTE query, ~20–80ms cold path; evolution path to projection table documented. |
| **A3** | §1.2b (Cultural priors extension) | `cultural_priors.enforcement` column added; merged Cultural & Religious Identity bucket documented. |
| **A4** | §3.x Encrypted field set | Allergens move from `children.declared_allergens` JSONB to `child_allergens.allergen` (encrypted column-level). `food_preferences.item` added to encryption set. Migration note: JSONB column deprecated post-Epic-2.5. |
| **A5** | NEW §X — OnboardingAgent contract | Chaptered conversation contract; state-awareness contract; multi-tool inference discipline; finalize gate refusal behavior; anti-narration discipline extended to moments. |
| **A6** | Allergy Guardrail Service section | Conflict precedence rules added: child > household; medical > religious > cultural; recency tiebreaker; pinned > avoid (flag for review). |
| **A7** | §3.5 Tool manifest | 7 new tools registered (`household.set_name`, `allergen.declare`, `dietary.declare`, `cuisine.declare`, `food_preference.declare`, `favorite_lunch.add`, `rule.set`). 3 tools extended (`child.upsert`, `cultural.note`, `memory.note`). |
| **A8** | KitchenMapSchema documentation | New fields documented: `display_name`, `bag_composition_pattern`, `KitchenMapAllergenSchema[]`, `KitchenMapDietarySchema[]`, `KitchenMapFoodPreferenceSchema[]`, `KitchenMapFavoriteLunchSchema[]`, `KitchenMapRuleSchema[]`, `meta.required_set_complete`. |

Full text per amendment in Pass B.2.

### 4.D — UX spec amendments (Pass B.3)

| ID | Section | Change |
|---|---|---|
| **U1** | Emotional Journey Mapping, "Onboarding (first 10 minutes)" paragraph | Voice-interview ritual → chaptered conversation. Preserves warmth/listening intent. |
| **U2** | Design System Evolution 1 — Semantic token system | NEW token group `choice-chip-*` for interactive conversational choice chips. Distinct from `safety-cleared-*` (non-interactive) and `memory-provenance-*` (informational). |
| **U3** | Design System Evolution 4 — Component deltas (Add list) | NEW components: `<ChoiceChip>`, `<ChoiceChipGroup>`, `<TurnSendButton>`, `<SkipChip>`, `<MomentProgress>`, `<OnboardingChapterView>`. |
| **U4** | NEW section — Onboarding mental model (chaptered conversation) | Defines 5 moments + summary; what's preserved from v1 doctrine; what's new; anti-narration discipline. |
| **U5** | Kitchen Profile surface | Allergen badges uniform (no severity tiers); enforcement visual treatment per signal type; skipped good-to-have placeholders. |

Full text per amendment in Pass B.3.

### 4.E — Sprint Status & Verification Thread edits (Pass C)

**C.1 — Epic 3 story pauses (6 stories):**

| Story | New status | Comment |
|---|---|---|
| `3-23-per-slot-policy-scoping-bag-wide-allergy-rule` | `backlog` | PAUSED 2026-05-19 pending Epic 2.5 enforcement contract |
| `3-24-allergy-uncertainty-flagging-safe-substitution` | `backlog` | PAUSED 2026-05-19 pending FR122 (allergens-without-severity) |
| `3-25-hard-fail-escalation-no-safe-plan-possible` | `backlog` | PAUSED 2026-05-19 pending conflict precedence rules + enforcement gradient |
| `3-26-graceful-degradation-state-ux` | `backlog` | PAUSED 2026-05-19 pending enforcement strength data |
| `3-27-variant-preparation-active-learning-visible-to-parent-before-delivery` | `backlog` | PAUSED 2026-05-19 pending food_preferences + enforcement data |
| `3-29-degraded-propose-state-with-try-alternating-sovereignty-toggle` | `backlog` | PAUSED 2026-05-19 pending tight-constraints set knowledge |

**Continuing in parallel:** `3-28`, `3-30`.

**C.2 — New Epic 2.5 sprint-status block:** 11 slices + retrospective marker. Insertion after Epic 2 block in `sprint-status.yaml`.

**C.3 — Verification threads (10 new):** VT-2.5-T1 through VT-2.5-T10 added to `epic-2-verification-threads.md`. Full table in Pass C.3.

**C.4 — Mock-screen reference (`MOCK-REF`) annotations** on 8 UI-touching slices (2.5-s3, s5-s11). Dev agent must check the in-repo mock screens at `apps/web/src/routes/_dev-onboarding-mockups.tsx` and `apps/web/src/features/onboarding-mockups/` as the foundation, and only confirm with user if it is not 100% clear which mock screen applies. (Stitch retired as design source of truth as of 2026-05-19.)

**C.5 — Optional Epic 2 retrospective trigger** flagged.

---

## Section 5 — Implementation Handoff

### Scope classification: Major

Per checklist 5.5: this is a Major change requiring fundamental replan with PM and Architect involvement.

### Handoff plan

**Sequence:**

```
Phase 1 (parallel)
  ├─ John (PM)        → Amend PRD per Pass B.1 (4 amendments + 10 new FRs)
  ├─ Winston (Arch)   → Amend Architecture per Pass B.2 (8 amendments)
  └─ Sally (UX)       → Amend UX Spec per Pass B.3 (5 amendments)
                       + Draft/refresh chaptered conversation mock screens
                         under apps/web/src/features/onboarding-mockups/
                       + Draft choice-chip visual variants

Phase 2 (sequential)
  └─ John (PM)        → Author epic-2.5-onboarding-robustness.md
                       (slice-by-slice spec, mirror format of
                        epic-2-onboarding-integration.md)

Phase 3 (parallel where possible)
  └─ Amelia (Dev)     → Execute Epic 2.5 slices per sequencing graph
                        Before each UI-touching slice: check the in-repo mock
                        screens (apps/web/src/features/onboarding-mockups/)
                        as the design foundation; only confirm with user if
                        the relevant mock screen is unclear (MOCK-REF)
                        Acceptance against VT-2.5-T1 through VT-2.5-T10
```

### Roles & responsibilities

| Role | Responsibility | Deliverable |
|---|---|---|
| **John (PM)** | PRD amendments; Epic 2.5 spec authoring; required-set definition stewardship | Amended PRD; `epic-2.5-onboarding-robustness.md`; updated `sprint-status.yaml` |
| **Winston (Architect)** | Architecture amendments; contract design for new tools; DB migration design; composer query pattern | Amended `architecture.md`; new contract files in `packages/contracts/src/`; migration files in `supabase/migrations/` |
| **Sally (UX Designer)** | UX spec amendments; chaptered conversation copy; choice-chip visual design; mock-screen authoring/refresh under `apps/web/src/features/onboarding-mockups/` as needed | Amended `ux-design-specification.md`; new mock screens for moments; component visual specs for `<ChoiceChip>` family |
| **Amelia (Dev Agent)** | Slice-by-slice implementation per the sequencing graph; check the in-repo mock screens as the design foundation before each UI slice (MOCK-REF); only ask the user when the relevant mock screen is unclear | Code; passing tests; VT-2.5-T1 through VT-2.5-T10 manual verification |
| **Menon (User)** | Approve this proposal; respond only when a dev MOCK-REF check surfaces an ambiguity about which mock screen applies; final acceptance | Approval/feedback; ambiguity-only screen confirmations |

### Success criteria

Epic 2.5 is complete when ALL of:

1. ✅ Slice 2.5-s10 passes (EPIC MVP WALL): a fresh-signup parent completes onboarding end-to-end with the required-set fully populated; `is_onboarded=true`; lands on `/app` with personalized plan generation kicked off.
2. ✅ Slice 2.5-s11 passes (Kitchen Profile unblock): `/kitchen-profile` route renders from real `KitchenMapSchema`, no mock data; enforcement visual treatment correct; allergens render uniformly.
3. ✅ VT-2.5-T1 through VT-2.5-T10 all pass manual verification.
4. ✅ `KitchenMapSchema.meta.required_set_complete = true` for the test household.
5. ✅ PRD FR121–FR130 accepted; FR6/FR7/FR107 amendments accepted.
6. ✅ Architecture A1–A8 amendments accepted.
7. ✅ UX spec U1–U5 amendments accepted; choice-chip token family added; Onboarding mental model section authored.
8. ✅ Sprint-status reflects all 6 Epic 3 pauses + new Epic 2.5 block.
9. ✅ `_bmad-output/project-context.md` carries the required-set invariant.

### Post-Epic-2.5 unblocks

- **Epic 3 resumption:** 6 paused stories rebase on new contract; resume `ready-for-dev`.
- **Epic 7 start:** 7-s1 (Visible Memory read) can begin immediately. Subsequent Epic 7 slices follow.
- **Epic 12 12-s9:** gains an acceptance note for `enforcement` awareness; no further blocking.
- **Optional retrospective:** Epic 2 retrospective recommended to capture upfront-contract-design lessons.

---

## Approval

**This proposal must be explicitly approved by Menon (user) before any handoff begins.**

- [ ] Proposal approved as written
- [ ] Proposal approved with edits (specify below)
- [ ] Proposal rejected — return to revision

**Edits requested (if any):**

_(to be filled by user during review)_

---

## Appendix — References

- Trigger conversation: PM-led requirements review on 2026-05-19 (workflow: `bmad-correct-course`)
- Source artifacts examined:
  - `_bmad-output/planning-artifacts/prd.md`
  - `_bmad-output/planning-artifacts/architecture.md`
  - `_bmad-output/planning-artifacts/ux-design-specification.md`
  - `_bmad-output/planning-artifacts/epic-2-onboarding-integration.md`
  - `_bmad-output/implementation-artifacts/sprint-status.yaml`
  - `packages/contracts/src/kitchen-map.ts`
  - `packages/contracts/src/onboarding-tools.ts`
  - `apps/api/src/agents/prompts/onboarding.prompt.ts`
  - `apps/web/src/features/kitchen-profile/data/mockData.ts`
- Locked policy synthesized from 3 axes: enforcement strength × capture priority × interaction style.
- Canonical design foundation: in-repo mock screens at `apps/web/src/routes/_dev-onboarding-mockups.tsx` and `apps/web/src/features/onboarding-mockups/`. (Stitch retired 2026-05-19; HiveKitchen3 project `3502098255450050819` referenced only for historical context.)

---

*Document authored 2026-05-19 by John (PM persona) via `bmad-correct-course` workflow.*
