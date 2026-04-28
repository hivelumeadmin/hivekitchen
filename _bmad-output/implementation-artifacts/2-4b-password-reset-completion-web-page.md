# Story 2.4b: Password Reset Completion — Web Page + API Endpoint

Status: done

## Story

As a Primary Parent who has clicked a password reset link in their email,
I want to land on a page where I can enter my new password and have it confirmed immediately,
so that I can regain access to my account without contacting support (FR12).

## Context

Story 2-4 shipped the password reset *initiation* (`POST /v1/auth/password-reset` → email delivered). The *completion* half — the page users land on after clicking the email link — was explicitly deferred. Supabase is already configured to redirect to `{WEB_BASE_URL}/auth/reset-password` but that route does not exist yet. Users who click the reset link currently hit a dead route.

## Acceptance Criteria

**AC1 — Contract: `PasswordResetCompleteRequestSchema`**
- Add to `packages/contracts/src/users.ts`:
  ```typescript
  export const PasswordResetCompleteRequestSchema = z.object({
    token: z.string().min(1),
    password: z.string().min(12).max(128),
  });
  ```
- Add type to `packages/types/src/index.ts`: `export type PasswordResetComplete = z.infer<typeof PasswordResetCompleteRequestSchema>;`
- Import `PasswordResetCompleteRequestSchema` from `@hivekitchen/contracts` in `packages/types/src/index.ts`.
- Response reuses existing `LoginResponseSchema` (same shape as `POST /v1/auth/login`).
- Run `pnpm contracts:check` — verify export count increased by 1.

**AC2 — API endpoint: `POST /v1/auth/password-reset-complete`**
- **Public route** — URL starts with `/v1/auth/` → `authenticate.hook` skips it. Do NOT access `request.user`.
- Request validated against `PasswordResetCompleteRequestSchema`.
- Service calls `supabase.auth.verifyOtp({ token_hash: body.token, type: 'recovery' })` to exchange the Supabase recovery token.
  - If Supabase returns an error or null user → throw `GoneError` → **410** response.
- After successful token exchange: call `supabase.auth.admin.updateUserById(data.user.id, { password: body.password })` to set the new password.
- Returns **200** with `LoginResponseSchema` body — user is auto-logged in on success.
- Audit: `request.auditContext = { event_type: 'auth.password_reset_completed', request_id: request.id, metadata: {} }` — no `user_id` (public route), no password (PII).
- Tests (4 via `fastify.inject()`):
  1. Valid token + valid password → 200 with session body
  2. Expired/invalid token (Supabase returns error) → 410
  3. Password shorter than 12 chars → 400
  4. Missing `token` field → 400

**AC3 — Frontend route: `/auth/reset-password`**
- Route registered in `apps/web/src/app.tsx` as a public route alongside `login` and `callback`.
- Page renders regardless of whether the user is already authenticated.

*Token handling*
- On mount, extract `token_hash` from URL query params: `new URLSearchParams(window.location.search).get('token_hash')`.
- If `token_hash` is null or empty: render the inline expired-state immediately — no form shown.

*Form*
- Single "New password" field with show/hide toggle (matches `login.tsx` pattern — `<button type="button">` toggling `type="password"` / `type="text"`).
- React Hook Form + Zod resolver — client-side schema validates `password` min 12 / max 128, triggered on blur.
- Submit button label: "Reset password". Disabled during submission.
- Double-submission prevented via `useRef` flag (same pattern as `resetInProgress.current` in `account.tsx`).

*Happy path*
- On submit: `POST /v1/auth/password-reset-complete` with `{ token: tokenHash, password }` via `hkFetch`.
- On 200: `useAuthStore.getState().setSession(data.accessToken, data.user)` → `navigate('/app')`.

*Error states*
- **410 or no token in URL**: Inline — "This reset link has expired or already been used." + "Send a new link" anchor to `/auth/login`.
- **400 (validation)**: Inline field-level error below the password input.
- **Other / network error**: Generic inline — "Something went wrong. Please try again."

