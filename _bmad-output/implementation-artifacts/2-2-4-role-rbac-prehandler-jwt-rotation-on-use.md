# Story 2.2: 4-role RBAC preHandler + JWT rotation-on-use

Status: done

## Story

As a **developer**,
I want **a single Fastify preHandler enforcing the 4-role RBAC model with rotating refresh tokens**,
So that **every authenticated route resolves `(user_id, household_id, role)` consistently and refresh-token theft is auto-detected**.

## Acceptance Criteria

**AC1 — `authenticate.hook.ts` global guard.** `apps/api/src/middleware/authenticate.hook.ts` registered as a Fastify `onRequest` hook (via `fastify-plugin` `fp`) on all routes. The hook is a no-op on these paths (prefix-matched): `/v1/internal/`, `/v1/webhooks/`, and the exact paths `/v1/auth/login`, `/v1/auth/callback`, `/v1/auth/logout`, `/v1/auth/refresh`. For all other paths, it reads `Authorization: Bearer <token>`, calls `fastify.jwt.verify(token)`, extracts claims `{ sub, hh, role }`, and sets `request.user = { id: sub, household_id: hh, role }`. Missing or invalid JWT → `throw new UnauthorizedError(...)` → `401 Problem+JSON`.

**AC2 — `authorize.hook.ts` per-route role gate.** `apps/api/src/middleware/authorize.hook.ts` exports a factory `authorize(roles: UserRole[])` returning a Fastify `preHandler` function. Routes that need role restrictions add `{ preHandler: authorize(['primary_parent', 'ops']) }` to their route options. If `request.user.role` is not in the allowed list → `throw new ForbiddenError(...)` → `403 Problem+JSON`. `ForbiddenError` must be added to `apps/api/src/common/errors.ts`.

**AC3 — `household-scope.hook.ts`.** `apps/api/src/middleware/household-scope.hook.ts` registered as a global `onRequest` hook (via `fp`, after `authenticate.hook`). On public routes where `request.user` is absent it is a no-op. On authenticated routes, it asserts `request.user.household_id` is a non-empty string; if missing it throws `UnauthorizedError('Household claim missing from token')`. This provides a clear failure point for tokens issued before Story 2.2 enforcement.

**AC4 — `POST /v1/auth/refresh` — rotation-on-use with theft detection.** New route in `apps/api/src/modules/auth/auth.routes.ts`. Reads the `refresh_token` httpOnly cookie (path `/v1/auth`). Empty cookie → 401. Computes SHA-256 hash, queries `refresh_tokens WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > now()`. Token not found → 401.
- If row found and `replaced_by IS NOT NULL` → **reuse detected**: call `repository.revokeAllByFamilyId(family_id)`, call `supabase.auth.admin.signOut(user_id, 'global')`, set `request.auditContext = { event_type: 'auth.token_reuse_revoked', ... }`, throw `UnauthorizedError('Token reuse detected')`.
- If row found and `replaced_by IS NULL` → **valid**: insert new refresh token (same `family_id`), call `repository.consumeRefreshToken(old.id, new.id)` (sets `old.replaced_by = new.id`), sign new JWT `{ sub, hh, role }`, set new refresh cookie (same attributes as Story 2.1: `HttpOnly`, `Secure` unless dev, `SameSite=Lax`, `Path=/v1/auth`, `Max-Age=2592000`), set `request.auditContext = { event_type: 'auth.refresh_rotated', ... }`, return `{ access_token, expires_in }` (schema `RefreshResponseSchema`).

**AC5 — Contracts + types.** `packages/contracts/src/auth.ts` gains `RefreshResponseSchema = z.object({ access_token: z.string().min(1), expires_in: z.number().int().positive() })`. `packages/types/src/index.ts` exports `RefreshResponse = z.infer<typeof RefreshResponseSchema>`.

**AC6 — Fastify type augmentation.** `apps/api/src/types/fastify.d.ts` adds `user?: { id: string; household_id: string; role: 'primary_parent' | 'secondary_caregiver' | 'guest_author' | 'ops' }` to `FastifyRequest`. No new package imports needed — the type is inline.

