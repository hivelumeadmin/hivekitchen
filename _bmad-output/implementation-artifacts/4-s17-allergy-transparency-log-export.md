# Story 4.17: Allergy Transparency Log Export

Status: done

**Slice key:** `4-s17-allergy-transparency-log-export`
**Epic:** 4 — Lunch Link & Heart Note Sacred Channel
**Source slice doc:** `_bmad-output/planning-artifacts/epic-4-vertical-slices.md` §Slice 4-S17
**Builds on:** 1-8 (audit_log partitioned table + AuditService), 3-1 (allergy guardrail service writes allergy.* events)
**Folds:** 4.15 — FR80

---

## Story

As a Primary Parent of a child with declared allergies,
I want a transparency log exportable to me on request showing every system action taken for allergy-relevant decisions affecting my household,
So that I can verify the safety chain for any incident (FR80).

---

## Context — What This Slice Does and Why

The `audit_log` table (Story 1.8, shipped) has been accumulating allergy safety decisions since Story 3.1 shipped the `AllergyGuardrailService`. Three event types are written there today:

| Event type | Written by | Metadata keys |
|---|---|---|
| `allergy.guardrail_rejection` | `AllergyGuardrailService` | `conflicts` (array of allergen names), `guardrail_version` |
| `allergy.uncertainty` | `AllergyGuardrailService` | `reason`, `flagged_items` (array), `guardrail_version` |
| `allergy.check_overridden` | (future override flow) | `reason` (string \| null) |

This slice surfaces those rows to the authenticated parent as a human-readable, downloadable timeline — in JSON (structured) or PDF (print-ready).

**The query is:**
```sql
SELECT id, event_type, metadata, created_at
FROM audit_log
WHERE household_id = $1
  AND event_type IN ('allergy.guardrail_rejection','allergy.uncertainty','allergy.check_overridden')
ORDER BY created_at ASC
```

The composite index `(household_id, event_type, correlation_id, created_at)` on `audit_log` supports this query shape directly. Use `.in()` (not `.like()`) — PostgREST `.like()` on an enum column is unreliable; `.in()` with an explicit value list is type-safe and index-friendly.

**Spec naming note:** The authoritative spec (`epics.md` §4.15, `epic-4-vertical-slices.md` §4-S17) specifies the endpoint as `POST /v1/heart-notes/transparency-log`. Follow the spec exactly — do not rename to an allergy-namespaced route.

---

## Acceptance Criteria

### AC1 — `POST /v1/heart-notes/transparency-log` (dual-format export trigger)

Body: `{ format: 'json' | 'pdf' }` validated by `AllergyTransparencyExportBodySchema`.

Auth: `requireMember` prehandler (already in scope in `heartNoteRoutes`). This prehandler allows `primary_parent` and `secondary_caregiver`. `guest_author` → 403. Unauthenticated → 401.

Household scope: always use `request.user.household_id` from the JWT. **Never accept a `household_id` in the request body** — cross-household data leakage prevention.

Format-specific response:

| Format | `Content-Type` | `Content-Disposition` | Body |
|---|---|---|---|
| `json` | `application/json` | (none) | `AllergyTransparencyLogSchema` payload |
| `pdf` | `application/pdf` | `attachment; filename="allergy-log-YYYY-MM-DD.pdf"` | pdfkit `Readable` stream |

Empty log (no allergy events for household): HTTP 200 + empty `events: []` (JSON) or a one-page PDF reading "No allergy events have been recorded for your household." — never 404.

### AC2 — `AuditRepository.findAllergyEventsByHousehold` (first read method on AuditRepository)

Add to `apps/api/src/audit/audit.repository.ts`:

```typescript
async findAllergyEventsByHousehold(householdId: string): Promise<AllergyAuditRow[]>
```

Add `AllergyAuditRow` type to `apps/api/src/audit/audit.types.ts`:

```typescript
export type AllergyAuditRow = {
  id: string;
  event_type: 'allergy.guardrail_rejection' | 'allergy.uncertainty' | 'allergy.check_overridden';
  metadata: Record<string, unknown>;
  created_at: string;
};
```

Supabase query implementation:

```typescript
const { data, error } = await this.supabase
  .from('audit_log')
  .select('id, event_type, metadata, created_at')
  .eq('household_id', householdId)
  .in('event_type', ['allergy.guardrail_rejection', 'allergy.uncertainty', 'allergy.check_overridden'])
  .order('created_at', { ascending: true });
```

Throw on error. Return `data ?? []` on empty. This is the **first read method** on `AuditRepository` (which today is write-only) — mirror the Supabase client pattern from other repositories in the codebase.

### AC3 — `AllergyTransparencyService` (new service)

New file `apps/api/src/modules/allergy-transparency/allergy-transparency.service.ts`:

```typescript
export class AllergyTransparencyService {
  constructor(private readonly auditRepo: AuditRepository) {}

  async exportAsJson(householdId: string): Promise<AllergyTransparencyLog>
  async exportAsPdf(householdId: string): Promise<Readable>
}
```

**`exportAsJson`:** Fetch rows via `auditRepo.findAllergyEventsByHousehold`, map to `AllergyEventEntry[]` using the label table below, return `AllergyTransparencyLog`.

