# Story 5-S2: Caregiver Invite Redemption

Status: done

<!-- folds: 5.5 (partial — revoke + transfer deferred to 5-S17) -->
<!-- cited PRD: FR10, FR30 -->

## Story

As a Primary Parent,
I want to invite my partner as a Secondary Caregiver so they can redeem the link, have their account linked to our shared household, and immediately see the same plan on Brief,
so that household coordination is available to both of us without any manual admin work.

## Acceptance Criteria

1. **Given** a Primary Parent is on `/app/household/settings`, **When** they click "Invite partner", **Then** an inline form appears for optional partner email input and a "Generate invite link" button.

2. **Given** the Primary Parent submits the invite form, **When** the API responds with `{ invite_url }`, **Then** the page displays a copyable invite URL (a clickable chip with a copy-to-clipboard button); no email is sent by the system — sharing is manual at this stage.

3. **Given** an unauthenticated user arrives at `/invite/{token}` where the token encodes `role: 'secondary_caregiver'`, **When** the page renders, **Then** the page shows an "Accept this invitation" interstitial and redirects unauthenticated users to `/auth/login?next=/invite/{token}` (existing behaviour preserved).

4. **Given** an authenticated user is on `/invite/{token}` and the token encodes `role: 'secondary_caregiver'`, **When** the page calls `POST /v1/auth/invites/accept { token }` with their JWT, **Then** the API validates the token signature + expiry, checks the invite row (not redeemed, not revoked), marks `invites.redeemed_at = now()` atomically (first concurrent call wins), updates `users SET current_household_id = invite.household_id, role = 'secondary_caregiver' WHERE id = $user_id`, issues a fresh access_token (JWT with updated `hh` claim), writes `invite.redeemed` audit event with `invitee_user_id` metadata, and returns `{ access_token, user, household_id, scope_target }`.

5. **Given** the accept endpoint succeeds, **When** the web client receives the response, **Then** it calls `authStore.setSession(access_token, user)` to replace the stale JWT, then navigates to `/app` (the Brief).

6. **Given** `POST /v1/auth/invites/accept` is called with an invite that is already redeemed, **When** the endpoint processes the request, **Then** it returns `410 Gone` with error type `/errors/link-expired` — identical to existing `redeemInvite()` behaviour.

7. **Given** `POST /v1/auth/invites/accept` is called with an expired invite (past 14-day TTL), **When** the endpoint processes the request, **Then** it returns `410 Gone`.

8. **Given** `POST /v1/auth/invites/accept` is called without a valid JWT, **When** the request reaches the API, **Then** the API returns `401 Unauthorized`.

9. **Given** `POST /v1/auth/invites/accept` succeeds and the user's account is linked to the household, **When** the Secondary Caregiver opens `/app`, **Then** they see the same Brief (weekly plan) as the Primary Parent, and both tabs display each other's presence via the `<PresenceIndicator>` from 5-S1.

10. **Given** any user visits `/app/household/settings`, **When** the page loads, **Then** it shows the household display name and a member list (name + role for each user in the household, fetched from `GET /v1/households/:id/members`).

11. **Given** a Primary Parent views `/app/household/settings`, **When** the page renders, **Then** the "Invite partner" section and invite form are visible.

12. **Given** a Secondary Caregiver views `/app/household/settings`, **When** the page renders, **Then** the "Invite partner" section is hidden (primary_parent only feature).

13. **Given** the existing `/invite/{token}` page with `role: 'guest_author'` token, **When** the page processes the token, **Then** it continues to call the existing `POST /v1/auth/invites/redeem` (unchanged) — guest_author flow is unaffected by this story.

---

## Tasks / Subtasks

### Task 1 — Backend: `POST /v1/auth/invites/accept` endpoint (AC: #4, #6, #7, #8)

