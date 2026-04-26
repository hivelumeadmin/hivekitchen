# Story 2.4: Account profile management + recovery

Status: done

## Story

As a Primary Parent,
I want to manage my account profile (display name, email, preferred language) and recover access via password reset,
so that I can update my details independently of household/child profiles and never get locked out (FR11, FR12).

## Acceptance Criteria

**AC1 — `GET /v1/users/me` (read profile)**
- Protected route — `authenticate.hook` runs (URL does NOT start with `/v1/auth/`, `/v1/internal/`, or `/v1/webhooks/`).
- Reads `request.user.id` from validated JWT.
- `userRepository.findUserById(userId)` fetches `{ id, email, display_name, preferred_language, role }` from `users` table.
- `fastify.supabase.auth.admin.getUserById(userId)` fetches linked identity providers; extract `auth_providers: string[]` from `user.identities?.map(i => i.provider) ?? []`. Examples: `['email']`, `['google']`, `['apple']`.
- Response 200: `{ id, email, display_name, preferred_language, role, auth_providers }` per `UserProfileSchema`.
- No audit row.

**AC2 — `PATCH /v1/users/me` (update profile)**
- Protected route (authenticate.hook runs).
- Body schema `UpdateProfileRequestSchema`: `{ display_name?: string (min 1, max 100), email?: string (email format, max 254), preferred_language?: string (min 2, max 10) }`.
- Service validates at least one field is present; throws `ValidationError('At least one field must be provided')` if all fields are absent.
- Email change flow: call `fastify.supabase.auth.admin.updateUserById(userId, { email: newEmail })` FIRST. If Supabase error has `code === 'email_exists'` or `message` contains `'already been registered'` → throw `ConflictError('Email already in use')`. Only update the `users` table after Supabase Auth succeeds.
- `userRepository.updateUserProfile(userId, changedFields)` updates `users` table and sets `updated_at = new Date().toISOString()`.
- Returns updated profile 200 (same `UserProfileSchema` shape as GET, including fresh `auth_providers`).
- Audit: `request.auditContext = { event_type: 'account.updated', user_id: request.user.id, household_id: request.user.household_id, request_id: request.id, metadata: { fields_changed: string[] } }` — `fields_changed` lists only the fields that were actually changed (e.g., `['display_name']`).

**AC3 — `POST /v1/auth/password-reset` (initiate recovery)**
- **Public route** — URL starts with `/v1/auth/` → `authenticate.hook` skips it. Do NOT access `request.user` in the handler.
- Body schema `PasswordResetRequestSchema`: `{ email: string (email format, max 254) }`.
- Calls `fastify.supabase.auth.resetPasswordForEmail(body.email, { redirectTo: \`${fastify.env.WEB_BASE_URL}/auth/reset-password\` })`. This triggers Supabase to send a recovery email via its configured SMTP (SendGrid in production). Link expires in 1h (Supabase default).
- Swallow ALL errors from `resetPasswordForEmail` — never reveal whether the email exists. Always returns **204** (no body).
- Audit: `request.auditContext = { event_type: 'auth.password_reset_initiated', request_id: request.id, metadata: {} }` — no `user_id` (public route), no `email` (PII).

**AC4 — Contracts: `packages/contracts/src/users.ts` (new file)**
```typescript
import { z } from 'zod';
import { AuthUserSchema } from './auth.js';

// GET /v1/users/me + PATCH /v1/users/me response
export const UserProfileSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email().max(254),
  display_name: z.string().nullable(),
  preferred_language: z.string(),
  role: AuthUserSchema.shape.role,
  auth_providers: z.array(z.string()),
});

// PATCH /v1/users/me request body
export const UpdateProfileRequestSchema = z.object({
  display_name: z.string().min(1).max(100).optional(),
  email: z.string().email().max(254).optional(),
  preferred_language: z.string().min(2).max(10).optional(),
});

// POST /v1/auth/password-reset request body
export const PasswordResetRequestSchema = z.object({
  email: z.string().email().max(254),
});
```
Add `export * from './users.js'` to `packages/contracts/src/index.ts`.

