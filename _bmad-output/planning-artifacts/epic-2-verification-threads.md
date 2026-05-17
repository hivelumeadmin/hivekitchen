# Epic 2 — Verification Threads (PILOT)

**Status:** Pilot for retroactive verification of done work. Epic 2's 16 done stories shipped horizontally — this catalog provides 17 end-to-end demo paths so you can walk through what's actually working today.

**Source:** [`epics.md`](epics.md) §"Epic 2: Household Onboarding & Profile" + the 16 story files in [`../implementation-artifacts/2-*.md`](../implementation-artifacts/).

---

## Format

Each verification thread (VT) is a short script:
- **Stories exercised** — which done stories the thread integrates
- **Prerequisites** — test fixtures or state needed
- **Demo path** — numbered user actions
- **Verification** — what to check at each step (DB row, network response, UI state)
- **Known issues** — anything currently broken or partial, flagged inline

These aren't replacement tests — unit + integration tests already cover individual story logic. These are **integration walk-throughs** that prove the stories work together as a thread. The same thing a beta user would experience.

A `VT-2-T*` ID is opaque (no slice numbering implied — these are catalog entries, not work items).

---

## Catalog

| ID | Thread | Stories exercised |
|---|---|---|
| VT-2-T1 | Fresh email/password signup → land at /onboarding | 2-1, 2-2, 2-8, 2-9, 2-14 |
| VT-2-T2 | Returning user login → land at /app | 2-1, 2-2 |
| VT-2-T3 | Google OAuth signup → /onboarding | 2-1 |
| VT-2-T4 | Apple OAuth signup → /onboarding | 2-1 |
| VT-2-T5 | Forgot password → reset email → new password → re-login | 2-1, 2-4, 2-4b |
| VT-2-T6 | Voice onboarding (three signal questions via ElevenLabs) | 2-6, 2-6b, 2-14 |
| VT-2-T7 | Text onboarding (three signal questions typed) | 2-7, 2-14 |
| VT-2-T8 | Parental notice gate fires before child-data collection | 2-9 |
| VT-2-T9 | COPPA soft-VPC signed declaration captured (beta cohort) | 2-8 |
| VT-2-T10 | Add a child profile (envelope-encrypted) | 2-10 |
| VT-2-T11 | Cultural template inferred during onboarding, ratified by parent | 2-11 |
| VT-2-T12 | Per-child bag composition declared (Snack + Extra slots) | 2-12 |
| VT-2-T13 | Account profile edit — display name + language + email change | 2-4 |
| VT-2-T14 | Notification + cultural-language preferences toggled and persisted | 2-5 |
| VT-2-T15 | memory_nodes seeded from completed onboarding | 2-13 |
| VT-2-T16 | Caregiver invite generation (Primary side only — redemption is Epic 5) | 2-3 |
| VT-2-T17 | Post-login routing logic across user states | 2-1 (integration) |

---

## VT-2-T1 — Fresh email/password signup → /onboarding

**Stories exercised:** 2-1 (auth), 2-2 (RBAC), 2-8 (soft-VPC), 2-9 (parental notice), 2-14 (mental model)

**Prerequisites:** No pre-existing account with the test email. API running. Supabase email provider enabled.

