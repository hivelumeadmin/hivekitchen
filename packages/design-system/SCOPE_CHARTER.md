# SCOPE_CHARTER.md — Canonical UX Scope Spec

> The HiveKitchen frontend renders four UX surfaces, each with a **scope class** applied to `<html>`. Every component in the library is eligible for some scopes and forbidden in others. This charter is the canonical spec — diverge here, and both ESLint and the dev-mode runtime guard will catch it.

---

## 1. Purpose

Scope enforcement exists because HiveKitchen composes four very different surfaces onto one app bundle:

- **App** — the caregiver's primary surface. Full component inventory, writerly serif, warm neutrals.
- **Child** — the Lunch Link sacred channel. No nav chrome, no AI-authored text, no dialogs. A child-safe rendering.
- **Grandparent** — `/gift` and `/guest-author`. Larger type, single-column, no command palette.
- **Ops** — compliance/audit surface. Dense tables allowed, intentionally utilitarian.

Without enforcement, Shadcn or Radix primitives leak across surfaces and the whole thing turns into a SaaS dashboard. We defend against that at three independent layers.

---

## 2. The Four Scopes

### `.app-scope` — App (caregiver)

- **Route prefix:** `apps/web/src/routes/(app)/`
- **Component inventory:** Full — every component in `@hivekitchen/ui` is available.
- **Typography:** Editorial serif for display; refined sans for UI. 16px body minimum, 44px touch targets.
- **Voice register:** Full Lumi range — casual, warm, occasionally playful. Lumi speaks in first-person.
- **Forbidden:** Nothing (this is the default surface).

### `.child-scope` — Child (Lunch Link sacred channel)

- **Route prefix:** `apps/web/src/routes/(child)/`
- **Component inventory (allowed):** `HeartNote`, `FlavorPassport`, `LunchBagPreview`, `EmojiRater`.
- **Forbidden:** `Command`, `CommandDialog`, `CommandPalette`, `AlertDialog*`, `Toast`, `Toaster`, `NavigationMenu*`, `MobileNavAnchor`, `Sidebar*`, `Sheet*`, and any other nav or app-shell chrome.
- **Typography:** Same serif family, larger body (18px minimum), no system-font fallbacks.
- **Voice register:** No AI-generated text on the Heart Note path. Heart Notes are rendered verbatim from the parent author; Lumi does not paraphrase, summarize, or translate. Image-first, simple direct copy for non-Heart-Note UI.
- **Why so restrictive:** The Lunch Link is a sacred channel. Modals and nav would break the frame.

### `.grandparent-scope` — Grandparent (`/gift`, `/guest-author`)

- **Route prefix:** `apps/web/src/routes/(grandparent)/`
- **Component inventory:** Most of `@hivekitchen/ui`, except forbidden below.
- **Forbidden:** `Command`, `CommandDialog`, `CommandPalette`, `MobileNavAnchor`.
- **Typography:** 18pt body minimum, 56pt touch targets, higher contrast.
- **Voice register:** Warm, large-print-friendly, one instruction per screen. No compound tasks.
- **Why so restrictive:** Grandparent users skew older and non-primary. The flow is linear; a command palette is a wrong-frame affordance.

### `.ops-scope` — Ops (compliance, audit, incident response)

- **Route prefix:** `apps/web/src/routes/(ops)/`
- **Component inventory:** Full — intentionally utilitarian. Dense tables allowed.
- **Typography:** May break the presentational-silence rule — tight line height, smaller body, monospace for audit IDs.
- **Voice register:** Clinical, factual, audit-ready. No Lumi voice.
- **Forbidden:** Nothing by lint — but judgment still applies. Ops surfaces should not leak into marketing or caregiver flows.

---

## 3. Enforcement Mechanism — Three Layers

Scope leakage is caught at three independent layers, so a single bypass doesn't silently regress the invariant.

| Layer | Mechanism | Runs on |
|---|---|---|
| 1 | **Human review** — this charter is referenced in PR templates. | Code review |
| 2 | **Lint** — `@hivekitchen/eslint-config` custom rule `no-cross-scope-component` fails the build if a forbidden component is imported into the wrong route tree. `no-dialog-outside-allowlist` fails the build if Radix dialog primitives are used outside the four allowlisted feature directories. | `pnpm lint` / CI |
| 3 | **Runtime** — `useScopeGuard(expectedScope)` from `@hivekitchen/ui` throws in dev mode if the expected scope class is not present on `<html>` at mount. No-op in production. | `pnpm dev` in the browser |

All three layers exist because each catches a distinct class of bug:
- Human review catches architectural misjudgment.
- Lint catches copy-paste component leakage.
- Runtime catches the case where a component was moved between route trees and the static file scope no longer matches reality.

