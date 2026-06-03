# Story 4.16: Multilingual Fonts + RTL

Status: review

**Slice key:** `4-s16-multilingual-fonts-rtl`
**Epic:** 4 — Lunch Link & Heart Note Sacred Channel
**Source slice doc:** `_bmad-output/planning-artifacts/epic-4-vertical-slices.md` §Slice 4-S16
**Builds on:** 1-4 (token system v2.0 → `typography.css` + `--font-serif`/`--font-sans`), 4-S1/4-S5 (Heart Note compose + `StationeryCard`), 4-S2/4-S3 (Lunch Link child surface + `HeartNoteCard`), 4-S13 (grandparent `HeartNoteComposer`), 4-S15 (child-request textarea on `lunch-link.tsx`)
**Folds:** 4.16 — AR-20, NFR-A11Y-6

---

## Story

As a **Primary Parent** (or grandparent) composing a Heart Note in Hindi / Hebrew / Arabic / Tamil / Bengali,
I want my non-Latin-script Heart Note to render correctly on my child's Lunch Link — never as tofu boxes (□□□) — and right-to-left scripts to flow correctly,
So that the sacred channel honors my language exactly as I wrote it (resolves AR-20, NFR-A11Y-6).

This is a **content-layer** slice, not a UI-i18n slice. The UI chrome stays English (Phase 1). What changes is that **user-authored Heart Note text** — wherever it is composed or displayed — renders in a script-appropriate typeface and flows in the correct direction.

---

## Context — Why This Is Almost Entirely a CSS + Attribute Slice

The Heart Note is the editorial-serif register of the product. Every place a parent/grandparent/child types or reads a Heart Note today uses the Tailwind `font-serif` utility, which resolves to the CSS variable `--font-serif`:

```css
/* packages/design-system/tokens/typography.css */
--font-serif: 'Instrument Serif', Georgia, 'Times New Roman', serif;
```

**Instrument Serif is Latin-only** — its `@font-face` `unicode-range` covers only `U+0000-00FF` (+ a few punctuation/symbol points). When a Heart Note contains Devanagari (`आज`), Hebrew (`שלום`), Arabic (`مرحبا`), Tamil (`வணக்கம்`), or Bengali (`আজ`) codepoints, Instrument Serif declines them, the stack falls through to `Georgia`/`Times`/generic `serif`, and on a device without that script installed the browser renders **tofu boxes**. That is the exact bug this slice closes.

The fix is the canonical `unicode-range` multi-script fallback technique:

1. **Self-host** a per-script Noto woff2 subset for each of the five scripts.
2. Declare each with an `@font-face` whose `unicode-range` is scoped to that script's Unicode block(s). The browser then **lazy-loads only the script subset actually present on the page** — this is precisely the "load only the needed script subset per text content" requirement in the AC.
3. **Append** those families to the `--font-serif` (Heart Note register) and `--font-sans` (UI register) fallback chains. Because Instrument Serif's `unicode-range` doesn't match a Devanagari codepoint, the browser walks the chain to the first family whose `@font-face` `unicode-range` *does* match → the Noto subset → correct glyph, no tofu.
4. Add `dir="auto"` to the user-authored text nodes so RTL scripts (Hebrew, Arabic) flow right-to-left while LTR scripts stay left-to-right — direction inferred per-node from the content's first strong directional character.

**No Tailwind config change is needed.** `font-serif`/`font-sans` map to `var(--font-serif)`/`var(--font-sans)` via `tokenPresets.extend.fontFamily` (`packages/design-system/src/tokens/index.ts`). Editing the CSS vars in `typography.css` is the whole font-stack change.

---

## Canonical Design Decision — Heart Notes Are Serif, Per Script (DESIGN.md §13.7)

⚠️ **The slice doc and epic AC literally say `noto-sans-{script}.woff2`. The canonical design system overrides that wording.** `docs/DESIGN.md` §13.7 + `ux-design-specification.md` ("Script coverage") are explicit and are the authority for any UI work (CLAUDE.md: "READ FIRST"):

> "The visual-hierarchy commitment (**Heart Note = editorial-serif register**) is preserved across scripts; the literal typeface adapts."

> Per-script fallback stack:
> - Devanagari (Hindi) → Noto Sans Devanagari (UI); **Heart Note → Noto Serif Devanagari**
> - Bengali → Noto Sans Bengali; **Heart Note → Noto Serif Bengali**
> - Urdu/Arabic → **Noto Naskh Arabic** (both UI and Heart Note — "Noto Naskh carries sufficient editorial warmth for the sacred channel register")
> - Tamil, Hebrew → Noto Sans (UI) / Noto Serif (Heart Note) per script
> - "FOUT acceptable; FOIT banned" → `font-display: swap` (already the repo pattern)

**Therefore:**
- The `--font-serif` chain (where ALL Heart Note content + composer textareas + the child-request textarea render) gets the **Noto Serif** family per script, and **Noto Naskh Arabic** for Arabic.
- The `--font-sans` chain (UI/body) gets the **Noto Sans** family per script, and **Noto Naskh Arabic** for Arabic. This covers the edge case where a non-Latin **child name** appears in a `font-sans` node (e.g. the `FeedbackBlock` salutation `"How was lunch, {childName}?"`) — DESIGN.md's name-handling rule forbids names tofu-ing anywhere.

Net new font files (9): `NotoSerif{Devanagari,Bengali,Hebrew,Tamil}.woff2` + `NotoNaskhArabic.woff2` (serif/Heart-Note register) and `NotoSans{Devanagari,Bengali,Hebrew,Tamil}.woff2` (UI register; Arabic reuses the single `NotoNaskhArabic.woff2` in both chains).

