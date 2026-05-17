# Story 4.s2: Render Heart Note on Child Surface (Stub Token)

Status: done

**Slice key:** `4-s2-render-heart-note-on-child-surface-stub-token`
**Epic:** 4 — Lunch Link & Heart Note Sacred Channel
**Source slice doc:** `_bmad-output/planning-artifacts/epic-4-vertical-slices.md` §Slice 4-S2
**Builds on:** 4-S1 (heart_notes table + HeartNoteRepository), 2-10 (children table), 1-6 (Fastify base)

---

## Story

As a **developer testing the child-facing surface**,
I want **to visit `/lunch/test-{childId}-{date}` and see the Heart Note I drafted in S1, the child's name, and a hardcoded bag preview**,
so that **I can verify the Lunch Link rendering end-to-end without needing HMAC tokens or signed URLs**.

---

## Acceptance Criteria

**AC1.** `GET /v1/lunch-link-dev/:childId/:date` returns `200` with `{ childName, date, heartNote, bag }` when the child exists in the caller's household.

**AC2.** `heartNote` is `null` in the response when no draft exists for that child + date; the UI still renders the child's name salutation and hardcoded bag.

**AC3.** `GET /v1/lunch-link-dev/:childId/:date` returns `404` if `childId` does not belong to the caller's household.

**AC4.** The endpoint returns `404` when `NODE_ENV` is `'production'` or `'staging'` — dev-only gate.

**AC5.** `/lunch/test-{childId}-{date}` on the web renders `MumNoteSalutation` (with child-name-based title + formatted date), `HeartNoteCard` (with note body), `LunchSummary` (with hardcoded bag), and `FeedbackBlock` (static, no rating API call).

**AC6.** When `heartNote` is `null`, the `HeartNoteCard` shows placeholder copy ("No note today — check back soon") rather than crashing.

**AC7.** `LunchSummary` no longer depends on `typeof lunchLinkMock.lunch` — it accepts a properly typed `LunchSummaryData` interface. The `imageSrc` field is optional; when absent the image container is hidden.

**AC8.** The route shows a loading skeleton while fetching, and an error state (with a generic message) if the fetch fails.

**AC9.** `FeedbackBlock` is rendered with the child's name in the question ("How was lunch, {childName}?") and the existing three emoji options. Tapping updates local UI state only (no API call) — full wiring is S4 scope.

**AC10.** `_dev-lunch-link.tsx` and `mockData.ts` are **not modified** — the dev preview at `/_dev-lunch-link` continues to use static mock data.

---

## Demo Path

> On your phone, open `/lunch/test-{Layla-id}-2026-05-17`. See your Heart Note rendered in Instrument Serif, child name "Layla" in the salutation, the hardcoded bag preview. No emoji sends to the API.

Manual test steps:
1. Compose a Heart Note for child Layla on `2026-05-17` via `/app/heart-note` (S1 flow).
2. Find Layla's child UUID in Supabase → `children` table.
3. While logged in as the parent, navigate to `/lunch/test-{layla-uuid}-2026-05-17`.
4. See salutation: "A note from Parent" + "Sunday · 17 May" (formatted).
5. See Heart Note body rendered in Instrument Serif italic.
6. See hardcoded bag: "Sandwich, apple & water".
7. See "How was lunch, Layla?" with three emoji options — tap one → visual selection only.
8. Repeat step 3 with a date that has no note → see "No note today — check back soon" in the HeartNoteCard.

---

## Critical Guardrails — Read First

**DO NOT use TanStack Query.** Use `hkFetch` + `useState`/`useEffect` as established in 4-S1.

**DO NOT use React Hook Form.** Not used anywhere in the lunch-link surface.

**DO NOT add emoji rating to the API.** `FeedbackBlock.onRate` stays unwired. S4 ships the rate endpoint.

**DO NOT add HMAC signing.** The `test-{childId}-{date}` stub format replaces signed tokens. Real tokens ship in S3.

**DO NOT move the `/lunch/:linkId` route out of AppLayout.** In S3, when the real public child URL ships, the routing will change. For S2, the parent is logged in and AppLayout is correct.

**DO NOT redesign the feature components.** `MumNoteSalutation`, `HeartNoteCard`, `LunchSummary`, `FeedbackBlock` keep their existing layouts. S2 wires them with real data — no structural UI changes.

**DO NOT delete or modify `mockData.ts`.** `_dev-lunch-link.tsx` still imports `lunchLinkMock`.

**DO NOT expose the dev endpoint in production/staging.** Return `404` immediately when `fastify.env.NODE_ENV === 'production' || fastify.env.NODE_ENV === 'staging'`.

