# Chore S1: Finish the repo-wide dead-`/alpha` sweep

Status: done

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

- [x] **Task 1 — Classify all 70** (AC2): produce the A/B/C/D table before editing anything. This is the deliverable that prevents a repeat of `209324d`.
- [x] **Task 2 — Bucket A first, repo-wide** (AC3): the three named traps plus any other overlay/gradient the classification surfaces.
- [x] **Task 3 — `kitchen-profile`** (43 classes, 8 files — the largest cluster: `IdentityEditConversation` 11, `ChildProfileCard` 10, `EditConversation` 8, `EditChips` 8, `KitchenIdentityCard` 6, `SchoolsList` 5, plus 4 singles).
- [x] **Task 4 — `heart-note` + `lunch-link` + `grocery-list`** (`StationeryCard` 7, `StatusPill` 6, `ScheduleDatePicker` 3, `LunchSummary` 3, `FeedbackBlock` 3, `HeartNoteCard` 2, and singles).
- [x] **Task 5 — `packages/ui` + shared components** (AC6): `RailCard` 7, `TextField`, `StickyBottomBar`, `AppFooter`, `LumiPresence`, `AppHeader`, `DevTools`.
- [x] **Task 6 — remaining routes + features**: `kitchen-inspiration`, `evening-checkin`, `day-detail`, `memory-dashboard`, auth routes, `_dev-day-detail-multi-child`.
- [x] **Task 7 — Gates + ledger** (AC5, AC7, AC8): final zero-dead-class proof with negative control; close D-14S4-5 and D-14S3B-CR4.

### Review Findings

<!-- bmad-code-review 2026-08-01 · 3 adversarial layers (Blind/Edge/Auditor) over fab9c5d (60 files, +237/−154) · 22 raw findings → 0 decisions + 6 patches + 0 deferred + 5 dismissed. Auditor independently recomputed 18 contrast figures — all reproduce to the third decimal; all 8 ACs verify. -->