**This is the recommended scope baked into the ACs below.** It is the complete, DESIGN.md-faithful answer and `unicode-range` keeps per-page cost to ~one script. See the **Open Question** at the bottom if you (Menon) want to trim to serif-only — that decision is non-blocking and the story is shippable as written.

---

## Acceptance Criteria

### AC1 — Self-hosted Noto woff2 subsets in `apps/web/public/fonts/`

The following script-subset woff2 files exist in `apps/web/public/fonts/` (committed binaries, matching how `InstrumentSerif-*.woff2` / `PublicSans-*.woff2` already live there):

**Heart Note serif register:**
- `NotoSerifDevanagari.woff2`
- `NotoSerifBengali.woff2`
- `NotoSerifHebrew.woff2`
- `NotoSerifTamil.woff2`
- `NotoNaskhArabic.woff2` *(serves the serif register for Arabic per DESIGN.md; also reused by the sans chain)*

**UI sans register:**
- `NotoSansDevanagari.woff2`
- `NotoSansBengali.woff2`
- `NotoSansHebrew.woff2`
- `NotoSansTamil.woff2`

Each file is the **script-block subset only** (not the full font, not Latin — Latin is already covered by Instrument Serif / Public Sans). Use weight 400 (the Heart Note register is a single regular weight; the UI register can be a variable subset if the source provides one, but a single 400 woff2 is sufficient for this slice).

> **File naming:** the existing repo convention is PascalCase (`InstrumentSerif-Regular.woff2`). These follow it. The epic's literal `noto-sans-devanagari.woff2` kebab spelling is superseded by the repo convention + the serif decision above; the only hard requirement is that the `src: url(...)` in `@font-face` matches the actual filenames.

**Acquisition (see Task T1 for the exact procedure):** download from the Google Fonts `css2` API, which returns both the subsetted woff2 **and** the exact `unicode-range` to copy verbatim into the `@font-face`. Do NOT hand-roll subsetting. Do NOT add `@fontsource/*` npm dependencies (the repo self-hosts committed binaries; introducing 9 font deps violates the dependency-hygiene rule in project-context.md).

> If the build/sandbox environment has no outbound network for the download, fetching + committing the 9 woff2 binaries becomes a **USER-SIDE GATE** (like the `supabase db push` gates in 4-S11/4-S15). In that case the dev agent lands every code/CSS/test change and the download script, and flags the binary commit as the remaining gate.

### AC2 — `@font-face` declarations with `unicode-range` in `typography.css`

In `packages/design-system/tokens/typography.css`, add nine `@font-face` blocks — one per file in AC1 — following the exact shape of the existing Instrument Serif / Public Sans blocks. Each block:

- `font-family`: the canonical family name — `'Noto Serif Devanagari'`, `'Noto Serif Bengali'`, `'Noto Serif Hebrew'`, `'Noto Serif Tamil'`, `'Noto Naskh Arabic'`, `'Noto Sans Devanagari'`, `'Noto Sans Bengali'`, `'Noto Sans Hebrew'`, `'Noto Sans Tamil'`.
- `src: url('/fonts/<File>.woff2') format('woff2');`
- `font-weight: 400;` (or `100 900` if a variable subset is used for the Sans register)
- `font-style: normal;`
- `font-display: swap;` — **mandatory** (FOUT acceptable, FOIT banned per DESIGN.md §13.7).
- `unicode-range:` — **copied verbatim** from the Google Fonts `css2` response for that family. Reference core blocks (the real ranges from Google are wider — use Google's, do not truncate to these):
  - Devanagari: `U+0900-097F` (+ Vedic/Devanagari-Extended/symbols Google adds)
  - Bengali: `U+0980-09FF`
  - Tamil: `U+0B80-0BFF`
  - Hebrew: `U+0590-05FF, U+FB1D-FB4F`
  - Arabic: `U+0600-06FF, U+0750-077F, U+08A0-08FF, U+FB50-FDFF, U+FE70-FEFF`

The `unicode-range` is what makes the load lazy and per-script — it is **not optional decoration**. A block without `unicode-range` would eagerly download the font on every page and break the bundle budget (UX-DR61).

### AC3 — Font-family fallback chains updated

In `packages/design-system/tokens/typography.css`, extend the two `:root` CSS variables so the Noto families sit **after** the primary family and **before** the generic fallback:

```css
:root {
  --font-serif: 'Instrument Serif', 'Noto Serif Devanagari', 'Noto Serif Bengali',
    'Noto Serif Hebrew', 'Noto Serif Tamil', 'Noto Naskh Arabic',
    Georgia, 'Times New Roman', serif;
  --font-sans: 'Public Sans', 'Noto Sans Devanagari', 'Noto Sans Bengali',
    'Noto Sans Hebrew', 'Noto Sans Tamil', 'Noto Naskh Arabic',
    -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', system-ui, sans-serif;
}
```

Order matters: the browser uses the first family whose matched `@font-face` `unicode-range` covers the codepoint. Latin codepoints match Instrument Serif / Public Sans first (their `unicode-range`); non-Latin codepoints fall through to the matching Noto family.

> Do NOT touch `packages/design-system/src/tokens/index.ts`. The Tailwind `font-serif`/`font-sans` utilities already resolve to these CSS vars; editing the vars is the entire stack change.

### AC4 — `dir="auto"` on the Heart Note **display** node (child surface)

In `apps/web/src/features/lunch-link/components/HeartNoteCard.tsx`:
- Add `dir="auto"` to the `<p>` that renders `{body}` (currently line ~18, `className="text-center font-serif text-[20px] italic ..."`).
- Add `dir="auto"` to the `<span>` that renders `{from}` (the author attribution, line ~22, `font-serif ...`) — author display names can be non-Latin too.

Keep `text-center` — centered alignment is direction-neutral; `dir="auto"` handles bidi reordering within lines so a Hebrew/Arabic Heart Note flows RTL while an English one stays LTR. Do **not** convert `text-right` on the `from` line to a logical property in this slice (that layout-logical-property sweep is Phase 2 / a separate lint-rule slice — see Guardrails).

### AC5 — `dir="auto"` on the Heart Note **composer** input (parent)

In `apps/web/src/features/heart-note/components/StationeryCard.tsx`:
- Add `dir="auto"` to the `<textarea>` (line ~40, `aria-label="Heart Note"`, `font-serif text-[22px] italic ...`).

This makes the parent composer flip to RTL caret/alignment as soon as the first strong RTL character is typed, and renders the typed script with the correct Noto Serif glyphs.

### AC6 — `dir="auto"` on the grandparent composer input

In `apps/web/src/features/grandparent/HeartNoteComposer.tsx`:
- Add `dir="auto"` to the **active** composing `<textarea>` (line ~132, `aria-label="Heart Note"`).
- Add `dir="auto"` to the **read-only at-cap** `<textarea>` (line ~104, `aria-label="Heart Note (read-only — monthly cap reached)"`) for consistency.

Do **not** touch the system-rendered rhythm copy / `TermHighlight` (sacred-plum family-term underline) — that is product copy, not user-authored Heart Note content, and is intentionally English-template.

### AC7 — `dir="auto"` on the child-request input + Heart Note render (Lunch Link route)

In `apps/web/src/routes/(app)/lunch-link.tsx`:
- Add `dir="auto"` to the child "Tell {parentName} back" `<textarea id="child-request-input">` (line ~334, `font-serif text-[22px] ...`) — the child may write in the family's home script.
- The Heart Note body on this route renders through `<HeartNoteCard>` (covered by AC4) — no extra change needed here for the note itself.

The `<label>`, character counter, salutation, and rating prompt stay as-is (UI chrome). If you want belt-and-suspenders for a non-Latin child name in the salutation/prompt, the `--font-sans` Noto chain (AC2/AC3) already covers it with no per-node change.

### AC8 — Font-file existence test

The existing `packages/design-system/src/tokens/fonts.test.ts` checks the four base fonts against **both** `apps/web` and `apps/marketing`. The marketing app does **not** render Heart Notes and must not be forced to carry the multilingual subsets.

- **Do NOT add the nine new files to the shared `expectedFonts` array** (that array is asserted against both apps).
- Add a **new, separate** `describe` block (or test) asserting the nine multilingual woff2 exist in `apps/web/public/fonts/` **only**.
- Match the existing `it.skipIf(!!process.env.CI)` guard so CI (which doesn't have the committed-but-gitignored-large binaries, or runs before the user-side download gate) stays green, consistent with the current pattern.

### AC9 — `@font-face` + fallback-chain CSS guardrail test

Add a test (new file `packages/design-system/src/tokens/multilingual-fonts.test.ts`, or extend `fonts.test.ts`) that reads `packages/design-system/tokens/typography.css` as text and asserts:
- An `@font-face` block exists for each of the nine families (string-match the `font-family:` value).
- Each Noto `@font-face` block contains both `unicode-range` and `font-display: swap`.
- `--font-serif` lists the five Heart-Note families (`Noto Serif Devanagari/Bengali/Hebrew/Tamil`, `Noto Naskh Arabic`).
- `--font-sans` lists the four UI families + `Noto Naskh Arabic`.

This is a string/structure assertion on the CSS source — it does not require the binaries and runs in CI. It guards against a future edit silently dropping `unicode-range` (which would blow the bundle budget) or `font-display: swap` (which would re-introduce FOIT).

### AC10 — `dir="auto"` component tests

Add render tests (`@testing-library/react`) asserting the `dir="auto"` attribute is present on each user-authored text node:
- `HeartNoteCard.test.tsx` (new): render with a Hebrew `body` → the body `<p>` has `dir="auto"`; render with an English `body` → still `dir="auto"` (attribute is unconditional; the browser infers direction).
- `StationeryCard.test.tsx` (new or extend): the Heart Note `<textarea>` has `dir="auto"`.
- `HeartNoteComposer.test.tsx` (new or extend): the active composing `<textarea>` has `dir="auto"`.
- `lunch-link.tsx` child-request textarea: extend the existing Lunch Link test coverage (or add a focused test) asserting `#child-request-input` has `dir="auto"`.

> **Honest test boundary — read this before writing assertions.** jsdom has **no font rendering and no bidi engine**. You **cannot** unit-test "no tofu" or "renders RTL visually." The testable contracts are exactly: (a) the woff2 files exist (AC8), (b) the `@font-face`/`unicode-range`/`font-display`/chain CSS is correct (AC9), (c) `dir="auto"` is on the text nodes (AC10). **Do not write a fake assertion that claims to verify glyph rendering.** Actual no-tofu + RTL-flow verification is the manual demo path (and the optional Playwright check in T6).

### AC11 — Demo specimen (dev-only, optional but recommended)

Extend `apps/web/src/routes/_dev-tokens.tsx` Typography section with a small multilingual specimen block so the slice is demoable without composing real Heart Notes through the full stack: render the five sample strings (below) in `font-serif`, each wrapped with `dir="auto"`, so a reviewer can eyeball glyph correctness + RTL flow on `/_dev-tokens`. This is a `_dev-*` route (not user-facing); keep it minimal.

### AC12 — Typecheck + existing tests unaffected

`pnpm typecheck` — no new errors (API + web at pre-existing baselines). All existing Lunch Link, Heart Note, design-system, and contracts tests pass. Web suite (378+) stays green. No contract/types/API changes in this slice — it is web + design-system only.

---

## Sample Strings (use these verbatim in the demo + manual test)

| Script | String | Meaning | Direction |
|---|---|---|---|
| Devanagari (Hindi) | `आज स्कूल में मज़ा करना` | "Have fun at school today" | LTR |
| Bengali | `আজ স্কুলে মজা করো` | "Have fun at school today" | LTR |
| Tamil | `இன்று பள்ளியில் மகிழுங்கள்` | "Be happy at school today" | LTR |
| Hebrew | `תהנה היום בבית הספר` | "Enjoy school today" | **RTL** |
| Arabic | `استمتع في المدرسة اليوم` | "Enjoy school today" | **RTL** |

---

## Demo Path

1. **Self-host verification:** confirm the nine `Noto*.woff2` files are in `apps/web/public/fonts/`. `pnpm --filter @hivekitchen/design-system test` → font-existence + CSS-guardrail tests pass.
2. **Devanagari renders (no tofu):**
   - Compose a Heart Note as a parent: `/app/heart-note` → type `आज स्कूल में मज़ा करना` → it renders in Noto Serif Devanagari inside the StationeryCard (not tofu, not Georgia-fallback boxes).
   - Generate the Lunch Link → open `/lunch/{token}` on a device → the `HeartNoteCard` shows the Devanagari note correctly.
3. **Hebrew RTL flows:**
   - Compose `תהנה היום בבית הספר` → the composer textarea flips RTL (caret on the right, text right-aligned) the moment the first Hebrew char is typed.
   - Open the child link → the Heart Note renders RTL.
4. **Arabic RTL flows:** repeat with `استمتع في المدرسة اليوم` → Noto Naskh Arabic, RTL.
5. **Tamil + Bengali:** repeat → correct glyphs, LTR.
6. **Lazy-load proof (DevTools → Network → Font):** on an English-only Heart Note page, **none** of the Noto woff2 download. On the Hindi page, **only** `NotoSerifDevanagari.woff2` downloads. This is the `unicode-range` "load only the needed subset" requirement, observable.
7. **Quick specimen:** `/_dev-tokens` shows all five sample strings rendering correctly with RTL flow on the two RTL rows.

---

## Critical Guardrails

**The Heart Note is rendered VERBATIM — the font adapts, never the text.** Sacred-channel doctrine: user-authored content in child-data paths is never modified by AI. This slice changes only *which typeface* draws the glyphs and *which direction* they flow. Never translate, transliterate, romanize, normalize, or "clean up" the text. No `lang`-attribute-driven machine translation. No Lumi/LLM in the render path.

**`unicode-range` is mandatory on every Noto `@font-face`.** Without it, all nine fonts download on every page load and blow UX-DR61 (≤200KB aggregate font weight, ≤300KB initial JS). With it, only the script present on a page loads. The CSS guardrail test (AC9) enforces this.

**`font-display: swap` is mandatory** — FOUT acceptable, FOIT banned (DESIGN.md §13.7). A non-Latin Heart Note must show *something* legible during font load, never invisible text.

**Do NOT add the multilingual fonts to the shared `expectedFonts` array** in `fonts.test.ts` — that would force `apps/marketing` to carry Heart-Note fonts it never renders. Web-only assertion (AC8).

**Do NOT refactor layout to logical properties in this slice.** DESIGN.md §13.7 / UX-DR59 / UX-DR63 call for `margin-inline-start`-style logical properties and a full RTL layout sweep — that is **Phase 2** and a separate slice. Here, RTL = `dir="auto"` on the **content text nodes** so the *content* bidi-flows correctly. Do not flip the page chrome, do not rename `text-right`→`text-end` across components, do not add a global `dir` on `<html>`. Surgical: only the user-authored text nodes named in AC4–AC7.

**No Tailwind config / token-preset change.** Resist the urge to "register" the Noto families in `index.ts`. The CSS-var indirection means the `font-serif`/`font-sans` utilities already pick them up.

**No new npm dependencies.** Self-host committed woff2 binaries (the existing pattern). Do not add `@fontsource/*` packages.

**`dir="auto"`, not `dir="rtl"`.** Hardcoding `rtl` would break the common case of an English Heart Note and the mixed-script case (a Hebrew note with an English name). `auto` infers per-node from the first strong directional character — correct for all five scripts + English + mixed.

---

## What Already Exists (Do Not Recreate)

- **`packages/design-system/tokens/typography.css`** — the real home of `@font-face` + `--font-serif`/`--font-sans`. (The epic AC says "tokens.css"; that file does not exist. This is the file.) Copy the shape of the existing Instrument Serif / Public Sans blocks exactly.
- **`apps/web/public/fonts/`** — committed-woff2 self-host location (Instrument Serif + Public Sans live here). Mirror in `apps/marketing/public/fonts/` is **not** needed for the multilingual fonts (marketing renders no Heart Notes).
- **`packages/design-system/src/tokens/index.ts`** — `tokenPresets.extend.fontFamily.serif/sans → var(--font-serif/sans)`. **Read-only for this slice** — no change.
- **`HeartNoteCard.tsx`** (`apps/web/src/features/lunch-link/components/`) — the child-surface Heart Note render (`<p>` body + `<span>` from). AC4.
- **`StationeryCard.tsx`** (`apps/web/src/features/heart-note/components/`) — the parent composer textarea. AC5.
- **`HeartNoteComposer.tsx`** (`apps/web/src/features/grandparent/`) — the grandparent composer (active + read-only textareas). AC6.
- **`lunch-link.tsx`** (`apps/web/src/routes/(app)/`) — the child Lunch Link route; renders `<HeartNoteCard>` + the 4-S15 child-request textarea. AC7.
- **`fonts.test.ts`** (`packages/design-system/src/tokens/`) — existing font-existence test; `expectedFonts` array + `it.skipIf(!!process.env.CI)` pattern. AC8.
- **`_dev-tokens.tsx`** (`apps/web/src/routes/`) — dev-only token/typography specimen page. AC11.
- **DESIGN.md §13.7** + **ux-design-specification.md "Script coverage"** — the canonical per-script serif/sans stack + Arabic→Naskh decision + FOUT-over-FOIT. The authority.

---

## Tasks

### T1 — Acquire + self-host the nine Noto woff2 subsets (AC1)

**T1.1** For each family, fetch the Google Fonts `css2` stylesheet with a modern browser `User-Agent` (so Google returns `woff2`, not `ttf`). Example (Heart Note serif families):
```
https://fonts.googleapis.com/css2?family=Noto+Serif+Devanagari&display=swap
https://fonts.googleapis.com/css2?family=Noto+Serif+Bengali&display=swap
https://fonts.googleapis.com/css2?family=Noto+Serif+Hebrew&display=swap
https://fonts.googleapis.com/css2?family=Noto+Serif+Tamil&display=swap
https://fonts.googleapis.com/css2?family=Noto+Naskh+Arabic&display=swap
https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari&display=swap
https://fonts.googleapis.com/css2?family=Noto+Sans+Bengali&display=swap
https://fonts.googleapis.com/css2?family=Noto+Sans+Hebrew&display=swap
https://fonts.googleapis.com/css2?family=Noto+Sans+Tamil&display=swap
```
The response contains one or more `@font-face` blocks with `src: url(...woff2)` and a `unicode-range`. For these scripts there is typically a single script-subset block (unlike Latin, which Google splits). Download the woff2 from the block whose `unicode-range` matches the script and save it to `apps/web/public/fonts/<File>.woff2` per the AC1 names. **Record the exact `unicode-range` string** from each block — it goes into AC2 verbatim.

**T1.2** Provide a reproducible fetch script at `scripts/fetch-multilingual-fonts.mjs` (Node, ESM, `import.meta.url`-safe per project ESM rules) so the download is repeatable and reviewable, rather than an opaque binary drop. The script: iterate the family list → fetch css2 (browser UA) → parse out woff2 URL + unicode-range → download woff2 to `apps/web/public/fonts/` → emit the `@font-face` + `unicode-range` snippets to stdout for pasting into `typography.css`.

> If the environment has no outbound network: land the script + all CSS/component/test changes, commit them, and flag "run `node scripts/fetch-multilingual-fonts.mjs` + commit the woff2" as a **user-side gate** in the Dev Agent Record.

### T2 — `@font-face` + fallback chains (AC2, AC3)

**T2.1** Add the nine `@font-face` blocks to `packages/design-system/tokens/typography.css` (verbatim `unicode-range` from T1, `font-display: swap`, `src` pointing at the AC1 filenames).

**T2.2** Extend `--font-serif` and `--font-sans` in the same file's `:root` per AC3 (Noto families after the primary, before the generic fallback).

### T3 — `dir="auto"` on user-authored text nodes (AC4–AC7)

**T3.1** `HeartNoteCard.tsx` — `dir="auto"` on the body `<p>` and the `from` `<span>`.
**T3.2** `StationeryCard.tsx` — `dir="auto"` on the Heart Note `<textarea>`.
**T3.3** `HeartNoteComposer.tsx` — `dir="auto"` on the active + read-only `<textarea>`s.
**T3.4** `lunch-link.tsx` — `dir="auto"` on `#child-request-input`.

### T4 — Tests (AC8, AC9, AC10)

**T4.1** Extend `fonts.test.ts` with a web-only `describe` asserting the nine woff2 exist (AC8) — separate from `expectedFonts`, same `skipIf(CI)` guard.
**T4.2** Add `multilingual-fonts.test.ts` (or extend `fonts.test.ts`) with the CSS-source guardrail assertions (AC9) — runs in CI, no binaries needed.
**T4.3** Add the `dir="auto"` component render tests (AC10) — `HeartNoteCard.test.tsx`, `StationeryCard.test.tsx`, `HeartNoteComposer.test.tsx`, and a lunch-link child-request assertion. Honor the jsdom test-boundary note in AC10 — assert the attribute, not glyph rendering.

### T5 — Demo specimen (AC11)

**T5.1** Extend `_dev-tokens.tsx` Typography section with the five sample strings in `font-serif`, each `dir="auto"`.

### T6 — Verification (AC12)

**T6.1** `pnpm typecheck` — no new errors (web + API at baseline).
**T6.2** `pnpm --filter @hivekitchen/design-system test` — font-existence + CSS-guardrail tests pass.
**T6.3** `pnpm --filter @hivekitchen/web test` — all web tests pass (378+ green), including the new `dir="auto"` tests.
**T6.4** *(Optional, strongest gate)* Add/extend a Playwright spec (alongside `apps/web/test/e2e/4-s2-lunch-link.spec.ts`) that loads a Hindi + a Hebrew Heart Note and asserts `getComputedStyle(node).fontFamily` resolves to a Noto family and `getComputedStyle(node).direction === 'rtl'` for Hebrew. This is the only environment that can verify font resolution + bidi for real. Mark as e2e/manual if Playwright isn't wired for this route.
**T6.5** Manual demo path (above) — requires the real woff2 present + a running stack. **USER-SIDE GATE** if fonts were downloaded via the user-side gate in T1.

---

## Project Structure Notes

**New files:**
- `apps/web/public/fonts/NotoSerifDevanagari.woff2`
- `apps/web/public/fonts/NotoSerifBengali.woff2`
- `apps/web/public/fonts/NotoSerifHebrew.woff2`
- `apps/web/public/fonts/NotoSerifTamil.woff2`
- `apps/web/public/fonts/NotoNaskhArabic.woff2`
- `apps/web/public/fonts/NotoSansDevanagari.woff2`
- `apps/web/public/fonts/NotoSansBengali.woff2`
- `apps/web/public/fonts/NotoSansHebrew.woff2`
- `apps/web/public/fonts/NotoSansTamil.woff2`
- `scripts/fetch-multilingual-fonts.mjs`
- `packages/design-system/src/tokens/multilingual-fonts.test.ts` *(or fold into `fonts.test.ts`)*
- `apps/web/src/features/lunch-link/components/HeartNoteCard.test.tsx`
- `apps/web/src/features/heart-note/components/StationeryCard.test.tsx` *(if absent)*
- `apps/web/src/features/grandparent/HeartNoteComposer.test.tsx` *(if absent)*

**Modified files:**
- `packages/design-system/tokens/typography.css` — 9 `@font-face` blocks + 2 extended chains
- `packages/design-system/src/tokens/fonts.test.ts` — web-only existence assertions
- `apps/web/src/features/lunch-link/components/HeartNoteCard.tsx` — `dir="auto"`
- `apps/web/src/features/heart-note/components/StationeryCard.tsx` — `dir="auto"`
- `apps/web/src/features/grandparent/HeartNoteComposer.tsx` — `dir="auto"` ×2
- `apps/web/src/routes/(app)/lunch-link.tsx` — `dir="auto"` on `#child-request-input`
- `apps/web/src/routes/_dev-tokens.tsx` — multilingual specimen

**Not modified:**
- `packages/design-system/src/tokens/index.ts` — Tailwind preset already maps to the CSS vars
- `apps/marketing/**` — marketing renders no Heart Notes; multilingual fonts not added there
- `packages/contracts/**`, `packages/types/**`, `apps/api/**` — no wire/server change in this slice
- `apps/web/tailwind.config.ts` — no change (consumes `tokenPresets`)

---

## Task Completion Checklist

- [x] T1.1 — Nine Noto woff2 subsets downloaded into `apps/web/public/fonts/` (committed in-session — sandbox had outbound network)
- [x] T1.2 — `scripts/fetch-multilingual-fonts.mjs` reproducible fetch script committed
- [x] T2.1 — Nine `@font-face` blocks in `typography.css` (verbatim `unicode-range` + `font-display: swap`)
- [x] T2.2 — `--font-serif` + `--font-sans` chains extended with the Noto families
- [x] T3.1 — `HeartNoteCard` body `<p>` + `from` `<span>` carry `dir="auto"`
- [x] T3.2 — `StationeryCard` Heart Note textarea carries `dir="auto"`
- [x] T3.3 — `HeartNoteComposer` active + read-only textareas carry `dir="auto"`
- [x] T3.4 — `lunch-link.tsx` `#child-request-input` carries `dir="auto"`
- [x] T4.1 — Web-only font-existence test (separate from `expectedFonts`)
- [x] T4.2 — CSS-source guardrail test (`@font-face`/`unicode-range`/`font-display`/chains)
- [x] T4.3 — `dir="auto"` component render tests (honor jsdom boundary — attribute only)
- [x] T5.1 — `_dev-tokens` multilingual specimen with the five sample strings
- [x] T6.1 — Typecheck: no new errors (web at pre-existing 3-error baseline; design-system clean)
- [x] T6.2 — design-system test suite green (103/103)
- [x] T6.3 — Web suite green (385, +7 new)
- [ ] T6.4 — (optional) Playwright font-resolution + RTL-direction assertion — DEFERRED to manual demo gate (jsdom cannot verify glyph resolution/bidi; this is the optional "strongest gate", not an AC)
- [ ] T6.5 — Manual demo path (no tofu, RTL flow, lazy-load proof) — **USER-SIDE GATE** (live stack). Font binaries were committed in-session, so the font-download gate does NOT apply.

---

## Dev Agent Record

### Implementation Plan

1. **T1 — fetch fonts** → `scripts/fetch-multilingual-fonts.mjs` (Node ESM, browser UA) hits the Google Fonts css2 API per family, parses the `/* <subset> */ @font-face { … }` blocks, selects the script-subset block (not latin/latin-ext), downloads its woff2 to `apps/web/public/fonts/`, and prints the `@font-face` snippet + verbatim `unicode-range`. Verify: 9 files present.
2. **T2 — CSS** → paste the 9 blocks + verbatim `unicode-range` into `typography.css`; extend `--font-serif`/`--font-sans`. Verify: AC9 CSS-guardrail test.
3. **T3 — `dir="auto"`** → 5 user-authored text nodes across 4 files. Verify: AC10 render tests.
4. **T4 — tests** → web-only font existence (separate from `expectedFonts`), CSS guardrail, `dir="auto"` component tests. Verify: suites green.
5. **T5 — specimen** → `_dev-tokens` rows. Verify: typecheck + visual.
6. **T6 — gates** → typecheck, design-system + web suites.

### Completion Notes

**Scope chosen:** Full serif+sans (9 files) — the DESIGN.md-faithful recommended scope baked into the ACs. Open Question (serif-only trim) was non-blocking; took the recommended default.

**Font binaries committed in-session.** The sandbox had outbound network, so `node scripts/fetch-multilingual-fonts.mjs` downloaded all 9 woff2 directly — the "font-download user-side gate" from T1/AC1 does NOT apply. Sizes: NotoSerifDevanagari 49.8KB, NotoSerifBengali 57.3KB, NotoSerifHebrew 7.6KB, NotoSerifTamil 14.1KB, NotoNaskhArabic 51.4KB, NotoSansDevanagari 49.2KB, NotoSansBengali 43.3KB, NotoSansHebrew 6.9KB, NotoSansTamil 14.2KB (~294KB aggregate, but `unicode-range` keeps per-page load to ~1 script subset — UX-DR61 honored).

**Verbatim `unicode-range` (pulled from Google css2, copied into `typography.css`):**
- Noto Serif/Sans Devanagari: `U+0900-097F, U+1CD0-1CF9, U+200C-200D, U+20A8, U+20B9, U+20F0, U+25CC, U+A830-A839, U+A8E0-A8FF, U+11B00-11B09`
- Noto Serif/Sans Bengali: `U+0951-0952, U+0964-0965, U+0980-09FE, U+1CD0, U+1CD2, U+1CD5-1CD6, U+1CD8, U+1CE1, U+1CEA, U+1CED, U+1CF2, U+1CF5-1CF7, U+200C-200D, U+20B9, U+25CC, U+A8F1`
- Noto Serif/Sans Hebrew: `U+0307-0308, U+0590-05FF, U+200C-2010, U+20AA, U+25CC, U+FB1D-FB4F`
- Noto Serif/Sans Tamil: `U+0964-0965, U+0B82-0BFA, U+200C-200D, U+20B9, U+25CC`
- Noto Naskh Arabic: full Arabic + presentation-forms + math-alphanumeric range (see `typography.css`)

**Spec↔codebase reconciliations:**
1. **Google splits each family into latin/latin-ext/<script> subsets** even for non-Latin families. The fetch script selects ONLY the script-subset block (by its `/* <subset> */` comment) — the latin blocks are already covered by Instrument Serif / Public Sans, so pulling them would be redundant weight.
2. **`font-weight: 400` for all nine** (not the variable `100 900` Public Sans uses). The story permits either; a single 400 face is sufficient for the Heart Note register and for non-Latin name fallback (synthetic bold is acceptable per the story). Keeps it 9 simple files.
3. **`_dev-tokens` specimen — label moved OUTSIDE the `dir="auto"` node.** A `dir="auto"` paragraph infers direction from its *first strong character*; a Latin "Hebrew (RTL):" label prefix would force the whole row LTR and defeat the RTL demo. Each specimen string now sits in its own `<p dir="auto">` with the script label in a sibling `<span>`.
4. **No existing `lunch-link.tsx` route test** — added a focused `lunch-link.test.tsx` (mocks `@/lib/fetch.js` `publicGet`, mounts the route with a valid HMAC token) asserting `#child-request-input` has `dir="auto"`, per AC10's "add a focused test" allowance.

**Honest test boundary (AC10):** jsdom has no font engine / bidi engine. The committed tests assert exactly the testable contracts — woff2 existence (AC8), CSS `@font-face`/`unicode-range`/`font-display: swap`/chain structure (AC9), and `dir="auto"` presence on the text nodes (AC10). No test claims to verify glyph rendering or visual RTL — that is the manual demo / optional Playwright gate (T6.4/T6.5).

**Verification results:**
- Typecheck: web at pre-existing 3-error baseline (`child-bag-composition.tsx` ×2 + `contracts/heart-notes.ts` Zod-4 issue — all in untouched files); **0 new errors**. design-system typechecks clean. (Full `pnpm typecheck` via turbo halts on the same pre-existing `contracts/heart-notes.ts` error surfaced through `@hivekitchen/types` — baseline.)
- `pnpm --filter @hivekitchen/design-system test` → 103/103 (incl. new font-existence + CSS guardrail).
- `pnpm --filter @hivekitchen/web test` → 385/385 (378 baseline + 7 new).

**No API/contract/types/agent/DB changes** — web + design-system only, as the story anticipated.

### File List

**New:**
- `scripts/fetch-multilingual-fonts.mjs`
- `apps/web/public/fonts/NotoSerifDevanagari.woff2`
- `apps/web/public/fonts/NotoSerifBengali.woff2`
- `apps/web/public/fonts/NotoSerifHebrew.woff2`
- `apps/web/public/fonts/NotoSerifTamil.woff2`
- `apps/web/public/fonts/NotoNaskhArabic.woff2`
- `apps/web/public/fonts/NotoSansDevanagari.woff2`
- `apps/web/public/fonts/NotoSansBengali.woff2`
- `apps/web/public/fonts/NotoSansHebrew.woff2`
- `apps/web/public/fonts/NotoSansTamil.woff2`
- `packages/design-system/src/tokens/multilingual-fonts.test.ts`
- `apps/web/src/features/lunch-link/components/HeartNoteCard.test.tsx`
- `apps/web/src/features/heart-note/components/StationeryCard.test.tsx`
- `apps/web/src/features/grandparent/HeartNoteComposer.test.tsx`
- `apps/web/src/routes/(app)/lunch-link.test.tsx`

**Modified:**
- `packages/design-system/tokens/typography.css` — 9 `@font-face` blocks + 2 extended chains
- `packages/design-system/src/tokens/fonts.test.ts` — web-only multilingual existence assertion
- `apps/web/src/features/lunch-link/components/HeartNoteCard.tsx` — `dir="auto"` ×2
- `apps/web/src/features/heart-note/components/StationeryCard.tsx` — `dir="auto"`
- `apps/web/src/features/grandparent/HeartNoteComposer.tsx` — `dir="auto"` ×2
- `apps/web/src/routes/(app)/lunch-link.tsx` — `dir="auto"` on `#child-request-input`
- `apps/web/src/routes/_dev-tokens.tsx` — multilingual specimen
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — status tracking

---

## References

- [Source: `_bmad-output/planning-artifacts/epic-4-vertical-slices.md` §Slice 4-S16] — demo path, layer fan-out
- [Source: `_bmad-output/planning-artifacts/epics.md` §Story 4.16] — AC: self-hosted `noto-*` woff2 with `unicode-range`; `dir="auto"` on `<LunchLinkPage>`/`<HeartNoteComposer>`
- [Source: `_bmad-output/planning-artifacts/epics.md` §AR-20] — multilingual font fallback architectural surface
- [Source: `_bmad-output/planning-artifacts/epics.md` §NFR-A11Y-6] — multilingual content rendering in Heart Notes regardless of UI locale (content-layer, not UI-i18n)
- [Source: `docs/DESIGN.md` §13.7 Internationalization & RTL] — Phase 1 = Unicode-safe + `dir="auto"` on user-authored nodes; per-script serif/sans stack; Arabic→Noto Naskh; FOUT-over-FOIT; Phase 2 = full RTL UI
- [Source: `_bmad-output/planning-artifacts/ux-design-specification.md` §"Script coverage"] — explicit per-script fallback table; "Heart Note = editorial-serif register preserved across scripts; literal typeface adapts"
- [Source: `_bmad-output/planning-artifacts/ux-design-specification.md` §UX-DR2/UX-DR20] — multilingual font-fallback strategy; Heart Note display register
- [Source: `_bmad-output/planning-artifacts/epics.md` §UX-DR59/UX-DR61/UX-DR63] — RTL-safe primitives + font-weight budget (≤200KB) + logical-property lint (Phase 2)
- [Source: `packages/design-system/tokens/typography.css`] — existing `@font-face` + `--font-serif`/`--font-sans` (the file the epic calls "tokens.css")
- [Source: `packages/design-system/src/tokens/fonts.test.ts`] — existing font-existence test pattern
- [Source: MDN — CSS `@font-face` `unicode-range`] — per-codepoint lazy subset loading + multi-script fallback resolution

---

## Previous Story Intelligence (from 4-S15, 4-S13, 4-S12)

1. **`@font-face` + font CSS vars live in `packages/design-system/tokens/typography.css`** — NOT a `tokens.css`. The epic/slice wording is stale; the file the dev edits is `typography.css`. (Verified against current code 2026-06-03.)
2. **Body font is Public Sans, headline/Heart-Note font is Instrument Serif** — NOT Inter. Instrument Serif is Latin-only by `unicode-range`; that is exactly why non-Latin Heart Notes tofu today.
3. **Design tokens are named Tailwind utilities** (`font-serif`, `font-sans`, `text-fg`, `bg-surface`) mapping to CSS vars — never bracket syntax. The font-stack change is CSS-var-only; no Tailwind config edit. (4-S15 intelligence #3.)
4. **Router is react-router-dom; the Lunch Link param is `linkId`** (4-S15 #1). Child Lunch Link page is `apps/web/src/routes/(app)/lunch-link.tsx`; it renders `<HeartNoteCard>` and the 4-S15 child-request textarea.
5. **`publicGet`/`publicPost`** (in `apps/web/src/lib/fetch.ts`) are the unauthenticated helpers used by the child surface — relevant only as context (no API change this slice).
6. **The marketing app shares `typography.css`** (`apps/marketing/src/styles/globals.css` imports it) but renders no Heart Notes — so the multilingual woff2 go to `apps/web/public/fonts/` only, and the font-existence test must stay web-scoped for them.
7. **This slice has NO API/contract/agent/DB layer** — unusual for Epic 4. It is web + design-system only. Don't scaffold a module/repository/route out of habit.

---

## Open Question for Menon (non-blocking — story ships as written)

**Serif+Sans coverage vs serif-only.** The ACs above bake in the DESIGN.md-faithful **full** scope: Noto **Serif** per script on `--font-serif` (the Heart Note register — strictly required by AR-20/NFR-A11Y-6) **plus** Noto **Sans** per script on `--font-sans` (covers a non-Latin child name appearing in UI nodes like the rating salutation — DESIGN.md name-handling rule). That is nine woff2 files; `unicode-range` keeps per-page load to ~one script, so the runtime cost is unchanged, but it's nine committed binaries vs five.

If you'd prefer to trim to **serif-only** (five files: the four Noto Serif + Noto Naskh Arabic, `--font-serif` only) and defer non-Latin UI-text coverage to the Phase-2 i18n sweep, say so and I'll cut AC2/AC3/AC8's four `Noto Sans*` entries. Recommendation: **keep full coverage** — the marginal cost is four lazy-loaded files and it closes the child-name-tofu gap the sacred channel cares about.

---

## Change Log

| Date | Change |
|------|--------|
| 2026-06-03 | Story 4-S16 created — multilingual fonts + RTL for the Heart Note sacred channel. Reconciled the epic's `tokens.css`/`noto-sans` wording against the real `packages/design-system/tokens/typography.css` + DESIGN.md §13.7 per-script **serif** register (Arabic→Noto Naskh). Scoped to web + design-system only (no API/contract layer). Status: ready-for-dev. |
| 2026-06-03 | Implemented (dev-story). Full serif+sans scope (9 Noto woff2, committed in-session via `scripts/fetch-multilingual-fonts.mjs` — sandbox had network, so no font-download gate). 9 `@font-face` blocks with verbatim Google `unicode-range` + `font-display: swap` and extended `--font-serif`/`--font-sans` chains in `typography.css`. `dir="auto"` on 5 user-authored text nodes (HeartNoteCard body+from, StationeryCard textarea, HeartNoteComposer active+readonly textareas, lunch-link `#child-request-input`). Tests: web-only font-existence, CSS-source guardrail (`multilingual-fonts.test.ts`), `dir="auto"` component tests (4 files). `_dev-tokens` specimen. Verification: 0 new typecheck errors (web at 3-error baseline; design-system clean); design-system 103/103; web 385/385 (+7). Remaining gate: T6.5 manual demo (live stack) + optional T6.4 Playwright. Status: review. |
