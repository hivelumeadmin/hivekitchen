# Slice 2-S19 — Resume incomplete onboarding

**Status:** backlog (new — surfaced by VT-2-T17 verification thread, 2026-05-12).

**Source:** Bug discovered via Epic 2 verification thread catalog ([`epic-2-verification-threads.md`](epic-2-verification-threads.md) §VT-2-T17). Code inspection confirmed at `apps/api/src/modules/auth/auth.service.ts:160`: `is_first_login = user === null` — flag only catches the very first auth event, not "user with incomplete onboarding."

---

## Demo

1. User C signs up with fresh email → `is_first_login=true` → routed to `/onboarding`
2. User C closes the tab mid-onboarding (no children added, parental notice not acknowledged)
3. User C logs back in 10 minutes later with the same credentials
4. **Expected:** routed back to `/onboarding` (NOT `/app`)
5. Onboarding mode picker renders with optional "Welcome back" copy near the top

VT-2-T17 from the verification catalog becomes the manual-regression test for this slice. After implementation, T17 step 5 must pass (no longer broken).

---

## Layers

- **UI:**
  - `routes/auth/login.tsx` and `routes/auth/callback.tsx` routing logic — check `result.is_onboarded` (new field) in addition to `result.is_first_login`. If NOT first login AND NOT onboarded → route to `/onboarding`.
  - `routes/(app)/onboarding.tsx` `select` mode — optionally render "Welcome back, let's finish where you left off" copy when `is_first_login=false` AND `is_onboarded=false`.
- **API:**
  - `POST /v1/auth/login`, `POST /v1/auth/oauth`, `GET /v1/users/me` responses each gain `is_onboarded: boolean`.
  - Computation lives in `auth.service.ts` — derive from existing data: `is_onboarded = (parental_notice_acknowledged_at !== null) && (children_count > 0)`.
- **Agent:** none.
- **DB:** No new column required. Derivation reads existing `users.parental_notice_acknowledged_at` + count of `children` rows per household.

---

## Why "derive" instead of "add `onboarding_completed_at` column"

**Considered alternative:** Add `users.onboarding_completed_at TIMESTAMPTZ`, set it when onboarding flow's final step succeeds, route on `onboarding_completed_at IS NOT NULL`.

**Rejected because:**
- Requires a migration + backfill for existing done-onboarding users (Epic 2 done; users already exist with no completion timestamp)
- The derived check is honest: "has the user acknowledged the parental notice AND added at least one child?" is what "onboarded" actually means in our product
- Adding a column would couple this slice to a state machine the codebase doesn't currently have

**Trade-off accepted:** If a user adds a child but never finishes the mental-model step, they'd be considered "onboarded" by the derived check. Acceptable — the mental-model step (Story 2.14) is informational copy, not state-collecting. Missing it doesn't block product use.

---

## Deferred (NOT in this slice)

- **Smart resume** — deep-linking back to the specific onboarding step the user abandoned (e.g., they were in voice mode question 2 of 3 → resume there). Requires onboarding state persistence. Separate slice if/when needed.
- **"Welcome back" copy variants** — culturally-aware greeting, time-of-day-aware ("good morning") greeting, etc. Out of scope.
- **Notifications** — "You have an unfinished onboarding" email/SMS reminder. Out of scope.
- **Multi-caregiver state** — if Primary onboarded and Secondary hasn't, what happens for Secondary? Defer until Caregiver invite redemption (Epic 5 5-S2) ships, then we can think about it together.

---

## Acceptance criteria

1. **Given** a user with `is_first_login=false` AND (`parental_notice_acknowledged_at IS NULL` OR has zero children),
   **When** they log in via `POST /v1/auth/login` or `POST /v1/auth/oauth`,
   **Then** the response `is_onboarded` field is `false`,
   **And** the client routes to `/onboarding`.

2. **Given** a user with `is_first_login=false` AND `parental_notice_acknowledged_at IS NOT NULL` AND at least one child row,
   **When** they log in,
   **Then** `is_onboarded` is `true`,
   **And** the client routes to `/app` (or to `?next=...` destination).

3. **Given** a fresh signup (`is_first_login=true`),
   **When** the user logs in / signs up,
   **Then** routing remains unchanged from current behavior (`/onboarding`). This slice is additive — does not alter the first-login path.

4. **Backwards compat:** Existing users with completed onboarding remain routed to `/app` after this slice ships. No regression.

---

## Manual test path (= VT-2-T17 in the verification catalog)

1. Create User C: signup fresh email, close the tab when redirected to /onboarding (don't acknowledge parental notice, don't add a child)
2. Log out (clear localStorage tokens) and log back in with the same email
3. **Expect:** redirect to `/onboarding`, NOT `/app`
4. Complete onboarding: acknowledge parental notice, add a child via the flow
5. Log out, log back in
6. **Expect:** redirect to `/app` Brief (or empty state if no plan yet)