**`exportAsPdf`:** Same fetch + map, then generate a pdfkit PDF stream:
1. `const doc = new PDFDocument({ info: { Title: 'Allergy Transparency Log', Author: 'HiveKitchen' } })`
2. `const pass = new PassThrough()`; `doc.pipe(pass)`
3. Write header: "Allergy Transparency Log", generated timestamp, household `…${householdId.slice(-8)}` (last 8 chars for privacy), `N events recorded`.
4. For each entry: date/time line (monospace), bold label, detail text (if not null).
5. `doc.end()`. Return `pass`.

**Do NOT** buffer the entire PDF to a `Buffer` — pipe directly through `PassThrough`. pdfkit is a streaming library; collect-all-then-send wastes memory for large logs.

**Event-type → label mapping** (hardcoded, deterministic, no LLM):

| `event_type` | `label` | `detail` |
|---|---|---|
| `allergy.guardrail_rejection` | `"Plan blocked due to allergen conflict"` | `metadata.conflicts` joined by `", "` — e.g. `"peanut, tree_nut"`. Null if conflicts is missing. |
| `allergy.uncertainty` | `"Ingredient safety could not be confirmed"` | `metadata.flagged_items` joined by `", "` — e.g. `"Thai curry paste"`. Null if missing. |
| `allergy.check_overridden` | `"Parent overrode allergy safety check"` | `String(metadata.reason)` if present, else null. |

### AC4 — Contracts in `@hivekitchen/contracts`

New file `packages/contracts/src/allergy-transparency.ts`:

```typescript
import { z } from 'zod/v4'; // match existing import pattern in contracts package

export const AllergyTransparencyExportBodySchema = z.object({
  format: z.enum(['json', 'pdf']),
});

export const AllergyEventEntrySchema = z.object({
  id: z.string().uuid(),
  timestamp: z.string().datetime(),
  event_type: z.enum([
    'allergy.guardrail_rejection',
    'allergy.uncertainty',
    'allergy.check_overridden',
  ]),
  label: z.string(),
  detail: z.string().nullable(),
});

export const AllergyTransparencyLogSchema = z.object({
  household_id: z.string().uuid(),
  exported_at: z.string().datetime(),
  event_count: z.number().int().nonnegative(),
  events: z.array(AllergyEventEntrySchema),
});

export type AllergyTransparencyExportBody = z.infer<typeof AllergyTransparencyExportBodySchema>;
export type AllergyEventEntry = z.infer<typeof AllergyEventEntrySchema>;
export type AllergyTransparencyLog = z.infer<typeof AllergyTransparencyLogSchema>;
```

Add re-exports to `packages/contracts/src/index.ts` (follow the existing pattern — one named export line per schema/type from this file).

### AC5 — Route: add to existing `heartNoteRoutes` plugin

Add to `apps/api/src/modules/heart-notes/heart-note.routes.ts` (inside the existing `heartNoteRoutes` plugin closure, alongside the other four routes). Wire `AllergyTransparencyService` in the plugin:

```typescript
const transparencyService = new AllergyTransparencyService(new AuditRepository(supabase));

fastify.post(
  '/v1/heart-notes/transparency-log',
  {
    preHandler: [requireMember],
    schema: { body: AllergyTransparencyExportBodySchema },
    // No Zod `response` schema — dual-mode (JSON / PDF stream) handled manually.
  },
  async (request, reply) => {
    const { format } = request.body;
    const householdId = request.user.household_id;

    if (format === 'pdf') {
      const stream = await transparencyService.exportAsPdf(householdId);
      const date = new Date().toISOString().slice(0, 10);
      reply
        .type('application/pdf')
        .header('Content-Disposition', `attachment; filename="allergy-log-${date}.pdf"`)
        .send(stream);
    } else {
      const log = await transparencyService.exportAsJson(householdId);
      reply.code(200).send(log);
    }
  },
);
```

**Why no `response` Zod schema for the PDF path:** Fastify detects a `Readable` stream in `reply.send()` and pipes it as-is, bypassing JSON serialization. The Zod `response` schema is only applied by Fastify's serializer on JSON responses.

### AC6 — UI: "Export allergy log" section on Account/Privacy page

**Step 1 — Locate the Account page.** The dev agent must find the existing Account or Settings route in `apps/web/src/routes/`. Common locations: `(app)/account.tsx`, `(app)/settings.tsx`, or similar. If no Account page exists, create one at `(app)/account.tsx` and wire it in the router.

**Step 2 — Add the section.** Within the Account page, add an "Allergy safety log" section:

```tsx
<section className="flex flex-col gap-3">
  <h3 className="text-heading3 text-fg">Allergy safety log</h3>
  <p className="text-body text-fg-muted">
    Download a record of every allergy safety decision Lumi has made for your household.
  </p>
  <div className="flex gap-3">
    <SecondaryButton onClick={() => downloadLog('json')}>Download JSON</SecondaryButton>
    <SecondaryButton onClick={() => downloadLog('pdf')}>Download PDF</SecondaryButton>
  </div>
</section>
```

**Step 3 — `downloadLog` blob-download helper:**

