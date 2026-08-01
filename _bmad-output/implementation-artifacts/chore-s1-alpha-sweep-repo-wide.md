# Chore S1: Finish the repo-wide dead-`/alpha` sweep

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **HiveKitchen frontend developer**,
I want **the remaining 70 dead Tailwind `/alpha` utilities replaced with declarations that actually render, each chosen by what the alpha was doing rather than by find-and-replace**,
so that **borders stop falling back to `currentColor`, tints stop vanishing, and — critically — the fix does not itself ship opaque overlays or new contrast failures the way the first sweep did**.

## Context & Why

- **Retro action item 6** (Epic 14 retrospective, 2026-07-31) and the parent deferred item **D-14S4-5**.
- The repo's semantic tokens are `var()`-backed hex, so `/alpha` on them generates **no CSS rule at all**. Tailwind's built-in palette (`black`, `stone-*`, `neutral-*`) *does* support alpha because those are channel-expressible.
- **70 dead utilities across 57 files** remain (verified 2026-08-01 against `dist/assets/index-Hg8w5IBB.css` with a two-way probe control). `features/onboarding` and `PlanTile`'s proposal pill are already done (`209324d`, `75d9fdd`, `8462270`).

**This slice exists because the first sweep was done wrong, and that failure is the whole design of this one.**

In `209324d` I replaced 42 dead classes with solid token steps and verified every replacement emitted CSS. The verification answered *"does this emit a rule?"* when the question was *"does this emit the **right** rule?"* Result, caught only by adversarial review:

- a video thumbnail **completely painted out** by a solid `bg-bg` over the `<img>`
- a hero photo **blanked across the copy area** by an opaque gradient mid-stop
- **three new AA contrast failures** (2.09:1, 2.90:1, 3.28:1) — in each case the dead class meant the text had previously sat on a *passing* background, so "fixing" the tint broke the text

The ACs below encode that lesson. A mechanical sweep of the remaining 70 would reproduce it at scale.

## Reconciliations against codebase reality (verified 2026-08-01)

1. **8 alpha utilities are ALIVE and must not be touched** — `bg-black/50`, `bg-black/60`, `bg-stone-900/40`, `bg-stone-900/50`, `bg-stone-900/60`, `border-neutral-400/20`, `border-neutral-400/30`, `shadow-black/50`. All use Tailwind's built-in palette. Verified present in the compiled bundle. Touching them is a regression, not a fix.
2. **`color-mix(in srgb, var(--token) N%, transparent)` works as a Tailwind arbitrary value.** Proven in `75d9fdd`: five such utilities compile to real rules (e.g. `.bg-\[color-mix\(in_srgb\,var\(--bg\)_30\%\,transparent\)\]`). Underscores become spaces. This is the correct mechanism for load-bearing alpha and it is already used in raw CSS in `globals.css`.
3. **`opacity-*` is a real utility**, unrelated to colour alpha, and is the right answer for "make this whole element look inert" (used for the disabled `ChoiceChip` in `75d9fdd`).
4. **Scales are theme-flipped.** `honey-amber-*` and `warm-neutral-*` invert between themes (`honey-amber-100` is `#4c1700` in dark). Choosing a tint step by light-mode intuition produces a dark-mode inversion.
5. **`warm-neutral` runs 50–900; there is no 950.** `colorScale()` emits ten steps. DESIGN.md §141 cited a 950 and was corrected in `43cae11`.
6. **The grep is the hazard, not just the classes.** During `209324d` three separate verification probes returned false answers because shell expansion ate the backslash before `grep` saw it — every class looked dead, including working ones. Any probe used here must be demonstrated to *fail* on a fabricated class before its output is trusted.

## The classification rule (the core of this slice)

Every dead class falls into exactly one bucket. **The bucket determines the fix — never substitute a solid step by default.**

| Bucket | What the alpha was doing | Correct fix |
|---|---|---|
| **A — Load-bearing** | Overlay, scrim, backdrop, or gradient stop. The element exists *to be see-through*. Signature: `absolute inset-0`, `fixed inset-0`, or a `from-/via-/to-` stop. | `color-mix(...)` at the original percentage. **A solid step here hides whatever is beneath it.** |
| **B — Contrast-bearing** | A faint tint sitting *behind text*. Making it real changes what the text sits on. | Choose a step, then **measure** the text/background pair in both themes. Must clear AA (AAA for safety copy). |
| **C — Decorative** | A tint or border with no content behind it and no text on it. | Solid token step, chosen with the theme-flip in mind. |
| **D — Whole-element dimming** | Everything about the element should read as inert/faded. | `opacity-*`. |

**Three known Bucket-A traps in the remaining set** — all three currently render transparent, and all three would be catastrophic as solids:

- `features/plan/PackerAssignmentDialog.tsx:74` — `fixed inset-0 … bg-fg/20`. A **modal backdrop**. Solid `bg-fg` would paint the entire viewport in foreground colour.
- `features/plan/PlanTile.tsx:527` — `absolute inset-0 … bg-bg/70`. A busy-state overlay **on top of tile content**.
- `features/login/components/LoginHero.tsx:11` — `via-bg/80` in a two-direction gradient over the login photo. Exactly the bug shipped in `OnboardingHero`.

## Acceptance Criteria

