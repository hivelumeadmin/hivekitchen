# Story 7-S9: Consent History View

Status: done

## Story

As a Primary Parent,
I want a chronological list of all consent and account-lifecycle events recorded for my household,
so that I can verify exactly what I agreed to, when, and through which mechanism (FR72).

## Context & Scope

This slice adds a single read endpoint and a matching web page to the trust surface built in 7-S1…7-S8.

**Where the data lives:** `audit_log` — not `vpc_consents`.
The 7-S8 dashboard reads from `vpc_consents` for its capped 5-row snapshot. This slice reads the full chronological audit trail from `audit_log` for a specific set of consent-related event types. The two sources are **complementary, not redundant**.

| Event type | Meaning |
|---|---|
| `vpc.consented` | A parental-consent declaration was signed (geolocation opt-in, COPPA declaration, etc.) |
| `parental_notice.acknowledged` | The parental data-collection notice was acknowledged |
| `account.created` | Household account was created |
| `account.updated` | Account settings were updated |
| `account.deleted` | Account deletion was initiated |

The `audit_log` already exists and is already populated with these event types via the audit infrastructure established in Epic 1. This slice adds a **read path only** — no new writes, no migration.

**Precedent to mirror:** `AuditRepository.findAllergyEventsByHousehold` (4-S17) — reads from `audit_log` with `.in()` on `event_type`. The consent history read follows the exact same pattern.

