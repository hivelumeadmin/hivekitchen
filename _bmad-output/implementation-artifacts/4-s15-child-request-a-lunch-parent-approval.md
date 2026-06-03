# Story 4-S15: Child Request-a-Lunch + Parent Approval

Status: review

**Slice key:** `4-s15-child-request-a-lunch-parent-approval`
**Epic:** 4 — Lunch Link & Heart Note Sacred Channel
**Source slice doc:** `_bmad-output/planning-artifacts/epic-4-vertical-slices.md` §Slice 4-S15
**Builds on:** 4-S3 (HMAC token + lunch_link_sessions), 4-S4 (emoji rating endpoint), 4-S11 (child_preferences + food_preferences planner signal), 4-S12 (verifyTokenForRead + LUNCH_LINK_PASSPORT_RE auth exclusion pattern)
**Folds:** 4.12 — FR42, Boundary 1

---

## Story

As a **child**,
I want to submit a text-based "request a lunch" suggestion from the Lunch Link,
So that I have a voice in what shows up in my bag without operating the app directly (FR42, Boundary 1).

As a **parent**,
I want to see my child's request with [Approve] [Decline] options on my planning page,
So that Lumi can incorporate approved requests as soft signals in future plan generation.

---

## Cross-Epic Dependency Note

The slice doc cites "Epic 5 threading surface" as the destination for the parent proposal. Epic 5 is `backlog`. This slice works around that dependency:

- The **child submission side** is complete and self-contained.
- The **parent approval side** uses the existing planning surface (`/app`) with a new `<PendingChildRequests>` section — not embedded in the Lumi thread yet.
- A Lumi planning thread turn IS injected (visible in LumiPanel when opened) so the "Lumi thread proposal" demo path works today.
- When Epic 5's threading surface ships, the `<PendingChildRequests>` section can be folded into the thread surface and this component retired.

---

## Acceptance Criteria

### AC1 — Migration: `child_lunch_requests` table

New file `supabase/migrations/20261015000000_child_lunch_requests.sql`:

```sql
CREATE TABLE child_lunch_requests (
  id                   UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  household_id         UUID        NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  child_id             UUID        NOT NULL REFERENCES children(id)   ON DELETE CASCADE,
  session_id           UUID        NOT NULL REFERENCES lunch_link_sessions(id) ON DELETE CASCADE,
  request_text         TEXT        NOT NULL CHECK (char_length(request_text) BETWEEN 1 AND 200),
  status               TEXT        NOT NULL DEFAULT 'pending'
                                   CHECK (status IN ('pending','approved','declined')),
  resolved_at          TIMESTAMPTZ,
  resolved_by_user_id  UUID        REFERENCES users(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id)  -- one request per lunch-link session; enforces idempotency
);

CREATE INDEX child_lunch_requests_household_status_idx
  ON child_lunch_requests(household_id, status, created_at DESC);

CREATE INDEX child_lunch_requests_child_idx
  ON child_lunch_requests(child_id);

ALTER TABLE child_lunch_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY child_lunch_requests_household_rw ON child_lunch_requests
  FOR ALL
  USING (household_id = current_household_id());
```

The `current_household_id()` function follows the same pattern as other tables (see `child_preferences` — uses the same Postgres helper). Check `supabase/migrations/*_child_preferences_signal.sql` to confirm the exact function call used.

**No `status` Postgres enum** — use `TEXT CHECK (...)` matching the `heart_notes.status` precedent (avoids enum migration cost).

### AC2 — Contracts: `ChildRequestSchema`

New file `packages/contracts/src/child-request.ts`:

```typescript
import { z } from 'zod';

export const ChildRequestCreateSchema = z.object({
  request_text: z.string().min(1).max(200),
});

export const ChildRequestSchema = z.object({
  id:            z.string().uuid(),
  child_id:      z.string().uuid(),
  child_name:    z.string(),           // joined from children.name at query time
  request_text:  z.string(),
  status:        z.enum(['pending', 'approved', 'declined']),
  created_at:    z.string(),           // ISO 8601
});

export const PendingChildRequestsResponseSchema = z.object({
  requests: z.array(ChildRequestSchema),
});
```

Export from `packages/contracts/src/index.ts`:
```typescript
export * from './child-request.js';
```

Add inferred types to `packages/types/src/index.ts` (use `export type` — `isolatedModules`):
```typescript
export type { ChildRequest, PendingChildRequestsResponse } from '@hivekitchen/contracts';
```

### AC3 — Auth exclusion: `LUNCH_LINK_CHILD_REQUEST_RE`

In `apps/api/src/middleware/authenticate.hook.ts`, add a new public-POST exclusion for the child request endpoint following the exact pattern established by `LUNCH_LINK_PASSPORT_RE` (added in 4-S12).

```typescript
// In authenticate.hook.ts, alongside the existing LUNCH_LINK_*_RE constants:
const LUNCH_LINK_CHILD_REQUEST_RE = /^\/v1\/lunch-link\/[^/]+\/child-request$/;
```

The exclusion applies to **POST only** on this path. Verify the exclusion logic applies per HTTP method. If the existing pattern applies to ALL methods for a given regex (not method-specific), confirm whether a GET to the same path from an unauthenticated client would be a concern — it would 404 anyway since no GET handler exists, so method-blind exclusion is acceptable.

**Do NOT touch the existing `LUNCH_LINK_PUBLIC_RE` or `LUNCH_LINK_PASSPORT_RE` constants.**

### AC4 — `ChildRequestRepository`

New file `apps/api/src/modules/child-requests/child-request.repository.ts`:

```typescript
async create(input: {
  householdId: string;
  childId: string;
  sessionId: string;
  requestText: string;
}): Promise<ChildRequestRow>

async findPendingByHousehold(householdId: string): Promise<ChildRequestWithChildName[]>
  // JOIN children ON child_id to pull child name — inline query, not a separate repo

async findById(id: string, householdId: string): Promise<ChildRequestRow | null>

async resolve(id: string, {
  status: 'approved' | 'declined';
  resolvedByUserId: string;
}): Promise<void>
  // UPDATE child_lunch_requests SET status=..., resolved_at=now(), resolved_by_user_id=...
  // WHERE id=... AND household_id=... AND status='pending'
  // Returns void; if 0 rows updated (already resolved or wrong household) → throw NotFoundError
```

