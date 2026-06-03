# Story 4-S13: Grandparent Composer with At-Cap Rhythm

Status: done

**Slice key:** `4-s13-grandparent-composer-at-cap-rhythm`
**Epic:** 4 — Lunch Link & Heart Note Sacred Channel
**Source slice doc:** `_bmad-output/planning-artifacts/epic-4-vertical-slices.md` §Slice 4-S13
**Builds on:** 4-S1 (heart_notes table + POST endpoint + autosave), 4-S3 (HMAC tokens), 4-S5 (envelope encryption), 4-S6 (scheduling + scheduled_for column)
**Folds:** 4.10 — FR40 partial, UX-DR22

---

## Story

As a **Grandparent Guest Author**,
I want to compose Heart Notes for my grandchild with rate-limit awareness expressed as rhythm copy when I hit the monthly cap,
So that the cap feels like a heartbeat, not a restriction (FR40 partial, UX-DR22).

---

## Acceptance Criteria

### AC1 — Contracts: `GuestAuthorCapResponseSchema`

New file `packages/contracts/src/guest-author.ts`. Export from `packages/contracts/src/index.ts`.

```typescript
export const GuestAuthorCapResponseSchema = z.object({
  child_id:         z.string().uuid(),
  child_name:       z.string(),
  grandparent_name: z.string(),          // users.display_name of the calling guest_author
  grandparent_term: z.string().nullable(), // 'Nani'|'Dadi'|'Lola'|'Bibi' if detected in display_name; else null
  notes_used:       z.number().int().min(0), // non-cancelled notes created this calendar month by this user
  cap:              z.number().int(),    // always 2 in this slice
  next_month_opens: z.string(),          // YYYY-MM-DD — first weekday (Mon–Fri) of next calendar month
});
```

Add inferred types to `packages/types/src/index.ts`:
```typescript
export type { GuestAuthorCapResponse } from '@hivekitchen/contracts';
```
(Use `export type` — `isolatedModules` requirement.)

### AC2 — Invite redirect for `guest_author` role

In `apps/api/src/modules/auth/invite.service.ts`, method `redeemInvite`:
- Change `scope_target` from `'/app/household/settings'` for all roles to a role-specific value:
  - `'secondary_caregiver'` → `'/app/household/settings'` (unchanged)
  - `'guest_author'` → `'/guest-author/compose'`

The `InviteRedeemPage` (`apps/web/src/routes/invite/$token.tsx`) navigates to `result.scope_target` after redemption. This change routes grandparents directly to their composer instead of the caregiver settings page.

### AC3 — `HeartNoteRepository.countAuthoredThisMonth`

New method on `HeartNoteRepository` (`apps/api/src/modules/heart-notes/heart-note.repository.ts`):

```typescript
async countAuthoredThisMonth(authorUserId: string, householdId: string): Promise<number>
```

- Counts `heart_notes` rows where:
  - `author_user_id = authorUserId`
  - `household_id = householdId`
  - `status NOT IN ('cancelled')` — cancelled notes don't consume cap slot
  - `created_at` falls within the current calendar month (UTC)
    - `created_at >= '${year}-${month}-01T00:00:00Z'` AND `created_at < '${nextMonthYear}-${nextMonth}-01T00:00:00Z'`

**Important:** Cap is counted against the month in which the note was **created**, not its `scheduled_for`. This means:
- A note created today (June 3) but scheduled for July 1 → counted against June's cap.
- The cap bypass (see AC4) is what allows the "Save for [month] 1" note to still POST even though June's cap is full.

No decryption needed — this is a count query only. No DEK fetch.

### AC4 — Cap enforcement on `POST /v1/heart-notes`

In `apps/api/src/modules/heart-notes/heart-note.routes.ts`:

1. **Add `guest_author` to the POST preHandler** — change `authorize(['primary_parent', 'secondary_caregiver'])` to `authorize(['primary_parent', 'secondary_caregiver', 'guest_author'])` for the `POST /v1/heart-notes` route only. (PATCH and GET routes: check whether `guest_author` needs to be added — the author of a note must be able to schedule/cancel their own note via PATCH. Add `guest_author` to the PATCH preHandler as well.)

2. **Cap enforcement for `guest_author` role only:**
   - When `request.user.role === 'guest_author'`:
     - Call `heartNoteRepo.countAuthoredThisMonth(request.user.id, request.user.household_id)`
     - If `notesUsed >= 2`:
       - **Allow** if `body.scheduled_for` is in a **different calendar month** from today (i.e., next month). This is the "Save for July 1" escape hatch.
       - **Reject** with HTTP 422, error code `'GUEST_AUTHOR_CAP_REACHED'`, message `'Monthly note cap reached. Schedule for next month to continue.'`

3. **Primary parent / secondary caregiver are unaffected** — no cap check for their role.

The 422 shape must match the existing contract error envelope. Check `apps/api/src/common/errors.ts` for the existing error class hierarchy.

### AC5 — `GET /v1/guest-author/cap` endpoint

New Fastify plugin file `apps/api/src/modules/guest-author/guest-author.routes.ts`.

```typescript
fastify.get('/v1/guest-author/cap', {
  schema: { response: { 200: GuestAuthorCapResponseSchema } },
  preHandler: [authorize(['guest_author'])],
}, async (request, reply) => {
  // ... service call
});
```

**Service logic** (inline or in a thin service file — keep it small):

1. Fetch the household's first child:
   ```sql
   SELECT id, name FROM children WHERE household_id = $householdId ORDER BY created_at ASC LIMIT 1
   ```
   If no child found, return 404 `'no child found in household'`.

2. Fetch the calling user's `display_name`:
   ```sql
   SELECT display_name FROM users WHERE id = $userId
   ```

3. Count `notesUsed` via `heartNoteRepo.countAuthoredThisMonth(userId, householdId)`.

4. Compute `grandparent_term`:
   ```typescript
   const FAMILY_TERMS = ['nani', 'dadi', 'lola', 'bibi'] as const;
   const term = FAMILY_TERMS.find(t => displayName?.toLowerCase().includes(t)) ?? null;
   const grandparent_term = term ? displayName.match(new RegExp(term, 'i'))?.[0] ?? null : null;
   ```
   This preserves the original case from `display_name` (e.g., "Nani" not "nani").