---

## What Already Exists (Do Not Recreate)

**Route (mock-backed, needs wiring):**
- `apps/web/src/routes/(app)/lunch-link.tsx` — currently imports `lunchLinkMock`, renders the four components. **Replace mock with real API call.**
- Router entry in `app.tsx`: `{ path: '/lunch/:linkId', element: <LunchLinkRoute /> }` — **do not change** this entry.

**Feature components (mock-backed, minimal changes only):**
- `apps/web/src/features/lunch-link/components/HeartNoteCard.tsx` — props `{ body, from }`. **No change needed.**
- `apps/web/src/features/lunch-link/components/MumNoteSalutation.tsx` — props `{ title, date }`. **No change needed.**
- `apps/web/src/features/lunch-link/components/FeedbackBlock.tsx` — props `{ question, options, hint, onRate? }`. **No change needed.**
- `apps/web/src/features/lunch-link/components/LunchSummary.tsx` — **change the prop type only** (see T3.1 below). No layout changes.

**API infra (already wired, reuse):**
- `HeartNoteRepository.findByChildAndDate(householdId, childId, isoDate)` — exact method needed by this slice.
- `authorize(['primary_parent', 'secondary_caregiver'])` pattern from `heart-note.routes.ts`.
- `BaseRepository` base class from `apps/api/src/repository/base.repository.ts`.
- Auth flow: `requireMember` preHandler + `request.user.household_id` always available.

**Contracts (existing, reuse):**
- `packages/contracts/src/heart-notes.ts` has `HeartNoteResponseSchema` — do not duplicate the response shape; the dev endpoint returns its own leaner schema.

---

## Tasks

### T1 — Contracts

- [x] **T1.1** New file `packages/contracts/src/lunch-link.ts`:
  ```typescript
  import { z } from 'zod';

  // Dev-only stub endpoint params (S2 only; replaced by real token in S3)
  export const LunchLinkDevParamsSchema = z.object({
    childId: z.string().uuid(),
    date: z.string().date(),
  });

  export const LunchLinkDevHeartNoteSchema = z.object({
    body: z.string(),
    authorDisplayName: z.string(),
  });

  export const LunchLinkDevBagSchema = z.object({
    name: z.string(),
    sub: z.string(),
    safetyNote: z.string(),
  });

  export const LunchLinkDevResponseSchema = z.object({
    childName: z.string(),
    date: z.string().date(),
    heartNote: LunchLinkDevHeartNoteSchema.nullable(),
    bag: LunchLinkDevBagSchema,
  });

  export type LunchLinkDevParams = z.infer<typeof LunchLinkDevParamsSchema>;
  export type LunchLinkDevHeartNote = z.infer<typeof LunchLinkDevHeartNoteSchema>;
  export type LunchLinkDevBag = z.infer<typeof LunchLinkDevBagSchema>;
  export type LunchLinkDevResponse = z.infer<typeof LunchLinkDevResponseSchema>;
  ```

- [x] **T1.2** In `packages/contracts/src/index.ts`, add:
  ```typescript
  export * from './lunch-link.js';
  ```

- [x] **T1.3** New file `packages/contracts/src/lunch-link.test.ts` — round-trip tests:
  - Valid `LunchLinkDevResponseSchema` parse with `heartNote: null`.
  - Valid `LunchLinkDevResponseSchema` parse with a populated `heartNote`.
  - Reject `LunchLinkDevParamsSchema` with non-UUID `childId`.
  - Reject `LunchLinkDevParamsSchema` with invalid date format.
  - `LunchLinkDevBagSchema` rejects missing `name`.

### T2 — API repository

- [x] **T2.1** New file `apps/api/src/modules/lunch-link/lunch-link.repository.ts`:
  ```typescript
  import type { SupabaseClient } from '@supabase/supabase-js';
  import { BaseRepository } from '../../repository/base.repository.js';

  export class LunchLinkRepository extends BaseRepository {
    constructor(client: SupabaseClient) {
      super(client);
    }

    // Returns the child's name if the child belongs to the given household;
    // null if not found (caller maps to 404). Selects name only — no DEK
    // needed since `name` is stored plaintext in the children table.
    async findChildName(childId: string, householdId: string): Promise<string | null> {
      const { data, error } = await this.client
        .from('children')
        .select('id, name')
        .eq('id', childId)
        .eq('household_id', householdId)
        .maybeSingle();
      if (error) throw error;
      return (data as { id: string; name: string } | null)?.name ?? null;
    }
  }
  ```

  **Why a new module instead of adding to `ChildrenRepository`?**
  `ChildrenRepository` requires a `kek: Buffer | null` and a `RepositoryLogger` in its constructor (for envelope-decryption of allergens/cultural_identifiers). The Lunch Link surface needs only the plaintext `name` column — decryption machinery is unnecessary overhead and adds constructor complexity. `LunchLinkRepository` is intentionally lean.