**Demo path:**
1. Visit `/auth/login`
2. Tap "Create account" or equivalent signup affordance
3. Enter test email + password → submit
4. Server: `POST /v1/auth/signup` → Supabase creates auth.user row → trigger `create_household_and_user_idempotent` fires → `users` + `households` rows created
5. JWT issued; client navigates based on `is_first_login=true` → expect `/onboarding`
6. Onboarding shell renders parental-notice gate (T8) before any further data collection
7. Acknowledge parental notice → onboarding mode picker visible (Start with voice / I'd rather type)

**Verification:**
- Supabase `users` table: row with the new user, `current_household_id` populated, `parental_notice_acknowledged_at` set after step 6
- `households` row exists, owned by the user
- `audit_log`: entries for `auth.signup`, `parental_notice.acknowledged`
- vpc_consents row written with `mechanism='soft_vpc'` (beta cohort) at step 6

---

## VT-2-T2 — Returning user login → /app

**Stories exercised:** 2-1, 2-2

**Prerequisites:** User exists with `is_first_login=false` and at least one child + a generated plan.

**Demo path:**
1. Visit `/auth/login`
2. Enter known email + password → submit
3. `POST /v1/auth/login` → JWT issued
4. Client routes based on `is_first_login=false` → expect `/app` directly (not /onboarding)
5. Brief renders (assuming Epic 3 work shipped)

**Verification:**
- JWT in localStorage / auth store after step 3
- Network: no /onboarding redirect
- `/app` renders without parental-notice prompt (already acknowledged)

---

## VT-2-T3 — Google OAuth signup → /onboarding

**Stories exercised:** 2-1

**Prerequisites:** Supabase Google OAuth provider configured. Test Google account.

**Demo path:**
1. Visit `/auth/login`
2. Tap "Continue with Google"
3. Supabase OAuth redirects to Google → consent → redirect to `/auth/callback?code=...`
4. Callback handler exchanges code for JWT → routes `is_first_login=true` → `/onboarding`

**Verification:**
- `users` row created with `auth_providers` array including `'google'`
- `households` auto-created via trigger
- No password column set (email-only OAuth)

---

## VT-2-T4 — Apple OAuth signup → /onboarding

**Stories exercised:** 2-1

Same shape as VT-2-T3 but Apple. Verify `auth_providers` contains `'apple'`.

**Known issue:** Apple OAuth requires Sign-in-with-Apple service-ID configuration in Supabase. If not configured, this thread fails at step 2. Document Apple config status in the project setup notes.

---

## VT-2-T5 — Forgot password → reset → re-login

**Stories exercised:** 2-1 (login), 2-4 (account mgmt), 2-4b (reset completion page)

**Prerequisites:** User exists with email-provider account (not OAuth-only). SendGrid configured (or Supabase email).

**Demo path:**
1. Visit `/auth/login` → "Forgot password?"
2. Enter email → submit → `POST /v1/auth/password-reset` → 200
3. Check inbox: reset email arrives within ~60s
4. Click reset link → lands at `/auth/reset-password#type=recovery&access_token=...`
5. Page reads the hash recovery token, shows new-password form
6. Enter new password → submit → success → redirect to `/auth/login`
7. Login with new password → success

**Verification:**
- `audit_log`: rows for `auth.password_reset_requested` (step 2) and `auth.password_reset_completed` (step 6)
- New password works; old password fails

**Known issue:** Email delivery latency depends on SendGrid/Supabase config. If reset email doesn't arrive in 60s, check `audit_log` for the password_reset_requested row — if present, the issue is delivery, not API.

**v2.0 chrome shipped 2026-05-12 (slice 2-S19):** The reset-password page now renders with `AppHeader` + `LoginHero` (matching login.tsx composition) + `PrimaryButton` "Save and continue" CTA. The expired-link state shows in the same shell with a "Send a new link" affordance routing to `/auth/login`.

---

## VT-2-T6 — Voice onboarding interview

**Stories exercised:** 2-6 (voice-first), 2-6b (voice pipeline v2), 2-14 (mental model)

**Prerequisites:** Premium tier OR beta-Premium flag active. ElevenLabs API key + voice ID configured.

**Demo path:**
1. Complete VT-2-T1 through step 7
2. Tap "Start with voice"
3. Voice session initializes: `POST /v1/voice/token` → ElevenLabs WebSocket opens
4. Lumi speaks the first signal question ("Who's in your family?")
5. User speaks response → STT transcript appears in UI
6. Repeat for second + third signal questions
7. Onboarding advances to consent step

**Verification:**
- `audit_log`: `voice.session_started`, `voice.session_ended` rows
- `voice_usage` increments by session duration
- Each user turn persisted with `modality='voice'`
- Onboarding state machine advances through `voice → consent → cultural-ratification`

**Known issue:** Earlier session hit `ELEVENLABS_VOICE_ID` env validation failure. Confirm `.env.local` has all required ElevenLabs vars before testing this thread.

---

## VT-2-T7 — Text onboarding interview

**Stories exercised:** 2-7 (text path), 2-14

**Prerequisites:** Same as VT-2-T1 setup, no voice infra required.

**Demo path:**
1. Complete VT-2-T1 through step 7
2. Tap "I'd rather type"
3. Three signal questions render as text inputs (one at a time)
4. Type response → submit → next question
5. After question 3 → onboarding advances to consent step

**Verification:**
- Each user turn persisted with `modality='text'`
- Same state machine progression as voice path
- Mental-model copy from 2-14 renders on screen during the interview

---

## VT-2-T8 — Parental notice gate

**Stories exercised:** 2-9

**Prerequisites:** User with `parental_notice_acknowledged_at IS NULL`.

**Demo path:**
1. Log in (or signup fresh)
2. Navigate to any surface that collects child data (e.g., `/onboarding`, `/app/children/:id`)
3. Expect: parental notice dialog renders BEFORE the surface content
4. Tap "I understand" → `PATCH /v1/users/me` writes `parental_notice_acknowledged_at` + `parental_notice_acknowledged_version`
5. Dialog closes; the original surface renders
6. Navigate away and back — dialog does NOT reappear

**Verification:**
- `audit_log`: `parental_notice.acknowledged` row with version
- `users.parental_notice_acknowledged_at` populated

---

## VT-2-T9 — COPPA soft-VPC signed declaration (beta cohort)

**Stories exercised:** 2-8

**Prerequisites:** `households.in_beta = true` for the signup household.

**Demo path:**
1. During VT-2-T1 signup flow, before child data collection, soft-VPC step appears
2. Parent reads declaration ("I confirm I am the parent/guardian of children in this household")
3. Tap "I confirm" → `POST /v1/compliance/vpc` with `mechanism='soft_vpc'`
4. Onboarding proceeds

**Verification:**
- `vpc_consents` row: `mechanism='soft_vpc'`, `consented_at` set, `household_id` matches
- Audit row `vpc.soft_vpc_signed`

**Note:** Post-launch this is replaced by CC-VPC (Epic 10 10-S1). Beta cohort stays on soft-VPC indefinitely per Story 10.1 dev notes.

---

## VT-2-T10 — Add a child profile

**Stories exercised:** 2-10

**Prerequisites:** User logged in, household exists, parental notice acknowledged.

**Demo path:**
1. Navigate to add-child form (during onboarding OR from `/app` empty state)
2. Enter: name = "Layla", age band = "7-9", declared allergens = `["peanut"]`
3. Submit → `POST /v1/households/:id/children`
4. Network: 201 response with child id
5. Child appears in household's child list

**Verification:**
- `children` row: `name`, `age_band`, `declared_allergens` populated
- Sensitive fields (name, allergens) **envelope-encrypted at rest** — verify by `SELECT name FROM children` in Supabase SQL editor; should see ciphertext, not "Layla"
- App still reads "Layla" because decryption happens at API layer
- `audit_log`: `child.created` row

---

## VT-2-T11 — Cultural template inferred + ratified

**Stories exercised:** 2-11

**Prerequisites:** Onboarding interview in progress (voice or text).

**Demo path:**
1. In the third signal question, mention a cultural-identifier phrase ("we celebrate Diwali every November" or "Nani's biryani is a Friday thing")
2. Onboarding interview completes → cultural-ratification step shows inferred template ("Bengali household — keep dal-rice rotations, honor Diwali, family addresses 'Nani' for grandmother")
3. Tap "Yes, that fits" → `POST /v1/cultural-priors/ratify`

**Verification:**
- `cultural_priors` row: `household_id` matches, `template='bengali'` (or whatever was inferred), `state='active'`, `consented_at` set
- `audit_log`: `cultural_prior.ratified` row
- Future plan generation reads this prior

**Known partial:** If the user mentions no cultural identifier, the ratification step is skipped — flow goes straight to mental-model step. Verify this skip path too.

---

## VT-2-T12 — Per-child bag composition

**Stories exercised:** 2-12

**Prerequisites:** VT-2-T10 complete (child exists).

**Demo path:**
1. After adding child, bag composition form appears
2. Configure Snack slot ("apple slices, water bottle") and Extra slot ("granola bar")
3. Submit → `POST /v1/children/:id/bag-composition`

**Verification:**
- `children.bag_composition` JSONB column: `{snack: {...}, extra: {...}}`
- Audit: `child.bag_composition_set`
- Visible later in `/app/children/:id/bag-composition` route (γ Phase 5 mounted this)

---

## VT-2-T13 — Account profile edit

**Stories exercised:** 2-4

**Prerequisites:** Logged-in user.

**Demo path:**
1. Navigate to `/account`
2. Edit display name → "Sarah" → save → see "Saving..." then confirmed
3. Edit preferred_language → "es" → save
4. Tap "Change email" → enter new email → save
5. Tap "Send password reset email" → confirmation message
6. Reload page → all fields persist

**Verification:**
- `users` row: `display_name`, `preferred_language`, `email` updated
- Step 4: 409 if new email already in use (test by trying a duplicate)
- Step 5: `audit_log.auth.password_reset_requested` row

---

## VT-2-T14 — Notification + cultural language preferences

**Stories exercised:** 2-5

**Prerequisites:** Logged-in user.

**Demo path:**
1. Navigate to `/account` → Notifications section
2. Toggle "Weekly plan ready" off → UI updates optimistically → `PATCH /v1/users/me/notifications` → 200
3. Reload page → toggle still off
4. Family Language section → currently shows "default (Grandma, Grandpa)"
5. Change to "south_asian (Nani, Nana, Dadi, Dada)" → save
6. Try to change back to "default" → blocked with "Family language cannot be changed back once set" copy

**Verification:**
- `users.notification_prefs.weekly_plan_ready = false`
- `users.cultural_language = 'south_asian'`
- Audit: `account.preferences_updated`
- The forward-only ratchet (step 6) is enforced server-side, not just UI

---

## VT-2-T15 — memory_nodes seeded from onboarding

**Stories exercised:** 2-13

**Prerequisites:** Completed onboarding (T6 or T7 + T10 + T11).

**Demo path:**
1. After onboarding completes, immediately query: `SELECT * FROM memory_nodes WHERE household_id = $me`
2. Expect rows for: each child's name/age, declared allergens, cultural template, parent-stated dietary preferences

**Verification:**
- Each row has `source_type='onboarding'`, `source_ref` linking to the originating turn or form submission
- `confidence` populated
- These rows feed Epic 5 5-S7 (passive memory enrichment) and Epic 7 7-S1 (Visible Memory read)

---

## VT-2-T16 — Caregiver invite generation

**Stories exercised:** 2-3

**Prerequisites:** Primary parent logged in.

**Demo path:**
1. Navigate to settings → "Invite caregiver"
2. Enter partner's email → submit → `POST /v1/auth/invites` with `role='secondary'`
3. Server issues signed JWT (14-day TTL) → stores `jti` in `invite_jti` table for single-use enforcement
4. Email sent via SendGrid containing the invite link

**Verification:**
- `invite_jti` row: `jti`, `expires_at` set 14 days out, `used=false`
- Email delivered; link includes the JWT

**Note:** Redemption is Epic 5 5-S2 (currently backlog). This thread only verifies the generation side.

---

## VT-2-T17 — Post-login routing logic ✅ FIX SHIPPED (2-S19, awaiting manual verification)

**Stories exercised:** 2-1 (integration of routing decisions)

**Prerequisites:** Three test users in different states:
- User A: `is_first_login=true`, no children
- User B: `is_first_login=false`, at least 1 child + a plan
- User C: `is_first_login=false`, BUT no children (interrupted onboarding — manually delete child rows after T10 to simulate)

**Demo path:**
1. Log in as User A → expect redirect to `/onboarding` ✅
2. Log out
3. Log in as User B → expect redirect to `/app` → Brief renders with plan tiles ✅
4. Log out
5. Log in as User C → currently lands at `/app` empty state ❌ **broken thread**

**Verification:**
- Steps 1 + 3: pass as documented
- Step 5: User C should be routed back to `/onboarding` (or a "resume your onboarding" surface), not dumped at `/app` empty state with no recovery path

**Fix shipped via slice 2-S19** (2026-05-12). The API now derives `is_onboarded` from `users.parental_notice_acknowledged_at IS NOT NULL` AND has at least one `children` row. The login response includes `is_onboarded`; client routing in `login.tsx` and `callback.tsx` checks this field — falls through to `/onboarding` whenever the user isn't fully onboarded, regardless of `is_first_login`.

**Manual verification still pending** — walk this thread on the dev environment to confirm the User C case (step 5) now routes correctly to `/onboarding`. When that passes, change this thread's status from "fix shipped, awaiting verification" to "verified".

Implementation: see `2-s19-resume-incomplete-onboarding.md` for the slice spec. Tests at `apps/web/src/routes/auth/login.test.tsx` (3 new routing cases) and `apps/api/src/modules/auth/auth.service.test.ts` (truth-table for the 3 user states) cover the logic.

---

## What this catalog does NOT verify

These threads cover **user-visible feature integration**. They don't cover:

- **Performance** — anchor-device LCP, plan-gen p95 latency (Stories 1.13 + 9.2 cover these via Lighthouse + Grafana)
- **Security boundary tests** — RBAC role enforcement edge cases (covered by 2-2's unit tests)
- **Voice cost tracking** — `voice_usage` aggregation correctness (5-S16/10-S5 will surface)
- **Audit-log retention** — 12mo/10y/7y policies (Epic 9 9-S7 catalog)
- **Concurrent-write races** — Stories 1.3, 1.10 foundation gates
- **Audit-coverage exhaustiveness** — Epic 9 9-S8 owns end-to-end verification

If you walk through all 17 threads and they pass, you've verified that Epic 2's **user-facing happy paths and one explicitly-broken edge case** work as the stories claim.

---

## Recommended next steps

1. **Walk through each thread on a running dev environment.** Track results per thread (pass / fail / partial / blocked).
2. **For any thread that fails:** open a fix task or file a new slice. VT-2-T17 is the known one to start with.
3. **Decide whether to expand the catalog** to Epic 3 (~16 threads) and Epic 12 done (~5 threads) once you've validated this Epic 2 pilot is useful.

If a thread reveals a real production gap, that's signal the catalog format works. If most threads pass cleanly with no surprises, the catalog is still useful as a regression baseline but lower-priority to expand.