**AC7 — RLS migration.** `supabase/migrations/20260502090000_enable_rls_users_households.sql` enables RLS on `users` and `households` and creates four policies (select + update per table) keyed on `auth.uid()`. Service role bypasses these; policies guard direct Supabase-client access.

**AC8 — app.ts registration.** In `apps/api/src/app.ts`, after the `jwt` plugin registration, register `authenticateHook`, `householdScopeHook` (in that order). Both imported from `./middleware/authenticate.hook.js` and `./middleware/household-scope.hook.js`.

**AC9 — Tests.** New `authenticate.hook.test.ts` (4 unit-style tests via `fastify.inject()`), additions to `auth.service.test.ts` (4 tests for `refreshToken`), additions to `auth.routes.test.ts` (3 tests for `POST /v1/auth/refresh`). `pnpm typecheck && pnpm lint && pnpm test && pnpm contracts:check` all pass.

## Tasks / Subtasks

- [x] **Task 1 — Pre-flight: no new deps required** (AC: n/a)
  - [x] Confirm `fastify-plugin` is already installed in `apps/api` (verified — `^5.0.0` in package.json)
  - [x] Confirm `auth.refresh_rotated` and `auth.token_reuse_revoked` exist in `audit.types.ts` (verified — both present in `AUDIT_EVENT_TYPES`)
  - [x] Confirm `refresh_tokens.replaced_by` column exists in migration `20260501125000_create_refresh_tokens.sql` (verified)