Types in `packages/types/src/index.ts`:
```typescript
export type UserProfile = z.infer<typeof UserProfileSchema>;
export type UpdateProfileRequest = z.infer<typeof UpdateProfileRequestSchema>;
export type PasswordResetRequest = z.infer<typeof PasswordResetRequestSchema>;
```
Import `UserProfileSchema`, `UpdateProfileRequestSchema`, `PasswordResetRequestSchema` from `@hivekitchen/contracts`.
Run `pnpm contracts:check` — verify export count increased by 3.

**AC5 — Backend module `apps/api/src/modules/users/`**
Three new files:
- `user.repository.ts` — `UserProfileRow` interface + `findUserById`, `updateUserProfile` methods
- `user.service.ts` — `getMyProfile`, `updateMyProfile`, `initiatePasswordReset`
- `user.routes.ts` — `FastifyPluginAsync` via `fp` registering all three routes

Register `userRoutes` in `apps/api/src/app.ts` after `inviteRoutes`.

**AC6 — Auth store `updateUser` action**
Add to `apps/web/src/stores/auth.store.ts`:
```typescript
updateUser: (partial: Partial<AuthUser>) => void;
// Implementation:
updateUser: (partial) => set((state) => ({
  user: state.user ? { ...state.user, ...partial } : null,
})),
```
This allows the account page to reflect profile changes in the global auth state without a full re-login.

**AC7 — Frontend account page `apps/web/src/routes/(app)/account.tsx`**
- Redirects to `/auth/login?next=/account` if `authStore.accessToken` is null.
- Loads profile on mount via `hkFetch<UserProfile>('/v1/users/me')`.
- Form: `display_name` (text input), `preferred_language` (text input or select).
- Email display: show current email read-only; if `auth_providers.includes('email')`, add a separate "Change email" flow that PATCHes `email`; if OAuth-only, email is read-only with no change option.
- Password section: if `auth_providers.includes('email')` → "Send password reset email" button; else → "Your account is managed at {auth_providers[0]}" notice.
- On successful PATCH: call `useAuthStore.getState().updateUser({ display_name: updated.display_name, email: updated.email })` to update global auth state.
- On password reset button click (204): show inline "Check your inbox — a reset link has been sent" confirmation. Button becomes disabled for 60s to prevent spam.
- Route registered in `apps/web/src/app.tsx`: `{ path: '/account', element: <AccountPage /> }`.
- Component is minimal (≤ 250 lines); no animation, warm neutral styling per design system. (Original estimate was ≤ 120 lines; accepted at 227 lines after code review — full conditional surface requires more.)

**AC8 — Tests**
`apps/api/src/modules/users/user.routes.test.ts` — 8 tests via `fastify.inject()`:
1. `GET /v1/users/me` authenticated → 200 with `auth_providers: ['email']`
2. `GET /v1/users/me` unauthenticated → 401
3. `PATCH /v1/users/me` update `display_name` → 200 with updated field
4. `PATCH /v1/users/me` update email (success) → 200, Supabase admin `updateUserById` called
5. `PATCH /v1/users/me` duplicate email → 409 ConflictError
6. `PATCH /v1/users/me` empty body (no fields) → 400 ValidationError
7. `POST /v1/auth/password-reset` valid email → 204
8. `POST /v1/auth/password-reset` invalid email format → 400

Contract tests `packages/contracts/src/users.test.ts` — 6 tests: valid + invalid shapes for all three schemas.

`pnpm typecheck && pnpm lint && pnpm -r test && pnpm contracts:check` must all pass.

## Tasks / Subtasks

- [x] **Task 1 — Pre-flight** (AC: n/a)
  - [x] Confirm `supabase.auth.admin.getUserById` + `updateUserById` are in `@supabase/supabase-js` — same admin client used in `auth.service.ts` `logout()` and `refreshToken()`
  - [x] Confirm `account.updated`, `auth.password_reset_initiated` in `AUDIT_EVENT_TYPES` (`audit.types.ts`) — yes, already present
  - [x] Confirm `ConflictError`, `ValidationError` in `apps/api/src/common/errors.ts` — yes, lines 38 and 44
  - [x] Confirm `WEB_BASE_URL` in env schema — yes, line 22 of `env.ts`; no new env var needed
  - [x] No new npm packages required