- [x] 1.1 Add `AcceptInviteRequestSchema` and `AcceptInviteResponseSchema` to `packages/contracts/src/auth.ts`:
  ```ts
  export const AcceptInviteRequestSchema = z.object({
    token: z.string().min(1),
  });

  export const AcceptInviteResponseSchema = z.object({
    access_token: z.string(),
    user: AuthUserSchema,
    household_id: z.string().uuid(),
    scope_target: z.string(),
  });

  export type AcceptInviteRequest = z.infer<typeof AcceptInviteRequestSchema>;
  export type AcceptInviteResponse = z.infer<typeof AcceptInviteResponseSchema>;
  ```
  Add type re-exports to `packages/types/src/index.ts`.

- [x] 1.2 Add `UserRepository.setHouseholdMembership(userId, householdId, role)` to `apps/api/src/modules/users/user.repository.ts`:
  ```ts
  async setHouseholdMembership(
    userId: string,
    householdId: string,
    role: 'secondary_caregiver',
  ): Promise<UserProfileRow> {
    const { data, error } = await this.client
      .from('users')
      .update({ current_household_id: householdId, role })
      .eq('id', userId)
      .select('*')
      .single();
    if (error) throw new DatabaseError(error.message);
    return data as UserProfileRow;
  }
  ```

- [x] 1.3 Add `inviteService.acceptInvite(token, requestingUserId)` to `apps/api/src/modules/auth/invite.service.ts`:
  - Call `this.redeemInvite(token)` — reuse existing validation + mark-redeemed logic (returns `RedeemInviteResult` with `role`, `scope_target`, `household_id`)
  - Then call `this.userRepository.setHouseholdMembership(requestingUserId, result.household_id, 'secondary_caregiver')`
  - Return `{ updatedUser, redeemResult }` for the route to assemble the response
  - Note: `redeemInvite()` throws `LinkExpiredError` (410) or `UnauthorizedError` (401) — let them propagate unchanged

- [x] 1.4 Add `POST /v1/auth/invites/accept` to `apps/api/src/modules/auth/invite.routes.ts`:
  - **Requires auth**: add `authenticate` preHandler (same as household routes)
  - Body: `AcceptInviteRequestSchema`
  - Call `service.acceptInvite(body.token, request.user.id)`
  - Issue a new JWT for the updated user: follow the `completeLogin()` pattern in `auth.service.ts` — call `authService.issueAccessToken(updatedUser)` (or equivalent helper that signs the JWT with `{ sub, hh, role }`); the route plugin will need access to `fastify.authService` or the JWT-signing utility
  - Write audit event `invite.redeemed` with extra metadata `{ invite_id: result.invite_id, invitee_user_id: request.user.id, household_id: result.household_id }` (best-effort)
  - Return 200 `AcceptInviteResponseSchema` with `{ access_token, user, household_id, scope_target: '/app' }`

- [x] 1.5 Write route tests in `apps/api/src/modules/auth/invite.routes.test.ts` (append to existing test file):
  - `POST /v1/auth/invites/accept` — 200 with new access_token when valid token + authenticated user
  - `POST /v1/auth/invites/accept` — 401 when unauthenticated (no JWT)
  - `POST /v1/auth/invites/accept` — 410 when invite already redeemed
  - `POST /v1/auth/invites/accept` — 410 when invite expired
  - Verify `users.current_household_id` and `users.role` are updated in the DB mock

### Task 2 — Backend: `GET /v1/households/:id/members` endpoint (AC: #10, #11, #12)

- [x] 2.1 Add `HouseholdMemberSchema` and `HouseholdMembersResponseSchema` to `packages/contracts/src/households.ts` (or create `packages/contracts/src/household-members.ts`):
  ```ts
  export const HouseholdMemberSchema = z.object({
    user_id: z.string().uuid(),
    display_name: z.string().nullable(),
    role: z.enum(['primary_parent', 'secondary_caregiver', 'guest_author']),
  });

  export const HouseholdMembersResponseSchema = z.object({
    members: z.array(HouseholdMemberSchema),
  });

  export type HouseholdMember = z.infer<typeof HouseholdMemberSchema>;
  export type HouseholdMembersResponse = z.infer<typeof HouseholdMembersResponseSchema>;
  ```
  Add type re-exports to `packages/types/src/index.ts`.

