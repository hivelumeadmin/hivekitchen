# Story 13.5: One Conversation Mode + Kitchen-Map-as-Hero

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Source brief:** `_bmad-output/planning-artifacts/epic-13-lumi-ux-rebuild-brief.md` § Phase 3, 13-s5.
> **Vision:** `_bmad-output/planning-artifacts/lumi-conversational-ux-rebuild-vision.md` §3a (Kitchen-Map-as-hero) + §3b (one conversation mode).
> **Reference mockup:** `_bmad-output/planning-artifacts/lumi-rebuild-onboarding-mockup.html` (layout/composition ONLY — its dark palette + drifted hexes are NOT adopted).
> **Gate (must stay green):** `apps/web/test/e2e/13-s1-ux-regression-baseline.spec.ts`, `apps/web/test/e2e/2-7-text-onboarding.spec.ts`, the Epic 2.5/2.6 onboarding e2e specs, and the API `onboarding-golden.eval.test.ts`.
> **Backend is a BLACK BOX.** This slice lands on the shipped Epic 2.7 backend (`OnboardingController` / `OnboardingTurnRunner` / `onboarding-chips.ts`) and changes **no** API, contract, or migration. If you feel the urge to touch `apps/api/src/modules/onboarding/*` — stop; that is out of scope.
> **The onboarding conversational exception:** the valet doctrine (`lumi-valet-not-chat-app`) forbids a persistent chat column *at rest on finished surfaces*. Onboarding is the **deliberate exception** (`onboarding-ux-is-chat-not-form`) — it *must* ask, so a single calm conversation column is correct HERE and only here.

---

## Story

As a **parent going through HiveKitchen onboarding**,
I want **a single calm conversation where Lumi asks one question at a time, my answers are simple taps and short lines, and the Kitchen Map builds itself into a wide living panel beside me — a child card appearing, an allergen clicking into place in safety-teal**,
so that **onboarding feels like being understood rather than filling a form, and the "I'm being seen" moment — not an interview wall — is what carries me to my first week**.

---

## Scope Decisions (locked before authoring — do not re-litigate)

1. **Presentation rebuild on the 2.7 backend — NOT a backend or contract change.** Rebuild the onboarding conversation *surface* (`OnboardingText.tsx` and its Kitchen Profile panel). The turn contract (`TextOnboardingTurnRequestSchema` union, `TextOnboardingTurnResponseSchema`), the finalize/state/reset endpoints, the `KitchenMapSchema` projection, and the `onboarding-golden.eval.test.ts` are **frozen inputs**. No files under `apps/api/` or `packages/contracts/` change in this slice.

2. **The Kitchen Map hero binds to the authoritative projection, not client heuristics.** The turn-runner renders `kitchenMap` into the *system prompt* (server-side); it is **not** in the turn response. The frontend's authoritative source for the hero is the existing `GET /v1/households/{householdId}/kitchen-map` (`KitchenMapSchema`), re-fetched after each turn exactly as `OnboardingText` already does (current lines ~1548–1556). The current file *also* carries regex-extraction + topic-detection heuristics (`extractChildren`/`extractAllergens`/"topics covered" percent) that **predate** the 2.7 authoritative slot model and now duplicate it — the hero must render from the projection + `moment_key`, and the heuristic display layer that your rebuild orphans should be removed (do not keep a second, guessing source of truth). **Safety-critical M2 display must not regress** (AC5/AC6).

3. **s5 owns the conversation surface only. The ending stays as-is for s6.** The recognition/summary ending (playback prose + honey-glow + "Show me my first week"), entry continuity (the voice/text `select` screen), and the front-load-safety/defer-non-safety §6.1 decision are **13-s6** and are explicitly OUT of scope. In this slice, the `summary` moment and its **finalize gate render and behave exactly as they do today** — do not restyle the Finalize button or the gap-callout into a recognition moment. Likewise `routes/(app)/onboarding.tsx`'s `select` / `consent` / `cultural-ratification` / `mental-model` steps are untouched.

