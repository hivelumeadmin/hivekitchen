# Story 2.3: Secondary Caregiver invite primitive (signed JWT, single-use jti, 14-day TTL)

Status: done

## Story

As a Primary Parent,
I want to invite a Secondary Caregiver to my household via a single-use 14-day-TTL signed invite link,
so that my partner can join without creating their own account from scratch (FR10).

## Acceptance Criteria

**AC1 — `POST /v1/households/:id/invites` (create invite)**
- Protected by `authenticate.hook` (global) + `authorize(['primary_parent'])` preHandler.
- Route handler validates `params.id === request.user.household_id`; mismatch → `403 ForbiddenError('You may only invite to your own household')`.
- Body: `{ role: 'secondary_caregiver', email?: string }` (Story 2.3 scopes to `secondary_caregiver` only; `guest_author` is Story 8.7).
- Server creates an `invites` DB row `{ id: uuid, household_id, role, invited_by_user_id, invited_email, expires_at: now + 14d }`, then signs a JWT with claims `{ household_id, role, invite_id: row.id, jti: row.id, exp: expires_at }`.
- Response: `{ invite_url: '/invite/{base64url(jwt)}' }` — path only; frontend prepends `window.location.origin` for clipboard copy.
- Audit row: `event_type: 'invite.sent'`, `user_id: request.user.id`, `metadata: { invite_id: row.id, household_id, role, invited_email }`.

**AC2 — `POST /v1/auth/invites/redeem` (validate + mark redeemed)**
- **Public route** — under `/v1/auth/` prefix so `authenticate.hook` skips it automatically (same as `/v1/auth/login`).
- Body: `{ token: string }` where `token` is the base64url-encoded JWT from the invite URL.
- Server decodes: `Buffer.from(token, 'base64url').toString('utf8')` → raw JWT string.
- Verifies JWT signature via `fastify.jwt.verify<InviteClaims>(rawJwt)`. Invalid signature → `401 UnauthorizedError`.
- Extracts `jti` (= `invite_id`); queries `invites WHERE id = jti AND redeemed_at IS NULL AND revoked_at IS NULL`.
- Row not found, `redeemed_at IS NOT NULL`, `revoked_at IS NOT NULL`, or `JWT exp` is in the past → `410 LinkExpiredError`.
- Atomically writes `invites.redeemed_at = now()`.
- Returns `{ role: 'secondary_caregiver', scope_target: '/app/household/settings', household_id }`.
- Audit row: `event_type: 'invite.redeemed'`, `correlation_id: jti`, `metadata: { invite_id: jti, household_id }`.

**Note:** Account creation / linking to Supabase Auth is deferred to Story 5.5. Story 2.3 delivers only the invite-issuance and primitive redemption-validation primitives. Story 5.5 builds the full UX (login/signup + account linking + session establishment) on top of this endpoint.

**AC3 — `invites` DB migration**
File: `supabase/migrations/20260502190000_create_invites.sql`
```sql
CREATE TABLE invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('secondary_caregiver', 'guest_author')),
  invited_by_user_id UUID NOT NULL REFERENCES users(id),
  invited_email TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  redeemed_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX invites_household_id_idx ON invites(household_id);
```

**AC4 — `LinkExpiredError` in `errors.ts`**
Add to `apps/api/src/common/errors.ts`:
```typescript
export class LinkExpiredError extends DomainError {
  readonly type = '/errors/link-expired';
  readonly status = 410;
  readonly title = 'Link expired or already used';
}
```
Architecture §6 lists `LinkExpiredError` alongside existing domain errors. Serialized by the global Fastify error handler in `app.ts` (no changes to `app.ts` error handler needed — it already handles all `DomainError` subclasses).

