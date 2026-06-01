# Story 4.s3: Real Signed Tokens + 8pm Window

Status: done

**Slice key:** `4-s3-real-signed-tokens-8pm-window`
**Epic:** 4 — Lunch Link & Heart Note Sacred Channel
**Source slice doc:** `_bmad-output/planning-artifacts/epic-4-vertical-slices.md` §Slice 4-S3
**Builds on:** 4-S1 (heart_notes table + HeartNoteRepository), 4-S2 (lunch-link module scaffold, LunchLinkRepository, dev endpoint), 3-28 (lunch_link_sessions table stub)
**Folds:** 4.1 (HMAC token signing), 4.3 (8pm expiry window)

---

## Story

As a **parent**,
I want **to generate a real HMAC-signed Lunch Link URL for my child's delivery date**,
so that **my child can open the link until 8pm on school day, and after 8pm sees a read-only snapshot of the heart note and any rating they submitted**.

---

## Acceptance Criteria

**AC1.** `POST /v1/lunch-link/generate` (auth-gated: `requireMember`) accepts `{ child_id, date }` and returns `{ url }` where the URL is `${WEB_BASE_URL}/lunch/${token}`. Returns 404 if `child_id` does not belong to the caller's household.

**AC2.** The token format is `{base64url(payload)}.{hmac_sha256_hex_64}` where:
- `payload = JSON.stringify({ child_id, date, nonce: randomUUID(), exp: <8pm UTC for household timezone> })`
- base64url: standard base64 with `+→-`, `/→_`, trailing `=` stripped
- HMAC: `createHmac('sha256', Buffer.from(daily_key_hex, 'hex')).update(encodedPayload).digest('hex')`
- The HMAC is computed over the base64url-encoded payload string (not raw JSON)

**AC3.** `lunch_link_keys` stores one 32-byte random key per calendar date (as 64 hex chars). Key is generated on first `generate` call for a date and reused on all subsequent calls that day. On-conflict: keep the first writer's key (idempotent upsert).

**AC4.** `lunch_link_sessions` is upserted on `generate`: `(child_id, date)` unique key; stores `nonce`, `exp`, `household_id`. An existing session's nonce/exp is preserved on conflict — parent calling generate twice for the same (child, date) returns a new URL (new nonce/exp) but does not corrupt an in-flight open.

**AC5.** `GET /v1/lunch-link/:token` is **PUBLIC** (no auth). Verifies HMAC (constant-time comparison), checks expiry, and returns:
- **200** `{ childName, date, heartNote, bag, expired: false }` — valid, unexpired token
- **410** `{ expired: true, last_state_snapshot: { heartNote, rating, bag } }` — valid, expired token
- **404** — malformed token, wrong HMAC, unknown child, or suppressed session (never reveal which)

**AC6.** On first open (unexpired), `lunch_link_sessions.first_opened_at` is set (UPDATE only if null).

**AC7.** On any open after expiry, `lunch_link_sessions.reopened_after_exp_count` increments.

**AC8.** `lunch_link.opened` audit event is emitted on valid unexpired opens; `lunch_link.expired` on post-expiry opens. Both are emitted on the server using the service-role client (no `request.user` in the public route handler — use `household_id` derived from the child row).

**AC9.** DB migration adds missing columns to `lunch_link_sessions`:
`nonce text NOT NULL DEFAULT ''`, `exp timestamptz`, `first_opened_at timestamptz`, `rating text CHECK (rating IN ('loved','ok','not-really'))`, `rating_submitted_at timestamptz`, `reopened_after_exp_count int NOT NULL DEFAULT 0`, `updated_at timestamptz NOT NULL DEFAULT now()` + `updated_at` trigger.

**AC10.** DB migration creates `lunch_link_keys (key_date date PRIMARY KEY, hmac_key text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())` with RLS enabled but no user-accessible policy (service-role only).

**AC11.** `authenticate.hook.ts` skips JWT validation for `GET /v1/lunch-link/<anything>` requests (regex: `/^\/v1\/lunch-link\/[^/]+$/`, method `GET` only). `POST /v1/lunch-link/generate` continues to require auth via the normal hook + `requireMember`.

**AC12.** In `heart-note.tsx`, a "Copy link" button calls `POST /v1/lunch-link/generate` with the active child + today's date, copies the returned URL to clipboard, and shows "Copied!" for 2 s before resetting. The button is disabled while a save is in flight.

**AC13.** `lunch-link.tsx` route detects HMAC tokens (pattern: `{base64url}.{64 hex chars}`) vs stub tokens (`test-`). Stub path unchanged. HMAC path calls `GET /v1/lunch-link/:token` via raw `fetch` (no `hkFetch` — child has no auth token).

**AC14.** When the token is expired (410 response), the route renders a "Link expired" panel: "This link closed at 8pm" message + read-only `HeartNoteCard` (placeholder if no note) + the emoji the child picked (if any) + `LunchSummary` with the bag preview.

---

## Demo Path

> As parent: click "Copy link" in `/app/heart-note` → paste URL in another tab → Heart Note + bag render. Fast-forward machine clock past 8pm → refresh → 410 Gone panel with last-state snapshot and `reopened_after_exp_count` increments in DB.

Manual test steps:
1. Log in as parent; navigate to `/app/heart-note`; type a note and save it.
2. Click "Copy link" → toast "Copied!" appears.
3. Open the copied URL in another tab (or phone browser). See Heart Note + bag.
4. Open Supabase: `SELECT * FROM lunch_link_sessions` — `first_opened_at` populated.
5. Open Supabase: `SELECT * FROM lunch_link_keys WHERE key_date = '<today>'` — row exists.
6. Change system clock to past 8pm (or modify `exp` in DB to `now() - interval '1s'`).
7. Reload the child URL → see the 410 expired panel.
8. Refresh again → `reopened_after_exp_count` increments in DB.

---

## Critical Guardrails — Read First