- [x] **Task 2 — Contracts + types** (AC: #4)
  - [x] Create `packages/contracts/src/users.ts` with `UserProfileSchema`, `UpdateProfileRequestSchema`, `PasswordResetRequestSchema`
  - [x] Import `AuthUserSchema` from `./auth.js` for `role` field reuse
  - [x] Add `export * from './users.js'` to `packages/contracts/src/index.ts`
  - [x] Add 3 type exports (`UserProfile`, `UpdateProfileRequest`, `PasswordResetRequest`) to `packages/types/src/index.ts`
  - [x] Import the 3 new schemas from `@hivekitchen/contracts` in `packages/types/src/index.ts`
  - [x] Run `pnpm contracts:check` — verify export count increased (35 → 38)

- [x] **Task 3 — `user.repository.ts`** (AC: #5)
  - [x] `UserProfileRow` interface: `{ id: string; email: string; display_name: string | null; preferred_language: string; role: 'primary_parent' | 'secondary_caregiver' | 'guest_author' | 'ops' }`
  - [x] `extends BaseRepository` (import from `../../repository/base.repository.js`)
  - [x] `findUserById(id: string): Promise<UserProfileRow | null>` — `.from('users').select('id, email, display_name, preferred_language, role').eq('id', id).maybeSingle()`
  - [x] `updateUserProfile(id: string, input: Partial<{...}>): Promise<UserProfileRow>` — `.update({ ...input, updated_at: now }).eq('id', id).select('id, email, display_name, preferred_language, role').single()`

- [x] **Task 4 — `user.service.ts`** (AC: #1, #2, #3, #5)
  - [x] Constructor: `(private readonly repository: UserRepository, private readonly supabase: SupabaseClient)`
  - [x] `getMyProfile(userId: string): Promise<UserProfile>` — calls `repository.findUserById` + `supabase.auth.admin.getUserById` for providers; throws `UnauthorizedError` if user row not found
  - [x] `updateMyProfile(userId, input): Promise<{ profile: UserProfile; fieldsChanged: string[] }>` — validates ≥1 field, email update via Supabase admin first, then DB update; `fieldsChanged` = `Object.keys(input)` filtered for defined values
  - [x] `initiatePasswordReset(email: string, redirectTo: string): Promise<void>` — fire-and-forget; catch and discard all errors
  - [x] Helper: `extractAuthProviders(supabaseUser)` — maps identities to provider strings, returns `[]` if identities null

- [x] **Task 5 — `user.routes.ts`** (AC: #1, #2, #3, #5)
  - [x] `FastifyPluginAsync` via `fp`, plugin name `'user-routes'`
  - [x] `GET /v1/users/me` — `schema: { response: { 200: UserProfileSchema } }`; no preHandler
  - [x] `PATCH /v1/users/me` — `schema: { body: UpdateProfileRequestSchema, response: { 200: UserProfileSchema } }`; sets `request.auditContext` after service call
  - [x] `POST /v1/auth/password-reset` — `schema: { body: PasswordResetRequestSchema }`; fire-and-forget service call; `reply.code(204).send()`; sets `request.auditContext`
  - [x] Instantiates `new UserRepository(fastify.supabase)` and `new UserService(repository, fastify.supabase)` in plugin body

- [x] **Task 6 — Register in `app.ts`** (AC: #5)
  - [x] Import `userRoutes` from `./modules/users/user.routes.js`
  - [x] `await app.register(userRoutes)` after `await app.register(inviteRoutes)`

- [x] **Task 7 — Auth store `updateUser`** (AC: #6)
  - [x] Add `updateUser: (partial: Partial<AuthUser>) => void` to `AuthState` interface
  - [x] Implement in `create()` using spread merge
  - [x] Import `AuthUser` already exists — no new import needed

- [x] **Task 8 — Frontend account page** (AC: #7)
  - [x] Create `apps/web/src/routes/(app)/account.tsx`
  - [x] Load profile from `GET /v1/users/me` via `hkFetch<UserProfile>`
  - [x] Display name + preferred_language edit form
  - [x] Provider-conditional password reset section
  - [x] On PATCH success: update auth store via `updateUser`
  - [x] On password reset click: 204 → inline confirmation message + 60s cooldown
  - [x] Register `{ path: '/account', element: <AccountPage /> }` in `app.tsx`

- [x] **Task 9 — Tests** (AC: #8)
  - [x] Create `apps/api/src/modules/users/user.routes.test.ts` — 8 tests
  - [x] Create `packages/contracts/src/users.test.ts` — 14 tests (covers minimum 6 + extra edge cases per existing auth.test.ts pattern)
  - [x] `pnpm contracts:check` PASSED (38 exports), `pnpm lint` PASSED, `pnpm -r test` PASSED (117 contracts + 65 api + 35 web), `pnpm typecheck` clean except pre-existing `stripe.plugin.ts:6` failure

- [x] **Task 10 — Sprint + doc update**
  - [x] Story Status → `review` in file header
  - [x] Update `_bmad-output/implementation-artifacts/sprint-status.yaml`: `2-4-...: ready-for-dev → in-progress → review`

## Dev Notes

### Module Location

New module — create the full directory:
```
apps/api/src/modules/users/
  user.repository.ts     ← NEW
  user.service.ts        ← NEW
  user.routes.ts         ← NEW
  user.routes.test.ts    ← NEW
```

### Canonical Plugin Pattern

Follow `invite.routes.ts` exactly — same `fp` + `FastifyPluginAsync` structure:

```typescript
import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { UserProfileSchema, UpdateProfileRequestSchema, PasswordResetRequestSchema } from '@hivekitchen/contracts';
import { UserRepository } from './user.repository.js';
import { UserService } from './user.service.js';

const userRoutesPlugin: FastifyPluginAsync = async (fastify) => {
  const repository = new UserRepository(fastify.supabase);
  const service = new UserService(repository, fastify.supabase);

  fastify.get('/v1/users/me', {
    schema: { response: { 200: UserProfileSchema } },
  }, async (request) => {
    return service.getMyProfile(request.user.id);
  });

  fastify.patch('/v1/users/me', {
    schema: { body: UpdateProfileRequestSchema, response: { 200: UserProfileSchema } },
  }, async (request) => {
    const { profile, fieldsChanged } = await service.updateMyProfile(
      request.user.id,
      request.body,
      request.user.household_id,
    );
    request.auditContext = {
      event_type: 'account.updated',
      user_id: request.user.id,
      household_id: request.user.household_id,
      request_id: request.id,
      metadata: { fields_changed: fieldsChanged },
    };
    return profile;
  });

  fastify.post('/v1/auth/password-reset', {
    schema: { body: PasswordResetRequestSchema },
  }, async (request, reply) => {
    await service.initiatePasswordReset(request.body.email, fastify.env.WEB_BASE_URL);
    request.auditContext = {
      event_type: 'auth.password_reset_initiated',
      request_id: request.id,
      metadata: {},
    };
    return reply.code(204).send();
  });
};

export const userRoutes = fp(userRoutesPlugin, { name: 'user-routes' });
```

### Supabase Admin API — `getUserById` for Auth Providers

```typescript
const { data: adminData, error } = await this.supabase.auth.admin.getUserById(userId);
if (error || !adminData.user) throw new UnauthorizedError('User not found');
const auth_providers = (adminData.user.identities ?? []).map((i) => i.provider);
```

Provider values Supabase returns: `'email'`, `'google'`, `'apple'`. Service-role-created accounts (test envs) may have null identities → return `[]`.

### Supabase Admin API — `updateUserById` for Email Change

```typescript
const { error } = await this.supabase.auth.admin.updateUserById(userId, { email: newEmail });
if (error) {
  if (error.code === 'email_exists' || error.message?.includes('already been registered')) {
    throw new ConflictError('Email already in use');
  }
  throw error; // unexpected Supabase error — rethrow
}
// Only update users table AFTER Supabase Auth update succeeds:
await this.repository.updateUserProfile(userId, { email: newEmail });
```

### Password Reset — Supabase Native Flow

`supabase.auth.resetPasswordForEmail(email, { redirectTo })`:
- Supabase sends the recovery email using its configured SMTP provider (SendGrid in production, per architecture §2.5).
- `redirectTo` must be in Supabase's allowed redirect URL list. Use `WEB_BASE_URL` (already in env) + `/auth/reset-password`.
- The recovery link expires in 1 hour (Supabase default; configurable in Supabase Auth settings).
- The user-facing completion flow (clicking the link, entering new password) is handled by Supabase's built-in redirect + our `/auth/reset-password` route (to be built in a future story). For Story 2.4, delivery of the initiation 204 is the sole server-side obligation.
- **Swallow ALL errors** — both Supabase errors and network errors. This prevents email enumeration attacks.

```typescript
async initiatePasswordReset(email: string, webBaseUrl: string): Promise<void> {
  try {
    await this.supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${webBaseUrl}/auth/reset-password`,
    });
  } catch {
    // swallow intentionally — never reveal whether email exists
  }
}
```

### `UserRepository.updateUserProfile` Supabase Pattern

Follow the exact chaining pattern from `auth.repository.ts` (no `head` flag after `.update()`):

```typescript
async updateUserProfile(
  id: string,
  input: Partial<{ display_name: string | null; email: string; preferred_language: string }>,
): Promise<UserProfileRow> {
  const { data, error } = await this.client
    .from('users')
    .update({ ...input, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('id, email, display_name, preferred_language, role')
    .single();
  if (error) throw error;
  return data as UserProfileRow;
}
```

The `updated_at` column already exists on the `users` table (see `20260501120000_create_users_and_households.sql`). No migration needed.

### Route Auth Mechanics

`GET /v1/users/me` and `PATCH /v1/users/me`:
- URL `/v1/users/me` does NOT match any `SKIP_PREFIXES` (`/v1/internal/`, `/v1/webhooks/`, `/v1/auth/`).
- `authenticate.hook` runs → `request.user` is populated from JWT claims `{ sub, hh, role }`.
- No `authorize()` preHandler — any authenticated role can read/update their own profile.

`POST /v1/auth/password-reset`:
- URL starts with `/v1/auth/` → in `SKIP_PREFIXES` → `authenticate.hook` skips.
- `request.user` is NOT available. Do not reference it in the handler or service call.

### Contracts File Organization

Create `packages/contracts/src/users.ts` (new file). Import `AuthUserSchema` from `./auth.js` to reuse the `role` enum without duplicating it:
```typescript
import { AuthUserSchema } from './auth.js';
// then: role: AuthUserSchema.shape.role
```

Add to `packages/contracts/src/index.ts` (append after last export):
```typescript
export * from './users.js';
```

Do NOT add user schemas to `auth.ts`. Profile management is semantically distinct from auth flows.

### Frontend Auth Store Update

The store currently holds `user: AuthUser | null`. After a successful profile PATCH, update just the display_name/email without requiring re-login:

```typescript
// In account.tsx after successful PATCH:
const updated = await hkFetch<UserProfile>('/v1/users/me', {
  method: 'PATCH',
  body: changes,
});
useAuthStore.getState().updateUser({
  display_name: updated.display_name,
  email: updated.email,
});
```

`AuthUser` (from login response) has `{ id, email, display_name, current_household_id, role }`. `UserProfile` has `{ ..., preferred_language, auth_providers }`. The `updateUser` store action merges only the `Partial<AuthUser>` fields — the `preferred_language` and `auth_providers` fields are local to the profile page state only.

### Frontend Account Route Registration

Register in `apps/web/src/app.tsx` alongside the existing flat routes. The account page is authenticated but uses the same flat structure (no nested layout currently):

```tsx
import AccountPage from './routes/(app)/account.js';
// In router array:
{ path: '/account', element: <AccountPage /> },
```

Add after the `/app` route entry.

### Frontend: Provider-Conditional UI

```tsx
const isEmailProvider = profile.auth_providers.includes('email');
const primaryOAuthProvider = profile.auth_providers.find(p => p !== 'email');

{isEmailProvider ? (
  <button
    onClick={handlePasswordReset}
    disabled={resetSent}
  >
    {resetSent ? 'Check your inbox' : 'Send password reset email'}
  </button>
) : (
  <p className="text-warm-neutral-500 text-sm">
    Your account is managed at {primaryOAuthProvider ?? 'your provider'}.
  </p>
)}
```

### Test App Setup

Follow `invite.routes.test.ts` pattern exactly. The test app needs:
- `@fastify/jwt` plugin registered with `secret: 'test-secret'`
- Mock `UserRepository` injected via factory function
- Mock `supabase.auth.admin.getUserById` → return `{ data: { user: { identities: [{ provider: 'email' }] } }, error: null }`
- Mock `supabase.auth.admin.updateUserById` → success case returns `{ error: null }`; conflict case returns `{ error: { code: 'email_exists', message: 'already been registered' } }`
- Mock `supabase.auth.resetPasswordForEmail` → always `{ error: null }` (swallowed either way)

Sign Bearer JWTs in tests using `app.jwt.sign({ sub: userId, hh: householdId, role: 'primary_parent' })` (same pattern as `invite.routes.test.ts`).

For test 6 (empty PATCH body): send `{}` as body — the service should throw `ValidationError` before touching the repository. Confirm it returns 400.

For test 2 (unauthenticated GET): omit `Authorization` header entirely.

### `app.ts` Registration Order

Current: `authRoutes` → `inviteRoutes`
After change: `authRoutes` → `inviteRoutes` → `userRoutes`

```typescript
import { userRoutes } from './modules/users/user.routes.js';
// ...
await app.register(authRoutes);
await app.register(inviteRoutes);
await app.register(userRoutes);  // ← add after inviteRoutes
```

### Previous Story Learnings (from Story 2.3 — apply to 2.4)

1. **`.select()` after `.update()`**: use `.select('col1, col2, ...').single()` — do NOT pass `{ count: 'exact', head: true }` flag inside `.select()` as it is not available in the chained overload after `.update()`.

2. **Supabase admin API is already wired**: `fastify.supabase` is the service-role client registered in `supabase.plugin.ts`. `fastify.supabase.auth.admin` methods are available without additional setup.

3. **PII in audit metadata**: do not log emails in audit metadata. AC3 deliberately uses `metadata: {}` for password reset to prevent logging the submitted email. For AC2, `fields_changed: ['display_name', 'email']` (field names only, not values) is acceptable.

4. **`ConflictError` already exists**: no new error class needed. `ConflictError` is at `apps/api/src/common/errors.ts:38`.

5. **`household_id` on audit for `PATCH /v1/users/me`**: users table is an exception to the `household_id NOT NULL` rule (architecture §1.1), but `request.user.household_id` IS set by `authenticate.hook` → safe to include on the audit row.

6. **Stripe pre-existing typecheck failure**: Story 2.3 confirmed `apps/api/src/plugins/stripe.plugin.ts:6` has a pre-existing type error unrelated to any story work. Expect it to persist in `pnpm typecheck` output; ignore it; do not introduce additional failures.

### No Migration Needed

The `users` table already has all required columns:
- `display_name text` (line 23, migration 20260501120000)
- `preferred_language text NOT NULL DEFAULT 'en'` (line 25)
- `updated_at timestamptz NOT NULL DEFAULT now()` (line 32)

No Supabase migration file needed for this story.

### Project Structure Notes

- `UserProfileRow` interface defined locally in `user.repository.ts` — similar to `InviteRow` in `invite.repository.ts`. Not exported to contracts (it's a DB row shape, not a wire contract).
- `userRoutes` plugin exported as named export (same as `inviteRoutes`, `authRoutes`).
- No new `authorize()` preHandler — profile endpoints allow any authenticated role (`primary_parent`, `secondary_caregiver`, `guest_author`, `ops`).

### References

- `apps/api/src/modules/auth/invite.routes.ts` — canonical plugin pattern with `fp`
- `apps/api/src/modules/auth/invite.service.ts` — Supabase admin API call patterns
- `apps/api/src/modules/auth/auth.service.ts` — `supabase.auth.admin.signOut`, `completeLogin`; `UserRow` interface pattern
- `apps/api/src/modules/auth/auth.repository.ts` — `.select('...').eq().maybeSingle()` and `.update().eq().select().single()` chains
- `apps/api/src/middleware/authenticate.hook.ts` — `SKIP_PREFIXES` list (confirms `/v1/auth/` is skipped)
- `apps/api/src/common/errors.ts` — `ConflictError` (line 38), `ValidationError` (line 44), `UnauthorizedError` (line 26)
- `apps/api/src/audit/audit.types.ts` — `account.updated` and `auth.password_reset_initiated` (both present)
- `apps/api/src/common/env.ts` — `WEB_BASE_URL` (line 22); use for redirect URL construction
- `apps/api/src/app.ts` — registration order pattern
- `apps/api/src/repository/base.repository.ts` — `BaseRepository` base class
- `apps/web/src/lib/fetch.ts` — `hkFetch<T>` for frontend API calls
- `apps/web/src/stores/auth.store.ts` — `useAuthStore`, `AuthState` interface; add `updateUser`
- `apps/web/src/routes/auth/callback.tsx` — `useRef` guard + `navigate` + `hkFetch` pattern
- `apps/web/src/routes/invite/$token.tsx` — minimal cross-scope route pattern
- `apps/web/src/app.tsx` — router array; add `/account` route
- `packages/contracts/src/auth.ts` — `AuthUserSchema`; import for `role` shape reuse in `users.ts`
- `packages/contracts/src/index.ts` — barrel export pattern; add `./users.js`
- `supabase/migrations/20260501120000_create_users_and_households.sql` — users table schema (confirm columns)
- Architecture §1.1 — `household_id` scoping exception for users table
- Architecture §2.5 — SendGrid SMTP configured in Supabase Auth settings
- Architecture §3.1 — Problem+JSON error shape for `ConflictError` (409), `ValidationError` (400)
- Architecture §4.2 — Audit taxonomy: `account.updated`, `auth.password_reset_initiated`
- Epics §Story 2.4 — source ACs (FR11: profile management, FR12: account recovery)

## Dev Agent Record

### Agent Model Used

claude-opus-4-7 (Claude Code, /bmad-dev-story workflow)

### Debug Log References

- `pnpm contracts:check`: PASSED (38 exports, up from 35 — adds `UserProfileSchema`, `UpdateProfileRequestSchema`, `PasswordResetRequestSchema`).
- `pnpm typecheck`: clean across all packages except the pre-existing `apps/api/src/plugins/stripe.plugin.ts:6` API-version mismatch that was documented in Story 2.3 learnings — no new failures introduced.
- `pnpm lint`: PASSED.
- `pnpm -r test`: PASSED — 117 contracts tests, 65 API tests, 35 web tests (story 2.4 added 14 contract tests + 8 API integration tests).

### Completion Notes List

- Followed `invite.routes.ts` canonical plugin pattern: `fp` wrapper, `FastifyPluginAsync`, repository + service instantiated inside plugin body.
- Email-change ordering enforced exactly per AC2: `supabase.auth.admin.updateUserById` is called first; only on success does the local `users` table update fire. `email_exists` code or `'already been registered'` message string both map to `ConflictError(409)`.
- Password-reset error swallowing covers both Supabase-returned errors (treated as `await` resolutions) and thrown network errors via try/catch — endpoint always returns 204 to prevent email enumeration.
- `fields_changed` audit metadata lists field names only (e.g. `['email']`), never values — matches Story 2.3 PII-in-audit guidance.
- Frontend account page uses warm-neutral styling (`text-warm-neutral-700`, `border-warm-neutral-300`, `bg-honey-amber-600`) consistent with existing login page; no new dependencies; `<= 220` lines including conditional UI for OAuth-only accounts.
- 60s cooldown for the password-reset button implemented via `setTimeout` to prevent spam (clears `resetSent` state).
- Tests: `users.test.ts` exceeds the 6-test floor in the AC by covering extra valid/invalid edges per the precedent set in `auth.test.ts`. `user.routes.test.ts` covers exactly the 8 enumerated cases via `fastify.inject()` with mocked supabase.

### File List

- `packages/contracts/src/users.ts` — new
- `packages/contracts/src/users.test.ts` — new
- `packages/contracts/src/index.ts` — modified (added `export * from './users.js'`)
- `packages/types/src/index.ts` — modified (added 3 schema imports + 3 `z.infer<>` exports)
- `apps/api/src/modules/users/user.repository.ts` — new
- `apps/api/src/modules/users/user.service.ts` — new
- `apps/api/src/modules/users/user.routes.ts` — new
- `apps/api/src/modules/users/user.routes.test.ts` — new
- `apps/api/src/app.ts` — modified (import + register `userRoutes`)
- `apps/web/src/stores/auth.store.ts` — modified (added `updateUser` action)
- `apps/web/src/routes/(app)/account.tsx` — new
- `apps/web/src/app.tsx` — modified (registered `/account` route)
- `_bmad-output/implementation-artifacts/2-4-account-profile-management-recovery.md` — updated (status, tasks, dev record)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — status updated to `review`

### Change Log

- 2026-04-26 — Story 2.4 implementation complete: account profile read/update + password-reset initiation. Three new contract schemas, new `users` API module, frontend account page, auth-store `updateUser` action. Status: ready-for-dev → in-progress → review.

### Review Findings

#### Decision Needed

- [x] [Review][Decision] account.tsx is 227 lines, exceeding the AC7 spec limit of ≤ 120 lines — **Accepted**: 120-line estimate was too narrow for the full conditional surface (loading/error states, email-change toggle, OAuth provider detection, password-reset cooldown). AC7 updated to reflect actual count. [apps/web/src/routes/(app)/account.tsx]

#### Patch

- [x] [Review][Patch] Email update split-state: `updateAuthEmail` succeeds then `updateUserProfile` throws — Supabase Auth and the users table diverge with no compensating rollback [apps/api/src/modules/users/user.service.ts]
- [x] [Review][Patch] `updateAuthEmail` re-throws raw `AuthError` on any non-email-exists Supabase error — exposes an untyped 500 instead of a domain error [apps/api/src/modules/users/user.service.ts]
- [x] [Review][Patch] `display_name` trimmed to `""` on save — user cannot clear display name to null; the backend correctly rejects it with 400 but the UI gives no actionable feedback [apps/web/src/routes/(app)/account.tsx]
- [x] [Review][Patch] `initiatePasswordReset` only catches thrown exceptions — Supabase SDK returns `{ data, error }` on failure rather than throwing; returned errors are silently ignored [apps/api/src/modules/users/user.service.ts]
- [x] [Review][Patch] `didLoad.current` guard blocks profile re-fetch after accessToken changes (silent token refresh or logout/re-login race) [apps/web/src/routes/(app)/account.tsx]
- [x] [Review][Patch] `handlePasswordReset` has no in-flight guard — rapid double-click sends two password-reset requests before `resetSent` is set [apps/web/src/routes/(app)/account.tsx]
- [x] [Review][Patch] `editingEmail` not reset on save failure — email draft silently re-submitted on subsequent saves after a 409 [apps/web/src/routes/(app)/account.tsx]
- [x] [Review][Patch] `fields_changed` audit metadata uses keys-present-in-input, not keys-with-actually-changed-values — violates AC2 requirement [apps/api/src/modules/users/user.service.ts]
- [x] [Review][Patch] No test covers split-brain: auth email update succeeds but DB write throws [apps/api/src/modules/users/user.routes.test.ts]
- [x] [Review][Patch] `PasswordResetRequestSchema` boundary test constructs 255-char email, not 254 — exact boundary never tested [packages/contracts/src/users.test.ts]
- [x] [Review][Patch] 409 duplicate-email test does not assert that `repository.updateUserProfile` was NOT called [apps/api/src/modules/users/user.routes.test.ts]

#### Deferred

- [x] [Review][Defer] No rate limiting on `POST /v1/auth/password-reset` — email bombing vector [apps/api/src/modules/users/user.routes.ts] — deferred, infra/middleware concern outside story scope
- [x] [Review][Defer] `preferred_language` accepts any 2–10 char string with no locale validation — garbage values stored silently [packages/contracts/src/users.ts] — deferred, locale validation is a future story concern
- [x] [Review][Defer] `fastify-plugin` (`fp`) scoping means `/v1/auth/password-reset` auth-skip relies on global SKIP_PREFIXES — footgun if auth is ever moved to plugin-scoped preHandler [apps/api/src/modules/users/user.routes.ts] — deferred, architectural note for future refactors
- [x] [Review][Defer] `.single()` in `updateUserProfile` throws PGRST116 if user row deleted between auth check and update — unmapped raw error [apps/api/src/modules/users/user.repository.ts] — deferred, extremely unlikely race
- [x] [Review][Defer] `updateUser` store action silently no-ops when `state.user` is null (concurrent logout) [apps/web/src/stores/auth.store.ts] — deferred, edge case with acceptable silent behaviour
- [x] [Review][Defer] `/v1/auth/` blanket SKIP_PREFIXES is an implicit convention — future routes under that prefix will be unauthenticated by default [apps/api/src/middleware/authenticate.hook.ts] — deferred, broader architectural doc concern
- [x] [Review][Defer] Supabase mock chain hardcodes chaining order — won't catch column name changes or query restructuring [apps/api/src/modules/users/user.routes.test.ts] — deferred, accepted test-mock pattern in codebase
- [x] [Review][Defer] Password-reset test does not explicitly assert that no auth token is required [apps/api/src/modules/users/user.routes.test.ts] — deferred, nice-to-have assertion