---

## 4. Scope Class Application

The scope class is applied to `<html>` in two places:

1. **Static default** — `apps/web/index.html` carries `<html class="app-scope">` so the class is present before React hydrates.
2. **Route layout shells** — each route group's `layout.tsx` (`(app)/layout.tsx`, `(child)/layout.tsx`, `(grandparent)/layout.tsx`, `(ops)/layout.tsx`) toggles its scope class via `document.documentElement.classList.add(...)` on mount and removes it on unmount. Routed surfaces get the correct class for their tree, regardless of how the user arrived.

Only one scope class should be present on `<html>` at a time. The layout shells are responsible for removing their class on unmount — the next tree's layout adds its own.

---

## 5. Adding a New Component

When adding a component to `@hivekitchen/ui`, answer these questions before merging:

1. **Which scopes is this component eligible for?** If the answer is "all four," no charter change is needed — but check whether it should be forbidden in `child-scope` (most modal/nav chrome should be).
2. **If it's scope-restricted** — update `packages/ui/src/scope-allowlist.config.ts` AND the sibling `packages/ui/src/scope-allowlist.eslint.js` (plain-JS twin — ESLint cannot consume the TS file). Add the component name to `forbiddenComponents` for each scope where it must not render.
3. **Update this charter** — the component inventory tables below. This is the canonical reference; lint is its enforcer, not its source of truth.
4. **For dialog/modal primitives** — if you intend to consume Radix's `Dialog`, `AlertDialog`, `Sheet`, or `Drawer`, the file must live inside one of the four allowlisted feature directories (`features/auth`, `features/safety`, `features/command-palette`, `features/memory`). If the use case falls outside those four, the answer is probably "don't use a dialog" — escalate.

---

## 6. Prohibited Items Index

| Component | App | Child | Grandparent | Ops |
|---|:-:|:-:|:-:|:-:|
| `Command`, `CommandDialog`, `CommandPalette` | ✓ | ✗ | ✗ | ✓ |
| `AlertDialog`, `AlertDialogContent`, `AlertDialogTrigger` | ✓ | ✗ | ✓ | ✓ |
| `Toast`, `Toaster` | ✓ | ✗ | ✓ | ✓ |
| `NavigationMenu`, `NavigationMenuList`, `NavigationMenuTrigger` | ✓ | ✗ | ✓ | ✓ |
| `MobileNavAnchor` | ✓ | ✗ | ✗ | ✓ |
| `Sidebar`, `SidebarProvider` | ✓ | ✗ | ✓ | ✓ |
| `Sheet`, `SheetContent` | ✓ | ✗ | ✓ | ✓ |
| `HeartNote`, `FlavorPassport`, `LunchBagPreview`, `EmojiRater` | ✓ | ✓ | ✓ (guest-author) | ✓ |

### Dialog primitive allowlist (file-path enforcement)

Radix `Dialog`, `AlertDialog`, `Sheet`, `Drawer` may only be imported in files under:

- `apps/web/src/features/auth/**` — auth re-entry dialogs
- `apps/web/src/features/safety/**` — safety-block explainers
- `apps/web/src/features/command-palette/**` — the command palette itself (gated out of child/grandparent scopes)
- `apps/web/src/features/memory/**` — hard-forget (Phase 2+ stub)

Any fifth location needs a charter change, not a one-off exemption.

---

## 7. Logical Properties — Not a Scope Rule, But Enforced Here

Because the scope charter defends the rendering frame, it also defends RTL/LTR correctness. The `logical-properties-only` lint rule forbids physical margin/padding properties across all scopes:

- Tailwind: `ml-*` → `ms-*`, `mr-*` → `me-*`, `pl-*` → `ps-*`, `pr-*` → `pe-*`
- CSS-in-JS: `marginLeft` → `marginInlineStart`, `marginRight` → `marginInlineEnd`, `paddingLeft` → `paddingInlineStart`, `paddingRight` → `paddingInlineEnd`

This rule has no scope override — there is no scope where physical properties are correct.

---

## 8. Further reading

- `packages/ui/src/scope-allowlist.config.ts` — source-of-truth TS allowlist.
- `packages/ui/src/scope-allowlist.eslint.js` — ESLint-consumable JS twin (keep in sync).
- `packages/ui/src/hooks/use-scope-guard.ts` — dev-mode runtime assertion.
- `packages/eslint-config-hivekitchen/src/rules/` — the three custom lint rules that enforce this charter.
- `_bmad-output/planning-artifacts/ux-design-specification.md` §"Implementation Approach" (Evolution 5) — UX spec origin.