**AC5 — Contracts + types**
`packages/contracts/src/auth.ts` additions:
```typescript
// POST /v1/households/:id/invites
export const CreateInviteRequestSchema = z.object({
  role: z.literal('secondary_caregiver'),
  email: z.string().email().max(254).optional(),
});
export const CreateInviteResponseSchema = z.object({
  invite_url: z.string().min(1),
});

// POST /v1/auth/invites/redeem
export const RedeemInviteRequestSchema = z.object({
  token: z.string().min(1),
});
export const RedeemInviteResponseSchema = z.object({
  role: AuthUserSchema.shape.role,
  scope_target: z.string().min(1),
  household_id: z.string().uuid(),
});
```
`packages/types/src/index.ts` exports: `CreateInviteRequest`, `CreateInviteResponse`, `RedeemInviteRequest`, `RedeemInviteResponse`.

**AC6 — Backend module files**
Three new files under `apps/api/src/modules/auth/`:
- `invite.repository.ts` — Supabase queries only; no JWT logic
- `invite.service.ts` — JWT sign/verify logic; calls repository
- `invite.routes.ts` — Fastify plugin registering both routes; wires repository → service

Register `inviteRoutes` in `apps/api/src/app.ts` alongside `authRoutes`.

**AC7 — Frontend route: `apps/web/src/routes/invite/$token.tsx`**
- Cross-scope route (no layout wrapper from `.app-scope`).
- Extracts `:token` from URL params.
- Checks `authStore.accessToken` — if `null` (unauthenticated), redirects to `/auth/login?next=/invite/${token}`.
- If authenticated: calls `hkFetch<RedeemInviteResponse>('/v1/auth/invites/redeem', { method: 'POST', body: { token } })`.
- On success: `navigate(response.scope_target)`.
- On `HkApiError` with `status === 410`: renders inline "This invite link has expired or already been used." message (no redirect).
- On other errors: renders generic "Something went wrong" message.
- No loading spinner beyond the React `useState(loading: true)` gate — entire route can be minimal (< 80 lines).
- Route is registered in `apps/web/src/app.tsx` outside the `(app)` layout tree.