- [x] **Task 2 — Contracts + types** (AC: #5)
  - [x] Added `RefreshResponseSchema` to `packages/contracts/src/auth.ts`
  - [x] Added `RefreshResponse` type and import to `packages/types/src/index.ts`
  - [x] Added `auth.test.ts` covering valid + invalid shapes
  - [x] `pnpm contracts:check` passes (31 exports verified)

- [x] **Task 3 — `ForbiddenError` in common/errors.ts** (AC: #2)
  - [x] Added `ForbiddenError extends DomainError` with `type='/errors/forbidden'`, `status=403`, `title='Forbidden'`

- [x] **Task 4 — Fastify type augmentation** (AC: #6)
  - [x] Added `user` shape via `FastifyJWT` augmentation in `apps/api/src/types/fastify.d.ts` — required because `@fastify/jwt` already declares `request.user: SignPayloadType` and a duplicate `FastifyRequest.user` declaration produced a `Property 'role' does not exist on type 'string | object | Buffer'` typecheck error. Augmenting `FastifyJWT.user` is the @fastify/jwt-blessed approach and gives the same `request.user` shape to consumers.

- [x] **Task 5 — `authenticate.hook.ts`** (AC: #1)
  - [x] Created `apps/api/src/middleware/authenticate.hook.ts` using `fp`
  - [x] Skip-list prefix check: `/v1/internal/`, `/v1/webhooks/`, `/v1/auth/`
  - [x] On valid JWT: sets `request.user = { id: payload.sub, household_id: payload.hh, role: payload.role }`
  - [x] On invalid/missing: throws `UnauthorizedError('Invalid or missing access token')`

- [x] **Task 6 — `authorize.hook.ts`** (AC: #2)
  - [x] Created `apps/api/src/middleware/authorize.hook.ts` exporting `authorize(roles): preHandlerHookHandler`
  - [x] Throws `UnauthorizedError` if `request.user` missing, `ForbiddenError` if role not in allowed list

- [x] **Task 7 — `household-scope.hook.ts`** (AC: #3)
  - [x] Created `apps/api/src/middleware/household-scope.hook.ts` using `fp`; no-op when `request.user` undefined; asserts non-empty `household_id`

- [x] **Task 8 — Repository additions** (AC: #4)
  - [x] Added `findRefreshTokenByHash(hash)` returning `RefreshTokenRow | null`
  - [x] Added `consumeRefreshToken(tokenId, replacedBy)` with `.is('replaced_by', null)` race-safety guard
  - [x] Added `revokeAllByFamilyId(familyId)` revoking all non-revoked tokens in the family

- [x] **Task 9 — Service: `refreshToken` method** (AC: #4)
  - [x] Added `refreshToken(plaintext): Promise<RefreshResult>` discriminated union (`rotated` | `reuse_detected`)
  - [x] Reuse path: revokes family + Supabase global signOut, returns reuse_detected
  - [x] Valid path: inserts new token, consumes old, fetches user, signs new JWT, returns rotated payload

- [x] **Task 10 — Route: `POST /v1/auth/refresh`** (AC: #4)
  - [x] Reads `request.cookies['refresh_token']`, delegates to service
  - [x] reuse_detected → sets `auth.token_reuse_revoked` audit context, throws `UnauthorizedError`
  - [x] rotated → sets new cookie via existing `setRefreshCookie` helper, sets `auth.refresh_rotated` audit context, returns `{ access_token, expires_in }`

- [x] **Task 11 — Register hooks in `app.ts`** (AC: #8)
  - [x] Registered `authenticateHook` then `householdScopeHook` immediately after `@fastify/jwt`

- [x] **Task 12 — RLS migration** (AC: #7)
  - [x] Created `supabase/migrations/20260502090000_enable_rls_users_households.sql` with self-select/update on users + member-select/update on households (policies key on `auth.uid()`)

- [x] **Task 13 — Tests** (AC: #9)
  - [x] Created `apps/api/src/middleware/authenticate.hook.test.ts` — 5 tests (valid/missing/malformed/skip-auth-path/skip-internal)
  - [x] Added 4 tests to `auth.service.test.ts` — rotated, reuse_detected, unknown, empty
  - [x] Added 3 tests to `auth.routes.test.ts` — happy/missing-cookie/reuse-detected (extended `buildMockSupabase` to support new `select(...).is(...).gt(...)` and awaitable `update(...).is(...)` chains)
  - [x] `pnpm typecheck && pnpm lint && pnpm -r test && pnpm contracts:check && pnpm tools:check` — all green

- [x] **Task 14 — Sprint + doc update**
  - [x] All checks green
  - [x] Updated `sprint-status.yaml`: `2-2-...: review`, `last_updated: 2026-04-25`
  - [x] Story Status set to `review`

### Review Findings (2026-04-25)

#### Decision-Needed

- [x] [Review][Decision → Accept] **Skip-list uses `/v1/auth/` prefix instead of exact paths** — Accepted: keep `/v1/auth/` prefix as written; dev notes explicitly endorse this; all auth routes handle their own credential validation.

#### Patches

- [x] [Review][Patch] **`consumeRefreshToken` does not check affected-row count — concurrent rotation race undetected** [`apps/api/src/modules/auth/auth.repository.ts` + `auth.service.ts`] — Returns `boolean`; service throws `UnauthorizedError` if `false`.
- [x] [Review][Patch] **`admin.signOut` errors not isolated — downstream operations aborted on failure** [`apps/api/src/modules/auth/auth.service.ts`] — Both `logout()` and reuse path now wrap `signOut` (and `revokeAllByFamilyId`) in try/catch; `reuse_detected` is always returned.
- [x] [Review][Patch] **Generic `Error` thrown when user not found during token rotation — leaks internal message as 500** [`apps/api/src/modules/auth/auth.service.ts:96`] — Changed to `UnauthorizedError`.
- [x] [Review][Patch] **`login.tsx` catch block shows hardcoded "Invalid email or password" for all error types** [`apps/web/src/routes/auth/login.tsx:44`] — Now checks `err instanceof HkApiError && err.status === 401`; falls back to generic message.
- [x] [Review][Patch] **`auth.store.ts` `API_BASE_URL` silently coerces `undefined` to the string `"undefined"`** [`apps/web/src/stores/auth.store.ts:1`] — Module-level constant removed; env var inlined in `logout()` with `?? ''` guard.
- [x] [Review][Patch] **`authenticate.hook.test.ts` registers `@fastify/cookie` with `secret` — diverges from production config** [`apps/api/src/middleware/authenticate.hook.test.ts:17`] — `secret` removed.
- [x] [Review][Patch] **`authorize([])` silently blocks all traffic with no invariant warning** [`apps/api/src/middleware/authorize.hook.ts:7`] — Throws `Error` at factory creation time if `roles` is empty.
- [x] [Review][Patch] **`POST /v1/auth/refresh` has no body schema — any request body silently accepted** [`apps/api/src/modules/auth/auth.routes.ts`] — Added `body: z.object({}).strict()`.

#### Deferred

- [x] [Review][Defer] **Partial write window between `insertRefreshToken` and `consumeRefreshToken`** — crash between the two steps leaves an orphaned new-token row; the client retries with the original (unconsumed) old token and succeeds on retry. Orphaned rows are non-exploitable but accumulate. Fix requires a DB-level transaction or reversing operation order. [`apps/api/src/modules/auth/auth.service.ts:87-94`] — deferred, low-probability, non-exploitable; TTL cleanup job (deferred from 2-1) will purge orphans
- [x] [Review][Defer] **`householdScopeHook` accepts any non-empty string as `household_id` — whitespace or non-UUID values pass the guard** — JWTs are signed by this API with validated DB UUIDs, so not exploitable from the login path; theoretical risk from external tokens. [`apps/api/src/middleware/household-scope.hook.ts:8`] — deferred, low risk in current threat model
- [x] [Review][Defer] **`extractZodIssues` `.validation` array check missing `statusCode === 400` narrowing** — pre-existing, deferred from Story 2-1 review. [`apps/api/src/app.ts`] — deferred, pre-existing
- [x] [Review][Defer] **`login.tsx` flash of login page for already-authenticated users** — `useEffect`-based redirect fires after first render; authenticated users see a brief flash. Minor UX regression. [`apps/web/src/routes/auth/login.tsx:24`] — deferred, minor UX
- [x] [Review][Defer] **TOCTOU migration `20260501120500`: orphaned household has stale `primary_parent_user_id` FK** — the losing concurrent first-login inserts a `households` row whose `primary_parent_user_id` points to a user whose `current_household_id` is the winner's household. Acknowledged in migration comment; future maintenance job should clean up. [`supabase/migrations/20260501120500_create_household_and_user_idempotent.sql`] — deferred, documented limitation
- [x] [Review][Defer] **RLS `households_member_select_policy` subquery triggers N+1 security evaluation per row at scale** — `SELECT current_household_id FROM users WHERE id = auth.uid()` runs under RLS; on large household tables this is evaluated per row. Use a `SECURITY DEFINER` helper or a lateral join with `LIMIT 1` for scale. [`supabase/migrations/20260502090000_enable_rls_users_households.sql`] — deferred, performance concern, not correctness
- [x] [Review][Defer] **Double-slash URL path `//v1/auth/login` bypasses skip-list prefix check** — Fastify typically normalises double slashes at the routing layer, so practically unreachable; flagged for awareness if a non-standard proxy is introduced. [`apps/api/src/middleware/authenticate.hook.ts:15`] — deferred, edge case
- [x] [Review][Defer] **Coverage gaps: `revokeAllByFamilyId` not verified at route layer; no regression test for `insertRefreshToken` failure path** — service-layer tests cover revocation; the route-layer reuse test only asserts `admin.signOut`. [`apps/api/src/modules/auth/auth.routes.test.ts`] — deferred, coverage gap

---

## Dev Notes

### JWT Claims (from Story 2.1 `auth.service.ts`)

The JWT is signed in `completeLogin()` as:
```typescript
const access_token = this.jwt.sign(
  { sub: user.id, hh: user.current_household_id, role: user.role },
  { expiresIn: `${ACCESS_TOKEN_TTL_SECONDS}s` },
);
```

So the JWT payload shape is: `{ sub: string, hh: string, role: UserRole, iat: number, exp: number }`.

In `authenticate.hook.ts`, after `fastify.jwt.verify(token)`, extract as:
```typescript
const payload = fastify.jwt.verify<{ sub: string; hh: string; role: UserRole }>(token);
request.user = { id: payload.sub, household_id: payload.hh, role: payload.role };
```

`fastify.jwt.verify()` throws if the token is invalid or expired — catch and rethrow as `UnauthorizedError`.

### Skip-list Implementation

The hook must not run on auth + internal + webhook paths. Implement as a URL prefix check at the top of the handler:

```typescript
const SKIP_PREFIXES = [
  '/v1/internal/',
  '/v1/webhooks/',
  '/v1/auth/',   // covers login, callback, logout, refresh — all auth sub-paths
];

const url = request.url.split('?')[0] ?? '';
if (SKIP_PREFIXES.some((prefix) => url.startsWith(prefix))) return;
```

Using `/v1/auth/` as a single prefix skips ALL auth endpoints (login, callback, logout, refresh). This is safe — auth routes handle their own credential validation.

### `household-scope.hook.ts` — why it exists

The hook guards against JWT-less requests reaching protected route handlers. It is not responsible for setting `request.user` (authenticate.hook does that). Its role:
1. Confirm `request.user.household_id` is a non-empty string after `authenticate.hook` runs
2. Provide a clear error (`UnauthorizedError('Household claim missing from token')`) for legacy tokens issued before this story went live

Keep it thin (< 20 lines). It will be extended in a future story when we add per-request scoped Supabase clients for RLS-enforced queries.

### `refreshToken` Service Method

Return a discriminated union to allow the route handler to set `request.auditContext` before responding:

```typescript
interface RefreshRotatedResult {
  type: 'rotated';
  access_token: string;
  expires_in: number;
  user_id: string;
  refresh_token_plaintext: string;
  refresh_token_max_age_seconds: number;
}

interface ReuseDetectedResult {
  type: 'reuse_detected';
  user_id: string;
}

async refreshToken(
  plaintext: string,
): Promise<RefreshRotatedResult | ReuseDetectedResult> {
  if (!plaintext) throw new UnauthorizedError('Refresh token missing');

  const hash = sha256Hex(plaintext);
  const token = await this.repository.findRefreshTokenByHash(hash);
  if (!token) throw new UnauthorizedError('Invalid or expired refresh token');

  if (token.replaced_by !== null) {
    // Rotation chain broken — possible token theft
    await this.repository.revokeAllByFamilyId(token.family_id);
    await this.supabase.auth.admin.signOut(token.user_id, 'global');
    return { type: 'reuse_detected', user_id: token.user_id };
  }

  // Issue new rotation
  const newPlaintext = randomBytes(32).toString('base64url');
  const newToken = await this.repository.insertRefreshToken({
    user_id: token.user_id,
    family_id: token.family_id,
    token_hash: sha256Hex(newPlaintext),
    expires_at: new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000),
  });
  await this.repository.consumeRefreshToken(token.id, newToken.id);

  const user = await this.repository.findUserByAuthId(token.user_id);
  if (!user || !user.current_household_id) {
    throw new Error(`User ${token.user_id} has no household during token rotation`);
  }

  const access_token = this.jwt.sign(
    { sub: user.id, hh: user.current_household_id, role: user.role },
    { expiresIn: `${ACCESS_TOKEN_TTL_SECONDS}s` },
  );

  return {
    type: 'rotated',
    access_token,
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    user_id: user.id,
    refresh_token_plaintext: newPlaintext,
    refresh_token_max_age_seconds: REFRESH_TOKEN_TTL_SECONDS,
  };
}
```

### `POST /v1/auth/refresh` Route Handler

```typescript
fastify.post(
  '/v1/auth/refresh',
  { schema: { response: { 200: RefreshResponseSchema } } },
  async (request, reply) => {
    const plaintext = request.cookies['refresh_token'] ?? '';
    const result = await service.refreshToken(plaintext);

    if (result.type === 'reuse_detected') {
      request.auditContext = {
        event_type: 'auth.token_reuse_revoked',
        user_id: result.user_id,
        request_id: request.id,
        metadata: {},
      };
      throw new UnauthorizedError('Token reuse detected');
    }

    setRefreshCookie(reply, result.refresh_token_plaintext, result.refresh_token_max_age_seconds, fastify.env);
    request.auditContext = {
      event_type: 'auth.refresh_rotated',
      user_id: result.user_id,
      request_id: request.id,
      metadata: {},
    };
    return { access_token: result.access_token, expires_in: result.expires_in };
  },
);
```

The `setRefreshCookie` helper is already defined in `auth.routes.ts` from Story 2.1 — reuse it unchanged.

### `consumeRefreshToken` Repository Method

```typescript
async consumeRefreshToken(tokenId: string, replacedBy: string): Promise<void> {
  const { error } = await this.client
    .from('refresh_tokens')
    .update({ replaced_by: replacedBy })
    .eq('id', tokenId)
    .is('replaced_by', null);
  if (error) throw error;
}
```

The `.is('replaced_by', null)` guard prevents double-consumption (race condition where two concurrent requests use the same refresh token — only one will succeed in setting `replaced_by`; the other gets a no-op update, and on the next request will see `replaced_by IS NOT NULL` and trigger theft detection).

### `revokeAllByFamilyId` Repository Method

```typescript
async revokeAllByFamilyId(familyId: string): Promise<void> {
  const { error } = await this.client
    .from('refresh_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('family_id', familyId)
    .is('revoked_at', null);
  if (error) throw error;
}
```

### `findRefreshTokenByHash` Repository Method

```typescript
interface RefreshTokenRow {
  id: string;
  user_id: string;
  family_id: string;
  replaced_by: string | null;
}

async findRefreshTokenByHash(hash: string): Promise<RefreshTokenRow | null> {
  const { data, error } = await this.client
    .from('refresh_tokens')
    .select('id, user_id, family_id, replaced_by')
    .eq('token_hash', hash)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();
  if (error) throw error;
  return (data as RefreshTokenRow | null) ?? null;
}
```

Note: `.gt('expires_at', ...)` filters expired tokens. Non-revoked + non-expired + matching hash.

### `authenticate.hook.test.ts` — Test Approach

The hook is registered as a global plugin. Build a minimal Fastify test app that:
1. Registers `cookie` + `jwt` plugins (same config as app.ts)
2. Registers `authenticateHook`
3. Adds a single protected test route `GET /v1/protected` that returns `{ user: request.user }`
4. Adds a public test route `GET /v1/auth/login` (or similar) to verify the skip-list

Tests:
- `valid JWT → 200 + request.user populated correctly`
- `missing Authorization header → 401`
- `malformed token → 401`
- `skip-list route → 200 (no auth check, even without token)`

Do NOT add a `supabase` decorator to this test app — `authenticate.hook.ts` must NOT import or use `fastify.supabase`. It only uses `fastify.jwt`.

### `authorize.hook.ts` — Usage Pattern

The `authorize` factory does NOT need to be registered globally. It returns a plain async function used inline:

```typescript
// In a route file:
import { authorize } from '../../middleware/authorize.hook.js';

fastify.get('/v1/households/:id', {
  preHandler: authorize(['primary_parent', 'secondary_caregiver', 'ops']),
  handler: async (request, reply) => { ... }
});
```

Story 2.2 does not add any resource routes yet — the factory just needs to exist and be tested via a test app that mounts it on a test route.

### Existing Pattern: `fp` from `fastify-plugin`

See `apps/api/src/middleware/request-id.hook.ts` and `apps/api/src/middleware/audit.hook.ts` for the canonical pattern:
```typescript
import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';

const myHook: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', async (request, reply) => { ... });
};

export const myPlugin = fp(myHook, { name: 'my-hook' });
```

### Cookie Path (IMPORTANT — from Story 2.1 code review fix P1)

The refresh token cookie path was changed during Story 2.1 code review from `/v1/auth/refresh` to `/v1/auth`. This means the cookie IS sent by browsers to `/v1/auth/refresh` (the refresh endpoint). DO NOT change the cookie path back. All `setRefreshCookie` calls use `path: '/v1/auth'`.

### Audit Event Types (confirm — from `audit.types.ts`)

- Successful rotation: `'auth.refresh_rotated'` ✓
- Reuse detected: `'auth.token_reuse_revoked'` ✓

No new audit event types need to be added.

### `authorize.hook.ts` — UserRole Type

Import the role union from `@hivekitchen/types` via `AuthUser`:
```typescript
import type { AuthUser } from '@hivekitchen/types';
type UserRole = AuthUser['role'];
```

This avoids duplicating the union string literal — `AuthUser.role` is already `z.infer<typeof AuthUserSchema>['role']`.

### Hook Registration Order in `app.ts`

Current order (after Story 2.1):
```
cookie → jwt → sensible → cors → setErrorHandler → routes
```

New order:
```
cookie → jwt → authenticateHook → householdScopeHook → sensible → cors → setErrorHandler �� routes
```

The authenticate hook must come after `jwt` (needs `fastify.jwt`) and before routes.

### `auth.routes.test.ts` — Mock Update for `update` Chain

The existing `buildMockSupabase` in `auth.routes.test.ts` already has `auth.admin.signOut` (added in Story 2.1 code review). For Story 2.2 tests, you need to add mocking for `findRefreshTokenByHash`, `consumeRefreshToken`, and `revokeAllByFamilyId`. Since these are new repository methods that go through the `refresh_tokens` table mock, extend the `update()` chain mock carefully — or add a new `opts.refreshToken` prop.

The simplest approach: add `refreshTokenResult` and `refreshTokenError` to `buildMockSupabase` opts, and extend the `refresh_tokens` table mock to handle `select()` queries (for `findRefreshTokenByHash`) as well as `update()` chains (already present for revocation).

### Service Test Pattern

Follow the existing `AuthService.logout` describe block in `auth.service.test.ts`. The `makeMocks()` helper needs:
- New `findRefreshTokenByHash: vi.fn()` in `repository`
- New `consumeRefreshToken: vi.fn()` in `repository`
- New `revokeAllByFamilyId: vi.fn()` in `repository`
All three default to `vi.fn().mockResolvedValue(undefined)` or similar sensible defaults.

---

## Migration File Spec

### `supabase/migrations/20260502090000_enable_rls_users_households.sql`

```sql
-- Rollback: DROP POLICY ... ; ALTER TABLE users DISABLE ROW LEVEL SECURITY;
--           ALTER TABLE households DISABLE ROW LEVEL SECURITY;
-- Story 2.1 deferred RLS to this story (AC8: "RLS policies deferred to Story 2.2").
-- auth.uid() returns the Supabase Auth user id, which equals users.id (both reference auth.users.id).
-- The API service role bypasses all policies; policies guard direct Supabase-client access.

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE households ENABLE ROW LEVEL SECURITY;

-- Users: a user can only read/update their own profile row.
CREATE POLICY users_self_select_policy ON users
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY users_self_update_policy ON users
  FOR UPDATE USING (auth.uid() = id);

-- Households: a user can read/update the household they currently belong to.
CREATE POLICY households_member_select_policy ON households
  FOR SELECT USING (
    id = (SELECT current_household_id FROM users WHERE id = auth.uid())
  );

CREATE POLICY households_member_update_policy ON households
  FOR UPDATE USING (
    id = (SELECT current_household_id FROM users WHERE id = auth.uid())
  );
```

---

## Project Structure Notes

- New middleware files land in `apps/api/src/middleware/` — three files: `authenticate.hook.ts`, `authorize.hook.ts`, `household-scope.hook.ts`. This matches the architecture's directory layout exactly.
- No new packages to install.
- The `RefreshResponseSchema` export from `packages/contracts/src/auth.ts` is picked up automatically by `export * from './auth.js'` in `packages/contracts/src/index.ts`.
- `ForbiddenError` goes in `apps/api/src/common/errors.ts` alongside the existing `UnauthorizedError`, `ConflictError`, `ValidationError`.
- `RefreshTokenRow` interface is defined locally in `auth.repository.ts` — do NOT put it in `packages/contracts` (it is a DB row shape, not a wire contract).

## References

- `apps/api/src/middleware/request-id.hook.ts` — canonical `fp` hook pattern
- `apps/api/src/middleware/audit.hook.ts` — `onResponse` hook using `fp`
- `apps/api/src/modules/auth/auth.service.ts` — `sha256Hex`, `REFRESH_TOKEN_TTL_SECONDS`, `ACCESS_TOKEN_TTL_SECONDS`, `insertRefreshToken`, `findUserByAuthId`
- `apps/api/src/modules/auth/auth.routes.ts` — `setRefreshCookie` helper, audit context pattern
- `apps/api/src/modules/auth/auth.repository.ts` — Supabase chaining pattern for all new methods
- `supabase/migrations/20260501125000_create_refresh_tokens.sql` — `refresh_tokens` table schema (columns: `id`, `user_id`, `family_id`, `token_hash`, `issued_at`, `expires_at`, `revoked_at`, `replaced_by`)
- `apps/api/src/audit/audit.types.ts` — `AUDIT_EVENT_TYPES` (contains `auth.refresh_rotated`, `auth.token_reuse_revoked`)
- `apps/api/src/common/errors.ts` — existing error class pattern to follow for `ForbiddenError`
- `apps/api/src/types/fastify.d.ts` — existing augmentation pattern
- Story 2.1 `_bmad-output/implementation-artifacts/2-1-supabase-auth-email-password-google-apple-oauth.md` — complete Story 2.1 implementation for context

## Dev Agent Record

### Agent Model Used

claude-opus-4-7

### Debug Log References

- Initial typecheck after adding `user?: { ... }` to `FastifyRequest` in `apps/api/src/types/fastify.d.ts` failed with `Property 'role' does not exist on type 'string | object | Buffer'`. Root cause: `@fastify/jwt` v9 already declares `FastifyRequest.user: UserType` (a `SignPayloadType` defaulting to `string | object | Buffer`). Mixing my plain interface augmentation with theirs widened `request.user` instead of narrowing it. Fix: declare the user shape via `FastifyJWT['user']` (the @fastify/jwt-blessed extension point) rather than directly on `FastifyRequest`. After the fix all typechecks pass and runtime semantics are unchanged.

### Completion Notes List

- All 9 ACs satisfied; 14 tasks complete.
- New test counts: 5 hook tests (planned 4 — added a fifth covering the `/v1/internal/` skip-list path), 4 service `refreshToken` tests, 3 route tests for `POST /v1/auth/refresh`, 4 contract tests for `RefreshResponseSchema`. All pass.
- Mock infrastructure: `buildMockSupabase` in `auth.routes.test.ts` extended with `refreshTokenLookupResult`/`refreshTokenLookupError` opts and a chain-aware `update().eq().is()` thenable that also supports `.select().maybeSingle()` for backward compatibility with the logout path.
- `request.user` is typed as non-optional (inherited from `@fastify/jwt`'s `FastifyRequest.user: UserType`). Runtime guards in `authorize.hook.ts` and `household-scope.hook.ts` still defend against the undefined case for skip-listed routes — TS treats them as redundant but they remain correct at runtime.
- RLS policies use `auth.uid()` because `users.id === auth.users.id` (the authenticated Supabase user id is the same UUID as the application user row id). Service-role API access bypasses these policies; they only matter if a future client connects directly with a user JWT.

### File List

- `packages/contracts/src/auth.ts` (modified — add `RefreshResponseSchema`)
- `packages/contracts/src/auth.test.ts` (new — 4 tests)
- `packages/types/src/index.ts` (modified — export `RefreshResponse`)
- `apps/api/src/common/errors.ts` (modified — add `ForbiddenError`)
- `apps/api/src/types/fastify.d.ts` (modified — add `FastifyJWT` payload/user augmentation)
- `apps/api/src/middleware/authenticate.hook.ts` (new)
- `apps/api/src/middleware/authenticate.hook.test.ts` (new — 5 tests)
- `apps/api/src/middleware/authorize.hook.ts` (new)
- `apps/api/src/middleware/household-scope.hook.ts` (new)
- `apps/api/src/modules/auth/auth.repository.ts` (modified — `RefreshTokenRow`, `findRefreshTokenByHash`, `consumeRefreshToken`, `revokeAllByFamilyId`)
- `apps/api/src/modules/auth/auth.service.ts` (modified — `RefreshResult` types and `refreshToken` method)
- `apps/api/src/modules/auth/auth.service.test.ts` (modified — 4 new tests + mock additions)
- `apps/api/src/modules/auth/auth.routes.ts` (modified — `POST /v1/auth/refresh`)
- `apps/api/src/modules/auth/auth.routes.test.ts` (modified — 3 new tests + mock chain extensions)
- `apps/api/src/app.ts` (modified — register `authenticateHook` and `householdScopeHook` after `jwt`)
- `supabase/migrations/20260502090000_enable_rls_users_households.sql` (new)
- `_bmad-output/implementation-artifacts/2-2-4-role-rbac-prehandler-jwt-rotation-on-use.md` (modified — task checkboxes, status, dev agent record)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified — status flip to `review`)

### Change Log

- 2026-04-25 — Story 2.2 implemented: 4-role RBAC preHandler suite (`authenticate`/`authorize`/`household-scope`), `POST /v1/auth/refresh` rotation-on-use with theft detection, RLS migration on `users` + `households`, plus contract + service + repository updates. 12 new tests + 4 new contract tests all passing.
