# Epic 13 Brief — Lumi-Led UX Rebuild (Valet Model)

**Date:** 2026-06-28
**Author:** Drafted by Claude (engineering/UX) at Menon's request
**Triggered by:** Menon — "if you were to rebuild the UI/UX for great UX and less fatigue while staying fresh in 2026, with Lumi as the conversational backbone… and the app should NOT look like a chat app — Lumi is a background valet."
**Scope classification:** **Major** (cross-cutting rebuild of the shipped frontend's interaction topology across onboarding, the Brief/planner, and the global Lumi surface; route-graph change in the final phase)
**Status:** Awaiting approval
**Proposed epic number:** 13 (confirm at sprint planning — Epics through 12 exist)
**Format:** Sprint-change-proposal style (mirrors `epic-2.6-brief.md` / `epic-2.7-brief.md`)

---

## Section 0 — Revision History

- **Rev 1 (2026-06-28):** Initial draft. Whole-rebuild scope as a single sequenced epic, per Menon. 12 slices across 6 phases: a regression-gate-first baseline, then the valet presence foundation, a Brief pilot, the onboarding rebuild on the shipped Epic 2.7 backend, the planner conversational-edit layer (the routing spec), and finally route-topology collapse. Companion artifacts authored 2026-06-26/28: `lumi-conversational-ux-rebuild-vision.md`, `plan-conversational-edit-routing-spec.md`, three HTML mockups (`lumi-rebuild-mockup.html`, `lumi-rebuild-onboarding-mockup.html`, `lumi-valet-model-mockup.html`).

---

## Section 1 — Issue Summary

### Problem statement

The shipped frontend works but fights the product's own thesis. HiveKitchen is meant to be a **system-led planning experience** where Lumi does the reasoning in the background and the UI presents a ready answer. The current UI instead:

- **Scatters Lumi as decoration** across ~8 components — a 40px `LumiOrb`, a `max-w-xs` `LumiPanel` popover (8 turns, reads as a support widget), a `lumi_note` paragraph, `LumiCallout`, `LumiHint`, `LumiTurn`, `LumiFAB`, `WhyLumiChoseCard` — none of which deliver a real conversational relationship.
- **Sprawls across ~20 routes** with two parallel plan implementations (`features/plan` live vs `features/weekly-plan` mock) and two onboarding implementations (`features/onboarding` live vs `onboarding-mockups`). Every screen is a new place with new controls — the fatigue source.
- **Carries a 2,460-line `OnboardingText.tsx`** with three interaction modes (focused view, history view, chip-bracket encoding) on top of a backend (Epic 2.7) that was just re-architected to make most of that complexity unnecessary.

### The root-cause insight: Lumi is everywhere as a *presence* but nowhere as a *conversation* — and where it does speak, it speaks like a chatbot

The single design fact that drives this epic: **the app is built as screens that contain Lumi, when it should be a finished product a background valet laid out for you.** Menon's correction (2026-06-26, now memory `lumi-valet-not-chat-app`) is the north star:

> **The app must never look like a chat application.** The product (Brief, week, kitchen) is a calm, finished, full-width surface. Lumi is the old-time valet — knows the family deeply, anticipates, works in the background, and stays invisible until summoned or until it has something genuinely worth saying. Intelligence is felt through *the work being right*, not through Lumi talking.

### Categorization

Per checklist item 1.2: **Interaction-topology drift between a system-led product thesis and a screen-and-widget UI.** This is **not a visual redesign** — the Editorial Hearth design system (`docs/DESIGN.md`: tokens, Honey rule, 5-button taxonomy, StickyBottomBar, 17 locked components) is **kept as-is** (memory `design-md-canonical`). What changes is *where Lumi lives and how surfaces are composed*, not the type ramp, color channels, or component visuals.

### Evidence (the specific gaps)

1. **No ambient-presence model.** `LumiOrb` + `LumiPanel` (`components/`) are an always-available popover, not a valet that recedes. There is no "at rest → whisper → summoned-and-recedes" primitive — the three valet states (memory `lumi-valet-not-chat-app`).
2. **Proactive nudges have no quiet surface.** `useLumiNudgeSSE` + `generateNudge` (one-sentence cap, already valet-shaped) exist, but a nudge has nowhere to land *except* the popover — there is no single-dismissible-line whisper.
3. **The planner is review-only and diverges from the design system.** `PlanPage` flattens the Main/Snack/Extra slot model into one dish line and `PlanActionSection` is an in-flow row, not the locked `StickyBottomBar` (a known DESIGN.md divergence). There is no conversational editing — "talk to change it" doesn't exist.
4. **Onboarding is heavier than its backend now requires.** Epic 2.7 shipped `OnboardingController` (FSM via slot predicates), `OnboardingTurnRunner` (stateless turn fn), deterministic `onboarding-chips.ts`, and a zero-call pure-chip path — but `OnboardingText.tsx` still carries focused/history modes and chip-bracket encoding the new backend makes redundant.
5. **Lumi's voice was chatbot-shaped** until 2026-06-26, when a valet-carriage block landed in `lumi-base.prompt.ts` (ambient `LumiAgent` only). The *prompt* HOW is partly done; the *UI* WHEN (don't call it at rest; render as whisper vs sheet) is unbuilt.
6. **Route sprawl + duplicate implementations.** ~20 routes; two plan and two onboarding code paths. The rebuild must *converge* these, not add a third.

