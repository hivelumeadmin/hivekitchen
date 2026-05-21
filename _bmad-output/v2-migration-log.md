# v1 → v2.0 Migration Log

**Status:** Engineering complete (γ Phases 1–6, May 2026). Production routes now
render against the v2.0 design system. This log is the source of truth for
the v1→v2.0 deltas that supersede earlier story narratives.

When a `done` story file describes a v1 component, token, or layout that is no
longer in the codebase, consult this log instead of editing the story —
stories are historical records of original implementation; this log records
what changed after.

---

## Scope of the γ migration

| Phase | Surface | Commit context |
|---|---|---|
| 1 | `/auth/login` | New v2.0 composition (AppHeader + LoginHero + form + AppFooter); preserved all v1 auth wiring (useForm, useAuthStore, OAuth, redirect logic) |
| 2 | `/onboarding` | 6-mode state machine preserved; `select` mode rebuilt with OnboardingHero/MediaSection/OnboardingActions/PreviewTiles |
| 3a | `/app` (Brief) | BriefCanvas re-layout: `max-w-7xl flex-grow px-6 pt-12 pb-24`; PageHeader replaces MomentHeadline + LumiNote |
| 3b | Plan-feature components | QuietDiff, AllergyClearedBadge popover, FreshnessState retoked to v2.0 semantic aliases |
| 3c | `/app/plan` | PlanPage shell migrated; PageHeader added; tab pills retoked |
| 3d | `/app/plan/:weekId` | PlanHistoryPage shell migrated; "Week of …" promoted to PageHeader |
| 4 | Six net-new routes | `/app/day/:day`, `/app/heart-note`, `/app/evening-checkin`, `/app/grocery-list`, `/app/inspiration`, `/lunch/:linkId` — all mock-data backed until per-epic data wiring ships |
| 5 | `/account` + child mgmt | Account page wrapped with PageHeader; child route wrappers given v2.0 shell |
| 6 | Cruft delete | `features/plan/MomentHeadline.{tsx,test.tsx}` + `features/plan/LumiNote.{tsx,test.tsx}` removed |

---

## Component replacements

| v1 component (now removed/superseded) | v2.0 replacement | Used in |
|---|---|---|
| `MomentHeadline` | `PageHeader` (`headlineSize="lg"`, eyebrow="This week's brief") | BriefCanvas, PlanPage, PlanHistoryPage, AccountPage, DayDetail, HeartNote |
| `LumiNote` | `PageHeader`'s `description` prop | BriefCanvas |
| bespoke `<header><h1>` blocks | `PageHeader` primitive | All production routes |
| custom v1 buttons | `PrimaryButton` / `SecondaryButton` primitives (icon-left required, per `docs/DESIGN.md` §7) | Sticky bars, page CTAs |
| custom sticky bottom CTAs | `StickyBottomBar` + button primitives | HeartNoteActions, MessageComposer, BottomActionBar |
| route-owned AppHeader/AppFooter (in `_dev-*` pages) | AppLayout owns the chrome for `/app/*` and `/lunch/*` | All production routes |

**Components retained from v1 (still authoritative):**
- `TrustChip` — used by PlanTile + CulturalRatificationCard
- `AllergyClearedBadge` — content unchanged, popover panel retoked to v2.0 surface/border tokens
- `QuietDiff` — content unchanged, retoked
- `FreshnessState` — content unchanged, retoked
- `PlanTile` — content unchanged, retoked (`bg-honey-amber-100/border-honey-amber-400` → `bg-amber-warm/10 border-amber-warm`; dish name `font-sans text-[19px]` → `font-serif text-2xl`)
- `LumiOrb` / `LumiPanel` — unchanged (ambient surface, AppLayout-injected)

---

## Token migration

The v2.0 design system added semantic aliases on top of the channel scales.
Production code prefers aliases. Old direct stops in story snippets remain
valid CSS (the underlying scale variables still exist) but are stylistically
deprecated.

| v1 token (deprecated in code) | v2.0 alias | Use |
|---|---|---|
| `text-stone-{600,700,800}` | `text-fg`, `text-fg-muted` | Body / muted text |
| `text-stone-{400,500}` | `text-fg-muted` | Tertiary text |
| `text-warm-neutral-700` | `text-fg-muted` | Body text |
| `text-warm-neutral-900` | `text-fg` | Primary heading text |
| `bg-white` | `bg-surface` | Card / surface bg |
| `bg-warm-neutral-50` | `bg-bg` (page) or `bg-surface` (card) | Page vs surface |
| `border-stone-200` / `border-warm-neutral-{200,300}` | `border-border` | Default border |
| `bg-honey-amber-600 text-white` | `bg-amber-warm text-bg` (or `PrimaryButton`) | Primary CTA |
| `text-red-700` | `text-safety-red` | Error / alert copy |
| `bg-foliage-400` | `bg-foliage` (single-value v2.0 channel token) | Status dot |
| `border-lumi-terracotta-500` | `border-lumi-terracotta` | Channel border |