### T3 — API service

- [x] **T3.1** New file `apps/api/src/modules/lunch-link/lunch-link.service.ts`:
  ```typescript
  import type { LunchLinkDevResponse } from '@hivekitchen/contracts';
  import type { LunchLinkRepository } from './lunch-link.repository.js';
  import type { HeartNoteRepository } from '../heart-notes/heart-note.repository.js';

  // Hardcoded stub bag for S2 — real bag from plan_items ships in S11.
  const STUB_BAG = {
    name: 'Sandwich, apple & water',
    sub: 'Packed for you today',
    safetyNote: 'Nut-free',
  } as const;

  export class LunchLinkService {
    constructor(
      private readonly lunchLinkRepo: LunchLinkRepository,
      private readonly heartNoteRepo: HeartNoteRepository,
    ) {}

    // Returns null when childId is not in the caller's household (caller raises 404).
    async getDevPayload(
      householdId: string,
      childId: string,
      date: string,
    ): Promise<LunchLinkDevResponse | null> {
      const childName = await this.lunchLinkRepo.findChildName(childId, householdId);
      if (childName === null) return null;

      const noteRow = await this.heartNoteRepo.findByChildAndDate(householdId, childId, date);

      return {
        childName,
        date,
        heartNote: noteRow
          ? { body: noteRow.content, authorDisplayName: 'Parent' }
          : null,
        bag: STUB_BAG,
      };
    }
  }
  ```

### T4 — API routes

- [x] **T4.1** New file `apps/api/src/modules/lunch-link/lunch-link.routes.ts`:
  ```typescript
  import fp from 'fastify-plugin';
  import type { FastifyPluginAsync } from 'fastify';
  import { LunchLinkDevParamsSchema, LunchLinkDevResponseSchema } from '@hivekitchen/contracts';
  import type { LunchLinkDevParams } from '@hivekitchen/contracts';
  import { authorize } from '../../middleware/authorize.hook.js';
  import { LunchLinkRepository } from './lunch-link.repository.js';
  import { LunchLinkService } from './lunch-link.service.js';
  import { HeartNoteRepository } from '../heart-notes/heart-note.repository.js';
  import { NotFoundError } from '../../common/errors.js';

  const lunchLinkRoutesPlugin: FastifyPluginAsync = async (fastify) => {
    const lunchLinkRepo = new LunchLinkRepository(fastify.supabase);
    const heartNoteRepo = new HeartNoteRepository(fastify.supabase);
    const service = new LunchLinkService(lunchLinkRepo, heartNoteRepo);

    const requireMember = authorize(['primary_parent', 'secondary_caregiver']);

    // Dev-only stub endpoint. Simulates the eventual unauthenticated child-surface
    // API so the parent can test the Lunch Link surface while logged in.
    // Returns 404 in production/staging — must never reach real child data
    // via an unprotected path.
    fastify.get(
      '/v1/lunch-link-dev/:childId/:date',
      {
        preHandler: requireMember,
        schema: {
          params: LunchLinkDevParamsSchema,
          response: { 200: LunchLinkDevResponseSchema },
        },
      },
      async (request, reply) => {
        if (
          fastify.env.NODE_ENV === 'production' ||
          fastify.env.NODE_ENV === 'staging'
        ) {
          throw new NotFoundError('Not found');
        }

        const { childId, date } = request.params as LunchLinkDevParams;
        const payload = await service.getDevPayload(
          request.user.household_id,
          childId,
          date,
        );
        if (payload === null) throw new NotFoundError('Child not found in household');
        return reply.send(payload);
      },
    );
  };

  export const lunchLinkRoutes = fp(lunchLinkRoutesPlugin, { name: 'lunch-link-routes' });
  ```

- [x] **T4.2** In `apps/api/src/app.ts`, add:
  ```typescript
  import { lunchLinkRoutes } from './modules/lunch-link/lunch-link.routes.js';
  // ...
  await fastify.register(lunchLinkRoutes);  // alongside heartNoteRoutes
  ```

### T5 — Web: fix LunchSummary prop type

