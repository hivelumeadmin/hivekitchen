# Story 4-S4: Emoji Rating

Status: done

**Slice key:** `4-s4-emoji-rating`
**Epic:** 4 — Lunch Link & Heart Note Sacred Channel
**Source slice doc:** `_bmad-output/planning-artifacts/epic-4-vertical-slices.md` §Slice 4-S4
**Builds on:** 4-S3 (real HMAC tokens, `lunch_link_sessions.rating` column, `LunchLinkService.verifyAndFetch`, `publicGet`, `FeedbackBlock` component exists but `onRate` is not wired)
**Folds:** FR36 (emoji rater), FR125 (no thumbs-down — satisfied by the three-option constraint)

---

## Story

As a **child**,
I want **to tap an emoji after lunch**,
so that **Lumi learns what I liked and my parent can see my reaction on the weekly plan**.

---

## Acceptance Criteria

**AC1.** `POST /v1/lunch-link/:token/rate` is **PUBLIC** (no JWT). The route:
- Accepts `{ rating: 'loved' | 'ok' | 'not-really' }`.
- Verifies the HMAC token (same path as `GET /v1/lunch-link/:token`) using the existing `parseToken` / `findHmacKey` / `verifyHmac` utilities.
- Returns **404** if the token is invalid, the HMAC fails, the session is suppressed, or the child is not found.
- Returns **404** if the token is already **expired** at submission time — the link closed at 8pm, ratings after that are rejected.
- Writes `rating` and `rating_submitted_at` to `lunch_link_sessions` (columns exist from S3 migration `20261001000000`).
- Emits a `lunch_link.rated` audit event.
- Triggers a fire-and-forget `briefStateComposer.refresh(householdId, weekId, requestId)` so the parent's brief reflects the rating.
- Returns **204** with no body on success.
- Never returns 401 or 403 — all failure modes are 404 (oracle prevention).

**AC2.** `authenticate.hook.ts` skips JWT validation for `POST /v1/lunch-link/<anything>/rate` (regex: `/^\/v1\/lunch-link\/[^/]+\/rate$/`, method `POST` only). The existing `LUNCH_LINK_PUBLIC_RE` (GET-only) is unchanged.

**AC3.** `lunch_link_sessions.rating` is always updated on each valid submission (overwrite semantics — child can change their mind before 8pm).

**AC4.** `LunchLinkPayloadSchema` (200 response of `GET /v1/lunch-link/:token`) gains a `rating` field: `z.enum(['loved', 'ok', 'not-really']).nullable().default(null)`. The service populates it from the session row in `verifyAndFetch`.

**AC5.** On the child surface (`lunch-link.tsx`), tapping an emoji calls `publicPost('/v1/lunch-link/:token/rate', { rating })` (fire-and-forget — no await, no error toast). The `FeedbackBlock` locks immediately on first tap: the tapped emoji stays full-opacity, others fade, and no further taps are accepted. This is purely local state — the lock is not conditional on the API response.

**AC6.** When a child reloads the lunch link and `GET /v1/lunch-link/:token` returns a non-null `rating`, the `FeedbackBlock` renders that rating pre-selected and locked (via new `lockedRating` prop) — the child sees their saved choice without being able to re-tap.

**AC7.** `PlanTileSummarySchema` gains `child_ratings: z.record(z.string().uuid(), z.enum(['loved', 'ok', 'not-really'])).default({})`. `brief_state.composer.ts` populates this map using the same pattern as the suppression map — one DB query per refresh, keyed by school day.

**AC8.** `PlanTile` accepts a new optional `childRatings?: Record<string, 'loved' | 'ok' | 'not-really'>` prop and renders a rating emoji inline with the child's name chip (one small emoji per child who has rated that day). `BriefCanvas` passes `childRatings={summary.child_ratings}` to every `PlanTile`.

**AC9.** No new DB migration is needed — `rating` and `rating_submitted_at` columns were added in slice 4-S3 migration `20261001000000_extend_lunch_link_sessions_for_s3.sql`.

---

## Demo Path

> Child opens lunch link → taps 😋 → emoji locks, others fade → parent reloads brief → Monday tile shows 😋 next to child's name. Child reloads the link → sees 😋 pre-selected and locked.

Manual test steps:
1. Log in as parent; navigate to `/app/heart-note`; click "Copy link" for today's date.
2. Open the copied URL in a fresh tab (or phone browser, or incognito).
3. Scroll to the rating block — "How was lunch, [child]?" with three emoji buttons.
4. Tap 😋 "Loved it" — the button gains the terracotta ring, the others fade.
5. Verify: `SELECT rating, rating_submitted_at FROM lunch_link_sessions WHERE child_id = '<id>' AND date = '<today>'` — `rating='loved'`.
6. Reload the child tab — 😋 renders pre-selected and locked (no tap accepted).
7. As parent: reload `/app` (Brief Canvas) — the today tile shows 😋 next to the child's name chip.
8. Verify expired path: set `exp` in the DB to `now() - interval '1s'` and reload the child URL. Tap an emoji — expect the tap to be locally locked but the POST returns 404 (no update in DB). The 410 expired panel renders the rating from the snapshot (the old value, since the post-expiry re-tap was rejected).

---

## Critical Guardrails — Read First

**DO NOT use TanStack Query or React Hook Form.** Confirmed ban from 4-S1. Use `useState` + `publicPost` (fire-and-forget). No `useEffect` needed for the rating submission.

**DO NOT move rating logic into a separate hook or service.** The `onRate` callback in `lunch-link.tsx` is two lines — just inline it.

**The rate endpoint must return 404 for ALL failure modes** (malformed token, wrong HMAC, expired, suppressed, unknown child, missing session). Never 401, 403, or 400. Same oracle-prevention contract as the GET endpoint.

**DO NOT block the child UI on the API response.** Fire the POST and forget. The button locks immediately on tap regardless of whether the API succeeds. This is intentional — the child's experience should not degrade if the network is slow.