Test users B (returning, fully onboarded) and A (first-time signup) must both continue routing correctly per VT-2-T17.

---

## Files to touch

**Server:**
- `apps/api/src/modules/auth/auth.service.ts` — add `is_onboarded` to response type; compute in login + oauth + me methods
- `apps/api/src/modules/auth/auth.service.test.ts` — add cases for (no parental notice / no children → false), (both present → true)
- `apps/api/src/modules/auth/auth.routes.test.ts` — assert response shape includes `is_onboarded`

**Client:**
- `apps/web/src/routes/auth/login.tsx` — add `is_onboarded` check to navigate logic
- `apps/web/src/routes/auth/callback.tsx` — same
- `apps/web/src/stores/auth.store.ts` — add `is_onboarded` to stored auth state (optional — only if the app needs to read it after login)
- `apps/web/src/routes/auth/login.test.tsx` — extend to cover the new routing case

**Optional UI polish:**
- `apps/web/src/routes/(app)/onboarding.tsx` — add `is_first_login` prop or query from auth store; conditionally render "Welcome back" copy

---

## Effort estimate

Roughly half a day:
- ~1h server change + tests
- ~1h client change + tests
- ~30min manual verification using VT-2-T17 demo path
- ~30min code review

No new dependencies, no schema migrations, no agent prompt changes. Low blast radius.

---

## After this slice ships

- Re-run VT-2-T17 manually — step 5 should now pass
- Remove the `🚨 KNOWN BROKEN PATH` warning from `epic-2-verification-threads.md`
- Sprint-status: mark `2-s19` done
- The Epic 2 verification catalog now walks cleanly — pilot validated, expand to Epic 3 + Epic 12-done if useful

---

## Scope addition — Tier 1 v1 retoke (bundled 2026-05-12)

The code review surfaced that **`/auth/reset-password`, `/auth/callback`, and `/invite/$token`** were still rendering in v1 chrome (no `AppHeader`/`AppFooter`, `warm-neutral-*` tokens, `honey-amber-600 text-white` buttons, custom `min-h-screen flex` shells). Since 2-S19 already touches `reset-password.tsx` for the routing fix, the v1 retoke was bundled into this slice rather than spun out.

**Stitch involvement:**
1. Initial generation attempts in `projects/7412488554086403296` ("HiveKitchen Reimagined") timed out — that project turned out to be an older variant with a different palette branch (honey/sage/coral), not canonical.
2. Switched to `projects/3502098255450050819` ("HiveKitchen3"), confirmed as the canonical project — its DESIGN.md ("Editorial Hearth v2.0") + tokens (warm-neutral, lumi-terracotta, sacred-plum, foliage, amber, honey-accent) match the codebase exactly.
3. Generated `aba9a04cd4884aefab68bf1fd4278c96` "Welcome Back — Reset Password v2.0" in HK3.
4. Compared the Stitch design against the shipped code. Stitch's design treats reset-password as a visually *distinct* moment (floating transparent header, surface-toned form panel, underline-only input, `justify-between` CTA). Shipped code treats reset-password as a *sibling* of login (standard `AppHeader`, full-bordered `TextField`, icon-left `PrimaryButton`).
5. **Decision recorded:** keep the shipped composition (sibling-of-login pattern) for consistency across all auth pages and to preserve the icon-left button convention from `.stitch/DESIGN.md` §7. The HK3 Stitch screen remains as a design-alternative reference in the project; it is not binding for the implementation.

**Files retoked (Tier 1 entry pages):**
- `apps/web/src/routes/auth/reset-password.tsx` — full v2.0 rewrite with `AppHeader`/`AppFooter`/`LoginHero`/`TextField`/`PrimaryButton` primitives; preserves `useForm` + `zodResolver` + recovery-token parsing + 2-S19 onboarding-aware navigation
- `apps/web/src/routes/auth/callback.tsx` — replaced `text-warm-neutral-700` with `bg-bg text-fg` + `text-fg-muted` (single line)
- `apps/web/src/routes/invite/$token.tsx` — same one-line retoke pattern (3 status messages)

**Not touched (deferred to a future per-feature Tier 2 retoke pass):**
- `features/onboarding/` mode components (OnboardingVoice/Text/Consent/MentalModel/CulturalRatificationStep/Card)
- `features/children/` form components
- `features/compliance/ParentalNoticeView` and related
- A handful of `features/plan/` token remnants

These render inside v2.0 chrome already; their internal styling is v1 but they remain functional. Track as Tier 2 cleanup if it surfaces user pain.

---

## Review Findings

Code review run 2026-05-12 (bmad-code-review workflow, 3 adversarial layers).
Triage: 1 decision, 10 patches, 3 deferred, 11 dismissed as noise.