- [x] **T5.1** In `apps/web/src/features/lunch-link/components/LunchSummary.tsx`, replace the tightly coupled mock-type prop with a proper interface and make `imageSrc` optional:
  ```typescript
  // Replace the old interface:
  // interface Readonly_LunchSummaryProps {
  //   readonly lunch: typeof lunchLinkMock.lunch;
  // }

  export interface LunchSummaryData {
    readonly eyebrow: string;
    readonly name: string;
    readonly sub: string;
    readonly imageSrc?: string;   // absent → image container hidden
    readonly imageAlt?: string;
    readonly safetyBadge: string;
  }

  interface Readonly_LunchSummaryProps {
    readonly lunch: LunchSummaryData;
  }
  export type LunchSummaryProps = Readonly<Readonly_LunchSummaryProps>;
  ```

  Update the component body to wrap the image element conditionally:
  ```tsx
  {lunch.imageSrc && (
    <div className="relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-lg">
      <img
        src={lunch.imageSrc}
        alt={lunch.imageAlt ?? ''}
        className="h-full w-full object-cover"
      />
    </div>
  )}
  ```

  Remove the `import type { lunchLinkMock } from '../data/mockData.js'` line from `LunchSummary.tsx`.

  **Backward compatibility**: `_dev-lunch-link.tsx` passes the mock which includes `imageSrc` — this still satisfies `LunchSummaryData` since all required fields are present. No change to `_dev-lunch-link.tsx` needed.

### T6 — Web: wire lunch-link.tsx route