### What is already right (and stays)

- **Editorial Hearth design system** — tokens, Honey rule, button taxonomy, StickyBottomBar, 17 locked components. **Unchanged.**
- **The Lumi plumbing** — `stores/lumi.store.ts`, `useLumiNudgeSSE` (SSE `lumi.nudge`), `useLumiContext` (surface-awareness), the turn/SSE/voice infrastructure. **Reused, not rebuilt.**
- **The Epic 2.7 onboarding backend** — controller / turn-runner / chips / tracer. **Consumed as the template; not modified.**
- **The valet-carriage prompt + tightened evening modifier** (`lumi-base.prompt.ts`, `lumi.agent.ts`). **Already shipped (PR #50).**
- **Per-child safety display + AA/AAA scope discipline** (`.app-scope`, `.child-scope` AAA, `.grandparent-scope`). **Preserved and regression-gated.**

---

## Section 2 — Impact Analysis

### Epic Impact

| Epic | Status before | Status after | Notes |
|---|---|---|---|
| **Epic 2.5 — Onboarding Robustness** | `done` | Behaviorally preserved | The moment FSM, chips, finalize gate are re-skinned, not re-specced. |
| **Epic 2.6 — Personalized Onboarding Catalog** | `done` | Unchanged | M5 catalog projection consumed as a black box. |
| **Epic 2.7 — Onboarding Agentic Re-Arch** | `done` (MVP wall 2026-06-27) | **Unchanged — consumed as backend template.** | The UX rebuild lands on top of `OnboardingController`/`OnboardingTurnRunner`/`onboarding-chips.ts`. |
| **Epic 3.5 — Planner Re-Arch** | `done` (WALL: do-not-merge until post-launch) | **Unchanged** | The planner conversational-edit layer (Phase 4) borrows its provider seam, strict schemas, trace. |
| **Epic 5 — Voice / Lumi** | `in-progress` | **Watch.** | Onboarding entry promises voice/text continuity but voice stays deferred (memory `onboarding-text-first`); the presence layer must not regress the existing voice session UI. |
| **Epic 12 — Proactive Nudges** | (shipped) | **Reused.** | The whisper channel (Phase 1) is the render target for `lumi.nudge` SSE. |
| **Epic 13 — Lumi-Led UX Rebuild (this brief)** | — | **NEW. `backlog` → `in-progress` at first slice.** | 12 slices, 6 phases. |

### Story Impact

**Added (Epic 13):** 12 slices (Section 4). **No pauses** — the rebuild supersedes surfaces slice-by-slice behind the Phase 0 regression gate; shipped behavior keeps working throughout. Only Phase 5 (route collapse) changes the route graph, and it is gated behind a deep-link audit.

### Artifact Conflicts

| Artifact | Conflict | Slice | Action |
|---|---|---|---|
| `components/LumiOrb.tsx`, `LumiPanel.tsx`, `LumiFAB.tsx` | Replaced by the valet presence primitive (ambient/whisper/summoned) | s2, s3 | Replace |
| `stores/lumi.store.ts`, `useLumiNudgeSSE.ts`, `useLumiContext` | Reused; presence state added (`atRest`/`whisper`/`summoned`) | s2, s3 | Extend |
| `features/plan/PlanPage.tsx`, `PlanTile.tsx`, `PlanActionSection` | Finished-surface rebuild; sticky-bar fix; progressive slots; conversational edit | s7, s10 | Rebuild + converge w/ `features/weekly-plan` |
| `features/onboarding/OnboardingText.tsx` (~2,460 lines) | One conversation mode; Kitchen-Map-as-hero; chips from `onboarding-chips.ts` | s5, s6 | Rebuild on 2.7 backend |
| `routes/(app)/onboarding.tsx` | Entry continuity (voice/text); recognition ending | s6 | Code change |
| Route graph (`routes/(app)/*`, ~20 routes) | Collapse to 4 anchors; non-anchor screens become summoned artifacts | s11 | Route change (audited) |
| `docs/DESIGN.md` | **No change** — system kept; rebuild adds presence + whisper + sheet patterns as *new* locked components | s2, s3 | Append components only |
| Backend: `CatalogRepo.pick()`, `routeIntent`/`dispatchIntent` | New planner conversational-edit layer | s8, s9 | New (per routing spec) |
| E2E / a11y tests (`apps/web/test/e2e`, axe) | New baseline + per-surface flows | all | New + extend |
| Memory (`lumi-valet-not-chat-app`, `onboarding-ux-is-chat-not-form`) | Cross-link; note the onboarding exception explicitly | s5 | Update memory |

### Technical Impact

- **No backend schema change for the UX layers.** Phases 1–3, 5 are frontend. Phase 4 adds the planner conversational-edit backend (`CatalogRepo.pick()`, `routeIntent`/`dispatchIntent`) per the routing spec — which has 3 open DB decisions (snack attestation, recency source, `plan_slots` snack storage) that must be resolved before s8.
- **Cost:** the UX rebuild is mostly zero-LLM (topology). The only new recurring LLM cost is Phase 4's conversational editing — a `'mini'`-tier classifier + deterministic ops, with `plan.compose` staying a once-per-week batch (routing spec §0). Net dollars-per-week unchanged; engagement-per-dollar up.
- **Accessibility:** the new presence/whisper/sheet must meet AA (`.app-scope`); child Lunch Link stays AAA. The summoned sheet needs focus-trap + escape + `prefers-reduced-motion` fallbacks. Regression-gated in Phase 0.
- **Performance:** anchor device Galaxy A13 / 4G; Brief must render < 2s. The finished-surface model *helps* (no live thread to hydrate at rest). Whisper/sheet are lazy.
- **No new external services.** Reuses OpenAI, the Lumi SSE/voice plumbing, the 2.7 + 3.5 seams.

---

## Section 3 — Recommended Approach

### Selected path: regression-gate first, valet foundation, pilot on one surface, then scale per-surface, topology last

Six phases, lowest-risk / most-foundational first — the same shape Epic 2.7 used (gate → port/foundation → risky change last):

0. **Lock the contract** (s1): a UX regression baseline — E2E flows + a11y + locked-component snapshots for the surfaces being rebuilt — captured against *current* behavior, so every later slice has a gate under it.
1. **Valet presence foundation** (s2, s3): the ambient-presence primitive (rest → summoned-and-recedes) and the whisper channel (one dismissible line). This is the keystone the doctrine lives in; every surface uses it.
2. **Brief pilot** (s4): prove the whole valet pattern end-to-end on one finished surface before scaling.
3. **Onboarding rebuild** (s5, s6): one calm mode + Kitchen-Map-as-hero + recognition ending, on the shipped 2.7 backend.
4. **Planner conversational editing** (s7–s10): the finished planner surface + the routing-spec backend (`pick()` → `routeIntent`/`dispatch`) + the "talk to your plan" UI — the recurring-fatigue win.
5. **Topology collapse** (s11): ~20 routes → 4 anchors, after a deep-link audit. Last and most reversible-to-defer.

### Why this path over alternatives

| Alternative | Why rejected |
|---|---|
| **Big-bang rebuild** | High blast radius on a shipped, scope-tagged (AA/AAA) frontend with live safety display. The phased path ships value from the Brief pilot and isolates the route-graph change to the end. |
| **Planner-first (highest fatigue)** | The planner conversational edit *depends on* the presence primitive (summoned sheet) and `CatalogRepo.pick()`. Building it first means building the foundation implicitly and untested. |
| **Onboarding-first (freshest backend)** | Tempting (2.7 just shipped), but onboarding is a one-time surface and is the *deliberate conversational exception* to the valet model — a poor place to prove the ambient/whisper pattern the recurring surfaces need. |
| **Skip the regression gate** | The frontend carries locked components, AA/AAA scopes, and safety display. Rebuilding topology without a snapshot+a11y+E2E baseline risks silent safety/contrast regressions. |
| **Visual redesign too** | Out of scope and unnecessary — Editorial Hearth is 2026-current. Conflating it would multiply risk and violate `design-md-canonical`. |

### Risk register

| Risk | Mitigation |
|---|---|
| Topology rebuild silently regresses safety display / contrast / AAA scopes | Phase 0 baseline = locked-component visual snapshots + axe a11y + E2E flows; every slice keeps them green. |
| Valet "doesn't interfere" degrades into either nagging or invisibility | The WHEN logic (s3) is explicit and conservative: surface a whisper only on a completed background action worth the interruption; never a stream; user can pause nudges (existing). Instrument whisper frequency. |
| Summoned sheet / whisper fail a11y (focus trap, keyboard, reduced motion) | s2/s3 acceptance includes focus-trap, escape, keyboard path, `prefers-reduced-motion`; gated by the Phase 0 axe baseline. |
| Two parallel impls (plan/weekly-plan, onboarding/onboarding-mockups) get a third | s5/s7 explicitly *converge* — delete the mock impl or fold it into the rebuilt surface; no new parallel path. |
| Onboarding rebuild regresses the just-shipped 2.7 backend behavior | s5/s6 treat `OnboardingController`/`OnboardingTurnRunner`/`onboarding-chips.ts` as black-box inputs; the 2.7 golden eval + Epic 2.5/2.6 E2E stay green. |
| Deferred-onboarding (front-load M2, defer the rest) vs fail-closed allergen guardrail | **Open decision (vision §6.1).** Pressure-test whether an M1+M2-only Kitchen Map yields a safe, non-embarrassing first week before committing the defer line. Gated in s6. |
| Route collapse breaks deep-links / child / grandparent / ops scopes | s11 starts with a deep-link audit; non-anchor routes become summoned artifacts with redirects, not 404s. |
| Planner conversational-edit cost creep | Routing spec's tier discipline (T0 deterministic / T1 `'mini'` / T2 confirm-gated); `CatalogRepo.pick()` hit-rate is the cost lever (s8 wall). |

---

## Section 4 — Slice Decomposition (Draft)

**12 slices, 6 phases.** Walls are decision moments where the next phase cannot proceed without confirming the prior invariant.

### Phase 0 — Lock the contract

#### 13-s1 — UX regression baseline (gate, built first)
**Folds:** Port of Epic 2.7's golden-eval-first discipline to the UI.
**AC sketch:** E2E flows (Playwright) for the rebuilt surfaces (onboarding spine, Brief render, plan review, a Lumi turn); axe a11y checks asserting AA on `.app-scope` and AAA on `.child-scope`; visual snapshots of the 17 locked components + the key surfaces. Green against `main` today (captured baseline). Wired into CI.
**Edge cases:** capture the safety-display states (allergy-cleared badges, blocked states) explicitly so the rebuild can't drop them; capture `prefers-reduced-motion` rendering.
**WALL: baseline.** Must pass against current behavior before any surface-touching slice.

### Phase 1 — Valet presence foundation

#### 13-s2 — Lumi presence primitive (ambient → summoned-and-recedes)
**Folds:** The valet doctrine's rules 1, 2, 5 (memory `lumi-valet-not-chat-app`). Reference mockup: `lumi-valet-model-mockup.html`.
**AC sketch:** Replace `LumiOrb`/`LumiPanel`/`LumiFAB` with a presence component: **at rest** = a quiet breathing dot, no open panel/thread; **summoned** = tap → a focused, temporary sheet (hydrated via `useLumiContext`) that runs a turn and **recedes** back to the surface. Reuses `lumi.store.ts` turn/SSE plumbing; adds `presenceState`. No persistent chat column anywhere.
**Edge cases:** focus-trap + escape + keyboard open/close; `prefers-reduced-motion`; voice-session active state preserved; child Lunch Link still suppresses presence.
**WALL: presence.** The three states work on one surface, a11y-clean, before any surface adopts them.

#### 13-s2.5 — SSE push completion (finish "Story 5.2")
**Folds:** The SSE remediation spec (`sse-remediation-spec.md`). A **dependency** of the whisper (s3) and talk-to-your-plan (s10) slices — both require real server push, not polling.
**AC sketch:** Emit `plan.updated` at plan-generation completion (`plan-generation.job.ts:693`) + the failure path, then **delete the two `setInterval` polls** in `BriefCanvas`. Collapse the two `EventSource`s into one (fold `lumi.nudge` into the bridge). Emit data-mutation invalidations (allergen / memory / pantry / child-request). Add `plan.progress` stage events so the draft spinner shows real stages. Add Last-Event-ID replay (Redis Stream) so reconnect resumes without losing events.
**Edge cases:** land the emit *before* deleting the polls; `emit` stays fire-and-forget with an async replay buffer; optimistic-edit reconciliation is piloted on swap-main only (may defer to s10).
**WALL: push.** A second tab updates without navigation; the `BriefCanvas` polls are gone and the plan still lands; one `EventSource` per tab.

#### 13-s3 — Whisper channel (proactive = one quiet line)
**Folds:** Valet rule 3 + the WHEN-controller half of the model. Reuses `useLumiNudgeSSE` + `generateNudge` (one-sentence cap).
**AC sketch:** A `lumi.nudge` SSE event renders as a single dismissible line near the presence dot (Undo / See why / Dismiss), then disappears — never a stream, never a badge. The **surfacing gate** is conservative: only on a completed background action worth interrupting for; respects the existing pause-nudges control. Whisper frequency instrumented.
**Edge cases:** multiple nudges queue to one line (no stacking storm); a whisper for a safety-relevant background swap is styled with the safety channel but still dismissible; offline/repeat-dismiss.

### Phase 2 — Brief pilot

#### 13-s4 — Brief as a finished surface (the pilot)
**Folds:** Vision §2 + §4a; valet rule 4 (knows-you-through-the-work). Reference mockup: `lumi-rebuild-mockup.html` (Brief).
**AC sketch:** The Brief is a calm, full-width finished answer — answer-as-a-sentence headline, visible-memory phrases woven in (extends `lumi_note`), allergy-cleared badges intact, **no chat layout**. A summoned-sheet edit (s2) updates the artifact and recedes. Proves the end-to-end valet pattern on one surface.
**Edge cases:** loading/draft state ("Lumi is drafting…") without a thread; the QuietDiff rear-view for silent mutations stays.
**WALL: pilot.** The valet model is proven (finished surface + whisper + summoned-recede) and a11y/perf-clean before scaling to onboarding/planner.

### Phase 3 — Onboarding rebuild (on the 2.7 backend)

#### 13-s5 — One conversation mode + Kitchen-Map-as-hero
**Folds:** Vision §3a/§3b. Lands on `OnboardingController`/`OnboardingTurnRunner`/`onboarding-chips.ts`. Reference mockup: `lumi-rebuild-onboarding-mockup.html`.
**AC sketch:** Rebuild `OnboardingText.tsx` to one calm thread (drop focused/history toggle + chip-bracket encoding); the **Kitchen Map is the hero** (wider column, lands cards/safety pills live from the turn-runner's `kitchenMap` block); chips rendered from `onboarding-chips.ts` (hint/action/choice taxonomy, memory `chip-taxonomy-three-types`). Converge — delete or fold `onboarding-mockups` duplication.
**Edge cases:** the deliberate exception — onboarding *is* conversational (memory `onboarding-ux-is-chat-not-form`); valet "don't fill silence" loosens here. Safety moment (M2) gate preserved. Resume/reset reconstructs from slot state.
**Update memory:** cross-link `lumi-valet-not-chat-app` ↔ `onboarding-ux-is-chat-not-form` (the exception).

#### 13-s6 — Recognition ending + entry continuity
**Folds:** Vision §3c/§3e.
**AC sketch:** End on a recognition moment — Lumi plays back the understood kitchen in prose + honey-glow + "Show me my first week" (not a Finalize button; finalize stays never-auto). Entry promises voice/text continuity ("start talking, finish typing") with **voice deferred** (text-first doctrine). **Front-load-safety / defer-the-rest** is gated by the §6.1 decision.
**Edge cases:** finalize eligibility = the 2.7 slot predicate, not auto-commit; honey-glow respects reduced-motion.
**WALL: onboarding parity.** 2.7 golden eval + Epic 2.5/2.6 E2E + the s1 baseline green.

### Phase 4 — Planner conversational editing

#### 13-s7 — Planner finished surface + StickyBottomBar
**Folds:** Vision §4a/§4c/§4d. Converges `features/plan` and `features/weekly-plan`.
**AC sketch:** Answer-as-a-sentence hero + 5-day finished surface; **progressive slot disclosure** (Main/Snack/Extra revealed on tile-focus, flat dish line at rest); `PlanActionSection` → the locked `StickyBottomBar` (PrimaryButton + "Talk to Lumi" right slot). No chat layout.
**Edge cases:** all PlanTile states preserved (decided/pending/swap/locked/paused); per-child chips + TrustChips intact.

#### 13-s8 — `CatalogRepo.pick()` (cost keystone)
**Folds:** Routing spec §7. **Backend.** Pure T0, no LLM.
**AC sketch:** Deterministic selector — snack branch wraps `assignSnackRotation()`; main/extra branch over `findCandidateSlateForHousehold()` + tag-set `allergen_flags` pre-filter + `last_used_at` recency; returns null on catalog miss. Testable with **no model mock**.
**Pre-req:** resolve routing-spec §9 decisions (snack attestation, recency source, `plan_slots` snack storage) first.
**WALL: catalog-pick.** Hit-rate validated (it's the cost lever) before the conversational layer rides on it.

#### 13-s9 — `routeIntent()` + `dispatchIntent()`
**Folds:** Routing spec §4–6. On the 2.7 pattern (provider seam, strict schema, trace).
**AC sketch:** `routeIntent()` = `'mini'`-tier classifier via `provider.completeWithMessages(..., {strictAllTools:true})` + `stripNulls`; `dispatchIntent()` = deterministic controller (T0 ops, escalation confirm-gate for T2). Routing trace tags (`model:null` on T0). Routing golden eval (utterance → intent + tier).
**Edge cases:** safety-write path stays deterministic; escalation never silently spends.

#### 13-s10 — "Talk to your plan" UI (the MVP win)
**Folds:** Vision §4b/§4e. Ties s2 (sheet) + s7 (surface) + s9 (routing).
**AC sketch:** Tap a day → summoned sheet hydrates that day's context → user speaks → tile re-renders live from the dispatch delta; proactive next-week via the whisper channel (s3). Cost-instrumented per the routing trace.
**WALL: MVP.** Talk-to-your-plan works end-to-end on a finished surface, cost shows expensive path firing once/week + confirmed escalations only.

### Phase 5 — Topology collapse

#### 13-s11 — Route collapse to 4 anchors
**Folds:** Vision §2c.
**AC sketch:** Collapse navigable routes to **Brief · Kitchen · People · Lumi**; non-anchor screens (day-detail, grocery, swap, history, evening check-in) become summoned artifacts/sheets. Deep-link audit first; old routes redirect, not 404. Child/grandparent/ops scopes preserved.
**Edge cases:** bookmarked deep-links; the `(child)`/`(grandparent)`/`(ops)` scopes are out of the 4-anchor collapse.
**WALL: topology.** Deep-link audit clean; no orphaned routes; a11y + E2E baseline green.

---

## Section 5 — Implementation Handoff

### Sequence

```
13-s1 (UX regression baseline)                         ← WALL: baseline (gate for all later slices)
  └─ 13-s2 (presence primitive)                        ← WALL: presence
       └─ 13-s2.5 (SSE push completion)                ← WALL: push (dependency of whisper + talk-to-plan)
            └─ 13-s3 (whisper channel)
                 └─ 13-s4 (Brief pilot)                ← WALL: pilot (valet model proven)
              ├─ 13-s5 (onboarding one-mode + map-hero)
              │    └─ 13-s6 (recognition + entry)       ← WALL: onboarding parity
              └─ 13-s7 (planner finished surface)
                   └─ 13-s8 (CatalogRepo.pick)          ← WALL: catalog-pick (cost lever)
                        └─ 13-s9 (routeIntent/dispatch)
                             └─ 13-s10 (talk-to-plan UI)← WALL: MVP
                                  └─ 13-s11 (route collapse) ← WALL: topology
```

- **s1 first** — the regression gate. **s2/s3** are the foundation every surface uses. **s4** proves the pattern.
- Phase 3 (onboarding) and Phase 4 (planner) can proceed in parallel after s4, with their own walls.
- **s8 must precede s9/s10** (dispatch calls pick); resolve the routing-spec §9 decisions before s8.
- **s11 last** — most reversible to defer if scope tightens.

### Epic MVP wall

**Wall placement: 13-s10.** "Talk to your plan" on a finished, valet-led surface is the headline win. Phases 0–3 each ship measurable value before it (a working presence layer, a piloted Brief, a rebuilt onboarding).

### Pre-flight before approval

1. Confirm **Editorial Hearth is frozen** for this epic (no visual redesign) — the rebuild only adds the presence/whisper/sheet patterns as new locked components.
2. Resolve (or schedule) the **routing-spec §9 decisions** before Phase 4 (snack attestation, recency source, `plan_slots` snack storage).
3. Decide the **deferred-onboarding line** (§6.1 tension) — what minimal Kitchen Map (M1+M2?) yields a safe first plan — before s6.
4. Confirm the **4-anchor collapse** (Brief/Kitchen/People/Lumi) and which routes survive vs become artifacts — before s11.
5. Assign the **epic number** (proposed 13) and add to `sprint-status.yaml`.

### Acceptance criteria — epic-level

Epic 13 is **done** when:
1. A UX regression baseline (E2E + a11y + locked-component snapshots) exists and stays green across every slice.
2. `LumiOrb`/`LumiPanel`/`LumiFAB` are replaced by one valet presence primitive (ambient → whisper → summoned-and-recedes); no persistent chat column anywhere.
3. Proactive nudges render as a single dismissible whisper, conservatively gated.
4. The Brief and planner are finished, full-width surfaces (answer-as-a-sentence, visible-memory, progressive slots, locked StickyBottomBar) — not chat layouts.
5. "Talk to your plan" works end-to-end via the routing layer, with the expensive `plan.compose` path firing once/week + confirmed escalations only.
6. Onboarding is one calm mode with the Kitchen Map as hero and a recognition ending, on the 2.7 backend; the duplicate mock impl is gone.
7. Routes collapse to 4 anchors with audited redirects; child/grandparent/ops scopes preserved.
8. Editorial Hearth visuals, AA/AAA scopes, and safety display are unregressed (Phase 0 gate green throughout).

### What this brief explicitly does NOT cover

- **A visual redesign.** Editorial Hearth / DESIGN.md is kept.
- **Voice onboarding.** Text-first holds; entry promises continuity, voice stays deferred.
- **The Epic 2.7 / 3.5 backends.** Consumed as templates/seams, not modified (beyond the new Phase 4 planner conversational-edit layer).
- **New product content** (new moments, new planning features). This is a *how-it-feels* rebuild, not *what-it-does*.

---

## Approval

- [ ] **PM (Menon):** brief shape, whole-rebuild scope, slice priority
- [ ] **Design review:** confirm Editorial Hearth frozen; presence/whisper/sheet added as locked components
- [ ] **Architecture review:** Phase 4 conversational-edit layer (routing spec) + the §9 decisions
- [ ] **Sprint plan update:** Epic 13 added to `sprint-status.yaml` with 12 slices

Upon approval, this brief is the input to `bmad-create-epics-and-stories` (then `bmad-sprint-planning`) for Epic 13 generation.

---

## Appendix — References

- `_bmad-output/planning-artifacts/lumi-conversational-ux-rebuild-vision.md` — the UX what/why (valet doctrine, onboarding, planner)
- `_bmad-output/planning-artifacts/plan-conversational-edit-routing-spec.md` — Phase 4 backend (routing + `CatalogRepo.pick()`), reconciled to shipped 2.7
- `_bmad-output/planning-artifacts/lumi-valet-model-mockup.html` — presence states (rest/whisper/summoned)
- `_bmad-output/planning-artifacts/lumi-rebuild-mockup.html` — Brief/onboarding/planner concept
- `_bmad-output/planning-artifacts/lumi-rebuild-onboarding-mockup.html` — steppable onboarding (Kitchen-Map-as-hero)
- `_bmad-output/planning-artifacts/epic-2.7-brief.md` — the backend control-inversion this rebuild lands on
- Current surfaces: `apps/web/src/components/{LumiOrb,LumiPanel,LumiFAB}.tsx`, `features/plan/{PlanPage,PlanTile}.tsx` + `PlanActionSection`, `features/onboarding/OnboardingText.tsx`, `routes/(app)/onboarding.tsx`, `routes/(app)/layout.tsx`, `stores/lumi.store.ts`, `useLumiNudgeSSE.ts`
- Shipped 2.7 backend (Phase 3 template): `apps/api/src/modules/onboarding/{onboarding.controller,onboarding-turn-runner,onboarding-chips}.ts`
- `docs/DESIGN.md` — Editorial Hearth (kept, not redesigned)
- Memory: `lumi-valet-not-chat-app`, `onboarding-ux-is-chat-not-form`, `chip-taxonomy-three-types`, `design-md-canonical`, `mock-screen-reference-check`, `parent-confidence-prevents-cafeteria`, `three-slot-weighted-structure`, `family-first-main-then-variations`