**Rate after expiry must be rejected server-side.** Client-side expiry is not enforced on the rating path (the FeedbackBlock doesn't know about expiry). The server checks `new Date() >= new Date(parsed.exp)` before writing.

**`verifyHmac` is already written — reuse it.** Do NOT re-implement HMAC verification in `rate()`. Call `parseToken`, `findHmacKey`, `verifyHmac` exactly as `verifyAndFetch` does.

**`briefStateComposer.refresh` MUST be fire-and-forget.** The rate route handler must `void` the call. The composer never throws (architecture guarantee). Do NOT await it in the handler.

**`getMondayOfWeek` is a new utility in the service module.** Use UTC date arithmetic (same pattern as `buildSuppressionMap` in the composer). Do NOT use `Date.getDay()` — use `d.getUTCDay()` to avoid DST surprises.

**No changes to `_dev-lunch-link.tsx`, `mockData.ts`, or the stub path.** Dev preview remains mock-backed. The stub path in `lunch-link.tsx` does not wire `onRate` (no rating for dev tokens).

**Do NOT add a new TrustChip variant for child ratings.** Ratings appear inline with ChildChips in `PlanTile`, not as TrustChips (different semantic purpose).

---

## What Already Exists (Do Not Recreate)

**DB columns** — `lunch_link_sessions.rating` (text, `CHECK (rating IN ('loved','ok','not-really'))`) and `rating_submitted_at` (timestamptz) added in S3 migration `20261001000000`.

**Audit event type** — `'lunch_link.rated'` already declared in `apps/api/src/audit/audit.types.ts`. No changes needed.

**Token utilities** — `parseToken`, `verifyHmac`, `encodeBase64url`, `signToken`, `compute8pmUtc` are exported from `apps/api/src/modules/lunch-link/lunch-link.service.ts`. **Reuse them** — do not duplicate.

**`LunchLinkRepository` methods** — `findHmacKey`, `findSession`, `findChildPublic` all exist from S3. **Extend this class** with a new `setRating` method; do not create a new class.

**`LunchLinkService`** — `generate`, `verifyAndFetch`, `getDevPayload` exist. **Extend this class** with `rate()`; do not replace it.

**`lunch-link.routes.ts`** — has three routes from S3. **Add one new route** to this plugin.

**`LUNCH_LINK_PUBLIC_RE`** — already in `authenticate.hook.ts` for GET-only skip. Do NOT change it; add a separate `LUNCH_LINK_RATE_RE` for the POST skip.

**`publicGet`** — exists in `apps/web/src/lib/fetch.ts`. **Add `publicPost`** to the same file.

**`FeedbackBlock`** — `apps/web/src/features/lunch-link/components/FeedbackBlock.tsx` has `onRate?: (rating: Rating) => void` prop and internal `selected` state. **Add `lockedRating?: Rating`** prop; do not rewrite the component.

**`Rating` type** — `type Rating = 'loved' | 'ok' | 'not-really'` in `apps/web/src/features/lunch-link/data/mockData.ts`. Import it from there (same as `FeedbackBlock` does currently).

**`fastify.briefStateComposer`** — registered by `plansHook` at `apps/api/src/app.ts:118`. Accessible from `lunchLinkRoutes` (all plugins can access decorators registered before them). Call `void fastify.briefStateComposer.refresh(householdId, weekId, request.id)` in the rate handler.

**`LunchLinkSessionRepository`** — `apps/api/src/modules/plans/lunch-link-session.repository.ts`. Has `findSuppressedChildrenInRange`. **Add `findRatingsInRange`** to this class.

**`BriefStateComposer`** — `apps/api/src/modules/plans/brief-state.composer.ts`. Has `buildSuppressionMap` + `buildTileSummaries`. **Add `buildRatingsMap`** (same pattern) and update `buildTileSummaries` signature to accept `ratingsMap` alongside `suppressionByDay`. Update the two call sites (`refresh` and `buildScaffoldingDiff`).

---

## Tasks

### T1 — Contracts

**T1.1** Append to `packages/contracts/src/lunch-link.ts` (after S3 exports):

```typescript
// ── Slice 4-S4: emoji rating ─────────────────────────────────────────────────

export const RateLunchLinkBodySchema = z.object({
  rating: z.enum(['loved', 'ok', 'not-really']),
});

export type RateLunchLinkBody = z.infer<typeof RateLunchLinkBodySchema>;
```

**T1.2** In `packages/contracts/src/lunch-link.ts`, add `rating` to `LunchLinkPayloadSchema` (the 200 response of GET):

```typescript
// Before S4 (S3 original):
export const LunchLinkPayloadSchema = z.object({
  childName: z.string(),
  date: z.string().date(),
  heartNote: LunchLinkPublicHeartNoteSchema.nullable(),
  bag: LunchLinkPublicBagSchema,
  expired: z.literal(false),
});

// After S4 (add rating field):
export const LunchLinkPayloadSchema = z.object({
  childName: z.string(),
  date: z.string().date(),
  heartNote: LunchLinkPublicHeartNoteSchema.nullable(),
  bag: LunchLinkPublicBagSchema,
  expired: z.literal(false),
  rating: z.enum(['loved', 'ok', 'not-really']).nullable().default(null),
});
```

Also update the exported `LunchLinkPayload` type (it will re-infer automatically, but verify that the type is re-exported correctly from `packages/contracts/src/index.ts`).

**T1.3** In `packages/contracts/src/plan.ts`, add `child_ratings` to `PlanTileSummarySchema`:

```typescript
// Before S4 (S3 original):
export const PlanTileSummarySchema = z.object({
  day: z.enum(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']),
  items: z.array(PlanTileItemSchema),
  paused: z.boolean().default(false),
  lunch_link_suppressed_children: z.array(z.string().uuid()).default([]),
});

// After S4 (add child_ratings field):
export const PlanTileSummarySchema = z.object({
  day: z.enum(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']),
  items: z.array(PlanTileItemSchema),
  paused: z.boolean().default(false),
  lunch_link_suppressed_children: z.array(z.string().uuid()).default([]),
  // Story 4-S4: keyed by child_id UUID; only children who have submitted a
  // rating for this day appear in the map. Absent key = no rating yet.
  child_ratings: z.record(z.string().uuid(), z.enum(['loved', 'ok', 'not-really'])).default({}),
});
```

`PlanTileSummary` in `@hivekitchen/types` re-infers from this schema — no separate change needed in the types package.

**T1.4** Add contract tests to `packages/contracts/src/lunch-link.test.ts` (append):

```typescript
// S4 schema tests
describe('RateLunchLinkBodySchema', () => {
  it('accepts loved', () => {
    expect(() => RateLunchLinkBodySchema.parse({ rating: 'loved' })).not.toThrow();
  });
  it('accepts ok', () => {
    expect(() => RateLunchLinkBodySchema.parse({ rating: 'ok' })).not.toThrow();
  });
  it('accepts not-really', () => {
    expect(() => RateLunchLinkBodySchema.parse({ rating: 'not-really' })).not.toThrow();
  });
  it('rejects thumbs-up (out-of-enum)', () => {
    expect(() => RateLunchLinkBodySchema.parse({ rating: 'thumbs-up' })).toThrow();
  });
  it('rejects missing rating', () => {
    expect(() => RateLunchLinkBodySchema.parse({})).toThrow();
  });
});

describe('LunchLinkPayloadSchema (S4: rating field)', () => {
  const validBase = {
    childName: 'Layla',
    date: '2026-09-01',
    heartNote: null,
    bag: { name: 'Sandwich', sub: 'Packed', safetyNote: 'Nut-free' },
    expired: false as const,
  };
  it('defaults rating to null when omitted', () => {
    const result = LunchLinkPayloadSchema.parse(validBase);
    expect(result.rating).toBeNull();
  });
  it('accepts rating: loved', () => {
    const result = LunchLinkPayloadSchema.parse({ ...validBase, rating: 'loved' });
    expect(result.rating).toBe('loved');
  });
  it('rejects invalid rating value', () => {
    expect(() => LunchLinkPayloadSchema.parse({ ...validBase, rating: 'thumbs-up' })).toThrow();
  });
});
```

---

### T2 — API Repository

**T2.1** Add `setRating` to `LunchLinkRepository` (`apps/api/src/modules/lunch-link/lunch-link.repository.ts`):

```typescript
// Slice 4-S4: write the child's rating. Overwrites any prior rating — overwrite
// semantics are intentional; the child can change their mind before 8pm.
async setRating(
  childId: string,
  date: string,
  rating: 'loved' | 'ok' | 'not-really',
): Promise<void> {
  const { error } = await this.client
    .from('lunch_link_sessions')
    .update({
      rating,
      rating_submitted_at: new Date().toISOString(),
    })
    .eq('child_id', childId)
    .eq('date', date);
  if (error) throw error;
}
```

**T2.2** Add `findRatingsInRange` to `LunchLinkSessionRepository` (`apps/api/src/modules/plans/lunch-link-session.repository.ts`):

```typescript
// Slice 4-S4: per-child rating map for brief_state.composer. Returns a map
// of date → Map<child_id, rating> for all rated sessions in the given range.
// Parallels findSuppressedChildrenInRange — same query pattern, different column.
async findRatingsInRange(
  householdId: string,
  dateFrom: string,
  dateTo: string,
): Promise<Map<string, Map<string, 'loved' | 'ok' | 'not-really'>>> {
  const { data, error } = await this.client
    .from('lunch_link_sessions')
    .select('date, child_id, rating')
    .eq('household_id', householdId)
    .gte('date', dateFrom)
    .lte('date', dateTo)
    .not('rating', 'is', null);
  if (error) throw error;
  const rows = (data ?? []) as Array<{
    date: string;
    child_id: string;
    rating: 'loved' | 'ok' | 'not-really';
  }>;
  const map = new Map<string, Map<string, 'loved' | 'ok' | 'not-really'>>();
  for (const row of rows) {
    if (!map.has(row.date)) map.set(row.date, new Map());
    map.get(row.date)!.set(row.child_id, row.rating);
  }
  return map;
}
```

---

### T3 — API Service

**T3.1** Add `getMondayOfWeek` utility to `lunch-link.service.ts` (module-level, not exported — same file as the existing token utilities):

```typescript
// Returns the Monday (YYYY-MM-DD) of the ISO week containing isoDate.
// UTC arithmetic avoids DST surprises — same convention as buildSuppressionMap.
function getMondayOfWeek(isoDate: string): string {
  const d = new Date(isoDate + 'T00:00:00Z');
  // getUTCDay: 0=Sun, 1=Mon, ..., 6=Sat
  const daysFromMonday = d.getUTCDay() === 0 ? 6 : d.getUTCDay() - 1;
  d.setUTCDate(d.getUTCDate() - daysFromMonday);
  return d.toISOString().split('T')[0]!;
}
```

**T3.2** Add `rate()` method to `LunchLinkService`:

```typescript
async rate(
  rawToken: string,
  rating: 'loved' | 'ok' | 'not-really',
): Promise<
  | { status: 'ok'; householdId: string; childId: string; date: string }
  | { status: 'invalid' }
> {
  // 1. Parse + validate token structure
  const parsed = parseToken(rawToken);
  if (parsed === null) return { status: 'invalid' };

  // 2. HMAC key lookup
  const hmacKey = await this.lunchLinkRepo.findHmacKey(parsed.date);
  if (hmacKey === null) return { status: 'invalid' };

  // 3. Verify HMAC — constant-time
  if (!verifyHmac(parsed.encodedPayload, parsed.signature, hmacKey)) {
    return { status: 'invalid' };
  }

  // 4. Reject ratings after expiry — the link window has closed
  if (new Date() >= new Date(parsed.exp)) {
    return { status: 'invalid' };
  }

  // 5. Verify session exists and is not suppressed
  const session = await this.lunchLinkRepo.findSession(parsed.child_id, parsed.date);
  if (!session || session.suppressed_at !== null) {
    return { status: 'invalid' };
  }

  // 6. Verify child still exists in DB
  const childInfo = await this.lunchLinkRepo.findChildPublic(parsed.child_id);
  if (childInfo === null) return { status: 'invalid' };

  // 7. Write rating (overwrite semantics — see AC3)
  await this.lunchLinkRepo.setRating(parsed.child_id, parsed.date, rating);

  return {
    status: 'ok',
    householdId: childInfo.household_id,
    childId: parsed.child_id,
    date: parsed.date,
  };
}
```

**T3.3** Update `verifyAndFetch` in `LunchLinkService` to populate `rating` from the session row in the `status: 'valid'` branch.

The session row is already fetched at step 4. In the valid branch, replace:
```typescript
// Current (S3):
return {
  status: 'valid',
  payload: {
    childName: childInfo.name,
    date: parsed.date,
    heartNote,
    bag: { ...STUB_BAG },
    expired: false,
  },
  householdId: childInfo.household_id,
  childId: parsed.child_id,
};

// Updated (S4 — add rating):
return {
  status: 'valid',
  payload: {
    childName: childInfo.name,
    date: parsed.date,
    heartNote,
    bag: { ...STUB_BAG },
    expired: false,
    rating: session?.rating ?? null,
  },
  householdId: childInfo.household_id,
  childId: parsed.child_id,
};
```

---

### T4 — API Routes

**T4.1** Add the public rate route to `apps/api/src/modules/lunch-link/lunch-link.routes.ts`.

Add import:
```typescript
import {
  // ... existing imports ...
  RateLunchLinkBodySchema,
  type RateLunchLinkBody,
} from '@hivekitchen/contracts';
```

Add the new route inside the plugin (after the existing GET `/v1/lunch-link/:token` route):

```typescript
// Slice 4-S4 — child-facing: submit emoji rating for a lunch link session.
// PUBLIC — authenticate hook is skipped for POST /v1/lunch-link/:token/rate.
// All failure modes return 404 (never 401/403) — oracle prevention.
fastify.post(
  '/v1/lunch-link/:token/rate',
  {
    schema: {
      params: LunchLinkTokenParamSchema,
      body: RateLunchLinkBodySchema,
    },
  },
  async (request, reply) => {
    const { token } = request.params as LunchLinkTokenParam;
    const { rating } = request.body as RateLunchLinkBody;

    const result = await service.rate(token, rating);
    if (result.status === 'invalid') {
      throw new NotFoundError('Link not found');
    }

    request.auditContext = {
      event_type: 'lunch_link.rated',
      household_id: result.householdId,
      correlation_id: request.id,
      request_id: request.id,
      metadata: { child_id: result.childId, date: result.date, rating },
    };

    // Fire-and-forget brief refresh — composer never throws (architecture §1.5).
    // weekId = Monday of the week containing the token's date.
    void fastify.briefStateComposer.refresh(
      result.householdId,
      getMondayOfWeek(result.date),
      request.id,
    );

    return reply.status(204).send();
  },
);
```

**⚠️ `getMondayOfWeek` is defined in `lunch-link.service.ts` as a module-private function.** Since the route handler needs it, either:
1. Export it from `lunch-link.service.ts` (`export function getMondayOfWeek`), OR
2. Define it inline in `lunch-link.routes.ts`.

Preferred: **export it** from the service module so it can be tested. Export name: `getMondayOfWeek`. Add to the `lunch-link.service.ts` exports section.

**T4.2** Modify `apps/api/src/middleware/authenticate.hook.ts`.

Add alongside the existing `LUNCH_LINK_PUBLIC_RE` constant:
```typescript
// POST /v1/lunch-link/:token/rate is the public child-facing rating endpoint.
// Only POST to this exact path shape is skipped.
const LUNCH_LINK_RATE_RE = /^\/v1\/lunch-link\/[^/]+\/rate$/;
```

Add before the `Authorization` header check (alongside the existing GET skip):
```typescript
if (LUNCH_LINK_RATE_RE.test(url) && request.method === 'POST') return;
```

---

### T5 — Brief State Composer

**T5.1** Add `buildRatingsMap` to `BriefStateComposer` (`apps/api/src/modules/plans/brief-state.composer.ts`):

```typescript
// Slice 4-S4: one DB query per brief refresh. Same pattern as buildSuppressionMap.
// Returns Map<schoolDay, Map<child_id, rating>>.
private async buildRatingsMap(
  plan: PlanRow,
): Promise<Map<string, Map<string, 'loved' | 'ok' | 'not-really'>>> {
  const weekOf = plan.week_of;
  if (!this.lunchLinkSessionRepo || !weekOf) {
    return new Map();
  }

  const monday = new Date(weekOf + 'T00:00:00Z');
  const saturday = new Date(monday);
  saturday.setUTCDate(monday.getUTCDate() + 5);
  const dateTo = saturday.toISOString().split('T')[0]!;

  const ratingsByDate = await this.lunchLinkSessionRepo.findRatingsInRange(
    plan.household_id,
    weekOf,
    dateTo,
  );

  const dayOffsets: Array<[SchoolDay, number]> = [
    ['monday', 0],
    ['tuesday', 1],
    ['wednesday', 2],
    ['thursday', 3],
    ['friday', 4],
    ['saturday', 5],
  ];

  return new Map(
    dayOffsets.map(([day, offset]) => {
      const d = new Date(monday);
      d.setUTCDate(monday.getUTCDate() + offset);
      const dateStr = d.toISOString().split('T')[0]!;
      return [day, ratingsByDate.get(dateStr) ?? new Map()];
    }),
  );
}
```

**T5.2** Update `buildTileSummaries` signature to accept `ratingsMap` alongside `suppressionByDay`:

```typescript
private buildTileSummaries(
  items: PlanItemRow[],
  suppressionByDay: Map<string, string[]>,
  ratingsMap: Map<string, Map<string, 'loved' | 'ok' | 'not-really'>>,
): PlanTileSummary[]
```

In the return statement inside the `.map` call, add `child_ratings`:
```typescript
return {
  day,
  items: entry.items,
  paused: entry.items.length > 0 && entry.pausedCount === entry.items.length,
  lunch_link_suppressed_children: suppressionByDay.get(day) ?? [],
  // Story 4-S4: Record<child_id, rating> for children who rated this day.
  child_ratings: Object.fromEntries(ratingsMap.get(day) ?? new Map()),
};
```

**T5.3** Update the two call sites of `buildTileSummaries`:

In `refresh()` — add the `ratingsMap` after the suppression map query:
```typescript
// Before (S3):
const suppressionByDay = await this.buildSuppressionMap(plan);
// ...
plan_tile_summaries: this.buildTileSummaries(items, suppressionByDay),

// After (S4):
const [suppressionByDay, ratingsMap] = await Promise.all([
  this.buildSuppressionMap(plan),
  this.buildRatingsMap(plan),
]);
// ...
plan_tile_summaries: this.buildTileSummaries(items, suppressionByDay, ratingsMap),
```

In `buildScaffoldingDiff()` — add an empty map as the third argument:
```typescript
// Before:
const currentSummaries = this.buildTileSummaries(currentItems, new Map<string, string[]>());
// After:
const currentSummaries = this.buildTileSummaries(currentItems, new Map<string, string[]>(), new Map());
```

---

### T6 — Web

**T6.1** Add `publicPost` to `apps/web/src/lib/fetch.ts`:

```typescript
/**
 * Unauthenticated POST — for public endpoints that children access without
 * logging in (emoji rating, etc.). Parallel to publicGet.
 */
export async function publicPost(
  path: string,
  body: unknown,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    credentials: 'omit',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let respBody: unknown = null;
  try {
    respBody = await res.json();
  } catch {
    // 204 or non-JSON body — ignore
  }
  return { status: res.status, body: respBody };
}
```

**T6.2** Update `FeedbackBlock` in `apps/web/src/features/lunch-link/components/FeedbackBlock.tsx`.

Add `lockedRating?: Rating` to `Readonly_FeedbackBlockProps`:
```typescript
interface Readonly_FeedbackBlockProps {
  readonly question: string;
  readonly options: readonly RatingOption[];
  readonly hint: string;
  readonly onRate?: (rating: Rating) => void;
  // S4: pre-selected rating from the server (child already submitted; show locked state on reload).
  readonly lockedRating?: Rating;
}
```

Update the component body to initialize `selected` from `lockedRating` and lock on first selection:
```typescript
export function FeedbackBlock({
  question,
  options,
  hint,
  onRate,
  lockedRating,
}: FeedbackBlockProps) {
  const [selected, setSelected] = useState<Rating | null>(lockedRating ?? null);

  const handleRate = (rating: Rating) => {
    if (selected !== null) return; // already rated — lock
    setSelected(rating);
    onRate?.(rating);
  };

  // rest of render unchanged
```

**T6.3** Wire rating in `apps/web/src/routes/(app)/lunch-link.tsx`.

Add import:
```typescript
import { hkFetch, publicGet, publicPost } from '@/lib/fetch.js';
import type {
  LunchLinkDevResponse,
  LunchLinkPayload,
  LunchLinkExpiredPayload,
} from '@hivekitchen/contracts';
```

Add the `handleRate` callback (inline, not a separate hook):
```typescript
const handleRate = (rating: string) => {
  if (!linkId || !isHmac) return;
  void publicPost(`/v1/lunch-link/${linkId}/rate`, { rating });
};
```

Pass `onRate` and `lockedRating` to `FeedbackBlock` (real tokens only — stub path does not wire rating):
```typescript
<FeedbackBlock
  question={`How was lunch, ${childName}?`}
  options={RATING_OPTIONS}
  hint="Tap one. That's all."
  onRate={isHmac ? handleRate : undefined}
  lockedRating={isHmac ? ((data as LunchLinkPayload).rating ?? undefined) : undefined}
/>
```

**Note:** `data` for the stub path is `LunchLinkDevResponse` which does not have a `rating` field. The `isHmac` guard prevents accessing `.rating` on stub data.

**T6.4** Update `apps/web/src/features/plan/PlanTile.tsx`.

Add `childRatings` to `PlanTileProps`:
```typescript
export interface PlanTileProps {
  summary: PlanTileSummary;
  state?: PlanTileState;
  partnerName?: string;
  trustChips?: ReadonlyArray<{ variant: TrustChipVariant; label: string }>;
  childColorMap?: ReadonlyMap<string, ChildInfo>;
  onSwapIntent?: () => void;
  onPauseLunchLink?: () => void;
  forceVariant?: PlanTileVariant;
  variantProposal?: VariantProposal;
  onVariantChoice?: (proposalId: string, choice: 'try_variant' | 'keep_original') => void;
  // Story 4-S4: keyed by child_id; only children who have rated appear here.
  childRatings?: Record<string, 'loved' | 'ok' | 'not-really'>;
}
```

In the render, find where `ChildChip` is rendered for each item and add the rating emoji inline. Look at the existing render loop for children — it likely iterates `summary.items`. Add a small emoji alongside the chip when a rating exists:

```tsx
const RATING_EMOJIS: Record<string, string> = {
  loved: '😋',
  ok: '🙂',
  'not-really': '😕',
};
```

In the child chip render area, for each child who appears in `summary.items`, check `childRatings?.[item.child_id]` and append the emoji. The exact placement depends on the current render structure — add the emoji after the child's name chip (not inside the ChildChip component):

```tsx
{/* Existing child chip */}
<ChildChip name={childName} color={childColor} />
{/* S4: rating emoji if submitted */}
{childRatings?.[child_id] && (
  <span aria-label={`Rated: ${childRatings[child_id]}`} className="text-[14px] leading-none">
    {RATING_EMOJIS[childRatings[child_id]!]}
  </span>
)}
```

**⚠️ Placement guidance:** The exact location depends on the current PlanTile render. Read `PlanTile.tsx` before editing. Find where child chips are rendered. The emoji should appear at the same visual level as the chip — inline, not as a separate row.

**T6.5** Update `apps/web/src/features/plan/BriefCanvas.tsx`.

Pass `childRatings` to each `PlanTile` in the render loop (around line 392):
```tsx
<PlanTile
  key={summary.day}
  summary={summary}
  state={tileState}
  childColorMap={childColorMap}
  childRatings={summary.child_ratings}
  onSwapIntent={...}
/>
```

The `summary.child_ratings` field now exists on `PlanTileSummary` from T1.3. TypeScript will validate this.

---

### T7 — Tests

**T7.1** Extend `apps/api/src/modules/lunch-link/lunch-link.service.test.ts` (append):

```typescript
describe('LunchLinkService.rate', () => {
  it('returns status:ok for a valid unexpired token with rating');
  it('returns status:invalid for a malformed token');
  it('returns status:invalid for a token with wrong HMAC');
  it('returns status:invalid when the token is expired');
  it('returns status:invalid for a suppressed session');
  it('returns status:invalid when child not found');
  it('overwrites an existing rating (overwrite semantics)');
});

describe('getMondayOfWeek', () => {
  it('returns the same date for a Monday input');
  it('returns Monday for a Wednesday input (2026-09-02 → 2026-08-31)');
  it('returns Monday for a Sunday input (2026-09-06 → 2026-08-31)');
  it('handles DST transition dates correctly (UTC arithmetic only)');
});
```

**T7.2** Extend `apps/api/src/modules/lunch-link/lunch-link.routes.test.ts` (append):

```typescript
describe('POST /v1/lunch-link/:token/rate', () => {
  it('204 for valid unexpired token with rating:loved (no auth header required)');
  it('204 for rating:ok');
  it('204 for rating:not-really');
  it('404 for malformed token');
  it('404 for valid-format but wrong-HMAC token');
  it('404 for expired token (past exp)');
  it('404 for suppressed session');
  it('400 for invalid rating value (not in enum)');
  it('writes audit event lunch_link.rated on success');
});
```

**T7.3** Extend `apps/api/src/modules/plans/brief-state.composer.ts` test (append):

```typescript
describe('BriefStateComposer — S4 ratings', () => {
  it('populates child_ratings on a tile when findRatingsInRange returns a rating');
  it('leaves child_ratings as empty object when no ratings exist for the week');
  it('calls findRatingsInRange in parallel with findSuppressedChildrenInRange');
});
```

---

## Dev Notes

### Rate endpoint expiry check

The `rate()` method checks `new Date() >= new Date(parsed.exp)` before writing. This means if a child opens the link at 7:59pm and the request takes 2 seconds, the rating is still accepted. If the request arrives at 8:00:01pm, it's rejected. The 8pm boundary is at the DB-stored `exp` timestamp (set at generate time using `compute8pmUtc`), not computed fresh — so there's no drift between the GET verify and the POST rate.

### Fire-and-forget brief refresh

`void fastify.briefStateComposer.refresh(...)` is called after writing the rating. The composer's `refresh` method is documented as never-throwing (architecture §1.5 — all errors are caught and logged). The `void` is intentional and correct — do not await it in the handler.

The `weekId` passed to `refresh` is the Monday of the week containing the token's date. The `getMondayOfWeek` utility uses UTC arithmetic (same convention as `buildSuppressionMap`).

### `getMondayOfWeek` export

This utility is needed in both `lunch-link.service.ts` (for computing the expiry) and `lunch-link.routes.ts` (for the `briefStateComposer.refresh` call). Export it from the service module. The routes plugin imports it directly.

### `child_ratings` default in brief_state JSON

`PlanTileSummarySchema` uses `.default({})` so existing `brief_state` rows in the DB that were written before S4 (and thus lack the `child_ratings` key) will parse correctly — Zod populates the default. No DB migration is needed to backfill old rows.

### FeedbackBlock lock semantics

Once `selected !== null` (either from a tap or from `lockedRating` prop), `handleRate` early-returns. The `RatingButton` `faded` state (`selected !== null && selected !== option.id`) handles the visual fade. This is purely local state — no API round-trip needed for the lock.

### Stub path isolation

The stub path (`test-*` tokens, dev endpoint) does not wire `onRate` or `lockedRating`. The `LunchLinkDevResponse` type does not include a `rating` field. The `isHmac` guard in `lunch-link.tsx` ensures `publicPost` is never called for stub tokens.

### PlanTile ratings placement

The exact render location for the rating emoji depends on the current PlanTile layout. Read the file before editing. The emoji should appear at the same visual level as the child chip — it is not a TrustChip and should not be treated as one.

### Project Structure Notes

**No new files.**

**Modified files:**
- `packages/contracts/src/lunch-link.ts` (T1.1, T1.2)
- `packages/contracts/src/plan.ts` (T1.3)
- `packages/contracts/src/lunch-link.test.ts` (T1.4)
- `apps/api/src/modules/lunch-link/lunch-link.repository.ts` (T2.1)
- `apps/api/src/modules/plans/lunch-link-session.repository.ts` (T2.2)
- `apps/api/src/modules/lunch-link/lunch-link.service.ts` (T3.1, T3.2, T3.3)
- `apps/api/src/modules/lunch-link/lunch-link.routes.ts` (T4.1)
- `apps/api/src/middleware/authenticate.hook.ts` (T4.2)
- `apps/api/src/modules/plans/brief-state.composer.ts` (T5.1, T5.2, T5.3)
- `apps/web/src/lib/fetch.ts` (T6.1)
- `apps/web/src/features/lunch-link/components/FeedbackBlock.tsx` (T6.2)
- `apps/web/src/routes/(app)/lunch-link.tsx` (T6.3)
- `apps/web/src/features/plan/PlanTile.tsx` (T6.4)
- `apps/web/src/features/plan/BriefCanvas.tsx` (T6.5)
- `apps/api/src/modules/lunch-link/lunch-link.service.test.ts` (T7.1)
- `apps/api/src/modules/lunch-link/lunch-link.routes.test.ts` (T7.2)

**Not modified:**
- `supabase/migrations/*` — no new migration needed (columns added in S3)
- `apps/api/src/audit/audit.types.ts` — `'lunch_link.rated'` already exists
- `apps/api/src/app.ts` — `lunchLinkRoutes` and `plansHook` already registered
- `apps/web/src/features/lunch-link/data/mockData.ts` — `Rating` type unchanged
- `apps/web/src/routes/_dev-lunch-link.tsx` — dev preview unaffected

---

### References

- [Source: `_bmad-output/planning-artifacts/epic-4-vertical-slices.md` §Slice 4-S4]
- [Source: `_bmad-output/implementation-artifacts/4-s3-real-signed-tokens-8pm-window.md`] — HMAC utilities, token format, `publicGet` pattern, TanStack Query ban, fire-and-forget comment conventions
- [Source: `apps/api/src/modules/plans/brief-state.composer.ts`] — `buildSuppressionMap` pattern, `BriefStateComposerDeps.lunchLinkSessionRepository` optional wiring, never-throw contract
- [Source: `apps/api/src/modules/plans/lunch-link-session.repository.ts`] — `findSuppressedChildrenInRange` pattern for `findRatingsInRange`
- [Source: `apps/web/src/features/lunch-link/components/FeedbackBlock.tsx`] — current prop interface, `selected` state, lock visual via `faded`
- [Source: `apps/web/src/features/plan/PlanTile.tsx`] — `PlanTileProps` interface, `childColorMap` pattern, `ChildChip` component

---

## Task Completion Checklist

- [x] T1.1 — `RateLunchLinkBodySchema` + type appended to `lunch-link.ts`
- [x] T1.2 — `rating` field added to `LunchLinkPayloadSchema`
- [x] T1.3 — `child_ratings` field added to `PlanTileSummarySchema`
- [x] T1.4 — S4 contract tests appended to `lunch-link.test.ts`
- [x] T2.1 — `setRating()` added to `LunchLinkRepository`
- [x] T2.2 — `findRatingsInRange()` added to `LunchLinkSessionRepository`
- [x] T3.1 — `getMondayOfWeek` utility added and exported from `lunch-link.service.ts`
- [x] T3.2 — `rate()` method added to `LunchLinkService`
- [x] T3.3 — `verifyAndFetch` updated to return `rating` in the valid payload
- [x] T4.1 — `POST /v1/lunch-link/:token/rate` route added to `lunch-link.routes.ts`
- [x] T4.2 — `LUNCH_LINK_RATE_RE` skip added to `authenticate.hook.ts`
- [x] T5.1 — `buildRatingsMap()` added to `BriefStateComposer`
- [x] T5.2 — `buildTileSummaries` signature updated with `ratingsMap` param + `child_ratings` in output
- [x] T5.3 — Both `buildTileSummaries` call sites updated (refresh + buildScaffoldingDiff)
- [x] T6.1 — `publicPost()` added to `fetch.ts`
- [x] T6.2 — `lockedRating` prop added to `FeedbackBlock` + lock-on-prior-selection logic
- [x] T6.3 — `handleRate` + `onRate` + `lockedRating` wired in `lunch-link.tsx`
- [x] T6.4 — `childRatings` prop added to `PlanTile` + emoji rendered alongside child chips
- [x] T6.5 — `childRatings={summary.child_ratings}` passed from `BriefCanvas`
- [x] T7.1 — Service test suite extended (rate + getMondayOfWeek specs)
- [x] T7.2 — Routes test suite extended (rate route specs)
- [x] T7.3 — Composer test suite extended (ratings map specs)

---

## Dev Agent Record

### Completion Notes

- **Contracts** — added `RateLunchLinkBodySchema` (+ `RateLunchLinkBody` type), `rating` field on `LunchLinkPayloadSchema` (`.nullable().default(null)`), `child_ratings` field on `PlanTileSummarySchema` (`z.record(uuid, enum).default({})`); 8 new round-trip tests in `lunch-link.test.ts`.
- **API repository** — `LunchLinkRepository.setRating(childId, date, rating)` (UPDATE-only; overwrite semantics) and `LunchLinkSessionRepository.findRatingsInRange(householdId, dateFrom, dateTo)` (one DB query → `Map<date, Map<child_id, rating>>`).
- **API service** — `getMondayOfWeek(isoDate)` exported (UTC arithmetic, DST-safe); `LunchLinkService.rate(rawToken, rating)` reuses parseToken/findHmacKey/verifyHmac/findSession/findChildPublic and rejects every failure mode as `status:'invalid'` (oracle prevention); explicit pre-expiry check via `Date.now() >= new Date(parsed.exp).getTime()`. `verifyAndFetch` now returns `rating: session.rating ?? null` on the valid payload.
- **API route + auth** — `POST /v1/lunch-link/:token/rate` returns 204 on success / 404 on all other paths, `void`-dispatches `briefStateComposer.refresh(householdId, getMondayOfWeek(date), requestId)` for the fire-and-forget projection refresh, and emits `lunch_link.rated` audit. `authenticate.hook.ts` adds a POST-only `LUNCH_LINK_RATE_RE` skip alongside the existing GET-only `LUNCH_LINK_PUBLIC_RE`.
- **Composer** — `buildRatingsMap(plan)` parallels `buildSuppressionMap` (Mon→Sat keyed by `SchoolDay`); `buildTileSummaries` now takes both maps and emits `child_ratings: Object.fromEntries(map ?? new Map())` per tile. Both call sites updated; `refresh()` parallelizes the two reads via `Promise.all`.
- **Web** — `publicPost(path, body)` mirrors `publicGet`, never throws. `FeedbackBlock` accepts `lockedRating?: Rating`, seeds `selected` from it, and short-circuits `handleRate` once `selected !== null`. `lunch-link.tsx` wires `handleRate` (inline two-liner, fire-and-forget) and passes `lockedRating={(data as LunchLinkPayload).rating ?? undefined}` (HMAC path only). `PlanTile` accepts `childRatings?: Record<string, Rating>` and renders a single small emoji (`😋 🙂 😕`) inline beside each child chip when present; `BriefCanvas` forwards `childRatings={summary.child_ratings}`. `PlanPage` + `PlanHistoryPage` adapters set `child_ratings: {}` (they don't read brief_state ratings — only `BriefCanvas` does).
- **Tests** — 8 new `rate()` specs + 2 `verifyAndFetch` rating specs + 5 `getMondayOfWeek` specs in `lunch-link.service.test.ts`; 9 new rate-route specs in `lunch-link.routes.test.ts` (including a `briefStateComposer.refresh(2026-05-11, …)` assertion proving the Monday computation); 5 new composer specs in `brief-state.composer.test.ts` (populate, empty map, no-repo, parallel queries, never-throw on findRatingsInRange failure). Existing "reads cleared plan, builds tile summaries" assertion updated to include `lunch_link_suppressed_children: []` (was already broken since 3.28 — same root cause).
- **Validation** — `pnpm --filter @hivekitchen/contracts test -- lunch-link.test` → 33/33 pass; `pnpm --filter @hivekitchen/api test -- lunch-link` → 71/71 pass; `pnpm --filter @hivekitchen/api test -- brief-state` → 27/27 pass; `pnpm --filter @hivekitchen/web test -- PlanTile` → 33/33 pass; `pnpm --filter @hivekitchen/web test -- BriefCanvas` → 26/26 pass. Full `pnpm typecheck` has 10 pre-existing failures in unrelated files (voice, plan-regeneration, day-overrides, RecipeService duplicate ident, etc.) — confirmed against `git stash` baseline; no new errors introduced by S4. Full `pnpm --filter @hivekitchen/api test` runs 1295 tests with 29 pre-existing failures in 10 unrelated test files (auth, day-overrides, memory, catalog-seed, planner-prompt, audit-types, extra-library, plan-adjustment, allergy-rules) — none in files touched by this slice.

### File List

**Modified**
- `packages/contracts/src/lunch-link.ts` — rating field on payload schema; `RateLunchLinkBodySchema` + type
- `packages/contracts/src/plan.ts` — `child_ratings` field on `PlanTileSummarySchema`
- `packages/contracts/src/lunch-link.test.ts` — S4 contract tests
- `apps/api/src/modules/lunch-link/lunch-link.repository.ts` — `setRating()`
- `apps/api/src/modules/plans/lunch-link-session.repository.ts` — `findRatingsInRange()`
- `apps/api/src/modules/lunch-link/lunch-link.service.ts` — `getMondayOfWeek()` export, `rate()` method, `verifyAndFetch` payload now carries `rating`
- `apps/api/src/modules/lunch-link/lunch-link.routes.ts` — `POST /v1/lunch-link/:token/rate`
- `apps/api/src/middleware/authenticate.hook.ts` — `LUNCH_LINK_RATE_RE` skip
- `apps/api/src/modules/plans/brief-state.composer.ts` — `buildRatingsMap()`, signature updates, parallel reads
- `apps/api/src/modules/lunch-link/lunch-link.service.test.ts` — rate + getMondayOfWeek + verifyAndFetch S4 specs
- `apps/api/src/modules/lunch-link/lunch-link.routes.test.ts` — rate route specs, briefStateComposer stub decoration
- `apps/api/src/modules/plans/brief-state.composer.test.ts` — S4 child_ratings specs, updated existing assertion
- `apps/web/src/lib/fetch.ts` — `publicPost()`
- `apps/web/src/features/lunch-link/components/FeedbackBlock.tsx` — `lockedRating` prop + lock guard
- `apps/web/src/routes/(app)/lunch-link.tsx` — `handleRate` + `onRate` + `lockedRating` wiring
- `apps/web/src/features/plan/PlanTile.tsx` — `childRatings` prop + per-chip emoji rendering
- `apps/web/src/features/plan/PlanTile.test.tsx` — fixture: `child_ratings: {}`
- `apps/web/src/features/plan/BriefCanvas.tsx` — pass `childRatings={summary.child_ratings}`
- `apps/web/src/features/plan/BriefCanvas.test.tsx` — fixtures: `child_ratings: {}`
- `apps/web/src/features/plan/PlanPage.tsx` — adapter: `child_ratings: {}`
- `apps/web/src/features/plan/PlanHistoryPage.tsx` — adapter: `child_ratings: {}`
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — 4-s4 status
- `_bmad-output/implementation-artifacts/4-s4-emoji-rating.md` — status + Dev Agent Record

**Not modified (per story Project Structure Notes)**
- No new DB migration — `rating` + `rating_submitted_at` columns landed in S3 `20261001000000_extend_lunch_link_sessions_for_s3.sql`
- `apps/api/src/audit/audit.types.ts` — `lunch_link.rated` already present
- `apps/api/src/app.ts` — plugin registration order already correct (`plansHook` → `lunchLinkRoutes`)
- `apps/web/src/features/lunch-link/data/mockData.ts` — `Rating` type unchanged
- `apps/web/src/routes/_dev-lunch-link.tsx` — dev preview unaffected

### Change Log

- 2026-05-27 — Story 4-S4 implemented end-to-end across contracts/api/web; status → review.

---

### Review Findings

<!-- Auto-generated by bmad-code-review — 2026-05-27 -->

#### Patch

- [x] [Review][Patch] **P1 — Route returns 400 (not 404) for invalid `rating` enum value** — Fastify schema validation on `body: RateLunchLinkBodySchema` fires before the handler and returns 400 for out-of-enum values; spec Critical Guardrail and AC1 forbid 400 ("Never 401, 403, or 400"). Fix: remove `body` from the route schema object; parse and validate the body manually inside the handler, returning `NotFoundError` (→ 404) for invalid enum values. [`apps/api/src/modules/lunch-link/lunch-link.routes.ts`]
- [x] [Review][Patch] **P2 — `setRating` silently no-ops when session row has been deleted** — `.update()` with no `.select()` or row-count check returns `{ error: null }` with zero rows affected if `(child_id, date)` session was deleted between `findSession` and `setRating`; service returns `status: 'ok'` and the rating is lost. Fix: add `.select('id').single()` after the update and throw if no row returned. [`apps/api/src/modules/lunch-link/lunch-link.repository.ts:setRating`]
- [x] [Review][Patch] **P3 — `expiredSnapshot` stays `null` when 410 body is malformed, rendering generic error** — `setExpiredSnapshot((body as LunchLinkExpiredPayload).last_state_snapshot)` assigns `undefined` if snapshot key is absent; guard is `expiredSnapshot !== null` so child sees "Couldn't load this link" instead of "This link closed at 8pm". Fix: null-check `last_state_snapshot` before setting state; fall back to `setLoadState('error')` explicitly. [`apps/web/src/routes/(app)/lunch-link.tsx`]
- [x] [Review][Patch] **P4 — Missing route test: `writes audit event lunch_link.rated on success`** — T7.2 spec explicitly lists this test; `request.auditContext` is set in the handler but no test verifies `event_type: 'lunch_link.rated'` is populated with correct `household_id`, `child_id`, `date`, and `rating` fields. [`apps/api/src/modules/lunch-link/lunch-link.routes.test.ts`]
- [x] [Review][Patch] **P5 — `LoadedPayload` local type omits `rating` field, requiring unsafe cast** — `data` is typed as `LoadedPayload | null`; `LoadedPayload` has no `rating`; the `isHmac` guard makes the cast safe at runtime but TypeScript cannot verify it. Fix: add `rating?: 'loved' | 'ok' | 'not-really' | null` to `LoadedPayload`. [`apps/web/src/routes/(app)/lunch-link.tsx`]
- [x] [Review][Patch] **P6 — JSDoc block for `compute8pmUtc` mis-attaches to `getMondayOfWeek`** — the `/** Returns a UTC Date representing 8pm … */` block immediately precedes the `getMondayOfWeek` function; TypeScript hover shows the wrong description on `getMondayOfWeek`. Fix: move the JSDoc to sit directly above `compute8pmUtc`. [`apps/api/src/modules/lunch-link/lunch-link.service.ts`]

#### Defer

- [x] [Review][Defer] **D1 — Nonce not verified against session in `verifyAndFetch`/`rate`** — stored `session.nonce` is never compared to `parsed.nonce`; a prior token for the same `(child_id, date)` remains valid after the parent re-generates the link; nonce rotation mechanism is bypassed. Pre-existing 4-S3 design — 4-S4 spec explicitly says to reuse `verifyAndFetch` path unchanged. [`apps/api/src/modules/lunch-link/lunch-link.service.ts`] — deferred, pre-existing
- [x] [Review][Defer] **D2 — `generate()` concurrent race produces two valid tokens** — two simultaneous `generate()` calls upsert to one session row (last writer wins); both signed tokens are valid indefinitely (consequence of D1). Pre-existing 4-S3 design. [`apps/api/src/modules/lunch-link/lunch-link.service.ts`] — deferred, pre-existing
- [x] [Review][Defer] **D3 — `findOrCreateHmacKey` re-read uses `.single()` not `.maybeSingle()`** — if a concurrent DELETE races after the upsert returns null, the re-read `.single()` throws 500 rather than a graceful retry; unlikely in production (no key TTL job). Pre-existing 4-S3 code in this diff. [`apps/api/src/modules/lunch-link/lunch-link.repository.ts:findOrCreateHmacKey`] — deferred, pre-existing
- [x] [Review][Defer] **D4 — `FeedbackBlock` double-tap fires two POST requests** — React state closure race: two rapid taps before first re-render both pass `selected === null` guard, dispatching two `publicPost` calls; overwrite semantics on server make this benign. [`apps/web/src/features/lunch-link/components/FeedbackBlock.tsx`] — deferred, pre-existing
- [x] [Review][Defer] **D5 — `buildRatingsMap` assumes `plan.week_of` is a Monday** — date-offset arithmetic misaligns silently if `week_of` is ever stored as a non-Monday; same silent assumption exists in `buildSuppressionMap` (4-S3). [`apps/api/src/modules/plans/brief-state.composer.ts`] — deferred, pre-existing
- [x] [Review][Defer] **D6 — `handleRate` uses inline union type instead of imported `Rating`** — spec T6.3 says to import `Rating` from `mockData.ts`; implementation spells out the union inline; structurally compatible, no runtime impact. [`apps/web/src/routes/(app)/lunch-link.tsx`] — deferred, pre-existing
- [x] [Review][Defer] **D7 — `recordFirstOpen`/`incrementReopenedCount` called via stale token after re-generate** — old token passes HMAC+session checks; open events are recorded against the new session row, conflating opens across token generations; consequence of D1. Pre-existing 4-S3 design. [`apps/api/src/modules/lunch-link/lunch-link.service.ts`] — deferred, pre-existing
- [x] [Review][Defer] **D8 — No route-level test for overwrite semantics (AC3)** — covered at service level (`buildRateService` with `session.rating: 'loved'`); not repeated at route integration level. [`apps/api/src/modules/lunch-link/lunch-link.routes.test.ts`] — deferred, pre-existing
- [x] [Review][Defer] **D9 — No web-layer test for `handleRate`/`publicPost` invocation** — `handleRate` is a two-liner fire-and-forget; spec does not require a unit test; low value. [`apps/web/src/routes/(app)/lunch-link.tsx`] — deferred, pre-existing
