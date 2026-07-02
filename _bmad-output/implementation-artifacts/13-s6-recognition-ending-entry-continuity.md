# Story 13.6: Recognition Ending + Entry Continuity (§6.1 defer-line)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Source brief:** `_bmad-output/planning-artifacts/epic-13-lumi-ux-rebuild-brief.md` § Phase 3, 13-s6 (lines 186–190) + risk register row "Deferred-onboarding vs fail-closed guardrail" (line 133).
> **Vision:** `_bmad-output/planning-artifacts/lumi-conversational-ux-rebuild-vision.md` §3c/§3e (recognition ending + entry continuity), §6.1 tension #1 (line 133 — the deferred-onboarding decision this slice resolves).
> **Reference mockup:** `_bmad-output/planning-artifacts/lumi-rebuild-onboarding-mockup.html` — `.glow` = the recognition beat (lines 88–94). Composition only; its dark palette is REJECTED (same rule as 13-s5).
> **§6.1 DECISION (Menon, 2026-07-01) — the gate this slice implements:** M1+M2 alone do **not** yield a good first-week plan. Promote **M3 (cuisine + dietary) to the required set**; keep **M5 required** (do NOT adopt the vision's "relax to M1+M2"); keep **M4 optional**; keep the M5 ask light. Religious rules (halal/kosher) must be respected by the first plan — see **Q1** (capture already exists pre-`/app`; the gap is planner *enforcement*, a separable concern). Recorded in memory `epic-13-s6-defer-line-decision`.
> **Gate (must stay green):** `apps/api/src/agents/eval/onboarding-golden.eval.test.ts` (+ `onboarding-eval.goldens.json`), `apps/web/test/e2e/2-7-text-onboarding.spec.ts`, `apps/web/test/e2e/13-s1-ux-regression-baseline.spec.ts`, the Epic 2.5/2.6 onboarding e2e specs.
> **This slice touches BOTH backend and frontend** (unlike 13-s5, which was frontend-only). The required-set gate lives in `apps/api`. Keep the change surgical: one contract-comment edit, the required-set computation, the finalize gate, the FSM re-anchor, and the golden eval — nothing else in the backend.

---

## Story

As a **parent finishing HiveKitchen onboarding**,
I want **onboarding to end on a moment where Lumi plays back the kitchen it now understands — my family, what's kept safe, how we like to eat — and hands me to my first week; and I want to be told I can start by talking and finish by typing**,
so that **I leave onboarding feeling seen rather than processed, and I reach a first plan that actually reflects my family's tastes (not a thin M1+M2 guess) without a heavy interview**.

---

## Scope Decisions (locked before authoring — do not re-litigate)

1. **This slice resolves §6.1 by MOVING the defer line, not relaxing it.** The vision floated letting a parent reach a plan after M1+M2 only. **Rejected.** The required-set gate gains **M3 (cuisine + dietary)**; **M5 stays required** exactly as today; **M4 stays optional** exactly as today. Net backend change: add one required-set bit (`m3_answered`) and stop skipping M3 on re-anchor. (See memory `epic-13-s6-defer-line-decision`.)

2. **First plan is on-demand/scheduled, NOT composed at finalize.** Do not add plan composition to finalize. The parent lands on the Brief empty state (`BriefCanvas.tsx:69-130`, `ComposeMyPlanButton`, Story 3-S34) and either composes on demand or waits for the Sunday compose. The catalog *seed* already enqueues at M2 exit (`onboarding.service.ts:1032`) — leave it. "Show me my first week" navigates to `/app` (the Brief), same destination the current flow reaches; it does **not** trigger a compose.

3. **Recognition ending REPLACES the finalize gate UI — same data flow.** The `summary`-moment finalize gate in `ConversationColumn.tsx` (lines 176–217: the "Finalize" button + gap callouts + `requiredSetComplete`/`missingRequiredSet` copy) becomes the recognition ending: Lumi's prose playback of the understood kitchen + a quiet honey-glow + a **"Show me my first week"** CTA. The underlying `required_set_complete` / `missing_required_set` / `onFinalize` / `onJumpToMoment` wiring is **unchanged** — only the presentation changes. Finalize stays **never-auto** (the CTA is a deliberate tap; no auto-commit).

4. **Entry continuity: text-first, voice deferred.** The entry (`routes/(app)/onboarding.tsx` `select` step, lines 171–191) reframes to promise voice/text continuity ("start talking, finish typing") while **text is the working path and voice is deferred** (memory `onboarding-text-first`). Do NOT build a voice pipeline here. See **Q2** for the exact voice-affordance treatment.

5. **Editorial Hearth is FROZEN — topology/tokens only.** Honey/amber = **recognition only, never a hover** (DESIGN.md Honey rule; memory `design-md-canonical`). Use canonical semantic tokens: `--honey-amber-*` for the glow, `--lumi-terracotta` (Lumi's voice), `--safety-cleared-teal` (safety pills already in the hero), `bg-bg`/`bg-surface`/`text-fg`/`text-fg-muted`/`border-border`. No new external dependency. Reject the mockup's dark hexes.

6. **Religious *enforcement* wiring is GATED behind Q1 — default OUT of this slice.** Capture of halal/kosher already happens before `/app` (`CulturalRatificationStep`). The planner ignoring `culturalObligations` is a real bug but is **planner/guardrail-scoped, not onboarding-UX-scoped**. Task Group C is written but conditional — see **Q1**; do not implement it unless Menon opts it in.

---

## Acceptance Criteria

### AC1 — M3 (cuisine + dietary) joins the required set [BACKEND]

- `required_set_complete` is `true` **only when** M1 (household_name + child_declared), M2 (allergen_response), **M3 (m3_answered)**, and M5 (m5_complete) are all satisfied. `missing_required_set` includes `'m3_taste'` when M3 is unanswered. (Source: `onboarding.service.ts:1104-1122`.)
- `m3_answered` is a new persisted bit on `RequiredSetStatus` (`onboarding-moment.repository.ts:36-42`), computed from the **existing** `m3Answered` signal already derived in `submitTextTurn` (`onboarding.service.ts:909-923` — cuisine/dietary chip this-turn OR prior-turn OR ratification, and `!ratificationRequested`). Reuse that computed value; do not invent a second source.
- `m4_answered` stays OUT of the required set (M4 optional, unchanged). `m5_complete` stays in (unchanged).
- The finalize endpoint's structured gate (`onboarding.service.ts:1295-1335`) and the `structuredGatePassed` classifier-skip predicate (`onboarding.service.ts:1347-1353`) both add the M3 check, so finalize is **rejected** with the existing `ConflictError('required fields incomplete …')` when M3 is unanswered.

### AC2 — Re-anchor no longer skips M3 [BACKEND]

- `OnboardingController.reconstructMoment` (`onboarding.controller.ts:98-109`) currently jumps M2→M4, **skipping M3** (line 106). Add the M3 check so a resumed/re-anchored interview with M1+M2 done but M3 unanswered lands on `m3_taste`, not `m4_bag`. Update the `m3Complete` predicate comment (line 61) to note M3 is now required (the predicate body is unchanged; only its role in the required set changes).
- `nextMoment` (lines 84–96) is unchanged — it already walks through M3 in forward flow.

### AC3 — Contract + golden eval reflect the new required set [BACKEND]

- Update the `missing_required_set` doc comment in `packages/contracts/src/onboarding.ts:94-95` to list `'m1_table'|'m2_safe'|'m3_taste'|'m5_starting_line'`. (Optional hardening: promote it to a real `z.enum([...])` — flag as a coordinated contract change if you do, but a comment-only edit is acceptable since the field is `z.array(z.string())`.)
- Regenerate `onboarding-eval.goldens.json` for the **one** affected scenario: `finalize-gate-negative` (finalize blocked earlier / `missing_required_set` gains `'m3_taste'` on any turn where the household is at/after summary-eligibility without M3). The other 8 scenarios answer M3 or never reach it — verify they are **byte-stable** (do not hand-edit them; if any change, that's a signal your predicate logic drifted). `onboarding-golden.eval.test.ts` stays structurally unchanged (`expect(outcome).toEqual(golden)`).

### AC4 — M5 ask stays light (keep-or-tune) [BACKEND, small]

- Preserve the existing light M5 path: the `override_fewer` "Start with fewer" chip lets a parent stop at ≥4 favourites (≥1 cold-start), and `m5_complete` is sticky-once-true (`onboarding.service.ts:938-954`). **Do not regress** this.
- Per the §6.1 "~5 not 10" intent, lower the M5 **natural** threshold from `10` to `5` (`m5NaturalThreshold`, `onboarding.service.ts:948`; keep the cold-start `3`). This is a one-line tune. **See Q3** — confirm 5 vs keeping 10-with-override before changing. If Q3 says "keep," this AC is a no-op verify.

### AC5 — Recognition ending replaces the finalize gate [FRONTEND]

- At `currentMomentKey === 'summary'`, `ConversationColumn.tsx` (replace lines 176–217) renders a **recognition moment**: a short, warm **prose playback** of the understood kitchen (family names/ages, "keeping safe" allergens, how-they-taste cuisines/dietary — composed client-side from the `KitchenMap` projection the hero already holds) + a quiet **honey-glow** + a primary CTA **"Show me my first week."**
- The CTA is enabled by the **same** `requiredSetComplete === true` logic (it calls the existing `onFinalize`; on success it follows the existing post-finalize path → `onFinalized()` → consent). When `requiredSetComplete !== true`, keep a calm, non-nagging affordance that routes back to the unanswered moment (reuse `missingRequiredSet` + `onJumpToMoment`; do not show a raw disabled "Finalize" button — phrase it as "One more thing before your first week"). No auto-finalize.
- Prose composition is **presentation only** — no new endpoint. Read from the `KitchenMap` the hook already fetches (`KitchenMapHero` fields: `household.display_name`, `children[]`, `allergens[]`/per-child, `food_preferences[]`, `household.dietary_preferences`/`cultural_identifiers`, `favorite_lunches[]`). Empty categories are omitted from the prose (never "you told me nothing about…").

### AC6 — Honey-glow animation, reduced-motion safe [FRONTEND]

- Add a `hk-glow` keyframe in `apps/web/src/styles/globals.css` alongside `hk-slide-in-sheet`/`hk-slide-up-whisper`/`hk-land` (lines 10–38). It is a **gentle** honey recognition beat (opacity/soft box-shadow or background wash using `--honey-amber-*`), **not** a flashing pulse. Every call site pairs it with `motion-reduce:animate-none` (repo convention). Under reduced motion the recognition ending renders fully, just without the animated glow.
- Honey is recognition-only (DESIGN.md Honey rule). Do not reuse `--amber-warm` as a hover here.

### AC7 — Entry continuity: text-first, voice deferred [FRONTEND]

- The `select` step (`routes/(app)/onboarding.tsx:171-191`) communicates the continuity promise ("start talking, finish typing") with **text as the working entry**. Today primary = "Start with voice" → `setMode('voice')`, secondary = "I'd rather type" → `setMode('text')`. Reframe so text is the actionable primary path; voice is presented per **Q2** (deferred — e.g. a quiet "voice coming soon" affordance, NOT a broken voice mode). Do not delete `OnboardingVoice.tsx`/`OnboardingResume.tsx` — leave them for the future voice slice; just don't route users into a non-working voice path from the reframed entry.
- The rest of the route state machine (`consent` → `cultural-ratification` → `mental-model` → `/app`, lines 253–296) is **unchanged**.

### AC8 — Tests + gates green [BOTH]

- **Backend:** new/updated unit tests for the M3-required computation (`onboarding.service.test.ts` has the `required_set_complete` describe at line 1037 and the m5 override describe at 1103 — add an M3-required case there) and the re-anchor change (`onboarding.controller` transition tests). `onboarding-golden.eval.test.ts` passes with the regenerated `finalize-gate-negative` golden; the other 8 goldens are byte-stable. Backend `pnpm --filter @hivekitchen/api typecheck` clean.
- **Frontend:** migrate the `OnboardingText.test.tsx` finalize-gate assertions (lines 486–569: `finalize-gate`, `finalize-button`, `gap-callout-*`, jump-to-moment, summary subtitle) to the recognition-ending surface — keep the **behavior** coverage (CTA enabled iff required-set complete; jump-back on incomplete; navigates on finalize) even as the copy/markup change. `KitchenMapHero.test.tsx` stays green. Update the entry-screen assertion in `2-7-text-onboarding.spec.ts` (finalize→consent, lines 111–157) and `13-s1-ux-regression-baseline.spec.ts` AC1.1 (entry buttons) to the reframed entry. `pnpm --filter @hivekitchen/web typecheck` + `build` clean; lint clean on changed files.
- The 13-s1 regression gate stays green (axe AA on `.app-scope`; reduced-motion; no new contrast offender — the honey-glow must not add contrast debt; recognition text on `bg-surface` must clear AA).

### AC9 — Memory update [DOCS]

- Update memory `epic-13-s6-defer-line-decision` to "implemented" with the final M5 threshold (Q3) and the Q1 outcome for religious enforcement. Keep the `MEMORY.md` pointer consistent.

---

## Tasks / Subtasks

### Task Group A — Backend: move the defer line (AC 1, 2, 3, 4)

- [x] **A1 — Add `m3_answered` to the required set (AC1).**
  - [x] Add `m3_answered: boolean` to `RequiredSetStatus` (+ `EMPTY_REQUIRED_SET`, `normalizeRequiredSet`).
  - [x] Carry the existing `m3Answered` value (sticky: `|| preTurn.m3_answered`) into the upserted `requiredSetStatus`.
  - [x] Add M3 to `required_set_complete` and push `'m3_taste'` into `missing_required_set`.
  - [x] Add the M3 check to the finalize structured gate and to `structuredGatePassed`. Also kept `renderMomentStateBlock` (the prompt-facing required-set twin) consistent.
- [x] **A2 — Stop skipping M3 on re-anchor (AC2).** Added the `m3Complete` stop before the M4 check in `reconstructMoment`; updated the `m3Complete` comment.
- [x] **A3 — Contract comment + golden eval (AC3).** Edited the `missing_required_set` comment. Regenerated the goldens via the harness: every scenario gained `m3_answered`; `m3_taste` added to `missing_required_set` where M3 unanswered; `spine-happy-path` advances at 5 favourites (Q3), `safety-net-reanchor` now lands `m3_taste`. Diff-reviewed — all deltas trace to the two backend changes.
- [x] **A4 — M5 threshold (AC4, Q3=lower).** Changed `m5NaturalThreshold` 10→5 (cold-start 3 unchanged).
- [x] **A5 — Backend tests (AC8).** Added M3-required turn + finalize cases; re-anchor transition tests updated to m3_taste; golden eval + spot checks green. Also updated `onboarding.routes.test.ts` (local moment-state type), `onboarding-zero-call`, `onboarding-tracer`, `onboarding-moment.repository` literals.

### Task Group B — Frontend: recognition ending + entry continuity (AC 5, 6, 7)

- [x] **B1 — Recognition ending (AC5).** Extracted `RecognitionEnding.tsx` + `recognition-prose.ts` (pure prose builder from the KitchenMap projection); replaced the summary finalize gate + the duplicate summary gap-callouts in `ConversationColumn.tsx` (now 216 lines). Complete → prose + glow + "Show me my first week" (never-auto, unchanged `onFinalize`/`requiredSetComplete`). Incomplete → "One more thing before your first week" + per-missing jump-back (no raw disabled CTA). `kitchenMap` threaded through `OnboardingText` → `ConversationColumn`.
- [x] **B2 — Honey-glow keyframe (AC6).** Added `hk-glow` (color-mix over `--honey-amber-500`, one-shot `forwards`) to `globals.css`; call site pairs `animate-[hk-glow…]` with `motion-reduce:animate-none`.
- [x] **B3 — Entry continuity (AC7, Q2a).** Reframed the `select` step text-first: primary "Start with Lumi" → text, continuity `privacyLine`, no actionable voice route. Kept the "I'd rather type" → text secondary so the Epic 2.5/2.6 e2e gate stays green (extended `OnboardingActions` to allow `secondaryLabel={null}`). Voice components untouched.
- [x] **B4 — Frontend tests (AC8).** Migrated `OnboardingText.test.tsx` finalize-gate → recognition surface + added a finalize-navigation test; colocated `RecognitionEnding.test.tsx` + `recognition-prose.test.ts`; updated `13-s1` AC1.1 and `2.5-s10` (finalize-gate → recognition ending) e2e; `test.describe.skip`'d the voice-entry e2e `2-6`/`2-6b` (Q2a — voice deferred).

### Task Group C — Religious enforcement (CONDITIONAL — Q1 = OUT; NOT built)

> Q1 resolved OUT — not built in 13-s6. Capture already runs pre-`/app` (`CulturalRatificationStep`); the planner-enforcement gap (`culturalObligations: []`) is planner/guardrail-scoped and belongs in its own slice.

- [ ] **C1 — Inferred priors get a gating enforcement.** _(deferred — own slice)_
- [ ] **C2 — Wire `culturalObligations` into the planner.** _(deferred — own slice)_
- [ ] **C3 — Guardrail/planner test.** _(deferred — own slice)_

### Task Group D — Docs (AC9)

- [x] **D1 — Memory** `epic-13-s6-defer-line-decision` → implemented (M5 threshold 5, Q1 OUT, Q2 voice-deferred); `MEMORY.md` pointer updated.

---

### Review Findings

- [x] [Review][Patch] **`c.declared_allergens` has no null guard in `allergenNames`** — outer `children` loop guarded with `?? []` but inner `for (const a of c.declared_allergens)` is not; if the projection ever returns null here this throws at runtime. Add `?? []`. [`recognition-prose.ts:allergenNames`]
- [x] [Review][Patch] **`m3Answered` JSDoc in `OnboardingSlots` still says "M3 is optional, no required-set bit"** — now factually wrong; M3 is required as of this slice. Update comment. [`onboarding.controller.ts:42`]
- [x] [Review][Patch] **`privacyLine` copy leads with "Start by talking" but both buttons route to text** — first clause implies voice is active; contradicts the text-only entry. Fix copy to be honest about text-only for now. [`onboarding.tsx`]
- [x] [Review][Patch] **`tasteTags` Set dedup is case-sensitive; `allergenNames` lowercases before dedup** — inconsistency could produce "vegetarian, Vegetarian" in recognition prose. Apply `.toLowerCase()` before the Set. [`recognition-prose.ts:tasteTags`]
- [x] [Review][Patch] **Resumed session at summary with `requiredSetComplete===null` + `missingRequiredSet===[]` shows "One more thing before your first week" with no buttons** — dead-end state until user sends a message. The old finalize gate showed "Reply above to pick up where you left off." Needs a `null`-state guard in `RecognitionEnding` (neutral/loading copy, not "One more thing"). [`RecognitionEnding.tsx`]
- [x] [Review][Patch] **Missing e2e coverage for recognition-ending → "Show me my first week" → consent flow** — `2-7-text-onboarding.spec.ts` existing "finalize success" test uses the legacy `is_complete=true` CTA path, not the recognition ending. Recognition ending → consent path is unit-tested only. Add/update an e2e case using `getByTestId('show-first-week-button')`. [`apps/web/test/e2e/2-7-text-onboarding.spec.ts`]
- [x] [Review][Defer] **`household.declared_allergens` reads from a column dropped in migration 20261008000000** — `?? []` guard makes it a silent no-op; allergens from the consolidated table are captured via `kitchenMap.allergens`. Pre-existing KitchenMap projection gap, not introduced here. [`recognition-prose.ts:allergenNames`] — deferred, pre-existing
- [x] [Review][Defer] **Gap-jump chipConfig not reset after client-side moment navigation** — after `onJumpToMoment('m3_taste')`, chipConfig retains the summary-moment value (null). Pre-existing gap-jump UX pattern shared with m1/m2/m5 jumps. [`onboarding-conversation.ts`] — deferred, pre-existing
- [x] [Review][Defer] **Gap-jump doesn't update backend `current_moment`; chips submitted at summary context don't call dietary/cuisine tools** — `setCurrentMomentKey` is client-only; backend processes subsequent turns as `preTurnMoment='summary'`. Pre-existing architecture for all gap-jumps. [`onboarding-conversation.ts`] — deferred, pre-existing
- [x] [Review][Defer] **`joinWithAnd` items[0] / items[1] / items[n-1] without `!` assertions** — runtime-safe due to length guards; only fails if `noUncheckedIndexedAccess` is in tsconfig. [`recognition-prose.ts:joinWithAnd`] — deferred, pre-existing
- [x] [Review][Defer] **`m5NaturalThreshold` comment says threshold relaxes "next turn" but code applies it same turn** — harmless; `coldStartTriggered` is read after mutation, so threshold is 3 on same turn cold-start fires; `0 >= 3` is false regardless. [`onboarding.service.ts`] — deferred, pre-existing
- [x] [Review][Defer] **M3 free-text answers don't satisfy `m3Answered` (chip-driven signal only)** — a parent who types at M3 without tapping any chip stays at `m3_taste` indefinitely. Pre-existing design; M3 presents choice chips including skip; LLM guides toward chips. Monitor in production. [`onboarding.service.ts:909-923`] — deferred, pre-existing

---

## Dev Notes

### What already exists — REUSE, do not reinvent

**Backend required-set (the gate this slice edits):**
- Computation: `onboarding.service.ts:1104-1122` (`required_set_complete` = m1_household_name && m1_child_declared && m2_allergen_response && m5_complete; `missing_required_set` pushes m1_table/m2_safe/m5_starting_line).
- Shape: `RequiredSetStatus` (`onboarding-moment.repository.ts:36-42`): `m1_household_name`, `m1_child_declared`, `m2_allergen_response`, `m5_favorite_count`, `m5_complete`.
- `m3Answered` is **already computed** each turn (`onboarding.service.ts:909-923`) — cuisine/dietary chip this-turn or prior-turn or ratification chip, gated by `!ratificationRequested`. It just isn't persisted into the required set or gated on. That's the whole change.
- FSM: `onboarding.controller.ts` — `MOMENT_SLOT_PREDICATES` (56-67), `nextMoment` (84-96, already walks M3), `reconstructMoment` (98-109, **skips M3 at line 106** — the one line to change for AC2).
- M5 thresholds: `onboarding.service.ts:938-954` — natural `10` (cold-start `3`), override `override_fewer` ≥4 (cold-start ≥1), sticky-once-true. Count source: `countRequiredSetSources` reading `household_recipe_usage` where `catalog_provenance='declared'` (`onboarding-moment.repository.ts:119-183`).
- Finalize: `POST /v1/onboarding/text/finalize` (`onboarding.routes.ts:313-328`) → `finalizeTextOnboarding` (`onboarding.service.ts:1215-1336`): gate 1 already-complete, gate 2 required-set (1295-1335), gate 3 classifier fallback (1347-1376). Writes system_event `onboarding.summary` turn, closes thread, marks moment `finalized`, fire-and-forget cultural inference + memory seeding. Returns `{ thread_id, summary }`.
- **Catalog seed** enqueues fire-and-forget at M2 exit (`onboarding.service.ts:1032`) — leave it; it keeps candidate coverage ahead of the first compose (`onboarding.service.test.ts:367-373`).

**Golden eval (must stay byte-stable except one scenario):**
- `apps/api/src/agents/eval/onboarding-golden.eval.test.ts` (`expect(outcome).toEqual(golden)` over 9 scenarios in `onboarding-eval.fixtures.ts`), goldens in `onboarding-eval.goldens.json`. Each golden pins `momentSequence`, `toolCalls`, `finalSlots`, `momentState.required_set_status`, `lastTurn.{required_set_complete,missing_required_set,is_complete,cold_start_mode}`, `finalize`.
- Only `finalize-gate-negative` changes. `spine-happy-path`, `m3-elevation-strict`, `safety-net-chip-only`, `m5-cold-start`, `resume-in-progress` all answer M3 (no change). `safety-net-reanchor`, `pre-start-bootstrap`, `reset-interview` never reach M3 — **but** verify `safety-net-reanchor` still matches after the AC2 re-anchor change (it re-anchors from M2; adding the M3 stop could shift its landing moment — this is the one golden to watch beyond finalize-gate-negative).

**Frontend onboarding surface (post-13-s5 decomposition):**
- `features/onboarding/onboarding-conversation.ts` — `useOnboardingConversation` hook: state + `handleFinalize` (~288-293: POST finalize → `onFinalized()` or `navigate('/app')`), kitchen-map fetch (holds the projection the recognition prose reads), resume/error-rollback.
- `features/onboarding/ConversationColumn.tsx` — the summary finalize gate (176-217) + gap callouts (114-145, `GAP_LABELS`). **The B1 edit site.** Post-review it's ~283 lines; keep ≤~300 (extract `RecognitionEnding`).
- `features/onboarding/conversation-column-helpers.tsx` — `StatusLine`/glyphs/`momentSubtitle`/`inputPlaceholder`.
- `features/onboarding/KitchenMapHero.tsx` — renders `household.display_name`, `children[]` (name+age_band), `allergens[]`+per-child (safety-teal pills), `food_preferences[]` (loves/likes), `household.dietary_preferences`/`cultural_identifiers`, `favorite_lunches[]`, deferred bag ghost. The recognition prose (B1) draws from these same fields — do not add a second data source.
- `routes/(app)/onboarding.tsx` — mode union (24-31) `select|resume|voice|text|consent|cultural-ratification|mental-model`; flow `select → (voice|text) → consent → [cultural-ratification?] → mental-model → /app`; `select` step 171-191 (**B3 edit site**); `OnboardingText onFinalized={() => setMode('consent')}` at 244; consent→cultural-ratification/mental-model at 253-287.
- Post-onboarding: lands on `/app` → Brief empty state `ComposeMyPlanButton` (`features/plan/BriefCanvas.tsx:69-130`, "Lumi is preparing your first plan"). "Show me my first week" = go to `/app`; **no compose trigger**.

**Design tokens (colors.css / DESIGN.md):**
- `--honey-amber-50..600` (recognition); `--lumi-terracotta-500` (#b46a4e, Lumi's voice); `--safety-cleared-teal-{100,200,500,800}` (safety pills). Semantic: `bg-amber`(#b97730)/`bg-amber-warm`(#d98f3c) are BUTTON tokens — comments warn `--amber-warm` is **never** a glow. Use `--honey-amber-*` for `hk-glow`. `text-foliage` (#5f7a67) = completion.
- Keyframes in `globals.css:10-38`: `hk-slide-in-sheet`, `hk-slide-up-whisper`, `hk-land`, `hk-sacred-plum-pulse`. **No `hk-glow` yet** — add it (AC6). Motion convention: `motion-reduce:animate-none` at every call site.

### Religious enforcement — the real gap (context for Q1)
- Capture: `inferCulturalPriors` runs at finalize (`onboarding.agent.ts:410-520`) → `inferFromSummary`/`upsertDetected` insert `state='detected'` with enforcement defaulting to `just_for_context` (`cultural-prior.service.ts:63-109`). `CulturalRatificationStep.tsx` (post-consent, pre-`/app`) lets the parent opt-in. So the prior IS captured before the Brief.
- **The bug:** `memory-context.service.ts:22-48` returns `culturalObligations: []` unconditionally, so `buildCulturalContextLines` (`planner/context/render.ts:14-70`) never emits the "Cultural obligations (required — do not override)" block, and the planner (`planner.prompt.ts:116` — context pre-injected, `cultural.lookup` not in allowlist) never sees halal/kosher. A `non_negotiable` halal household can get pork in the first (and every) plan. This is why Task Group C is capture-*and*-enforce, and why it's arguably its own slice.

### Previous-story intelligence
- **13-s5** (done, direct predecessor): decomposed `OnboardingText` into the hook + `ConversationColumn` + `KitchenMapHero` + `OnboardingChips`; deleted client heuristics (hero is projection-only); relocated `HistoryView` to kitchen-profile. Its review added: premature-"All clear" gating (projection-loaded only), map-fetch race guard (`mapFetchSeqRef`), control-key echo suppression, `aria-live` on the Lumi question, safety-pill AA contrast (`text-safety-cleared-800` on `bg-safety-cleared-100`). Mirror these disciplines. **13-s5 explicitly reserved the recognition ending, entry continuity, and the §6.1 decision for THIS slice** (13-s5 Scope Decision 3).
- **13-s2/s3** established the keyframe-in-`globals.css` + `motion-reduce:` pattern (`hk-slide-in-sheet`, `hk-slide-up-whisper`) and `role="status"`/`aria-live="polite"` for calm announcements — reuse for the recognition beat.
- Known pre-existing web-unit baselines (confirm via `git stash`, don't "fix"): `useLumiVoiceSession` ×6 (VAD/onnx in jsdom), `sse` packer ×1. The old `OnboardingText` finalize `gap-callout` baseline was removed in s5.

### Project Structure Notes
- Backend: surgical edits in `apps/api/src/modules/onboarding/` + one comment in `packages/contracts/`. `m3_answered` is NOT a migration — `required_set_status` is persisted in the moment-state row (JSON), so adding a boolean field needs no schema change (verify how the row is stored in `onboarding-moment.repository.ts` upsert; if it's a typed column set, adjust accordingly — expected: JSON payload).
- Frontend: changes under `apps/web/src/features/onboarding/` + `routes/(app)/onboarding.tsx` + `globals.css`, colocated `*.test.tsx`, named exports, `import type`, Tailwind-only warm-neutral tokens, files ≤~300 lines.
- **This is a coordinated backend+frontend slice but NOT a contract-shape change** (only a doc comment, unless Q3-hardening promotes the enum → then it's contracts+api+web in one PR per project-context rules). No new dependency.

### References
- [Source: `_bmad-output/planning-artifacts/epic-13-lumi-ux-rebuild-brief.md` §Phase 3 13-s6 (186-190), risk register (133), §6.1 pre-req (257)].
- [Source: `_bmad-output/planning-artifacts/lumi-conversational-ux-rebuild-vision.md` §3c/§3e, §6 tension #1 (131-136), §3d front-load-safety (98)].
- [Source: `apps/api/src/modules/onboarding/onboarding.service.ts` (909-954 slot signals, 996-1002 upsert, 1104-1122 required-set, 1215-1376 finalize, 1032 seed enqueue)].
- [Source: `apps/api/src/modules/onboarding/onboarding.controller.ts` (56-67 predicates, 84-96 nextMoment, 98-109 reconstructMoment — line 106 M3 skip)].
- [Source: `apps/api/src/modules/onboarding/onboarding-moment.repository.ts` (36-42 RequiredSetStatus, 119-183 countRequiredSetSources)].
- [Source: `apps/api/src/modules/onboarding/onboarding.routes.ts` (251-289 state, 313-328 finalize)].
- [Source: `packages/contracts/src/onboarding.ts` (90-96 required-set fields, 109-117 finalize response)].
- [Source: `apps/api/src/agents/eval/onboarding-golden.eval.test.ts` + `onboarding-eval.goldens.json` + `onboarding-eval.fixtures.ts` — 9 scenarios; regenerate finalize-gate-negative, watch safety-net-reanchor].
- [Source: `apps/web/src/features/onboarding/ConversationColumn.tsx` (114-145 gap callouts, 176-217 finalize gate) + `onboarding-conversation.ts` (~288-293 handleFinalize) + `KitchenMapHero.tsx` (projection fields)].
- [Source: `apps/web/src/routes/(app)/onboarding.tsx` (24-31 modes, 171-191 select, 244 onFinalized, 253-296 consent/cultural/mental-model)].
- [Source: `apps/web/src/features/plan/BriefCanvas.tsx` (69-130 ComposeMyPlanButton / first-plan empty state — "Show me my first week" destination)].
- [Source: `apps/web/src/styles/globals.css` (10-38 keyframes) + `packages/design-system/tokens/colors.css` (honey-amber / lumi-terracotta / safety-cleared-teal)].
- [Source (Q1 / Task C): `packages/contracts/src/cultural.ts` (8-45), `enforcement.ts` (25-34); `apps/api/src/modules/cultural-priors/cultural-prior.service.ts` (63-109); `apps/api/src/agents/onboarding.agent.ts` (410-520); `apps/api/src/services/memory-context.service.ts` (22-48 culturalObligations:[]); `apps/api/src/jobs/planner-context.loader.ts` (256-280); `apps/api/src/agents/planner/context/render.ts` (14-70); `apps/web/src/features/onboarding/CulturalRatificationStep.tsx`/`Card`].
- [Source: `apps/web/test/e2e/2-7-text-onboarding.spec.ts` (111-157 finalize→consent), `13-s1-ux-regression-baseline.spec.ts` (AC1.1 entry, AC2 axe, AC4 reduced-motion); `OnboardingText.test.tsx` (486-569 finalize-gate), `KitchenMapHero.test.tsx`].
- [Source: `_bmad-output/implementation-artifacts/13-s5-onboarding-one-mode-kitchen-map-hero.md` — predecessor; Scope Decision 3 reserves this slice's scope].
- Memory: `epic-13-s6-defer-line-decision` (the §6.1 call), `onboarding-ux-is-chat-not-form`, `lumi-valet-not-chat-app`, `onboarding-text-first`, `chip-taxonomy-three-types`, `design-md-canonical`, `guardrail-two-tier-allergen-doctrine`, `allergen-storage-model`, `epic-2-7-brief-drafted`.

## Open Questions

1. **Q1 — Religious enforcement: in this slice, its own slice, or capture-only for now?** Capture of halal/kosher already runs pre-`/app` (`CulturalRatificationStep`). The gap is the planner ignoring `culturalObligations` (default `just_for_context` + hardcoded `[]`) — a planner/guardrail bug (Task Group C). **Recommendation:** do NOT bundle it into 13-s6 (different subsystem; would double the blast radius and drag the golden-eval + planner tests into an onboarding-UX slice). Spin a dedicated slice (e.g. 13-s6b or an Epic 3/guardrail story). If Menon wants the "safe first plan for religious families" guarantee in this slice, opt in Task Group C. **Default: OUT.**
2. **Q2 — Voice-entry treatment in the reframed `select` step.** Options: (a) quiet "voice coming soon" chip/label, text is the only actionable path; (b) keep a "Start with voice" button that leads to a graceful "we're finishing voice — type for now" screen; (c) remove voice affordance entirely, pure text entry. **Recommendation (a)** — honest continuity promise ("start talking, finish typing") without a dead-end, minimal build. Confirm.
3. **Q3 — M5 natural threshold: lower 10→5, or keep 10 and rely on the ≥4 override chip?** §6.1 said "~5 might be enough." The `override_fewer` chip already lets a parent stop at 4, so the *felt* ask is already light. Lowering the natural threshold to 5 makes the light path the default; keeping 10 leaves it as an explicit opt-out. **Recommendation:** lower to 5 (matches the stated intent; one-line change). Confirm before A4.
4. **Q4 — Slice sizing.** With Task Group C OUT (Q1 default), 13-s6 = contained backend required-set change + frontend recognition/continuity — comparable to 13-s5. With C IN, it's ~2 slices. Confirm you're comfortable shipping A+B as one slice (recommended) vs splitting backend (A) and frontend (B).

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (dev-story workflow, 2026-07-02)

### Debug Log References

- Golden regen: ran a throwaway `_regen-goldens.mts` through the eval harness (`runScenario` over `SCENARIOS`), then diff-reviewed and deleted it. Deltas confirmed = only the two backend changes (m3_answered field everywhere; m3_taste in missing_required_set where M3 unanswered; spine advance at 5; reanchor → m3_taste).
- `onboarding.routes.test.ts` used a LOCAL inline `required_set_status` type (not the imported `RequiredSetStatus`), so it escaped the type sweep — caught at runtime (2 finalize tests 409'd on the new M3 gate) and fixed (local type + 2 summary literals).

### Completion Notes List

- **Open questions (final):** Q1 = OUT (Task Group C not built), Q2 = quiet "coming soon" / text-only actionable, Q3 = lower M5 natural threshold 10→5, Q4 = A+B one slice. All per Menon.
- **Backend (surgical):** `m3_answered` is sticky (`m3Answered || preTurn.m3_answered`), sourced from the existing per-turn signal — no second source, no migration (`required_set_status` is a JSON payload). Joined into `required_set_complete`, both finalize gates, and `renderMomentStateBlock` (the prompt-facing twin — kept consistent so the LLM is never told the set is complete while M3 is missing).
- **Golden eval:** regenerated the whole file (the field addition unavoidably touches every scenario's `required_set_status`, beyond the story's "1 scenario" estimate — every delta reviewed and traced). Spot checks for spine + reanchor updated.
- **Frontend:** `ConversationColumn` dropped 283 → 216 lines by extracting `RecognitionEnding` + `recognition-prose` and folding the duplicate summary gap-callouts into the recognition incomplete-state. Honey-glow uses `color-mix` over `--honey-amber-500` (token-driven, no hard-coded rgba), one-shot `forwards`, `motion-reduce:animate-none`.
- **Scope note (entry):** the story's Gate requires the Epic 2.5/2.6 onboarding e2e stay green, and ~10 of those enter text via the **"I'd rather type"** button — so it was KEPT (→ text) rather than removed. Text is the actionable primary ("Start with Lumi" → text); the continuity line stands in for voice. Fixed one pre-existing lint error (`ml-2` → `ms-2`) in the `OnboardingActions` StepIndicator to keep the changed file lint-clean (AC8).
- **Voice e2e (Q2a consequence):** `2-6-voice-onboarding` and `2-6b-voice-pipeline-v2` enter only via the now-removed "Start with voice" button. Per Menon, `test.describe.skip`'d with a restore-with-future-voice-slice comment (OnboardingVoice component left intact).
- **Verification:** 137 API onboarding unit/route/eval tests + 89 web onboarding unit tests green. `pnpm --filter @hivekitchen/api typecheck`, `--filter @hivekitchen/web typecheck` + `build`, `--filter @hivekitchen/contracts typecheck` all clean. ESLint clean on every changed TS/TSX file. E2E specs updated to the new surface but not run locally (known PWA-SW-bypass flakiness — trust CI ubuntu).

### File List

**Backend (`apps/api`, `packages/contracts`)**
- `apps/api/src/modules/onboarding/onboarding-moment.repository.ts` — `m3_answered` on `RequiredSetStatus` + defaults/normalize
- `apps/api/src/modules/onboarding/onboarding.service.ts` — sticky `m3_answered` upsert, required-set + missing-set, both finalize gates, M5 threshold 10→5
- `apps/api/src/modules/onboarding/onboarding.controller.ts` — `reconstructMoment` M3 stop + `m3Complete` comment
- `apps/api/src/modules/onboarding/onboarding-turn-runner.ts` — `renderMomentStateBlock` M3 line + completeness
- `packages/contracts/src/onboarding.ts` — `missing_required_set` doc comment
- `apps/api/src/agents/eval/onboarding-eval.goldens.json` — regenerated
- `apps/api/src/agents/eval/onboarding-eval.fixtures.ts` — spine turn-6/7 comments
- `apps/api/src/agents/eval/onboarding-golden.eval.test.ts` — spine + reanchor spot checks
- `apps/api/src/modules/onboarding/onboarding.service.test.ts` — M3-required + finalize cases, m5 threshold fixups
- `apps/api/src/modules/onboarding/onboarding.controller.test.ts` — reconstruct M3 cases
- `apps/api/src/modules/onboarding/onboarding.routes.test.ts` — local type + summary literals
- `apps/api/src/modules/onboarding/onboarding-zero-call.test.ts`, `apps/api/src/agents/onboarding-tracer.test.ts`, `apps/api/src/modules/onboarding/onboarding-moment.repository.test.ts` — `m3_answered` in literals

**Frontend (`apps/web`)**
- `apps/web/src/features/onboarding/RecognitionEnding.tsx` — NEW
- `apps/web/src/features/onboarding/recognition-prose.ts` — NEW (prose builder)
- `apps/web/src/features/onboarding/RecognitionEnding.test.tsx` — NEW
- `apps/web/src/features/onboarding/recognition-prose.test.ts` — NEW
- `apps/web/src/features/onboarding/ConversationColumn.tsx` — recognition ending replaces finalize gate + gap callouts; `kitchenMap` prop
- `apps/web/src/features/onboarding/OnboardingText.tsx` — pass `kitchenMap`
- `apps/web/src/features/onboarding/OnboardingText.test.tsx` — migrated finalize-gate tests + finalize-nav test
- `apps/web/src/features/onboarding/components/OnboardingActions.tsx` — `secondaryLabel={null}` support + `ml-2`→`ms-2`
- `apps/web/src/routes/(app)/onboarding.tsx` — text-first entry reframe
- `apps/web/src/styles/globals.css` — `hk-glow` keyframe
- `apps/web/test/e2e/13-s1-ux-regression-baseline.spec.ts` — entry assertions
- `apps/web/test/e2e/2.5-s10-summary-and-finalize-gate.spec.ts` — recognition-ending migration
- `apps/web/test/e2e/2-6-voice-onboarding.spec.ts`, `apps/web/test/e2e/2-6b-voice-pipeline-v2.spec.ts` — `describe.skip` (Q2a)

**Docs / tracking**
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — 13-s6 → review
- memory `epic-13-s6-defer-line-decision.md` + `MEMORY.md` pointer

## Change Log

| Date | Version | Description | Author |
|------|---------|-------------|--------|
| 2026-07-01 | 0.1 | Story authored (create-story) after resolving §6.1 (Menon): move the defer line — promote M3 (cuisine+dietary) into the required-set gate, keep M5 required + light, M4 optional; recognition ending replaces the finalize gate; entry continuity text-first (voice deferred). Backend+frontend slice. Religious enforcement (Task Group C) gated behind Q1 (default OUT — planner/guardrail bug, own slice). Status → ready-for-dev. | Menon |
| 2026-07-02 | 1.0 | Implemented (dev-story, claude-opus-4-8[1m]). Q1 OUT, Q2 voice-deferred (text-only), Q3 M5 threshold 10→5, Q4 A+B one slice. Backend: `m3_answered` in the required set + finalize gates + re-anchor + `renderMomentStateBlock`; golden eval regenerated. Frontend: `RecognitionEnding` + `recognition-prose` + `hk-glow` replace the finalize gate; text-first entry (kept "I'd rather type" for the 2.5/2.6 e2e gate). 137 api + 89 web onboarding tests green; typecheck/build/lint clean; voice e2e skipped. Status → review. | Amelia (dev-story) |
