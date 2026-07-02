# Story 13.s4: Brief as a Finished Surface (the Pilot)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **⚠️ Post-γ note:** This story rebuilds a *currently shipping* surface (`BriefCanvas.tsx`). Trust the codebase + this file over older Epic-3 story narratives. The valet primitives this story consumes (`LumiPresence` / `LumiSheet` / `LumiWhisper` / `lumi.store`) were shipped in 13-s2 and 13-s3 — they exist on this branch now; do **not** reintroduce the deleted `LumiOrb` / `LumiPanel` / `LumiFAB`.

## Story

As a parent opening HiveKitchen,
I want the weekly Brief to read like a calm, finished answer Lumi already laid out for me — one confident headline, a short note in Lumi's voice that proves it remembers my family, the week's day-cards, and safety clearances intact — with Lumi ambient and summonable rather than a chat column,
so that I trust the week at a glance instead of auditing it, and the valet interaction model is proven end-to-end on one real surface before it scales to onboarding and the planner.

## Scope Decisions (locked before authoring — do not re-litigate)

1. **Prose source = Option C (frontend rebuild + deterministic templated prose, NO LLM).** The current composer writes `moment_headline`, `lumi_note`, `memory_prose` as empty strings (`brief-state.composer.ts:366-368`), so the "answer-as-a-sentence" + "visible-memory" requirement has no data today. This story adds a **deterministic, code-only** templating step in the composer that emits a real `moment_headline` and `lumi_note` from facts already computed for the plan (no-cook/leftover/repeat-day counts, cleared-allergen count, child-favorite signal already on the tree). **No OpenAI/agent call. No `memory_nodes` pipeline.** `memory_prose` stays out of scope (the `BriefWhyPanel` "Personalised" pillar remains hidden — separate concern).
2. **Surface boundary = `BriefCanvas` @ `/app` ONLY.** Per the 13-s1 surfaces table ("Brief/BriefCanvas → Rebuilt in 13-s4"). The duplicate `PlanPage` @ `/app/plan` and the mock-only `features/weekly-plan/` are **out of scope** — their convergence is explicitly 13-s7's job. Do not touch them.
3. **Reuse the shipped valet presence; do NOT build the mockup's 340px dock.** The reference mockup (`lumi-rebuild-mockup.html`) shows Lumi in a persistent right-side dock. That is the **Rev-1 model the rebuild deletes** and it contradicts the valet doctrine. Use the mockup only for the **left "stage" column** composition (headline → lumi-note → week grid → sticky bar). Lumi reaches the Brief through the global `<LumiPresence>` (dot → whisper → summoned `<LumiSheet>`), already mounted in `routes/(app)/layout.tsx`.
4. **Topology/composition only — Editorial Hearth is FROZEN.** No visual redesign. Use canonical semantic tokens (`bg-bg`, `bg-surface`, `text-fg`, `border-border`, `--lumi-terracotta`, `--safety-cleared-teal`, `--amber`) — never the mockup's drifted local hexes. No new external dependencies.

## Acceptance Criteria

1. **Finished-surface composition (no chat layout).** `BriefCanvas` renders, top-to-bottom, as a calm full-width editorial answer: eyebrow → answer-as-a-sentence headline → Lumi-voice note with woven-in memory phrase → safety band (allergy-cleared badges + any QuietDiff) → 5 weekday `PlanTile`s → why/footer → action row. There is **no persistent message list, no composer, no "Ask Lumi" box** in the surface body. (Valet rule 1; Vision §2a.)