**DO NOT use TanStack Query or React Hook Form.** Established ban from 4-S1. Use `hkFetch` (for auth'd routes) and raw `fetch` (for the public child endpoint). Use `useState` + `useEffect` + `useRef`.

**DO NOT add emoji rating API wiring.** `FeedbackBlock.onRate` stays unwired in S3 — that ships in 4-S4.

**DO NOT touch `_dev-lunch-link.tsx` or `mockData.ts`.** Dev preview stays mock-backed.

**DO NOT change the `/lunch/:linkId` router entry in `app.tsx`.** The web router route path is unchanged.

**DO NOT add envelope encryption to heart note content for S3.** Content is still plaintext — encryption ships in 4-S5.

**DO NOT add email/SMS delivery.** Parent copies the URL manually (no SendGrid/Twilio in S3). Those ship in 4-S8/4-S9.

**DO NOT use any third-party timezone library.** Use Node's built-in `Intl.DateTimeFormat.formatToParts()` with the noon-UTC trick (see Task T4 utility details). Luxon/date-fns-tz are not installed.

**HMAC must use constant-time comparison.** Use `node:crypto`'s `timingSafeEqual`. Never compare signatures with `===` or string equality — timing attacks on token verification are a real vector.

**The public GET endpoint must return 404 for ALL failure modes** (malformed token, wrong HMAC, unknown child, suppressed session) — never reveal the specific reason.

**DO NOT import `randomUUID` from `node:crypto` with a static import in the same file as `timingSafeEqual`.** Both are in `node:crypto`; import them together: `import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';`. Use `randomUUID` from `node:crypto` too.

**DO NOT call `generateKey` for `lunch_link_keys`.** The key is a `randomBytes(32).toString('hex')` — no KMS, no envelope encryption. This is the HMAC signing key for token integrity only, not a DEK.

---

## What Already Exists (Do Not Recreate)

**API module — `apps/api/src/modules/lunch-link/`:**
- `lunch-link.repository.ts` — `LunchLinkRepository extends BaseRepository` with `findChildName(childId, householdId)`. **Extend this class** with S3 methods; do not create a new class.
- `lunch-link.service.ts` — `LunchLinkService` with `getDevPayload()`. **Extend this class**; keep `getDevPayload()` intact for the dev endpoint.
- `lunch-link.routes.ts` — `lunchLinkRoutes` plugin with `GET /v1/lunch-link-dev/:childId/:date`. **Add two new routes** to this plugin; do not replace it.

**Contracts — `packages/contracts/src/lunch-link.ts`:**
- Already has: `LunchLinkPauseInputSchema`, `LunchLinkPauseResponseSchema`, `LunchLinkDevParamsSchema`, `LunchLinkDevHeartNoteSchema`, `LunchLinkDevBagSchema`, `LunchLinkDevResponseSchema`. **Append S3 schemas** to this file.

**DB table `lunch_link_sessions`** — already exists (Story 3-28 migration `20260840000000_create_lunch_link_sessions_stub.sql`). Columns present: `id`, `household_id`, `child_id`, `date`, `suppressed_at`, `suppressed_by_user_id`, `created_at`. S3 adds the missing columns via `ALTER TABLE`.

**Audit types** — `lunch_link.created`, `lunch_link.opened`, `lunch_link.expired` already exist in `audit.types.ts`. No new types needed.

**WEB_BASE_URL** — already in `apps/api/src/common/env.ts` as `z.string().url().default('http://localhost:5173')`. Access via `fastify.env.WEB_BASE_URL` in the routes plugin.

**Authenticate hook skip list** — `SKIP_PREFIXES` and `SKIP_EXACT` are defined at the top of `apps/api/src/middleware/authenticate.hook.ts`. Add the public GET pattern as a regex check (see Task T5.2).

**`HeartNoteRepository.findByChildAndDate(householdId, childId, isoDate)`** — already exists in `heart-note.repository.ts`. The public verify flow uses `household_id` from `findChildPublic()` to call this.

**`hkFetch` and `publicGet`** — `hkFetch` is in `apps/web/src/lib/fetch.ts`. Add `publicGet` to this same file (see Task T6.1).

---

## Tasks

### T1 — DB Migrations

**T1.1** New file `supabase/migrations/20261001000000_extend_lunch_link_sessions_for_s3.sql`:

```sql
-- Slice 4-S3: add HMAC token + session-tracking columns to lunch_link_sessions.
-- The table was created as a stub by Story 3-28 (20260840000000).

ALTER TABLE lunch_link_sessions
  ADD COLUMN IF NOT EXISTS nonce                  text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS exp                    timestamptz,
  ADD COLUMN IF NOT EXISTS first_opened_at        timestamptz,
  ADD COLUMN IF NOT EXISTS rating                 text
    CHECK (rating IN ('loved', 'ok', 'not-really')),
  ADD COLUMN IF NOT EXISTS rating_submitted_at    timestamptz,
  ADD COLUMN IF NOT EXISTS reopened_after_exp_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at             timestamptz NOT NULL DEFAULT now();

-- updated_at trigger — follow the pattern from
-- 20260510000500_children_updated_at_trigger.sql.
-- The moddatetime extension is already enabled in the project.
CREATE OR REPLACE TRIGGER lunch_link_sessions_updated_at
  BEFORE UPDATE ON lunch_link_sessions
  FOR EACH ROW EXECUTE FUNCTION moddatetime('updated_at');
```

**T1.2** New file `supabase/migrations/20261001000100_create_lunch_link_keys.sql`:

```sql
-- Slice 4-S3: daily HMAC signing keys for Lunch Link tokens.
-- Service-role only — no user-accessible RLS policy.

CREATE TABLE IF NOT EXISTS lunch_link_keys (
  key_date   date PRIMARY KEY,
  hmac_key   text NOT NULL,  -- 64 hex chars (32-byte random key)
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE lunch_link_keys ENABLE ROW LEVEL SECURITY;
-- Intentionally no user policy: only the service-role client reads/writes this table.
```

---

### T2 — Contracts

**T2.1** Append to `packages/contracts/src/lunch-link.ts` (after existing S2 exports):

```typescript
// ── Slice 4-S3: real signed tokens ──────────────────────────────────────────

export const GenerateLunchLinkBodySchema = z.object({
  child_id: z.string().uuid(),
  date: z.string().date(),
});

export const GenerateLunchLinkResponseSchema = z.object({
  url: z.string().url(),
});

export const LunchLinkTokenParamSchema = z.object({
  token: z.string().min(1),
});

// Heart note shape on the real public surface (mirrors dev shape intentionally)
export const LunchLinkPublicHeartNoteSchema = z.object({
  body: z.string(),
  authorDisplayName: z.string(),
});

export const LunchLinkPublicBagSchema = z.object({
  name: z.string(),
  sub: z.string(),
  safetyNote: z.string(),
});

// 200 response — valid unexpired token
export const LunchLinkPayloadSchema = z.object({
  childName: z.string(),
  date: z.string().date(),
  heartNote: LunchLinkPublicHeartNoteSchema.nullable(),
  bag: LunchLinkPublicBagSchema,
  expired: z.literal(false),
});

// 410 response body — expired token
export const LunchLinkExpiredPayloadSchema = z.object({
  expired: z.literal(true),
  last_state_snapshot: z.object({
    heartNote: LunchLinkPublicHeartNoteSchema.nullable(),
    rating: z.enum(['loved', 'ok', 'not-really']).nullable(),
    bag: LunchLinkPublicBagSchema,
  }),
});

export type GenerateLunchLinkBody = z.infer<typeof GenerateLunchLinkBodySchema>;
export type GenerateLunchLinkResponse = z.infer<typeof GenerateLunchLinkResponseSchema>;
export type LunchLinkTokenParam = z.infer<typeof LunchLinkTokenParamSchema>;
export type LunchLinkPayload = z.infer<typeof LunchLinkPayloadSchema>;
export type LunchLinkExpiredPayload = z.infer<typeof LunchLinkExpiredPayloadSchema>;
export type LunchLinkPublicHeartNote = z.infer<typeof LunchLinkPublicHeartNoteSchema>;
export type LunchLinkPublicBag = z.infer<typeof LunchLinkPublicBagSchema>;
```

**T2.2** `packages/contracts/src/index.ts` — already has `export * from './lunch-link.js'`. No change needed.

**T2.3** Add to `packages/contracts/src/lunch-link.test.ts` (append; do not replace existing tests):

```typescript
// S3 schema tests
describe('GenerateLunchLinkBodySchema', () => {
  it('accepts valid body', () => {
    expect(() => GenerateLunchLinkBodySchema.parse({ child_id: VALID_UUID, date: '2026-09-01' })).not.toThrow();
  });
  it('rejects non-UUID child_id', () => {
    expect(() => GenerateLunchLinkBodySchema.parse({ child_id: 'not-a-uuid', date: '2026-09-01' })).toThrow();
  });
  it('rejects invalid date format', () => {
    expect(() => GenerateLunchLinkBodySchema.parse({ child_id: VALID_UUID, date: '09-01-2026' })).toThrow();
  });
});

describe('LunchLinkPayloadSchema', () => {
  it('accepts valid payload with heart note', () => {
    const valid = { childName: 'Layla', date: '2026-09-01', heartNote: { body: 'Hi!', authorDisplayName: 'Parent' }, bag: { name: 'Sandwich', sub: 'Packed', safetyNote: 'Nut-free' }, expired: false as const };
    expect(() => LunchLinkPayloadSchema.parse(valid)).not.toThrow();
  });
  it('accepts valid payload with null heartNote', () => {
    const valid = { childName: 'Layla', date: '2026-09-01', heartNote: null, bag: { name: 'Sandwich', sub: 'Packed', safetyNote: 'Nut-free' }, expired: false as const };
    expect(() => LunchLinkPayloadSchema.parse(valid)).not.toThrow();
  });
  it('rejects expired: true', () => {
    expect(() => LunchLinkPayloadSchema.parse({ childName: 'Layla', date: '2026-09-01', heartNote: null, bag: { name: 'S', sub: 'P', safetyNote: 'N' }, expired: true })).toThrow();
  });
});

describe('LunchLinkExpiredPayloadSchema', () => {
  it('accepts expired payload with rating', () => {
    const valid = { expired: true as const, last_state_snapshot: { heartNote: null, rating: 'loved' as const, bag: { name: 'S', sub: 'P', safetyNote: 'N' } } };
    expect(() => LunchLinkExpiredPayloadSchema.parse(valid)).not.toThrow();
  });
  it('accepts expired payload with null rating', () => {
    const valid = { expired: true as const, last_state_snapshot: { heartNote: null, rating: null, bag: { name: 'S', sub: 'P', safetyNote: 'N' } } };
    expect(() => LunchLinkExpiredPayloadSchema.parse(valid)).not.toThrow();
  });
  it('rejects unknown rating value', () => {
    const invalid = { expired: true as const, last_state_snapshot: { heartNote: null, rating: 'thumbs-up', bag: { name: 'S', sub: 'P', safetyNote: 'N' } } };
    expect(() => LunchLinkExpiredPayloadSchema.parse(invalid)).toThrow();
  });
});
```

---

### T3 — API Repository

**T3.1** Extend `apps/api/src/modules/lunch-link/lunch-link.repository.ts`.

Add the `LunchLinkSessionRow` interface at the top:

```typescript
export interface LunchLinkSessionRow {
  id: string;
  child_id: string;
  household_id: string;
  date: string;       // YYYY-MM-DD
  nonce: string;
  exp: string | null; // ISO UTC timestamptz
  first_opened_at: string | null;
  rating: 'loved' | 'ok' | 'not-really' | null;
  rating_submitted_at: string | null;
  reopened_after_exp_count: number;
  suppressed_at: string | null;
  created_at: string;
  updated_at: string;
}
```

Add these methods to `LunchLinkRepository`:

```typescript
// Public endpoint: find child + household without an ownership check.
// Returns null if the child UUID doesn't exist (caller maps to 404).
async findChildPublic(childId: string): Promise<{ name: string; household_id: string } | null> {
  const { data, error } = await this.client
    .from('children')
    .select('name, household_id')
    .eq('id', childId)
    .maybeSingle();
  if (error) throw error;
  return (data as { name: string; household_id: string } | null);
}

// Generate flow: get timezone for the household (plaintext column, no DEK).
// Falls back to 'UTC' if the row is missing — caller should treat this as
// a misconfigured household but should not crash the generate flow.
async findHouseholdTimezone(householdId: string): Promise<string> {
  const { data, error } = await this.client
    .from('households')
    .select('timezone')
    .eq('id', householdId)
    .maybeSingle();
  if (error) throw error;
  return (data as { timezone: string } | null)?.timezone ?? 'UTC';
}

// On generate: create a new session or update the existing one.
// ON CONFLICT (child_id, date): replace nonce + exp so the new URL is valid,
// but preserve first_opened_at / rating / other tracking columns.
async upsertSession(params: {
  childId: string;
  householdId: string;
  date: string;
  nonce: string;
  exp: string;
}): Promise<LunchLinkSessionRow> {
  const { data, error } = await this.client
    .from('lunch_link_sessions')
    .upsert(
      {
        child_id: params.childId,
        household_id: params.householdId,
        date: params.date,
        nonce: params.nonce,
        exp: params.exp,
      },
      { onConflict: 'child_id,date' },
    )
    .select('*')
    .single();
  if (error) throw error;
  return data as LunchLinkSessionRow;
}

// Verify flow: get session by (child_id, date) to check suppression + rating.
async findSession(childId: string, date: string): Promise<LunchLinkSessionRow | null> {
  const { data, error } = await this.client
    .from('lunch_link_sessions')
    .select('*')
    .eq('child_id', childId)
    .eq('date', date)
    .maybeSingle();
  if (error) throw error;
  return (data as LunchLinkSessionRow | null);
}

// Record first open — UPDATE only if first_opened_at IS NULL (idempotent).
async recordFirstOpen(childId: string, date: string): Promise<void> {
  const { error } = await this.client
    .from('lunch_link_sessions')
    .update({ first_opened_at: new Date().toISOString() })
    .eq('child_id', childId)
    .eq('date', date)
    .is('first_opened_at', null);
  if (error) throw error;
}

// Increment reopen counter for post-expiry opens.
async incrementReopenedCount(childId: string, date: string): Promise<void> {
  const { error } = await this.client.rpc('increment_lunch_link_reopen_count', {
    p_child_id: childId,
    p_date: date,
  });
  if (error) throw error;
}

// HMAC key management: get or create a daily key atomically.
// Uses a read-then-upsert pattern; the ON CONFLICT on key_date ensures
// only one key per date even under concurrent generate calls.
async findOrCreateHmacKey(keyDate: string): Promise<string> {
  // Fast path: key already exists for this date
  const { data: existing } = await this.client
    .from('lunch_link_keys')
    .select('hmac_key')
    .eq('key_date', keyDate)
    .maybeSingle();
  if (existing) return (existing as { hmac_key: string }).hmac_key;

  // Slow path: generate + upsert (ON CONFLICT: keep winner's key)
  const { randomBytes } = await import('node:crypto');
  const candidate = randomBytes(32).toString('hex');

  const { data: inserted, error } = await this.client
    .from('lunch_link_keys')
    .upsert(
      { key_date: keyDate, hmac_key: candidate },
      { onConflict: 'key_date', ignoreDuplicates: true },
    )
    .select('hmac_key')
    .maybeSingle();
  if (error) throw error;

  if (inserted !== null) return (inserted as { hmac_key: string }).hmac_key;

  // Race: another process won the upsert — re-fetch the winner's key
  const { data: winner, error: fetchErr } = await this.client
    .from('lunch_link_keys')
    .select('hmac_key')
    .eq('key_date', keyDate)
    .single();
  if (fetchErr) throw fetchErr;
  return (winner as { hmac_key: string }).hmac_key;
}

// Verify flow: get HMAC key for a date (null if date is not in the table).
async findHmacKey(keyDate: string): Promise<string | null> {
  const { data, error } = await this.client
    .from('lunch_link_keys')
    .select('hmac_key')
    .eq('key_date', keyDate)
    .maybeSingle();
  if (error) throw error;
  return (data as { hmac_key: string } | null)?.hmac_key ?? null;
}
```

**⚠️ RPC note:** `increment_lunch_link_reopen_count` is an atomic PostgreSQL function needed to avoid a read-modify-write race. Add it in migration `20261001000000` or a separate migration:

```sql
CREATE OR REPLACE FUNCTION increment_lunch_link_reopen_count(
  p_child_id uuid,
  p_date date
) RETURNS void LANGUAGE sql AS $$
  UPDATE lunch_link_sessions
  SET reopened_after_exp_count = reopened_after_exp_count + 1
  WHERE child_id = p_child_id AND date = p_date;
$$;
```

Add this function to migration `T1.1` (append to the same file).

---

### T4 — API Service

**T4.1** Rewrite `apps/api/src/modules/lunch-link/lunch-link.service.ts`.

Keep `getDevPayload()` intact. Add `generate()` and `verifyAndFetch()`.

The service now takes a third constructor argument `webBaseUrl: string`.

**Token utilities** (module-level, not exported — tested via service methods):

```typescript
import { createHmac, timingSafeEqual, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';

// Internal token payload schema — not exposed via contracts package
const TokenPayloadSchema = z.object({
  child_id: z.string().uuid(),
  date: z.string().date(),
  nonce: z.string().uuid(),
  exp: z.string().datetime({ offset: true }),
});
type TokenPayload = z.infer<typeof TokenPayloadSchema>;

function encodeBase64url(str: string): string {
  return Buffer.from(str)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function signToken(payload: TokenPayload, hmacKeyHex: string): string {
  const encoded = encodeBase64url(JSON.stringify(payload));
  const sig = createHmac('sha256', Buffer.from(hmacKeyHex, 'hex'))
    .update(encoded)
    .digest('hex');
  return `${encoded}.${sig}`;
}

// Returns null on any parse/validation failure — caller treats as invalid.
function parseToken(rawToken: string): (TokenPayload & { encodedPayload: string; signature: string }) | null {
  const dotIdx = rawToken.lastIndexOf('.');
  if (dotIdx === -1) return null;
  const encodedPayload = rawToken.slice(0, dotIdx);
  const signature = rawToken.slice(dotIdx + 1);
  if (!/^[0-9a-f]{64}$/.test(signature)) return null;
  try {
    const json = Buffer.from(encodedPayload, 'base64url').toString('utf-8');
    const parsed = TokenPayloadSchema.parse(JSON.parse(json));
    return { ...parsed, encodedPayload, signature };
  } catch {
    return null;
  }
}

function verifyHmac(encodedPayload: string, providedSig: string, hmacKeyHex: string): boolean {
  const expected = createHmac('sha256', Buffer.from(hmacKeyHex, 'hex'))
    .update(encodedPayload)
    .digest('hex');
  try {
    return timingSafeEqual(
      Buffer.from(providedSig, 'hex'),
      Buffer.from(expected, 'hex'),
    );
  } catch {
    // providedSig is odd-length or non-hex — timingSafeEqual throws on length mismatch
    return false;
  }
}

/**
 * Returns a UTC Date representing 8pm in the given IANA timezone on isoDate.
 * Uses the noon-UTC trick: noon UTC is always on the correct calendar date
 * for offsets in [-12, +12]. Not correct for UTC+14 (Line Islands, ~2000 people).
 *
 * Uses Intl.DateTimeFormat.formatToParts — no third-party dep required.
 */
function compute8pmUtc(isoDate: string, tz: string): Date {
  // Noon UTC is on the correct calendar date in all practical school-delivery timezones
  const noon = new Date(`${isoDate}T12:00:00Z`);

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(noon);

  const pMap = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const localHour = parseInt(pMap['hour'] ?? '12', 10);
  const localMinute = parseInt(pMap['minute'] ?? '0', 10);

  // At noon UTC, local time is localHour:localMinute.
  // Minutes to 8pm local from noon UTC:
  //   (8pm local − noon local) = (20*60 − (localHour*60 + localMinute)) minutes from noon UTC
  const minutesFromNoonUtc = 20 * 60 - (localHour * 60 + localMinute);
  return new Date(noon.getTime() + minutesFromNoonUtc * 60 * 1000);
}
```

**Updated class:**

```typescript
const STUB_BAG = {
  name: 'Sandwich, apple & water',
  sub: 'Packed for you today',
  safetyNote: 'Nut-free',
} as const;

export class LunchLinkService {
  constructor(
    private readonly lunchLinkRepo: LunchLinkRepository,
    private readonly heartNoteRepo: HeartNoteRepository,
    private readonly webBaseUrl: string,
  ) {}

  async generate(
    householdId: string,
    body: GenerateLunchLinkBody,
  ): Promise<GenerateLunchLinkResponse> {
    // Ownership check
    const childName = await this.lunchLinkRepo.findChildName(body.child_id, householdId);
    if (childName === null) throw new NotFoundError('Child not found');

    // Compute 8pm expiry in household timezone
    const tz = await this.lunchLinkRepo.findHouseholdTimezone(householdId);
    const exp = compute8pmUtc(body.date, tz);

    // Get or create daily HMAC key
    const hmacKey = await this.lunchLinkRepo.findOrCreateHmacKey(body.date);

    // Build + sign token
    const nonce = randomUUID();
    const payload: TokenPayload = {
      child_id: body.child_id,
      date: body.date,
      nonce,
      exp: exp.toISOString(),
    };
    const token = signToken(payload, hmacKey);

    // Upsert session (preserves tracking columns on conflict)
    await this.lunchLinkRepo.upsertSession({
      childId: body.child_id,
      householdId,
      date: body.date,
      nonce,
      exp: exp.toISOString(),
    });

    return { url: `${this.webBaseUrl}/lunch/${token}` };
  }

  async verifyAndFetch(rawToken: string): Promise<
    | { status: 'invalid' }
    | { status: 'valid'; payload: LunchLinkPayload }
    | { status: 'expired'; expiredPayload: LunchLinkExpiredPayload; householdId: string }
  > {
    // 1. Parse + validate token structure
    const parsed = parseToken(rawToken);
    if (parsed === null) return { status: 'invalid' };

    // 2. Get HMAC key for the date encoded in the token
    const hmacKey = await this.lunchLinkRepo.findHmacKey(parsed.date);
    if (hmacKey === null) return { status: 'invalid' };

    // 3. Verify HMAC — constant-time
    if (!verifyHmac(parsed.encodedPayload, parsed.signature, hmacKey)) {
      return { status: 'invalid' };
    }

    // 4. Get session to check suppression
    const session = await this.lunchLinkRepo.findSession(parsed.child_id, parsed.date);
    if (session?.suppressed_at !== null && session?.suppressed_at !== undefined) {
      return { status: 'invalid' };
    }

    // 5. Get child + household
    const childInfo = await this.lunchLinkRepo.findChildPublic(parsed.child_id);
    if (childInfo === null) return { status: 'invalid' };

    // 6. Get heart note
    const noteRow = await this.heartNoteRepo.findByChildAndDate(
      childInfo.household_id,
      parsed.child_id,
      parsed.date,
    );
    const heartNote =
      noteRow?.content?.trim()
        ? { body: noteRow.content, authorDisplayName: 'Parent' }
        : null;

    const isExpired = new Date() >= new Date(parsed.exp);

    if (!isExpired) {
      await this.lunchLinkRepo.recordFirstOpen(parsed.child_id, parsed.date);
      return {
        status: 'valid',
        payload: {
          childName: childInfo.name,
          date: parsed.date,
          heartNote,
          bag: { ...STUB_BAG },
          expired: false,
        },
      };
    } else {
      await this.lunchLinkRepo.incrementReopenedCount(parsed.child_id, parsed.date);
      return {
        status: 'expired',
        householdId: childInfo.household_id,
        expiredPayload: {
          expired: true,
          last_state_snapshot: {
            heartNote,
            rating: session?.rating ?? null,
            bag: { ...STUB_BAG },
          },
        },
      };
    }
  }

  // Unchanged from 4-S2
  async getDevPayload(
    householdId: string,
    childId: string,
    date: string,
  ): Promise<LunchLinkDevResponse | null> { /* ... keep as-is ... */ }
}
```

---

### T5 — API Routes

**T5.1** Extend `apps/api/src/modules/lunch-link/lunch-link.routes.ts`.

Add imports:
```typescript
import {
  LunchLinkDevParamsSchema,
  LunchLinkDevResponseSchema,
  GenerateLunchLinkBodySchema,
  GenerateLunchLinkResponseSchema,
  LunchLinkTokenParamSchema,
  LunchLinkPayloadSchema,
  LunchLinkExpiredPayloadSchema,
  type GenerateLunchLinkBody,
  type LunchLinkTokenParam,
} from '@hivekitchen/contracts';
```

Update service instantiation to pass `webBaseUrl`:
```typescript
const service = new LunchLinkService(lunchLinkRepo, heartNoteRepo, fastify.env.WEB_BASE_URL);
```

Add two routes inside the plugin (after the existing dev route):

```typescript
// Parent-facing: generate a real signed Lunch Link URL.
// Auth-gated — children do not use this endpoint.
fastify.post(
  '/v1/lunch-link/generate',
  {
    preHandler: requireMember,
    schema: {
      body: GenerateLunchLinkBodySchema,
      response: { 201: GenerateLunchLinkResponseSchema },
    },
  },
  async (request, reply) => {
    const body = request.body as GenerateLunchLinkBody;
    const result = await service.generate(request.user.household_id, body);
    // Emit audit event
    request.auditContext = {
      event_type: 'lunch_link.created',
      household_id: request.user.household_id,
      user_id: request.user.id,
      correlation_id: request.id,
      metadata: { child_id: body.child_id, date: body.date },
    };
    return reply.status(201).send(result);
  },
);

// Child-facing: verify token + return payload or 410 snapshot.
// PUBLIC — authenticate hook is skipped for GET /v1/lunch-link/:token via regex.
// Never returns 401/403 — all failure modes are 404 to avoid leaking info.
fastify.get(
  '/v1/lunch-link/:token',
  {
    schema: {
      params: LunchLinkTokenParamSchema,
      response: {
        200: LunchLinkPayloadSchema,
        410: LunchLinkExpiredPayloadSchema,
      },
    },
  },
  async (request, reply) => {
    const { token } = request.params as LunchLinkTokenParam;
    const result = await service.verifyAndFetch(token);

    if (result.status === 'invalid') {
      throw new NotFoundError('Link not found');
    }
    if (result.status === 'expired') {
      request.auditContext = {
        event_type: 'lunch_link.expired',
        household_id: result.householdId,
        correlation_id: request.id,
        metadata: { token_prefix: token.slice(0, 8) },
      };
      return reply.status(410).send(result.expiredPayload);
    }
    // status === 'valid'
    request.auditContext = {
      event_type: 'lunch_link.opened',
      household_id: result.payload.childName, // can't derive hh_id here without extra lookup — omit
      correlation_id: request.id,
      metadata: { date: result.payload.date },
    };
    return result.payload;
  },
);
```

**Audit context note:** The public endpoint doesn't have `request.user`. For the audit hook, pass `household_id` from the verify result (present in `status === 'expired'`). For `status === 'valid'`, the household_id isn't in the `LunchLinkPayload` return type. Fix: add `householdId` to the `status: 'valid'` return branch in the service (mirror what `status: 'expired'` does). Update the service return type accordingly and use it in the route.

**T5.2** Modify `apps/api/src/middleware/authenticate.hook.ts`.

Add at the top (after `SKIP_EXACT`):
```typescript
// GET /v1/lunch-link/:token is the public child-facing endpoint.
// Only GET is skipped — POST /v1/lunch-link/generate stays auth-gated.
const LUNCH_LINK_PUBLIC_RE = /^\/v1\/lunch-link\/[^/]+$/;
```

Add before the `Authorization` header check:
```typescript
if (LUNCH_LINK_PUBLIC_RE.test(url) && request.method === 'GET') return;
```

---

### T6 — Web

**T6.1** Add `publicGet` to `apps/web/src/lib/fetch.ts`:

```typescript
/**
 * Unauthenticated GET — for public endpoints that children access without logging in.
 * Returns { status, body } so the caller can handle non-2xx responses (e.g. 410 Gone).
 */
export async function publicGet(path: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'GET',
    credentials: 'include',
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // no JSON body
  }
  return { status: res.status, body };
}
```

**T6.2** Rewrite `apps/web/src/routes/(app)/lunch-link.tsx`.

Key changes from S2:
- Add `isHmacToken()` detector
- Add `'expired'` to `LoadState`
- Add `expiredSnapshot` state
- Branch fetch logic between stub and HMAC paths
- Add `LunchLinkExpiredState` component
- Import new types from contracts

```typescript
import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { hkFetch, publicGet } from '@/lib/fetch.js';
import type {
  LunchLinkDevResponse,
  LunchLinkPayload,
  LunchLinkExpiredPayload,
} from '@hivekitchen/contracts';
import { FeedbackBlock } from '@/features/lunch-link/components/FeedbackBlock.js';
import { HeartNoteCard } from '@/features/lunch-link/components/HeartNoteCard.js';
import { LunchSummary } from '@/features/lunch-link/components/LunchSummary.js';
import { MumNoteSalutation } from '@/features/lunch-link/components/MumNoteSalutation.js';
import type { RatingOption } from '@/features/lunch-link/data/mockData.js';

type LoadState = 'loading' | 'invalid-link' | 'error' | 'loaded' | 'expired';

// S2 stub token: test-{UUID:36}-{date:10} = 52 chars
function parseStubLinkId(linkId: string): { childId: string; date: string } | null {
  // ... unchanged from S2
}

// S3 real HMAC token: {base64url(payload)}.{64 hex chars}
// base64url chars: A-Za-z0-9-_ (no dots in the payload part)
function isHmacToken(linkId: string): boolean {
  const dotIdx = linkId.lastIndexOf('.');
  if (dotIdx === -1) return false;
  const encodedPart = linkId.slice(0, dotIdx);
  const sigPart = linkId.slice(dotIdx + 1);
  return (
    encodedPart.length > 0 &&
    /^[A-Za-z0-9_-]+$/.test(encodedPart) &&
    /^[0-9a-f]{64}$/.test(sigPart)
  );
}

function formatDateLabel(isoDate: string): string {
  // ... unchanged from S2 (noon-UTC trick)
}

const RATING_OPTIONS = [ /* ... unchanged */ ] as const satisfies readonly RatingOption[];

const RATING_EMOJIS: Record<string, string> = {
  loved: '😋',
  ok: '🙂',
  'not-really': '😕',
};

export default function LunchLinkRoute() {
  const { linkId } = useParams<{ linkId: string }>();

  const isStub = linkId ? linkId.startsWith('test-') : false;
  const isHmac = linkId ? isHmacToken(linkId) : false;
  const stubParsed = isStub && linkId ? parseStubLinkId(linkId) : null;

  const [loadState, setLoadState] = useState<LoadState>(
    isStub || isHmac ? 'loading' : 'invalid-link',
  );
  const [data, setData] = useState<LunchLinkDevResponse | LunchLinkPayload | null>(null);
  const [expiredSnapshot, setExpiredSnapshot] = useState<LunchLinkExpiredPayload['last_state_snapshot'] | null>(null);

  useEffect(() => {
    if (!linkId) return;
    let isMounted = true;

    if (isStub && stubParsed) {
      // S2 dev path — unchanged
      setLoadState('loading');
      hkFetch<LunchLinkDevResponse>(
        `/v1/lunch-link-dev/${stubParsed.childId}/${stubParsed.date}`,
        { method: 'GET' },
      )
        .then((res) => {
          if (isMounted) { setData(res); setLoadState('loaded'); }
        })
        .catch(() => {
          if (isMounted) setLoadState('error');
        });
    } else if (isHmac) {
      // S3 real HMAC token — public fetch (child has no auth token)
      setLoadState('loading');
      publicGet(`/v1/lunch-link/${linkId}`)
        .then(({ status, body }) => {
          if (!isMounted) return;
          if (status === 200) {
            setData(body as LunchLinkPayload);
            setLoadState('loaded');
          } else if (status === 410) {
            const expired = body as LunchLinkExpiredPayload;
            setExpiredSnapshot(expired.last_state_snapshot);
            setLoadState('expired');
          } else {
            setLoadState('error');
          }
        })
        .catch(() => {
          if (isMounted) setLoadState('error');
        });
    }

    return () => { isMounted = false; };
  }, [linkId]);

  if (loadState === 'invalid-link') {
    return <LunchLinkErrorState message="This link doesn't look right." />;
  }
  if (loadState === 'loading') {
    return <LunchLinkLoadingState />;
  }
  if (loadState === 'error') {
    return <LunchLinkErrorState message="Couldn't load this lunch link. Please try again." />;
  }
  if (loadState === 'expired' && expiredSnapshot !== null) {
    return <LunchLinkExpiredState snapshot={expiredSnapshot} />;
  }
  if (data === null) {
    return <LunchLinkErrorState message="Couldn't load this lunch link. Please try again." />;
  }

  // Loaded — works for both stub (LunchLinkDevResponse) and real (LunchLinkPayload)
  const { childName, date, heartNote, bag } = data as { childName: string; date: string; heartNote: { body: string; authorDisplayName: string } | null; bag: { name: string; sub: string; safetyNote: string } };
  const dateLabel = formatDateLabel(date);

  return (
    <main className="flex w-full flex-grow items-center justify-center px-4 py-8 sm:py-12">
      <div className="w-full max-w-md space-y-8">
        <MumNoteSalutation title="A note from Parent" date={dateLabel} />
        <HeartNoteCard
          body={(heartNote?.body?.trim() ? heartNote.body : null) ?? 'No note today — check back soon'}
          from={heartNote ? `— ${heartNote.authorDisplayName}` : ''}
        />
        <LunchSummary
          lunch={{ eyebrow: "Today's Lunch", name: bag.name, sub: bag.sub, safetyBadge: bag.safetyNote }}
        />
        <FeedbackBlock
          question={`How was lunch, ${childName}?`}
          options={RATING_OPTIONS}
          hint="Tap one. That's all."
        />
      </div>
    </main>
  );
}

function LunchLinkExpiredState({
  snapshot,
}: {
  readonly snapshot: LunchLinkExpiredPayload['last_state_snapshot'];
}) {
  return (
    <main className="flex w-full flex-grow items-center justify-center px-4 py-8 sm:py-12">
      <div className="w-full max-w-md space-y-8">
        <p className="text-center text-sm text-fg-muted">This link closed at 8pm</p>
        <HeartNoteCard
          body={(snapshot.heartNote?.body?.trim() ? snapshot.heartNote.body : null) ?? 'No note for this day'}
          from={snapshot.heartNote ? `— ${snapshot.heartNote.authorDisplayName}` : ''}
        />
        {snapshot.rating !== null && (
          <p className="text-center text-4xl" aria-label={`Child rated: ${snapshot.rating}`}>
            {RATING_EMOJIS[snapshot.rating]}
          </p>
        )}
        <LunchSummary
          lunch={{
            eyebrow: "Today's Lunch",
            name: snapshot.bag.name,
            sub: snapshot.bag.sub,
            safetyBadge: snapshot.bag.safetyNote,
          }}
        />
      </div>
    </main>
  );
}

function LunchLinkLoadingState() { /* ... unchanged from S2 */ }
function LunchLinkErrorState({ message }: { readonly message: string }) { /* ... unchanged */ }
```

**T6.3** Add "Copy link" button to `apps/web/src/routes/(app)/heart-note.tsx`.

Add to the existing state:
```typescript
const [copyState, setCopyState] = useState<'idle' | 'copying' | 'copied'>('idle');
```

Add a `handleCopyLink` function:
```typescript
async function handleCopyLink() {
  if (!activeChild || copyState !== 'idle') return;
  setCopyState('copying');
  try {
    const { url } = await hkFetch<{ url: string }>('/v1/lunch-link/generate', {
      method: 'POST',
      body: { child_id: activeChild.id, date: todayDate },
    });
    await navigator.clipboard.writeText(url);
    setCopyState('copied');
    setTimeout(() => setCopyState('idle'), 2000);
  } catch {
    setCopyState('idle');
  }
}
```

Pass to `HeartNoteActions` — add `onCopyLink` and `copyState` props to `HeartNoteActions`. Inside `HeartNoteActions`, add a secondary button (below the existing Save/Skip buttons, or as a tertiary action):

```tsx
{onCopyLink && (
  <button
    type="button"
    onClick={onCopyLink}
    disabled={copyState === 'copying' || saveStatus === 'saving'}
    className="text-sm text-fg-muted underline underline-offset-2 disabled:opacity-50"
  >
    {copyState === 'copied' ? 'Copied!' : 'Copy lunch link'}
  </button>
)}
```

The styling should be minimal — a text-link, not a full button — so it doesn't compete with "Save the note" (the primary CTA). Use `text-fg-muted` with an underline; see `DESIGN.md` for the correct token. If the design system specifies a different pattern for tertiary actions, follow it.

---

### T7 — Tests

**T7.1** Extend `apps/api/src/modules/lunch-link/lunch-link.service.test.ts`:

```typescript
describe('LunchLinkService.generate', () => {
  it('returns a signed URL for a valid child + date');
  it('throws NotFoundError when child not in household');
  it('includes the correct base URL prefix in the generated URL');
});

describe('LunchLinkService.verifyAndFetch', () => {
  it('returns status:invalid for a malformed token (no dot)');
  it('returns status:invalid for a token with wrong HMAC signature');
  it('returns status:invalid when HMAC key not found for date');
  it('returns status:invalid for a suppressed session');
  it('returns status:invalid for an unknown child_id');
  it('returns status:valid with heartNote when note exists and token unexpired');
  it('returns status:valid with heartNote:null when no note exists');
  it('returns status:expired with snapshot when token is past exp');
  it('includes session rating in the expired snapshot');
});

describe('token signing utilities (via service round-trip)', () => {
  it('signToken + parseToken + verifyHmac round-trip is valid');
  it('tampered payload fails HMAC verification');
});

describe('compute8pmUtc', () => {
  // Export compute8pmUtc from the service module for testing, OR test via generate()
  it('returns 01:00 UTC for UTC-5 timezone on date 2026-09-01');
  it('returns 12:00 UTC for UTC+8 timezone on date 2026-09-01');
  it('returns 14:30 UTC for UTC+5:30 (Asia/Kolkata) on date 2026-09-01');
});
```

For timezone tests, compute expected values manually:
- UTC-5, 8pm = 20:00 local = 01:00 UTC next day → `new Date('2026-09-02T01:00:00Z')`
- UTC+8, 8pm = 20:00 local = 12:00 UTC same day → `new Date('2026-09-01T12:00:00Z')`
- UTC+5:30, 8pm = 20:00 IST = 14:30 UTC same day → `new Date('2026-09-01T14:30:00Z')`

**T7.2** Extend `apps/api/src/modules/lunch-link/lunch-link.routes.test.ts`:

```typescript
describe('POST /v1/lunch-link/generate', () => {
  it('201 with { url } for authenticated parent with valid child + date');
  it('401 when no auth token provided');
  it('404 when child_id is not in caller household');
  it('400 when child_id is not a UUID');
  it('400 when date is missing');
});

describe('GET /v1/lunch-link/:token', () => {
  it('200 with payload for valid unexpired token (no auth header required)');
  it('200 with heartNote:null when no note exists');
  it('410 with last_state_snapshot for expired token');
  it('410 snapshot includes rating when session has a rating');
  it('404 for malformed token');
  it('404 for valid-format but wrong-HMAC token');
  it('404 for suppressed session');
});
```

Test helpers for routes tests:
- Create a real signed token using `signToken()` (import the utility or use the service's `generate()` directly)
- Override the session's `exp` in the DB stub to `new Date(Date.now() - 1000).toISOString()` to test expiry

---

## Dev Notes

### Token format invariants

The dot (`.`) splits `encodedPayload` from the HMAC signature. The base64url alphabet does not contain `.`, so `lastIndexOf('.')` unambiguously separates the two parts. The signature is always exactly 64 hex chars (SHA-256 output). Any deviation is invalid — return 404 immediately.

### Suppress-before-expiry semantics

If `lunch_link_sessions.suppressed_at IS NOT NULL`, return 404 regardless of HMAC validity or expiry. Story 3-28 writes this column. The S3 verify path checks suppression AFTER HMAC verification (to avoid leaking that the session exists to unauthenticated callers guessing tokens).

### Public route and audit context

The `GET /v1/lunch-link/:token` route has no `request.user`. The audit hook reads `request.auditContext` after the handler runs. Set `household_id` in `auditContext` from `result.householdId` (returned by the service). For the `status: 'valid'` branch, the service must return `householdId` alongside `payload` — add it to the return type.

### upsertSession ON CONFLICT semantics

`ON CONFLICT (child_id, date)` with the default Supabase upsert behavior performs a full UPDATE on conflict. This would overwrite `first_opened_at` and `rating` with NULL if the column isn't in the upsert payload. Fix: use Supabase's `.upsert({ ...only nonce/exp/household_id fields... }, { onConflict: 'child_id,date' })` with a `UPDATE SET nonce=EXCLUDED.nonce, exp=EXCLUDED.exp` semantics. The Supabase JS client's `.upsert()` only sets the columns you provide — columns not in the payload are left untouched if you're using Postgres `DO UPDATE SET` (not `DO NOTHING`). Verify this is correct by checking the actual SQL the client emits, or test with an existing session that has `first_opened_at` set.

### isHmacToken false-positive guard

The regex `/^[A-Za-z0-9_-]+$/` on the encoded part and `/^[0-9a-f]{64}$/` on the signature is conservative. A stub token like `test-abc-2026-09-01` starts with `test-` (not base64url — the `-` between segments is fine, but `test` + dot lookup returns `-1` from `lastIndexOf('.')`). In practice, `isHmacToken` and `parseStubLinkId` are mutually exclusive — a token starting with `test-` will fail `isHmacToken` because it has no `.`.

### compute8pmUtc DST correctness

`Intl.DateTimeFormat` internally uses the IANA timezone database and correctly handles DST transitions. If the delivery date falls on a DST change day, the 8pm local time is computed correctly. For example, in `America/New_York`, the spring-forward Sunday (e.g., 2026-03-08) is handled: at noon UTC, `formatToParts` returns the post-DST local time (EDT, UTC-4), so 8pm EDT = 00:00 UTC next day.

### Project Structure Notes

**New files:**
- `supabase/migrations/20261001000000_extend_lunch_link_sessions_for_s3.sql`
- `supabase/migrations/20261001000100_create_lunch_link_keys.sql`

**Modified files:**
- `packages/contracts/src/lunch-link.ts`
- `packages/contracts/src/lunch-link.test.ts`
- `apps/api/src/modules/lunch-link/lunch-link.repository.ts`
- `apps/api/src/modules/lunch-link/lunch-link.service.ts`
- `apps/api/src/modules/lunch-link/lunch-link.routes.ts`
- `apps/api/src/modules/lunch-link/lunch-link.service.test.ts`
- `apps/api/src/modules/lunch-link/lunch-link.routes.test.ts`
- `apps/api/src/middleware/authenticate.hook.ts`
- `apps/web/src/routes/(app)/lunch-link.tsx`
- `apps/web/src/lib/fetch.ts`
- `apps/web/src/routes/(app)/heart-note.tsx`
- `apps/web/src/features/heart-note/components/HeartNoteActions.tsx`

**Not modified:**
- `apps/api/src/app.ts` — `lunchLinkRoutes` already registered
- `packages/contracts/src/index.ts` — already re-exports `./lunch-link.js`
- `apps/web/src/routes/_dev-lunch-link.tsx`
- `apps/web/src/features/lunch-link/data/mockData.ts`

### References

- [Source: `_bmad-output/planning-artifacts/epic-4-vertical-slices.md` §Slice 4-S3]
- [Source: `_bmad-output/implementation-artifacts/4-s1-compose-heart-note-draft.md`] — TanStack Query ban, hkFetch pattern, autosave pattern
- [Source: `_bmad-output/implementation-artifacts/4-s2-render-heart-note-on-child-surface-stub-token.md`] — LunchLinkRepository lean pattern, parseStubLinkId, formatDateLabel noon-UTC trick, isMounted guard, LunchLinkDevResponse type
- [Source: `apps/api/src/middleware/authenticate.hook.ts`] — SKIP_PREFIXES / SKIP_EXACT pattern for adding public routes
- [Source: `apps/api/src/common/env.ts`] — WEB_BASE_URL env var exists, type is string
- [Source: `apps/api/src/modules/households/households.repository.ts`] — `findAllActive` shows `households.timezone` is a plaintext column (no DEK), query pattern with `.select('id, timezone')`

---

## Task Completion Checklist

- [x] T1.1 — Migration `20261001000000_extend_lunch_link_sessions_for_s3.sql` (ALTER + trigger + RPC). Note: used project's existing `set_updated_at()` function, not `moddatetime` (not installed in this codebase).
- [x] T1.2 — Migration `20261001000100_create_lunch_link_keys.sql` (table + RLS, no user policy).
- [x] T2.1 — Appended S3 schemas to `packages/contracts/src/lunch-link.ts`.
- [x] T2.2 — No change to `packages/contracts/src/index.ts` (already re-exports lunch-link).
- [x] T2.3 — Added S3 schema tests in `lunch-link.test.ts` (12 new tests, all pass).
- [x] T3.1 — Extended `LunchLinkRepository` with the 8 new methods + `LunchLinkSessionRow` type.
- [x] T4.1 — Rewrote `LunchLinkService`: token utils (`encodeBase64url`, `signToken`, `parseToken`, `verifyHmac`, `compute8pmUtc`) exported for test use; `generate()` and `verifyAndFetch()` added; `getDevPayload()` preserved. Service `verifyAndFetch()` returns `householdId` in both valid + expired branches (so the public route can populate `auditContext` without a separate lookup).
- [x] T5.1 — Added POST `/v1/lunch-link/generate` (requireMember) and public GET `/v1/lunch-link/:token` to `lunch-link.routes.ts`. Service is now instantiated with `fastify.env.WEB_BASE_URL`.
- [x] T5.2 — Authenticate hook: added `LUNCH_LINK_PUBLIC_RE` and the GET-only skip branch.
- [x] T6.1 — Added `publicGet` to `apps/web/src/lib/fetch.ts`.
- [x] T6.2 — Rewrote `lunch-link.tsx`: HMAC detection + branched fetch + `LunchLinkExpiredState` panel. Stub path unchanged.
- [x] T6.3 — Added "Copy link" tertiary button to `HeartNoteActions` + `handleCopyLink` flow in `heart-note.tsx`.
- [x] T7.1 — Service test suite: 24 specs covering generate, verifyAndFetch (8 branches), compute8pmUtc (4 timezones), token round-trip + tamper.
- [x] T7.2 — Routes test suite: 14 specs covering POST /generate (5) + public GET (8) + 1 retained dev route smoke.

## Dev Agent Record

### Agent Model Used

claude-opus-4-7 (Opus 4.7 — 1M context). Invoked via `bmad-dev-story` skill on 2026-05-26.

### Debug Log References

- Test failure during initial routes test run: long signed-token URLs (~310 chars) hit Fastify default `find-my-way` `maxParamLength=100`, producing a router-level 404. Resolved by setting `routerOptions: { maxParamLength: 1024 }` on the production Fastify instance in `apps/api/src/app.ts` and on the routes test app.
- Story doc referenced PostgreSQL `moddatetime` extension; this codebase uses a project-defined `set_updated_at()` function (see `20260510000500_children_updated_at_trigger.sql`). Migration uses the project pattern.

### Completion Notes List

- All 14 ACs satisfied. Demo path: parent clicks "Copy link" → URL copied → opening URL in fresh tab renders heart note + bag; fast-forwarding past 8pm yields the 410 expired panel with last-state snapshot and increments `reopened_after_exp_count`.
- Token format: `base64url(JSON).hex64`. HMAC verified with `crypto.timingSafeEqual` (constant-time).
- All failure modes on the public GET return 404 (malformed, wrong HMAC, missing key, suppressed, unknown child) — no oracle leakage.
- `compute8pmUtc` uses `Intl.DateTimeFormat.formatToParts()` at noon UTC + minute-offset math; DST-correct via IANA tzdb. Not correct for UTC+14 (documented edge case).
- `findOrCreateHmacKey` uses read-then-upsert with `ignoreDuplicates: true`; race losers re-read the winner's key. PRIMARY KEY on `key_date` enforces uniqueness.
- Targeted test pass rate: contracts 25/25 ✅, api lunch-link 38/38 ✅. Workspace typecheck: 0 new errors in modified files (22 pre-existing in other modules per baseline).
- Workspace test run shows 30 pre-existing failures (auth, day-overrides, plans, memory, brief-state, etc.) — verified unchanged by baseline (git stash -u) reproduction; no regressions introduced by this slice.

### File List

**New:**
- `supabase/migrations/20261001000000_extend_lunch_link_sessions_for_s3.sql`
- `supabase/migrations/20261001000100_create_lunch_link_keys.sql`

**Modified:**
- `apps/api/src/app.ts` (routerOptions.maxParamLength to admit long tokens)
- `apps/api/src/middleware/authenticate.hook.ts` (LUNCH_LINK_PUBLIC_RE skip)
- `apps/api/src/modules/lunch-link/lunch-link.repository.ts`
- `apps/api/src/modules/lunch-link/lunch-link.service.ts`
- `apps/api/src/modules/lunch-link/lunch-link.service.test.ts`
- `apps/api/src/modules/lunch-link/lunch-link.routes.ts`
- `apps/api/src/modules/lunch-link/lunch-link.routes.test.ts`
- `apps/web/src/features/heart-note/components/HeartNoteActions.tsx`
- `apps/web/src/lib/fetch.ts`
- `apps/web/src/routes/(app)/heart-note.tsx`
- `apps/web/src/routes/(app)/lunch-link.tsx`
- `packages/contracts/src/lunch-link.test.ts`
- `packages/contracts/src/lunch-link.ts`

### Review Findings

_Code review: 3-layer adversarial pass — 2026-05-26_

- [x] [Review][Patch] `publicGet` sends `credentials: 'include'` — unauthenticated public fetch should use `credentials: 'omit'`; `'include'` attaches session cookies to a public child-facing request and requires CORS credentialed response headers [`apps/web/src/lib/fetch.ts:~83`]
- [x] [Review][Patch] Null session not guarded in `verifyAndFetch` — if `findSession` returns `null` (race between generate and open, or row deleted), the suppression check evaluates to `false` and execution continues as if not suppressed; add `if (session === null) return { status: 'invalid' }` before the suppression guard [`apps/api/src/modules/lunch-link/lunch-link.service.ts:~88`]
- [x] [Review][Patch] Invalid `tz` string throws uncaught `RangeError` in `compute8pmUtc` — if `households.timezone` contains a garbage value (e.g. empty string, `"America/Gotham"`), `new Intl.DateTimeFormat(...)` throws and the 500 is unformatted; wrap in try/catch and fall back to `'UTC'` [`apps/api/src/modules/lunch-link/lunch-link.service.ts:~64`]
- [x] [Review][Patch] `isSaving={inFlightRef.current}` reads a mutable ref at render time — `inFlightRef.current` is never a React state update trigger, so the "Copy link" button's `disabled` state never re-renders to `true` when a save starts (AC12 requires it to be disabled while a save is in flight) [`apps/web/src/routes/(app)/heart-note.tsx:~240`]
- [x] [Review][Patch] `lunch_link.opened` audit event missing `child_id` in metadata — `metadata: { date: ... }` is insufficient to attribute a link-open to a specific child; `child_id` from the token payload is available in the service result; add it to the audit context (and surface it from `verifyAndFetch`'s return type) [`apps/api/src/modules/lunch-link/lunch-link.routes.ts:~132`]
- [x] [Review][Patch] `handleCopyLink` captures date with `isoToday()` at click time — a parent who loads the page at 11:55 PM and clicks "Copy link" after midnight generates a link for D+1 with a note saved for D; date should be captured at mount (same `isoToday()` call that drives the note load) [`apps/web/src/routes/(app)/heart-note.tsx:~180`]
- [x] [Review][Patch] Server 404 mapped to `'error'` load-state in `lunch-link.tsx` — a 404 (invalid/tampered token) shows "Couldn't load this link. Please try again." (transient error message); it should set `'invalid-link'` and render "This link doesn't look right." instead [`apps/web/src/routes/(app)/lunch-link.tsx:~115`]
- [x] [Review][Defer] `generate()` does not check suppression before issuing token — a suppressed `(child_id, date)` session gets its nonce/exp overwritten and a non-functional URL is returned to the parent with no error; suppression logic belongs to 3-28/4-S6 scope, not 4-S3 — deferred, pre-existing
- [x] [Review][Defer] `LUNCH_LINK_PUBLIC_RE` matches `GET /v1/lunch-link/generate` — the regex `[^/]+` matches the word `generate`, so if a GET handler is ever added there it would be accidentally public; no current risk — deferred, pre-existing
- [x] [Review][Defer] UTC+14 (Line Islands) computes wrong 8pm window — noon-UTC trick is documented as broken for UTC+14 offsets; affects ~2000 people; code comment already acknowledges — deferred, pre-existing
- [x] [Review][Defer] `verifyHmac` silently returns `false` on malformed hex key — `Buffer.from(badHex, 'hex')` silently truncates; no DB format constraint; `randomBytes(32).toString('hex')` always produces valid hex in practice — deferred, pre-existing
- [x] [Review][Defer] Semantically invalid dates (e.g. `2026-02-30`) pass Zod format check and cause `RangeError` in `compute8pmUtc` — Zod `z.string().date()` validates format, not calendar validity; DB `date` column would reject it at persistence layer; minor hardening — deferred, pre-existing

### Change Log

- 2026-05-26 — Slice 4-S3 implemented end-to-end. Real HMAC-signed Lunch Link tokens replace the dev stub. Token signing/verification uses Node's `crypto` (`createHmac`, `timingSafeEqual`, `randomUUID`, `randomBytes`); per-date HMAC keys live in `lunch_link_keys` (service-role only, no user RLS policy). Public child route returns 410 + last-state snapshot after the household-tz-aware 8pm cutoff. Parent-side "Copy link" button added to the Heart Note page. Fastify `maxParamLength` raised to 1024 to admit ~310-char tokens.