**Canonical convention (UX-DR1):** scale stops 50–200 = background-like, 700–900 = foreground-like, stable across light + dark themes. See `packages/design-system/tokens/colors.css` for hex values.

---

## Layout shell migration

The v1 `<main className="min-h-screen p-4 md:p-8 max-w-2xl mx-auto">` pattern
was replaced everywhere because AppLayout already provides the flex-column
shell with `min-h-screen`. The current v2.0 shell is:

```tsx
<main className="mx-auto w-full max-w-7xl flex-grow px-6 pt-12 pb-24">
  {/* page content */}
</main>
```

AppLayout owns: `min-h-screen flex-col bg-bg text-fg`, AppHeader, AppFooter,
LumiOrb/LumiPanel (suppressed on `/lunch/*` via `useMatch`). Inner pages
render their own `<main>`, sticky bottom bars (position:fixed), and PageHeader.

---

## Where to look for current truth

| Concern | Authoritative source |
|---|---|
| Production component shape | `apps/web/src/features/**/<Component>.tsx` |
| Production route composition | `apps/web/src/routes/(app)/<route>.tsx` |
| v2.0 design rules | `docs/DESIGN.md` (§7 for production patterns) |
| Token values | `packages/design-system/tokens/colors.css`, `radius.css`, `typography.css` |
| Tailwind preset bindings | `packages/design-system/src/tokens/index.ts` |
| Test coverage of token migration | `apps/web/src/features/plan/*.test.tsx` |
| Engineering history | `git log --oneline` between `218990f` (epic 3 stories 3-8 → 3-13) and HEAD |

---

## Deleted files

```
apps/web/src/features/plan/MomentHeadline.tsx
apps/web/src/features/plan/MomentHeadline.test.tsx
apps/web/src/features/plan/LumiNote.tsx
apps/web/src/features/plan/LumiNote.test.tsx
```

Tests referencing these components by name in `it()` titles were renamed in
`BriefCanvas.test.tsx` (now reference "PageHeader") — assertion logic unchanged.

---

## Stories with v1 references (banner at top of file points back to this log)

- 2-4, 2-4b, 2-5 (account flows, retoked in γ Phase 5)
- 3-8, 3-9, 3-10, 3-11, 3-12 (Brief surface stack, retoked in γ Phase 3a–3b + Phase 6 deletions)
- 3-14, 3-15 (PlanPage / PlanHistoryPage, migrated in γ Phase 3c–3d)
- 3-19 (day-level overrides, partial)
- 12-6 (LumiOrb / LumiPanel in root layout — still accurate, but app-layout shell now v2.0)

Backend / service / contract stories (Epic 1 infrastructure, Epic 2 backend,
Epic 3 services 3-1 to 3-7 + 3-16 to 3-22, Epic 12 backend 12-1 to 12-5,
12-7) are **not affected** — their narratives describe what actually shipped.

---

## 2026-05-12 update — Tier 1 entry-page retoke (bundled with slice 2-S19)

Three remaining v1 entry-point pages migrated to v2.0 chrome:

| Route | Before | After |
|---|---|---|
| `/auth/reset-password` | `min-h-screen flex` shell, `warm-neutral-300/700`, `honey-amber-600 text-white` | `AppHeader` + `LoginHero` + `TextField` + `PrimaryButton` (mirrors login.tsx); expired-link state in same shell |
| `/auth/callback` | `text-warm-neutral-700` on "Signing you in…" | `bg-bg text-fg` + `text-fg-muted` |
| `/invite/$token` | same warm-neutral on 3 status messages | same retoke |

Stitch reference: derived from existing screen `8ac635e12e284a178f458ff235d7c585` ("Welcome Back — Shared Ritual Login") in project `7412488554086403296`. A dedicated reset-password Stitch screen was attempted via MCP but generation timed out — pivot to the existing login composition (which the codebase already implements) is functionally equivalent.

Still-pending Tier 2 (internal feature components rendered inside v2.0 chrome but with v1 internals):
- `features/onboarding/{OnboardingVoice,OnboardingText,OnboardingConsent,OnboardingMentalModel,CulturalRatificationStep,CulturalRatificationCard}.tsx`
- `features/children/{AddChildForm,BagCompositionForm,BagCompositionCard,ExtraRulesForm,SchoolPoliciesForm,ChildProfileCard}.tsx`
- `features/compliance/{ParentalNoticeView,ParentalNoticeContent,ParentalNoticeDialog}.tsx`
- Minor token remnants in `features/plan/*` components

These are functional in v2.0 chrome; their internal styling lags. Track as per-feature retoke slices if user pain surfaces.