**AC8 — Tests**
`apps/api/src/modules/auth/invite.routes.test.ts` — 6 tests via `fastify.inject()`:
1. `POST /v1/households/:id/invites` happy path → 201 with `invite_url`
2. `POST /v1/households/:id/invites` wrong `household_id` param (not the user's HH) → 403
3. `POST /v1/households/:id/invites` non-primary-parent role → 403
4. `POST /v1/auth/invites/redeem` valid token → 200 with `role + scope_target + household_id`
5. `POST /v1/auth/invites/redeem` expired JWT → 410
6. `POST /v1/auth/invites/redeem` already-redeemed jti → 410

Contract tests in `packages/contracts/src/auth.test.ts` — 4 tests (valid + invalid shapes for both request schemas).

`pnpm typecheck && pnpm lint && pnpm -r test && pnpm contracts:check` must all pass.

## Tasks / Subtasks

- [x] **Task 1 — Pre-flight: confirm no new packages needed** (AC: n/a)
  - [x] Confirm `node:crypto` (`randomUUID`, `createHash`) available — already used in `auth.service.ts`
  - [x] Confirm `@fastify/jwt` sign/verify available — yes, `fastify.jwt` used in `auth.service.ts`
  - [x] Confirm `authorize` hook import path — `../../middleware/authorize.hook.js`
  - [x] Confirm `invite.sent` and `invite.redeemed` in `AUDIT_EVENT_TYPES` — present in both `apps/api/src/audit/audit.types.ts` and the Postgres `audit_event_type` enum (`supabase/migrations/20260501110000_create_audit_event_type_enum.sql`)

- [x] **Task 2 — DB migration** (AC: #3)
  - [x] Create `supabase/migrations/20260502190000_create_invites.sql` with table + index per AC3
  - [x] Include rollback comment: `-- Rollback: DROP TABLE invites;`
  - [x] Enable RLS with no user-facing policies (mirrors `refresh_tokens` pattern — service-role-only access)

- [x] **Task 3 — `LinkExpiredError` in errors.ts** (AC: #4)
  - [x] Add `LinkExpiredError` class (`type: '/errors/link-expired'`, `status: 410`, `title: 'Link expired or already used'`)

- [x] **Task 4 — Contracts + types** (AC: #5)
  - [x] Add `CreateInviteRequestSchema`, `CreateInviteResponseSchema`, `RedeemInviteRequestSchema`, `RedeemInviteResponseSchema` to `packages/contracts/src/auth.ts`
  - [x] Verify `export * from './auth.js'` in `packages/contracts/src/index.ts` already re-exports (it does — untouched)
  - [x] Add 4 new type exports to `packages/types/src/index.ts`
  - [x] Run `pnpm contracts:check` — PASSED: 35 exports verified

- [x] **Task 5 — `invite.repository.ts`** (AC: #6)
  - [x] `InviteRow` interface
  - [x] `insertInvite(input): Promise<InviteRow>`
  - [x] `findInviteById(id): Promise<InviteRow | null>`
  - [x] `markRedeemed(id): Promise<void>` — race-safe via `.is('redeemed_at', null).select('id')` then array-length check (mirrors `consumeRefreshToken` pattern)

- [x] **Task 6 — `invite.service.ts`** (AC: #1, #2, #6)
  - [x] `INVITE_TTL_SECONDS = 14 * 24 * 60 * 60`
  - [x] `createInvite(input): Promise<{ invite_url, invite_id }>` — inserts row, signs JWT, returns URL path + invite_id (the latter used by the route for the `invite.sent` audit metadata)
  - [x] `redeemInvite(token): Promise<RedeemInviteResult>` — decodes token, verifies JWT, validates row, marks redeemed
  - [x] `InviteClaims` interface defined locally
  - [x] `Buffer.from(rawJwt, 'utf8').toString('base64url')` for encode; `Buffer.from(token, 'base64url').toString('utf8')` for decode
  - [x] `jwt.sign(claims, { expiresIn: '14d' })`
  - [x] `jwt.verify<InviteClaims>` — catches `TokenExpiredError`/`FAST_JWT_EXPIRED` → `LinkExpiredError`; any other verify error → `UnauthorizedError`

- [x] **Task 7 — `invite.routes.ts`** (AC: #1, #2, #6)
  - [x] `FastifyPluginAsync` via `fp`, named `invite-routes`
  - [x] `POST /v1/households/:id/invites` — `{ preHandler: authorize(['primary_parent']), schema: { body, response: { 201 } } }`
  - [x] `POST /v1/auth/invites/redeem` — `{ schema: { body, response: { 200 } } }` (public route — `authenticate.hook` skips `/v1/auth/` prefix)
  - [x] Household ownership check throws `ForbiddenError` on mismatch
  - [x] Audit fire-and-forget for both `invite.sent` and `invite.redeemed`
  - [x] `reply.code(201).send(...)` for create; default 200 for redeem

- [x] **Task 8 — Register routes in `app.ts`** (AC: #6)
  - [x] Import + register after `authRoutes`

- [x] **Task 9 — Frontend route** (AC: #7)
  - [x] Created `apps/web/src/routes/invite/$token.tsx`
  - [x] `hkFetch` + `useAuthStore` wired
  - [x] `import type { RedeemInviteResponse } from '@hivekitchen/types'`
  - [x] Registered in `apps/web/src/app.tsx` outside the `(app)` layout, between `/auth/callback` and `/app`

- [x] **Task 10 — Tests** (AC: #8)
  - [x] Created `apps/api/src/modules/auth/invite.routes.test.ts` — 6 tests via `fastify.inject()`, all passing
  - [x] Added 4 contract test blocks to `packages/contracts/src/auth.test.ts` covering both request and response schemas, all passing
  - [x] `pnpm contracts:check` PASSED (35 exports), `pnpm lint` PASSED, `pnpm -r test` PASSED (217 tests across 28 files)
  - [x] `pnpm typecheck` — Story 2.3 code is clean across api/web/contracts/types; **the only failure is `apps/api/src/plugins/stripe.plugin.ts:6`, a pre-existing baseline error from Dependabot bump #21 (stripe 16.12.0 → 22.1.0) that is **not introduced by this story**. Confirmed by stash-and-typecheck against pristine `main`. Logged in `_bmad-output/implementation-artifacts/deferred-work.md` (Story 2.3 entry).

- [x] **Task 11 — Sprint + doc update**
  - [x] Updated `sprint-status.yaml`: `2-3-...: review`
  - [x] Story Status set to `review`

### Review Findings

- [x] [Review][Decision] `invited_email` logged as plaintext PII in audit metadata — resolved: replaced `invited_email` with `has_invited_email: boolean` in audit metadata. [`apps/api/src/modules/auth/invite.routes.ts:64`]
- [x] [Review][Patch] Non-invite JWT on redeem endpoint returns misleading 410 instead of 401 — added `typeof claims.jti !== 'string'` guard after `jwt.verify`. [`apps/api/src/modules/auth/invite.service.ts:77`]
- [x] [Review][Patch] `markRedeemed` does not guard `revoked_at IS NULL` — added `.is('revoked_at', null)` to the update chain; updated test mock to chain two `.is()` calls. [`apps/api/src/modules/auth/invite.repository.ts:62`]
- [x] [Review][Patch] `navigate(result.scope_target)` on frontend has no path-relative guard — applied `^\/[^/]` guard matching the `callback.tsx` pattern; falls back to `setState('error')`. [`apps/web/src/routes/invite/$token.tsx:36`]
- [x] [Review][Patch] Missing test: `revoked_at IS NOT NULL` → 410 branch — added `revoked invite → 410` test with `activeInviteRow({ revoked_at: ... })`. [`apps/api/src/modules/auth/invite.routes.test.ts`]
- [x] [Review][Patch] Missing test: row-not-found → 410 branch — added `jti not in DB → 410` test with `findInviteResult: null`. [`apps/api/src/modules/auth/invite.routes.test.ts`]
- [x] [Review][Patch] `decodeBase64UrlToString` try/catch is dead code — removed unreachable try/catch; simplified to single expression. [`apps/api/src/modules/auth/invite.service.ts:97-99`]
- [x] [Review][Patch] Contract test missing `guest_author` acceptance check in `RedeemInviteResponseSchema` — added `accepts guest_author role` test case. [`packages/contracts/src/auth.test.ts`]
- [x] [Review][Defer] OAuth → `is_first_login` → onboarding redirect silently discards invite — if a new user signs up via OAuth while following an invite link, `callback.tsx` sends them to `/onboarding` on `is_first_login: true`, permanently discarding the `?next=/invite/:token` destination. The invite token is never redeemed. Scope: Story 5.5 (full invite UX). [`apps/web/src/routes/auth/callback.tsx:37`] — deferred to Story 5.5
- [x] [Review][Defer] DB insert orphan if JWT signing fails after `insertInvite` — `createInvite` commits to DB before `jwt.sign()`. If signing throws (secret misconfiguration), the invite row exists with no corresponding token and occupies audit space until TTL expiry. Low probability in production; supabase-js lacks multi-statement transactions. [`apps/api/src/modules/auth/invite.service.ts:43-61`] — deferred, architectural constraint

## Dev Notes

### Module Location and Naming

All backend files go in `apps/api/src/modules/auth/` — the architecture explicitly places `auth/invite.service` there:

```
apps/api/src/modules/auth/
  auth.repository.ts       ← existing
  auth.routes.ts           ← existing
  auth.service.ts          ← existing
  invite.repository.ts     ← NEW
  invite.routes.ts         ← NEW
  invite.service.ts        ← NEW
  invite.routes.test.ts    ← NEW
```

### Canonical Plugin Pattern (`fp`)

Follow the exact pattern from `apps/api/src/middleware/authenticate.hook.ts`:

```typescript
import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';

const inviteRoutes: FastifyPluginAsync = async (fastify) => {
  const repository = new InviteRepository(fastify.supabase);
  const service = new InviteService(repository, fastify.jwt);
  const auditService = new AuditService(new AuditRepository(fastify.supabase));

  fastify.post('/v1/households/:id/invites', {
    preHandler: authorize(['primary_parent']),
    schema: { body: CreateInviteRequestSchema, response: { 201: CreateInviteResponseSchema } },
  }, async (request, reply) => {
    // ...
    return reply.code(201).send({ invite_url });
  });

  fastify.post('/v1/auth/invites/redeem', {
    schema: { body: RedeemInviteRequestSchema, response: { 200: RedeemInviteResponseSchema } },
  }, async (request) => {
    // ...
  });
};

export const inviteRoutes = fp(inviteRoutes, { name: 'invite-routes' });
```

### JWT Signing for Invites

The invite JWT uses the **same `fastify.jwt` instance** as access tokens — same `JWT_SECRET`. This is safe because:
- Access tokens are passed in `Authorization: Bearer` header; `authenticate.hook` calls `fastify.jwt.verify(token)` from the header.
- Invite JWTs are passed as a body field `{ token }` in the redeem request — they never travel in `Authorization` headers.
- Claims are distinct: access tokens have `{ sub, hh, role, iat, exp }`; invite JWTs have `{ household_id, role, invite_id, jti, exp }`. The verify step uses the typed generic `jwt.verify<InviteClaims>()`.

Sign the JWT with `{ expiresIn: '14d' }`:
```typescript
const rawJwt = this.jwt.sign(
  { household_id, role, invite_id: row.id, jti: row.id },
  { expiresIn: '14d' },
);
```

`@fastify/jwt` accepts `expiresIn` as a string ('14d', '15m', '30d') or number of seconds. Use the string form for readability.

### `markRedeemed` Race Safety

Atomically guard against concurrent redemptions — same pattern as `consumeRefreshToken` in `auth.repository.ts`:

```typescript
async markRedeemed(id: string): Promise<void> {
  const { count, error } = await this.client
    .from('invites')
    .update({ redeemed_at: new Date().toISOString() })
    .eq('id', id)
    .is('redeemed_at', null)
    .select('id', { count: 'exact', head: true });
  if (error) throw error;
  if ((count ?? 0) === 0) throw new LinkExpiredError('Invite already redeemed');
}
```

The `.is('redeemed_at', null)` guard means only the first concurrent redemption succeeds; subsequent ones get `count = 0` and throw `LinkExpiredError`.

### Route Auth Mechanics

`POST /v1/households/:id/invites`:
- `authenticate.hook` is global → runs on this route (it's NOT under `/v1/auth/` prefix).
- `authorize(['primary_parent'])` enforces role.
- Handler checks `request.params.id === request.user.household_id`.

`POST /v1/auth/invites/redeem`:
- `authenticate.hook` SKIPS this because the URL starts with `/v1/auth/` (see skip-list in `authenticate.hook.ts`).
- No preHandler needed. The route is public.

### Frontend Route Registration

Current `apps/web/src/app.tsx` uses React Router v7. Add the invite route **outside** the `(app)` layout route so it renders without the authenticated layout wrapper:

```tsx
// In createBrowserRouter or JSX route tree:
<Route path="/invite/:token" element={<InviteRedeemPage />} />
```

The route component is intentionally minimal for Story 2.3 — it's a programmatic handler, not a designed surface. Story 5.5 will add the full UX (login/signup prompt, caregiver welcome screen). For now: check auth → redirect to login if not authed → call redeem → redirect to scope_target.

### `hkFetch` for Public Routes

`hkFetch` in `apps/web/src/lib/fetch.ts` already handles unauthenticated calls — it only adds `Authorization` header when `accessToken !== null`. For the redeem call, if the user is unauthenticated, the header is omitted and the server-side route is public anyway. So `hkFetch` works correctly for both authed and unauthed calls to `/v1/auth/invites/redeem`.

### Audit Event Types

Both `invite.sent` and `invite.redeemed` are already in `AUDIT_EVENT_TYPES` (verified in `apps/api/src/audit/audit.types.ts`). No new types needed.

The full list from architecture §4.2: `plan.*`, `memory.*`, `heart_note.*`, `lunch_link.*`, `voice.*`, `billing.*`, `vpc.*`, `account.*`, `auth.*`, `allergy.*`, `agent.*`, `webhook.*`, `invite.*`, `llm.provider.*`.

### Test App Setup

Follow the `auth.routes.test.ts` pattern exactly. The test app needs:
- `@fastify/cookie` + `@fastify/jwt` plugins (same config as production)
- `supabase` decorator mock (same `buildMockSupabase` helper pattern)
- Mock `InviteRepository` injected via factory

For the `markRedeemed` test (already-redeemed scenario): return `count: 0` from the `.update()` chain mock.

For the JWT sign/verify in tests: use the same `JWT_SECRET` env var that `buildTestApp` sets up (`test-secret`). Sign a JWT manually for the happy path; tamper with it for the invalid-signature test; set `exp: Date.now() - 1` for the expired test.

### `app.ts` Registration

Current registration order:
```
cookie → jwt → authenticateHook → householdScopeHook → sensible → cors → setErrorHandler → authRoutes → ...other routes
```

Add `inviteRoutes` after `authRoutes`:
```typescript
await fastify.register(authRoutes);
await fastify.register(inviteRoutes);
```

### Story 2.3 vs Story 5.5 Scope Boundary

**Story 2.3 (this story) delivers:**
- `POST /v1/households/:id/invites` — create invite
- `POST /v1/auth/invites/redeem` — validate + mark redeemed (no account creation)
- `invites` DB table
- Frontend: `/invite/:token` thin redirect handler
- `LinkExpiredError` (410)

**Story 5.5 adds on top:**
- `DELETE /v1/households/:id/caregivers/:user_id` (revoke)
- `POST /v1/households/:id/transfer-primary` (ownership transfer)
- Full login/signup UX within the invite redemption flow
- Supabase Auth account creation + linking during redemption
- `(app)/household/settings` UI for managing caregivers

Do NOT scope-creep into Story 5.5 territory. The redeem endpoint for Story 2.3 does NOT create a Supabase Auth user — it only validates and marks redeemed, then returns `{ role, scope_target, household_id }`.

### Project Structure Notes

- `LinkExpiredError` in `apps/api/src/common/errors.ts` alongside `UnauthorizedError`, `ForbiddenError`, `ConflictError`, `ValidationError` — same `DomainError` base class pattern.
- `InviteRow` interface defined locally in `invite.repository.ts` — NOT in `packages/contracts` (it's a DB row shape, not a wire contract).
- `InviteClaims` interface defined locally in `invite.service.ts`.
- No new npm packages required.

### References

- `apps/api/src/modules/auth/auth.routes.ts` — plugin pattern, audit fire-and-forget, `setRefreshCookie` (for pattern reference)
- `apps/api/src/modules/auth/auth.repository.ts` — Supabase chaining patterns (`maybeSingle`, `.is()`, `.gt()`, `.update()`)
- `apps/api/src/modules/auth/auth.service.ts` — `sha256Hex`, `randomUUID`, `jwt.sign()` with `expiresIn`
- `apps/api/src/middleware/authorize.hook.ts` — `authorize(['primary_parent'])` usage
- `apps/api/src/common/errors.ts` — existing `DomainError` subclass pattern
- `apps/api/src/audit/audit.types.ts` — `AUDIT_EVENT_TYPES` (confirm `invite.sent`, `invite.redeemed`)
- `apps/web/src/lib/fetch.ts` — `hkFetch`, `HkApiError` for frontend call
- `apps/web/src/stores/auth.store.ts` — `useAuthStore().accessToken` for auth check in frontend route
- `apps/web/src/routes/auth/callback.tsx` — frontend route with `useRef` guard and `navigate` pattern
- `packages/contracts/src/auth.ts` — existing schema additions pattern
- Architecture §2.2 — invite JWT claims spec + 14d TTL
- Architecture §3.1 — Problem+JSON error shape + `/errors/link-expired` type URI
- Architecture §6 — `LinkExpiredError` in domain error list
- Epics §Story 2.3 — AC definition
- Epics §Amendment FF / §Amendment Y — invite redemption flow + cross-scope route

## Dev Agent Record

### Agent Model Used

Claude Opus 4.7 (1M context) — `claude-opus-4-7[1m]`

### Debug Log References

- Initial typecheck after writing the service surfaced two issues:
  1. `markRedeemed` used `.select('id', { count: 'exact', head: true })` — the `head` flag is not in the supabase-js v2 `.select()` overload after a chained `.update().eq().is()`. Switched to the `.select('id')` + array-length pattern that `consumeRefreshToken` already uses.
  2. `jwt.sign({ household_id, role, invite_id, jti }, ...)` failed because `apps/api/src/types/fastify.d.ts` declared `FastifyJWT.payload` as the access-token shape only. Widened `payload` to a discriminated union of access-token + invite claims so both call sites typecheck without `any`/casts. Read sites already use the typed generic (`jwt.verify<InviteClaims>(...)` / `jwt.verify<AccessTokenPayload>(...)`), which pins the shape after the union widening.
- Test 5 (expired JWT): `app.jwt.sign(payload, opts)` rejects payloads carrying `exp` when the plugin registration sets a default `expiresIn` (jsonwebtoken refuses the combination). Worked around it by HS256-signing a JWT manually in the test (`craftInviteJwt` helper) so the test can plant `exp` directly. The production `jwt.sign({ ...claims }, { expiresIn: '14d' })` path stays unchanged.

### Completion Notes List

- All eight ACs satisfied. The redeem endpoint is intentionally a primitive: validates + marks-redeemed only; account creation / Supabase Auth linking is deferred to Story 5.5 per the scope-boundary note in Dev Notes.
- The invite JWT shares the access-token JWT_SECRET / `fastify.jwt` instance — claims are namespaced (`household_id` vs. `sub`/`hh`) and travel only in the redeem-request body, never in `Authorization` headers.
- `markRedeemed` is race-safe: only the first concurrent redemption wins; later attempts get an empty `data` array and throw `LinkExpiredError`. Test 6 exercises this path with `updateAffectedRows: 0`.
- `pnpm contracts:check` PASSED: 35 exports verified.
- `pnpm lint` PASSED across all 5 lint-bearing workspaces.
- `pnpm -r test` PASSED: 217 tests across 28 files (api 55 + 11 skipped, web 35, contracts 102, design-system 22, eslint-config 22, ui 1).
- `pnpm typecheck` — `apps/api`, `apps/web`, `packages/contracts`, `packages/types`, `packages/ui`, `packages/design-system`, `apps/marketing`, `packages/eslint-config-hivekitchen` all green for Story 2.3's code. **Single remaining failure:** `apps/api/src/plugins/stripe.plugin.ts:6` (`apiVersion: '2026-04-22.dahlia'` vs. installed `stripe@22.1.0` types pinned to `'2024-06-20'`). Confirmed pre-existing on `main` by stash-and-typecheck against the pristine baseline; this drift was introduced by Dependabot PR #21 (stripe 16.12.0 → 22.1.0) before Story 2.3 began. Logged in `_bmad-output/implementation-artifacts/deferred-work.md`. Recommend a one-line hygiene PR (bump `stripe` SDK or cast through `Stripe.LatestApiVersion`) before this story merges.

### File List

**New files**

- `supabase/migrations/20260502190000_create_invites.sql`
- `apps/api/src/modules/auth/invite.repository.ts`
- `apps/api/src/modules/auth/invite.service.ts`
- `apps/api/src/modules/auth/invite.routes.ts`
- `apps/api/src/modules/auth/invite.routes.test.ts`
- `apps/web/src/routes/invite/$token.tsx`

**Modified files**

- `apps/api/src/common/errors.ts` (added `LinkExpiredError`)
- `apps/api/src/types/fastify.d.ts` (widened `FastifyJWT.payload` to a union of access-token + invite-claim shapes)
- `apps/api/src/app.ts` (registered `inviteRoutes`)
- `apps/web/src/app.tsx` (added `/invite/:token` route)
- `packages/contracts/src/auth.ts` (added 4 invite schemas)
- `packages/contracts/src/auth.test.ts` (added 8 schema test cases across 4 `describe` blocks)
- `packages/types/src/index.ts` (added 4 invite type exports)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (story → in-progress → review)
- `_bmad-output/implementation-artifacts/deferred-work.md` (logged stripe baseline failure)

## Change Log

| Date       | Change                                                                                              | Author          |
| ---------- | --------------------------------------------------------------------------------------------------- | --------------- |
| 2026-04-26 | Story 2.3 implemented — invite create + redeem endpoints, DB migration, contracts, frontend route, tests. | Amelia (dev agent) |