- [x] [Review][Patch] **`focus:ring-honey` resolves to no token — focus ring paints Tailwind default blue** — `honey` is not a token key (only `honey-amber`/`honey-accent`), so `focus:ring-1` fires with the stock blue ring colour: an off-palette focus indicator on a line this sweep edited. Same non-existent-key family as the StatusPill `honey`/`honey-dark` bug the story itself fixed. Convention per the locked TextField primitive is `focus:ring-amber-warm`. [`heart-note/components/ScheduleDatePicker.tsx:26`] (blind+edge)
- [x] [Review][Patch] **Clear button: base equals hover — dead interaction** — `text-fg-muted/60 … hover:text-fg-muted` collapsed to `text-fg-muted … hover:text-fg-muted`. Restore the authored dim→full hierarchy as `text-fg-muted hover:text-fg` (both AA everywhere). [`heart-note/components/ScheduleDatePicker.tsx:32`] (blind+edge)
- [x] [Review][Patch] **Cancel-note link: same base==hover collapse** — `text-safety-red/70 … hover:text-safety-red` became identical base and hover. No darker red exists (D-CS1-1), so hover feedback moves to the underline: `hover:decoration-2`. [`routes/(app)/heart-note.tsx:299`] (blind+edge)
- [x] [Review][Patch] **WallCardPage comment mechanically corrupted into a falsehood** — the sweep substituted the class name *inside prose*, producing "`bg-honey-amber-300` did not: an alpha modifier … compiles to nothing" — false on both counts. The exact find-and-replace failure mode this story exists to prevent, surviving in a comment. Restore `bg-amber-warm/20`. [`day-detail/components/WallCardPage.tsx:165`] (blind+auditor)
- [x] [Review][Patch] **Neutral chip fills are invisible in dark theme** — `bg-warm-neutral-50` (#2a2724) on `--surface` (#262420) is a ~2-point delta with no border on the default-tier chips, so the restored fill renders in light only. Swap the borderless neutral chips to `bg-[color-mix(in_srgb,var(--fg-muted)_10%,transparent)]` — adaptive in both themes, `fg-muted` text measures 6.574/5.555 AA on surface and 7.501/6.292 on bg. [`IdentityEditConversation.tsx:270,333`, `KitchenIdentityCard.tsx:240`, `StartingLineCard.tsx:89`, `StatusPill.tsx:26`] (edge)
- [x] [Review][Patch] **Dev Record / ledger accuracy corrections (5 items, docs only)** — (1) "banners render exactly as today" is wrong for their *borders*: dead border = solid `currentColor` red, the restored 20–40% mix is visibly softer — fills unchanged, borders soften; (2) `household-settings` dev-reset hover is an undisclosed per-site judgment (`hover:bg-safety-red/5` → `hover:border-safety-red`), disclose it; (3) the deferred-work closure line "only remaining match repo-wide" dropped its "besides the 8 built-ins" qualifier; (4) File List omits `ChatThread.tsx`, `HeartNoteComposer.tsx`, `sprint-status.yaml`; (5) record why text alphas collapsed to one step while borders kept their hierarchy (text is AA-bound, a 1px border is not — /30–/50 text steps cannot legally render), and reconcile the kitchen-profile cluster count (11 files touched, story said 8). (blind+auditor)

**Dismissed (5):** `hover:bg-neutral-400/10` "was alive and must not be touched" — **disproved**: it was in the dead-70 from the first survey (built-in palette name, but dead in this bundle; only the `border-neutral-400/20,30` pair is alive), verified again post-review with a fixed-string probe returning zero hits. · `sacred-*`/numbered steps "may not exist" — **refuted independently by two layers**: every step maps to a `colorScale()` key, exists in both theme blocks, and is present in the compiled bundle (all 49 color-mix + 22 numbered selectors checked individually). · "same class replaced differently with no rationale" — the bucket rule is per-occurrence by design; the Auditor judged both deviations justified with reproduced evidence. · "live `text-sacred`/`text-safety-cleared` rewritten outside mandate" — required consequence of making the fills real: `sacred-plum` on `sacred-plum-100` is 2.581 in dark (FAIL), so companion text had to move to `-800` when the wash became visible. · "PlanTile test repeats the failure mode" — jsdom cannot verify CSS emission for *any* class string; that gate lives in the build probe (AC5), and the assertion now points at a class the probe proves alive.

**Auditor verdict:** all 8 ACs verify; 18/18 recomputed contrast figures match the Dev Record to the third decimal; both AC2 deviations judged justified, not rationalization; `packages/ui` tests 34/34.

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

claude-opus-5[1m] (dev-story, 2026-08-01)

### Debug Log References

**The probe lied three times. Every one was caught by a negative control, none by reading its output.**

Reconciliation 6 warned that the grep is the hazard. It understated it:

1. **Doubled backslash** — `sed 's|/|\\\\/|g'` inside a script file emits `\\/`, not `\/`. Reported the known-alive `bg-black/50` as DEAD. Caught because Reconciliation 1 gave 8 classes whose answer was known in advance.
2. **No selector boundary** — `grep -F ".bg-honey"` matched `.bg-honey-amber-100`. Reported the non-existent `bg-honey` as ALIVE. Caught by probing a token key that does not exist.
3. **`[` opens an ERE character class** — after adding a boundary check with `grep -E`, every `bg-[color-mix(...)]` class errored with `Invalid range end` and was reported DEAD. This produced a run claiming **50 of the 61 introduced classes were dead**. They were all present; a fixed-string grep found them immediately.

Final probe is fixed-string end to end, escaping each special character individually — a sed bracket expression is *also* unsafe here, because `[...\]...]` closes early on the escaped `]` and silently matches nothing (failure mode 4, caught before use). Validated both directions before every run: fabricated classes DEAD, the 8 built-ins + `flex`/`sr-only` ALIVE, prefix trap DEAD.

**The AC3 checker was wrong twice too**, in the same shape as the bug it was checking for: it parsed only `rgba()`, but Chromium returns `color(srgb r g b / a)` for `color-mix`, so it reported all three working overlays as opaque; and `via-` alone yields no `background-image`, so the gradient case needed its `from`/`to` companions.

The recurring lesson is the story's own: a check that answers a *nearby* question ("is a rule emitted?", "is this rgba opaque?") reads as success and is worth nothing.

### Completion Notes List

**Task 1 — classification (AC2).** All 70 classified before any edit. Survey reproduced the story's 70-dead/8-alive exactly. Two corrections to the survey: `MainGroupBadge.tsx:13` and `WallCardPage.tsx:165` are **comments** documenting this bug on already-fixed elements, not live classes, so the live site count is 180, not 182; and `bg-amber-warm/15` has no live site at all.

The bucket rule was sharpened by what a dead declaration actually renders as, which differs by property and which the first sweep conflated:

| Property | Dead ⇒ | Risk of a solid |
|---|---|---|
| `bg-*` | `background-color` unset ⇒ **transparent** | **hides content** — the `209324d` failure |
| `text-*` | `color` unset ⇒ **inherits parent** (usually `--fg`) | **lowers contrast** — the 3.28:1 failure |
| `border-*` | `border-color` unset ⇒ **`currentColor`** | low; any real token is *softer* than today |

**Task 2 — Bucket A (AC3), 9 sites, `color-mix` at the original percentage.** The three named traps plus six the story did not enumerate: `_dev-day-detail-multi-child.tsx:41`, `MessageComposer.tsx:35` and `EditConversation.tsx:195` (all `backdrop-blur` surfaces whose blur was doing nothing), `LumiPresence.tsx:79` (the thinking-pulse halo, `absolute -inset-1` **over** the avatar), `HeartNoteCard.tsx:27` (`blur-xl` blob), `StationeryCard.tsx:93`. `StickyBottomBar.tsx:26` looks like Bucket A but is not — it has a solid `bg-bg`, so its `backdrop-blur` is already orphaned; border only.

**Bucket B — the finding that changed the approach.** Restoring the *intended* alpha does not save the coloured chips. Measured from `colors.css`, light / dark:

| Pair | Today (wash dead ⇒ text on bare parent) | Intended wash restored |
|---|---|---|
| `safety-cleared-teal` on `surface` | 4.708 AA / 4.841 AA | **4.155 FAIL / 4.206 FAIL** |
| `safety-red` on `surface` | 4.667 AA / 3.669 FAIL | **4.085 FAIL** / 3.314 FAIL |
| `amber-warm` on `surface` | 2.054 FAIL / 6.679 AA | 1.921 FAIL / 5.586 AA |
| `sacred-plum` on `surface` | 5.930 AA / 2.922 FAIL | 5.167 AA / 2.663 FAIL |

The same-hue-text-on-same-hue-wash design **never passed AA** — it only looked acceptable because the wash was dead. Faithful restoration would have grown the axe allowlist, which AC8 forbids.

Fix follows precedent already in the repo (`contrast-audit.test.ts`'s canonical safety chip; 14-s3b's own `bg-honey-amber-100 text-honey-amber-800`): family scale `-100` fill / `-800` text. Measured, light / dark — teal **10.132 / 10.113**, plum **10.253 / 10.191**, honey **8.896 / 8.758**, foliage **9.895 / 10.017**, terracotta **9.387 / 9.082**; all AAA, because these scales are theme-flipped and invert together.

Other Bucket-B measurements shipped (light / dark):
- `honey-amber-700` on `bg` **6.743 / 6.644**, on `surface` **5.844 / 5.928** — replaces the dead `text-amber-warm/80` labels (a solid `text-amber-warm` would have been 2.370 / 7.486, i.e. a light-mode FAIL silently absorbed by the existing `amber-warm` allowlist entry).
- `fg-muted` on `bg` **8.842 / 7.448**, on `surface` **7.663 / 6.645**, on `surface-2` **6.402 / 5.905** — all the `text-fg-muted/NN` sites.
- `fg-muted` on `warm-neutral-50` **9.227 / 6.370** — the neutral chips. (`warm-neutral-100` was rejected: **4.496 dark**, just under AA.)
- `fg` on 10% amber-warm over `bg` **15.467 / 13.726**; `fg-muted` on the same **8.161 / 6.292** — the PlanTile morning tint.
- `lumi-terracotta-800` on 10% amber-warm over `surface` **10.317 / 8.349** — the child-quote block, which *also* fixes a pre-existing failure (`text-lumi-terracotta` on `surface` was 4.113 / 3.771).
- `fg` on 5% / 10% amber over `surface` **13.889 / 13.460** and **13.211 / 12.290**; `fg-muted` on 5% terracotta over `surface` **7.214 / 6.263**.

**`safety-red` — the one thing that could not be fixed.** No numbered scale, and it fails AA in dark on every available background (`bg` 4.112, `surface` 3.669, `warm-neutral-50` 3.517). With a wash, light drops to 4.085, below AA. There was no renderable option, so the intended fill was **dropped rather than restored**: those banners keep their red border and red text. **[Review correction]** "Render exactly as today" is true for the *fills* only — the dead `border-safety-red/20–40` rendered as solid `currentColor` red, so the restored 20–40% mixes make the banner borders visibly softer (the authored weight, and the safe direction, but a visible change). One per-site judgment call: `household-settings.tsx`'s dev-reset button swapped its unrenderable `hover:bg-safety-red/5` for `hover:border-safety-red` — border darkening instead of a wash, since no red wash passes under red text; dev-only surface. Deferred as **D-CS1-1**.

**Two bugs found on the way that were not `/alpha` at all.** `StatusPill.tsx:22` used `bg-honey/20 text-honey-dark border-honey/30` — `honey` is not a token key and `honey-dark` does not exist, so that pill had no background, no colour, and a `currentColor` border. And `PlanTile.test.tsx` asserted `toContain('bg-amber-warm/10')` on a class that never rendered, so it passed for the wrong reason; the assertions moved with the class.

**Deviation from the story's bucket table.** Bucket C is specified as "solid token step". Borders were instead restored with `color-mix` at the original percentage: `--border` has no numbered scale, so every distinct alpha (5/10/15/20/30/40/50) would have collapsed onto the single `border-border` value, flattening a deliberate weight hierarchy. `color-mix` renders exactly what the author wrote. This is strictly safer than a solid — borders carry no text and nothing sits beneath a 1px line — and needed no judgment call per site. Also note `--border-subtle` does **not** exist; it was almost introduced by hand and caught against `colors.css` before use (AC5).

**[Review addition] Why text collapsed to one step while borders kept their hierarchy.** The review correctly noted the asymmetry: seven border alphas were preserved via `color-mix`, but every `text-fg-muted/30–80` collapsed onto solid `text-fg-muted`. The difference is that text is AA-bound and a 1px border is not: `fg-muted` at 30–50% over any surface falls far below 4.5:1, so the authored text hierarchy *cannot legally render* — it never existed on screen (the dead classes inherited full-contrast parent colour) and restoring it would grow the axe allowlist (AC8). Solid `fg-muted` is the only step that is both muted and passing on every surface (8.842/7.448 on `bg`, 7.663/6.645 on `surface`, 6.402/5.905 on `surface-2`).

**Verification (AC1/AC5).** Against `dist/assets/index-BmFrpNhP.css` with the twice-validated probe: **61/61 introduced utilities ALIVE, 0 dead**; the only `/alpha` utilities left in the two source trees are the **8 built-in-palette ones, all still ALIVE and unmodified**; the sole remaining match, `bg-amber-warm/15`, is comment prose (proven by showing the enclosing JSX comment and the element's actual `className`).

**AC3 rendered check.** Not a CSS grep — the three named traps were rendered in Chromium and their *computed* style read back, asserting alpha < 1, with a negative control proving a solid `bg-bg` reads opaque. Results: backdrop `color(srgb … / 0.2)`, busy overlay `… / 0.7`, gradient `linear-gradient(to top, rgb(247,242,233), color(srgb … / 0.8), rgba(0,0,0,0))`. The gradient's 0.8 mid-stop is exactly what `209324d` had turned opaque.

**Gates (AC8).** typecheck clean · lint clean · knip exit 0 · turbo lint+typecheck+test **20/20 across 9 packages** · web unit **727/727** · full E2E **425 pass / 13 skip / 0 fail** · `git diff --stat -- apps/web/test packages/design-system` **empty**, so `13-s1` and the axe allowlist are provably unedited. Note the E2E axe gate runs light theme only, so every dark figure above rests on computation alone — deferred as **D-CS1-2**.

### File List

57 files across `apps/web/src` and `packages/ui/src` — class strings, plus the comment/test-title edits those strings dragged along (review: “class strings only” was imprecise); no files added, no contract, no migration, no API change. Notable:

- `features/plan/{PackerAssignmentDialog,PlanTile,BriefSkeleton}.tsx`, `features/plan/PlanTile.test.tsx`
- `features/login/components/LoginHero.tsx`, `components/LumiPresence.tsx`, `components/{AppHeader,DevTools}.tsx`
- `features/onboarding/components/MediaPanels.tsx` (D-14S3B-CR4)
- `features/kitchen-profile/components/*` (11 files — the largest cluster; the story's survey said "8 files … plus 4 singles", which was internally inconsistent: 6 named + 5 singles shipped)
- `features/heart-note/components/{StatusPill,StationeryCard,ScheduleDatePicker,MealPreviewCard}.tsx`
- `features/{lunch-link,grocery-list,kitchen-inspiration,evening-checkin,day-detail}/components/*`
- `features/kitchen-interview/components/ChatThread.tsx`, `features/grandparent/HeartNoteComposer.tsx` *(review: were omitted from this list)*
- `_bmad-output/implementation-artifacts/sprint-status.yaml` *(review: was omitted)*
- `routes/auth/{login,reset-password}.tsx`, `routes/(app)/*`, `routes/_dev-day-detail-multi-child.tsx`
- `packages/ui/src/{RailCard,TextField,StickyBottomBar,AppFooter}.tsx`
- `_bmad-output/implementation-artifacts/deferred-work.md` (closes D-14S4-5, D-14S3B-CR4; opens D-CS1-1, D-CS1-2)

## Change Log

| Date | Change |
| --- | --- |
| 2026-08-01 | Story authored (create-story, claude-fable-5). Closes retro action item 6. Survey verified same-day against the compiled bundle with a two-way probe control: 70 dead across 57 files, 8 alive built-in-palette utilities that must not be touched. Built around the classification rule, because the first sweep's mechanical solid-step substitution shipped two invisible surfaces and three AA failures. |
| 2026-08-01 | Implemented (dev-story, claude-opus-5[1m]). All 70 dead classes replaced across 57 files, classified A/B/C/D before editing. Closes D-14S4-5 + D-14S3B-CR4; opens D-CS1-1 (safety-red has no numbered scale, fails AA in dark on every background) and D-CS1-2 (axe gate is light-theme only). Gates: 727/727 unit, 425/13/0 E2E, knip 0, turbo 20/20. |
| 2026-08-01 | Code review (3 adversarial layers over fab9c5d): 22 raw findings, 6 patches applied, 5 dismissed. Auditor recomputed 18 contrast figures — all reproduce; 8/8 ACs verify. Patches: dead focus:ring-honey (default blue ring) -> ring-amber-warm; 2 base==hover collapses restored; WallCardPage comment corruption reverted; dark-invisible neutral chips -> adaptive fg-muted 10% wash; 5 Dev Record/ledger accuracy corrections. Post-patch gates: 727/727 unit, 425/13/0 E2E. Status -> done. |