5. Compute `next_month_opens`:
   ```typescript
   // First weekday (Mon–Fri) of next calendar month (UTC dates)
   function nextMonthFirstWeekday(now: Date): string {
     const year = now.getUTCFullYear();
     const month = now.getUTCMonth(); // 0-indexed
     const firstOfNext = new Date(Date.UTC(year, month + 1, 1));
     const dow = firstOfNext.getUTCDay(); // 0=Sun, 6=Sat
     const daysToAdd = dow === 0 ? 1 : dow === 6 ? 2 : 0;
     firstOfNext.setUTCDate(firstOfNext.getUTCDate() + daysToAdd);
     return firstOfNext.toISOString().split('T')[0]!;
   }
   ```

6. Return `GuestAuthorCapResponseSchema`-shaped object.

**Register the plugin** in `apps/api/src/server.ts` (or wherever other route plugins are registered). Check the existing pattern for loading route plugins (e.g., how `heart-note.routes.ts` is registered) and follow it exactly.

### AC6 — Grandparent route: `/guest-author/compose`

**New file `apps/web/src/routes/(grandparent)/compose.tsx`.**

This is the grandparent composer page:

```typescript
export default function GrandparentComposePage() {
  // fetches GET /v1/guest-author/cap
  // renders <HeartNoteComposer> with the cap data
}
```

**Register the route in `apps/web/src/app.tsx`:**

```typescript
import GrandparentScopeLayout from './routes/(grandparent)/layout.js';
import GrandparentComposePage from './routes/(grandparent)/compose.js';

// Add to the router alongside the existing AppLayout-wrapped routes:
{
  element: <GrandparentScopeLayout />,
  children: [
    { path: '/guest-author/compose', element: <GrandparentComposePage /> },
  ],
},
```

The `GrandparentScopeLayout` already exists at `apps/web/src/routes/(grandparent)/layout.tsx` and calls `useScope('grandparent-scope')`. No changes needed to it.

**Page boot sequence:**
1. On mount: `GET /v1/guest-author/cap` → set cap state
2. If the fetch fails with 401 → redirect to `/auth/login?next=/guest-author/compose`
3. If `notesUsed < cap` → render composer in writable state
4. If `notesUsed >= cap` → render at-cap state (read-only textarea + rhythm copy + schedule affordance)

**Data fetching pattern:** Follow the `useEffect` + `hkFetch` pattern used in other routes (e.g., `heart-note.tsx`). Do NOT use `useQuery`. Parse the response with `GuestAuthorCapResponseSchema.parse()`.

### AC7 — `<HeartNoteComposer>` component (`.grandparent-scope`)

**New file `apps/web/src/features/grandparent/HeartNoteComposer.tsx`.**

```typescript
interface HeartNoteComposerProps {
  childId:         string;
  childName:       string;
  grandparentName: string;
  grandparentTerm: string | null;  // null → no sacred-plum underline
  notesUsed:       number;
  cap:             number;
  nextMonthOpens:  string;         // YYYY-MM-DD
}
```

**States (driven by `notesUsed` relative to `cap`):**

| State | Condition | Textarea | Cap counter color | Extra UI |
|---|---|---|---|---|
| `empty` | `notesUsed < cap`, no draft content yet | Editable, placeholder | Default `text-fg-muted` | — |
| `writing` | `notesUsed < cap`, content present | Editable | Default `text-fg-muted` | Character count |
| `at-soft-cap` | `notesUsed === cap - 1` (1 remaining) | Editable | `text-amber` (honey-amber) | Counter warns |
| `at-hard-cap` | `notesUsed >= cap` | **Read-only** | `text-safety-red` | Rhythm copy + schedule affordance |

**Typography (DESIGN.md):**
- Textarea: `font-serif text-[26px] leading-relaxed` (Instrument Serif 26pt)
- Body: 18px minimum per `.grandparent-scope` rules (SCOPE_CHARTER.md)
- Touch targets: 56px minimum

**Cap counter anatomy (when `notesUsed < cap`):**
```
Note [notesUsed + 1] of [cap] this month
```
Displayed as a small label above or below the textarea. Color:
- `notesUsed === 0`: `text-fg-muted` (neutral)
- `notesUsed === cap - 1`: `text-amber` (honey-amber — at-soft-cap warning)

**Send affordance (when writable):**
Use `"Tuck into [childName]'s Thursday lunch"` (not "Send"). The day of week in the affordance text uses the next school day (Mon–Fri) from today:
```typescript
const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
function nextSchoolDay(): string {
  const d = new Date();
  const dow = d.getDay(); // 0=Sun, 6=Sat
  const add = dow === 0 ? 1 : dow === 5 ? 3 : dow === 6 ? 2 : 1;
  d.setDate(d.getDate() + add);
  return DAYS[d.getDay()]!;
}
```
Example output: `"Tuck into Ayaan's Thursday lunch"`

**On submit (writable state):**
- `POST /v1/heart-notes` with `{ child_id, content }`
- Parse response with `HeartNotePayloadSchema`
- On success: show "Sent ✓" confirmation state (static text, no confetti, no animation)
- On 422 `GUEST_AUTHOR_CAP_REACHED`: transition to at-hard-cap state (reload cap data)

### AC8 — At-cap state: rhythm copy + schedule affordance

When `notesUsed >= cap`, the composer renders (full render — not collapsed):

1. **Rhythm copy** (read-only, Instrument Serif, prominent):
   ```
   [childName] has both of your notes this month[, [grandparentTerm]].
   The next one opens [formatted nextMonthOpens].
   ```
   - Include `, [grandparentTerm]` only when `grandparentTerm` is non-null.
   - `grandparentTerm` is underlined in `text-sacred` (sacred-plum) — see AC9.
   - Date formatting for `nextMonthOpens`: `"1 July"` format (day + month name, no year) using `Intl.DateTimeFormat`.

   Example:
   > Ayaan has both of your notes this month, **Nani**.
   > The next one opens 1 July.