### Decision needed

- [x] [Review][Decision] **Legacy users without `parental_notice_acknowledged_at` will regress to `/onboarding`** — RESOLVED via backfill migration `20260812000000_backfill_parental_notice_for_existing_users.sql`. Sets `parental_notice_acknowledged_at = NOW()` for users whose household has children but who have NULL ack. Idempotent. Deliberately leaves `parental_notice_acknowledged_version = NULL` so a future v2 ack flow can detect backfilled rows and require explicit re-ack.

### Patches

- [x] [Review][Patch][BLOCKING] **E2E `mockLogin` helper omits `is_onboarded`** — FIXED. Added `isOnboarded?: boolean` option with `true` default to `_helpers.ts`.
- [x] [Review][Patch][MAJOR] **`GET /v1/users/me` not extended to return `is_onboarded`** — FIXED. Added `is_onboarded: z.boolean()` to `UserProfileSchema`. UserRepository gains `hasChildren(household_id)`; UserService gains `deriveIsOnboarded` helper called by all four /me endpoints. user.routes.ts threads `request.user.household_id` through each service method.
- [x] [Review][Patch][MAJOR] **Password reset flow ignores `is_onboarded`** — FIXED. `reset-password.tsx` now routes `result.is_onboarded ? '/app' : '/onboarding'`, mirroring login.tsx + callback.tsx.
- [x] [Review][Patch] **`getIsOnboarded` silently treats missing user row as not-onboarded** — FIXED. Added explicit comment-documented branch for null userData; chose `return false` (route to /onboarding as the safer of two bad outcomes) over throwing.
- [x] [Review][Patch] **Test mock substring-matches column list to disambiguate `users` SELECTs** — FIXED. Mock now exact-matches against the two known column lists; throws `unexpected users select columns` if a third query shape appears.
- [x] [Review][Patch] **OAuth route response shape not asserted in tests** — FIXED. `/v1/auth/callback` happy-path now asserts `is_onboarded` + `is_first_login`.
- [ ] [Review][Patch][SKIPPED] **No repository unit tests for `getIsOnboarded` edge cases** — Skipped per workflow option 0 (requires judgment): writing a new `auth.repository.test.ts` needs Supabase mock chain infrastructure that doesn't exist yet for the repository layer. Service-level tests cover the truth-table semantically via the stubbed boolean. Worth a follow-up slice if/when other repository tests need similar mocking.
- [x] [Review][Patch] **No tests for `callback.tsx` navigation logic** — FIXED. Created `callback.test.tsx` with 8 tests mirroring login.tsx coverage: missing code / invalid provider → /auth/login; happy paths (fully-onboarded, first-login, incomplete onboarding); `?next=` honored when onboarded; `?next=` discarded when not onboarded.
- [x] [Review][Patch] **`is_onboarded` missing from audit metadata** — FIXED. `auth.routes.ts` now writes `{ method, is_first_login, is_onboarded }` for both /login and /callback handlers.

### Deferred

- [x] [Review][Defer] **Refresh token path doesn't return `is_onboarded`** — refresh is for access-token rotation only; navigation never happens off refresh. Out of slice scope; if route guards later need to re-derive, extend then.
- [x] [Review][Defer] **`next=` query parameter dropped when incomplete-onboarding caregiver invitee bounces to /onboarding** — caregiver invite redemption is Epic 5 5-S2 territory; spec explicitly deferred multi-caregiver state. Surfaces a real UX issue for caregivers who close-tab-mid-onboarding then click an invite link — flag for 5-S2 to address.
- [x] [Review][Defer] **Race between user-ack and child-count reads in `getIsOnboarded`** — two non-transactional Supabase queries; another tab could change state between them. Acknowledged minor; documented edge case, no fix proposed at this slice.

### Dismissed (11)

Backward-incompat response change (monorepo single-source). Null-household guard already in place via UnauthorizedError throw on line 169. `getIsOnboarded` ownership check (only called from server-side service, not user-facing endpoint). Routing duplication between login.tsx and callback.tsx (comment in place; pair drift risk noted but not actionable). Short-circuit assertion on null household (covered by null guard). First-login skip of onboarding marker write (intentional optimization). "Welcome back" copy missing (explicitly optional per spec). Login/onboarding v2.0 retoke flagged as "scope creep" (false positive — γ Phase 1/2 work that was already uncommitted before 2-S19; not part of this slice). Transient-null household ID nit (pre-existing pattern). Demo step 5 verbatim mismatch (optional copy).

The auditor's "scope creep" findings about login.tsx and onboarding.tsx being rewritten were noted in the pre-review checkpoint — those are γ Phase 1/2 v2.0 retoke changes that were uncommitted before 2-S19 began. The reviewer didn't have that context. Not 2-S19 scope creep.
