# Story 13.s11: Route collapse to 4 anchors — Brief · Kitchen · People · Lumi (WALL: topology)

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **🧱 WALL: topology.** Last slice of Epic 13, deliberately sequenced after every surface rebuild (s2–s10 all done). Done = the deep-link audit is clean (every current route accounted for in the disposition table below), navigable routes collapse to Brief · Kitchen · People · Lumi, the named non-anchor screens (day-detail, grocery, history, evening check-in; swap has no route) become summoned artifacts over the Brief, old routes redirect or render-in-place (never 404), the `(child)`/`(grandparent)`/`(ops)` scopes are untouched, and the 13-s1 a11y + E2E baseline stays green. This is a **frontend-only, zero-LLM** story — pure topology; no api, contracts, or migration changes.

## Story

As a parent,
I want a small, calm set of places instead of ~20 routes,
so that the app is low-fatigue to navigate — the things Lumi prepared come to me as summoned artifacts instead of tabs to hunt for.

## Acceptance Criteria

1. **Deep-link audit precedes the change.** The route-disposition table in Dev Notes is re-verified against the codebase at implementation time (grep every `Link to=`, `navigate(`, `<Navigate`, and `?next=` producer) and corrected if drift is found since story creation. Every route in `app.tsx` has exactly one disposition: anchor / artifact-over-anchor / kept-but-denavved / redirect / out-of-scope. No route is unaccounted; the verified table is recorded in the Dev Agent Record.
2. **Nav collapses to 4 anchors.** `AppSidebar` (desktop + mobile drawer) shows exactly four nav items: **Brief** → `/app`, **Kitchen** → `/app/kitchen-profile`, **People** → `/app/heart-notes`, **Lumi** → `/app/lumi`. The removed sidebar links (Grocery List, My Snacks, Memory, Settings, Account) do not reappear elsewhere in the sidebar; Settings (`/app/household/settings`) and Account (`/account`) move into the existing `AppHeader` user dropdown. Active-state (`NavLink isActive`) works for all four anchors, including nested artifact URLs under Brief (e.g. `/app/day/tue` highlights Brief).
3. **Lumi anchor — the thread, full-screen.** New route `/app/lumi` renders the existing sheet conversation (thread hydration via `hydrateThread`, turn submission to `/v1/lumi/turns`, text/voice toggle, captions, nudge opt-out — all current `LumiSheet` behavior) as a full-frame page on the `general` surface. The conversation body is extracted from `LumiSheet.tsx` into a shared component consumed by BOTH the sheet and the page — no forked second implementation. The presence dot is suppressed on `/app/lumi` (same `useMatch` idiom as the `/lunch/*` suppression in `AppLayout`); whispers elsewhere unchanged. This full-screen thread is the vision-sanctioned exception to "no persistent chat column" (vision §2c: "**Lumi** (the thread itself, full-screen)") — it never leaks into the other three anchors.
4. **Named non-anchor screens become summoned artifacts over the Brief.** `/app/day/:day` (day-detail), `/app/grocery-list`, `/app/evening-checkin`, and `/app/plan/:weekId` (history) render as the Brief anchor with an **artifact sheet** open — the URL is KEPT (deep-links land on Brief + open artifact; auth-guard `?next=` chains keep working unmodified), but the screens leave the nav. Closing the artifact (Escape / scrim / close affordance) navigates to `/app` and restores focus. The artifact host composes the existing `Dialog` primitive (focus-trap, Escape, scroll-lock, `prefers-reduced-motion`, focus-restore) — same a11y contract as `LumiSheet`. In-app entry points (e.g. Brief tile → day detail) open the artifact via navigation to the same URL, so there is ONE code path for deep-link and in-app summon.
5. **Redirects, not 404s.** `/app/plan` redirects (`<Navigate replace>`) to `/app` — it is a duplicate of the Brief plan surface (both render the s7 planner). A catch-all `/app/*` route redirects unknown app paths to `/app` instead of 404ing. If the redirect orphans `PlanRoute`/`PlanPage` (verify remaining references — plan-history may consume `PlanPage`), delete the orphaned files per the no-parallel-surfaces rule; if still referenced, keep and note it.
6. **Kept-but-denavved routes still work.** `/app/kitchen/snacks`, `/app/inspiration`, `/app/memory`, `/app/memory/dashboard`, `/app/memory/consent-history`, `/app/children/:childId/*` (all 4), `/app/heart-note`, `/account`, `/app/household/settings` remain URL-addressable full routes, reachable from within their anchor surface (Kitchen links to snacks/inspiration/memory/child screens; People links to heart-note compose; header menu to Account/Settings). Add an in-anchor link ONLY where none exists today; do not rebuild these screens.
7. **Scopes and pre-anchor surfaces preserved untouched.** `/lunch/:linkId` + `/lunch/:linkId/passport` (child), `/guest-author/compose` (grandparent-scope), `/onboarding`, `/auth/*`, `/invite/:token`, `/` root redirect, and the `_dev-*` preview branch are NOT modified. The unwired `(child)`/`(ops)` layout files stay as-is (known pre-existing deviation — do not wire them in passing). The parental-notice acknowledgment gate keeps covering the Brief anchor and therefore the artifacts rendered over it; `/app/plan/:weekId`'s own gate usage follows its host.
8. **Tests + gates.** Unit tests: sidebar renders exactly 4 anchors + active-state on nested URLs; artifact host opens per-URL and close-navigates to `/app`; `/app/plan` redirect. New e2e spec (isolated, 13-s1 locator style): deep-link `/app/grocery-list` → Brief renders with grocery artifact open + axe clean on the open artifact; `/app/plan` → lands on `/app`; sidebar shows the 4 anchors; `/app/lumi` renders the thread page with no presence dot. Existing spec suites that visit kept routes (2-7 onboarding, 4-s2 lunch-link, 4-s13 grandparent, 13-s10 talk-to-your-plan) and the full 13-s1 baseline stay green in isolation. `pnpm typecheck` + lint clean on the diff; no api changes (api suite untouched — 31 pre-existing failures must not grow).