```typescript
async function downloadLog(format: 'json' | 'pdf') {
  const res = await hkFetch('/v1/heart-notes/transparency-log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ format }),
  });
  if (!res.ok) throw new Error('Export failed');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `allergy-log-${new Date().toISOString().slice(0, 10)}.${format}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
```

Use `hkFetch` from `apps/web/src/lib/fetch.ts` (authenticated fetch helper). Do **not** use `window.location.href` — that navigates instead of downloading for same-origin responses.

Gate the section visibility to `primary_parent` and `secondary_caregiver` roles. Guest authors should not see this section (read role from the existing auth store, matching the pattern used in other parent-only UI).

### AC7 — Tests

**API tests** (new file `apps/api/src/modules/heart-notes/transparency-log.routes.test.ts` or extend `heart-note.routes.test.ts`):

1. `POST /v1/heart-notes/transparency-log { format: 'json' }` with `primary_parent` auth → 200, body matches `AllergyTransparencyLogSchema`
2. `POST { format: 'pdf' }` → 200, `Content-Type: application/pdf`, `Content-Disposition` header present, non-empty body
3. Unauthenticated → 401
4. `guest_author` auth → 403
5. Household with no allergy events → 200, `events: []` (JSON) / 200 non-empty PDF (empty state text)
6. Label mapping assertions for all three event types (inject mock audit rows, assert `label` field)
7. `format` missing or invalid value → 400

**Repository test** (extend `apps/api/src/audit/audit.repository.test.ts`):
- `findAllergyEventsByHousehold` returns only `allergy.*` rows for the given `household_id`, ordered ascending by `created_at`
- Excludes non-allergy events from the same household
- Returns `[]` for a household with no allergy events

**Web tests** (new or extend Account page test file):
- Download JSON button calls `hkFetch` with `{ format: 'json' }`
- Download PDF button calls `hkFetch` with `{ format: 'pdf' }`
- `downloadLog` creates an anchor element with the correct `download` attribute name pattern
- Section is not rendered when user role is `guest_author`

### AC8 — pdfkit installed as API-only dependency

```
pnpm --filter @hivekitchen/api add pdfkit
pnpm --filter @hivekitchen/api add -D @types/pdfkit
```

Do **not** add pdfkit to the root `package.json` or any other package — it is API-only.

### AC9 — Typecheck + no regressions

`pnpm typecheck` at pre-existing baselines (API: ≤14 errors, web: 3-error baseline). All existing tests pass. No contract/migration/agent/DB schema changes beyond what this story introduces.

---

## Demo Path

1. Ensure at least one `allergy.*` event exists in `audit_log` for the test household. Options: (a) trigger a plan generation that conflicts with a declared allergen, or (b) INSERT directly via Supabase SQL editor:
   ```sql
   INSERT INTO audit_log (household_id, user_id, event_type, request_id, metadata)
   VALUES ('<your-household-id>', '<your-user-id>', 'allergy.guardrail_rejection', gen_random_uuid(),
           '{"conflicts": ["peanut"], "guardrail_version": "1.0.0"}'::jsonb);
   ```
2. Log in as a primary parent.
3. Navigate to Account → (find the account page route in the running app).
4. See "Allergy safety log" section with two download buttons.
5. Click **Download JSON** → browser saves `allergy-log-YYYY-MM-DD.json`. Open the file — confirm `events` array has at least one entry with a human-readable `label` (not the raw enum value).
6. Click **Download PDF** → browser saves `allergy-log-YYYY-MM-DD.pdf`. Open — confirm header, timestamp, formatted event entry.
7. Log in as a grandparent (guest_author) → the Allergy safety log section is hidden.
8. *(Optional)* In Supabase SQL editor, confirm no new rows were written to `audit_log` for the export action itself (this story does not audit the export).

**USER-SIDE GATE:** Requires a live stack and at least one allergy audit event.

---

## Critical Guardrails

**No AI in the export path.** This is a deterministic SQL read → deterministic label mapping → file serialization. No LLM, no Lumi, no agent. Do not call any `orchestrator`, `plannerAgent`, or `LLMProvider` from `AllergyTransparencyService`.

**Household scope from JWT only.** Never accept `household_id` in the request body. Always use `request.user.household_id`. A parent cannot export another household's log — this is not optional validation.

**`.in()` not `.like()` for the event type filter.** PostgREST's `.like()` on a Postgres ENUM column may not behave as a string LIKE. Use `.in('event_type', ['allergy.guardrail_rejection', 'allergy.uncertainty', 'allergy.check_overridden'])` — type-safe, explicit, and hits the composite index correctly.

**pdfkit is streaming — do not buffer.** `const chunks: Buffer[] = []; doc.on('data', c => chunks.push(c)); doc.on('end', () => reply.send(Buffer.concat(chunks)))` — do NOT do this. It wastes memory and defeats the purpose of a streaming library. Pipe through `PassThrough` and return the stream.

**Empty log → 200, not 404.** A household that has never triggered an allergy event is a valid, healthy state. Returning 404 would be incorrect and would break the UI download handler.

**Do not add pdfkit to root `package.json`.** It is a heavy binary-native dependency and is API-only. Use the `--filter @hivekitchen/api` scope in pnpm.

**Do not modify the Supabase ENUM for this story.** The three `allergy.*` event types already exist in `audit_event_type` enum (from Story 1.8 + 3.1). No migration needed.

**`requireMember` already exists in heartNoteRoutes scope** — do not declare a new prehandler. Wire the new route with the existing one.

**Fastify dual-format response:** Do not set a `response: { 200: schema }` Zod schema for the PDF path — it would try to JSON-serialize the stream. Either omit the `response` key entirely or use a per-format branch (JSON path can optionally validate with `AllergyTransparencyLogSchema`; PDF path bypasses serialization by sending a `Readable`).

---

## What Already Exists (Do Not Recreate)

- **`audit_log` table** — `supabase/migrations/20260501140000_create_audit_log_partitioned.sql`. Composite index `(household_id, event_type, correlation_id, created_at)`. Monthly partitions. Already contains `allergy.*` rows from guardrail decisions.
- **`AUDIT_EVENT_TYPES` + `AuditEventType`** — `apps/api/src/audit/audit.types.ts` lines 76–79. Three allergy event types are already present.
- **`AuditService`** — `apps/api/src/audit/audit.service.ts`. Write-only today (`write()` method only). Do not add read logic here — add it to `AuditRepository`.
- **`AuditRepository`** — `apps/api/src/audit/audit.repository.ts`. Add `findAllergyEventsByHousehold` as a new read method; mirror Supabase client pattern from other repositories.
- **`AllergyGuardrailService`** — `apps/api/src/modules/allergy-guardrail/allergy-guardrail.service.ts` lines 67–75. Already writes the `allergy.guardrail_rejection` and `allergy.uncertainty` events. No change needed.
- **`heartNoteRoutes` Fastify plugin** — `apps/api/src/modules/heart-notes/heart-note.routes.ts`. Add the new POST route inside this existing plugin — do not create a new Fastify plugin registration in `app.ts`.
- **`requireMember` prehandler** — declared inside `heartNoteRoutes`, allows `primary_parent` + `secondary_caregiver`. Use as-is.
- **`hkFetch` authenticated fetch helper** — `apps/web/src/lib/fetch.ts`. Use this in the UI download handler.
- **`SecondaryButton` component** — in `packages/design-system` or `apps/web/src/components/ui/`. Use existing; do not create a new button primitive.

---

## Tasks

### T1 — Install pdfkit (AC8)

```
pnpm --filter @hivekitchen/api add pdfkit
pnpm --filter @hivekitchen/api add -D @types/pdfkit
```

Verify: `apps/api/package.json` lists `pdfkit` in `dependencies` and `@types/pdfkit` in `devDependencies`.

### T2 — Contracts (AC4)

**T2.1** Create `packages/contracts/src/allergy-transparency.ts` with `AllergyTransparencyExportBodySchema`, `AllergyEventEntrySchema`, `AllergyTransparencyLogSchema`, and their inferred types.

**T2.2** Add re-exports to `packages/contracts/src/index.ts`.

Verify: `pnpm --filter @hivekitchen/contracts typecheck` passes.

### T3 — AuditRepository read method (AC2)

**T3.1** Add `AllergyAuditRow` type to `apps/api/src/audit/audit.types.ts`.

**T3.2** Add `findAllergyEventsByHousehold(householdId: string): Promise<AllergyAuditRow[]>` to `apps/api/src/audit/audit.repository.ts` using `.in('event_type', [...])` and `.order('created_at', { ascending: true })`.

### T4 — `AllergyTransparencyService` (AC3)

**T4.1** Create `apps/api/src/modules/allergy-transparency/allergy-transparency.service.ts`.

**T4.2** Implement `exportAsJson`: fetch rows → map to `AllergyEventEntry[]` using the label table → return `AllergyTransparencyLog`.

**T4.3** Implement `exportAsPdf`: fetch + map → pdfkit document piped through `PassThrough` → return `PassThrough` as `Readable`.

**T4.4** Wire `AuditRepository` as constructor injection.

Verify: unit tests (mock `AuditRepository`, assert label mapping, assert PDF stream is a Readable).

### T5 — Route (AC1, AC5)

**T5.1** Instantiate `AllergyTransparencyService` inside `heartNoteRoutes` plugin closure.

**T5.2** Add `POST /v1/heart-notes/transparency-log` with `requireMember` preHandler, body schema, and dual-format reply logic.

Verify: route tests (auth, both formats, empty log, invalid format).

### T6 — UI (AC6)

**T6.1** Find the Account page in `apps/web/src/routes/` (`(app)/account.tsx` or equivalent).

**T6.2** Add "Allergy safety log" section with the two `SecondaryButton`s.

**T6.3** Implement `downloadLog(format)` blob-download helper using `hkFetch`.

**T6.4** Gate section visibility by role (hide for `guest_author`).

Verify: web test for button click → correct `format` in request body; role-gate renders nothing for `guest_author`.

### T7 — Tests (AC7)

**T7.1** API route tests: 7 cases (JSON 200, PDF 200, 401, 403, empty log ×2 formats, 400 invalid format).

**T7.2** AuditRepository test: `findAllergyEventsByHousehold` correctness and isolation.

**T7.3** Web tests: download trigger behavior, role-gate visibility.

### T8 — Verification (AC9)

**T8.1** `pnpm typecheck` — no new errors (API ≤14, web at baseline).

**T8.2** `pnpm --filter @hivekitchen/api test` — new tests pass, pre-existing 22-fail baseline unchanged.

**T8.3** `pnpm --filter @hivekitchen/web test` — web suite green (+new tests), no regressions.

**T8.4** Manual demo path — **USER-SIDE GATE** (live stack + at least one allergy audit event in the DB).

---

## Project Structure Notes

**New files:**
- `packages/contracts/src/allergy-transparency.ts`
- `apps/api/src/modules/allergy-transparency/allergy-transparency.service.ts`
- `apps/api/src/modules/allergy-transparency/allergy-transparency.service.test.ts` (optional — can fold into route test)
- `apps/api/src/modules/heart-notes/transparency-log.routes.test.ts` (or extend `heart-note.routes.test.ts`)
- Web Account/Privacy page component (if it doesn't exist — confirm via `apps/web/src/routes/`)

**Modified files:**
- `packages/contracts/src/index.ts` — re-export allergy-transparency schemas
- `apps/api/package.json` — add `pdfkit` (dep) + `@types/pdfkit` (devDep)
- `apps/api/src/audit/audit.repository.ts` — add `findAllergyEventsByHousehold`
- `apps/api/src/audit/audit.types.ts` — add `AllergyAuditRow` type
- `apps/api/src/audit/audit.repository.test.ts` — extend with findAllergyEventsByHousehold cases
- `apps/api/src/modules/heart-notes/heart-note.routes.ts` — add transparency-log POST route
- `apps/web/src/routes/(app)/account.tsx` (or equivalent) — add Allergy safety log section

**Not modified:**
- `packages/contracts/src/heart-notes.ts` — heart-note schemas unchanged
- `apps/api/src/audit/audit.service.ts` — write-only service unchanged
- `apps/api/src/modules/allergy-guardrail/` — guardrail service unchanged (already writes events correctly)
- `supabase/migrations/` — no new migrations needed (enum has all three allergy types; audit_log schema is correct)
- `packages/design-system/` — no UI component changes
- `apps/marketing/` — not involved

---

## Task Completion Checklist

- [x] T1 — `pdfkit` + `@types/pdfkit` added to `apps/api/package.json`
- [x] T2.1 — `packages/contracts/src/allergy-transparency.ts` created (3 schemas + 3 inferred types)
- [x] T2.2 — Re-exports added to `packages/contracts/src/index.ts`
- [x] T3.1 — `AllergyAuditRow` type added to `audit.types.ts`
- [x] T3.2 — `findAllergyEventsByHousehold` method added to `AuditRepository`
- [x] T4.1 — `AllergyTransparencyService` file created
- [x] T4.2 — `exportAsJson` implemented (fetch → label map → AllergyTransparencyLog)
- [x] T4.3 — `exportAsPdf` implemented (fetch → map → pdfkit PassThrough stream)
- [x] T4.4 — `AuditRepository` injected via constructor
- [x] T5.1 — `AllergyTransparencyService` instantiated inside `heartNoteRoutes` plugin
- [x] T5.2 — `POST /v1/heart-notes/transparency-log` route added with `requireMember`, dual-format reply
- [x] T6.1 — Account page located (existing `apps/web/src/routes/(app)/account.tsx` — not created)
- [x] T6.2 — Allergy safety log section added to Account page
- [x] T6.3 — `downloadLog(format)` blob-download helper implemented (via new `hkFetchBlob` — see Completion Notes #3)
- [x] T6.4 — Section hidden for `guest_author` role
- [x] T7.1 — API route test cases pass (9 cases in `transparency-log.routes.test.ts`)
- [x] T7.2 — AuditRepository `findAllergyEventsByHousehold` test passes (5 cases)
- [x] T7.3 — Web download button + role-gate tests pass (4 cases)
- [x] T8.1 — Typecheck: no new errors (API 11 ≤14; web 3 = baseline)
- [x] T8.2 — API test suite: 24 new tests green; pre-existing failures all in unrelated files (see Completion Notes #8)
- [x] T8.3 — Web test suite: 389/389 green, no regressions
- [ ] T8.4 — Manual demo: JSON + PDF download from live stack — **USER-SIDE GATE** (requires live stack + ≥1 allergy audit event)

---

## Dev Agent Record

### Implementation Plan

1. **T1 — pdfkit install** → `pnpm --filter @hivekitchen/api add pdfkit && pnpm --filter @hivekitchen/api add -D @types/pdfkit`. Verify: package.json updated.
2. **T2 — contracts** → create `allergy-transparency.ts`, re-export from index. Verify: `pnpm --filter @hivekitchen/contracts typecheck`.
3. **T3 — AuditRepository** → add `AllergyAuditRow` type + `findAllergyEventsByHousehold` method using `.in()`. Verify: repository test with mock data.
4. **T4 — AllergyTransparencyService** → JSON path (row → entry mapping) + PDF path (pdfkit PassThrough). Verify: label mapping unit tests.
5. **T5 — Route** → instantiate service inside `heartNoteRoutes`, add POST route with `requireMember` and dual-format handler. Verify: route tests (auth, formats, empty log, 400).
6. **T6 — UI** → find Account page, add section + `downloadLog` helper + role gate. Verify: web component tests.
7. **T8 — Gates** → `pnpm typecheck` + full API + web test suites.

### Completion Notes

Implemented FR80 end-to-end: `POST /v1/heart-notes/transparency-log` (dual-format JSON + PDF), the first read method on `AuditRepository`, a deterministic `AllergyTransparencyService`, and a gated download UI on the existing Account page. No migrations, no AI in the export path. The following spec↔codebase reconciliations were made (all preserve the AC intent):

1. **`BaseRepository` exposes `this.client`, not `this.supabase`.** AC2's snippet used `this.supabase.from(...)`; the real `BaseRepository` (which `AuditRepository extends`) stores the Supabase client as `this.client`. Used `this.client` — matching the existing `insert()` method and every other repository.

2. **Contracts import `zod` (not `zod/v4`).** AC4/PSI #4 suggested `import { z } from 'zod/v4'`, but the contracts package pins `zod@^4` and every existing contract file (incl. `heart-notes.ts`) imports `from 'zod'`. Matched that — `zod` already resolves to v4.

3. **`hkFetch` returns parsed JSON, not a `Response` — added `hkFetchBlob`.** AC6's `downloadLog` snippet called `res.ok` / `res.blob()` on the `hkFetch` return value, but this repo's `hkFetch` returns the already-parsed JSON body (and would call `.json()` on a PDF → throw). Added a small `hkFetchBlob(path, init): Promise<Blob>` to `apps/web/src/lib/fetch.ts` that mirrors `hkFetch`'s auth header + single 401-refresh-and-retry but returns the raw body as a `Blob`. `handleDownload` uses it. This keeps all fetching inside the single `lib/fetch.ts` client (project-context rule) rather than hand-rolling auth in the component.

4. **Button primitive + tokens.** AC6's JSX used `<SecondaryButton>` and `text-heading3` / `text-body`. The real `SecondaryButton` *requires* an `icon` prop and is a muted ghost button (Skip/Swap/Pause), unsuited to a two-button download row; and `text-heading3`/`text-body` are not classes in this repo. Per CLAUDE.md "match existing style", used raw bordered buttons + the Account page's own section idiom (`<h2 className="font-serif text-xl text-fg">`, `text-sm text-fg-muted`, `rounded border border-border`). Same as the page's existing "Send password reset email" secondary button.

5. **Account page already existed** at `apps/web/src/routes/(app)/account.tsx` — added the "Allergy safety log" section there; no new route created. Role gate reads `useAuthStore((s) => s.user?.role)` and renders only for `primary_parent` / `secondary_caregiver`.

6. **Timestamp normalization.** Supabase serializes `timestamptz` with a `+00:00` offset, which zod `.datetime()` (no `offset` option, as the contract specifies) rejects. The service normalizes each row via `new Date(row.created_at).toISOString()` → Z-suffixed ISO that satisfies `AllergyEventEntrySchema.timestamp`. Same for `exported_at`.

7. **Export is not self-audited** (open question #2): no `account.exported` / `allergy.transparency_log_exported` row is written — FR80 doesn't require it. The `audit_log` table is read-only in this slice.

8. **Verification.** Typecheck — API 11 errors (≤14 baseline; **0 new**, all in pre-existing files: `evals/runner.ts`, `households/health/voice` tests, `contracts/heart-notes.ts`), web 3 errors (= documented baseline; **0 new**: `child-bag-composition.tsx` ×2 + `heart-notes.ts`). API suite — **24 new tests pass** (repo 5, service 10, route 9); full run 19 failed / 1420 passed / 13 skipped. The PSI #6 figure ("22-fail/1281-pass") has drifted as the suite grew, so the invariant was proven directly: every one of the 19 failing files is **outside this slice's change set** (`auth.routes`, `children.repository`, `extra-library.repository`, `memory.service`, `plan-adjustment.service`, `catalog-seed.service`, `onboarding.tools`, `lunch-link-dev`, and the long-standing `audit.types` code↔migration enum-parity drift — whose diff contains **no `allergy.*` entries**). `heart-note.routes.test.ts`, which imports the route file I modified, **passes**. Web suite — **389/389 pass** (incl. 4 new). ESLint on all changed files is clean (the `account.test.tsx` `import()`-type line matches the committed `kitchen-profile.test.tsx` pattern; the `account.tsx:102` exhaustive-deps warning is on the pre-existing profile-load effect, untouched by this slice).

**Remaining:** T8.4 manual demo is a USER-SIDE GATE — requires a live stack + ≥1 `allergy.*` row in `audit_log` (see Demo Path).

### File List

**New:**
- `packages/contracts/src/allergy-transparency.ts`
- `apps/api/src/modules/allergy-transparency/allergy-transparency.service.ts`
- `apps/api/src/modules/allergy-transparency/allergy-transparency.service.test.ts`
- `apps/api/src/audit/audit.repository.test.ts`
- `apps/api/src/modules/heart-notes/transparency-log.routes.test.ts`
- `apps/web/src/routes/(app)/account.test.tsx`

**Modified:**
- `packages/contracts/src/index.ts` — re-export `./allergy-transparency.js`
- `apps/api/package.json` — `pdfkit` (dep) + `@types/pdfkit` (devDep)
- `pnpm-lock.yaml` — pdfkit dependency tree
- `apps/api/src/audit/audit.types.ts` — `AllergyAuditRow` type
- `apps/api/src/audit/audit.repository.ts` — `findAllergyEventsByHousehold` read method
- `apps/api/src/modules/heart-notes/heart-note.routes.ts` — transparency-log POST route + service wiring
- `apps/web/src/lib/fetch.ts` — `hkFetchBlob` helper
- `apps/web/src/routes/(app)/account.tsx` — Allergy safety log section + `handleDownload` + role gate
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — status tracking

---

## References

- [Source: `_bmad-output/planning-artifacts/epics.md` §Story 4.15] — FR80 user story: `POST /v1/heart-notes/transparency-log`; query pattern; JSON or PDF export
- [Source: `_bmad-output/planning-artifacts/epics.md` §FR80] — "System produces a transparency log exportable to the parent on request showing every system action taken for allergy-relevant decisions affecting their household."
- [Source: `_bmad-output/planning-artifacts/epic-4-vertical-slices.md` §Slice 4-S17] — demo path; layers touched; `POST /v1/heart-notes/transparency-log`
- [Source: `supabase/migrations/20260501140000_create_audit_log_partitioned.sql`] — audit_log schema, composite index `(household_id, event_type, correlation_id, created_at)`, monthly partitions
- [Source: `supabase/migrations/20260501110000_create_audit_event_type_enum.sql`] — Postgres enum definition for `audit_event_type`
- [Source: `apps/api/src/audit/audit.types.ts` lines 76–79] — three allergy event types: `allergy.guardrail_rejection`, `allergy.uncertainty`, `allergy.check_overridden`
- [Source: `apps/api/src/audit/audit.repository.ts`] — existing write-only AuditRepository; `findAllergyEventsByHousehold` is the first read method
- [Source: `apps/api/src/modules/allergy-guardrail/allergy-guardrail.service.ts` lines 67–75] — allergy event write pattern + metadata structure
- [Source: `apps/api/src/modules/heart-notes/heart-note.routes.ts`] — heartNoteRoutes plugin (add transparency-log route here); `requireMember` prehandler already in scope
- [Source: `packages/contracts/src/heart-notes.ts`] — contract schema pattern to follow
- [Source: `_bmad-output/planning-artifacts/epics.md` §Story 7.7] — future `account.exported` event type (FR71 full JSON export — this slice does not implement that, just the allergy subset)

---

## Previous Story Intelligence (from 4-S16, 4-S15, 4-S13)

1. **`heartNoteRoutes` is a Fastify plugin using `fp()`** — add the new transparency-log route inside the existing plugin closure, not as a standalone `app.register()` call in `app.ts`. This avoids a new plugin entry and reuses the scoped `requireMember` prehandler.
2. **`requireMember` prehandler** allows `primary_parent` + `secondary_caregiver`. It is already declared and in scope inside `heartNoteRoutes`. **Do not re-declare it.** The transparency-log route uses it as-is.
3. **Fastify + Readable stream:** `reply.type('application/pdf').send(readableStream)` — Fastify detects the stream and pipes it without JSON serialization. Do not include a Zod `response` schema for this code path; it is irrelevant for stream replies.
4. **Zod import in contracts package:** `import { z } from 'zod/v4'` — matching the Zod v4 upgrade (Story 1-16). Check the existing imports in `packages/contracts/src/heart-notes.ts` for the exact pattern used in this repo.
5. **Supabase client chaining pattern** for read queries — look at `heart-note.repository.ts` or `allergy-guardrail.repository.ts` for the `.from().select().eq().order()` chain shape to mirror in `findAllergyEventsByHousehold`.
6. **API test baseline:** 22 failed / 1281 passed (pre-existing). Web: 378–385 (varied). New tests must not disturb this baseline — assert your new tests add to the passing count without touching pre-existing failure count.
7. **Download trigger in browser:** Use `URL.createObjectURL(blob)` + synthetic `<a>` click + `URL.revokeObjectURL()`. Do **not** use `window.location.href` (page navigation, not download) or `window.open()` (popup blocked, wrong MIME type handling). The `document.body.appendChild` + `removeChild` dance is needed because some browsers require the anchor to be in the DOM before `.click()`.
8. **hkFetch for authenticated requests** from the web: `apps/web/src/lib/fetch.ts`. This wraps `fetch` with the auth header from the session. Use it for the POST body request. (4-S15 intelligence #5.)
9. **Guest author (grandparent) role gating in UI** — look at how other parent-only sections check the user's role in the auth store. The same pattern applies to hiding the Allergy safety log section from `guest_author` users.

---

## Open Questions for Menon (non-blocking — story ships as written)

**1. Route namespace.** The spec says `POST /v1/heart-notes/transparency-log`. This is the authoritative path. However, the feature is about allergy audit events, not heart notes. If you'd prefer to rename it before dev starts (e.g., `POST /v1/allergy/transparency-log` or `GET /v1/allergy-log/export?format=pdf`), let me know — it's a one-line change in the spec that cascades to the route file and the web fetch URL. The story implements the spec route as-is.

**2. Audit the export action?** Story 7.7 (full JSON export, future) plans an `account.exported` audit row. This slice does **not** write an audit row for the allergy log download (not in the FR80 spec). If you want an `allergy.transparency_log_exported` event written each time a parent downloads the log, flag it — it is a one-line `auditService.write()` call. Otherwise, ships without self-auditing.

**3. Account/Privacy page.** The demo says "Account → Privacy" but the exact route in the web app is not confirmed. The dev agent will locate it from `apps/web/src/routes/`. If no account page exists yet, it will be created and the story notes this as a new file.

---

## Review Findings

- [x] [Review][Decision] Heading level `<h2>` vs spec `<h3>` — resolved: keep `<h2>` (matches existing Account page section idiom; page consistency over spec letter per Menon 2026-06-03)
- [x] [Review][Patch] PDFDocument error event not forwarded to PassThrough — `doc.on('error', (err) => pass.destroy(err))` added. [`apps/api/src/modules/allergy-transparency/allergy-transparency.service.ts`]
- [x] [Review][Patch] `detailFor` has no default branch — `default: return null` added to switch. [`apps/api/src/modules/allergy-transparency/allergy-transparency.service.ts`]
- [x] [Review][Patch] Missing test: `secondary_caregiver` role should see the allergy section — test added. [`apps/web/src/routes/(app)/account.test.tsx`]
- [x] [Review][Patch] Missing test: no `Content-Type: application/json` assertion on JSON 200 response — assertion added. [`apps/api/src/modules/heart-notes/transparency-log.routes.test.ts`]
- [x] [Review][Patch] Missing test: no assertion that `Content-Disposition` is absent on JSON 200 response — assertion added. [`apps/api/src/modules/heart-notes/transparency-log.routes.test.ts`]
- [x] [Review][Defer] `AllergyAuditRow` bare TypeScript cast `as AllergyAuditRow[]` — no runtime validation on DB rows; codebase-wide pattern, defer [`apps/api/src/audit/audit.repository.ts`] — deferred, pre-existing pattern
- [x] [Review][Defer] Malformed `created_at` string would throw `RangeError` in `mapRow` — Postgres `timestamptz` is reliable in practice; defer [`apps/api/src/modules/allergy-transparency/allergy-transparency.service.ts`] — deferred, pre-existing
- [x] [Review][Defer] No pagination on `findAllergyEventsByHousehold` — unbounded query for long-lived households; out of scope for this slice — deferred, pre-existing
- [x] [Review][Defer] `URL.revokeObjectURL` called synchronously after `a.click()` — spec-prescribed pattern; acceptable in modern browsers; revisit if Safari/download-dialog issues are reported [`apps/web/src/routes/(app)/account.tsx`] — deferred, pre-existing
- [x] [Review][Defer] hkFetchBlob: first 401 response body not consumed before retry — minor TCP resource concern; no user impact at this scale [`apps/web/src/lib/fetch.ts`] — deferred, pre-existing
- [x] [Review][Defer] `joinList` returns `", "` for array of empty strings — data-quality issue in the allergy guardrail writer, not in the transparency service — deferred, pre-existing
- [x] [Review][Defer] PDF Content-Disposition date (server TZ) vs client download filename date (client TZ) mismatch at timezone boundary — cosmetic; defer [`apps/api/src/modules/heart-notes/heart-note.routes.ts`] — deferred, pre-existing
- [x] [Review][Defer] Concurrent double-click race before `downloading` state re-renders — disabled state prevents this in practice; extremely narrow window — deferred, pre-existing

---

## Change Log

| Date | Change |
|------|--------|
| 2026-06-03 | Story 4-S17 created — Allergy Transparency Log Export. Implements FR80: `POST /v1/heart-notes/transparency-log`, dual-format (JSON + PDF via pdfkit), `AuditRepository.findAllergyEventsByHousehold` (first read method on AuditRepository), `AllergyTransparencyService` with deterministic label mapping, web download UI in Account/Privacy page. No migrations needed (enum + audit_log already ship allergy.* types). Status: ready-for-dev. |
| 2026-06-03 | Implemented all tasks (T1–T8.3). pdfkit installed (api-only); contracts + `AuditRepository.findAllergyEventsByHousehold` + `AllergyTransparencyService` (deterministic label map, streaming PDF via `PassThrough`) + dual-format route inside `heartNoteRoutes` + Account-page download section (role-gated). Added `hkFetchBlob` to `lib/fetch.ts` (binary download path — `hkFetch` parses JSON). 24 new API tests + 4 web tests, all green; web 389/389; typecheck 0 new errors (API 11, web 3 = baselines); changed files lint-clean. 8 spec↔codebase reconciliations recorded in Dev Agent Record. T8.4 manual demo remains a USER-SIDE GATE. Status: ready-for-dev → review. |