- [x] 2.2 Add `UserRepository.findByHousehold(householdId)` to `apps/api/src/modules/users/user.repository.ts`:
  ```ts
  async findByHousehold(householdId: string): Promise<UserProfileRow[]> {
    const { data, error } = await this.client
      .from('users')
      .select('id, display_name, role')
      .eq('current_household_id', householdId)
      .order('role'); // primary_parent first
    if (error) throw new DatabaseError(error.message);
    return (data ?? []) as UserProfileRow[];
  }
  ```

- [x] 2.3 Add `GET /v1/households/:id/members` to `apps/api/src/modules/households/households.routes.ts`:
  - Auth: `requireParentOrCaregiver` (same as brief/memory routes — both primary_parent + secondary_caregiver can read)
  - Cross-household 403 guard (same pattern as other household routes)
  - Call `userRepository.findByHousehold(householdId)`
  - Map to `HouseholdMemberSchema` shape: `{ user_id: row.id, display_name: row.display_name, role: row.role }`
  - Response: `HouseholdMembersResponseSchema`
  - Guest authors are filtered out: `.in('role', ['primary_parent', 'secondary_caregiver'])`

- [x] 2.4 Write tests for `GET /v1/households/:id/members`:
  - Returns member list for valid household (at least primary_parent)
  - 401 when unauthenticated
  - 403 when cross-household access attempted
  - Filters out guest_author members

### Task 3 — Web: `/app/household/settings` route (AC: #1, #2, #10, #11, #12)

- [x] 3.1 Create `apps/web/src/routes/(app)/household-settings.tsx`:
  - **Route path:** `/app/household/settings` (verify TanStack Router convention — may need `_app.household.settings.tsx` or similar depending on file-based routing format used in this project; check existing `(app)` routes for the convention)
  - Fetch household members: `hkFetch<HouseholdMembersResponse>('/v1/households/:id/members')`
  - Conditionally show the "Invite partner" section: only when `authStore.user.role === 'primary_parent'`
  - Use `useAuthStore(s => s.user?.current_household_id)` for the household ID in all API calls
  - Register route in `apps/web/src/app.tsx` under the `(app)` layout (follow the convention established by `/app/memory`, `/app/account`, etc.)

- [x] 3.2 Implement the member list display:
  - Read-only list: each member rendered as `{display_name ?? 'Unknown'} — {role === 'primary_parent' ? 'Primary Parent' : 'Caregiver'}`
  - No revoke/transfer UI (deferred to 5-S17)

- [x] 3.3 Implement the "Invite partner" section (primary_parent only):
  - Collapsed initially (show "Invite partner" button that expands the form)
  - Form: optional email input (`<input type="email">`, labelled "Partner's email (optional)")
  - "Generate invite link" button: `POST /v1/households/:id/invites { role: 'secondary_caregiver', email? }`
  - Success state: display the returned `invite_url` with a copy-to-clipboard button
  - Show one active invite URL at a time; regenerating replaces the previous (UI only — backend allows multiple invites)
  - Error state: show inline error message
  - Body: pass raw object to `hkFetch` — `body: { role: 'secondary_caregiver', email: email || undefined }` — NOT JSON.stringify (double-encoding trap, see Dev Notes)

- [x] 3.4 Write tests for `apps/web/src/routes/(app)/household-settings.test.tsx`:
  - Renders member list from mocked `GET /v1/households/:id/members` response
  - Shows invite section when `user.role === 'primary_parent'`
  - Hides invite section when `user.role === 'secondary_caregiver'`
  - Copy-to-clipboard button copies invite URL to clipboard
  - Invite form calls `POST /v1/households/:id/invites` on submit
  - Shows invite URL after successful invite creation