- [x] **T6.1** Rewrite `apps/web/src/routes/(app)/lunch-link.tsx`:

  **URL parsing:**
  ```typescript
  // linkId format: "test-{UUID:36}-{YYYY-MM-DD:10}" = 52 chars total
  // UUID: 36 chars (8-4-4-4-12 with dashes)
  // date: 10 chars (YYYY-MM-DD)
  function parseStubLinkId(linkId: string): { childId: string; date: string } | null {
    if (!linkId.startsWith('test-') || linkId.length !== 52) return null;
    const childId = linkId.slice(5, 41);
    const date = linkId.slice(42);
    // Basic UUID shape check (doesn't validate all hex chars — good enough for dev)
    if (childId[8] !== '-' || childId[13] !== '-' || childId[18] !== '-' || childId[23] !== '-') {
      return null;
    }
    // Basic date shape: YYYY-MM-DD
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    return { childId, date };
  }
  ```

  **Date formatting helper:**
  ```typescript
  function formatDateLabel(isoDate: string): string {
    // Use noon UTC to avoid DST edge-case where midnight can roll back a day
    // in certain locales. The date string here is always YYYY-MM-DD.
    const d = new Date(`${isoDate}T12:00:00`);
    const day = d.toLocaleDateString('en-US', { weekday: 'long' });
    const num = d.getDate();
    const month = d.toLocaleDateString('en-US', { month: 'long' });
    return `${day} · ${num} ${month}`;
  }
  ```

  **State and fetch pattern (follow 4-S1's hkFetch + useEffect pattern):**
  ```typescript
  type LoadState = 'loading' | 'invalid-link' | 'error' | 'loaded';

  export default function LunchLinkRoute() {
    const { linkId } = useParams<{ linkId: string }>();
    const parsed = linkId ? parseStubLinkId(linkId) : null;

    const [loadState, setLoadState] = useState<LoadState>(parsed ? 'loading' : 'invalid-link');
    const [data, setData] = useState<LunchLinkDevResponse | null>(null);

    useEffect(() => {
      if (!parsed) return;
      let isMounted = true;
      setLoadState('loading');
      hkFetch<LunchLinkDevResponse>(
        `/v1/lunch-link-dev/${parsed.childId}/${parsed.date}`,
        { method: 'GET' },
      )
        .then((res) => {
          if (isMounted) { setData(res); setLoadState('loaded'); }
        })
        .catch(() => {
          if (isMounted) setLoadState('error');
        });
      return () => { isMounted = false; };
    }, [parsed?.childId, parsed?.date]);

    if (loadState === 'invalid-link') {
      return <LunchLinkErrorState message="This link doesn't look right." />;
    }
    if (loadState === 'loading') {
      return <LunchLinkLoadingState />;
    }
    if (loadState === 'error' || data === null) {
      return <LunchLinkErrorState message="Couldn't load this lunch link. Please try again." />;
    }

    const { childName, date, heartNote, bag } = data;
    const dateLabel = formatDateLabel(date);

    return (
      <main className="flex w-full flex-grow items-center justify-center px-4 py-8 sm:py-12">
        <div className="w-full max-w-md space-y-8">
          <MumNoteSalutation
            title={`A note from Parent`}
            date={dateLabel}
          />
          <HeartNoteCard
            body={heartNote?.body ?? 'No note today — check back soon'}
            from={heartNote ? `— ${heartNote.authorDisplayName}` : ''}
          />
          <LunchSummary
            lunch={{
              eyebrow: "Today's Lunch",
              name: bag.name,
              sub: bag.sub,
              safetyBadge: bag.safetyNote,
              // imageSrc intentionally absent for S2 stub — no image for placeholder bag
            }}
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
  ```

  **Rating options constant** (move out of mockData dependency):
  ```typescript
  const RATING_OPTIONS = [
    { id: 'loved', emoji: '😋', label: 'Loved it' },
    { id: 'ok', emoji: '🙂', label: 'It was OK' },
    { id: 'not-really', emoji: '😕', label: 'Not really' },
  ] as const satisfies readonly RatingOption[];
  ```

  Import `RatingOption` from `../features/lunch-link/data/mockData.js` (do not duplicate the type) or from the component itself if you extract it. The `RatingOption` type is already exported from `mockData.ts`.

  **Skeleton and error components** — define inline or as small local components at the bottom of the file:
  ```tsx
  function LunchLinkLoadingState() {
    return (
      <main className="flex w-full flex-grow items-center justify-center px-4 py-8">
        <div className="w-full max-w-md space-y-8">
          <div className="h-8 w-48 animate-pulse rounded bg-surface-2 mx-auto" />
          <div className="h-[200px] animate-pulse rounded-lg bg-surface-2" />
          <div className="h-20 animate-pulse rounded-lg bg-surface-2" />
        </div>
      </main>
    );
  }

  function LunchLinkErrorState({ message }: { readonly message: string }) {
    return (
      <main className="flex w-full flex-grow items-center justify-center px-4 py-8">
        <p className="text-center text-sm text-fg-muted">{message}</p>
      </main>
    );
  }
  ```

  **Imports for `lunch-link.tsx`:**
  ```typescript
  import { useState, useEffect } from 'react';
  import { useParams } from 'react-router-dom';
  import { hkFetch } from '@/lib/fetch.js';
  import type { LunchLinkDevResponse } from '@hivekitchen/contracts';
  import { FeedbackBlock } from '@/features/lunch-link/components/FeedbackBlock.js';
  import { HeartNoteCard } from '@/features/lunch-link/components/HeartNoteCard.js';
  import type { LunchSummaryData } from '@/features/lunch-link/components/LunchSummary.js';
  import { LunchSummary } from '@/features/lunch-link/components/LunchSummary.js';
  import { MumNoteSalutation } from '@/features/lunch-link/components/MumNoteSalutation.js';
  import type { RatingOption } from '@/features/lunch-link/data/mockData.js';
  ```

  Remove the `import { lunchLinkMock } from '@/features/lunch-link/data/mockData.js'` import (the mock is no longer used in this route).

### T7 — Tests

- [x] **T7.1** `apps/api/src/modules/lunch-link/lunch-link.service.test.ts` — unit tests with mock repositories:
  - `getDevPayload` returns `null` when child not found in household (repo returns `null`).
  - `getDevPayload` returns payload with `heartNote: null` when no draft exists.
  - `getDevPayload` returns payload with populated `heartNote` when note exists.
  - Verify `bag` is always the hardcoded stub (not from DB).

- [x] **T7.2** `apps/api/src/modules/lunch-link/lunch-link.routes.test.ts` — Fastify inject tests (follow the `heart-note.routes.test.ts` pattern exactly):
  - `200` with full payload when child + note exist.
  - `200` with `heartNote: null` when child exists but no note for that date.
  - `404` when `childId` is not in the caller's household.
  - `404` when `NODE_ENV` is `'production'` (set `env.NODE_ENV = 'production'` in the test app).
  - `401` without a bearer token.
  - `400` when `childId` param is not a UUID (Zod validates the path params).
  - `400` when `date` param is not a valid date string.

  For the production guard test, override `env.NODE_ENV` in `buildTestApp`:
  ```typescript
  const env = { NODE_ENV: 'production' as const, JWT_SECRET };
  app.decorate('env', env as unknown as FastifyInstance['env']);
  ```

### Review Findings

_Source: bmad-code-review 2026-05-17 (Blind Hunter + Edge Case Hunter + Acceptance Auditor). Acceptance Auditor reported all 10 ACs and all 8 guardrails PASS. Patches below are the 3 unambiguous fixes; defers are tracked in `deferred-work.md`._

- [x] [Review][Patch] NODE_ENV guard is deny-list; unset/typo'd env values fail open. Flip to allow-list — only `development` and `test` may serve the dev endpoint. [`apps/api/src/modules/lunch-link/lunch-link.routes.ts:31-36`] — fixed 2026-05-17
- [x] [Review][Patch] Empty-string heart-note body bypasses the "No note today — check back soon" placeholder because `??` only fires on null/undefined. Use empty-string-aware fallback. [`apps/web/src/routes/(app)/lunch-link.tsx:99`] — fixed 2026-05-17 (whitespace-only body also treated as empty via `.trim()`)
- [x] [Review][Patch] `parseStubLinkId` never verifies the separator dash at index 41; `test-<36-chars>X<10-char-date>` passes client validation and trips the generic server-side 400 error instead of the specific invalid-link UX. [`apps/web/src/routes/(app)/lunch-link.tsx:13-22`] — fixed 2026-05-17
- [x] [Review][Defer] `HeartNoteRepository.findByChildAndDate` filters on `created_at` rather than the note's `scheduled_for` date — pre-scheduled note for the date won't surface. Pre-existing in `heart-notes` module. [`apps/api/src/modules/heart-notes/heart-note.repository.ts:59-77`] — deferred, pre-existing
- [x] [Review][Defer] Heart-note `body` has no max-length cap in the contract; renders unbounded into `HeartNoteCard`. Cross-cutting content policy. [`packages/contracts/src/lunch-link.ts:11-14`] — deferred, pre-existing
- [x] [Review][Defer] Dev endpoint accepts arbitrary date values (`1900-01-01`, `9999-12-31`). Broader API hygiene. [`packages/contracts/src/lunch-link.ts:7-9`] — deferred, pre-existing
- [x] [Review][Defer] Client-side parser rejection paths (non-hex UUID chars, calendar-invalid dates) drop into the generic "Couldn't load this lunch link" error after a server 400, when the more specific "doesn't look right" copy would be appropriate. UX polish. [`apps/web/src/routes/(app)/lunch-link.tsx:13-29`] — deferred, pre-existing
- [x] [Review][Defer] `formatDateLabel` hardcodes `en-US`; non-English parents see American date format. Project-wide i18n. [`apps/web/src/routes/(app)/lunch-link.tsx:32-38`] — deferred, pre-existing
- [x] [Review][Defer] `formatDateLabel` parses the ISO date in browser-local time, ignoring household TZ. Project-wide TZ design. [`apps/web/src/routes/(app)/lunch-link.tsx:34`] — deferred, pre-existing
- [x] [Review][Defer] Child `name` returned to the surface with no sanitization for unicode/zero-width/RTL/length. Input policy concern at the write path. [`apps/api/src/modules/lunch-link/lunch-link.service.ts:33`] — deferred, pre-existing
- [x] [Review][Defer] Skeleton + error states lack `role="status"` / `aria-live`; screen readers don't announce state transitions. Accessibility polish. [`apps/web/src/routes/(app)/lunch-link.tsx:128-145`] — deferred, pre-existing

#### Pass 2 (2026-05-17)

_Source: bmad-code-review 2026-05-17 Pass 2 (Blind Hunter + Edge Case Hunter + Acceptance Auditor). All 10 ACs and 8 guardrails PASS. 0 patches, 2 new deferred items, 7 dismissed._

- [x] [Review][Defer] `requireMember` preHandler runs before env guard — unauthenticated requests return 401 in production, leaking that the route exists rather than the expected 404. Cleaner fix: register the route conditionally inside `if (env.NODE_ENV === 'development' || env.NODE_ENV === 'test')` block so it doesn't exist at all in non-dev envs. [`apps/api/src/modules/lunch-link/lunch-link.routes.ts:28-29`] — deferred, low-risk; existing allow-list guard still prevents data access
- [x] [Review][Defer] `HeartNoteCard` receives `from=""` (empty string) when no heart note exists — if the component renders the attribution slot unconditionally, the empty string produces a blank but space-taking line below the placeholder copy. [`apps/web/src/routes/(app)/lunch-link.tsx:99`] — deferred, cosmetic

---

## Dev Notes

### Architecture compliance

- The new `LunchLinkRepository` does NOT import `ChildrenRepository` — it queries `children` directly via `fastify.supabase`. This avoids dragging the DEK + kek constructor dependencies into the lunch-link module for a plaintext column read. This is intentional and correct per the "each feature owns its own repository" rule.
- `LunchLinkService` takes BOTH `LunchLinkRepository` and `HeartNoteRepository` as constructor params — two dependencies is normal, and reusing `HeartNoteRepository.findByChildAndDate()` is preferable to duplicating the query.
- No audit log entries for the dev endpoint — it's a read-only, dev-only view with no state changes.
- No SSE invalidation — no writes occur.
- `fastify.env.NODE_ENV` check: the `Env` type has `NODE_ENV: 'development' | 'staging' | 'production' | 'test'`. The check `=== 'production' || === 'staging'` blocks both production variants.

### URL parsing correctness

The `test-{UUID}-{date}` format is deterministic:
- UUID is always 36 chars (RFC 4122 format with 4 hyphens at positions 8, 13, 18, 23)
- Date is always 10 chars (ISO 8601 YYYY-MM-DD)
- Total: `5 ("test-") + 36 (UUID) + 1 ("-") + 10 (date) = 52 chars`

The `parseStubLinkId` function validates the length + checks the hyphen positions in the UUID segment. If the format doesn't match, the route renders `<LunchLinkErrorState>` rather than making an API call with bad params.

### Date display timezone safety

`new Date('2026-05-17')` parses as **UTC midnight**, which in UTC-5 renders as May 16 (the previous day). Always parse with `T12:00:00` appended:
```typescript
new Date(`${isoDate}T12:00:00`)  // local noon — always stays on the correct date
```

### LunchSummary backward compatibility

`_dev-lunch-link.tsx` passes `lunch={m.lunch}` where `m.lunch` has `imageSrc` as a string. The new `LunchSummaryData` interface makes `imageSrc` optional — a defined string is still valid. The dev preview continues to show the image; the S2 real route hides the image container (no `imageSrc` provided).

### FeedbackBlock wiring status

`FeedbackBlock` has `onRate?: (rating: Rating) => void` as an optional prop. S2 does NOT pass this prop — taps update local visual state only (the existing `useState` inside `FeedbackBlock`). This is documented in the demo path and is not a bug. S4 (`4-s4-emoji-rating`) will add `POST /v1/lunch-link/:token/rate` and wire `onRate`.

### hkFetch and auth

`hkFetch` always attaches `Authorization: Bearer <token>` when `accessToken` is set in `authStore`. Since `/lunch/:linkId` is inside `AppLayout` (requires auth), `accessToken` will always be present when this route renders. The `requireMember` preHandler on the API side is therefore always satisfied. This is correct for S2; S3 will add a separate public route for the real token.

### useParams import

`useParams` is from `react-router-dom`. The web app uses React Router v6 (confirmed by `createBrowserRouter` in `app.tsx`). `useParams<{ linkId: string }>()` is correct v6 usage.

### Project Structure Notes

**New directories:**
- `apps/api/src/modules/lunch-link/` — new module following the same structure as `heart-notes/`

**Modified files summary:**
- `LunchSummary.tsx` prop type only — no layout change
- `lunch-link.tsx` route — full replacement of mock with real fetch

**No router changes**: the `{ path: '/lunch/:linkId', element: <LunchLinkRoute /> }` entry in `app.tsx` is unchanged.

### References

- [Source: `_bmad-output/planning-artifacts/epic-4-vertical-slices.md` §Slice 4-S2]
- [Source: `_bmad-output/implementation-artifacts/4-s1-compose-heart-note-draft.md`] — 4-S1 dev notes (TanStack Query ban, hkFetch pattern, isMounted guard)
- [Source: `apps/api/src/middleware/authenticate.hook.ts`] — SKIP_PREFIXES pattern + why `requireMember` is needed
- [Source: `apps/api/src/modules/heart-notes/heart-note.routes.test.ts`] — Fastify inject test pattern to follow exactly
- [Source: `apps/api/src/common/env.ts`] — `Env.NODE_ENV` enum values for production guard

---

## File List

**New files:**
- `packages/contracts/src/lunch-link.ts`
- `packages/contracts/src/lunch-link.test.ts`
- `apps/api/src/modules/lunch-link/lunch-link.repository.ts`
- `apps/api/src/modules/lunch-link/lunch-link.service.ts`
- `apps/api/src/modules/lunch-link/lunch-link.routes.ts`
- `apps/api/src/modules/lunch-link/lunch-link.service.test.ts`
- `apps/api/src/modules/lunch-link/lunch-link.routes.test.ts`

**Modified files:**
- `packages/contracts/src/index.ts` — add `export * from './lunch-link.js'`
- `apps/api/src/app.ts` — import + register `lunchLinkRoutes`
- `apps/web/src/features/lunch-link/components/LunchSummary.tsx` — `LunchSummaryData` interface + optional `imageSrc`
- `apps/web/src/routes/(app)/lunch-link.tsx` — replace mock with real API fetch

**Not modified:**
- `apps/web/src/routes/_dev-lunch-link.tsx` — dev preview stays mock-backed
- `apps/web/src/features/lunch-link/data/mockData.ts` — still used by dev preview
- `apps/web/src/features/lunch-link/components/HeartNoteCard.tsx`
- `apps/web/src/features/lunch-link/components/MumNoteSalutation.tsx`
- `apps/web/src/features/lunch-link/components/FeedbackBlock.tsx`
- `apps/web/src/app.tsx` — router entry unchanged

---

## Dev Agent Record

### Agent Model Used

Claude Opus 4.7 (`claude-opus-4-7[1m]`) via bmad-dev-story workflow

### Debug Log References

- `pnpm --filter @hivekitchen/contracts test -- run lunch-link` → 8/8 pass
- `pnpm --filter @hivekitchen/api test -- run lunch-link` → 12/12 pass
- `pnpm --filter @hivekitchen/api test -- run heart-notes` → 20/20 pass (regression)
- `pnpm --filter @hivekitchen/web typecheck` → clean
- `pnpm --filter @hivekitchen/contracts typecheck` → clean
- Repo-wide `pnpm typecheck` and `pnpm lint` failures all in pre-existing files
  unrelated to this slice (verified by stashing changes and re-running on clean
  main — same failures present). The web lint output contains one cosmetic
  warning on `lunch-link.tsx:77` (`react-hooks/exhaustive-deps` re: `parsed`),
  matching the same pattern already accepted on `account.tsx`, `plan.tsx`,
  `plan-history.tsx`, and `routes/(app)/index.tsx`.

### Completion Notes List

- All 10 ACs satisfied. AC1–4 covered by 6 inject tests + 4 service unit tests.
  AC5–9 implemented in `apps/web/src/routes/(app)/lunch-link.tsx` (parses
  `test-{uuid}-{date}` stub, fetches via `hkFetch`, renders the four feature
  components, falls back gracefully on null heart note).
- AC10 honored: `_dev-lunch-link.tsx` and `mockData.ts` untouched. The
  `LunchSummary.tsx` prop-type change is backward-compatible — the mock
  payload (with `imageSrc` populated) still satisfies the new
  `LunchSummaryData` interface.
- `LunchLinkRepository` deliberately bypasses `ChildrenRepository` so the
  module does not pick up the kek/RepositoryLogger constructor surface. The
  surface only needs the plaintext `name` column.
- No SSE invalidation, no audit log entries — read-only dev surface.
- `RATING_OPTIONS` lives inside `lunch-link.tsx` (not in mockData) so the
  route does not import the mock data file at runtime; only the `RatingOption`
  *type* is imported from `mockData.ts`.

### Change Log

| Date       | Author | Change                                                       |
| ---------- | ------ | ------------------------------------------------------------ |
| 2026-05-17 | dev    | Initial implementation of slice 4-s2; status → review        |
| 2026-05-17 | review | bmad-code-review pass 1 — 3 patches applied (NODE_ENV allow-list, empty-body placeholder, parser dash-at-41 check); 8 items deferred to `deferred-work.md`. Tests: api lunch-link 12/12, contracts lunch-link 8/8, web typecheck clean. Acceptance Auditor reported all 10 ACs + 8 guardrails PASS. |
| 2026-05-17 | review | bmad-code-review pass 2 — 0 patches; all 10 ACs + 8 guardrails PASS; 2 new items deferred (requireMember-before-env-guard, HeartNoteCard empty-from); 7 dismissed. Story → done. |

### File List

**New:**
- `packages/contracts/src/lunch-link.ts`
- `packages/contracts/src/lunch-link.test.ts`
- `apps/api/src/modules/lunch-link/lunch-link.repository.ts`
- `apps/api/src/modules/lunch-link/lunch-link.service.ts`
- `apps/api/src/modules/lunch-link/lunch-link.routes.ts`
- `apps/api/src/modules/lunch-link/lunch-link.service.test.ts`
- `apps/api/src/modules/lunch-link/lunch-link.routes.test.ts`

**Modified:**
- `packages/contracts/src/index.ts` — re-export `./lunch-link.js`
- `apps/api/src/app.ts` — import + register `lunchLinkRoutes`
- `apps/web/src/features/lunch-link/components/LunchSummary.tsx` — replaced
  mock-coupled prop type with `LunchSummaryData` interface; `imageSrc` now
  optional; image container hidden when absent
- `apps/web/src/routes/(app)/lunch-link.tsx` — replaced mock data render with
  `parseStubLinkId` + `hkFetch` + loading/error/loaded states