2. **Textarea**: read-only, existing draft content shown if any, `opacity-50 cursor-not-allowed` visual.

3. **"Save for [month shortname] 1" affordance** — a primary button below the rhythm copy:
   - Label: `"Save for [shortMonthName] 1"` (e.g., "Save for Jul 1")
   - On click: `POST /v1/heart-notes` with `{ child_id, content: '', scheduled_for: nextMonthOpens }`
     - Content is empty string (grandparent can then edit the draft once the month rolls over — or compose fresh)
     - Wait: actually the note should include whatever they've typed. BUT if they're at-hard-cap, the textarea is read-only and they can't type. So the schedule affordance creates an empty draft for next month, then transitions to a "Scheduled for [date]" confirmation.
     - On success: show confirmation `"Saved for [formatted date]. You'll be able to write your note then."` — static, warm, unhurried.
   - On 422: show `"Something went wrong. Please try again."` below the button.

4. **The cap counter label** turns `text-safety-red`: `"Both notes used this month"` (instead of the count format).

### AC9 — Cultural recognition: sacred-plum underline

When `grandparentTerm` is non-null (e.g., `"Nani"`), that word appears in the rhythm copy (AC8) underlined with sacred-plum styling.

Implementation: render the rhythm copy as a React element with `<span>` wrapping the term:

```typescript
function TermHighlight({ name }: { readonly name: string }) {
  return (
    <span className="underline decoration-sacred decoration-2 underline-offset-2">
      {name}
    </span>
  );
}
```