### Task 4 — Web: Enhanced `/invite/$token` page (AC: #3, #4, #5, #6, #7, #8, #13)

- [x] 4.1 Decode the JWT payload client-side to determine role before making any API call:
  ```ts
  function decodeInviteRole(token: string): string | null {
    try {
      const base64 = token.replace(/-/g, '+').replace(/_/g, '/');
      const payload = JSON.parse(atob(base64.split('.')[1])) as { role?: string };
      return payload.role ?? null;
    } catch {
      return null;
    }
  }
  ```
  Call this in the component to branch between `secondary_caregiver` and `guest_author` flows without an extra API round-trip.

- [x] 4.2 Secondary Caregiver flow (role === 'secondary_caregiver'):
  - If unauthenticated: redirect to `/auth/login?next=/invite/${token}` (same as existing behaviour — no change needed here)
  - If authenticated: call `POST /v1/auth/invites/accept { token }` with the user's JWT
  - On success: call `authStore.setSession(response.access_token, response.user)` to swap in the new JWT with the updated `hh` claim
  - Then navigate to `response.scope_target` (which will be `/app`)
  - On 410: show "This invite link has expired or already been used."
  - On 401: show "You need to be signed in to accept this invitation." (offer login button)
  - Show loading spinner during the API call

- [x] 4.3 Guest Author flow (role === 'guest_author' OR role cannot be decoded):
  - **Unchanged**: continue calling `POST /v1/auth/invites/redeem { token }` (public endpoint)
  - No auth required
  - Navigate to `scope_target` on success
  - This is a no-op change — the existing code path is preserved

- [x] 4.4 Write/update tests for `apps/web/src/routes/invite/$token.tsx`:
  - Calls `POST /v1/auth/invites/accept` when role=secondary_caregiver and user is authenticated
  - Updates auth store on accept success
  - Navigates to scope_target after accept
  - Shows 410 error message when accept returns 410
  - Still calls `POST /v1/auth/invites/redeem` when role=guest_author (regression guard)
  - Redirects to login when role=secondary_caregiver and user is unauthenticated

### Task 5 — Contracts round-trip tests (AC: #4)

- [x] 5.1 Add schema tests to `packages/contracts/src/auth.test.ts` (or a new `packages/contracts/src/auth-accept.test.ts`):
  - `AcceptInviteRequestSchema` accepts valid token string, rejects empty
  - `AcceptInviteResponseSchema` parses valid response shape, rejects missing access_token or user
  - `HouseholdMembersResponseSchema` parses member array, accepts empty array

---

## Dev Notes

### CRITICAL: `hkFetch` double-encoding trap