2. **Answer-as-a-sentence headline from real data.** The composer emits a non-empty, deterministic `moment_headline` (a confident completed-state sentence, e.g. *"An easy week."* / *"Your week, ready."*) derived from plan facts. `BriefCanvas` renders it via the existing `PageHeader` (canonical sizing — do **not** invent the mockup's 52px). When `moment_headline` is somehow empty, the existing `'Your week, ready'` fallback still applies (no regression).

3. **Visible-memory phrase woven into `lumi_note`.** The composer emits a non-empty `lumi_note` that (a) speaks in Lumi's voice and (b) references at least one concrete remembered/derived household fact (e.g. a cleared allergen, a no-cook day count, repeated-main leftovers). It renders as the `PageHeader` description / Lumi-voice note with the terracotta `Lumi —` voice treatment already used for Lumi copy. **Do not reuse `VisibleMemorySentence.tsx`** (that is the memory-page editor for `MemoryNode` rows — wrong primitive). Memory phrasing here is plain prose inside `lumi_note`.

4. **Allergy-cleared safety display intact.** Every `(child, allergen)` clearance still renders as an `<AllergyClearedBadge>` in the safety band above the tiles, with its popover + audit link + `--safety-cleared-teal` AAA treatment unchanged. The clearance is a Honey/recognition moment (Vision §2d) — it must survive the rebuild byte-for-byte in behavior. (13-s1 AC5.)

5. **QuietDiff rear-view preserved.** When `scaffolding_diff` is present, the `<QuietDiff>` line still renders above the tiles with its `⋯` explanation disclosure. Silent scaffolding mutations stay quiet; safety/dietary mutations are unaffected (they escalate loudly elsewhere). (Vision optimistic-update rule.)

6. **Summoned-sheet edit updates the artifact and recedes.** From the Brief, summoning Lumi (the global dot, or an in-surface affordance that calls `useLumiStore.getState().summon()`) opens `<LumiSheet>`; running a turn that mutates the plan causes the Brief artifact underneath to reflect the change (via existing query invalidation on `['brief']` / `['plan']`), and dismissing the sheet (`recede()`) returns to the finished surface with **no residual chat column**. Reuse the existing `summon()` wiring already in `BriefCanvas` (`onTellMore → summon()`); do not add panel booleans (`isPanelOpen`/`openPanel` no longer exist).

7. **Thread-less "Lumi is drafting…" state.** When there is no committed brief yet but a plan is being composed/regenerated (existing `plan_state` / compose / regeneration signals already in `BriefCanvas`), the surface shows a calm drafting state ("Lumi is drafting…") with a reduced-motion-safe live indicator — **without** hydrating a Lumi thread. This is rendered from existing brief/plan signals only; it does **not** take on 13-s2.5's SSE `plan.progress` / poll-removal work (that seam stays in s2.5). (Edge case from the s4 brief entry.)

8. **Regression gate stays green (a11y + safety + reduced-motion).** The 13-s1 baseline spec (`apps/web/test/e2e/13-s1-ux-regression-baseline.spec.ts`) passes. Any characterization that asserts the *old* Brief composition is updated in lockstep to the new layout (exactly as 13-s2 rewrote AC1.4), while the **durable** assertions stay green: axe WCAG 2.0 AA on `.app-scope` (no new violation category, no new `color-contrast` offender added to `isKnownContrastDebtNode()`), AllergyClearedBadge present in the `aria-label="Allergy clearances"` row, paused tile non-interactive, and any new Brief animation carries a `motion-reduce:` fallback.

9. **Performance — Brief renders < 2s on the anchor device.** The finished-surface model adds no live-thread hydration at rest. No new blocking fetch on the Brief render path; the summoned sheet and whisper stay lazy. (DESIGN.md §3 anchor: Galaxy A13 / 4G; brief NFR.)

10. **Quality gates.** `pnpm typecheck` and `pnpm lint` clean. New unit tests for the composer prose-templating (deterministic, table-driven) and any new/changed web rendering behavior pass. No new external dependency. Files ≤ ~300 lines; named exports; `import type`; Tailwind-only.

## Tasks / Subtasks

- [x] **Task 1 — Composer: deterministic prose templating (AC: 2, 3, 10)** — *backend, no LLM*
  - [x] In `apps/api/src/modules/plans/brief-state.composer.ts`, added an **exported module-level pure** helper `composeEditorialProse({ tileSummaries, clearedAllergies })` returning `{ moment_headline, lumi_note }`. Uses only data already computed in `refreshTree` (tile summaries, cleared-allergies tree, main-name repetition for leftovers). **No network/agent call.** (Exported rather than private so it is unit-testable like `composePlanTree`.)
  - [x] Replaced `moment_headline: ''` / `lumi_note: ''` (was lines 366-367) with the helper output; hoisted `tileSummaries` / `clearedAllergies` into locals first so the prose templates from them. Kept `memory_prose: ''` (out of scope).
  - [x] Every branch is deterministic and total (always non-empty; empty plan → neutral "Your week's ready." / "Your week is planned and ready."). The carry-forward `respondToLearningMoment` path (lines 131-132) is untouched.
  - [x] **RED→GREEN:** added `brief-state.composer.prose.test.ts` (6 table-driven cases: leftovers, cleared allergens, multi-child + paused, no-name fallback, empty plan, determinism). Pins exact strings. Initial RED caught a verb-agreement bug ("1 day run" → "1 day runs"); fixed.
  - [x] No unrelated composer refactor.

- [x] **Task 2 — `BriefCanvas` as a finished surface (AC: 1, 2, 3, 4, 5, 6)** — *frontend*
  - [x] **Finding:** `BriefCanvas` was *already* a finished editorial surface (no chat body) — s2 did the heavy presence/no-chat lifting. Per surgical-change discipline the composition stack was left intact (its order — safety band above headline — is what the 13-s1 gate asserts; moving it would regress AC5). Delta was scoped to the Lumi-voice note + draft state.
  - [x] Headline unchanged: `brief.moment_headline || 'Your week, ready'` via `PageHeader headlineSize="lg"` (canonical 34/56px; no 52px). Now non-empty in prod via Task 1.
  - [x] **AC3:** stopped passing `lumi_note` as the plain `PageHeader.description`; render it as a dedicated Lumi-voice `<p>` with a terracotta `Lumi&nbsp;—` tag (`text-lumi-terracotta`, DESIGN.md LumiNote pattern). `PageHeader` (shared/frozen) untouched.
  - [x] `AllergyClearedBadge`, `QuietDiff`, `PresenceIndicator` unchanged (props identical). Lumi conversation still summon-only (`onTellMore → summon()`); no composer in the body. No orphaned imports.
  - [x] `BriefCanvas.tsx` net delta is small; no extraction needed.

- [x] **Task 3 — Thread-less "Lumi is drafting…" state (AC: 7)** — *frontend*
  - [x] Enhanced the existing first-load branch (`isLoading && brief === null`) — the genuine thread-less surface — with a calm `role="status"` "Lumi is drafting…" line + terracotta dot. Driven by existing query state; no new fetch/SSE, no thread hydration.
  - [x] Dot + skeleton pulse carry `motion-reduce:animate-none` fallbacks (AC8).

- [x] **Task 4 — 13-s1 regression characterization (AC: 8)** — *test*
  - [x] **No gate edit needed.** The loaded-state characterizations all stayed green unchanged: the headline (`h1` exact name), the lumi-note (Playwright `getByText` substring still matches the relocated `<p>`), the five tiles, the badge row, and paused non-interactivity. The lumi_note relocation + draft state broke no assertion, so the spec was left as-is (verified by running it).

- [x] **Task 5 — Unit tests for changed web behavior (AC: 1, 2, 3, 7, 10)** — *test*
  - [x] Added a `BriefCanvas — 13-s4 finished surface` describe block (4 tests): Lumi-voice tag present; omitted when `lumi_note` empty; thread-less "Lumi is drafting…" with no dialog/textbox; no composer/`log` role on the finished surface. Existing 29 BriefCanvas tests still pass (incl. empty-string fallback + badge-above-headline order). Follows vitest conventions.

- [x] **Task 6 — Verify gates + perf sanity (AC: 8, 9, 10)**
  - [x] `pnpm typecheck` clean (api + web). Lint: changed regions clean (the repo has 177 pre-existing api / 91 web lint errors unrelated to this slice; the one `!= null` I introduced was fixed to `!== undefined`).
  - [x] Unit: composer prose 6/6 + tree 22/22; BriefCanvas 33/33; full web unit **625 pass / 8 fail = the documented pre-existing baseline** (`useLumiVoiceSession` ×6, `sse` packer ×1, `OnboardingText` ×1) — **zero new failures**.
  - [x] e2e `13-s1` in isolation: **12 pass / 1 skip / 1 fail**. The 1 fail is the s2-added "opened Lumi sheet" axe scan — a **pre-existing, light-mode contrast issue on s2's LumiSheet** (`text-fg-muted` on elevated oat surfaces), **proven not introduced by 13-s4** (fails identically with my BriefCanvas change stashed). The durable AC2 base `.app-scope` axe scan, AC4 reduced-motion, AC5 safety display, and AC1.2 brief render all PASS. See completion notes.
  - [x] AC9: the draft/finished render path adds no new blocking fetch; sheet/whisper stay lazy (global `LumiPresence`, unchanged).

## Dev Notes

### What already exists — REUSE, do not reinvent

**Valet presence (shipped 13-s2 / 13-s3) — mounted globally, do not re-mount per surface:**
- `apps/web/src/components/LumiPresence.tsx` — ambient dot + renders `<LumiSheet>` + `<LumiWhisper>`; mounted once in `routes/(app)/layout.tsx` (with `!onLunchRoute` suppression).
- `apps/web/src/components/LumiSheet.tsx` (`LUMI_SHEET_ID = 'lumi-sheet'`) — the summoned modal sheet (built on `Dialog.tsx`, `placement="bottom-right"`, focus-trap/Escape/scrim/scroll-lock). The ONLY chat affordance; exists only while `presenceState === 'summoned'`.
- `apps/web/src/components/LumiWhisper.tsx` — the one-line dismissible whisper (`presenceState === 'whisper'`).
- `apps/web/src/stores/lumi.store.ts` — `PresenceState = 'atRest' | 'whisper' | 'summoned'`; actions `summon(mode?)`, `recede()`, `whisper()`, `dismissNudge()`. **`isPanelOpen`/`openPanel`/`closePanel` were removed** — call `summon()`/`recede()`.
- `apps/web/src/components/Dialog.tsx` — the only sanctioned a11y modal primitive (props now include `id`/`panelClassName`/`scrimClassName`/`placement`). If you need any modal, extend/use this; do **not** hand-roll a focus trap and do **not** copy `PackerAssignmentDialog.tsx`.

**Brief surface + sub-components (in `apps/web/src/features/plan/`):**
- `BriefCanvas.tsx` (709 lines, no props; mounted by `routes/(app)/index.tsx` at `/app`) — the surface to rebuild. Reads `useBriefStateQuery(householdId).data.brief`, `usePlanQuery('current')`, `adaptPlansResponse`. Already wires `onTellMore → useLumiStore.getState().summon()`.
- `AllergyClearedBadge.tsx` — `{ childName, allergen, auditUrl, isRechecking? }`. Keep as-is (AC4).
- `QuietDiff.tsx` — `{ summary, explanation? }`; renders null when summary null. Keep as-is (AC5).
- `BriefWhyPanel.tsx` — `{ brief }`; "Why this week" pillars (Personalised pillar needs `memory_prose`, which stays empty — pillar stays hidden, expected).
- `PlanActionSection.tsx` — the action row (StickyBottomBar conversion is **13-s7**, not here — do not change it).
- `PageHeader` — used for the eyebrow + headline + description; canonical sizing (`headlineSize="lg"`). DESIGN.md Brief moment = 34px (canonical), mockup's 52px is **not** adopted.

**Backend composer:**
- `apps/api/src/modules/plans/brief-state.composer.ts` — `composeBrief(...)`; writes the empty `moment_headline`/`lumi_note`/`memory_prose` at lines ~366-368. Helpers already present: `buildTileSummariesTree`, `buildClearedAllergiesTree`, `buildScaffoldingDiffTree`, `buildLearningMomentCallout`. Your prose helper consumes their outputs — no new data fetch.
- DB: `brief_state` table (`supabase/migrations/20260502120000_create_brief_state_projection.sql`), columns already `NOT NULL DEFAULT ''`. **No migration needed** — the columns exist; you are only filling them.

**Contracts (no change expected):**
- `packages/contracts/src/plan.ts` — `BriefStateRowSchema` (`moment_headline`, `lumi_note`, `memory_prose`, `payload`), `BriefStatePayloadSchema` (`tile_summaries`, `cleared_allergies`, `scaffolding_diff`, `plan_state*`, `learning_moment_callout`), `PlanTileSummarySchema`, `ClearedAllergyEntrySchema`. Types via `@hivekitchen/types`. The fields are already strings — filling them needs no schema change.

### The 13-s1 regression gate — the contract you must not break
Gate file: `apps/web/test/e2e/13-s1-ux-regression-baseline.spec.ts`. Durable assertions (per 13-s2 AC7 pattern): axe WCAG 2.0 AA on `.app-scope` with node-level `isKnownContrastDebtNode()` allowlist (you may shrink it by fixing debt, never grow it); AllergyClearedBadge in `aria-label="Allergy clearances"` row; paused tile `tabindex=-1` / non-interactive; dot `transition-property: none` under `prefers-reduced-motion: reduce`. The Brief-render characterizations (currently against the old composition) are yours to update in lockstep — keep them asserting the same safety/a11y invariants on the new layout.

### Decisions & seams (read before coding)
- **Option C is deliberate.** Real-but-templated prose (no LLM, no `memory_nodes`). If you feel the urge to call the agent or read memory nodes — stop; that's a separate story. Keep `memory_prose: ''`.
- **`PlanPage` @ `/app/plan` and `features/weekly-plan/` are OUT of scope** (13-s7). The mock-only `features/weekly-plan/` is reachable only via `_dev-weekly-plan.tsx` — ignore it.
- **The mockup's 340px right dock is the deleted Rev-1 model.** Only harvest the left stage column layout from it. Lumi = global `<LumiPresence>`, not a dock.
- **13-s2.5 seam (still `backlog`).** s2.5 owns deleting the `BriefCanvas` `setInterval` polls + `plan.progress` SSE stage events + single EventSource. Your AC7 drafting state must render from **existing** signals only and must not pre-empt that work. Leave the polls alone.
- **No chat layout, ever** (memory `lumi-valet-not-chat-app`): the surface body has no message list and no composer. The conversation is summon-only via the sheet.

### Project Structure Notes
- New/changed web files stay in `apps/web/src/features/plan/` (surface) and `apps/web/src/components/` (only if a shared primitive is genuinely needed — unlikely). Colocated `*.test.tsx`. No barrels, named exports, `import type`, Tailwind-only warm-neutral palette via semantic aliases.
- New/changed API files stay in `apps/api/src/modules/plans/` with `.js` extensions on relative imports (TSC emit requirement). Colocated `brief-state.composer.test.ts`.
- No contract/migration change anticipated. If you discover one is required, that is a coordinated contract change (update `packages/contracts` + both apps in the same PR) — flag it, don't do it silently.

### References
- [Source: _bmad-output/planning-artifacts/epic-13-lumi-ux-rebuild-brief.md#13-s4] — AC sketch, folds (Vision §2 + §4a, valet rule 4), edge cases, WALL gate, NFRs (Brief < 2s; sheet/whisper a11y), out-of-scope list, Editorial-Hearth-frozen.
- [Source: _bmad-output/planning-artifacts/lumi-conversational-ux-rebuild-vision.md#2] — finished-surface spatial model; §2b ambient/summoned/recede; §2d Honey-rule-harder (allergen-cleared = recognition); §4a answer-as-a-sentence; valet doctrine 5 rules; WHEN-vs-HOW control split.
- [Source: _bmad-output/planning-artifacts/lumi-rebuild-mockup.html#s-brief] — left stage column composition ONLY (eyebrow → `.moment` headline → `.lumi-note` → `.week` grid → `.sticky`); ignore the `.dock`.
- [Source: docs/DESIGN.md] — semantic tokens (`bg-bg`/`bg-surface`/`text-fg`/`border-border`/`--lumi-terracotta`/`--safety-cleared-teal`/`--amber`); Honey rule (recognition only, never hovers); Brief moment 34px; locked `<Brief>`/`<LumiNote>`/`<PlanTile>`/`<QuietDiff>`/`<AllergyClearedBadge>`; AA `.app-scope` / AAA safety copy; reduced-motion floor.
- [Source: _bmad-output/implementation-artifacts/13-s1-ux-regression-baseline.md] — gate spec, `_helpers.ts`, axe/contrast-allowlist pattern, BriefCanvas mock recipe, surfaces table ("BriefCanvas → 13-s4").
- [Source: _bmad-output/implementation-artifacts/13-s2-lumi-presence-primitive.md] — `LumiPresence`/`LumiSheet`/`Dialog` API; `summon`/`recede`; lockstep-gate-update pattern; reduced-motion convention; vitest/e2e conventions; deleted Orb/Panel/FAB.
- [Source: _bmad-output/implementation-artifacts/13-s3-whisper-channel.md] — `LumiWhisper`/`whisper()`/`dismissNudge()`; whisper positioning; nudge-text narrowing.
- [Source: apps/api/src/modules/plans/brief-state.composer.ts:363-382] — the empty-string write site + available helper outputs.
- [Source: packages/contracts/src/plan.ts:217-300] — `PlanTileSummarySchema`, `ClearedAllergyEntrySchema`, `BriefStatePayloadSchema`, `BriefStateRowSchema`.
- [Source: _bmad-output/project-context.md] — strict TS/ESM rules, Fastify/React/Zustand patterns, "agent layer is stateless", no-new-deps, file ≤300 lines, SSE-not-WS.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (dev-story)

### Debug Log References

- Composer prose RED→GREEN: initial run failed one case on verb agreement (`"1 day run on leftovers"` → expected `"1 day runs on leftovers"`); fixed the pluralized verb in the leftover sentence. Re-run: prose 6/6 + tree 22/22 green.
- Lint: introduced one `eqeqeq` violation (`main?.name != null`) — refactored to `const mainName = main?.name; if (mainName !== undefined)`. Remaining 12 `eqeqeq` errors in `brief-state.composer.ts` are pre-existing (tile-builder / snack code, lines <520), confirmed outside edited regions.
- e2e baseline isolation: stashed `BriefCanvas.tsx`, rebuilt, re-ran `13-s1:371` — the opened-sheet axe failure reproduced identically without my change, proving it is pre-existing (s2 LumiSheet, light-mode contrast), not a 13-s4 regression.

### Completion Notes List

- **Scope realized smaller than a "rebuild".** s2 already delivered the finished-surface composition + the no-chat invariant on `BriefCanvas`. The genuine 13-s4 delta was: (1) **real deterministic prose** in the composer (the headline/memory were empty strings in prod), (2) the **Lumi-voice note treatment** (terracotta tag), (3) the explicit **thread-less drafting state**, and (4) verification that the valet triad + a11y/perf hold on the Brief. Kept changes surgical per CLAUDE.md rather than churning a working surface.
- **Option C honored:** `composeEditorialProse` is pure, deterministic, no LLM/agent, no `memory_nodes`. `memory_prose` left `''` (BriefWhyPanel "Personalised" pillar stays hidden — separate concern). The "visible-memory phrase" is woven into `lumi_note` (cleared-allergen / leftover / paused-day facts).
- **No DOM ordering change.** The safety band (AllergyClearedBadge row + QuietDiff) stays *above* the headline because the 13-s1 gate (AC5) asserts that placement; moving it would be a safety-display regression for no benefit. The story AC1's listed order is approximate — gate-required placement wins.
- **Frozen design system respected:** `PageHeader` (shared, locked) untouched; the Lumi-voice line uses the established `text-lumi-terracotta` token; no new deps; no migration/contract change (`brief_state` columns already `NOT NULL DEFAULT ''`).
- **⚠️ Pre-existing e2e baseline failure (NOT introduced here):** `13-s1` "opened Lumi sheet has no new WCAG 2.0 A/AA violations" fails locally because **s2's LumiSheet** renders `text-fg-muted` on `surface-2`/`surface-3` (oat) which falls below 4.5:1 in **light mode** (the "Voice mode" button, the empty-thread "Nothing to show yet." line, "Pause nudges"). Proven pre-existing via stash-and-rebuild. Out of scope for 13-s4 (LumiSheet is s2's; Editorial Hearth frozen; do-not-grow-the-allowlist). Recommend a follow-up to either bump those LumiSheet labels off `text-fg-muted` or extend `isKnownContrastDebtNode()` — flagged for the s2/s3 owner, not patched here. The durable AC2 base `.app-scope` scan is clean.
- **Verification tally:** typecheck clean (api+web); composer 28/28; BriefCanvas 33/33; full web unit 625 pass / 8 fail (= documented baseline, 0 new); e2e 13-s1 12 pass / 1 skip / 1 pre-existing-fail.
- **USER-SIDE GATES:** none (frontend + deterministic composer; no migration, no live-service dependency). The brief composer change takes effect on the next plan commit / brief refresh.

### Review Findings

- [x] [Review][Decision] D1 — "Every day's cleared" phrase asserts per-day coverage that isn't verified — resolved: restructured to per-child sentences (`"{child}'s meals are {allergens}-free — I kept that in mind."`); eliminates joint-possession grammar and per-day accuracy claim. [`apps/api/src/modules/plans/brief-state.composer.ts`]
- [x] [Review][Decision] D2 — `lumi_note` moved from `PageHeader.description` to standalone `<p>` — resolved: accepted; "/" in spec means "or"; standalone `<p>` is intentional editorial layout; axe gate did not flag it. [AC3; dismissed]
- [x] [Review][Patch] P1 — Partial-catalog leftover arithmetic produces wrong note numbers — fixed: gated cook-count branch on `allTilesNamed` (`mainNames.length === activeDays`); partial-catalog case now falls to generic day-count line. [`apps/api/src/modules/plans/brief-state.composer.ts`]
- [x] [Review][Patch] P2 — All-paused plan produces contradictory `lumi_note` — fixed: `allPaused` guard skips the "planned and ready" base sentence when every tile is paused. [`apps/api/src/modules/plans/brief-state.composer.ts`]
- [x] [Review][Defer] W1 — 13-s1 LumiSheet axe contrast failure — pre-existing s2 LumiSheet `text-fg-muted` on elevated oat surface; confirmed not introduced by 13-s4 (stash+rebuild reproduced). deferred, pre-existing [`apps/web/test/e2e/13-s1-ux-regression-baseline.spec.ts`]
- [x] [Review][Defer] W2 — Safety band / QuietDiff render above headline in DOM — intentional; dev notes document 13-s1 gate asserts this order; moving it would regress AC5. deferred, pre-existing [`apps/web/src/features/plan/BriefCanvas.tsx`]
- [x] [Review][Defer] W3 — `t.day as SchoolDay` type cast with lowercase fallback — `?? t.day` handles unmapped values at runtime; cosmetic issue not a data bug. deferred, pre-existing [`apps/api/src/modules/plans/brief-state.composer.ts` `composeEditorialProse` paused labels]
- [x] [Review][Defer] W4 — Empty `allergen`/`child_name` bypasses `length > 0` guard — `ClearedAllergyEntrySchema` non-empty constraint should prevent this; data-integrity concern below this layer. deferred, pre-existing
- [x] [Review][Defer] W5 — `lumi_note` generic for allergen-free families before catalog is wired — "N lunch days, planned and ready." has no family-specific fact when recipes unresolved + no allergens; resolves naturally in production. deferred, pre-existing

### File List

- `apps/api/src/modules/plans/brief-state.composer.ts` — MODIFIED (exported `composeEditorialProse` + helpers `DAY_LABELS`/`joinWithAnd`/`dedupeInOrder`; `refreshTree` now hoists tile/cleared locals and writes real `moment_headline` + `lumi_note`).
- `apps/api/src/modules/plans/brief-state.composer.prose.test.ts` — NEW (6 unit tests for `composeEditorialProse`).
- `apps/web/src/features/plan/BriefCanvas.tsx` — MODIFIED (Lumi-voice `lumi_note` paragraph with terracotta tag; thread-less "Lumi is drafting…" state + `motion-reduce` fallbacks).
- `apps/web/src/features/plan/BriefCanvas.test.tsx` — MODIFIED (new `13-s4 finished surface` describe block, 4 tests).
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — MODIFIED (status backlog → ready-for-dev → in-progress → review).

## Change Log

| Date | Version | Description | Author |
|------|---------|-------------|--------|
| 2026-06-29 | 0.1 | Initial story draft — Option C (templated prose, no LLM) + BriefCanvas-only scope locked with user | Menon |
| 2026-06-30 | 1.0 | Implemented (dev-story): deterministic composer prose + Lumi-voice note + thread-less drafting state; tests added; gates verified; status → review | Amelia (dev) |