**Service-layer note:** `AuditService` currently has only `write()`. This slice adds a `getConsentHistory(householdId)` read method to it, extending the service rather than creating a new one (the story's scope is too narrow to justify a new service class).

## Acceptance Criteria

1. **Given** an authenticated `primary_parent` or `secondary_caregiver`, **When** they `GET /v1/households/:householdId/consent-history` for their own household, **Then** the API returns `200` with a body matching `ConsentHistoryResponseSchema`: `{ events: ConsentHistoryEvent[] }`.

2. **Given** the consent-history endpoint is called, **When** the response is composed, **Then** each entry in `events[]` contains: `id` (uuid), `event_type` (string), `metadata` (object), and `created_at` (ISO 8601 string with timezone offset); **and** only events whose `event_type` is in the set `{ vpc.consented, parental_notice.acknowledged, account.created, account.updated, account.deleted }` are returned.

3. **Given** the consent-history endpoint is called, **When** the response is composed, **Then** `events` are ordered **newest-first** (`created_at` DESC) — most recent consent event at the top of the list.

4. **Given** the consent-history is queried, **When** the query runs, **Then** only rows matching `household_id = :householdId` are returned. No cross-household data leakage.

5. **Given** the `:householdId` in the URL does not equal the caller's `household_id`, **When** the request is processed, **Then** the API returns `403 Forbidden` (mirrors the sibling `/memory` and `/dashboard` guard — no cross-household read, no oracle).

6. **Given** the request, **Then** the API returns `401` when unauthenticated, and `400` when `:householdId` is not a valid UUID.

7. **Given** the household has no matching audit events, **When** the endpoint is called, **Then** the API returns `200` with `{ events: [] }` (no crash, no 404).

8. **Given** an authenticated parent navigates to `/app/memory/consent-history`, **When** the page loads, **Then** it renders a chronological list of consent events — each row showing the date and a human-readable label for the event type (plus mechanism from metadata when available); shows a loading skeleton while fetching, a `role="alert"` error line on failure, and a calm empty-state line when `events: []`.

---

## Tasks / Subtasks

### Task 1 — Contracts: new `consent-history.ts` (AC: #1–#2) ✅

Create **`packages/contracts/src/consent-history.ts`**:

```typescript
import { z } from 'zod';

export const ConsentHistoryEventSchema = z.object({
  id: z.string().uuid(),
  event_type: z.string(),
  metadata: z.record(z.unknown()),
  created_at: z.string().datetime({ offset: true }),
});
export type ConsentHistoryEvent = z.infer<typeof ConsentHistoryEventSchema>;

export const ConsentHistoryResponseSchema = z.object({
  events: z.array(ConsentHistoryEventSchema),
});
export type ConsentHistoryResponse = z.infer<typeof ConsentHistoryResponseSchema>;
```

> `event_type` uses `z.string()` (not a union enum) — new consent event types may be added without a contract bump. `metadata` uses `z.record(z.unknown())` matching the existing `AllergyAuditRow` and `AllergyTransparencyService` patterns.

**`packages/contracts/src/index.ts`** — add the re-export line (near the other Epic-7-era exports):
```typescript
export * from './consent-history.js';
```

**`packages/types/src/index.ts`** — import the schemas and re-export the inferred types (follow the `ResetFlavorJourneyResponse` / `MemorySourceCounts` pattern):
```typescript
import {
  // … existing imports …
  ConsentHistoryEventSchema,
  ConsentHistoryResponseSchema,
} from '@hivekitchen/contracts';

export type ConsentHistoryEvent = z.infer<typeof ConsentHistoryEventSchema>;
export type ConsentHistoryResponse = z.infer<typeof ConsentHistoryResponseSchema>;
```

> **Contract test (Task 1):** add `packages/contracts/src/consent-history.test.ts`:
> - Round-trip parse a valid `ConsentHistoryResponseSchema` payload with 2 events
> - Reject a payload where an event is missing `event_type`
> - Reject a payload where `id` is not a UUID
> - Reject a payload where `created_at` is not an ISO datetime

---

### Task 2 — `ConsentAuditRow` type + `AuditRepository.findConsentEventsByHousehold` (AC: #2–#4) ✅

**`apps/api/src/audit/audit.types.ts`** — add the read-side row type (after `AllergyAuditRow`):

```typescript
// Slice 7-S9 — read-side row shape for the consent history view.
// Covers vpc.consented + parental_notice.acknowledged + account.* events.
export type ConsentAuditRow = {
  id: string;
  event_type: string;
  metadata: Record<string, unknown>;
  created_at: string;
};
```

**`apps/api/src/audit/audit.repository.ts`** — add the read method after `findAllergyEventsByHousehold`:

```typescript
// Slice 7-S9 — full chronological consent history for a household.
// Uses .in() on event_type (not .like()) — type-safe and hits the composite
// index (household_id, event_type, created_at) directly, matching the
// findAllergyEventsByHousehold pattern from 4-S17.
// Ordered newest-first so the most recent consent appears first in the UI.
// No pagination at MVP — audit_log consent events per household are sparse
// (O(10) rows at beta scale).
private static readonly CONSENT_EVENT_TYPES = [
  'vpc.consented',
  'parental_notice.acknowledged',
  'account.created',
  'account.updated',
  'account.deleted',
] as const;

async findConsentEventsByHousehold(householdId: string): Promise<ConsentAuditRow[]> {
  const { data, error } = await this.client
    .from('audit_log')
    .select('id, event_type, metadata, created_at')
    .eq('household_id', householdId)
    .in('event_type', AuditRepository.CONSENT_EVENT_TYPES)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as ConsentAuditRow[];
}
```

> **Import:** Add `ConsentAuditRow` to the import from `./audit.types.js` at the top of the file.

> **`CONSENT_EVENT_TYPES` placement:** make it a `private static readonly` on the class (not a module-level const) to match `ALLERGY_EVENT_TYPES` — except `ALLERGY_EVENT_TYPES` is module-level in the existing file. **Check the existing file** — if `ALLERGY_EVENT_TYPES` is module-level, use the same scope for consistency:
> ```typescript
> const CONSENT_EVENT_TYPES = [
>   'vpc.consented',
>   'parental_notice.acknowledged',
>   'account.created',
>   'account.updated',
>   'account.deleted',
> ] as const;
> ```

**Repo test** (add a `describe('findConsentEventsByHousehold (7-S9)')` block — or create `audit.repository.test.ts` if absent):
- Returns events for the household ordered by `created_at` DESC
- Applies `.in()` filter on `event_type` (assert the 5-item list is passed)
- Returns `[]` when no matching events
- Scopes to `household_id` (assert `.eq('household_id', householdId)` is applied)
- Throws on supabase error

---

### Task 3 — `AuditService.getConsentHistory` (AC: #1) ✅

Extend **`apps/api/src/audit/audit.service.ts`** with a read method:

```typescript
import type { AuditRepository } from './audit.repository.js';
import type { AuditWriteInput, ConsentAuditRow } from './audit.types.js';

export class AuditService {
  constructor(private readonly repository: AuditRepository) {}

  async write(input: AuditWriteInput): Promise<void> {
    await this.repository.insert(input);
  }

  // Slice 7-S9 — consent history read path. Thin delegation to the repo.
  async getConsentHistory(householdId: string): Promise<ConsentAuditRow[]> {
    return this.repository.findConsentEventsByHousehold(householdId);
  }
}
```

> The file is currently 10 lines. Adding `getConsentHistory` keeps it under 20 lines — no need to split. Import `ConsentAuditRow` from `./audit.types.js` (update the existing `import type` line).

---

### Task 4 — Route: `GET /v1/households/:householdId/consent-history` (AC: #1, #5–#7) ✅

**`apps/api/src/modules/households/households.routes.ts`**:

**Add contract import** (in the `@hivekitchen/contracts` import block — alphabetical-ish):
```typescript
import {
  // … existing imports …
  ConsentHistoryResponseSchema,
} from '@hivekitchen/contracts';
```

**Route** (register after the `GET /v1/households/:householdId/dashboard` route, using the pre-existing `requireParentOrCaregiver` binding):

```typescript
// Story 7-S9 — GET /v1/households/:householdId/consent-history
// Full chronological consent history: vpc.* + parental_notice.acknowledged +
// account.* audit events. Read-only; 403 on cross-household (no oracle),
// matching sibling /memory and /dashboard routes.
fastify.get(
  '/v1/households/:householdId/consent-history',
  {
    preHandler: requireParentOrCaregiver,
    schema: {
      params: z.object({ householdId: z.string().uuid() }),
      response: { 200: ConsentHistoryResponseSchema },
    },
  },
  async (request) => {
    const { householdId } = request.params as { householdId: string };
    if (householdId !== request.user.household_id) {
      throw new ForbiddenError('Cannot access another household consent history');
    }
    const events = await auditService.getConsentHistory(householdId);
    return { events };
  },
);
```

> **`auditService` is already instantiated** at the top of the plugin:
> ```typescript
> const auditService = new AuditService(new AuditRepository(fastify.supabase));
> ```
> No new service wiring needed. This is the key simplification over 7-S8 — the `auditService` local instance is already there.

> **`requireParentOrCaregiver` binding** — in the actual code it is defined at line 183 of `households.routes.ts` as:
> ```typescript
> const requireParentOrCaregiver = authorize(['primary_parent', 'secondary_caregiver']);
> ```
> This is already used by the sibling `/brief`, `/memory`, and `/dashboard` routes. Use it — do NOT re-bind or rename.

---

### Task 5 — Route tests (AC: #1, #5–#7) ✅

Add to **`apps/api/src/modules/households/households.routes.test.ts`** a `describe('GET /v1/households/:householdId/consent-history (7-S9)')` block.

The `auditService.getConsentHistory` delegates to `AuditRepository.findConsentEventsByHousehold` which queries `audit_log`. The mock supabase in this test file may or may not handle `audit_log` already. **Check first.**

**If `audit_log` is handled by the mock:** seed consent events and assert the response body parses against `ConsentHistoryResponseSchema`.

**If `audit_log` is NOT in the mock** (likely — the dashboard tests use children/cultural_priors/memory_nodes/vpc_consents but not audit_log): mock `auditService.getConsentHistory` directly by replacing the route's internal service with a jest-compatible mock OR seed a stub return from the mock supabase chain for the `audit_log` table.

**Easiest approach (if mock doesn't support audit_log):** add `audit_log` table handling to the `tableChain` mock — return an empty array by default, override per test. This is the minimum-viable additive extension.

**Required cases:**
- `200` happy path — 2 seeded events → response body parses against `ConsentHistoryResponseSchema`; both events appear in `events[]`; events are newest-first
- `200` with `events: []` when household has no matching audit rows (AC#7)
- `403` when `:householdId !== request.user.household_id`
- `401` when no auth token
- `400` when `:householdId` is not a UUID

**Fixture shape** for a consent event in the mock:
```typescript
{
  id: '44444444-4444-4444-4444-444444444444',
  event_type: 'vpc.consented',
  metadata: { mechanism: 'signed_declaration', document_version: 'v1.0' },
  created_at: '2026-06-01T00:00:00.000Z',
}
```

---

### Task 6 — Web route + page (AC: #8) ✅

**`apps/web/src/app.tsx`** — add the import and route entry under `AppLayout` children (next to `/app/memory/dashboard`):

```typescript
import ConsentHistoryRoute from './routes/(app)/consent-history.js';
```

```typescript
{ path: '/app/memory/consent-history', element: <ConsentHistoryRoute /> },
```

Create **`apps/web/src/routes/(app)/consent-history.tsx`** — model on `memory-dashboard.tsx` (7-S8):

```typescript
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ConsentHistoryResponseSchema } from '@hivekitchen/contracts';
import type { ConsentHistoryEvent } from '@hivekitchen/types';
import { hkFetch, HkApiError } from '@/lib/fetch.js';
import { useLumiContext } from '@/hooks/useLumiContext.js';
import { useAuthStore } from '@/stores/auth.store.js';

type LoadState = 'loading' | 'ready' | 'error';

const EMPTY_COPY =
  'No consent events have been recorded for this household yet.';
const ERROR_COPY = "Lumi couldn't load your consent history right now. Try refreshing.";

// Human-readable labels for the consent event types in audit_log.
// event_type uses z.string() in the contract for forward-compatibility —
// unknown event types fall back to the raw event_type string.
const EVENT_LABELS: Record<string, string> = {
  'vpc.consented': 'Consent recorded',
  'parental_notice.acknowledged': 'Parental notice acknowledged',
  'account.created': 'Account created',
  'account.updated': 'Account updated',
  'account.deleted': 'Account deletion initiated',
};

function eventLabel(event: ConsentHistoryEvent): string {
  const base = EVENT_LABELS[event.event_type] ?? event.event_type;
  const mechanism =
    typeof event.metadata['mechanism'] === 'string' ? event.metadata['mechanism'] : null;
  return mechanism ? `${base} (${mechanism})` : base;
}

export default function ConsentHistoryRoute() {
  useLumiContext({ surface: 'general' });

  const navigate = useNavigate();
  const accessToken = useAuthStore((s) => s.accessToken);
  const householdId = useAuthStore((s) => s.user?.current_household_id ?? null);
  const didLoad = useRef(false);

  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [events, setEvents] = useState<ConsentHistoryEvent[]>([]);

  useEffect(() => {
    if (!accessToken) {
      navigate('/auth/login?next=/app/memory/consent-history', { replace: true });
      return;
    }
    if (householdId === null || didLoad.current) return;
    didLoad.current = true;
    const controller = new AbortController();
    void (async () => {
      try {
        const raw = await hkFetch<unknown>(
          `/v1/households/${householdId}/consent-history`,
          { method: 'GET', signal: controller.signal },
        );
        const parsed = ConsentHistoryResponseSchema.parse(raw);
        setEvents(parsed.events);
        setLoadState('ready');
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        if (err instanceof HkApiError && err.status === 401) {
          navigate('/auth/login?next=/app/memory/consent-history', { replace: true });
          return;
        }
        didLoad.current = false;
        setLoadState('error');
      }
    })();
    return () => controller.abort();
  }, [accessToken, householdId, navigate]);

  return (
    <main className="mx-auto w-full max-w-3xl flex-grow px-4 py-16 sm:px-6 md:py-24">
      <h1 className="font-serif text-3xl text-fg">Consent history</h1>
      <p className="mt-2 font-sans text-base text-fg-muted leading-relaxed">
        Every consent and account event recorded for your household.
      </p>

      {loadState === 'loading' ? (
        <div role="status" aria-label="Loading your consent history" className="mt-8 space-y-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-10 rounded bg-surface animate-pulse motion-reduce:animate-none"
            />
          ))}
        </div>
      ) : loadState === 'error' ? (
        <p role="alert" className="mt-8 font-sans text-base text-fg-muted">
          {ERROR_COPY}
        </p>
      ) : events.length === 0 ? (
        <p className="mt-8 font-sans text-base text-fg-muted leading-relaxed">{EMPTY_COPY}</p>
      ) : (
        <ul className="mt-8 space-y-4">
          {events.map((event) => (
            <li key={event.id} className="border-b border-border/20 pb-4">
              <p className="font-sans text-sm text-fg">{eventLabel(event)}</p>
              <p className="mt-1 font-sans text-xs text-fg-muted">
                {new Date(event.created_at).toLocaleDateString(undefined, {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </p>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
```

**Design constraints:** No SaaS-dashboard chrome. No filters. No pagination. Calm list — event label + date only. `border-b border-border/20` for row separation matches existing list patterns in the app (see memory.tsx for `VisibleMemorySentence` rows). No `RailCard` here — a simple list is more appropriate for a compliance audit trail than a data card layout.

---

### Task 7 — Web tests (AC: #8) ✅

Create **`apps/web/src/routes/(app)/consent-history.test.tsx`** — mirror `memory-dashboard.test.tsx` setup (mock `hkFetch`, mock `useLumiContext`, mock `useNavigate`):

```typescript
// Cases:
// 1. Loading skeleton renders before fetch resolves
// 2. Success → event list renders (label + date for each event)
// 3. Empty events: [] → EMPTY_COPY renders, no list items
// 4. Fetch error → role="alert" error line renders
// 5. mechanism in metadata → appears in event label
```

**Fixture for a consent event:**
```typescript
const sampleEvent = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  event_type: 'vpc.consented',
  metadata: { mechanism: 'signed_declaration' },
  created_at: '2026-06-01T00:00:00.000Z',
};
```

Test that `screen.findByText(/consent recorded/i)` (or similar) appears after the fetch resolves with a single event. Test that mechanism `(signed_declaration)` appears in the rendered label.

---

## Dev Notes

### Scope guardrails — do NOT build these

- **No migration.** `audit_log` already exists. If you find yourself reaching for a migration, you have left scope.
- **No new service class.** Extend `AuditService` (Task 3) — do not create `ConsentHistoryService`.
- **No pagination.** Consent events per household are sparse at beta scale (O(10) rows). No `LIMIT`, no cursor. Return the full list. This is consistent with the 7-S5 job and 7-S8 single-batch doctrine.
- **No vpc_consents join.** 7-S8 already handles recent VPC events via `vpc_consents`. This slice uses `audit_log` exclusively — do not duplicate the `vpc_consents` read.
- **No filters on the web.** Chronological list, no date-range picker, no event-type filter. "No filters needed at MVP" per the slice doc.
- **No enrichment or label normalization server-side.** The API returns raw `event_type` strings. The web maps them to labels client-side.
- **No new auth role.** Use `requireParentOrCaregiver` (already bound in `households.routes.ts` as that exact name).

### Why AuditRepository, not ComplianceRepository

`vpc_consents` table → `ComplianceRepository` (structured consent rows, used in 7-S8)
`audit_log` table → `AuditRepository` (append-only audit trail, used in 4-S17)

7-S9 reads from `audit_log`, so `AuditRepository` is the correct home. The `findAllergyEventsByHousehold` method (4-S17) is the exact precedent — same table, same `.in()` on `event_type` pattern.

### Why AuditService gets the read method

`AuditService` is a plain class (not a Fastify decoration), instantiated locally in `households.routes.ts`:
```typescript
const auditService = new AuditService(new AuditRepository(fastify.supabase));
```
Adding `getConsentHistory` here keeps the implementation in one file, avoids a new import, and follows CLAUDE.md §2 (no new abstractions for single-use code). The service file is currently 10 lines — it can grow by 6 lines without splitting.

### The CONSENT_EVENT_TYPES array

**Scope:** The 5 event types are the entire scope of consent history at MVP. Future event types (e.g. `vpc.revoked`, `account.suspended`) are NOT in scope and should NOT be added until a story asks for them. Keep the list to exactly these 5.

### Ordering

The endpoint returns **newest-first** (`.order('created_at', { ascending: false })`). This is the standard for compliance audit views (most recent consent is most actionable). The 7-S8 dashboard similarly returns recent VPC events newest-first.

### Metadata display (web)

`metadata` is `Record<string, unknown>`. At MVP, only `mechanism` is rendered (when it's a string). Do NOT try to enumerate all metadata keys — the shape differs by event type and is unspecified.

The `eventLabel` helper function guards against non-string mechanism:
```typescript
const mechanism =
  typeof event.metadata['mechanism'] === 'string' ? event.metadata['mechanism'] : null;
```
This is the correct pattern — `z.record(z.unknown())` means any key could be any type.

### `requireParentOrCaregiver` vs `requireMember`

In `households.routes.ts`, the binding is:
```typescript
const requireParentOrCaregiver = authorize(['primary_parent', 'secondary_caregiver']);
```
This is the same as what 7-S8 story called `requireMember`. The ACTUAL variable name in the file is `requireParentOrCaregiver`. Use that name — do NOT re-declare.

### Patterns to copy (don't reinvent)

- **`findAllergyEventsByHousehold`** [`apps/api/src/audit/audit.repository.ts:28-37`] — the exact repo pattern to mirror: `.in()` on `event_type`, `.eq('household_id', ...)`, `.order()`, cast to typed row array.
- **`AllergyAuditRow`** [`apps/api/src/audit/audit.types.ts:141-147`] — the exact type-definition pattern to mirror for `ConsentAuditRow`.
- **Route + cross-household 403:** `households.routes.ts` near line 208 (the `/memory` route) — copy its `params` schema + `requireParentOrCaregiver` preHandler + cross-household 403 guard verbatim.
- **Web page pattern:** `apps/web/src/routes/(app)/memory-dashboard.tsx` (7-S8) — `useLumiContext`, `useAuthStore`, `didLoad`+`AbortController`, `hkFetch`+Zod-parse, `LoadState`, redirect-to-login on 401.
- **Web test setup:** `apps/web/src/routes/(app)/memory-dashboard.test.tsx` — mock `hkFetch`, `useLumiContext`, `useNavigate`, `useAuthStore.setState`.

### Test baseline (do not introduce NEW failures)

- **Web tests before this slice:** 454/454 (post-7-S8).
- **API tests before this slice:** ~1520-pass / 20-fail / 13-skip (documented pre-existing baseline). 0 regressions expected.
- **Contracts:** parental-dashboard 4/4 + new `consent-history.test.ts`.
- **TypeScript:** API 11 pre-existing errors (≤14 allowed), web 3, contracts 1, types 1 — all baseline. **Zero new errors** in any changed file.
- **Lint:** changed files lint-clean. No new `// eslint-disable`. `===`/`!==` only.

---

## File List

**New files:**
- `packages/contracts/src/consent-history.ts`
- `packages/contracts/src/consent-history.test.ts`
- `apps/web/src/routes/(app)/consent-history.tsx`
- `apps/web/src/routes/(app)/consent-history.test.tsx`

**Modified files:**
- `packages/contracts/src/index.ts` — `export * from './consent-history.js'`
- `packages/types/src/index.ts` — import + re-export `ConsentHistoryEvent` + `ConsentHistoryResponse`
- `apps/api/src/audit/audit.types.ts` — add `ConsentAuditRow` type
- `apps/api/src/audit/audit.repository.ts` — add `findConsentEventsByHousehold` + `CONSENT_EVENT_TYPES`
- `apps/api/src/audit/audit.repository.test.ts` — add `findConsentEventsByHousehold (7-S9)` describe block (5 cases)
- `apps/api/src/audit/audit.service.ts` — add `getConsentHistory` read method
- `apps/api/src/audit/audit.service.test.ts` — add `getConsentHistory` delegation test
- `apps/api/src/modules/households/households.routes.ts` — import `ConsentHistoryResponseSchema`, add route
- `apps/api/src/modules/households/households.routes.test.ts` — add consent-history route tests (+ audit_log mock support if absent)
- `apps/web/src/app.tsx` — import `ConsentHistoryRoute` + register `/app/memory/consent-history`

### References

- [Source: `_bmad-output/planning-artifacts/epic-7-vertical-slices.md#Slice 7-S9`] — demo path, layers, FR72, event types
- [Source: `apps/api/src/audit/audit.repository.ts:28-37`] — `findAllergyEventsByHousehold`: canonical pattern for reading audit_log with `.in()` on event_type + household scope + order
- [Source: `apps/api/src/audit/audit.types.ts:141-147`] — `AllergyAuditRow` type definition pattern
- [Source: `apps/api/src/audit/audit.service.ts`] — `AuditService` class to extend (currently write-only, 10 lines)
- [Source: `apps/api/src/modules/households/households.routes.ts:183,208-225`] — `requireParentOrCaregiver` binding + `/memory` route: cross-household 403 guard, params schema, preHandler — copy verbatim
- [Source: `apps/api/src/modules/compliance/compliance.repository.ts:43-57`] — `findRecentConsentsByHousehold` for context on why this slice uses audit_log instead of vpc_consents (7-S8 already covers vpc_consents)
- [Source: `apps/api/src/audit/audit.types.ts:1-6`] — AUDIT_EVENT_TYPES for full list of vpc.* and account.* event types already registered
- [Source: `apps/web/src/routes/(app)/memory-dashboard.tsx`] — canonical fetch-page pattern to mirror exactly
- [Source: `apps/web/src/routes/(app)/memory-dashboard.test.tsx`] — canonical web test setup to mirror
- [Source: `apps/web/src/app.tsx:48,102`] — `MemoryDashboardRoute` import + route registration pattern to replicate
- [Source: `_bmad-output/project-context.md`] — thin-handler rule, Tailwind-only UI, no non-null-across-Zod, `===`/`!==` only

## Dev Agent Record

### Implementation Plan

Pure read-path slice — followed the story's 7-task sequence verbatim. The `audit_log`
table and all five consent event types already existed; this added a typed read
method, a thin service delegation, one route, and a calm web list. No migration,
no new service class, no new dependency.

### Completion Notes

- **Task 1 (contracts):** Added `consent-history.ts` (`ConsentHistoryEventSchema` +
  `ConsentHistoryResponseSchema`) and re-exported through `contracts/src/index.ts`
  and `types/src/index.ts`. **Deviation from spec:** the project resolves **Zod 4**
  (`^4.0.0`), not Zod 3.23 as `project-context.md` claims. Zod 4's `z.record` requires
  two args, so `metadata` is `z.record(z.string(), z.unknown())` — matching the
  existing `memory.ts:61` / `thread.ts` usage, not the story's `z.record(z.unknown())`
  one-arg form (which throws under Zod 4). Per CLAUDE.md, the codebase wins over the
  story text. Contract round-trip test: 4/4 pass.
- **Task 2 (repository):** Added `ConsentAuditRow` type and
  `AuditRepository.findConsentEventsByHousehold` — mirrors `findAllergyEventsByHousehold`
  exactly (`.in()` on event_type, `.eq('household_id')`, `.order(created_at, desc)`).
  `CONSENT_EVENT_TYPES` is module-level to match the existing module-level
  `ALLERGY_EVENT_TYPES`. Repo test block: 5/5 pass.
- **Task 3 (service):** Added `AuditService.getConsentHistory` — thin delegation; the
  file is now 16 lines (no split needed). Service test: +1 pass.
- **Task 4 (route):** `GET /v1/households/:householdId/consent-history` registered after
  `/dashboard`, reusing the in-scope `auditService` instance and `requireParentOrCaregiver`
  binding; cross-household 403 guard copied from the sibling `/memory` route.
- **Task 5 (route tests):** New self-contained `buildConsentApp` + `consentTableChain`
  mock (the shared mocks don't model `.in()`). 6/6 pass. **Note:** the story fixture id
  `44444444-4444-4444-4444-444444444444` is not RFC-4122 valid (variant nibble must be
  8/9/a/b) and is rejected by Zod 4's `.uuid()` during response serialization → used
  `…-8444-…` instead.
- **Task 6 + 7 (web):** `consent-history.tsx` mirrors `memory-dashboard.tsx`
  (didLoad + AbortController + Zod-parse + LoadState + 401-redirect); registered at
  `/app/memory/consent-history`. Calm list, no filters/pagination/chrome. 5/5 pass.

### Verification

- **Contracts:** consent-history 4/4 pass. (4 repo-wide failures in `cultural.test.ts` +
  `heart-notes.test.ts` are pre-existing baseline — confirmed via stash; untouched files.)
- **API:** new consent route 6/6, repo 5/5, service +1 — all green. 2 remaining failures
  (`memory` route 200-case, `audit.types` enum-parity) confirmed pre-existing baseline via
  stash against committed `main`.
- **Web:** full suite 459/459 (454 baseline + 5 new).
- **Typecheck:** contracts 1 / types 1 / api 11 / web 3 — all pre-existing baseline,
  **0 new errors** in any changed file.
- **Lint:** all changed production, test, and web files lint-clean (production API files
  0 errors; test-file lint errors all at lines ≤1113 = pre-existing mock code, none in the
  consent block at 1607+). Contracts/types packages have no eslint config.

### Review Findings

**Acceptance Auditor verdict: PASS — all 8 ACs satisfied.**

3-layer adversarial review (Blind Hunter, Edge Case Hunter, Acceptance Auditor). 0 patches, 0 decisions. 5 deferred, 11 dismissed.

- [x] [Review][Defer] `account.created`/`account.deleted` not verified as included types in the repo filter test — test "returns only the five consent event types" proves exclusion of non-consent types but never seeds `account.created`/`account.deleted` as included rows [`apps/api/src/audit/audit.repository.test.ts` — findConsentEventsByHousehold describe block] — deferred, coverage gap; `.in(CONSENT_EVENT_TYPES)` is correct, risk is low
- [x] [Review][Defer] No server-side LIMIT in `findConsentEventsByHousehold` — `account.updated` events could accumulate past O(10) rows at post-beta scale [`apps/api/src/audit/audit.repository.ts` — findConsentEventsByHousehold] — deferred, documented MVP design decision
- [x] [Review][Defer] `account.deleted` events may be written with `household_id = null` during account teardown — `.eq('household_id', ...)` would silently exclude them from consent history [`apps/api/src/audit/audit.repository.ts` — insert write path, outside this story's scope] — deferred, depends on how account.deleted is written; no user-facing impact at beta
- [x] [Review][Defer] `user_id` / actor identity not captured in `ConsentHistoryEvent` — compliance view lacks attribution for who acknowledged the parental notice or who initiated deletion [`packages/contracts/src/consent-history.ts`] — deferred, explicit scope decision per AC#2 and spec; revisit for COPPA audit requirements
- [x] [Review][Defer] `householdId === null` with valid token causes indefinite loading skeleton — already tracked as D-5 from 7-s8 review [`apps/web/src/routes/(app)/consent-history.tsx:48`] — deferred, pre-existing codebase-wide pattern (auth-store null-household guard is the right fix location)

**Dismissed (11):** `buildConsentApp` missing decorator stubs (false positive — Fastify handler closures are lazy; tests pass); `ConsentAuditRow.event_type: string` (intentional forward-compat per spec); bare `Z` in contract test (RFC 3339 valid offset); `didLoad.current` retry pattern (codebase-wide pre-existing); `ZodError` swallowed to generic error (codebase-wide pre-existing); split `@hivekitchen/types`/`@hivekitchen/contracts` import (intended monorepo design); route mock column projection gap (tested at repo layer, correct testing split); `account.deleted` label "initiated" (reasonable for deletion-requested lifecycle point); `mechanism` injection concern (React JSX is XSS-safe); no 401 redirect web test (not in Task 7's required test cases); `created_at` offset format risk (PostgREST consistently returns `+00:00` for `timestamptz`; same pattern used in allergy-transparency without issues).

---

## Change Log

| Date       | Change                                                                                  |
| ---------- | --------------------------------------------------------------------------------------- |
| 2026-06-05 | Story file authored for 7-S9 Consent History View. Status → ready-for-dev.             |
| 2026-06-05 | Implemented 7-S9 (all 7 tasks, 8 ACs). Read-only consent-history endpoint + web page. Zod-4 `z.record` two-arg + RFC-UUID fixture deviations noted. Status → review. |
| 2026-06-05 | Code review complete (3-layer adversarial, Auditor PASS all 8 ACs); 0 patches, 5 deferred, 11 dismissed. Status → done. |