- `text-sacred` / `decoration-sacred` is the existing sacred-plum token (same as used in `StationeryCard`'s `TO [NAME]` line which uses `text-sacred`).
- Apply underline, NOT color change — the text color stays as the surrounding paragraph color.
- The underline appears in the rhythm copy sentence only, not in the textarea.

If `grandparentTerm` is null, the rhythm copy omits the name address entirely (no `", [name]."` clause).

### AC10 — Dev-mode scope guard

At the top of `HeartNoteComposer`, add:

```typescript
import { useScopeGuard } from '@hivekitchen/ui';

// Inside the component:
useScopeGuard('grandparent-scope'); // throws in dev if scope class absent on <html>
```

This implements UX-DR22: "Dev-mode assertion throws if rendered outside `.grandparent-scope`."

Check whether `useScopeGuard` is exported from `@hivekitchen/ui` before writing the import. If it's not yet exported (check `packages/ui/src/index.ts`), you may need to add the export — but do NOT create the hook itself if it doesn't exist (that's Epic 1 scope); instead omit the guard and note it as a deferred item.

### AC11 — Unit and endpoint tests

**`apps/api/src/modules/heart-notes/heart-note.repository.test.ts`** (additions):
- `countAuthoredThisMonth`: 0 notes → 0; 2 active notes this month → 2; 1 cancelled note → 0 (cancelled excluded); note from last month → 0; note from this month → 1

**`apps/api/src/modules/guest-author/guest-author.routes.test.ts`** (new file):
- `GET /v1/guest-author/cap` with `primary_parent` role → 403
- `GET /v1/guest-author/cap` with `guest_author`, no children in household → 404
- `GET /v1/guest-author/cap` with `guest_author`, 1 child → 200, valid `GuestAuthorCapResponseSchema`
- `notes_used` reflects count from mock repo
- `grandparent_term` detected from display_name "Nani Ayaan" → `"Nani"`
- `grandparent_term` = null for display_name "Mary Smith"
- `next_month_opens` is always a weekday (Mon–Fri)

**`apps/api/src/modules/auth/invite.service.test.ts`** (addition):
- `redeemInvite` with `role: 'guest_author'` → `scope_target: '/guest-author/compose'`
- `redeemInvite` with `role: 'secondary_caregiver'` → `scope_target: '/app/household/settings'` (regression check)

**`apps/api/src/modules/heart-notes/heart-note.routes.test.ts`** (additions):
- `POST /v1/heart-notes` with `guest_author` role, `notesUsed = 0` → 201
- `POST /v1/heart-notes` with `guest_author` role, `notesUsed = 2` → 422 `GUEST_AUTHOR_CAP_REACHED`
- `POST /v1/heart-notes` with `guest_author` role, `notesUsed = 2`, `scheduled_for = next_month_date` → 201 (cap bypass)
- `POST /v1/heart-notes` with `primary_parent` role → 201 regardless of `notesUsed` (no cap check)

**No web component tests required** in this slice — the component logic (state machine, term detection) is exercised through the API tests and the cap state is server-driven.

### AC12 — Typecheck and existing tests unaffected

`pnpm typecheck`: no new errors (API + web at pre-existing baselines).
All existing heart-note, lunch-link, children, and invite tests must pass.

---

## Demo Path

1. **Set up a grandparent invite:** As `primary_parent`, generate a `guest_author` invite (via existing invite mechanism or directly insert into `invites` table). The `role` must be `'guest_author'`.
2. **Redeem the invite:** Open `/invite/{token}` — confirm it redirects to `/guest-author/compose` (not `/app/household/settings`).
3. **First note:** On `/guest-author/compose`, see the composer with textarea + cap counter "Note 1 of 2 this month" in default color. Type a message → "Tuck into [child]'s [day] lunch" button. Click → see "Sent ✓".
4. **Second note:** Navigate back to `/guest-author/compose`. Cap counter shows "Note 2 of 2 this month" in honey-amber (at-soft-cap). Write and send a second note.
5. **Third attempt (at-cap):** Navigate back. See the at-hard-cap state:
   - Rhythm copy: "Ayaan has both of your notes this month, Nani. The next one opens 1 July." (with "Nani" underlined in sacred-plum if applicable)
   - Textarea: read-only, faded
   - "Save for Jul 1" button
6. **Schedule for next month:** Click "Save for Jul 1" → confirm note is created with `scheduled_for = '2026-07-01'` in Supabase. See confirmation copy.
7. **Confirm cap bypass:** `POST /v1/heart-notes` with `scheduled_for` in next month returns 201 even with 2 notes used this month.

---

## Critical Guardrails

**`guest_author` role is real and handled by the existing authenticate hook.**
`SKIP_PREFIXES` in `authenticate.hook.ts` does NOT skip `/v1/guest-author/...` — these routes require a valid JWT with `role: 'guest_author'`. No change needed to the authenticate hook.

**The `authorize(['guest_author'])` preHandler does NOT exist yet for these routes.**
Check `apps/api/src/middleware/authorize.hook.ts` to confirm `'guest_author'` is a valid role string in the `authorize` helper. It is — `types/fastify.d.ts` and `authenticate.hook.ts` both define the role union. No changes needed to `authorize.hook.ts`.

**Cap is per-user per-month, NOT per-household.**
A household with one grandparent who used 2 notes is at cap. A second grandparent in the same household has their own independent cap. Count by `author_user_id`, not `household_id`.

**Cancelled notes do NOT count against the cap.**
A grandparent who created and then cancelled a note still has that slot free. The `countAuthoredThisMonth` query must filter out `status = 'cancelled'`.

**Never return 422 for `primary_parent` or `secondary_caregiver`.**
The cap enforcement guard must be guarded by `request.user.role === 'guest_author'`. Primary parents composing notes see no cap. A missing role check would break the existing compose flow.

**The "Save for next month" bypass only applies when `scheduled_for` is in a DIFFERENT calendar month.**
If the grandparent somehow submits with `scheduled_for` in the current month (UI bug or manual API call), the cap still applies. Compare: `new Date(body.scheduled_for).getUTCMonth() !== new Date().getUTCMonth() || new Date(body.scheduled_for).getUTCFullYear() !== new Date().getUTCFullYear()`.

**Family-language detection is display_name–based, not message-content based.**
The sacred-plum underline appears on the grandparent's name/term in the system-rendered rhythm copy, NOT inside the heart note content. Never apply text transforms to the Heart Note content itself (sacred-channel doctrine, FR38/FR39).

**`useScopeGuard` throws in dev if scope class absent — verify the layout sets it.**
`GrandparentScopeLayout` calls `useScope('grandparent-scope')`, which sets the class on `<html>`. Confirm this before testing `useScopeGuard` inside the component.

**No new DB migration required.**
This slice reads from `heart_notes` (4-S1), `children` (2-S10), and `users` (existing). No schema changes.

**No AI modification of Heart Note content.**
The grandparent composer must NEVER pass content through Lumi or any LLM. The `POST /v1/heart-notes` route already enforces this (no agent call in the handler). Do NOT introduce any agent or LLM call in the grandparent route.

---

## What Already Exists (Do Not Recreate)

**`heart_notes` table** — `supabase/migrations/*_heart_notes*.sql`. Schema: `id, household_id, child_id, author_user_id, content (encrypted), status, scheduled_for, delivered_at, cancelled_at, created_at, updated_at`. Already populated by 4-S1 through 4-S6.

**`HeartNoteRepository`** — `apps/api/src/modules/heart-notes/heart-note.repository.ts`. Has `create`, `findById`, `findByChildAndDate`, `listByHousehold`, `deliverScheduled`, `childBelongsToHousehold`. **Add `countAuthoredThisMonth` as a new method — do NOT touch existing methods.**

**`HeartNoteService`** — `apps/api/src/modules/heart-notes/heart-note.service.ts`. `createDraft` and `patchNote`. Do NOT change their signatures. The cap enforcement goes in the **route handler** (pre-service), not in the service, to keep the service ignorant of the role model.

**`heart-note.routes.ts`** — existing POST route uses `authorize(['primary_parent', 'secondary_caregiver'])`. Add `'guest_author'` + cap check as described in AC4. Do not restructure the handler otherwise.

**`InviteService.redeemInvite`** — `apps/api/src/modules/auth/invite.service.ts`. Currently returns `scope_target: '/app/household/settings'` for all roles. Add a role branch as described in AC2. The test at `invite.routes.test.ts:273` asserts `scope_target === '/app/household/settings'` — that test will need updating to use `secondary_caregiver` role explicitly, or add a separate `guest_author` test case.

**`GrandparentScopeLayout`** — `apps/web/src/routes/(grandparent)/layout.tsx`. Exists, calls `useScope('grandparent-scope')`. Import and register as a layout wrapper in `app.tsx`.

**`StationeryCard`** — `apps/web/src/features/heart-note/components/StationeryCard.tsx`. Do NOT reuse `StationeryCard` for the grandparent composer — the grandparent needs different typography (26pt Instrument Serif vs 22px in StationeryCard), different states, and its own cap counter. Build `HeartNoteComposer.tsx` from scratch.

**`authorize` helper** — `apps/api/src/middleware/authorize.hook.ts`. Already accepts `'guest_author'` as a valid role string. No changes needed.

**`hkFetch` / `publicGet`** — `apps/web/src/lib/fetch.ts`. Use `hkFetch` for authenticated requests in `compose.tsx` (the grandparent has a valid JWT session after invite redemption).

**`text-sacred` design token** — confirmed used in `StationeryCard` header (`text-sacred`). Same token for the sacred-plum underline in the rhythm copy.

---

## Tasks

### T1 — Contracts

**T1.1** Create `packages/contracts/src/guest-author.ts` per AC1. Export `GuestAuthorCapResponseSchema`.

**T1.2** Export from `packages/contracts/src/index.ts`.

**T1.3** Add inferred type to `packages/types/src/index.ts`:
```typescript
export type { GuestAuthorCapResponse } from '@hivekitchen/contracts';
```

---

### T2 — Invite service: guest_author redirect

**T2.1** In `apps/api/src/modules/auth/invite.service.ts`, update `redeemInvite`:
```typescript
scope_target: row.role === 'guest_author' ? '/guest-author/compose' : '/app/household/settings',
```

**T2.2** Update `apps/api/src/modules/auth/invite.routes.test.ts` (or `.service.test.ts`) to:
- Assert `guest_author` redemption → `scope_target: '/guest-author/compose'`
- Add explicit `secondary_caregiver` assertion → `scope_target: '/app/household/settings'` (regression check)

---

### T3 — Repository: countAuthoredThisMonth

**T3.1** Add `countAuthoredThisMonth(authorUserId: string, householdId: string): Promise<number>` to `HeartNoteRepository`.

Supabase-js implementation:
```typescript
async countAuthoredThisMonth(authorUserId: string, householdId: string): Promise<number> {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const nextYear = now.getUTCMonth() === 11 ? year + 1 : year;
  const nextMonth = String((now.getUTCMonth() + 2 > 12 ? 1 : now.getUTCMonth() + 2)).padStart(2, '0');
  const monthStart = `${year}-${month}-01T00:00:00Z`;
  const monthEnd = `${nextYear}-${nextMonth}-01T00:00:00Z`;

  const { count, error } = await this.client
    .from('heart_notes')
    .select('id', { count: 'exact', head: true })
    .eq('author_user_id', authorUserId)
    .eq('household_id', householdId)
    .neq('status', 'cancelled')
    .gte('created_at', monthStart)
    .lt('created_at', monthEnd);
  if (error) throw error;
  return count ?? 0;
}
```

**T3.2** Unit tests per AC11 — add to `heart-note.repository.test.ts`.

---

### T4 — Heart-note route: add guest_author + cap enforcement

**T4.1** In `apps/api/src/modules/heart-notes/heart-note.routes.ts`, update the POST preHandler:
```typescript
const requireAuthor = authorize(['primary_parent', 'secondary_caregiver', 'guest_author']);
```

**T4.2** In the POST handler body, add cap enforcement before calling `service.createDraft`:
```typescript
if (request.user.role === 'guest_author') {
  const notesUsed = await repository.countAuthoredThisMonth(
    request.user.id,
    request.user.household_id,
  );
  if (notesUsed >= GUEST_AUTHOR_CAP) {
    // Cap bypass: allow if scheduled_for is in a different calendar month
    const scheduledFor = (request.body as CreateHeartNoteBody).scheduled_for;
    if (!isNextMonthOrLater(scheduledFor)) {
      throw new UnprocessableError('Monthly note cap reached. Schedule for next month to continue.', 'GUEST_AUTHOR_CAP_REACHED');
    }
  }
}
```

Where:
```typescript
const GUEST_AUTHOR_CAP = 2;

function isNextMonthOrLater(isoDate: string | undefined | null): boolean {
  if (!isoDate) return false;
  const now = new Date();
  const target = new Date(isoDate);
  return (
    target.getUTCFullYear() > now.getUTCFullYear() ||
    (target.getUTCFullYear() === now.getUTCFullYear() && target.getUTCMonth() > now.getUTCMonth())
  );
}
```

Check whether `UnprocessableError` exists in `apps/api/src/common/errors.ts`. If not, use the closest existing class (likely `ConflictError` or create a new `UnprocessableError` extending `FastifyError` with status 422). Check the file before deciding.

**T4.3** Update PATCH preHandler to include `guest_author` so they can schedule/update their own drafted note:
```typescript
const requireMember = authorize(['primary_parent', 'secondary_caregiver', 'guest_author']);
```
But add a guard: `guest_author` may only PATCH notes they authored. Check if `existing.author_user_id === request.user.id` (or `request.user.household_id` match). The existing `patchNote` service already filters by `householdId`, so a grandparent can only reach notes in their household — this is sufficient for this slice.

**T4.4** Add endpoint tests per AC11.

---

### T5 — Guest-author routes: GET /v1/guest-author/cap

**T5.1** Create `apps/api/src/modules/guest-author/guest-author.routes.ts` per AC5.

The routes plugin needs access to `HeartNoteRepository` (for `countAuthoredThisMonth`) and the Supabase client (for `children` + `users` queries). Keep the inline queries thin — no separate repository needed.

```typescript
// inline child + user fetches (too simple to warrant separate repos)
const { data: childData } = await fastify.supabase
  .from('children')
  .select('id, name')
  .eq('household_id', request.user.household_id)
  .order('created_at', { ascending: true })
  .limit(1)
  .maybeSingle();
if (!childData) return reply.status(404).send({ error: 'no child found' });

const { data: userData } = await fastify.supabase
  .from('users')
  .select('display_name')
  .eq('id', request.user.id)
  .single();
const displayName = userData?.display_name ?? 'Guest';

const notesUsed = await heartNoteRepo.countAuthoredThisMonth(
  request.user.id,
  request.user.household_id,
);
```

**T5.2** Register the plugin in `apps/api/src/server.ts`. Search for `heartNoteRoutesPlugin` or similar to find how existing route plugins are registered and follow the same pattern.

**T5.3** Add endpoint tests per AC11.

---

### T6 — Web: Grandparent compose route

**T6.1** Create `apps/web/src/routes/(grandparent)/compose.tsx`.

Boot sequence:
```typescript
export default function GrandparentComposePage() {
  const [cap, setCap] = useState<GuestAuthorCapResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await hkFetch<unknown>('/v1/guest-author/cap', { method: 'GET' });
        if (cancelled) return;
        setCap(GuestAuthorCapResponseSchema.parse(raw));
      } catch {
        if (cancelled) return;
        setError('Could not load your composer. Please try again.');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (error) return <main className="..."><p role="alert">{error}</p></main>;
  if (!cap) return <main className="..."><p className="font-serif text-lg text-fg-muted">Loading…</p></main>;

  return (
    <main className="flex min-h-screen flex-col items-center px-6 py-12">
      <div className="w-full max-w-[640px]">
        <HeartNoteComposer
          childId={cap.child_id}
          childName={cap.child_name}
          grandparentName={cap.grandparent_name}
          grandparentTerm={cap.grandparent_term}
          notesUsed={cap.notes_used}
          cap={cap.cap}
          nextMonthOpens={cap.next_month_opens}
        />
      </div>
    </main>
  );
}
```

Single-column layout — `.grandparent-scope` is always single-column (SCOPE_CHARTER.md). Max-width 640px. No sidebar, no aside.

**T6.2** Register the route in `apps/web/src/app.tsx`:
- Import `GrandparentScopeLayout` and `GrandparentComposePage`
- Add a new route group in the router with `element: <GrandparentScopeLayout />` and child `{ path: '/guest-author/compose', element: <GrandparentComposePage /> }`

---

### T7 — Web: HeartNoteComposer component

**T7.1** Create `apps/web/src/features/grandparent/HeartNoteComposer.tsx` per AC7 and AC8.

Internal state:
```typescript
const [content, setContent] = useState('');
const [saveState, setSaveState] = useState<'idle' | 'saving' | 'sent' | 'scheduled' | 'error'>('idle');
const [isSaving, setIsSaving] = useState(false);
```

Cap state derivation:
```typescript
const isAtCap = notesUsed >= cap;
const isAtSoftCap = !isAtCap && notesUsed === cap - 1;
```

Scope guard:
```typescript
// Check packages/ui/src/index.ts for export before using:
// import { useScopeGuard } from '@hivekitchen/ui';
// useScopeGuard('grandparent-scope');
```

**T7.2** Implement the at-cap layout per AC8:
- Rhythm copy as React element with conditional `TermHighlight` wrapper
- "Save for [month] 1" button calls `POST /v1/heart-notes` with `scheduled_for = nextMonthOpens`
- On success → render scheduled confirmation

**T7.3** `TermHighlight` subcomponent per AC9:
```typescript
function TermHighlight({ name }: { readonly name: string }) {
  return (
    <span className="underline decoration-sacred decoration-2 underline-offset-2">
      {name}
    </span>
  );
}
```

Check that `decoration-sacred` is a valid Tailwind class in this project. If not, use `[text-decoration-color:var(--sacred)]` inline style for the underline color. Do NOT use raw hex — always reference the design token.

**T7.4** DESIGN.md compliance:
- Textarea: `font-serif text-[26px] leading-relaxed` (Instrument Serif 26pt — matches UX-DR22)
- Body text: `text-[18px]` minimum (`.grandparent-scope` typography rule)
- Touch targets: 56px minimum for the send/schedule buttons (`h-14 min-h-[56px]`)
- Warm-neutral surface: `bg-surface rounded-[--r-lg]` wrapping card

**T7.5** Format `nextMonthOpens` for display:
```typescript
function formatMonthDay(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long' })
    .format(new Date(year ?? 0, (month ?? 1) - 1, day ?? 1));
  // e.g. "1 July"
}

function formatShortMonthDay(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' })
    .format(new Date(year ?? 0, (month ?? 1) - 1, day ?? 1));
  // e.g. "1 Jul" — for button label
}
```

---

### T8 — Final Verification

**T8.1** `pnpm typecheck` — no new errors.

**T8.2** `pnpm --filter @hivekitchen/api test -- guest-author` — new tests pass.

**T8.3** `pnpm --filter @hivekitchen/api test -- heart-note` — cap enforcement + repository tests pass; existing tests unaffected.

**T8.4** `pnpm --filter @hivekitchen/api test -- invite` — `scope_target` regression tests pass.

**T8.5** `pnpm --filter @hivekitchen/web test` — all web tests pass (374+ green).

**T8.6** Manual demo path per Demo Path section above.

---

## Project Structure Notes

**New files:**
- `packages/contracts/src/guest-author.ts`
- `apps/api/src/modules/guest-author/guest-author.routes.ts`
- `apps/api/src/modules/guest-author/guest-author.routes.test.ts`
- `apps/web/src/routes/(grandparent)/compose.tsx`
- `apps/web/src/features/grandparent/HeartNoteComposer.tsx`

**Modified files:**
- `packages/contracts/src/index.ts` — export `guest-author.js`
- `packages/types/src/index.ts` — `GuestAuthorCapResponse` type export
- `apps/api/src/modules/auth/invite.service.ts` — role-based `scope_target`
- `apps/api/src/modules/auth/invite.routes.test.ts` (or `.service.test.ts`) — updated `scope_target` assertions
- `apps/api/src/modules/heart-notes/heart-note.repository.ts` — add `countAuthoredThisMonth`
- `apps/api/src/modules/heart-notes/heart-note.repository.test.ts` — new count tests
- `apps/api/src/modules/heart-notes/heart-note.routes.ts` — add `guest_author` to POST/PATCH + cap enforcement
- `apps/api/src/modules/heart-notes/heart-note.routes.test.ts` — new cap enforcement tests
- `apps/api/src/server.ts` — register `guestAuthorRoutesPlugin`
- `apps/web/src/app.tsx` — register grandparent route group

**Not modified:**
- `apps/api/src/middleware/authenticate.hook.ts` — no changes needed
- `apps/api/src/middleware/authorize.hook.ts` — no changes needed (already handles `guest_author`)
- `apps/api/src/modules/heart-notes/heart-note.service.ts` — service stays ignorant of role model
- `apps/web/src/routes/(grandparent)/layout.tsx` — already correct
- `apps/web/src/features/heart-note/` — parent-scope components untouched
- `supabase/migrations/` — no new migration

---

## Task Completion Checklist

- [x] T1.1 — `GuestAuthorCapResponseSchema` created in `packages/contracts/src/guest-author.ts`
- [x] T1.2 — Exported from contracts index
- [x] T1.3 — `GuestAuthorCapResponse` type exported from types index
- [x] T2.1 — `invite.service.ts` returns `/guest-author/compose` for `guest_author` role
- [x] T2.2 — Invite tests assert both `guest_author` and `secondary_caregiver` `scope_target`
- [x] T3.1 — `HeartNoteRepository.countAuthoredThisMonth` implemented
- [x] T3.2 — Repository count tests: empty/active/cancelled/last-month variants (+ by-author)
- [x] T4.1 — `guest_author` added to POST preHandler (via `requireAuthor`)
- [x] T4.2 — Cap enforcement guard in POST handler (bypass for next-month `scheduled_for`)
- [x] T4.3 — `guest_author` added to PATCH preHandler (via `requireAuthor`)
- [x] T4.4 — Heart-note route tests: guest_author cap enforcement cases
- [x] T5.1 — `apps/api/src/modules/guest-author/guest-author.routes.ts` created
- [x] T5.2 — Plugin registered in `apps/api/src/app.ts` (the actual route-registration site; `server.ts` only calls `buildApp`)
- [x] T5.3 — `GET /v1/guest-author/cap` tests: auth, no-child, 200 shape, term detection, weekday check
- [x] T6.1 — `apps/web/src/routes/(grandparent)/compose.tsx` created
- [x] T6.2 — Route registered in `apps/web/src/app.tsx` under `GrandparentScopeLayout`
- [x] T7.1 — `HeartNoteComposer.tsx` created with cap state machine + send flow
- [x] T7.2 — At-cap: rhythm copy + "Save for [month] 1" affordance + schedule POST
- [x] T7.3 — `TermHighlight` subcomponent with sacred-plum underline
- [x] T7.4 — DESIGN.md compliance: 26pt serif, 56px touch targets (`PrimaryButton size="lg"`), warm neutrals
- [x] T7.5 — Date formatters for rhythm copy + button label
- [x] T8.1–T8.5 — Typecheck (zero new errors) + all new tests pass + existing suites unaffected
- [ ] T8.6 — Manual demo path — DEFERRED: requires running stack + live Supabase (user-side gate)

### Review Findings (AI)

- [x] [Review][Patch] GUEST_AUTHOR_CAP = 2 duplicated in heart-note.routes.ts and guest-author.routes.ts [`apps/api/src/modules/heart-notes/heart-note.routes.ts:459`, `apps/api/src/modules/guest-author/guest-author.routes.ts:10`] — fixed: exported from heart-note.routes.ts, imported in guest-author.routes.ts
- [x] [Review][Defer] API-level cap bypass allows creating multiple future-month drafts [`apps/api/src/modules/heart-notes/heart-note.routes.ts:509`] — deferred, pre-existing design constraint; UI prevents multi-bypass, API does not; out of scope for this slice

---

## References

- [Source: `_bmad-output/planning-artifacts/epic-4-vertical-slices.md` §Slice 4-S13]
- [Source: `_bmad-output/planning-artifacts/epics.md` §Story 4.10 — FR40 partial, UX-DR22]
- [Source: `docs/DESIGN.md`] — token system, `.grandparent-scope` spec, `text-sacred` token, honey-amber rule
- [Source: `packages/design-system/SCOPE_CHARTER.md`] — `.grandparent-scope` route prefix, component inventory, `useScopeGuard` reference
- [Source: `apps/api/src/modules/heart-notes/heart-note.repository.ts`] — `HeartNoteRow`, `countAuthoredThisMonth` addition target
- [Source: `apps/api/src/modules/heart-notes/heart-note.routes.ts`] — existing POST preHandler, `authorize` pattern
- [Source: `apps/api/src/modules/heart-notes/heart-note.service.ts`] — `createDraft` signature (unchanged)
- [Source: `apps/api/src/modules/auth/invite.service.ts`] — `redeemInvite` + `scope_target` change target
- [Source: `apps/api/src/middleware/authorize.hook.ts`] — `authorize` helper, `guest_author` already in role union
- [Source: `apps/web/src/routes/(grandparent)/layout.tsx`] — `GrandparentScopeLayout`, `useScope('grandparent-scope')`
- [Source: `apps/web/src/routes/invite/$token.tsx`] — navigates to `result.scope_target`
- [Source: `apps/web/src/app.tsx`] — router registration pattern for layout-wrapped route groups
- [Source: `apps/web/src/features/heart-note/components/StationeryCard.tsx`] — existing `text-sacred` usage (do not reuse directly — build `HeartNoteComposer` fresh)
- [Source: `apps/api/src/common/errors.ts`] — error class hierarchy (check for `UnprocessableError` / 422 class before creating)
- [PRD FR40] — Grandparent Guest Author Heart Note authoring permission rate-limited to a capped frequency
- [UX-DR22] — `<HeartNoteComposer>` `.grandparent-scope`: 26pt serif, cap counter, at-cap rhythm copy, sacred-plum family-language underline, dev-mode assertion

---

## Previous Story Intelligence (from 4-S12)

From the 4-S12 implementation record, the following patterns apply here:

1. **React router is `react-router-dom` with `createBrowserRouter`** — NOT TanStack Router. Routes registered in `app.tsx`. URL params via `useParams()`.

2. **`hkFetch`/`publicGet` pattern** — authenticated routes use `hkFetch`. The grandparent has a valid JWT session after invite redemption, so `hkFetch` is correct for `/v1/guest-author/cap`.

3. **Tailwind named utilities, not bracket syntax** — use `text-fg`, `text-fg-muted`, `bg-surface`, `text-sacred`, `bg-amber`, `rounded-lg` etc. Do NOT use `text-[--fg]` bracket syntax (the named aliases resolve to the same CSS vars).

4. **`verifyAndFetch` return type confirmed** — `{ status: 'invalid' | 'valid' | 'expired'; householdId; childId; ... }` (not `{ ok, session }`). Not directly relevant to this slice but confirms to check actual method signatures before implementing.

5. **Auth exclusion regex** — the authenticate hook does NOT skip `/v1/guest-author/...`. These routes are correctly auth-gated for `guest_author` JWTs. No regex changes needed.

6. **The `LUNCH_LINK_PASSPORT_RE` pattern** — for reference: if future public sub-routes are added, add a named regex constant to `authenticate.hook.ts`. For this slice, no public routes are added (all grandparent endpoints require a valid JWT).

---

## Dev Agent Record

### Implementation Plan / Decisions

1. **Error model — `GuestAuthorCapReachedError` (422).** The repo had no `UnprocessableError`; the existing 422s (`GuardrailRejectionError`, `SwapGuardrailBlockedError`) are dedicated `DomainError` subclasses, so I followed that pattern instead of inventing a generic `(message, code)` class. The semantic code `GUEST_AUTHOR_CAP_REACHED` is carried by the RFC 7807 `type` slug `/errors/guest-author-cap-reached` (the envelope in `app.ts` has no separate `code` field). The composer detects the cap via HTTP **422** — robust because the grandparent POST can only 422 for this reason.

2. **POST/PATCH authorization — separate `requireAuthor`.** Rather than widening the shared `requireMember` (which also gates the two GET routes), I added a second `authorize([...,'guest_author'])` for POST + PATCH only. The grandparent never needs GET `/v1/heart-notes` (draft) or `/history`; it reads its state via GET `/v1/guest-author/cap`. This matches AC4 precisely and keeps the GET surface caregiver-only.

3. **Route registration site — `app.ts`, not `server.ts`.** AC5/T5.2 say `server.ts`, but `server.ts` only calls `buildApp`; every route plugin is registered in `app.ts`. Registered `guestAuthorRoutes` immediately after `heartNoteRoutes`, following the established pattern.

4. **Web route wiring — direct wrap, not Outlet route-group.** `GrandparentScopeLayout` renders `{children}` (a prop), **not** `<Outlet/>`. AC6's literal route-group form (`element: <GrandparentScopeLayout/>` + `children: [...]`) would have rendered nothing against this layout. Honoring "no changes to the layout," I wrapped the page directly: `element: <GrandparentScopeLayout><GrandparentComposePage/></GrandparentScopeLayout>`. Same scope-class behaviour, page actually renders.

5. **Button reuse — `PrimaryButton size="lg"`.** Reused the canonical CTA primitive (`bg-amber-warm text-bg`, `w-full min-h-[56px]`) instead of hand-rolling button classes. This satisfies the Honey rule (DESIGN.md §7 — primary CTAs are amber, never sacred-plum) and the 56px touch-target rule in one move. `SendIcon` for the writable affordance, `CalendarIcon` for "Save for …", `CheckCircleIcon` for confirmations.

6. **Cap-bypass mid-session.** If a POST is rejected 422 while the composer is in writable state (cap filled in another tab), the component flips `effectiveNotesUsed → cap`, transitioning into the at-cap rhythm view without a re-fetch (all needed copy — child name, term, next-open date — is already in props).

7. **Child name is plaintext.** Verified `children.name` is stored plaintext (lunch-link's `findChildName` and `DecryptedChildRow.name: string` return it directly), so AC5's inline `SELECT id, name` returns a usable name — no DEK needed. `countAuthoredThisMonth` is count-only, so its repo is constructed with a `null` key.

### Completion Notes

- All 11 implementation ACs (AC1–AC11) satisfied; AC12 (typecheck/regression) verified — zero new errors, no new test failures.
- **New tests (all green):** repository `countAuthoredThisMonth` ×6 (empty / 2-active / cancelled-excluded / last-month / single / by-author), heart-note route cap enforcement ×4 (under-cap 201 / at-cap 422 / next-month bypass 201 / primary-parent-unbounded 201), `GET /v1/guest-author/cap` ×8 (401 / 403 / 404-no-child / 200-shape / notes_used / term-detect "Nani" / term-null / weekday), invite redeem `guest_author` → `/guest-author/compose` (+ secondary_caregiver regression).
- **Test-harness extensions:** added `.neq()` + `count`-on-await support to the heart-note repository and route mock supabase chains (needed for the `head: true` count query); additive only — existing tests read `.data` and are unaffected.
- **Verification:** `pnpm typecheck` — every error is in an untouched file; the only contracts error (`heart-notes.ts:78`, a Zod-4 `addIssue` typing issue) is pre-existing (confirmed by stashing the change). API suite: my 5 files pass; 19 failing files are the documented pre-existing baseline (auth, catalog, children mock-shape, migration-parity, etc.). Web suite: **374/374**. Contracts suite: 4 pre-existing failures (confirmed pre-existing by stash). Sacred-channel boundary check: **0 violations**.
- **AC10 scope guard:** `useScopeGuard('grandparent-scope')` is exported from `@hivekitchen/ui` and wired into the composer (dev-only `console.error` assertion).
- ⚠️ **T8.6 manual demo path deferred** — needs the running stack + live Supabase (consistent with prior Epic-4 slices). Recommend the reviewer or user walk the demo path against a live environment.

## File List

**New files**
- `packages/contracts/src/guest-author.ts`
- `apps/api/src/modules/guest-author/guest-author.routes.ts`
- `apps/api/src/modules/guest-author/guest-author.routes.test.ts`
- `apps/web/src/routes/(grandparent)/compose.tsx`
- `apps/web/src/features/grandparent/HeartNoteComposer.tsx`

**Modified files**
- `packages/contracts/src/index.ts` — export `./guest-author.js`
- `packages/types/src/index.ts` — re-export `GuestAuthorCapResponse` type
- `apps/api/src/common/errors.ts` — add `GuestAuthorCapReachedError` (422)
- `apps/api/src/modules/auth/invite.service.ts` — role-based `scope_target`
- `apps/api/src/modules/auth/invite.routes.test.ts` — `guest_author` + `secondary_caregiver` `scope_target` assertions
- `apps/api/src/modules/heart-notes/heart-note.repository.ts` — add `countAuthoredThisMonth`
- `apps/api/src/modules/heart-notes/heart-note.repository.test.ts` — count tests + mock `.neq()`/`count` support
- `apps/api/src/modules/heart-notes/heart-note.routes.ts` — `requireAuthor` (guest_author on POST/PATCH) + cap enforcement
- `apps/api/src/modules/heart-notes/heart-note.routes.test.ts` — cap-enforcement tests + mock `.neq()`/`count` support
- `apps/api/src/app.ts` — register `guestAuthorRoutes`
- `apps/web/src/app.tsx` — register `/guest-author/compose` route under `GrandparentScopeLayout`
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — 4-s13 status

## Change Log

| Date | Change |
|------|--------|
| 2026-06-03 | Story 4-S13 created — grandparent composer with at-cap rhythm. Status: ready-for-dev. |
| 2026-06-03 | Implemented AC1–AC11. Contracts (`GuestAuthorCapResponseSchema`), `countAuthoredThisMonth` repo method, guest_author cap enforcement on POST + `GuestAuthorCapReachedError` (422), `GET /v1/guest-author/cap` route, grandparent compose route + `HeartNoteComposer` (writable / soft-cap / at-cap rhythm + sacred-plum term underline). 18 new tests green; zero new typecheck errors; web 374/374; no regressions. T8.6 manual demo deferred (live stack). Status: review. |