## Tasks / Subtasks

- [x] Task 1: Deep-link audit verification (AC: 1) — do this FIRST, before touching the router
  - [x] Re-run the audit: grep `to=`, `navigate(`, `<Navigate`, `next=` across `apps/web/src`; diff against the disposition table in Dev Notes; correct drift
  - [x] Record the verified table in the Dev Agent Record (this IS the wall's audit artifact)
- [x] Task 2: Sidebar + header collapse (AC: 2)
  - [x] `AppSidebar.tsx`: 4 `NavLink`s (Brief `/app` `end`, Kitchen `/app/kitchen-profile`, People `/app/heart-notes`, Lumi `/app/lumi`); same treatment in the mobile drawer
  - [x] Brief active-state covers artifact URLs (`/app/day/*`, `/app/grocery-list`, `/app/evening-checkin`, `/app/plan/:weekId`) — custom `isActive` via `useLocation` + `isBriefActive`, not `end` on those
  - [x] `AppHeader.tsx` user dropdown gains Settings (`/app/household/settings`) + Account (`/account`) items above Sign out
  - [x] Unit tests: exactly 4 nav items; nested-URL active state; header menu items
- [x] Task 3: Lumi anchor page (AC: 3)
  - [x] Extract the conversation body (thread list, input, voice/caption states, ratification card, nudge toggle) from `LumiSheet.tsx` into a shared component (`components/LumiConversation.tsx`); `LumiSheet` keeps the Dialog shell + `planEditScope` branch + hydration and consumes it
  - [x] New `routes/(app)/lumi.tsx`: full-frame page, `useLumiContext({ surface: 'general' })`, hydrates + submits through the SAME store actions as the sheet
  - [x] `AppLayout`: suppress the presence dot on `/app/lumi` (extend the `useMatch('/lunch/*')` pattern)
  - [x] Unit tests: page renders thread + input; sheet still works via the shared component (no behavior fork)
- [x] Task 4: Artifact host over the Brief (AC: 4)
  - [x] `ArtifactSheet` host composing the `Dialog` primitive (wide/full-height panel; locked tokens only, DESIGN.md read)
  - [x] Router: `/app/day/:day`, `/app/grocery-list`, `/app/evening-checkin`, `/app/plan/:weekId` render `<AppHomePage artifact={<ArtifactSheet>…}>` (Brief hosts, gate covers it); close → `navigate('/app')` + Dialog focus restore
  - [x] Brief in-app entry points: NONE exist today (verified — day-detail/evening-checkin had no in-app entry; grocery only via the removed sidebar link; history only via the deleted PlanPage). Nothing to re-route. s10 `planEditScope` day-summon kept separate.
  - [x] Unit tests: URL → artifact open; close → `/app`; Escape/scrim via Dialog contract
- [x] Task 5: Redirects + catch-all (AC: 5)
  - [x] `/app/plan` → `<Navigate to="/app" replace>`; `/app/*` catch-all → `/app`
  - [x] `PlanRoute`/`PlanPage`/`PlanPageFooter` orphaned by the redirect → deleted (converge, no parallel plan surface); `plan-history.tsx` orphaned too (artifact hosts `PlanHistoryPage` directly under the Brief's gate) → deleted
  - [x] Unit test: redirect + catch-all
- [x] Task 6: Kept-route reachability sweep (AC: 6, 7)
  - [x] Snacks/Inspiration/Memory lost their sidebar tabs → added a "More in your kitchen" links row on the Kitchen anchor. heart-note reachable from People (exists). Account/Settings → header menu. Child screens keep status-quo reachability (never nav-reachable; still URL-addressable) — noted.
  - [x] No edits to lunch/guest-author/onboarding/auth/invite/`_dev-*`
- [x] Task 7: E2E + full validation (AC: 8)
  - [x] New `apps/web/test/e2e/13-s11-route-collapse.spec.ts` (isolated, `--workers=1`, from `apps/web`): 4-anchor sidebar, grocery deep-link artifact + axe, `/app/plan` redirect, `/app/lumi` page without dot — 4/4 green
  - [x] 13-s1 baseline + 13-s10 + 4-s2 green in isolation (13-s10 required a lockstep mock update — see Completion Notes); typecheck + lint clean on diff

## Dev Notes

### Authoritative sources — read these first
- `_bmad-output/planning-artifacts/epic-13-lumi-ux-rebuild-brief.md` §13-s11 + Section 5 (wall definition, "audited redirects", scopes out of collapse)
- `_bmad-output/planning-artifacts/lumi-conversational-ux-rebuild-vision.md` §2c (the 4 anchors + what each holds) and §6 item 4 ("4-anchor model is a target, not a guarantee; audit deep-link dependencies first")
- `_bmad-output/planning-artifacts/epics.md` Story 13.12 (BDD AC)
- `docs/DESIGN.md` — read before any UI authoring (locked components, Honey rule); Editorial Hearth is FROZEN — this story changes topology, zero visual language
- Previous story: `_bmad-output/implementation-artifacts/13-s10-talk-to-your-plan-ui.md` — Dev Agent Record (planEditScope pattern, Dialog a11y contract, both Brief render sites)

### Route disposition table (the deep-link audit, captured 2026-07-03 — re-verify per AC1)

Anchors (reuse existing paths — only `/app/lumi` is new):

| Anchor | Path | Today |
|---|---|---|
| Brief | `/app` | `routes/(app)/index.tsx` (AppHomePage/BriefCanvas) |
| Kitchen | `/app/kitchen-profile` | `kitchen-profile.tsx` |
| People | `/app/heart-notes` | `heart-notes.tsx` |
| Lumi | `/app/lumi` | **NEW** (Task 3) |

Become artifacts over Brief (URL kept, nav removed): `/app/day/:day` (day-detail), `/app/grocery-list`, `/app/evening-checkin`, `/app/plan/:weekId` (history). *Swap has no route — nothing to convert; note only.*

Redirect: `/app/plan` → `/app` (duplicate planner surface); unknown `/app/*` → `/app` catch-all.

Kept, denavved (reached from within an anchor or the header menu): `/app/kitchen/snacks`, `/app/inspiration`, `/app/memory`, `/app/memory/dashboard`, `/app/memory/consent-history`, `/app/children/:childId/{school-policies,bag-composition,extra-rules,flavor-passport}`, `/app/heart-note`, `/account`, `/app/household/settings`.

Out of scope, untouched: `/` (RootRedirect), `/auth/{login,callback,reset-password}`, `/invite/:token`, `/onboarding`, `/lunch/:linkId(+/passport)` (child surface — presence already suppressed via `useMatch('/lunch/*')`), `/guest-author/compose` (grandparent-scope), `_dev-*` branch (outside the router).

Deep-link producers verified at story creation: sidebar (8 links → becomes 4), header user menu (sign-out), auth guards emitting `/auth/login?next=<path>` from snack-shelf, kitchen-profile, household-settings, memory, memory-dashboard, consent-history, account, child-flavor-passport, guest-author-compose (all `next` targets keep resolving because paths are preserved), onboarding/login/callback/reset → `/app` or `/onboarding`, invite redeem → `scope_target`, heart-notes → `/app/heart-note`, memory-dashboard → `/app/memory`, plan-history ↔ `/app/plan` (update this link to `/app`), `PlanEditPanel` → `/app/plan` (update to `/app`).

### Story-creation decisions (flag disagreement before building)
- **Anchors reuse existing paths.** Kitchen = `/app/kitchen-profile`, People = `/app/heart-notes` — no cosmetic path renames, no redirect churn, auth `?next=` chains untouched. Labels change in the sidebar only.
- **Artifact URLs are kept, not redirected.** "Old routes redirect, not 404" is satisfied by render-in-place (Brief + open artifact at the same URL) for the four artifact screens and by real redirects only where a surface is a duplicate (`/app/plan`). This keeps bookmarks, `?next=` chains, and e2e locators stable with one summon code path.
- **Account/Settings live in the header user menu**, not an anchor — utility chrome, same idiom as sign-out. The vision's anchor list has no settings slot.
- **Kitchen/People sub-screens stay full routes.** The epic AC names exactly day-detail, grocery, swap, history, evening check-in as artifact conversions. Converting memory/snacks/child-config screens to sheets is NOT in scope — they just leave the nav.
- **Day-detail artifact ≠ day-edit summon.** s10's `planEditScope` sheet (talk-to-change-it) stays exactly as shipped; the day-detail artifact is the cook view (recipe + method, memory `day-detail-is-cooking-not-explanation`). Both can exist on a tile (activation = edit summon, an explicit "details" affordance / deep-link = artifact) — do not merge them.

### Frontend anatomy you build on (verified in-repo)
- Router: `react-router-dom` v6 `createBrowserRouter` in `apps/web/src/app.tsx` (routes at lines ~59–108; `_dev-*` rendered OUTSIDE the router via a conditional in `App()` — leave that branch alone)
- `components/AppLayout.tsx` — app-scope, `useMatch('/lunch/*')` suppression pattern (extend for `/app/lumi`), `VoiceSessionProvider` mounted at layout level (must survive your route changes)
- `components/AppSidebar.tsx` (desktop + mobile drawer, `NavLink` active idiom), `AppHeader.tsx` (user dropdown to extend)
- `components/LumiPresence.tsx` / `LumiSheet.tsx` / `LumiWhisper.tsx` — the presence primitive; `LumiSheet` contains the conversation body to extract (text/voice toggle, captions Story 5-S13, ratification 5-S10, nudge opt-out 12-S12, `planEditScope` branch → `PlanEditPanel`) on the `Dialog` primitive (focus-trap, Escape, scrim, scroll-lock, reduced-motion, focus-restore)
- `stores/lumi.store.ts` — `presenceState`, `summon()/recede()`, `hydrateThread`, `threadIds` keyed by surface, `planEditScope`; `hooks/useLumiContext.ts` for surface registration
- Parental-notice gate: `useRequireParentalNoticeAcknowledgment()` used by AppHomePage, PlanRoute, PlanHistoryRoute — Brief's gate covers artifacts rendered over it
- Existing screens being re-hosted are mock/fixture-data pages (day-detail, grocery-list, evening-checkin) — re-host content, do not rebuild data layers
- Known pre-existing deviations, do NOT fix in passing: `(child)/layout.tsx` + `(ops)/layout.tsx` defined but unwired (13-s1 AC2 documents `/lunch/*` under app-scope); `pb-28` StickyBottomBar clearance coupling (deferred W2)

### Scope guards
- Frontend-only. NO api/contracts/migration changes; NO LLM anywhere (topology is free)
- Editorial Hearth frozen — compose locked components; if the ArtifactSheet pattern needs documenting, append to DESIGN.md as a new pattern, change nothing existing
- NO new parallel implementations — the Lumi page and the sheet share one conversation component; artifact screens re-host the existing route components
- NO voice work, NO onboarding changes, NO `_dev-*` cleanup
- Web research: none required — no new libraries; react-router v6 `<Navigate>`/`useMatch`/`NavLink` idioms are already the in-repo pattern

### Testing standards
- Web unit: Vitest + Testing Library, colocated `*.test.tsx`; router tests via `createMemoryRouter`/`MemoryRouter`; no DOM snapshots
- E2E: run new + touched specs in isolation from `apps/web` (`--workers=1`) — the full local suite has ~99 reproducible SW-bypass failures (memory `e2e-full-suite-sw-bypass`); trust CI ubuntu
- Gates at HEAD: api 31 pre-existing failures / repo 179 pre-existing lint errors — do not absorb or grow them; this story's diff must be lint-clean

### Project Structure Notes
- New files: `routes/(app)/lumi.tsx`, `components/LumiConversation.tsx`, `components/ArtifactSheet.tsx` (+ colocated tests), `test/e2e/13-s11-route-collapse.spec.ts`
- Edited: `app.tsx` (route tree), `AppSidebar.tsx`, `AppHeader.tsx`, `AppLayout.tsx`, `LumiSheet.tsx` (extract), the four artifact route files (re-host), `plan-history.tsx`/`PlanEditPanel.tsx` (`/app/plan` link targets → `/app`)
- Components `PascalCase.tsx`; no cross-feature lateral imports (shared bits in `components/`/`lib/`)
- Commits: `feat(web): … (Epic 13-s11)`, one independently-testable commit per task

### References
- [Source: apps/web/src/app.tsx#createBrowserRouter (~59–108), _dev branch (~133–215)]
- [Source: apps/web/src/components/AppSidebar.tsx#NavLink items]
- [Source: apps/web/src/components/AppHeader.tsx#user dropdown]
- [Source: apps/web/src/components/AppLayout.tsx#useMatch('/lunch/*') suppression, VoiceSessionProvider]
- [Source: apps/web/src/components/LumiSheet.tsx#conversation body + planEditScope branch]
- [Source: apps/web/src/stores/lumi.store.ts#presenceState/summon/hydrateThread/threadIds]
- [Source: apps/web/src/hooks/useRequireParentalNoticeAcknowledgment.*#gate consumers]
- [Source: apps/web/test/e2e/13-s1-ux-regression-baseline.spec.ts#locator style + baseline ACs]
- [Source: _bmad-output/planning-artifacts/lumi-conversational-ux-rebuild-vision.md#§2c, §6.4]
- [Source: _bmad-output/planning-artifacts/epic-13-lumi-ux-rebuild-brief.md#§13-s11, Section 5]
- [Source: _bmad-output/project-context.md#file structure, React 19/Vite rules]
- Memories: `day-detail-is-cooking-not-explanation`, `mock-screen-reference-check`, `lumi-valet-not-chat-app`, `design-md-canonical`, `e2e-full-suite-sw-bypass`

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (dev-story)

### Debug Log References

- Verified pre-existing baselines by stashing the whole diff and rebuilding `dist`:
  - `BriefCanvas.test.tsx` "swap picker" (1 fail) — fails identically on HEAD.
  - 13-s1 e2e AC5 "paused day … non-interactive" — fails identically on HEAD (13-s10's D1 fix changed BriefCanvas tiles to summon Lumi instead of opening the edit-group, which AC5 still asserts; stale, pre-existing).
  - `useLumiVoiceSession.test.ts` (6) + `sse.test.ts` (5) — 12/12 fail identically on HEAD (jsdom VAD/EventSource baseline; none of these files touched).
- 13-s1 e2e "opened Lumi sheet axe" fails only in the full-file run (ordering / SW bypass); passes in isolation with axe log `new: [none]`.

### Deep-link audit (AC1) — verified against the codebase at implementation time

Re-ran the grep sweep (`to=`, `navigate(`, `<Navigate`, `next=`, plus every `/app/*` target) across `apps/web/src`. Corrections to the story-creation table:

- **DRIFT #1 (corrected):** the story audit said `PlanEditPanel → /app/plan (update to /app)`. FALSE — `PlanEditPanel` has no `/app/plan` link; it closes via `useLumiStore.getState().recede()`. No change made there.
- **DRIFT #2 (corrected):** `/app/plan` is referenced ONLY by `PlanHistoryPage.tsx` (the `Navigate` redirect-to-current at L62 and the "Back to this week" `Link` at L76). Both updated to `/app`.
- **DRIFT #3 (corrected):** `PlanRoute`/`PlanPage`/`PlanPageFooter` are consumed only by `plan.tsx` (+ its test). Genuinely orphaned by the `/app/plan` redirect → deleted. `plan-history.tsx` (`PlanHistoryRoute`) is also orphaned once the history artifact hosts `PlanHistoryPage` directly under the Brief's gate → deleted.
- **DRIFT #4 (noted):** the layout suppression lives in `routes/(app)/layout.tsx`, not `components/AppLayout.tsx` (no such file). Extended there.
- **No in-app entry points** exist for the artifact screens: day-detail and evening-checkin had none; grocery only via the (removed) sidebar link; `/app/plan/:weekId` history only via `PlanPage.tsx:389` (now deleted). So there were no Brief tiles to re-route to artifact URLs.

| Route | Disposition | Notes |
|---|---|---|
| `/app` | **anchor: Brief** | `AppHomePage` (now accepts optional `artifact`) |
| `/app/kitchen-profile` | **anchor: Kitchen** | + "More in your kitchen" links (snacks/inspiration/memory) |
| `/app/heart-notes` | **anchor: People** | links to `/app/heart-note` (exists) |
| `/app/lumi` | **anchor: Lumi (NEW)** | full-screen `LumiConversation`; presence dot suppressed |
| `/app/day/:day` | **artifact over Brief** | `AppHomePage artifact={ArtifactSheet(DayDetailRoute)}` |
| `/app/grocery-list` | **artifact over Brief** | `AppHomePage artifact={ArtifactSheet(GroceryListRoute)}` |
| `/app/evening-checkin` | **artifact over Brief** | `AppHomePage artifact={ArtifactSheet(EveningCheckinRoute)}` |
| `/app/plan/:weekId` | **artifact over Brief** | `AppHomePage artifact={ArtifactSheet(PlanHistoryPage)}` — Brief's gate covers it (AC7) |
| `/app/plan` | **redirect → /app** | duplicate planner surface; `PlanRoute`/`PlanPage`/`PlanPageFooter`/`plan-history.tsx` deleted |
| `/app/*` | **catch-all → /app** | unknown app paths never 404 |
| `/app/kitchen/snacks` | kept, denavved | linked from Kitchen |
| `/app/inspiration` | kept, denavved | linked from Kitchen |
| `/app/memory` (+`/dashboard`, `/consent-history`) | kept, denavved | Kitchen → memory; dashboard/consent-history hang off memory |
| `/app/children/:childId/{school-policies,bag-composition,extra-rules,flavor-passport}` | kept, denavved | status-quo reachability preserved (never nav-reachable; still URL-addressable) |
| `/app/heart-note` | kept, denavved | reachable from People |
| `/account`, `/app/household/settings` | kept, denavved | moved into the `AppHeader` user menu |
| `/`, `/auth/*`, `/invite/:token`, `/onboarding`, `/lunch/:linkId(+/passport)`, `/guest-author/compose`, `_dev-*` | out of scope, untouched | scopes + pre-anchor surfaces preserved (AC7) |

### Completion Notes List

- **Frontend-only, zero-LLM, zero-api.** No contracts/migration/dep changes. api suite untouched (its 31 pre-existing failures cannot grow).
- **No forked Lumi implementation:** the conversation body was extracted into `LumiConversation.tsx`, consumed by BOTH `LumiSheet` (summoned, `active={isSummoned}`) and the `/app/lumi` page (`active fullHeight`). The sheet retains the Dialog shell, the `planEditScope`→`PlanEditPanel` branch, and the summon-time hydration effect; the page hydrates via `useLumiContext`.
- **Deviation (sheet DOM):** the Text/Voice mode toggle moved from the sheet header into `LumiConversation`, so the sheet's first focusable is now the Close button (was the Text-mode button). The `LumiSheet` focus test was updated in lockstep to assert focus lands inside the dialog (the focus-trap contract), which still holds.
- **Artifact host covers the gate:** `AppHomePage` renders the `artifact` only AFTER the parental-notice gate is `acknowledged`, so the AADC gate covers artifacts (AC4/AC7) and there is exactly one gate instance (no double-gate). One summon path for deep-link and in-app.
- **REQUIRED lockstep update — 13-s10 e2e:** the story listed 13-s10 as "visits kept routes", but its `navigateToPlan` hard-codes `/app/plan` (which this story collapses) and mocks the plan surface, not the brief. Talk-to-your-plan already moved to the Brief (13-s10's own D1 fix made BriefCanvas tiles summon). Updated `13-s10-talk-to-your-plan.spec.ts` to land on `/app` and populated `briefResponse().tile_summaries` so the Brief renders the tappable day tiles. All 3 tests green; the flow (summon → edit → escalate cost-wall) is unchanged.
- **Expected fallout (NOT in the keep-green set):** e2e `3-14` (draft view at `/app/plan`), `3-15` (`/app/plan/:weekId`), `3-25`, `3-27` visit the collapsed `/app/plan` surface and are obsoleted by the convergence. Left in place (deleting them is out of scope); flagged for the retro. CI ubuntu is the gate per `e2e-full-suite-sw-bypass`.
- **Task 6 judgment call:** Snacks/Inspiration/Memory clearly lost their sidebar tabs → added an in-Kitchen "More in your kitchen" links row. Child config screens (`/app/children/:childId/*`) were never nav-reachable (onboarding/deep-link only); rather than add speculative navigation to the frozen `ChildProfileCard`, their status-quo reachability is preserved and they stay URL-addressable (AC6's core requirement). Flagged for review if a stronger in-anchor link is wanted.
- **Verification:** `pnpm typecheck` clean; `eslint` on the diff = 0 errors (2 pre-existing warnings only). Web unit: 688 pass / 12 fail — all 12 confirmed identical on HEAD (BriefCanvas×1 + useLumiVoiceSession×6 + sse×5), 0 new. e2e in isolation: **13-s11 4/4**, **13-s10 3/3**, **4-s2 8/8**; 13-s1 = 11 pass / 1 skip / 2 pre-existing (both confirmed on HEAD).

### File List

**New**
- `apps/web/src/components/LumiConversation.tsx`
- `apps/web/src/components/ArtifactSheet.tsx`
- `apps/web/src/routes/(app)/lumi.tsx`
- `apps/web/src/components/AppSidebar.test.tsx`
- `apps/web/src/components/AppHeader.test.tsx`
- `apps/web/src/components/ArtifactSheet.test.tsx`
- `apps/web/src/routes/(app)/lumi.test.tsx`
- `apps/web/src/app-redirects.test.tsx`
- `apps/web/test/e2e/13-s11-route-collapse.spec.ts`

**Edited**
- `apps/web/src/app.tsx` (route tree: anchors, artifacts, redirects, catch-all)
- `apps/web/src/components/AppSidebar.tsx` (4 anchors + Brief artifact active-state)
- `apps/web/src/components/AppHeader.tsx` (Settings + Account in user menu)
- `apps/web/src/components/LumiSheet.tsx` (consume `LumiConversation`; keep shell + hydration + planEditScope)
- `apps/web/src/components/LumiSheet.test.tsx` (focus-trap assertion lockstep)
- `apps/web/src/routes/(app)/layout.tsx` (suppress presence on `/app/lumi`)
- `apps/web/src/routes/(app)/index.tsx` (`AppHomePage` optional `artifact` prop)
- `apps/web/src/routes/(app)/kitchen-profile.tsx` ("More in your kitchen" links)
- `apps/web/src/features/plan/PlanHistoryPage.tsx` (`/app/plan` → `/app`)
- `apps/web/src/features/plan/PlanHistoryPage.test.tsx` (href assertion lockstep)
- `apps/web/test/e2e/13-s10-talk-to-your-plan.spec.ts` (land on `/app`; brief tiles — required lockstep)

**Deleted**
- `apps/web/src/routes/(app)/plan.tsx`
- `apps/web/src/routes/(app)/plan-history.tsx`
- `apps/web/src/features/plan/PlanPage.tsx`
- `apps/web/src/features/plan/PlanPageFooter.tsx`
- `apps/web/src/features/plan/PlanPage.test.tsx`

### Review Findings

- [x] [Review][Patch] P1 — `summon('text')` on LumiPage leaks `presenceState: 'summoned'`, causing LumiSheet to auto-open on next navigation away [`apps/web/src/stores/lumi.store.ts` — added `presenceState: 'atRest'` to `setContext`] FIXED
- [x] [Review][Patch] P2 — `ArtifactSheet.close()` uses push navigation; Back button cycles back to the artifact [`apps/web/src/components/ArtifactSheet.tsx:28` — changed to `navigate('/app', { replace: true })`] FIXED
- [x] [Review][Defer] D1 — `aria-current="page"` not set on Brief NavLink at artifact URLs; screen readers lose current-page signal [`apps/web/src/components/AppSidebar.tsx:66-67`] — deferred; not WCAG-AA, spec says "highlights Brief" (visual); intentional per test comment; needs dedicated a11y slice
- [x] [Review][Defer] D2 — Two Dialog Escape listeners conflict when LumiSheet summoned and ArtifactSheet open simultaneously — deferred; Dialog stack coordination required; no reachable in-app path to this state (no in-Brief artifact nav entry points); mitigated by P1 fix
- [x] [Review][Defer] D3 — `useLumiContext` clears `turns: []` on every mount; turns flash empty when navigating between artifact URLs while LumiSheet open [`apps/web/src/hooks/useLumiContext.ts:18`] — deferred; pre-existing `setContext` design; needs surface-unchanged guard in setContext
- [x] [Review][Defer] D4 — Voice session not torn down when navigating away from `/app/lumi`; WebSocket stays open against stale contextSignal — deferred; voice lifecycle is layout-level by design (VoiceSessionProvider in AppLayout); governed by 5-S5 voice spec
- [x] [Review][Defer] D5 — `ArtifactSheet.tsx` close button (`absolute right-4 top-4`) occludes hosted screen content in the top-right quadrant; hosted screens were not designed for an overlaid close affordance [`apps/web/src/components/ArtifactSheet.tsx:43-49`] — deferred; screens are frozen dev-mock routes; rebuild when screens get proper artifact-context redesign

## Change Log

- 2026-07-03: Implemented (dev-story, claude-opus-4-8[1m]). Route collapse to 4 anchors — Brief · Kitchen · People · Lumi. New `/app/lumi` full-screen thread (shared `LumiConversation`, no fork); day-detail/grocery/evening-checkin/history become `ArtifactSheet`s summoned over the Brief at kept URLs (gate-covered, one summon path); `/app/plan` redirect + `/app/*` catch-all; `PlanRoute`/`PlanPage`/`PlanPageFooter`/`plan-history.tsx` deleted (converged duplicate). Settings/Account → header menu; Snacks/Inspiration/Memory → in-Kitchen links. AC1 deep-link audit re-verified (4 drift corrections recorded). Frontend-only, zero-LLM, zero-api. Gates: typecheck clean, lint 0 errors on diff, web unit 0 new failures (12 pre-existing confirmed on HEAD), e2e 13-s11 4/4 + 13-s10 3/3 (lockstep) + 4-s2 8/8 + 13-s1 baseline (2 pre-existing fails confirmed on HEAD). Status → review.
- 2026-07-03: Story created (bmad-create-story, claude-fable-5). Ultimate context engine analysis completed — comprehensive developer guide created from epic brief §13-s11 + Section 5 pre-flight, vision §2c/§6.4, epics.md Story 13.12, 13-s10 Dev Agent Record, and a full in-repo route-graph audit (26 routes, all nav/link/navigate/?next producers, scope wrappers, presence/sheet infra). Anchor mapping decided at story creation: reuse `/app`, `/app/kitchen-profile`, `/app/heart-notes`; new `/app/lumi`; artifact-over-Brief render-in-place for day-detail/grocery/evening-checkin/history; `/app/plan` redirect. Status: ready-for-dev.