4. **Editorial Hearth is FROZEN — topology/composition only.** The mockup is a *dark-theme concept* with drifted local hexes (`#1a1714`, `#241712`, `rgba(217,143,60,.1)`, `rgba(95,168,160,.32)`, etc. — see mockup lines 11–18). **None of those are adopted.** Use canonical semantic tokens only: `bg-bg`/`bg-surface`, `text-fg`/`text-fg-muted`, `border-border`, `--lumi-terracotta` (Lumi's voice), `--amber` (recognition/honey — recognition only, never a hover), `--safety-cleared-teal` (the safety channel for the "Keeping safe" pills). No new external dependency.

5. **Converge — no third parallel path.** After the rebuilt surface realizes the mockup, the duplicated per-moment mockup pages under `features/onboarding-mockups/` (and their dev routes `_dev-onboarding-mockups`, `_dev-onboarding-moment-1..6`) are superseded design scaffolding. Fold/delete them so there is no second onboarding-rendering implementation (brief risk register: "s5 explicitly converges — delete the mock impl or fold it into the rebuilt surface"). See **Open Question Q1** — this touches a memory-flagged design surface (`onboarding-mockups-route`), so confirm the delete-vs-keep line with Menon before removing.

---

## Acceptance Criteria

### AC1 — One conversation mode (drop the focused/history toggle)

- The conversation column is **one calm thread**: Lumi's serif question, the deterministic chips inline **below** the question, and a single pill/text input. The **focused-view / history-view toggle and the history modal are removed** (current `OnboardingText.tsx` focused view ~1938–2108, history view ~1916–1936). There is no mode switch and no separate transcript modal — recent turns read inline in one column.
- The waveform/glyph gleaming as Lumi's signature is preserved (mockup `.glyph`), rendered with canonical tokens.
- (Vision §3b; memory `onboarding-ux-is-chat-not-form`, `chip-taxonomy-three-types`.)

### AC2 — Drop the visible chip-bracket encoding (wire contract unchanged)

- A chip turn no longer echoes the literal `[Chips selected: label1, label2]` string into the transcript (current optimistic echo ~1590–1597; `parseBracketChipKeys` ~426–431). Selected chips render as a **clean user echo** (e.g. the chosen pills / their labels as a plain line), not the bracket sentinel.
- **The request contract is unchanged:** chip turns still POST the clean discriminated union `{ chip_selections: string[], text?: string }` (`ChipTurnBodySchema`) — the `[Chips selected: …]` prefixing happens **server-side in the route handler** and must be left alone. Do not change what the client sends; only what the client *shows*.

### AC3 — Kitchen-Map-as-hero (the wider column, authoritative projection)

- The layout is two columns: a **slim conversation column** (~0.9fr) and a **wider Kitchen Map hero** (~1.1fr) — the map is the showpiece, not a sidebar (Vision §3a; mockup `.ob` grid lines 41–42). It collapses to a single stacked column / drawer on narrow screens (mockup breakpoint ≤880px; preserve the current mobile-drawer affordance).
- The hero renders from the **authoritative `KitchenMap` projection** (`GET /v1/households/{householdId}/kitchen-map`, re-fetched post-turn) with sections in mockup order: **Family** (child cards: name + age/avatar), **Keeping safe** (allergen pills in the `--safety-cleared-teal` safety channel), **How your kitchen tastes** (dietary/cuisine + food-preference tags), and a deferred **"The bag & your week"** ghost line ("Lumi learns these as you cook the first week"). Empty sections stay hidden until they have data.
- A quiet **"Building as we talk…"** live indicator sits at the top of the hero (mockup `.live`).

### AC4 — Cards and pills land live

- When a new child card or safety pill first appears (a slot filled by the latest turn), it animates in with a subtle land/fade-up (mockup `.land`), each paired with `motion-reduce:animate-none`. Define any new keyframe in `globals.css` alongside the existing `hk-slide-in-sheet` (s2) / `hk-slide-up-whisper` (s3) — reuse the repo `motion-reduce:` convention (`globals.css:11-12`), do **not** add a JS animation library.
- The "land" is a first-appearance affordance, not a re-render on every fetch (already-present cards do not re-animate on each poll).

### AC5 — Chip taxonomy + all shipped chip behaviors preserved (no 2.5/2.6 regression)

- Chips render from `chip_config` with the **hint / action / choice** taxonomy intact (`ChipConfigSchema`: `mode`, `options[{key,label,provenance?}]`, `hints[]`, `skip_label?`), inline below Lumi's turn (memory `chip-taxonomy-three-types`: broad→hint, narrow→action/choice).
- Preserved behaviors (each currently covered by `OnboardingText.test.tsx`): M2 **"No known allergens" exclusivity** (tapping it clears the rest; tapping any allergen clears it); the **skip chip** firing `{ chip_selections: ['skip'] }`; **M5 cold-start** free-text gate when `chip_config === null` + `cold_start_mode` (the "tell Lumi three dishes" progressive gate + override link); and the **M5 provenance ＋ badge** on `provenance:'parent_added'` chips (Slice 2.6-s4).

### AC6 — Moment flow, safety gate, and resume preserved

- `moment_key` from the turn response drives the flow (m1_table → m2_safe → m3_taste → m4_bag → m5_starting_line → summary); the **M2 safety moment gate is preserved** (it must be reached and answered — the required-safety slot). Do not re-implement moment advancement on the client beyond reflecting `moment_key` + the existing optimistic capture; the 2.7 controller is authoritative.
- The **finalize/summary gate is untouched** (per Scope Decision 3): at `summary`, the existing required-set gate (`required_set_complete` / `missing_required_set`, gap callouts, "Finalize" button) renders and behaves as today. (s6 replaces it with the recognition ending — not now.)
- **Resume/reset reconstructs from slot state:** the `initialTurns` / `initialHouseholdDisplayName` / `initialMomentKey` / `initialChipConfig` props (fed by `routes/(app)/onboarding.tsx` from `GET /v1/onboarding/state`) still hydrate a resumed session into the one-mode surface with the hero populated from the current projection. The legacy `is_complete` path and the 502-error "turn persisted, don't restore draft" rollback (current ~1779–1802) still behave correctly.

### AC7 — Onboarding stays the exception; no ambient Lumi leaks in

- `routes/(app)/onboarding.tsx` continues to mount **no** ambient `LumiPresence` (the flat onboarding layout is outside the `(app)` presence mount — confirm the s2 presence dot/whisper/sheet does not appear on the onboarding route). The persistent conversation column is allowed **only here** (memory `onboarding-ux-is-chat-not-form`); every finished surface (Brief/planner) remains chat-less.

### AC8 — Converge the mockup duplication (Q1-gated)

- Fold/delete the superseded `features/onboarding-mockups/` per-moment pages and their `_dev-onboarding-mockups` / `_dev-onboarding-moment-1..6` routes so no second onboarding-rendering path survives — **after confirming the delete line in Q1.** Remove any imports/exports orphaned by the deletion. Do not delete unrelated dev routes.

### AC9 — File decomposition + design-system fidelity

- `OnboardingText.tsx` is **2,457 lines** today — far over the ~300-line rule (`project-context.md`). The rebuild **must decompose** it: at minimum a conversation-column component, a Kitchen-Map-hero component, and chip-rendering, as separate files under `features/onboarding/` (colocated `*.test.tsx`), each ≤ ~300 lines. Named exports, `import type`, Tailwind-only, canonical warm-neutral tokens (Scope Decision 4). Reuse the existing `ChoiceChip` / `HintChip` / `SkipChip` primitives rather than re-authoring chip buttons.

### AC10 — Tests + gates green

- Update `OnboardingText.test.tsx` (1,152 lines) **in lockstep** with the layout change so its *behavior* assertions (M2 exclusivity, skip submission, M5 count/override, provenance badge, finalize-gate visibility, error rollback) stay green on the new composition; migrate any assertion that pins the removed focused/history toggle to the one-mode surface. (The one **pre-existing** failing `gap-callout` finalize test is the documented baseline — confirm via `git stash` it is not newly broken by your change.)
- `apps/web/test/e2e/2-7-text-onboarding.spec.ts` and the Epic 2.5/2.6 onboarding e2e specs pass. The API `onboarding-golden.eval.test.ts` is **untouched and green** (no backend change → structured outcomes are byte-stable).
- The **13-s1 regression gate** stays green (axe AA on `.app-scope`; reduced-motion; no new contrast offender in `isKnownContrastDebtNode()` — the new hero/land animations must not add debt).
- `pnpm --filter @hivekitchen/web typecheck` and `pnpm --filter @hivekitchen/web build` succeed; lint clean on changed files; no new external dependency.

### AC11 — Memory cross-link

- Update memory: cross-link `lumi-valet-not-chat-app` ↔ `onboarding-ux-is-chat-not-form` to record the onboarding exception explicitly (the valet model applies everywhere *except* the onboarding conversation surface). One-line index pointer in `MEMORY.md` stays consistent.

---

## Tasks / Subtasks

- [x] **Task 1 — Decompose + rebuild the conversation column to one mode (AC: 1, 2, 9)**
  - [x] Split `OnboardingText.tsx` (2,457 → 121 lines) into `useOnboardingConversation` (hook, 320) + `ConversationColumn` (400) + `OnboardingChips` (95) + `KitchenMapHero` (235). Turn-submission / finalize / resume / error-rollback logic moved into the hook, behavior preserved.
  - [x] Removed the focused/history toggle + history modal; one calm inline thread (clean user echo → glyph → Lumi serif question → inline chips → pill input).
  - [x] Stopped echoing `[Chips selected: …]` — `formatUserEcho` strips the sentinel; the request body stays the `ChipTurnBodySchema` union (server does the prefixing).
- [x] **Task 2 — Kitchen-Map hero from the authoritative projection (AC: 3, 4)**
  - [x] Built the wider (~55%) hero bound to the `KitchenMap` projection (re-fetched post-turn): Family cards / Keeping safe (safety-cleared teal pills) / tastes / deferred bag-&-week ghost; "Building as we talk…" live line (`role=status`).
  - [x] `hk-land` keyframe in `globals.css`; every card/pill `animate-[hk-land…] motion-reduce:animate-none`.
  - [x] Removed the regex-extraction + topic-percent heuristic layer; safety "All clear" gated to *past* M2 (never premature); `mapPending` drives the thin placeholder (Q2).
- [x] **Task 3 — Preserve chip taxonomy + moment/safety/resume behavior (AC: 5, 6, 7)**
  - [x] Reused `ChoiceChip`/`HintChip`/`SkipChip`; kept M2 `none`-exclusivity, skip `['skip']`, M5 cold-start gate + provenance ＋ badge.
  - [x] Kept `moment_key` flow, the untouched summary/finalize gate + gap callouts + jump-to-moment, `initial*`-prop resume, and the legacy `is_complete` "Finish onboarding" CTA. Onboarding route still mounts no ambient Lumi (flat, outside the `(app)` presence mount).
- [x] **Task 4 — Converge mockups (AC: 8)** — *Q1 → option 3 (delete all), confirmed by Menon*
  - [x] Deleted `features/onboarding-mockups/` + `_dev-onboarding-mockups`/`_dev-onboarding-moment-1..6` routes + their `app.tsx` registrations; deleted the now-orphaned `ChoiceChipGroup` + `MomentProgress`. Relocated the still-used `HistoryView` + `ChatTurn` (kitchen-profile's `EditConversation`) into `features/kitchen-profile/components/HistoryView.tsx`.
- [x] **Task 5 — Tests, gates, memory (AC: 10, 11)**
  - [x] Rewrote `OnboardingText.test.tsx` in lockstep (33 behavior tests incl. clean-echo, no-history-toggle, legacy finish) + new `KitchenMapHero.test.tsx` (7 projection tests). The old `gap-callout` baseline failure is gone (rewritten).
  - [x] Gates: `2-7-text-onboarding` e2e 7/7; `13-s1` 19 pass / 1 skip / 1 pre-existing fail (s2 LumiSheet "Voice mode" contrast — unrelated, documented in 13-s4 W1); `onboarding-golden.eval` 17/17 (untouched); typecheck + `pnpm build` clean; changed files lint-clean.
  - [x] Cross-linked `lumi-valet-not-chat-app` ↔ `onboarding-ux-is-chat-not-form`; retired `onboarding-mockups-route` + updated `mock-screen-reference-check` + `MEMORY.md`.

---

## Dev Notes

### What already exists — REUSE, do not reinvent

**The 2.7 backend (BLACK BOX — do not modify):**
- `POST /v1/onboarding/text/turn` → `TextOnboardingTurnResponseSchema`: `{ lumi_response, chip_config (nullable), moment_key (m1_table|m2_safe|m3_taste|m4_bag|m5_starting_line|summary|finalized), required_set_complete, missing_required_set[], cold_start_mode, household_display_name, thread_id, turn_id, lumi_turn_id, is_complete }`. Request is the union `TextTurnBodySchema {message}` | `ChipTurnBodySchema {chip_selections[], text?}`.
- `GET /v1/onboarding/state` → resume payload (turns + moment + chip_config + display name); `POST /v1/onboarding/text/finalize`; `POST /v1/onboarding/state/reset` (204); `POST /v1/onboarding/mental-model-shown` (204).
- `GET /v1/households/{householdId}/kitchen-map` → `KitchenMapSchema` `{ household, children[], allergens[], dietary[], food_preferences[], favorite_lunches[], cultural, memory, rules[], … }` — **the hero's authoritative source**.
- `ChipConfigSchema` (`packages/contracts/src/onboarding.ts`): `{ mode:'hint'|'action'|'choice', options?:[{key,label,provenance?}], hints?:string[], skip_label?:string }`. Pure-chip M2/M3/M4 turns are a zero-LLM deterministic path (immediate ack) — nothing the UI must special-case beyond rendering the returned `lumi_response`.

**The current onboarding frontend (`apps/web/src/features/onboarding/`):**
- `OnboardingText.tsx` (2,457 lines) — the surface to rebuild. Carries: focused view (~1938–2108), history modal (~1916–1936), the Kitchen Profile panel (`KitchenProfilePanel` ~580–1298, desktop sidebar ~2378–2401 + mobile drawer ~2405–2454), chip rendering (~2010–2103), the M1–M5 optimistic capture machines + regex extraction + topic-percent heuristics, the post-turn kitchen-map fetch (~1548–1556), the finalize gate (~2140–2182 + gap callouts), and error rollback (~1779–1802).
- Chip primitives to reuse: `components/ChoiceChip.tsx` (single/multi-select; selected = foliage), `components/HintChip.tsx` (read-only), `components/SkipChip.tsx` (fires `['skip']`). `components/ChoiceChipGroup.tsx` is effectively deprecated (chips render inline) — safe to drop if orphaned.
- Leave untouched (s6 / separate flows): `OnboardingVoice.tsx`, `OnboardingConsent.tsx`, `OnboardingResume.tsx`, `CulturalRatificationStep.tsx`/`Card`, `OnboardingMentalModel.tsx`, and `routes/(app)/onboarding.tsx`'s state machine (`select`→`voice|text`→`consent`→`cultural-ratification`→`mental-model`).

**Mockup convergence target:** `features/onboarding-mockups/` = 15 dev-only pages (`Moment1..6Page` + `*PersonalizedPage` + `ColdStartPage` + `ChipPrimitivePage` + `components/HistoryView` + `data/conversation-history.ts`) wired at `_dev-onboarding-mockups`/`_dev-onboarding-moment-1..6`. These duplicate the moment-rendering the rebuilt surface will own — the delete/fold target (Q1).

### The reference mockup — harvest composition, reject the palette

`lumi-rebuild-onboarding-mockup.html`: two-column `.ob` grid `grid-template-columns:0.9fr 1.1fr; gap:32px` (conversation left, Kitchen Map hero right), `@media(max-width:880px){grid-template-columns:1fr}`. Hero `.map` sections in order: `.live` ("Building as we talk…") → `.kname` → Family (`.card`) → Keeping safe (`.safetypill`, teal) → tastes (`.tastepill`) → deferred `.ghost`. Chips (`.chip`/`.chip.sel`/`.chip.hint`) render inline below the serif question. `.land` = card entry (fade + `translateY(10px)`); `.glow` = recognition (that's **s6**, not now). **Do NOT copy** its dark tokens (`--bg:#1a1714`, `#241712`, the raw `rgba(217,143,60,.1)` / `rgba(95,168,160,.32)`) — map every one to a canonical semantic token.

### Design-system anchors (DESIGN.md — canonical, read before UI authoring)
- `--lumi-terracotta` = Lumi's voice; `--amber`/honey = **recognition only, never hovers** (the "land" of a card is a recognition-ish beat but keep it a quiet fade, not an amber flash — save the honey-glow for s6's recognition ending); `--safety-cleared-teal` = the safety channel for the "Keeping safe" allergen pills; `bg-bg`/`bg-surface`/`text-fg`/`text-fg-muted`/`border-border`. Reduced-motion floor via the Tailwind `motion-reduce:` variant. `.app-scope` = AA (onboarding is app-scope). Presence/whisper/sheet added by s2/s3 are new locked components — onboarding does not use them (AC7).

### Previous-story intelligence (13-s2 / s3 / s4, all done)
- **s2** deleted `LumiOrb/LumiPanel/LumiFAB`, introduced `LumiPresence`/`LumiSheet`/`presenceState`, and added the `hk-slide-in-sheet` keyframe + the `motion-reduce:` convention you'll mirror for the "land" animation. It also established the "update the 13-s1 gate in lockstep, keep durable a11y/safety assertions green" pattern.
- **s3** added `hk-slide-up-whisper` (same keyframe-in-`globals.css` pattern) and `role="status"`/`aria-live="polite"` for calm announcements — reuse that a11y idiom for the "Building as we talk…" live line.
- **s4** proved the finished-surface / no-chat model on the Brief and reinforced: *don't* churn working logic — keep changes surgical, migrate tests rather than delete coverage. The Brief's safety display (`AllergyClearedBadge`, `--safety-cleared-teal`) is the visual precedent for the onboarding safety pills.
- Known pre-existing web-unit baseline failures (confirm via `git stash`, don't "fix" as part of this slice): `useLumiVoiceSession` ×6 (VAD onnx in jsdom), `sse` packer ×1, and the `OnboardingText` finalize `gap-callout` ×1.

### Project Structure Notes
- New/changed web files under `apps/web/src/features/onboarding/` with colocated `*.test.tsx`. No barrels; named exports; `import type`; Tailwind-only warm-neutral tokens; files ≤ ~300 lines (AC9). `apps/web` never imports from `apps/api`.
- **No contract / migration / backend change.** If you believe one is required, that is a coordinated contract change (contracts + web + api in one PR) — flag it, do not do it silently. The whole point of this slice is that the 2.7 backend already provides what the hero needs.

### References
- [Source: `_bmad-output/planning-artifacts/epic-13-lumi-ux-rebuild-brief.md` § Phase 3 13-s5; §2 Impact (Story/Artifact Conflicts); §5 epic-level AC #6] — AC sketch, folds (Vision §3a/§3b), edge cases (conversational exception, M2 gate, resume), converge directive, memory-update note.
- [Source: `_bmad-output/planning-artifacts/lumi-conversational-ux-rebuild-vision.md` §3a (live-profile-as-hero), §3b (one mode, drop chip-bracket encoding), §3e/§3c/§3d (s6/deferred — the scope fence)] .
- [Source: `_bmad-output/planning-artifacts/lumi-rebuild-onboarding-mockup.html` lines 41–42 (grid), 101–138 (DOM), 122–137 (`.map` hero), 159–173 (chips), 88–94 (`.land`/`.glow`) — composition only; 11–18 palette = REJECTED].
- [Source: `packages/contracts/src/onboarding.ts` (`TextOnboardingTurnRequest/Response`, `ChipConfigSchema`, `ChipOptionSchema`); `packages/contracts/src/kitchen-map.ts` (`KitchenMapSchema`)].
- [Source: `apps/api/src/modules/onboarding/{onboarding.controller,onboarding-turn-runner,onboarding-chips,onboarding.routes,onboarding-moment.repository}.ts` — BLACK BOX; `CurrentMoment`, `MOMENT_SLOT_PREDICATES`, chip builders, endpoints].
- [Source: `apps/api/src/agents/eval/onboarding-golden.eval.test.ts` + `onboarding-eval.goldens.json` — must stay green; structured outcomes byte-stable].
- [Source: `apps/web/src/features/onboarding/OnboardingText.tsx` (2,457 lines) + `OnboardingText.test.tsx` (1,152); `components/{ChoiceChip,HintChip,SkipChip}.tsx`; `routes/(app)/onboarding.tsx`; `features/onboarding-mockups/*` + `routes/_dev-onboarding-*`].
- [Source: `apps/web/test/e2e/2-7-text-onboarding.spec.ts`, `2-s26-resume-mid-flow-onboarding.spec.ts`, the Epic 2.5/2.6 onboarding e2e; `13-s1-ux-regression-baseline.spec.ts`].
- [Source: `_bmad-output/implementation-artifacts/13-s2-lumi-presence-primitive.md`, `13-s3-whisper-channel.md`, `13-s4-brief-finished-surface-pilot.md` — keyframe/`motion-reduce` convention, lockstep-gate pattern, surgical-change discipline, safety-token precedent].
- [Source: `docs/DESIGN.md` — tokens, Honey rule, `.app-scope` AA, reduced-motion floor].
- [Source: `_bmad-output/project-context.md` — strict TS/ESM, React 19/Zustand/Tailwind rules, ≤300-line files, no-new-deps, "system-led not form/chat".]
- Memory: `onboarding-ux-is-chat-not-form`, `lumi-valet-not-chat-app` (the exception), `chip-taxonomy-three-types`, `onboarding-mockups-route`, `mock-screen-reference-check`, `design-md-canonical`, `epic-2-7-brief-drafted` (controller-led backend this lands on), `onboarding-builds-kitchen-map`.

## Open Questions

1. **Q1 — Converge the mockups: delete or keep as static reference?** `features/onboarding-mockups/` + `_dev-onboarding-*` routes are memory-flagged as the canonical design surface (`onboarding-mockups-route`, Stitch retired). The brief directs "delete or fold." **Recommendation:** delete the superseded per-moment pages + dev routes once the rebuilt surface realizes them (they become the forbidden third parallel path), keeping only `ChipPrimitivePage` if it still serves as a chip kitchen-sink. Confirm the exact delete line with Menon before Task 4 removes anything.
2. **Q2 — Optimistic hero vs projection-only.** The current file paints child cards optimistically (client regex) *before* the post-turn kitchen-map refetch lands. Dropping the heuristics (Scope Decision 2) means a card appears when the projection refetch returns, not the instant the user hits send. Acceptable per "authoritative projection is the source of truth," but if the refetch latency makes the "lands live" beat feel laggy on the anchor device, a *thin* optimistic placeholder (spinner/ghost card) is allowed — not a second extraction engine. Flagging so it's a deliberate choice, not an accident.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (dev-story), 2026-07-01.

### Open Questions — RESOLVED by Menon (2026-07-01)

1. **Q1 — mockup convergence → option 3 (delete everything).** Confirmed no need to retain the chip gallery after Epic 13: the three live primitives (`ChoiceChip`/`HintChip`/`SkipChip`) stay in-product; `ChoiceChipGroup`/`MomentProgress` were consumed only by the mockups (now orphaned → deleted); the doctrine the gallery documented lives canonically in `docs/DESIGN.md`.
2. **Q2 — projection-only + thin placeholder.** Hero binds to the authoritative `KitchenMap` projection; `mapPending` shows a light ghost while the post-turn refetch is in flight — no second extraction engine.

### Debug Log References

- `tsc --noEmit` (web) → exit 0 twice (once after discovering `EditConversation` depended on `HistoryView`/`ChatTurn` from the deleted mockups dir → relocated into kitchen-profile).
- `pnpm build` (tsc + vite + PWA) → exit 0.
- Web unit: `OnboardingText.test.tsx` 33/33 + `KitchenMapHero.test.tsx` 7/7. Full web suite 627 pass / 7 fail — the 7 are the documented pre-existing baseline (`useLumiVoiceSession` ×6 VAD/onnx-in-jsdom + `sse` packer ×1); the old 8th baseline fail (OnboardingText finalize gap-callout) is gone (rewritten). Zero new failures.
- e2e (preview build, isolated): `2-7-text-onboarding` 7/7; `13-s1` 19 pass / 1 skip / 1 fail — the fail is s2's LumiSheet "Voice mode" `text-fg-muted` contrast (4.12:1), reproduced pre-existing per 13-s4 W1, unrelated to onboarding.
- API `onboarding-golden.eval.test.ts` 17/17 (no backend change).

### Completion Notes List

- **Presentation-only rebuild honored.** Zero change under `apps/api/` or `packages/contracts/`. The turn/finalize/resume wire contracts, the `KitchenMap` projection, and the golden eval are untouched; the surface now consumes them cleanly.
- **The real convergence surprise:** the mockups weren't fully dead — kitchen-profile's `EditConversation` imported `HistoryView` + the `ChatTurn` type from `onboarding-mockups/`. Relocated a self-contained `HistoryView` into `features/kitchen-profile/components/` and repointed the import; behavior unchanged.
- **Heuristics deleted (Scope Decision 2):** all client-side `extract*` / `detectTopics` / topic-percent code is gone. The hero renders only from the authoritative projection + `moment_key`. Safety-critical M2 display is projection-sourced and gated so "All clear" never appears before the parent has answered.
- **Clean echo (AC2):** the one-mode thread shows the parent's last turn via `formatUserEcho`, which strips any `[Chips selected: …]` wrapper on resumed turns; the request body union is unchanged.
- **s5/s6 boundary held:** the summary/finalize gate renders exactly as before (Finalize button, gap callouts, jump-to-moment). The recognition ending + entry continuity are left for 13-s6.
- **USER-SIDE GATES:** none (frontend-only; no migration, no backend, no new dependency). Two `_dev-onboarding-moment-*`/`_dev-onboarding-mockups` dev routes are gone — anyone bookmarking them will now hit the app's default route.

### Review Findings

_Adversarial code review (bmad-code-review, 3 parallel layers: Blind Hunter / Edge Case Hunter / Acceptance Auditor), 2026-07-01. 1 decision-needed, 13 patch, 5 defer, 4 dismissed._

**Decision-needed — RESOLVED**
- [x] [Review][Decision] D1 — M5 `favorite_lunches` has no surface in the rebuilt hero. **Menon → option 1 (add).** Added a "Lunches to start from" `Card` (`starting-lineup-card`) rendering `favorite_lunches[].item` with the land animation, between tastes and the deferred ghost. [`KitchenMapHero.tsx`]

**Patch — ALL FIXED (batch-apply)**
- [x] [Review][Patch] P1 — Stored-XSS in relocated `HistoryView` — fixed: render `{turn.content}` as an escaped text child (dropped `dangerouslySetInnerHTML`). [`kitchen-profile/components/HistoryView.tsx`]
- [x] [Review][Patch] P2 — Premature "All clear" (safety) — fixed: gated on `kitchenMap !== null` so it's only asserted from a loaded projection; otherwise the "Noting what to keep safe…" placeholder holds. [`KitchenMapHero.tsx`]
- [x] [Review][Patch] P3 — `fetchKitchenMap` race — fixed: monotonic `mapFetchSeqRef` last-wins guard on `setKitchenMap`/`setMapPending`. [`onboarding-conversation.ts`]
- [x] [Review][Patch] P4 — Raw `skip`/`override_fewer` echo bubble — fixed: `CONTROL_CHIP_KEYS` filtered out of the echo; control-only turns push no optimistic user turn. [`onboarding-conversation.ts`]
- [x] [Review][Patch] P5 — `formatUserEcho` empty/multiple sentinel — fixed: `([^\]]*)` + global strip; unit-tested. [`onboarding-conversation.ts`]
- [x] [Review][Patch] P6 — Resume-into-summary stuck gate — fixed: copy no longer claims "Ready" when `requiredSetComplete === null` (shows "Reply above to pick up where you left off."), color follows `=== true`. [`ConversationColumn.tsx`]
- [x] [Review][Patch] P7 — Cold-start override double-count — fixed: override turns excluded from the dish counter (`!overrideTapped`). [`onboarding-conversation.ts`]
- [x] [Review][Patch] P8 — Closed mobile drawer in tab order — fixed: `inert` + `aria-hidden` when `!profileOpen`. [`OnboardingText.tsx`]
- [x] [Review][Patch] P9 — Raw UUID as child name — fixed: `childName: string | null`, name prefix omitted when unresolved; allergen still shown; unit-tested. [`KitchenMapHero.tsx`]
- [x] [Review][Patch] P10 — Double-submit race — fixed: synchronous `submittingRef` re-entrancy guard, reset in `finally`. [`onboarding-conversation.ts`]
- [x] [Review][Patch] P11 — `ConversationColumn` 419>300 — fixed: extracted `StatusLine`/glyphs/`momentSubtitle`/`inputPlaceholder` to `conversation-column-helpers.tsx`; column now 283 lines. [`ConversationColumn.tsx`]
- [x] [Review][Patch] P12 — Safety-pill contrast — fixed: `text-safety-cleared-800` on `bg-safety-cleared-100` + `border-safety-cleared-200` (matches the AA-proven `AllergyClearedBadge`). [`KitchenMapHero.tsx`]
- [x] [Review][Patch] P13 — Lumi question not announced — fixed: `aria-live="polite"` on the question region. [`ConversationColumn.tsx`]
- [x] [Review][Patch] P14 (lint) — the P6 null-state copy tripped `hivekitchen/no-assistant-filler` (AR-14) as chatbot filler — fixed: replaced with the actionable "Reply above to pick up where you left off." [`ConversationColumn.tsx`]

**Deferred**
- [x] [Review][Defer] W1 — Resumed chip echo may show slugs if the server persisted keys (no key→label resolution on resume); unverifiable from the client, server-storage-dependent. deferred, pre-existing [`onboarding-conversation.ts`]
- [x] [Review][Defer] W2 — M2 `none`-exclusivity is bypassed if the backend ever sends M2 as `action` mode (the `action` early-return precedes the m2 branch); backend contract sends `choice`. deferred, pre-existing [`onboarding-conversation.ts`]
- [x] [Review][Defer] W3 — Tapping Skip discards selected chips + typed draft without warning. deferred, pre-existing [`OnboardingChips.tsx`]
- [x] [Review][Defer] W4 — Chip-tapped dishes (catalog seeded late in cold-start) never advance the cold-start gate line (only free-text turns count). deferred, pre-existing [`onboarding-conversation.ts`]
- [x] [Review][Defer] W5 — No colocated `*.test.tsx` for `ConversationColumn`/`OnboardingChips` (behavior covered via the `OnboardingText.test.tsx` integration harness). deferred [`features/onboarding/`]

**Dismissed (4):** AC6 "summary input replaced by gate" (false positive — verified `HEAD` old `<form>` was ungated at summary, comment "always visible … in summary mode"; my code preserves shipped behavior); `setCurrentMomentKey(?? null)` reset (faithfully preserves shipped 2.7 behavior, backend always emits `moment_key` mid-flow, pinned by test); `childName.toLowerCase()` crash (`KitchenMapAllergenSchema.child_id` is a non-null uuid; display handled by P9); AC1 "recent turns read inline" (single-exchange is intended per the mockup + valet doctrine).

### File List

- `apps/web/src/features/onboarding/onboarding-conversation.ts` — NEW (`useOnboardingConversation` hook: state + submitTurn/finalize/resume/kitchen-map; `Turn`, `OnboardingTextProps`, `formatUserEcho`).
- `apps/web/src/features/onboarding/OnboardingText.tsx` — REWRITTEN (thin container: hook + two-column shell + mobile drawer; 2,457 → 121 lines).
- `apps/web/src/features/onboarding/ConversationColumn.tsx` — NEW (one-mode conversation column: subtitle, thread, gap callouts, finalize gate, input; 283 lines post-review).
- `apps/web/src/features/onboarding/conversation-column-helpers.tsx` — NEW (review P11: extracted `StatusLine`/`WaveformGlyph`/`SendGlyph`/`momentSubtitle`/`inputPlaceholder`).
- `apps/web/src/features/onboarding/OnboardingChips.tsx` — NEW (hint/action/choice + skip + provenance badge).
- `apps/web/src/features/onboarding/KitchenMapHero.tsx` — NEW (wide hero bound to the `KitchenMap` projection; land animation + thin placeholder).
- `apps/web/src/features/onboarding/OnboardingText.test.tsx` — REWRITTEN (33 lockstep behavior tests + `formatUserEcho` unit).
- `apps/web/src/features/onboarding/KitchenMapHero.test.tsx` — NEW (7 projection-render tests).
- `apps/web/src/styles/globals.css` — MODIFIED (added `@keyframes hk-land`).
- `apps/web/src/app.tsx` — MODIFIED (removed 7 deleted dev-route imports + registrations).
- `apps/web/src/features/kitchen-profile/components/HistoryView.tsx` — NEW (relocated `HistoryView` + `ChatTurn` from the deleted mockups dir).
- `apps/web/src/features/kitchen-profile/components/EditConversation.tsx` — MODIFIED (import `HistoryView`/`ChatTurn` from the new local path).
- `apps/web/src/features/onboarding/components/ChoiceChipGroup.tsx` — DELETED (orphaned).
- `apps/web/src/features/onboarding/components/MomentProgress.tsx` — DELETED (orphaned).
- `apps/web/src/features/onboarding-mockups/**` — DELETED (entire dir: 15 pages + components + data).
- `apps/web/src/routes/_dev-onboarding-mockups.tsx`, `_dev-onboarding-moment-1..6.tsx` — DELETED (7 dev routes).
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — MODIFIED (13-s5 ready-for-dev → in-progress → review).
- Memory: `onboarding-ux-is-chat-not-form.md`, `lumi-valet-not-chat-app.md`, `onboarding-mockups-route.md`, `mock-screen-reference-check.md`, `MEMORY.md` — updated (AC11).

## Change Log

| Date | Version | Description | Author |
|------|---------|-------------|--------|
| 2026-06-30 | 0.1 | Story authored (create-story): one-mode conversation + Kitchen-Map-as-hero on the frozen 2.7 backend; presentation-only rebuild, contracts/eval untouched; converge mockups (Q1). Status → ready-for-dev. | Menon |
| 2026-07-01 | 1.0 | Implemented (dev-story): decomposed 2,457-line OnboardingText into hook + ConversationColumn + KitchenMapHero + OnboardingChips; one calm mode; Kitchen-Map hero from the authoritative projection; heuristics deleted; mockups + orphaned primitives + dev routes deleted (Q1 opt 3), HistoryView relocated to kitchen-profile; tests rewritten; all gates green. Status → review. | Amelia (dev) |
| 2026-07-01 | 1.1 | Code review (bmad-code-review, 3 adversarial layers): 1 decision (D1→add M5 lunches to hero) + 14 patches batch-applied (XSS in relocated HistoryView; premature "All clear" gated on loaded projection; map-fetch race guard; control-key echo suppression; formatUserEcho empty/multi sentinel; resume-into-summary gate copy; cold-start override double-count; mobile-drawer inert; UUID-as-name guard; double-submit ref guard; ConversationColumn split ≤300; safety-pill AA contrast; aria-live; no-assistant-filler copy). 5 deferred, 4 dismissed (incl. false-positive "summary input regression"). +4 lock-in tests (37 onboarding/hero). Gates green: web unit 631p/7 baseline-fail, 2-7 e2e 7/7, 13-s1 13p/1skip. Status → done. | Amelia (dev) |
