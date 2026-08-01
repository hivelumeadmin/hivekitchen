# Design System: HiveKitchen v2.0

**Canonical reference:** the v2.0 visual reference doc lives at `docs/ux-design-directions.html` (originally generated as screen `11518293364125698764` in Stitch project `projects/3502098255450050819`, titled *"v2.0 TOKEN SYSTEM — locked in Step 8, refined through Step 12"*).
**Mirrored:** 2026-05-11. **Moved to `docs/`:** 2026-05-19 (Stitch retired as design source of truth). Keep this file in sync with `docs/ux-design-directions.html` and the repo's `packages/design-system/`.

> **Source-of-truth hierarchy**
> 1. `ux-design-directions.html` (Stitch) — design intent + visual reference.
> 2. `packages/design-system/` (repo) — code-side implementation; channel names align, scale stops codify the v2.0 hexes.
> 3. The Stitch `designTheme.designMd` field is **stale** (v1.0 vocabulary: honey / sage / coral, Newsreader / Public Sans). It should be updated upstream so future MCP responses reflect v2.0.

---

## 1. Tokens (v2.0)

v2.0 uses **flat semantic tokens** at the consumer level. The repo provides 50–900 scales; v2.0 names alias specific stops.

### Surfaces & text (semantic aliases — recommended for consumers)
| v2.0 token | Role | Resolves to (dark) | Resolves to (light) |
|---|---|---|---|
| `--bg` | Page background | `#1C1A17` | `#F7F2E9` |
| `--surface` | Cards, panels | `#262420` | `#EBE2D0` |
| `--surface-2` | Elevated surfaces | `#2F2D27` | `#DCCFB5` |
| `--surface-3` | Modals, max-elevation panels (Layer 1 — 2026-05-24) | `#383530` | `#C8B791` |
| `--fg` | Primary text | `#FAF7F2` | `#141210` |
| `--fg-muted` | Secondary text | `#B0A99D` | `#56524A` |
| `--border` | Hairline dividers | `#2F2D27` (= `--surface-2`) | `#B5A784` (distinct from `--surface-2`) |