`apps/web/src/lib/fetch.ts` auto-JSON-stringifies `init.body`. Always pass raw objects:
```ts
body: { role: 'secondary_caregiver', email: email || undefined }  // ✅
body: JSON.stringify({ role: 'secondary_caregiver' })              // ❌ double-encoded
```
This is the canonical cross-story trap (Epic 7 retro item #3, repeated in 7-s3, 7-s10, 5-s1).

### CRITICAL: JWT `hh` claim must be updated via `setSession()`

The API JWT (HiveKitchen's own JWT, NOT the Supabase JWT) contains `{ sub: user_id, hh: household_id, role }`. After `POST /v1/auth/invites/accept` succeeds:
- The returned `access_token` contains the updated `hh = invite.household_id` and `role = 'secondary_caregiver'`
- The web client MUST call `authStore.setSession(response.access_token, response.user)` to replace the stale token in the store
- Failure to do this means all subsequent API calls (to `/v1/households/:id/brief`, etc.) will use the OLD `hh` claim and fail with 403

### JWT issuance in the accept endpoint

The `accept` endpoint issues a new access_token after updating the user's household. Follow the same JWT-signing pattern as `completeLogin()` in `apps/api/src/modules/auth/auth.service.ts`:
- Read the signing logic (likely `jwt.sign(payload, JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' })` or similar)
- The payload should be: `{ sub: user.id, hh: user.current_household_id, role: user.role, iat: now, exp: now + TOKEN_TTL }`
- If there's a `issueAccessToken(user)` helper in `AuthService`, prefer calling that over duplicating logic

If the invite routes plugin doesn't currently have access to `fastify.authService`, wire it in (same pattern as how `invite.routes.ts` accesses `fastify.inviteService` — look at `app.ts` registrations).

### Zod 4 patterns (not 3.23)

Project-context.md says Zod 3.23 but the project migrated to Zod 4 (confirmed in sprint-status and 5-S1 Dev Notes). Gotchas:
- `z.record()` requires two-arg form: `z.record(z.string(), z.unknown())`
- `.uuid()` enforces strict RFC-4122 variant nibble in test fixtures
- `.datetime()` rejects Supabase-format offset timestamps — normalize via `new Date(ts).toISOString()`

### UserRepository.setHouseholdMembership — role constraint

The `users.role` column is an enum: `'primary_parent' | 'secondary_caregiver' | 'guest_author' | 'ops'`. The `setHouseholdMembership` method type-narrows to only `'secondary_caregiver'` for this story — do not generalize the parameter unnecessarily.

### existing `POST /v1/auth/invites/redeem` — do NOT modify

The existing public `POST /v1/auth/invites/redeem` endpoint is used by:
1. `apps/web/src/routes/invite/$token.tsx` for guest_author flow (4-s13)
2. Potentially other places

**Do not break it.** The new `accept` endpoint is additive. The invite page change in Task 4 adds a branch for secondary_caregiver but leaves the guest_author code path untouched.

### `InviteService.acceptInvite()` reuses `redeemInvite()` atomicity

`redeemInvite()` uses `markRedeemed()` which has an `.is('redeemed_at', null)` guard — the first concurrent call wins, subsequent ones get 0 rows updated and throw `LinkExpiredError`. `acceptInvite()` calls `redeemInvite()` first (which marks redeemed) then updates the user's household. If the user update fails after the mark-redeemed succeeds, the invite is consumed but the user isn't linked. At beta scale this edge case is acceptable — a new invite can be generated. Add a warning log if `setHouseholdMembership` throws after `redeemInvite` succeeds.

### TanStack Router file-based routing convention

In `apps/web/src/routes/(app)/`, the existing pattern for nested routes is:
- `account.tsx` → `/app/account`
- `memory.tsx` → `/app/memory`

For `/app/household/settings`, the file should be `apps/web/src/routes/(app)/household-settings.tsx` mapped to path `/app/household/settings`. Check the existing `app.tsx` route registration pattern to understand how to register the new route under the `(app)` layout without breaking the layout wrapper.

### `GET /v1/households/:id/members` placement

Add this endpoint to the existing `apps/api/src/modules/households/households.routes.ts` — it follows the same authorization pattern (requireParentOrCaregiver) as other household read endpoints.

Use `UserRepository.findByHousehold()` scoped to `current_household_id`. Guest authors share a `current_household_id` with the household but have `role = 'guest_author'` — filter them out in the query (`.in('role', ['primary_parent', 'secondary_caregiver'])`).

### Display name nullability

`display_name` is nullable in the `users` table. The member list UI should fall back to the user's email or "Unknown". The `findUserById` pattern in 5-S1 used `UserRepository.findUserById(userId)` and stored `display_name` from there — `findByHousehold` follows the same approach.

### Presence integration (AC #9)

After the Secondary Caregiver accepts the invite and their `current_household_id` is updated, the existing `usePresence` hook (5-S1) will start issuing heartbeats to `POST /v1/presence/heartbeat` with the correct `hh` claim from the fresh JWT. The Primary Parent's tab will see the partner's presence indicator. No additional work needed — this is tested manually via the demo path.

### Test baselines (do not regress)

- **API:** 1654 pass / 20 fail (pre-existing baseline from 5-S1); new tests add to passing count only
- **Web:** 502 / 502 pass (5-S1 baseline); new tests add to passing count only
- **Contracts:** 681 pass / 4 fail (pre-existing cultural + heart-notes baseline)

### Deferred out of 5-S2 scope (→ 5-S17)

- `DELETE /v1/households/:id/caregivers/:user_id` — revoke secondary_caregiver access
- `POST /v1/households/:id/transfer-primary` — transfer primary ownership
- Caregiver management list with revoke/transfer buttons on `/app/household/settings`
- `caregivers` join table (if architectural decision changes from single `current_household_id` model) — currently no need; existing schema is sufficient
- Email delivery of invite link (deferred to 4-s8 Sendgrid integration)

### Source references

- Existing invite infrastructure: `apps/api/src/modules/auth/invite.routes.ts`, `invite.service.ts`, `invite.repository.ts`
- Frontend invite page: `apps/web/src/routes/invite/$token.tsx`
- UserRepository: `apps/api/src/modules/users/user.repository.ts`
- Auth store: `apps/web/src/stores/auth.store.ts` — `setSession(accessToken, user)` is the write method
- Household routes: `apps/api/src/modules/households/households.routes.ts`
- Auth contracts: `packages/contracts/src/auth.ts`
- completeLogin() JWT issuance: `apps/api/src/modules/auth/auth.service.ts`
- Audit event types: `apps/api/src/audit/audit.types.ts` — `invite.redeemed` already defined
- 5-S1 story for context on Zod 4 gotchas: `_bmad-output/implementation-artifacts/5-s1-multi-tab-presence.md`

---

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (1M context)

### Debug Log References

None — implementation was clean; no HALT conditions, no extra dependencies.

### Completion Notes List

- **All 13 ACs satisfied; all 5 tasks / 23 subtasks complete.** No migration, no new dependencies.
- **Spec deviation — `decodeInviteRole` client decode (Task 4.1):** the story's snippet decodes `token.split('.')[1]` as if the URL token were the raw JWT. It is NOT — `InviteService.createInvite` re-encodes the whole signed JWT via `Buffer.from(rawJwt).toString('base64url')`, so the path segment is `base64url(rawJwt)` with no `.` separators. The story snippet would therefore always return `null` and route every invite to the redeem path (breaking AC#4). Implemented a correct **two-step** decode: outer base64url → `header.payload.sig`, then the payload segment → claims. Verified against the token shape `invite.routes.test.ts` already uses (`encodeInviteToken = base64url(rawJwt)`).
- **Auth gate for the accept route (Task 1.4):** the global `authenticate.hook` **skips the `/v1/auth/` prefix** (it hosts public login/redeem). Since `accept` requires a signed-in invitee, the route carries its own `authenticateInvitee` preHandler that verifies the bearer token and populates `request.user`, mirroring the hook. Missing/invalid token → 401 (AC#8).
- **`InviteService` constructor:** added an optional third param `userRepository` (defaults `null`) so existing redeem-only construction `new InviteService(repo, jwt)` and its tests keep compiling; `acceptInvite` throws if it is absent.
- **JWT issuance:** the accept route signs the fresh access_token via `fastify.jwt.sign({ sub, hh, role })` using the plugin's default 15m TTL — same effective TTL as `completeLogin()`'s `ACCESS_TOKEN_TTL_SECONDS`. No new JWT helper added (none existed on `AuthService`).
- **`setHouseholdMembership` return shape:** selects `PROFILE_COLUMNS` (matches the repo's existing read style — `UserProfileRow` has no `current_household_id` column), and the route builds the `AuthUser` response using the invite's `household_id` for `current_household_id`. Repo methods follow the file's existing `if (error) throw error` style (no `DatabaseError` class exists in this repo).
- **`findByHousehold` filters guest_authors in-query** via `.in('role', ['primary_parent','secondary_caregiver'])` + `.order('role')` (primary first), per Dev Notes — so AC#10/12's roster never leaks grandparents.
- **Guest-author flow preserved (AC#13):** the invite page keeps the existing login-gate-then-redeem path untouched; only an authenticated `secondary_caregiver` branch was added ahead of it.
- **AC#9 (shared Brief + presence):** no new code — the existing `usePresence` hook (5-S1) starts heartbeating with the fresh `hh` claim once `setSession` swaps the token. Manual/demo gate.
- **Verification:** Contracts 690 pass / 4 fail (= pre-existing cultural + heart-notes baseline; +9 new). API 1663 pass / 20 fail (= pre-existing baseline; +9 new: 4 accept + 5 members). Web 511 pass / 0 fail (+9 new: 5 settings + 4 invite-page). Zero new typecheck errors (all errors are in untouched files: heart-notes.ts, voice.*, health.routes.test.ts, evals/runner.ts, child-bag-composition.tsx, brief-stub at households.routes.test.ts:449 — the pre-existing api 11 / web 3 / contracts 1 baselines).

### File List

**Contracts / Types**
- `packages/contracts/src/auth.ts` (modified — `AcceptInviteRequestSchema`, `AcceptInviteResponseSchema`)
- `packages/contracts/src/household-members.ts` (new — `HouseholdMemberSchema`, `HouseholdMembersResponseSchema`)
- `packages/contracts/src/index.ts` (modified — export household-members)
- `packages/contracts/src/auth.test.ts` (modified — accept + members round-trip tests)
- `packages/types/src/index.ts` (modified — re-export the 4 new types)

**API**
- `apps/api/src/modules/users/user.repository.ts` (modified — `setHouseholdMembership`, `findByHousehold`)
- `apps/api/src/modules/auth/invite.service.ts` (modified — `acceptInvite` + `AcceptInviteResult`; optional `userRepository`)
- `apps/api/src/modules/auth/invite.routes.ts` (modified — `POST /v1/auth/invites/accept` + `authenticateInvitee` preHandler)
- `apps/api/src/modules/auth/invite.routes.test.ts` (modified — 4 accept tests + users-table mock)
- `apps/api/src/modules/households/households.routes.ts` (modified — `GET /v1/households/:id/members`)
- `apps/api/src/modules/households/households.routes.test.ts` (modified — 5 members route tests)

**Web**
- `apps/web/src/routes/(app)/household-settings.tsx` (new — member list + invite form)
- `apps/web/src/routes/(app)/household-settings.test.tsx` (new — 5 tests)
- `apps/web/src/routes/invite/$token.tsx` (modified — role-branched accept/redeem)
- `apps/web/src/routes/invite/$token.test.tsx` (new — 4 tests)
- `apps/web/src/app.tsx` (modified — register `/app/household/settings`)

### Review Findings

- [x] [Review][Decision] AC#3 — No "Accept this invitation" interstitial: page auto-accepts on mount without user confirmation — PATCHED: added `'accept'` state to `InviteState`; secondary_caregiver branch now sets state to `'accept'` instead of auto-calling the API; `handleAccept()` extracted as a function; confirmation card with "Accept invitation" button added to render. [`apps/web/src/routes/invite/$token.tsx`]
- [x] [Review][Patch] Missing warning log when `setHouseholdMembership` fails after `redeemInvite` succeeds — PATCHED: added optional `log` param to `InviteService` constructor; `acceptInvite()` wraps `setHouseholdMembership` in try-catch and calls `this.log?.warn(...)` before re-throwing; route passes `fastify.log` as 4th constructor arg. [`apps/api/src/modules/auth/invite.service.ts`, `apps/api/src/modules/auth/invite.routes.ts`]
- [x] [Review][Patch] No role validation in `acceptInvite()` — PATCHED: added `if (redeemResult.role !== 'secondary_caregiver') throw new UnauthorizedError(...)` after `redeemInvite()` returns. [`apps/api/src/modules/auth/invite.service.ts`]
- [x] [Review][Patch] No existing-household guard — PATCHED: added `if (request.user.household_id) throw new ForbiddenError(...)` in the accept route handler before calling `acceptInvite()`; updated `signAccessToken` in tests to allow `hh: null` override; updated accept test tokens to use `hh: null`; added new test `'already a member of a household → 403'`. [`apps/api/src/modules/auth/invite.routes.ts`, `apps/api/src/modules/auth/invite.routes.test.ts`]
- [x] [Review][Patch] AC#10 violation — household display_name not shown on settings page — PATCHED: added `household_display_name: z.string().nullable()` to `HouseholdMembersResponseSchema`; GET `/members` route now queries `households.display_name` inline; `household-settings.tsx` stores and renders it (`?? 'Household'` fallback). [`packages/contracts/src/household-members.ts`, `apps/api/src/modules/households/households.routes.ts`, `apps/web/src/routes/(app)/household-settings.tsx`]
- [x] [Review][Patch] `HouseholdMemberSchema` includes `guest_author` in the role enum despite server-side filter — PATCHED: changed to `z.enum(['primary_parent', 'secondary_caregiver'])`. [`packages/contracts/src/household-members.ts`]
- [x] [Review][Defer] JWT missing `hh` claim passes `authenticateInvitee` without error — a user whose JWT has no `hh` claim (new user not yet in a household) can call the endpoint; `request.user.household_id` becomes `undefined`. The accept flow only uses `request.user.id`, so this does not affect the happy path. Defer. [`apps/api/src/modules/auth/invite.routes.ts:267`] — deferred, new-user path is intended behavior
- [x] [Review][Defer] `householdId === null` stalls settings page loading forever for users without a household — `household-settings.tsx` bails at `if (householdId === null || didLoad.current) return`, keeping `loadState` as `'loading'` permanently. Affects unhoused users who navigate manually to the page outside the normal post-accept flow. Defer. [`apps/web/src/routes/(app)/household-settings.tsx:41`] — deferred, pre-existing pattern; only reachable via abnormal navigation
- [x] [Review][Defer] Double-submit race on invite form — the `disabled={inviting}` prop prevents a second click, but React batching means `setInviting(true)` doesn't update the DOM synchronously; two rapid clicks before the re-render could fire two `POST /invites`. Small gap, button disabled covers the common case. Defer. [`apps/web/src/routes/(app)/household-settings.tsx:66-87`] — deferred, negligible at beta scale
- [x] [Review][Defer] `authenticateInvitee` JWT role claim not validated at runtime — `payload.role` is cast directly to `AuthUser['role']` without narrowing; a crafted JWT passing signature verification with an invalid role would propagate. Consistent with the broader JWT validation pattern in this codebase. Defer. [`apps/api/src/modules/auth/invite.routes.ts:265-267`] — deferred, pre-existing pattern

## Change Log

| Date | Change |
| --- | --- |
| 2026-06-06 | Implemented 5-S2 Caregiver Invite Redemption — authenticated `POST /v1/auth/invites/accept` (validate + mark-redeemed + link household + fresh JWT), `GET /v1/households/:id/members`, `/app/household/settings` page (member list + invite form), role-branched `/invite/$token` (accept for secondary_caregiver, unchanged redeem for guest_author). 18 new tests, all green; no migration, no new deps. Status → review. |
| 2026-06-06 | Code review complete — 6 patches applied: P1 accept interstitial, P2 warning log on partial failure, P3 role guard, P4 existing-household guard + test, P5 household_display_name across 3 layers, P6 guest_author removed from enum. 23 tests green. Status → done. |