1. **Zero dead `/alpha` utilities remain** in `apps/web/src` and `packages/ui/src`, verified against a fresh build with a probe that is demonstrated to fail on a fabricated class. The 8 built-in-palette utilities in Reconciliation 1 are **still present and unmodified**.
2. **Every replacement is classified** (A/B/C/D) and the classification is defensible from the element's context. Bucket A uses `color-mix` at the original percentage — no Bucket-A class is replaced with a solid step.
3. **The three named Bucket-A traps are fixed as overlays**, and each is visually confirmed (screenshot or a rendered check) to still show what sits beneath it.
4. **Every Bucket-B replacement has a recorded contrast measurement** for both themes, computed from `packages/design-system/tokens/colors.css`. Nothing ships below AA; safety copy holds AAA. Record the figures in the Dev Record — the 14-s3b review showed that eyeballing a tint is exactly how 2.09:1 shipped.
5. **No new dead classes and no invented tokens.** Every utility introduced is proven present in `dist/assets/*.css`, with the negative control from Reconciliation 6.
6. **`packages/ui` changes stay behaviour-neutral.** `RailCard.tsx` (7), `TextField.tsx`, `StickyBottomBar.tsx`, `AppFooter.tsx` are locked primitives consumed across the app; their unit tests and the 13-s1 baseline must pass unedited.
7. **Debt absorbed:** closes **D-14S4-5** (the parent item) and **D-14S3B-CR4** (the AudioPanel waveform's five-step depth gradient, collapsed to two tones by the first sweep — a Bucket-A/C misclassification).
8. **Gates:** typecheck, lint, knip; full web unit suite; full E2E with `VITE_E2E=true`; `13-s1-ux-regression-baseline.spec.ts` **unedited**; **axe allowlist must not grow** — Bucket B is precisely where it would be tempting to grow it.

## Tasks / Subtasks

Split by area so each ships independently and stays near the <500-line PR guideline. Bucket-A work lands **first** in each area, since it is the only bucket that can hide content.

- [ ] **Task 1 — Classify all 70** (AC2): produce the A/B/C/D table before editing anything. This is the deliverable that prevents a repeat of `209324d`.
- [ ] **Task 2 — Bucket A first, repo-wide** (AC3): the three named traps plus any other overlay/gradient the classification surfaces.
- [ ] **Task 3 — `kitchen-profile`** (43 classes, 8 files — the largest cluster: `IdentityEditConversation` 11, `ChildProfileCard` 10, `EditConversation` 8, `EditChips` 8, `KitchenIdentityCard` 6, `SchoolsList` 5, plus 4 singles).
- [ ] **Task 4 — `heart-note` + `lunch-link` + `grocery-list`** (`StationeryCard` 7, `StatusPill` 6, `ScheduleDatePicker` 3, `LunchSummary` 3, `FeedbackBlock` 3, `HeartNoteCard` 2, and singles).
- [ ] **Task 5 — `packages/ui` + shared components** (AC6): `RailCard` 7, `TextField`, `StickyBottomBar`, `AppFooter`, `LumiPresence`, `AppHeader`, `DevTools`.
- [ ] **Task 6 — remaining routes + features**: `kitchen-inspiration`, `evening-checkin`, `day-detail`, `memory-dashboard`, auth routes, `_dev-day-detail-multi-child`.
- [ ] **Task 7 — Gates + ledger** (AC5, AC7, AC8): final zero-dead-class proof with negative control; close D-14S4-5 and D-14S3B-CR4.

## Dev Notes

- **`_dev-day-detail-multi-child.tsx` (4) is a dev-only mock route** — kept deliberately per the mock-screen doctrine. Sweep it for consistency but it carries no user-facing risk.
- **`PlanTile.test.tsx` (1)** contains a dead class in a test fixture/assertion — check whether an assertion is matching on a class string that never rendered.
- **Watch for the same-token-different-meaning trap:** `bg-surface/50` appears as both a translucent panel (Bucket A) and a faint hover tint (Bucket C) in different files. Classify per occurrence, not per class name.
- **`bg-fg-muted/10`, `bg-neutral-400/10`** — note `neutral-400` is built-in but `bg-neutral-400/10` came back dead; confirm against the bundle rather than assuming, since the palette is partially overridden by `tokenPresets`.
- Contrast helper: the 14-s3b review used a short Python script over `colors.css` splitting `:root` from the dark block and computing WCAG relative luminance. Reuse it rather than eyeballing.
- Read `_bmad-output/project-context.md` before implementing, and `docs/DESIGN.md` before any UI authoring.

### Project Structure Notes

- Touches many files but adds none. No contract, no migration, no API change.
- `packages/ui` edits must not change component APIs — class strings only.

### References

- [Source: `_bmad-output/implementation-artifacts/epic-14-retro-2026-07-31.md`#action-items] — action item 6
- [Source: `_bmad-output/implementation-artifacts/deferred-work.md`] — D-14S4-5, D-14S3B-CR4
- [Source: commit `209324d`] — the sweep done wrong, and what it broke
- [Source: commit `75d9fdd`] — the corrections, including the five proven `color-mix` utilities
- [Source: commit `43cae11`] — DESIGN.md §141 correction (the non-existent `warm-neutral-950`)

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

## Change Log

| Date | Change |
| --- | --- |
| 2026-08-01 | Story authored (create-story, claude-fable-5). Closes retro action item 6. Survey verified same-day against the compiled bundle with a two-way probe control: 70 dead across 57 files, 8 alive built-in-palette utilities that must not be touched. Built around the classification rule, because the first sweep's mechanical solid-step substitution shipped two invisible surfaces and three AA failures. |