> **Light-mode surface chain refined 2026-05-24 (Layer 1):** the original Stitch v2.0 light hexes (#FAF7F2 / #F2EDE4 / #E8E3D8) had washed-out card hierarchy — `--bg`/`--surface`/`--surface-2` were only ~5 OKLCH lightness points apart and `--border` literally equaled `--surface-2`. Widened the gaps (~5–8 L points between each), added `--surface-3` for elevated/modal surfaces, and gave `--border` a distinct value visible against `--surface-2`. Dark mode untouched (it was the authored baseline). Pinned by `packages/design-system/src/tokens/convention.test.ts`. See §6 drift status item 5.

> **Note on scale inversion convention:** the repo's `packages/design-system/tokens/colors.css` treats raw `warm-neutral-50` as **always the dominant theme surface** (light: #FAF7F2; dark: #2A2724) and `warm-neutral-900` as **always the highest-contrast foreground** (light: #2A2724; dark: #FAF7F2). The semantic aliases above (`--bg`, `--surface`, etc.) are now resolved as their own theme-tuned hexes — not pinned to a specific warm-neutral stop. Consumers should always reach for the semantic alias; the raw scale is for color-math only.

### Warm-neutral scale (full — only scale that's expanded)
50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950.
See `ux-design-directions.html` for exact hexes per theme.

### Accent — amber / honey
| v2.0 token | Role | Hex (dark) | Repo equivalent |
|---|---|---|---|
| `--amber` | Emphasis + recognition | `#D98F3C` | `honey-amber-500` |
| `--amber-soft` | Secondary recognition | `#B97730` | `honey-amber-500` (light-mode hex) |
| `--amber-warm` | Hover accents | `#E69A3D` | `honey-amber-400` |
| `--honey-accent` | Recognition only | `#D98F3C` | alias for `--amber` |

> **Honey rule (locked):** "Honey-amber is reserved for **recognition moments** and **never used for button hovers**. Proposal hover uses `--lumi-terracotta-warmed`." This rule already matches `packages/design-system/tokens/colors.css` ("NEVER button hover").

### Semantic — voice + trust
| v2.0 token | Role | Hex (dark) | Repo equivalent |
|---|---|---|---|
| `--lumi-terracotta` | Lumi's voice | `#B46A4E` | `lumi-terracotta-500` |
| `--lumi-terracotta-warmed` | Proposal button hover | `#C88A6E` | `lumi-terracotta-warmed` |
| `--lumi-terracotta-dim` | Disabled / past Lumi turns | `#8A4F3A` | *(missing — add to repo)* |
| `--sacred-plum` | Family-language, Heart Note | `#8A5F72` | `sacred-plum-500` |
| `--sacred-plum-soft` | Cultural-proposal background tint | `#6B4A5A` | `sacred-plum-700` |
| `--foliage` | Confirmations, focus, freshness | `#7A9681` | `foliage-500` |
| `--foliage-soft` | Calmer confirmations | `#5F7A67` | *(missing — add to repo)* |
| `--safety-cleared-teal` | Allergy cleared | `#5A9C8B` | `safety-cleared-teal-500` |
| `--safety-cleared-fill` | Badge background tint | `rgba(90,156,139,0.10)` dark · `rgba(61,107,95,0.18)` light | repo-resolved per theme |
| `--safety-red` | Safety block only | `#C65A4E` | repo `--safety-red` |
| `--safety-red-fill` | Block-state tint | `rgba(198,90,78,0.12)` dark · `rgba(168,66,54,0.18)` light | repo-resolved per theme |

> **Fill-opacity refinement 2026-05-24 (Layer 1):** light-mode fill opacities raised from `0.10` to `0.18`. At 10% on the pale light bg (#F7F2E9), state badges washed out to near-invisible; 18% reads as a soft state-tint without becoming chromatic noise. Dark-mode opacities unchanged (10% / 12% read well on dark bg).

### Focus
- `--focus: var(--foliage)` (matches repo `--focus-indicator-color`)
- `--focus-offset: 2px`

### Roundness
| Token | Value | Use |
|---|---|---|
| `--r-sm` | 6px | Quiet diffs, mobile nav |
| `--r-md` | 10px | Buttons, plan tiles, badges |
| `--r-lg` | 16px | Cards, Heart Note container |
| `--r-xl` | 24px | The Brief, large surfaces |

> Repo does not yet codify these as Tailwind `borderRadius` extensions. Add them when wiring Tailwind.

---

## 2. Typography

**Headlines / brand:** Instrument Serif (v2.0 lockdown). Used for:
- Section titles (40px)
- Brief moment (56px — `PageHeader` `headlineSize="lg"`; corrected 2026-07-30, this doc previously said 34px while the shipped `PageHeader` has rendered 56px since the v2.0 lockdown. Ruled code-is-canon in the 14-s3 review.)
- Heart Note Composer (26px, italic)
- Page header (24px)

**Body / UI:** **Public Sans** (variable font, weights 100–900). Self-hosted at `apps/web/public/fonts/PublicSans-{Latin,LatinExt}.woff2`. Honors the CLAUDE.md "no Inter, no Roboto" rule. `--font-sans: 'Public Sans', ...`.

> The `ux-design-directions.html` reference doc in Stitch still loads Inter from Google Fonts. The new Stitch design system asset (`assets/2c15138c1b194ac2aba44cbc405bb729`) correctly specifies `PUBLIC_SANS`. New screens generated against this asset will use Public Sans. The HTML reference doc should be regenerated to match.

Numbers tabular in lists (grocery quantities, day counts).

---

## 3. Atmosphere & rules

- **Direction**: D2 Kitchen Counter chassis with selective D1 Letter borrows (Heart Note composer, Lunch Link). Locked Step 9.
- **Dark-mode-first.** Light mode is reciprocal, not primary.
- **Anchor device:** Galaxy A13 on 4G. The Brief must render in under 2 seconds on it.
- **Accessibility floor:** WCAG 2.2 AA across the app; **AAA inside `.child-scope`** (Lunch Link) and for all safety copy (allergen badges, blocking states).
- **Optimistic update, never approval.** Silent scaffolding mutations surface as a `<QuietDiff>` rear-view above the tiles.
- **Reduced motion:** all pulses/animations fall back to static state under `prefers-reduced-motion: reduce`.

### Scope tags (CSS classes that bind variant rules to a surface)
| Scope | Used by | Behaviour |
|---|---|---|
| `.app-scope` | Default web surfaces — The Brief, Day Detail, Weekly Plan, Grocery List | Standard AA, dark-mode-first |
| `.grandparent-scope` | Heart Note Composer | Instrument Serif at 26pt, unhurried, at-cap rhythm copy |
| `.child-scope` | Lunch Link (mobile only) | AAA across surface, 72px tap targets, single-column, Heart Note delivered unmodified |

---

## 4. Components (17 locked, v2.0)

Identified primitives that should each become a standalone React component:

1. `<Brief>` — Ready-Answer landing
2. `<MomentHeadline>` — Top-line "Thursday is ready" copy
3. `<LumiNote>` — Terracotta-indent paragraph, Lumi's voice
4. `<PlanTile>` — 5 variants: past, today, default, pending-input, locked
5. `<QuietDiff>` — Silent-mutation surface w/ Why? link
6. `<FreshnessState>` — stale / offline / failed indicator
7. `<Chip>` — cleared, cultural, pantry, lumi (icon + tinted bg)
8. `<AllergyClearedBadge>` — pill w/ ✓, opens popover on tap
9. `<VisibleMemorySentence>` — sentence + always-visible ⋯
10. `<PresenceIndicator>` — "Priya is editing this tile" affordance
11. `<MobileNavAnchor>` — Phase 1 minimal mobile nav (Brief / Thread / Memory)
12. `<HeartNoteComposer>` — writing + at-cap states (.grandparent-scope)
13. `<LunchLink>` — child-scope mobile surface
14. `<Thread>` / `<Turn>` — user / lumi / system / cultural-proposal variants
15. `<Button>` — 5 variants: primary, secondary, tertiary, **proposal**, destructive
16. `<ThemeToggle>` — light/dark
17. `<ContrastSwatch>` — internal QA component (not shipped)

### Button taxonomy (locked)
| Variant | Background | Border | Text | Hover |
|---|---|---|---|---|
| primary | `--fg` | none | `--bg` | `warm-neutral-300` |
| secondary | `warm-neutral-700` | none | `--fg` | `warm-neutral-600` |
| tertiary | transparent | none | `warm-neutral-300/400` | underline |
| proposal | transparent | `1.5px --lumi-terracotta` | `--fg` | bg `--lumi-terracotta-warmed`, text stays `--fg` |
| destructive | transparent | `1px warm-neutral-400` | `--fg` | bg `--surface-2` |

> **Note:** v2.0's `destructive` variant is intentionally muted — red is reserved for `--safety-red` (allergen / safety-block states only), not destructive UI actions.

> **Correction (2026-08-01, 14-s3b review).** The `proposal` row previously read text `--lumi-terracotta`, hover text `--warm-neutral-950/900`. Both were wrong and are corrected above:
> - **`--warm-neutral-950` does not exist.** `colorScale()` in `packages/design-system/src/tokens/index.ts` emits 50–900 only, so anything following the old spec literally produced **no CSS rule at all** — the exact silent-failure mode that has bitten this repo repeatedly. (§222's migration table already noted 950 as "v2.0-only… no exact equivalent".)
> - **`--warm-neutral-900` on `--lumi-terracotta-warmed` measures 4.25:1 in light theme** — below AA for the 13px pill label.
> - **`--lumi-terracotta` as the base text measures 4.23:1 in dark theme** — AA-large only, so it fails AA at 13px.
>
> `--fg` measures 16.76 / 16.25 at rest and 5.34 / 5.19 on the warmed hover fill, clearing AA in both themes. The terracotta identity is carried by the 1.5px border and the hover fill, not by the label. Shipped in `PlanTile.tsx`.

---

## 5. Stitch screen index (v2.0 Applied)

| Surface | Screen ID | Stitch title |
|---|---|---|
| The Brief / Weekly Plan | `ffeda79fd0184166b15c0eeefd5f1495` | Weekly Plan — Updated Header and Footer |
| Day Detail | `9c5ad38b72ec4f529a224299f24a882b` | Day Detail — v2.0 Applied |
| Evening Check-in | `67fed433916146a5a1ed9e76ed74d4c3` | Evening Check-in — Final Layout Alignment |
| Heart Note Composer | `cbbab2633aae49dfb3f7124a0aef8dad` | Heart Note Composer — v2.0 Applied |
| Lunch Link (.child-scope) | `41900a9766ce4781b07cafe73de7852c` | Lunch Link — v2.0 Applied |
| Weekly Grocery List | `4d1520a795ba476fac78901423eea3dd` | Weekly Grocery List — v2.0 Applied |
| Weekly Grocery List (Ambient — alt) | `b58bea0456ea470bbe83fdddd9e675b0` | Weekly Grocery List (Ambient) — v2.0 Applied |
| Weekly Grocery List (Ambient Lumi — alt) | `5882741661939729522` | Weekly Grocery List — With Ambient Lumi Presence |
| Kitchen Interview | `0a65b54e7f394701ba652106699a18e0` | Kitchen Interview — v2.0 Applied |
| Kitchen Profile | `f7946525ed97455395981569a2ded8e5` | Kitchen Profile: Structured Identity |
| Kitchen Inspiration | `428ce1be2a8a4f55bd898521d1193d06` | Kitchen Inspiration — v2.0 Applied |
| Onboarding | `fcb4ccf4bb834000884ad7bdee496aa7` | Onboarding — v2.0 Applied |
| Welcome / Login | `0541d1852a2244d09c2e31e9e4878743` | Welcome Back — Login Screen v2.0 |
| UX directions (this doc) | `11518293364125698764` | ux-design-directions.html |

> Three Weekly Grocery List variants currently coexist; pick a canonical one in Stitch before generating React components.

---

## 6. Warm-neutral scale: convention + v2.0 translation rule

### The canonical convention (repo wins)

`packages/design-system/tokens/colors.css` is authoritative:

| Stops | Intent | Stable across themes |
|---|---|---|
| `warm-neutral-50`..`-200` | Page background, cards, subtle borders | yes |
| `warm-neutral-300`..`-500` | Subdued surface, placeholders, disabled state | yes |
| `warm-neutral-700`..`-900` | Primary text, emphasis | yes |

`warm-neutral-50` is always the dominant surface for the theme; `warm-neutral-900` is always the highest-contrast foreground. The hex values swap between themes; the intent does not. Writing `className="bg-warm-neutral-50 text-warm-neutral-900"` renders correctly in both light and dark mode.

This convention matches industry standard (Radix Colors, Material 3 tonal palettes). It is enforced by `packages/design-system/src/tokens/convention.test.ts`.

### The v2.0 raw scale is INVERTED from the repo

`ux-design-directions.html` declares `warm-neutral-50` as text-like and `warm-neutral-900` as bg-like — the opposite direction. **This conflict is intentional in v2.0 and will be reconciled upstream**, but generated React must never assume v2.0's direction.

### Hard rule for generated React

Generated React components MUST use **semantic aliases** for surfaces and text:

| Use case | Tailwind class | CSS var |
|---|---|---|
| Page background | `bg-bg` | `var(--bg)` |
| Card / panel | `bg-surface` | `var(--surface)` |
| Elevated surface | `bg-surface-2` | `var(--surface-2)` |
| Primary text | `text-fg` | `var(--fg)` |
| Secondary text | `text-fg-muted` | `var(--fg-muted)` |
| Hairline divider | `border-border` | `var(--border)` |

These aliases bypass the scale-direction conflict — they resolve to v2.0-exact hex values in both themes regardless of the underlying warm-neutral inversion.

### v2.0 raw `warm-neutral-X` → repo translation (last-resort fallback)

If a generated component genuinely needs a raw scale stop (e.g., for mid-range tones not covered by the semantic aliases), apply this transformation **at conversion time**:

| Stitch v2.0 source | Repo equivalent | Why |
|---|---|---|
| `var(--warm-neutral-50)` | `bg-bg` or `text-fg` (alias preferred) | v2.0's 50 = fg; repo's 50 = bg. Use aliases. |
| `var(--warm-neutral-100)` | `surface` or `warm-neutral-900` | mid-light-text in v2.0 |
| `var(--warm-neutral-200)` | `warm-neutral-800` | subtle text in v2.0 |
| `var(--warm-neutral-300)` | `warm-neutral-700` | muted text in v2.0 |
| `var(--warm-neutral-400)` | `warm-neutral-600` | placeholder in v2.0 |
| `var(--warm-neutral-500)` | `warm-neutral-500` | exact midpoint — same in both |
| `var(--warm-neutral-600)` | `warm-neutral-400` | subdued surface in v2.0 |
| `var(--warm-neutral-700)` | `border-border` or `warm-neutral-300` | hairline/secondary in v2.0 |
| `var(--warm-neutral-800)` | `bg-surface` or `warm-neutral-200` | card surface in v2.0 |
| `var(--warm-neutral-900)` | `bg-bg` or `warm-neutral-50` | page bg in v2.0 |
| `var(--warm-neutral-950)` | `bg-bg` (no exact equivalent) | v2.0-only deepest stop |

**Rule of thumb when in doubt:** invert the stop number (`1000 - X`) when copying raw `warm-neutral-X` from v2.0 CSS to the repo's Tailwind scale. Or skip the math entirely and reach for the semantic alias.

### Status of related deltas

1. **Font question** — **closed.** Inter removed from `typography.css` and `apps/web/public/fonts/`. Replaced with self-hosted Public Sans variable font (latin + latin-ext subsets, weights 100–900). `fonts.test.ts` and `_dev-tokens.tsx` updated. CLAUDE.md rule now actually honored.
2. **Stitch design system upstream** — **partial.** A new Stitch design system asset has been created via MCP from this DESIGN.md: `assets/2c15138c1b194ac2aba44cbc405bb729` ("HiveKitchen v2.0 — Editorial Hearth"). The project's original `designTheme.designMd` field still contains v1.0 vocabulary (MCP cannot overwrite it directly). The new asset can be applied to screens via `mcp__stitch__apply_design_system` when ready. Manual cleanup of the legacy field in Stitch UI is still desirable.
3. **Hex drift between v2.0 spec, repo, and Stitch's auto-generated asset** — **documented, accepted.** Three sources now have different hex values for `bg`/`surface`/etc.:
   - **Repo (this codebase)** — the authoritative implementation. Dark theme uses v2.0-exact hexes (`bg: #1c1a17`). Light theme intentionally diverged 2026-05-24 (`bg: #f7f2e9`, `surface: #ebe2d0`, `surface-2: #dccfb5`, new `surface-3: #c8b791`, distinct `border: #b5a784`) — see item 5 below. All hexes pinned by `convention.test.ts`.
   - **Stitch's auto-generated design system asset** — Material-3-style schema with its own hex choices (`bg: #121212`, `surface: #1E1E1E`). Drift originates from Stitch's interpreter, not from any decision on our side.
   - **`ux-design-directions.html` (the v2.0 reference doc)** — original v2.0 spec hexes (light `bg: #FAF7F2`). Repo's light theme now diverges intentionally.
   When generated screens are converted to React via the `react-components` skill, the repo's values win (semantic aliases). The Stitch-side drift only affects what new Stitch-generated screens look like before conversion.
4. **Mid-scale warm-neutral hex drift** (300–500) — **deferred.** The repo's spec-anchored scale already passes `contrast-audit.test.ts`. v2.0's mid stops are intentionally darker. Since generated React uses semantic aliases for surfaces (not raw mid-scale stops), the practical impact is negligible. Re-audit only if a future component reaches for raw `warm-neutral-{300..500}` from a Stitch design.
5. **Light-mode surface chain refined 2026-05-24** — **intentional repo divergence.** Stitch v2.0's light hexes for `--bg`/`--surface`/`--surface-2` were only ~5 OKLCH lightness points apart and `--border` equaled `--surface-2`. The result was washed-out card hierarchy + no visible borders in light mode. Repo-side fix (Layer 1): widened the surface lightness gaps to ~5–8 L points each, added `--surface-3` for max-elevation surfaces, gave `--border` a distinct value, bumped light-mode safety-fill opacities from 0.10/0.12 to 0.18. New pinned light-mode hexes in §1 surface table; pinning enforced by `convention.test.ts`. Dark mode untouched. **A complementary Layer 2 pass** swapped opacity-on-pale-base Tailwind patterns (`bg-amber/10`, `from-surface to-bg opacity-50`, `bg-warm-neutral-100/60`) in the 11 onboarding mockup pages for higher-opacity / explicit-surface tokens — those patterns are dark-mode habits that disappear on light bg. See `feat(2.6-s4): light-mode opacity audit` commit for the full pattern list.

---

## 7. Repo-specific layout patterns (intentional divergences from Stitch)

These are conventions enforced in the codebase that may differ from individual Stitch screens. When converting screens via the `react-components` skill, apply the repo pattern — do not faithfully reproduce the Stitch source where it conflicts.

### Sticky bottom action bar (`<StickyBottomBar>`)

**Where it lives:** `apps/web/src/components/StickyBottomBar.tsx`. App-wide layout shell.

**Rule:** Any page with a primary action surface (Confirm, Keep, Save, Send, Tuck in, etc.) renders that surface inside `<StickyBottomBar>` — i.e. fixed at the bottom of the viewport with a backdrop-blurred surface, not in-flow at the end of the page. Pages mounting it must add `pb-28` or `pb-32` to their main content so it clears the bar.

**Why:** Consistent action-affordance pattern across surfaces, regardless of page length. The user always knows where to find the primary action.

**Divergence note:** Stitch v2.0's *Weekly Plan* screen renders the action row in-flow below the "Why this week" panel; *Day Detail* uses a sticky bar. The repo standardizes on the sticky pattern across both (and any future action surfaces). If Stitch screens are regenerated and visually diff'd against the repo, expect this difference on screens that previously had in-flow action rows.

**Applies to (so far):**
- Weekly Plan — Confirm the week / Speak to Lumi / Swap a day
- Day Detail — Keep this lunch / Swap / Pause / Speak to Lumi

**API:**
```tsx
import { StickyBottomBar } from '@/components/StickyBottomBar.js';

<StickyBottomBar>
  <div>{leftGroup}</div>
  <div>{rightGroup}</div>
</StickyBottomBar>
```

### Primary CTA (`<PrimaryButton>`)

**Where it lives:** `apps/web/src/components/PrimaryButton.tsx`. App-wide.

**Rule:** The dominant call-to-action on every surface uses `<PrimaryButton>` — filled `amber-warm` with `text-bg`, darkens to `amber` on hover, `active:scale-95`. Primary CTAs **never** use sacred-plum, lumi-terracotta, or honey-accent (each is reserved for other channels). **Every PrimaryButton has a required leading icon** (auto-sized to `h-5 w-5`) so the icon + label visual reads identically on every screen.

**Size variants:**
- `default` (`px-8 py-3 font-bold`) — compact CTA used inside `<StickyBottomBar>` action surfaces. Default.
- `lg` (`w-full min-h-[56px] uppercase tracking-widest`) — full-width chunky form CTA used inside login/onboarding/form-style screens.

**Examples:**
- Weekly Plan: `<CheckCircleIcon />` + "Confirm the week" — `default` size, sticky bar
- Day Detail: `<CheckCircleIcon />` + "Keep this lunch" — `default` size, sticky bar
- Heart Note: `<SendIcon />` + "Save the note" — `default` size, sticky bar (note is being delivered)
- Login: `<ArrowRightIcon />` + "Enter Kitchen" — `lg` size, full-width form CTA

**Divergence note:** Stitch's v2.0 Heart Note Composer rendered "Save the note" in sacred-plum, no icon. Stitch's v2.0 Login rendered "Enter Kitchen" with `bg-honey-accent`. Both conflict with the channel rules — the repo standardizes on amber-warm + icon-left for all primaries.

### Secondary action (`<SecondaryButton>`)

**Where it lives:** `apps/web/src/components/SecondaryButton.tsx`. App-wide.

**Rule:** Every non-primary action button uses `<SecondaryButton>`. Standardized typography (`text-[13px] font-medium`), padding (`px-4 py-3`), color (`text-fg-muted` → `text-amber-warm` on hover). **Every SecondaryButton has a required leading icon** (auto-sized to `h-5 w-5`) — same icon + label visual rhythm as `<PrimaryButton>`.

**Examples:**
- Weekly Plan: `<RefreshIcon />` + "Swap a day"
- Day Detail: `<RefreshIcon />` + "Swap to something else", `<CalendarIcon />` + "Pause Tuesday"
- Heart Note: `<ArrowRightIcon />` + "Skip today"

**Why:** Prior to standardization, three surfaces had three different rendered sizes (14px / 13px / browser default ≈16px), varying weights, and inconsistent icon usage (some had icons, some didn't, some had underlines). Single primitive + required icon = identical visual on every page.

### Lumi action (`<TalkToLumiButton>`)

**Where it lives:** `apps/web/src/components/TalkToLumiButton.tsx`. App-wide.

**Rule (fixed, no overrides):**
- Label: **"Talk to Lumi"** — always.
- Icon: `WaveformIcon` — always.
- Colour: `lumi-terracotta` with `lumi-terracotta-warmed` on hover.
- Position: **right edge** of the action surface.
- Optional `hint`: a single-line italic footnote beneath the button (e.g. last-rating note).

The label and icon are intentionally non-configurable to prevent drift. If a screen needs a different action wording or visual, do not extend this primitive — use a separate component.

**Examples (all three currently):** right side of every sticky action bar, identical pixel-for-pixel. Heart Note's previous "Use a Lumi suggestion" + SparklesIcon affordance is consolidated into this single button.

**Divergence notes:**
- Stitch's v2.0 Weekly Plan placed "Speak to Lumi" in the left button group next to Confirm. The repo moves it to the right.
- Stitch's v2.0 used three different labels ("Speak to Lumi" / "Speak to Lumi about this" / "Use a Lumi suggestion"). The repo unifies on "Talk to Lumi".
- Stitch's Heart Note used SparklesIcon; the repo uses WaveformIcon everywhere.

### Action-bar layout

The standard layout inside `<StickyBottomBar>` is:
- **Left group:** `<PrimaryButton>` + zero or more `<SecondaryButton>` instances (Skip, Swap, Pause, …).
- **Right slot:** `<TalkToLumiButton>` — always.

### Form input (`<TextField>`)

**Where it lives:** `apps/web/src/components/TextField.tsx`. App-wide.

**Rule:** All form text inputs use `<TextField>` — labeled input with consistent typography, padding, and focus states. The label is always uppercase tracking-widest `text-fg-muted` (matches the section-eyebrow style). The input has `bg-surface` with `border-border`, padding tuned for an optional leading icon and an optional trailing slot. **Focus state is `amber-warm`** (border + 1px ring), matching the brand emphasis colour.

**Required props:** `id` (label-input association), `label`. All other props are optional.

**Examples:**
- Login email field: `<TextField id="login-email" label="Email Address" type="email" icon={<MailIcon />} placeholder="you@example.com" />`
- Login password field with visibility toggle: `<TextField id="login-password" label="Password" type={showPassword ? 'text' : 'password'} icon={<LockIcon />} trailing={<button onClick={...}>{showPassword ? <EyeOffIcon /> : <EyeIcon />}</button>} />`

**Why a primitive:** Prior to extracting this, the Stitch HTML defined each input with ~80 characters of repeated Tailwind classes (`w-full bg-warm-neutral-800 border border-warm-neutral-700 rounded-lg py-3 pl-12 pr-4 ... focus:border-honey-accent ...`). Future forms (onboarding, account settings, child profiles) all inherit the same shape via this primitive.

**Trailing slot:** Pass any ReactNode — visibility toggles, clear buttons, status indicators. The TextField positions it absolutely on the right with `pr-12` reserved spacing.

### Rail cards (`<RailCard>`)

**Where it lives:** `apps/web/src/components/RailCard.tsx`. App-wide.

**Rule:** Every right-rail card uses `<RailCard>`. The eyebrow renders **inside** the padded card chrome with the body content directly below. No exceptions — cards with images render the image as the first element of the card body (with `mb-4` spacing), still inside the same padded surface.

**Why "eyebrow inside" is the rule:** Stitch's v2.0 designs were inconsistent — some cards put the eyebrow outside the card boundary as a section label (Heart Note's "What Layla is having today"), others put it inside (Day Detail's "Safe for Aarav's school"). The repo standardizes on **inside** so every rail card has the same top-left padding and reads as a single visual block.

**Divergence note:** Stitch's v2.0 Heart Note Composer rendered the meal-preview card with an outside eyebrow + edge-to-edge image. The repo moves the eyebrow inside and pads the image, matching Day Detail's rail-card rhythm.

**Variants:**
- `bordered` (default) — `bg-surface` with optional 4px left accent (`sacred` / `lumi-terracotta`).
- `tinted` — channel-tinted background, requires `accent`. Used for `<LumiPresenceCard>`.
- `muted` — smaller padding, muted text. Used for `<SourceCard>` and footnote-style cards.

### Header variants (`<AppHeader>` and `<DetailHeader>`)

**Where they live:** Both in `apps/web/src/components/`. App-wide.

**Rule:**
- `<AppHeader>` — hub-level surfaces (Brief / Weekly Plan, Account, etc.). Brand + global actions (notifications, profile).
- `<DetailHeader>` — drill-down surfaces (Day Detail, future detail views). Back arrow + breadcrumb + Lumi pulse + profile.

`<AppHeader>` is mounted by `AppLayout` for `(app)/` routes by default. Detail screens use `<DetailHeader>` instead — either by overriding in a nested layout, or by composing it directly in the route component for dev/preview surfaces.

**Footer (`<AppFooter>`)**

**Where it lives:** `apps/web/src/components/AppFooter.tsx`. App-wide.

**Rule:** Single canonical footer everywhere. Brand on the left, legal nav in the middle, copyright + tagline on the right. Stitch's v2.0 designs have inconsistent footers (Weekly Plan's was minimalist; Day Detail's was richer). The repo uses the richer version for consistency.

---

## 8. Sync workflow

1. Edit design in Stitch (canvas + `ux-design-directions.html`). Never edit this file by hand.
2. Re-mirror `DESIGN.md` — re-fetch `ux-design-directions.html` and regenerate this file.
3. *(Historical — Stitch workflow retired 2026-05-19.)* For each screen change, the v1 workflow re-ran `react-components` per screen with cached `.stitch/designs/{screen}.html`. Replaced by in-repo mockup routes at `apps/web/src/features/onboarding-mockups/` (see [[onboarding-mockups-route]] memory).
4. Generated components should consume **semantic aliases** (`bg-surface`, `text-fg-muted`, `border-border`, etc.), not raw scale stops or hex codes.

### Image backfill

Stitch screens reference real images via Google CDN URLs (`https://lh3.googleusercontent.com/aida-public/...`). When converting a screen:

1. Extract image URLs from the Stitch HTML body (look for `<img src="https://lh3.googleusercontent.com/aida-public/...">`).
2. Append a width hint to get a usable resolution: `=w1200` or `=w1600` for hero images, `=w800` for inline thumbnails.
3. Download via `curl -sL -A "<Chrome UA>" -o "apps/web/public/images/{descriptive-name}.jpg" "<url>"`. Files live under `apps/web/public/images/` (Vite serves this at `/images/...`).
4. Naming convention: `{feature}-{purpose}.jpg` (e.g. `login-hero.jpg`, `day-detail-hero.jpg`, `meal-cumin-chicken-pita.jpg`). Keep names descriptive for debugging.
5. Reference from React with absolute paths starting at `/images/...` — never import as a module (avoids bundling large binaries into the JS).

These are **preview/mock assets**. In production, real product photos arrive via the API and the `imageSrc` prop on each consumer (e.g. `<LunchImage imageSrc={...} />`). Components default to the public-folder image when no prop is supplied so dev previews still render.