*Styling*
- Centered layout: `min-h-screen flex items-center justify-center px-6`.
- `max-w-sm w-full`. Serif heading, warm neutrals, honey-amber submit button — identical to `login.tsx`.
- Component ≤ 200 lines.

## Tasks / Subtasks

- [x] **Task 1 — Pre-flight** (AC: n/a)
  - [x] `LinkExpiredError` (410) already exists at `apps/api/src/common/errors.ts:50` — used instead of adding `GoneError`
  - [x] `'auth.password_reset_completed'` was missing — added to `audit.types.ts` AND new SQL migration `20260506000000_add_password_reset_completed_audit_type.sql` (ALTER TYPE)
  - [x] `LoginResponseSchema` exported from `@hivekitchen/contracts` (`auth.ts:26`)
  - [x] `supabase.auth.verifyOtp` is available on `fastify.supabase`
  - [x] No new npm packages required

- [x] **Task 2 — Contract + type** (AC: #1)
  - [x] Added `PasswordResetCompleteRequestSchema` to `packages/contracts/src/users.ts`
  - [x] Added `PasswordResetCompleteRequest` type to `packages/types/src/index.ts`
  - [x] Added 8 contract tests in `users.test.ts` (covers boundaries: min/max password, missing fields, empty token)
  - [x] `pnpm contracts:check` passes for new schema (pre-existing failures from Story 2-6/2-7 unrelated)

- [x] **Task 3 — API: service method** (AC: #2)
  - [x] **Dev decision**: Method added to `AuthService` (NOT `UserService` as story prescribed) — `completeLogin` is private to `AuthService` and the cookie-setting helpers live in `auth.routes.ts`. Architectural fit is much better since the route URL is under `/v1/auth/` anyway. Story dev notes anticipated this constraint ("If `completeLogin` is private or causes a circular import...").
  - [x] `AuthService.completePasswordReset({ token, password }): Promise<LoginResult>` — verifyOtp → updateUserById(password) → completeLogin
  - [x] On Supabase error/null user/missing email → throw `LinkExpiredError`
  - [x] On unexpected admin updateUserById error → throw generic Error (mapped to 500)

- [x] **Task 4 — API: route** (AC: #2)
  - [x] **Dev decision**: Route added to `apps/api/src/modules/auth/auth.routes.ts` (NOT `user.routes.ts` as story prescribed) — same architectural reasoning as Task 3. Reuses local helpers `setRefreshCookie` and `loginPayload`.
  - [x] `POST /v1/auth/password-reset-complete` — schema body=PasswordResetCompleteRequestSchema, response 200=LoginResponseSchema
  - [x] Sets refresh_token cookie on success (matches login/callback flow)
  - [x] auditContext: `{ event_type: 'auth.password_reset_completed', user_id, request_id, metadata: {} }`
  - [x] Route is automatically public — URL prefix `/v1/auth/` is in SKIP_PREFIXES

- [x] **Task 5 — Frontend page** (AC: #3)
  - [x] Created `apps/web/src/routes/auth/reset-password.tsx` (~120 lines)
  - [x] Extracts `token_hash` from `window.location.search` via `useMemo`
  - [x] No-token-on-mount → renders expired state immediately (no form)
  - [x] React Hook Form + Zod resolver (client-side `ResetPasswordFormSchema` — password only; token attached at submit)
  - [x] Show/hide password toggle button
  - [x] `submitInProgress` ref guards double-submission; finalizer resets the flag
  - [x] On 200: `setSession(access_token, user)` → `navigate('/app')`
  - [x] On 410: render same expired state (replaces form)
  - [x] On 400: inline error "Password must be 12–128 characters."
  - [x] On other: inline generic "Something went wrong. Please try again."
  - [x] Styling matches `login.tsx`: warm-neutral, honey-amber, serif heading, max-w-sm

- [x] **Task 6 — Register route** (AC: #3)
  - [x] Imported `ResetPasswordPage` in `apps/web/src/app.tsx`
  - [x] Registered `/auth/reset-password` between `/auth/callback` and `/invite/:token`

- [x] **Task 7 — Tests** (AC: #2)
  - [x] **Dev decision**: 4 tests added to `apps/api/src/modules/auth/auth.routes.test.ts` (NOT `user.routes.test.ts`) — co-located with the route per project convention.
  - [x] Extended `buildMockSupabase` to support `verifyOtp` and `admin.updateUserById`
  - [x] Test 1: happy path → 200 + session body + cookie + asserts `updateUserById` was called with `(userId, { password })`
  - [x] Test 2: expired token → 410 with `/errors/link-expired` + asserts `updateUserById` NOT called
  - [x] Test 3: short password → 400 validation
  - [x] Test 4: missing token field → 400 validation
  - [x] All 4 new tests pass; full API suite: 103 passed | 11 skipped
  - [x] Updated `audit.types.test.ts` to scan all migration files (CREATE TYPE + ALTER TYPE) for parity, not just one

## Dev Notes

### Supabase Recovery Token — URL Format

Supabase sends the recovery link as:
```
{WEB_BASE_URL}/auth/reset-password?token_hash=xxx&type=recovery
```

`token_hash` is a **query parameter**, not a URL hash fragment (PKCE-style, consistent with how the OAuth callback uses `?code=`). Extract it with:
```typescript
const tokenHash = new URLSearchParams(window.location.search).get('token_hash');
```

**Critical**: `detectSessionInUrl: false` is set on the Supabase browser client (`apps/web/src/lib/supabase-client.ts`). Supabase will NOT auto-process this token. The frontend must extract and forward it to the API.

### API Token Exchange

Use `fastify.supabase.auth.verifyOtp` (the non-admin client — NOT `auth.admin`):

```typescript
const { data, error } = await this.supabase.auth.verifyOtp({
  token_hash: token,
  type: 'recovery',
});
if (error || !data.user) throw new GoneError('Reset link expired or already used');
```

Then update password via admin:
```typescript
const { error: pwError } = await this.supabase.auth.admin.updateUserById(
  data.user.id,
  { password },
);
if (pwError) throw pwError; // unexpected — rethrow
```

### Building `LoginResponse` — Use `completeLogin`

Do NOT hand-craft the session response. Reuse the `completeLogin(user)` helper from `auth.service.ts` — this ensures JWT payload, household_id lookup, and `AuthUser` construction stay consistent with the login flow.

If `completeLogin` is private or causes a circular import, extract it to `apps/api/src/modules/auth/auth.helpers.ts` as a named export. Import it in both `auth.service.ts` and `user.service.ts`.

### `GoneError` (410)

Check `apps/api/src/common/errors.ts`. If `GoneError` does NOT exist (it may have been added in Story 2-3 for expired invite links), add it following the `ConflictError` pattern:
```typescript
export class GoneError extends AppError {
  constructor(message = 'Resource expired or no longer available') {
    super(message, 410);
  }
}
```
Ensure it is mapped in the global error handler to emit a 410 HTTP status.

### Audit Event Type

Check `apps/api/src/audit/audit.types.ts`. Add `'auth.password_reset_completed'` if not present. No `user_id` in metadata (public route). Never log the password.

### Route Added to Existing Plugin

Add the new route to the **existing** `user.routes.ts` plugin (do NOT create a new plugin file). Add it after `POST /v1/auth/password-reset`:

```typescript
fastify.post('/v1/auth/password-reset-complete', {
  schema: { body: PasswordResetCompleteRequestSchema, response: { 200: LoginResponseSchema } },
}, async (request, reply) => {
  const session = await service.completePasswordReset(
    request.body.token,
    request.body.password,
  );
  request.auditContext = {
    event_type: 'auth.password_reset_completed',
    request_id: request.id,
    metadata: {},
  };
  return reply.code(200).send(session);
});
```

### Frontend — Expired State Component Shape

Render the expired state (no token on mount, or 410 response) as:
```tsx
<div className="min-h-screen flex items-center justify-center px-6">
  <div className="max-w-sm w-full text-center space-y-4">
    <h1 className="font-serif text-2xl text-warm-neutral-900">Link expired</h1>
    <p className="text-warm-neutral-600 text-sm">
      This reset link has expired or already been used.
    </p>
    <a href="/auth/login" className="text-honey-amber-600 text-sm underline">
      Send a new link
    </a>
  </div>
</div>
```

### Frontend — `setSession` Already Exists

No auth store changes needed. `setSession(accessToken, user)` is already defined in `apps/web/src/stores/auth.store.ts`. Call it directly via `useAuthStore.getState().setSession(...)` on 200.

### Inherited Context from Story 2-4

- **Pre-existing typecheck failure**: `apps/api/src/plugins/stripe.plugin.ts:6` has a known pre-existing type error. Ignore it; do not introduce additional failures.
- **`fastify.supabase.auth.admin`** is the service-role client — available without additional setup in any route plugin.
- **No DB migration needed** — no new columns or tables required.
- **`WEB_BASE_URL`** is already in the env schema — no new env var needed.

### Test Mocking Pattern

Follow `user.routes.test.ts` exactly (established in Story 2-4). Add mocks for `verifyOtp` and `admin.updateUserById` alongside existing `resetPasswordForEmail` mock.

Confirm the expired-token test sends a `token` value and asserts 410 — do NOT test by omitting the token field (that is a 400 validation case, tested separately).

### References

- `apps/api/src/modules/users/user.routes.ts` — add new route here (existing plugin)
- `apps/api/src/modules/users/user.service.ts` — add `completePasswordReset` method
- `apps/api/src/modules/auth/auth.service.ts` — `completeLogin` pattern for `LoginResponse`
- `apps/api/src/common/errors.ts` — check/add `GoneError` (410)
- `apps/api/src/audit/audit.types.ts` — check/add `auth.password_reset_completed`
- `apps/api/src/middleware/authenticate.hook.ts` — confirms `/v1/auth/` prefix is in `SKIP_PREFIXES`
- `apps/web/src/routes/auth/login.tsx` — canonical form pattern (React Hook Form + Zod + show/hide)
- `apps/web/src/routes/auth/callback.tsx` — URL param extraction + `useRef` guard pattern
- `apps/web/src/lib/supabase-client.ts` — confirms `detectSessionInUrl: false`
- `apps/web/src/stores/auth.store.ts` — `setSession` (no changes needed)
- `apps/web/src/lib/fetch.ts` — `hkFetch<T>` for API calls
- `apps/web/src/app.tsx` — router array; add `/auth/reset-password`
- `packages/contracts/src/users.ts` — add `PasswordResetCompleteRequestSchema`
- `packages/contracts/src/auth.ts` — `LoginResponseSchema` for response type
- Architecture §3.1 — Problem+JSON error shape for `GoneError` (410), `ValidationError` (400)
- Architecture §4.2 — Audit taxonomy

## Dev Agent Record

### Agent Model Used

claude-opus-4-7 (Claude Code, /bmad-dev-story workflow)

### Completion Notes List

- **Architectural deviation**: Route placed in `auth.routes.ts` and service method on `AuthService` (story prescribed `user.routes.ts`/`UserService`). Reasoning: `completeLogin` is `private` on `AuthService`; cookie helpers (`setRefreshCookie`, `loginPayload`) are local to `auth.routes.ts`. The URL prefix is already `/v1/auth/`, so this lives where login/callback/refresh do. Story dev notes anticipated this constraint.
- **Error class reuse**: Used existing `LinkExpiredError` (410) at `apps/api/src/common/errors.ts:50` instead of adding a new `GoneError`. The class already maps to `/errors/link-expired` with status 410 and was added in Story 2-3 for invite expiry — same semantic.
- **Audit event**: `auth.password_reset_completed` was missing both from the TS enum and the Postgres `audit_event_type` enum. Added to `audit.types.ts` AND created a new ALTER TYPE migration `20260506000000_add_password_reset_completed_audit_type.sql` per the original migration's own header guidance ("Adding values requires ALTER TYPE...").
- **Parity test refactor**: `audit.types.test.ts` was hard-coded to read only the original CREATE TYPE migration. Refactored to scan all migration files for both `CREATE TYPE audit_event_type ... ENUM (...)` and `ALTER TYPE audit_event_type ADD VALUE ...` statements, with SQL line-comment stripping to avoid matching `'<value>'` placeholders in headers. This unblocks future audit-type additions without test edits.
- **Auto-login on success**: 200 response carries the same `LoginResponseSchema` body and refresh-token cookie as `/v1/auth/login`. The frontend calls `setSession(access_token, user)` and navigates to `/app`. This matches the AC: "user is auto-logged in on success."
- **Token handling on the frontend**: `detectSessionInUrl: false` on the Supabase browser client is intact — token is extracted via `URLSearchParams(window.location.search).get('token_hash')` and forwarded to the API. The Supabase browser client is never invoked.
- **Pre-existing failures (NOT introduced by this story)**:
  - `apps/api/src/plugins/stripe.plugin.ts:6` typecheck error (Story 2-3 known)
  - `apps/web/src/features/onboarding/OnboardingText.test.tsx:8` lint error (Story 2-7 commit `964a303`)
  - `pnpm contracts:check` failures for 5 schemas from Story 2-6/2-7 (unrelated)

### File List

**New:**
- `apps/web/src/routes/auth/reset-password.tsx`
- `supabase/migrations/20260506000000_add_password_reset_completed_audit_type.sql`

**Modified:**
- `packages/contracts/src/users.ts` (added `PasswordResetCompleteRequestSchema`)
- `packages/contracts/src/users.test.ts` (added 8 schema tests)
- `packages/types/src/index.ts` (added `PasswordResetCompleteRequest` type)
- `apps/api/src/audit/audit.types.ts` (added `'auth.password_reset_completed'`)
- `apps/api/src/audit/audit.types.test.ts` (refactored parity test to scan all migrations)
- `apps/api/src/modules/auth/auth.service.ts` (added `completePasswordReset` method)
- `apps/api/src/modules/auth/auth.routes.ts` (added `POST /v1/auth/password-reset-complete`)
- `apps/api/src/modules/auth/auth.routes.test.ts` (extended mock + added 4 route tests)
- `apps/web/src/app.tsx` (registered `/auth/reset-password` route)
- `_bmad-output/implementation-artifacts/2-4b-password-reset-completion-web-page.md` (status, tasks, dev record)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (status updates)

### Change Log

- 2026-04-27 — Story 2.4b implementation complete. New API endpoint `POST /v1/auth/password-reset-complete` (reuses existing `LinkExpiredError`/410 + new `auth.password_reset_completed` audit event), new frontend route `/auth/reset-password` (Supabase token forwarded server-side; auto-login on success). Status: ready-for-dev → in-progress → review.
- 2026-04-27 — Code review (CR) complete. Critical fix applied: Supabase email links route through `/auth/v1/verify` and redirect with `access_token` in the URL hash fragment (`#access_token=xxx&type=recovery`), not `token_hash` in query params. Frontend updated to read `access_token` from hash; `app.tsx` root route now forwards recovery hashes to `/auth/reset-password`; API `completePasswordReset` switched from `verifyOtp({ token_hash })` to `getUser(access_token)`. All 13 auth route tests pass. Status: review → done.