`ChildRequestWithChildName` is an inline type (no need for a contract — it's internal to the repository response):
```typescript
interface ChildRequestWithChildName {
  id: string;
  child_id: string;
  child_name: string;   // from children JOIN
  request_text: string;
  status: string;
  created_at: string;
}
```

### AC5 — `ChildRequestService`

New file `apps/api/src/modules/child-requests/child-request.service.ts`.

Method: `submitRequest(sessionVerification: { childId: string; householdId: string; sessionId: string }, requestText: string): Promise<{ id: string }>`

1. Calls `repo.create(...)`.
   - If Supabase returns a unique-constraint error on `session_id` → throw `ConflictError('A request already exists for this lunch link')` — this maps to 409 per RFC 7807.
2. Writes a Lumi planning thread turn (see AC6).
3. Dispatches SSE `child_request.received` event to the household (see AC7).
4. Returns `{ id }`.

Method: `getPendingRequests(householdId: string): Promise<z.infer<typeof PendingChildRequestsResponseSchema>>`

- Calls `repo.findPendingByHousehold(householdId)`.
- Maps to `PendingChildRequestsResponseSchema` shape.

Method: `approve(id: string, { resolvedByUserId, householdId }: { resolvedByUserId: string; householdId: string }): Promise<void>`

1. Calls `repo.findById(id, householdId)` — throw `NotFoundError` if missing or wrong household.
2. Checks `request.status === 'pending'` — throw `ConflictError('Request already resolved')` if not.
3. Calls `repo.resolve(id, { status: 'approved', resolvedByUserId })`.
4. Writes to `food_preferences` table (see AC8).
5. Dispatches SSE `child_request.resolved` to household.

Method: `decline(id: string, { resolvedByUserId, householdId }: { resolvedByUserId: string; householdId: string }): Promise<void>`

1. Calls `repo.findById(id, householdId)` — throw `NotFoundError` if missing.
2. Checks `request.status === 'pending'` — throw `ConflictError` if not.
3. Calls `repo.resolve(id, { status: 'declined', resolvedByUserId })`.
4. Dispatches SSE `child_request.resolved` to household.

### AC6 — Planning thread turn injection (Lumi proposal)

When a child request is received, inject a system turn into the household's **planning** Lumi thread. This makes it visible in the LumiPanel when the parent opens it.

**Before implementing:** Check the `thread_turns` table schema in `supabase/migrations/`. Look for `role`, `content`, and any `metadata`/`turn_kind`/`content_type` columns. Also check `LumiThreadTurnsResponseSchema` in `packages/contracts/src/lumi.ts` (from 12-1) and the `lumi.repository.ts` `insertTurn` method (if it exists from 12-3 or later stories).

**Implementation approach:**

```typescript
// In child-request.service.ts — after creating the request row:
const planningThreadId = await this.getOrCreatePlanningThread(householdId);
if (planningThreadId) {
  await this.lumiRepo.insertTurn({
    threadId: planningThreadId,
    role: 'assistant',
    content: `${childName} asked: "${requestText}"`,
    metadata: {
      kind: 'child_request_proposal',
      request_id: id,
      child_id: childId,
    },
  });
}
```

- `getOrCreatePlanningThread`: find the `threads` row for `(household_id, surface='planning')`. If none exists, this is a no-op (log at `warn` level, do not throw — the submission succeeds regardless).
- **If `insertTurn` doesn't exist on `lumi.repository.ts`** (it may only have `getRecentTurns`): add a minimal `insertTurn` method. Do NOT create a separate Lumi service call for this — keep it a direct repository write.
- **Thread SSE invalidation:** fire `thread.turn` SSE event so the LumiPanel refreshes if open. Follow the pattern in `apps/api/src/lib/sse.ts` (or equivalent SSE dispatcher — check how other routes fire invalidation events).

The `metadata` JSONB column on `thread_turns` is used here to carry the `kind` and `request_id` so the LumiPanel can (in future) render action buttons. In this slice, the LumiPanel shows the turn as plain text. The action buttons are on `<PendingChildRequests>` (AC11), not the LumiPanel.

### AC7 — SSE InvalidationEvents: `child_request.received` and `child_request.resolved`

In `packages/contracts/src/events.ts` (or wherever `InvalidationEvent` is defined — check `packages/contracts/src/index.ts`), add two new event types:

```typescript
| { type: 'child_request.received'; householdId: string }
| { type: 'child_request.resolved'; householdId: string }
```

These follow the pattern of existing events (`plan.updated`, `memory.updated`, etc.). The SSE dispatcher sends to all SSE connections for the household.

**On the web client** (`apps/web/src/lib/sse.ts`), map these events to query invalidations:
```typescript
case 'child_request.received':
case 'child_request.resolved':
  queryClient.invalidateQueries({ queryKey: ['child-requests', event.householdId] });
  break;
```

**Do NOT** use TanStack Query's `useQuery` in route page components (the project uses `useEffect + hkFetch`). But the query key should follow the pattern so that the SSE invalidation triggers a refetch in any route that uses the pattern `['child-requests', householdId]`.

### AC8 — Planner soft-signal write on approval

When a parent approves a child request, write a row to `food_preferences`:

```typescript
await this.foodPreferencesRepo.declare({
  householdId,
  childId: request.child_id,
  item: request.request_text.slice(0, 100),  // truncate at 100 chars (food_preferences.item limit)
  valence: 'likes',
  enforcement: 'just_for_context',           // softest enforcement level — advisory only
  source: 'child_request',                   // new source type — add to CHECK constraint
});
```

**Before implementing:** Check `food_preferences.source` CHECK constraint in the migration (from 2.5-s1). If `'child_request'` is not in the allowed values, add a new migration:

```sql
-- supabase/migrations/20261015000100_food_preferences_source_child_request.sql
ALTER TABLE food_preferences
  DROP CONSTRAINT IF EXISTS food_preferences_source_check;
ALTER TABLE food_preferences
  ADD CONSTRAINT food_preferences_source_check
  CHECK (source IN ('onboarding','turn','tool','user_edit','plan_outcome','import','child_request'));
```

The `food_preferences` repository `declare` method was introduced in 2.5-s1 (used by onboarding tool wiring in 2-s22). Check `apps/api/src/modules/kitchen-map/food-preferences.repository.ts` (or similar path — search `food_preferences` in the modules directory) for the `declare` method signature before implementing.

**This planner signal is soft and advisory.** The planner already reads `food_preferences` with `enforcement='just_for_context'` as low-weight signals. The `request_text` is free-form ("pizza on Friday") and will not match a `recipe_id` — the planner uses it as a cuisine/food-type hint only.

### AC9 — API: child request submit (public endpoint)

New endpoint added to `apps/api/src/modules/lunch-link/lunch-link.routes.ts`:

```typescript
fastify.post('/v1/lunch-link/:token/child-request', {
  schema: {
    params:  z.object({ token: z.string() }),
    body:    ChildRequestCreateSchema,
    response: { 201: z.object({ id: z.string().uuid() }) },
  },
  // No preHandler — public; auth exclusion handles this (AC3)
}, async (req, reply) => {
  const result = lunchLinkService.verifyTokenForRead(req.params.token);
  if (result.status !== 'valid') {
    return reply.status(404).send({ error: 'not found' });
  }
  const created = await childRequestService.submitRequest(
    { childId: result.childId, householdId: result.householdId, sessionId: result.sessionId },
    req.body.request_text,
  );
  return reply.status(201).send(created);
});
```

- **Oracle prevention:** all token failures (invalid, expired, suppressed) → 404. Never distinguish between states in the response. Follow the same pattern as `POST /v1/lunch-link/:token/rate`.
- **`verifyTokenForRead` return shape:** Check the actual return type of this method in `lunch-link.service.ts` — it was added in 4-S12. At that time its return shape was `{ status: 'invalid' | 'valid' | 'expired'; householdId; childId; ... }`. Verify the field names. The `sessionId` field may or may not be included — if not, add it (or use the session's lookup by child_id + date to find the session_id).
- **Conflict (duplicate request):** `ConflictError` from `childRequestService.submitRequest` → 409 RFC 7807.
- **Inject `childRequestService`** into the lunch-link routes plugin. Check how other services (e.g., `flavorPassportService` in 4-S12) were injected into `lunch-link.routes.ts` and follow the same constructor injection pattern.

### AC10 — API: parent-facing endpoints (authenticated)

New file `apps/api/src/modules/child-requests/child-request.routes.ts`:

```typescript
// GET /v1/child-requests?status=pending
fastify.get('/v1/child-requests', {
  schema: {
    querystring: z.object({ status: z.enum(['pending']).optional() }),
    response: { 200: PendingChildRequestsResponseSchema },
  },
  preHandler: [authorize(['primary_parent', 'secondary_caregiver'])],
}, async (req, reply) => {
  const result = await childRequestService.getPendingRequests(req.user.household_id);
  return reply.send(result);
});

// POST /v1/child-requests/:id/approve
fastify.post('/v1/child-requests/:id/approve', {
  schema: {
    params: z.object({ id: z.string().uuid() }),
    response: { 200: z.object({ ok: z.literal(true) }) },
  },
  preHandler: [authorize(['primary_parent', 'secondary_caregiver'])],
}, async (req, reply) => {
  await childRequestService.approve(req.params.id, {
    resolvedByUserId: req.user.id,
    householdId: req.user.household_id,
  });
  return reply.send({ ok: true });
});

// POST /v1/child-requests/:id/decline
fastify.post('/v1/child-requests/:id/decline', {
  schema: {
    params: z.object({ id: z.string().uuid() }),
    response: { 200: z.object({ ok: z.literal(true) }) },
  },
  preHandler: [authorize(['primary_parent', 'secondary_caregiver'])],
}, async (req, reply) => {
  await childRequestService.decline(req.params.id, {
    resolvedByUserId: req.user.id,
    householdId: req.user.household_id,
  });
  return reply.send({ ok: true });
});
```

Register the plugin in `apps/api/src/app.ts` following the same pattern as `guestAuthorRoutes` (added in 4-S13). Search for how `heartNoteRoutes` or `guestAuthorRoutes` is registered to confirm the pattern.

**`NotFoundError` and `ConflictError`** — both should already exist in `apps/api/src/common/errors.ts`. Check before creating new classes.

### AC11 — Web: `<PendingChildRequests>` component (parent planning page)

New file `apps/web/src/features/child-requests/PendingChildRequests.tsx`.

This component is mounted on the parent's planning page (`apps/web/src/routes/(app)/plan.tsx` or equivalent — check the actual planning route file name; it could be `week-plan.tsx` or `app.tsx`'s `/app` route). Mount it below the `<BriefCanvas>` / plan canvas section.

```typescript
interface PendingChildRequestsProps {
  householdId: string;
}

export function PendingChildRequests({ householdId }: PendingChildRequestsProps) {
  const [requests, setRequests] = useState<ChildRequest[]>([]);
  // load on mount + on SSE child_request.* events
  // ...
}
```

**Data fetching:** Follow the `useEffect + hkFetch` pattern — NOT `useQuery`. Fetch from `GET /v1/child-requests?status=pending`. Parse with `PendingChildRequestsResponseSchema.parse(raw)`.

**SSE re-fetch:** The SSE dispatcher (`apps/web/src/lib/sse.ts`) handles `child_request.received` and `child_request.resolved` by invalidating the `['child-requests', householdId]` query key. Since this component uses `useEffect` + `hkFetch`, wire a re-fetch by subscribing to SSE events. Check how other components handle SSE-triggered re-fetches — look for `useEffect` patterns that listen to the sse event bus in other route files.

**Empty state:** If `requests.length === 0`, render nothing (`return null`). Do NOT render an empty container or placeholder.

**Request card anatomy** (DESIGN.md compliance):
- Surface: `bg-surface rounded-lg` card
- Label above cards: `"From your kids"` — `text-fg-muted text-sm font-medium uppercase tracking-wide`
- Child name: `font-serif text-fg` (Instrument Serif)
- Request text: `text-fg text-base`
- Created at: `text-fg-muted text-sm` — formatted as relative time ("2 hours ago") or `"Mon 14 Apr"` if >24h
- Approve button: primary CTA (`bg-amber-warm text-bg`) — use existing `PrimaryButton` component
- Decline button: ghost/secondary — `text-fg-muted underline text-sm` or use existing secondary button variant
- After approve/decline: remove the card from local state immediately (optimistic) + the SSE invalidation will trigger a refetch that confirms the removal

**Honey rule:** Approve uses amber (recognition + positive action). Do NOT use sacred-plum on buttons here.

**Scope:** This component is in `.app-scope`. No `.child-scope` or `.grandparent-scope` guard needed.

### AC12 — Web: Child-side "Tell [parent] back" on Lunch Link page

In `apps/web/src/routes/(app)/lunch-link.tsx`, add the request affordance BELOW all existing content (after the passport link added in 4-S12):

```typescript
// State additions to lunch-link.tsx:
const [requestText, setRequestText] = useState('');
const [requestState, setRequestState] = useState<'idle' | 'submitting' | 'submitted'>('idle');
```

**UI (`.child-scope` — large text, large touch targets):**

```
Tell [parentName] back:
[textarea — max 200 chars, multiline, 3 rows, 48px min height]
[Submit button — text: "Send to [parentName]"]
```

- `parentName` is either the household name or a generic "your parent" if unavailable. The `GET /v1/lunch-link/:token` response (existing endpoint) returns the heart note content and child name. If `parentName` isn't in the response shape, use `"your parent"` as the fallback — do NOT add a new API call just for the name.
- Textarea: `font-serif text-[22px] leading-relaxed w-full bg-surface rounded-lg p-3 border border-fg-muted/20`
- Character counter: `"X / 200"` — `text-fg-muted text-sm` — shown when `requestText.length > 0`
- Submit button: `PrimaryButton size="lg"` (follows Honey rule — amber CTA)
- After submit: replace the form with static text `"Got it! Your note is on its way."` (no confetti, no animation — matches Sacred Channel tone)
- If the request was already submitted (server returns 409): show the confirmation state directly without re-showing the form.

**Submit handler:**
```typescript
async function handleSubmitRequest() {
  setRequestState('submitting');
  try {
    await publicFetch(`/v1/lunch-link/${linkId}/child-request`, {
      method: 'POST',
      body: JSON.stringify({ request_text: requestText }),
    });
    setRequestState('submitted');
  } catch (err) {
    if (isConflictError(err)) {
      setRequestState('submitted');  // already submitted — show confirmation state
    } else {
      setRequestState('idle');  // other errors: show form again (silent retry)
    }
  }
}
```

- `publicFetch` / unauthenticated fetch — check how the child-facing page fetches the lunch link data (it's a public route). Use the same unauthenticated fetch helper. Do NOT use `hkFetch` (which adds the auth Bearer header).
- `linkId` is the token URL param (from `useParams()`). In the lunch-link route, this is `linkId` (confirmed from 4-S12 completion notes).

**Do NOT show the request form if `requestState === 'submitted'`.**

**Conditional render:** Only show the request form when the Lunch Link is in valid/viewable state (not expired). If the page is showing the 410 "link expired" state, hide the request form.

### AC13 — Accessibility

**Child scope (Lunch Link — `/lunch/*`):**
- Textarea has `id="child-request-input"` + `<label htmlFor="child-request-input">Tell [parentName] back</label>`
- Submit button has `aria-busy="true"` when `requestState === 'submitting'`
- Confirmation state: `role="status"` on the confirmation paragraph
- Character counter: `aria-live="polite"` so it announces changes to screen readers
- Minimum touch target: 48px for submit button (`min-h-[48px]` — child-scope rule)

**Parent scope (`/app` — `.app-scope`):**
- Each request card: `<article aria-label="{childName}'s request">` wrapping the card content
- Approve/Decline buttons: `aria-label="Approve {childName}'s request"` / `aria-label="Decline {childName}'s request"`
- WCAG 2.1 AA minimum (not AAA — this is app-scope)

### AC14 — Unit and endpoint tests

**`apps/api/src/modules/child-requests/child-request.repository.test.ts`** (new):
- `create`: inserts row, returns id + other fields
- `create`: unique constraint on session_id → Supabase error propagated
- `findPendingByHousehold`: returns pending rows with child_name joined
- `findPendingByHousehold`: excludes approved/declined rows
- `findById`: returns null when id not in household (no data leak oracle)
- `resolve`: marks approved + sets resolved_at + resolved_by_user_id
- `resolve`: returns 0-update when already resolved → service throws

**`apps/api/src/modules/child-requests/child-request.routes.test.ts`** (new):
- `POST /v1/lunch-link/:token/child-request` → 404 on invalid token
- `POST /v1/lunch-link/:token/child-request` → 201 on valid token + valid body
- `POST /v1/lunch-link/:token/child-request` → 409 on duplicate session_id
- `POST /v1/lunch-link/:token/child-request` → 422 on `request_text` exceeding 200 chars
- `GET /v1/child-requests` → 403 for `guest_author` role (not in allowed roles)
- `GET /v1/child-requests` → 200 with pending requests for household
- `GET /v1/child-requests` → 200 with empty `requests: []` when none pending
- `POST /v1/child-requests/:id/approve` → 200 + writes food_preferences signal
- `POST /v1/child-requests/:id/approve` → 404 when id not in household
- `POST /v1/child-requests/:id/approve` → 409 when already resolved
- `POST /v1/child-requests/:id/decline` → 200
- `POST /v1/child-requests/:id/decline` → 404 when id not in household

**`apps/api/src/modules/lunch-link/lunch-link.routes.test.ts`** (additions):
- `POST /v1/lunch-link/:token/child-request` → accessible without auth (auth-exclusion regex covers it)

### AC15 — Typecheck and existing tests unaffected

`pnpm typecheck` — no new errors. All existing lunch-link, heart-note, children, and child-preferences tests pass. Web suite (374+) stays green.

---

## Demo Path

1. **Child submits a request:**
   - Open `/lunch/{valid-token}` on a device
   - Scroll to "Tell [parent] back" section
   - Type "I want pizza on Friday!" (≤200 chars) → tap "Send to [parent]"
   - See "Got it! Your note is on its way." confirmation
   - Open Supabase: confirm `child_lunch_requests` row with `status='pending'`

2. **Parent sees the request:**
   - As parent, open `/app`
   - See the `<PendingChildRequests>` section showing Layla's request below the plan canvas
   - OR: open the LumiPanel (tap the orb) — see a turn: `"Layla asked: 'I want pizza on Friday!'"` in the planning thread

3. **Parent approves:**
   - Tap [Approve] on the request card
   - Card disappears from the planning page
   - Supabase: `child_lunch_requests.status = 'approved'`
   - Supabase: new `food_preferences` row: `item='I want pizza on Friday!'`, `valence='likes'`, `enforcement='just_for_context'`, `source='child_request'`, `child_id=<layla-id>`

4. **Planner uses the signal:**
   - Trigger plan regeneration for next week
   - Check that Friday's plan (or pizza-adjacent dish) appears in the generated plan
   - Open audit_log → `plan.generated` row should reflect the kitchen map including the new food_preferences entry

5. **Duplicate rejection:**
   - On same child Lunch Link, try submitting a second request → API returns 409
   - UI shows the confirmation state (silent dedup — parent only sees one request)

---

## Critical Guardrails

**Oracle prevention on child endpoint — ALL token failures → 404.**
`POST /v1/lunch-link/:token/child-request` must return 404 for invalid, expired, and suppressed tokens. Never return a message that reveals whether the token existed or why it failed. Follow the same pattern as `POST /v1/lunch-link/:token/rate` in `lunch-link.routes.ts`.

**One request per session — UNIQUE constraint on `session_id`.**
The `UNIQUE (session_id)` constraint on `child_lunch_requests` is the single source of truth for dedup. The service layer catches the Supabase unique-constraint error and throws `ConflictError` → 409 to the caller. The child's UI silently shows the confirmation state on 409. Do NOT implement a pre-flight check to avoid the race — let the DB constraint be authoritative.

**Child request is a SOFT signal — it never auto-applies.**
Approved requests write to `food_preferences` with `enforcement='just_for_context'`. This is the softest enforcement level: advisory, not binding. The planner will bias toward it but can and will override it for safety, allergy, or policy reasons. Do NOT write to `child_allergens` or `household_rules` — only `food_preferences`.

**`food_preferences` item is free-form text, not a recipe_id.**
The planner treats `food_preferences` entries with `enforcement='just_for_context'` as flavor/cuisine hints. A `request_text` of "pizza on Friday!" will be surfaced to the planner as a food preference signal — the planner interprets it as a cuisine/food-type hint. Do NOT try to parse or resolve the text to a `recipe_id` in this slice.

**No AI modification of the child's request text.**
The request text is stored and displayed verbatim. Do NOT pass it through Lumi or any LLM before storing. Sacred-channel doctrine applies: user-authored content in child-data paths is never modified by AI.

**Parent-only approval — `guest_author` cannot approve.**
`POST /v1/child-requests/:id/approve` and `decline` are gated by `authorize(['primary_parent', 'secondary_caregiver'])`. Guest Authors (grandparents) cannot see or act on child requests — they don't have the household context to approve planner signals.

**`verifyTokenForRead` — do NOT call `verifyAndFetch`.**
`verifyAndFetch` has write side-effects (records first_open, increments reopen count). For the child-request submission, use `verifyTokenForRead` (added in 4-S12, in `lunch-link.service.ts`). Its return shape includes `{ status: 'invalid' | 'valid' | 'expired', childId, householdId }`. Check whether `sessionId` is returned — if not, add it (it's in the `lunch_link_sessions` row that `verifyTokenForRead` already reads).

**No audit log entry required for child requests in this slice.**
The `food_preferences` write on approval does not require an explicit `audit_log` entry in this slice (the Supabase RLS policy + the `resolved_by_user_id` column on `child_lunch_requests` provides enough accountability for beta). Post-beta, a `child_request.approved` audit row should be added — defer with a comment.

**Thread turn injection is best-effort — it must never block request submission.**
If `getOrCreatePlanningThread` returns null (no planning thread exists for the household), log at `warn` and continue. The child's submission succeeds regardless. Wrap the thread turn write in a try/catch and log any error at `warn` — do not throw.

---

## What Already Exists (Do Not Recreate)

**`verifyTokenForRead()`** — `apps/api/src/modules/lunch-link/lunch-link.service.ts`. Added in 4-S12. Handles HMAC + expiry + suppression checks read-only (no side effects). Check its exact return type signature before writing the handler.

**`LUNCH_LINK_PASSPORT_RE`** — `apps/api/src/middleware/authenticate.hook.ts`. Added in 4-S12. This is the pattern for `LUNCH_LINK_CHILD_REQUEST_RE` (AC3). Copy its structure exactly.

**`food_preferences` repository** — check `apps/api/src/modules/kitchen-map/` for the repository file containing the `declare` method. This was wired in 2.5-s1 (foundation) and used by onboarding tools in 2-s22. Do NOT create a new repository — call the existing one.

**`ConflictError`, `NotFoundError`** — `apps/api/src/common/errors.ts`. Both should exist from previous slices. Check before creating new error classes.

**`authorize(['primary_parent', 'secondary_caregiver'])`** — existing preHandler. Used throughout the codebase. Just pass the role array.

**`publicFetch` / unauthenticated fetch helper** — check `apps/web/src/lib/fetch.ts` for the unauthenticated counterpart to `hkFetch`. In 4-S12, the child passport route used `publicGet`. Confirm which helper is correct for an unauthenticated POST — it may need to be `publicFetch` or a raw `fetch` with Content-Type header.

**`PrimaryButton`** — `packages/ui/src/PrimaryButton.tsx` (or similar). Used in 4-S13 for the grandparent send affordance. `PrimaryButton size="lg"` gives 56px touch target. Use `size="md"` or `"lg"` for child and parent CTAs respectively.

**`lumi.repository.ts`** — `apps/api/src/modules/lumi/lumi.repository.ts`. Has `getRecentTurns` (from 12-3). May or may not have `insertTurn`. Check before implementing — add `insertTurn` minimally if absent.

**Planning thread** — threads are keyed by `(household_id, surface)`. The planning thread has `surface='planning'`. Check the `threads` table schema + LumiRepository for how to look up by household + surface.

**SSE dispatcher** — check `apps/api/src/lib/sse.ts` (or `apps/api/src/plugins/sse.plugin.ts`) for how to fire invalidation events. Follow the pattern used in `lunch-link.routes.ts` when emitting `lunch_link.rated`.

---

## Tasks

### T1 — Migration

**T1.1** Create `supabase/migrations/20261015000000_child_lunch_requests.sql` per AC1.

**T1.2** Check `food_preferences.source` CHECK constraint. If `'child_request'` is not in the allowed values, create `supabase/migrations/20261015000100_food_preferences_source_child_request.sql` per AC8.

---

### T2 — Contracts + Types

**T2.1** Create `packages/contracts/src/child-request.ts` per AC2. Export `ChildRequestCreateSchema`, `ChildRequestSchema`, `PendingChildRequestsResponseSchema`.

**T2.2** Export from `packages/contracts/src/index.ts`.

**T2.3** Add inferred types to `packages/types/src/index.ts` (use `export type`).

**T2.4** Add `child_request.received` and `child_request.resolved` to the `InvalidationEvent` union in `packages/contracts/src/events.ts` (or wherever `InvalidationEvent` is defined — check the file that defines the SSE event types).

---

### T3 — Auth exclusion

**T3.1** Add `LUNCH_LINK_CHILD_REQUEST_RE` to `apps/api/src/middleware/authenticate.hook.ts` per AC3. Copy the structure of `LUNCH_LINK_PASSPORT_RE` exactly — including how it is used in the exclusion check.

---

### T4 — Repository

**T4.1** Create `apps/api/src/modules/child-requests/child-request.repository.ts` per AC4.

**T4.2** Check `apps/api/src/modules/lumi/lumi.repository.ts` — add `insertTurn` method if absent:
```typescript
async insertTurn(input: {
  threadId: string;
  role: 'user' | 'assistant';
  content: string;
  metadata?: Record<string, unknown>;
}): Promise<{ server_seq: number }>
```
Look at the `thread_turns` table schema (from 12-3 story) for the correct column names. The `server_seq` is a monotonically increasing counter per thread — check how it's assigned (DB DEFAULT nextval or application-assigned). If no insert method and the pattern is complex, consult `apps/api/src/modules/lumi/lumi.routes.ts` or the thread service for an existing insert pattern.

**T4.3** Unit tests per AC14 — `child-request.repository.test.ts`.

---

### T5 — Service

**T5.1** Create `apps/api/src/modules/child-requests/child-request.service.ts` per AC5, AC6, AC7, AC8.

**T5.2** Verify `food_preferences` repository path by grepping for `food_preferences` in `apps/api/src/modules/`. Inject it via constructor injection into `ChildRequestService`.

---

### T6 — API Routes

**T6.1** Add the child-submit endpoint to `apps/api/src/modules/lunch-link/lunch-link.routes.ts` per AC9. Inject `ChildRequestService` into the lunch-link plugin.

**T6.2** Create `apps/api/src/modules/child-requests/child-request.routes.ts` per AC10.

**T6.3** Register `childRequestRoutes` in `apps/api/src/app.ts` following the same pattern as `guestAuthorRoutes`.

**T6.4** Add `child_request.received` + `child_request.resolved` to the SSE dispatcher client-side handler in `apps/web/src/lib/sse.ts`.

**T6.5** Endpoint tests per AC14.

---

### T7 — Web: Parent component

**T7.1** Create `apps/web/src/features/child-requests/PendingChildRequests.tsx` per AC11.

**T7.2** Find the planning route page file (search for the file that renders the planning canvas / BriefCanvas / plan tiles — check `apps/web/src/routes/(app)/`). Add `<PendingChildRequests householdId={...} />` below the BriefCanvas. The `householdId` is available from the auth store or from the planning data fetch.

**T7.3** Register `PendingChildRequests` in the planning route. Test that it renders nothing when no requests exist.

---

### T8 — Web: Child-side request form

**T8.1** Add the "Tell [parent] back" request form to `apps/web/src/routes/(app)/lunch-link.tsx` per AC12. Add below the passport link added in 4-S12.

**T8.2** Implement the submit handler using the unauthenticated fetch helper. Handle 201 (success), 409 (already submitted → show confirmation), other errors (show form again silently).

**T8.3** Implement character counter + accessible textarea per AC13.

---

### T9 — Final Verification

**T9.1** `pnpm typecheck` — no new errors (API + web at pre-existing baselines).

**T9.2** `pnpm --filter @hivekitchen/api test -- child-request` — all new tests pass.

**T9.3** `pnpm --filter @hivekitchen/api test -- lunch-link` — existing tests pass + new auth-exclusion test passes.

**T9.4** `pnpm --filter @hivekitchen/web test` — all web tests pass (374+ green).

**T9.5** Manual demo path per Demo Path section above.

---

## Project Structure Notes

**New files:**
- `supabase/migrations/20261015000000_child_lunch_requests.sql`
- `supabase/migrations/20261015000100_food_preferences_source_child_request.sql` *(if source CHECK needs extension)*
- `packages/contracts/src/child-request.ts`
- `apps/api/src/modules/child-requests/child-request.repository.ts`
- `apps/api/src/modules/child-requests/child-request.repository.test.ts`
- `apps/api/src/modules/child-requests/child-request.service.ts`
- `apps/api/src/modules/child-requests/child-request.routes.ts`
- `apps/api/src/modules/child-requests/child-request.routes.test.ts`
- `apps/web/src/features/child-requests/PendingChildRequests.tsx`

**Modified files:**
- `packages/contracts/src/index.ts` — export `child-request.js`
- `packages/contracts/src/events.ts` (or equivalent) — add `child_request.*` event types
- `packages/types/src/index.ts` — inferred type exports
- `apps/api/src/middleware/authenticate.hook.ts` — add `LUNCH_LINK_CHILD_REQUEST_RE`
- `apps/api/src/modules/lumi/lumi.repository.ts` — add `insertTurn` if absent
- `apps/api/src/modules/lunch-link/lunch-link.routes.ts` — add child-request submit endpoint
- `apps/api/src/modules/lunch-link/lunch-link.routes.test.ts` — auth-exclusion test addition
- `apps/api/src/app.ts` — register `childRequestRoutes`
- `apps/web/src/lib/sse.ts` — handle `child_request.*` SSE events
- `apps/web/src/routes/(app)/lunch-link.tsx` — add child-side request form
- `apps/web/src/routes/(app)/<planning-route>.tsx` — add `<PendingChildRequests>`

**Possibly modified (check before assuming):**
- `apps/api/src/modules/lumi/lumi.repository.ts` — insertTurn (add if missing)
- `apps/api/src/modules/kitchen-map/food-preferences.repository.ts` — `declare` method already exists; verify source CHECK

**Not modified:**
- `apps/api/src/middleware/authorize.hook.ts` — no changes
- `apps/api/src/modules/lunch-link/lunch-link.service.ts` — `verifyTokenForRead` already correct
- `apps/api/src/modules/child-preferences/` — `ChildPreferencesRepository` untouched
- `apps/api/src/agents/` — no agent changes in this slice
- Planner prompt — the kitchen map already reads `food_preferences`; no prompt change needed

---

## Task Completion Checklist

- [x] T1.1 — `20261015000000_child_lunch_requests.sql` migration created
- [x] T1.2 — `food_preferences.source` CHECK extended (real value set + `child_request`)
- [x] T2.1 — `packages/contracts/src/child-request.ts` with 3 schemas
- [x] T2.2 — Exported from contracts index
- [x] T2.3 — Inferred types in `packages/types/src/index.ts`
- [x] T2.4 — `child_request.received` + `child_request.resolved` in `InvalidationEvent` union
- [x] T3.1 — `LUNCH_LINK_CHILD_REQUEST_RE` added to authenticate.hook.ts
- [x] T4.1 — `ChildRequestRepository` with create / findPendingByHousehold / findById / resolve
- [~] T4.2 — Reused `ThreadRepository.appendTurnNext` instead of a new `lumi.insertTurn` (see Completion Notes)
- [x] T4.3 — Repository unit tests: all AC14 repo cases
- [x] T5.1 — `ChildRequestService` with submitRequest / getPendingRequests / approve / decline
- [x] T5.2 — `food_preferences` repo injected; source 'child_request' write confirmed
- [x] T6.1 — Child-submit endpoint on lunch-link routes + oracle-prevention 404
- [x] T6.2 — Parent endpoints: GET list, POST approve, POST decline
- [x] T6.3 — `childRequestRoutes` registered in `app.ts`
- [x] T6.4 — SSE client handler + `QueryKeys.childRequests` in web client (server emit deferred — see notes)
- [x] T6.5 — All AC14 route tests pass
- [x] T7.1 — `PendingChildRequests.tsx` created with fetch + display + approve/decline
- [x] T7.2 — Mounted in `BriefCanvas` below the brief PageHeader, above the tile grid
- [x] T7.3 — Empty state: renders nothing
- [x] T8.1 — Child-side request form added to `lunch-link.tsx`
- [x] T8.2 — Submit handler: 201 → confirmation, 409 → confirmation, other status → silent retry
- [x] T8.3 — Accessible textarea + character counter + submit button per AC13
- [x] T9.1 — Typecheck: no new errors (API 11 ≤ baseline; web 3 = baseline; contracts/types pre-existing only)
- [x] T9.2 — Child-request API tests: all pass (repo + service + routes)
- [x] T9.3 — Lunch-link existing tests: unaffected (only the pre-existing lunch-link-dev baseline fails)
- [x] T9.4 — Web suite: 378 green (was 374; +4 PendingChildRequests tests)
- [ ] T9.5 — Manual demo path — requires live stack + Supabase (USER-SIDE GATE)

---

## Dev Agent Record

### Implementation Plan

Built bottom-up in dependency order: migrations → contracts/types/events → auth-exclusion → repository → service → API routes → web parent component → web child form → verification. The story spec was written against several premises that do not hold in the current codebase; each was reconciled to the real code (see deviations below) rather than implemented literally.

### Completion Notes

Story-spec vs. actual-codebase reconciliations (all verified against the live code before writing):

1. **RLS helper** — AC1's `current_household_id = current_household_id()` does not exist; there is no such SQL function. Every household-scoped table uses the inline subquery `household_id = (SELECT current_household_id FROM users WHERE id = auth.uid())`. The migration uses that form (matches `child_preferences`, the cited precedent).

2. **`food_preferences.source` CHECK (AC8/T1.2)** — the slice doc's replacement set `('onboarding','turn','tool','user_edit','plan_outcome','import','child_request')` is **wrong** and would have rejected every existing row. The real set (migration `20260903000200`) is `('onboarding_declared','memory_promoted','rating_signal','parent_edited','backfill_migration')`. Migration `20261015000100` ADDs `'child_request'` to the **real** set.

3. **`food_preferences.declare` signature (AC8)** — is positional `declare(householdId, childId, item, valence, enforcement, source)`, not the object form in the AC snippet. Called positionally with `valence='likes'`, `enforcement='just_for_context'`, `source='child_request'`, item truncated to 100 chars.

4. **Lumi thread injection (AC6 / T4.2)** — the real `thread_turns` schema is `(server_seq, role ∈ {user,lumi,system}, body: TurnBody)` with **no `content`/`metadata` columns** and **no `role:'assistant'`**. `ThreadRepository.appendTurnNext` already implements per-thread `server_seq` allocation + unique-violation retry, so the service **reuses it** rather than adding a divergent `LumiRepository.insertTurn` (T4.2) that would re-implement the same logic. The turn is a plain `{type:'message', content:'<child> asked: "<text>"'}` with `role:'lumi'`, written best-effort: it finds an active `type='planning'`/`modality='text'` thread and no-ops (warn-logs) if none exists, wrapped in try/catch so it never blocks submission.

5. **SSE dispatch (AC5/AC6/AC7)** — there is **no server-side SSE dispatcher**: `/v1/events` is a heartbeat-only stub and real Redis pub/sub fan-out is explicitly deferred to Story 5.2 (Epic 5, backlog). The cited `lunch_link.rated` emit also does not exist. So the two `InvalidationEvent` types (`child_request.received`/`child_request.resolved`, snake-case `household_id` to match the union) + the web `case` handler + `QueryKeys.childRequests` **land now** (keeps the exhaustive-`switch` typecheck green and is ready when 5.2 ships), but the server-side emit is a documented no-op. The flow is fully functional without the push: the parent list loads on mount and updates optimistically on approve/decline.

6. **Web data fetching (AC11)** — AC11 says "useEffect + hkFetch, NOT useQuery", but the codebase's `(app)` pages all use `useQuery` hooks (`useBriefStateQuery`, `usePlanQuery`) and the SSE bridge **only** refetches via query-key invalidation. Used `useQuery` keyed by `QueryKeys.childRequests(householdId)` so SSE invalidation actually works (the stale story guidance is incompatible with SSE refetch). Web file is `lib/realtime/sse.ts` (not `lib/sse.ts`).

7. **Over-length body status (AC14)** — AC14 wants 422 for `request_text > 200`, but this codebase returns **400** for all Zod body-validation failures (`ValidationError.status=400`; `app.ts` maps `ZodError`→400); 422 is reserved for semantic domain errors (guardrail, cap). Used `schema.body` validation → 400, and the test asserts 400. Forcing 422 would require bypassing `schema.body` for a one-off error, contradicting the "every route declares schema from contracts" convention.

8. **`PrimaryButton` aria-busy (AC12 vs AC13)** — AC12 says use `PrimaryButton size="lg"`, but `PrimaryButton` has no `aria-busy` prop (AC13 requires it on the child submit). Used a raw `<button>` with the identical `bg-amber-warm`/`hover:bg-amber`/`min-h-[56px]` styling so both ACs are honored (amber Honey-rule CTA + `aria-busy`/`htmlFor` label/≥48px target).

9. **`verifyTokenForRead` sessionId** — it did not return `sessionId`; added `sessionId: session.id` to its `valid` return (the session row was already fetched). Surgical/additive — the existing passport caller is unaffected. (The story's "not modified" note on `lunch-link.service.ts` is superseded by the AC9/guardrail instruction to add `sessionId`.)

**Guardrails honored:** oracle prevention (all token failures → 404 on the public endpoint); one-request-per-session via the DB `UNIQUE(session_id)` (service maps 23505 → `ConflictError` 409, no pre-flight check); request_text stored verbatim (no AI modification); soft signal only (`enforcement='just_for_context'`, never `child_allergens`/`household_rules`); `guest_author` cannot approve/decline (`authorize(['primary_parent','secondary_caregiver'])`); thread injection best-effort/never blocks; no audit-log entry for child requests (deferred to post-beta).

**Verification:** API typecheck 11 errors (all pre-existing files; ≤14 baseline; zero in 4-S15 files). Web typecheck 3 errors (baseline; all pre-existing — `child-bag-composition.tsx` ×2, `heart-notes.ts` ×1). Web suite 378/378 (+4). API suite 22 failed / 1281 passed — the 22 are the documented pre-existing baseline (the only lunch-link failure is the long-standing `lunch-link-dev` `gte/lt` mock mismatch, unrelated to this slice); all new child-request repo/service/route tests and the 8 added lunch-link submit tests pass. T9.5 (manual demo) requires the live stack + Supabase — user-side gate.

## File List

**New files:**
- `supabase/migrations/20261015000000_child_lunch_requests.sql`
- `supabase/migrations/20261015000100_food_preferences_source_child_request.sql`
- `packages/contracts/src/child-request.ts`
- `apps/api/src/modules/child-requests/child-request.repository.ts`
- `apps/api/src/modules/child-requests/child-request.repository.test.ts`
- `apps/api/src/modules/child-requests/child-request.service.ts`
- `apps/api/src/modules/child-requests/child-request.service.test.ts`
- `apps/api/src/modules/child-requests/child-request.routes.ts`
- `apps/api/src/modules/child-requests/child-request.routes.test.ts`
- `apps/web/src/features/child-requests/PendingChildRequests.tsx`
- `apps/web/src/features/child-requests/PendingChildRequests.test.tsx`

**Modified files:**
- `packages/contracts/src/index.ts` — export `child-request.js`
- `packages/contracts/src/events.ts` — add `child_request.received` / `child_request.resolved` to `InvalidationEvent`
- `packages/types/src/index.ts` — `ChildRequestCreate` / `ChildRequest` / `PendingChildRequestsResponse` inferred type exports
- `apps/api/src/middleware/authenticate.hook.ts` — add `LUNCH_LINK_CHILD_REQUEST_RE` (POST-only exclusion)
- `apps/api/src/modules/lunch-link/lunch-link.service.ts` — `verifyTokenForRead` returns `sessionId`
- `apps/api/src/modules/lunch-link/lunch-link.routes.ts` — inject `ChildRequestService`; add `POST /v1/lunch-link/:token/child-request`
- `apps/api/src/modules/lunch-link/lunch-link.routes.test.ts` — child-request submit tests + mock support
- `apps/api/src/app.ts` — register `childRequestRoutes`
- `apps/web/src/lib/realtime/sse.ts` — handle `child_request.*` events (query-key invalidation)
- `apps/web/src/lib/realtime/query-keys.ts` — add `QueryKeys.childRequests`
- `apps/web/src/features/plan/BriefCanvas.tsx` — mount `<PendingChildRequests>` below the brief header
- `apps/web/src/routes/(app)/lunch-link.tsx` — child-side "Tell [parent] back" request form

---

## References

- [Source: `_bmad-output/planning-artifacts/epic-4-vertical-slices.md` §Slice 4-S15]
- [Source: `_bmad-output/planning-artifacts/epics.md` §Story 4.12 — FR42, Boundary 1]
- [Source: `docs/DESIGN.md`] — token system, Honey rule, `.child-scope` touch targets, sacred-plum constraint
- [Source: `packages/design-system/SCOPE_CHARTER.md`] — `.child-scope` typography and sizing rules
- [Source: `apps/api/src/modules/lunch-link/lunch-link.service.ts`] — `verifyTokenForRead()` (check actual signature)
- [Source: `apps/api/src/modules/lunch-link/lunch-link.routes.ts`] — oracle-prevention pattern on public child routes, `POST /v1/lunch-link/:token/rate` as the model
- [Source: `apps/api/src/middleware/authenticate.hook.ts`] — `LUNCH_LINK_PASSPORT_RE` as the auth-exclusion model
- [Source: `apps/api/src/modules/child-preferences/child-preferences.repository.ts`] — `child_preferences` signal pattern (do not reuse)
- [Source: `apps/api/src/modules/kitchen-map/food-preferences.repository.ts`] — `declare()` method (use for planner signal)
- [Source: `apps/api/src/modules/guest-author/guest-author.routes.ts`] — app.ts plugin registration pattern
- [Source: `apps/api/src/modules/lumi/lumi.repository.ts`] — thread turns (check for `insertTurn`)
- [Source: `apps/api/src/modules/flavor-passport/`] — 4-S12 sibling module as structural reference
- [Source: `apps/web/src/routes/(app)/lunch-link.tsx`] — child-facing page + passport link (add request form below)
- [Source: `apps/web/src/features/grandparent/HeartNoteComposer.tsx`] — 4-S13 at-cap child text pattern (Instrument Serif, confirmation state)
- [PRD FR42] — Child can submit a text-based "request a lunch" suggestion
- [PRD Boundary 1] — Child has a voice without operating the system
- [Architecture §1.2b] — `food_preferences` table + `enforcement` enum + source check pattern

---

## Previous Story Intelligence (from 4-S13, 4-S12)

1. **Router is react-router-dom with `createBrowserRouter`** — NOT TanStack Router. Routes registered in `app.tsx`. URL params via `useParams()`. The child Lunch Link param is `linkId` (not `token`).

2. **`hkFetch` adds auth header — do NOT use it on public child-facing routes.** The Lunch Link page uses an unauthenticated fetch helper (check `publicGet` or direct `fetch` usage in `lunch-link.tsx`). Use the same helper for `POST /v1/lunch-link/:token/child-request`.

3. **Design tokens are named Tailwind utilities.** Use `text-fg`, `text-fg-muted`, `bg-surface`, `bg-amber`, `rounded-lg` — NOT bracket syntax like `text-[--fg]`. These named utilities resolve to the same CSS vars.

4. **`LUNCH_LINK_PASSPORT_RE` auth-exclusion pattern (4-S12).** The authenticate hook excludes specific public paths via regex. `LUNCH_LINK_CHILD_REQUEST_RE` follows the same pattern. The original `LUNCH_LINK_PUBLIC_RE` stops at the path boundary and does NOT cover sub-paths — a new regex constant is needed.

5. **`GrandparentScopeLayout` uses `{children}` prop, not `<Outlet/>` (4-S13, decision #4).** Confirmed that the `(grandparent)` layout pattern differs from the `(app)` layout which uses `<Outlet/>`. This affects how the grandparent route was registered. For 4-S15, the parent component `<PendingChildRequests>` mounts directly inside the planning route — no layout change needed.

6. **Plugin registration is in `apps/api/src/app.ts`, not `server.ts`** (4-S13, decision #3). `server.ts` only calls `buildApp`. Every route plugin registers in `app.ts`.

7. **Inject `FlavorPassportService` into `lunch-link.routes.ts` via constructor injection** (4-S12, T4.3). `ChildRequestService` follows the same pattern for injection into `lunch-link.routes.ts`.

8. **Oracle prevention: `verifyTokenForRead` → all failures → 404** (4-S12). The pattern is: check `result.status !== 'valid'` → `reply.status(404).send({ error: 'not found' })`. Apply identically to the child-request endpoint.

---

## Change Log

| Date | Change |
|------|--------|
| 2026-06-03 | Story 4-S15 created — child request-a-lunch + parent approval. Status: ready-for-dev. |
| 2026-06-03 | Implemented all 15 ACs (T1–T9). Migrations + contracts + auth-exclusion + ChildRequestRepository/Service + public submit endpoint (oracle-prevention 404, 409 on dup session) + parent GET/approve/decline + web `<PendingChildRequests>` + child "Tell [parent] back" form. 9 spec/codebase reconciliations recorded in Dev Agent Record (RLS form, real food_preferences source set, declare positional sig, thread-turn reuse, no SSE dispatcher → contract+client only, useQuery over useEffect, 400 not 422, raw aria-busy button, verifyTokenForRead sessionId). New tests: API repo+service+routes + 8 lunch-link submit cases + 4 web component tests. Verification: zero new typecheck errors (API 11, web 3 — all pre-existing); web 378/378; API 22-fail baseline unchanged (only pre-existing lunch-link-dev failure in the lunch-link suite). T9.5 manual demo = user-side gate. Status: ready-for-dev → review. |
