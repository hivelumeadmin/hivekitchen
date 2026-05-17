# Story 4.s1: Compose Heart Note Draft

Status: done

**Slice key:** `4-s1-compose-heart-note-draft`
**Epic:** 4 — Lunch Link & Heart Note Sacred Channel
**Source slice doc:** `_bmad-output/planning-artifacts/epic-4-vertical-slices.md` §Slice 4-S1
**Builds on:** 2-10 (children table + encryption infra), 1-8 (audit log), 1-6 (Fastify base)

---

## Story

As a **parent**,
I want **to type a Heart Note for my child, save it, and have it persist across page reloads**,
so that **my note is ready to be delivered when the school day arrives**.

---

## Acceptance Criteria

**AC1.** `POST /v1/heart-notes` creates a row with `status='draft'`, content stored as **plaintext** (encryption is explicitly deferred to S5).

**AC2.** `GET /v1/heart-notes?child_id=<uuid>&date=<YYYY-MM-DD>` returns `{ note: HeartNoteRow }` for the matching draft, or `{ note: null }` if none exists. Scoped to caller's household.

**AC3.** `PATCH /v1/heart-notes/:id` updates `content` (and optionally `scheduled_for`). Returns the updated row. Throws 404 if the row doesn't belong to the caller's household.

**AC4.** `GET /v1/households/:id/children` returns `{ children: ChildRow[] }` for the household — the compose flow uses this to pick the active child.

**AC5.** `/app/heart-note` fetches the children list on mount, picks `children[0]`, then fetches today's draft. If no draft exists the textarea is empty; a new note is created (POST) on first keystroke.

**AC6.** Autosave fires ~1.5 s after the user stops typing. The saved-hint area shows "Saving…" during the in-flight call and "Saved at HH:MM" on success.

**AC7.** The "Save the note" button in `HeartNoteActions` manually triggers a save immediately (flushes the pending autosave).

**AC8.** Reload `/app/heart-note` — the draft text is still there.

**AC9.** `heart_notes` table exists in Supabase with RLS; household members can read/write their own rows only.

**AC10.** `heart_note.created` and `heart_note.updated` audit events are emitted on POST and PATCH respectively.

---

## Demo Path

> Open `/app/heart-note`, type a message, wait 1.5 s → see "Saved at HH:MM". Reload → text persists. Open Supabase → confirm row in `heart_notes` table.

Manual test steps:
1. Log in as parent.
2. Navigate to `/app/heart-note`.
3. Type into the StationeryCard textarea.
4. Wait ~1.5 s — see "Saving…" then "Saved at HH:MM".
5. Refresh the page — your text is still there.
6. Supabase SQL editor: `SELECT * FROM heart_notes` — row exists.

---

## Critical Guardrails — Read First

**DO NOT use TanStack Query.** The slice doc mentions it but the project uses `hkFetch` + `useState`/`useEffect`. TanStack Query is not installed. Do not add it.

**DO NOT use React Hook Form (RHF).** The slice doc mentions it but `StationeryCard` already uses `useState` controlled by the parent. Keep that pattern.

**DO NOT add encryption.** Plaintext storage for S1. Encryption ships in S5.

**DO NOT add voice/mic button.** Voice composition ships in S7.

**DO NOT add scheduling controls.** Date picker / status pills ship in S6.

**DO NOT redesign the UI.** The `heart-note.tsx` route and all its feature components already exist from γ Phase 4 and are v2.0-compliant. This slice replaces mock data with real API calls — no layout or component design changes needed.

---

## What Already Exists (Do Not Recreate)

**Route (mock-data backed, needs wiring):**
- `apps/web/src/routes/(app)/heart-note.tsx` — uses `heartNoteMock`, renders `StationeryCard`, `PageHeader`, `HeartNoteActions`, `MealPreviewCard`, `ReactionCard`, `LumiPresenceCard`.

**Feature components (all mock-data, do not change structure):**
- `apps/web/src/features/heart-note/components/StationeryCard.tsx` — accepts `draftText` prop, manages text with internal `useState(props.draftText)`, has `savedHint` string prop in footer. **Add `onTextChange?: (t: string) => void`** to let the route receive text for autosave.
- `apps/web/src/features/heart-note/components/HeartNoteActions.tsx` — renders `StickyBottomBar` with "Save the note" + "Skip today". `onSave` prop already exists.
- `apps/web/src/features/heart-note/components/MealPreviewCard.tsx`, `ReactionCard.tsx`, `LumiPresenceCard.tsx` — remain mock-backed for S1 (real meal/reaction data wires in later slices).

**Children repository method (already exists):**
- `apps/api/src/modules/children/children.repository.ts` exposes `findByHouseholdId(householdId)` — reuse this for the list endpoint (AC4/T6.2). Do not add a duplicate method.

**Contracts:**
- `packages/contracts/src/children.ts` already exports `ChildResponseSchema` — reuse for `ListChildrenResponseSchema`.

---

## Tasks

- [x] **T1 — DB migrations**
  - [x] T1.1 `supabase/migrations/20260901000000_create_heart_notes.sql`
    ```sql
    CREATE TABLE heart_notes (
      id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      household_id   uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
      child_id       uuid NOT NULL REFERENCES children(id)  ON DELETE CASCADE,
      author_user_id uuid NOT NULL REFERENCES users(id)     ON DELETE SET NULL,
      content        text NOT NULL DEFAULT '',
      status         text NOT NULL DEFAULT 'draft',
      scheduled_for  date,
      created_at     timestamptz NOT NULL DEFAULT now(),
      updated_at     timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE heart_notes ENABLE ROW LEVEL SECURITY;
    -- Household members can read/write their own notes
    CREATE POLICY heart_notes_household ON heart_notes
      USING (household_id = (SELECT household_id FROM users WHERE id = auth.uid()))
      WITH CHECK (household_id = (SELECT household_id FROM users WHERE id = auth.uid()));
    -- updated_at trigger: follow pattern from 20260510000500_children_updated_at_trigger.sql
    ```
  - [x] T1.2 `supabase/migrations/20260901000100_add_heart_note_audit_types.sql`
    — Extend the `audit_event_type` enum: add `'heart_note.created'` and `'heart_note.updated'`.
    Follow the pattern in `20260600000400_add_onboarding_and_tile_audit_types.sql`.

- [x] **T2 — Contracts**
  - [x] T2.1 New file `packages/contracts/src/heart-notes.ts`
    ```typescript
    import { z } from 'zod';

    export const HeartNoteStatusSchema = z.enum([
      'draft', 'scheduled', 'delivered', 'viewed', 'rated', 'cancelled',
    ]);

    export const CreateHeartNoteBodySchema = z.object({
      child_id: z.string().uuid(),
      content: z.string().max(280).default(''),
      scheduled_for: z.string().date().optional(),
    });

    export const PatchHeartNoteBodySchema = z.object({
      content: z.string().max(280).optional(),
      scheduled_for: z.string().date().nullable().optional(),
    });

    export const HeartNoteResponseSchema = z.object({
      id: z.string().uuid(),
      household_id: z.string().uuid(),
      child_id: z.string().uuid(),
      author_user_id: z.string().uuid(),
      content: z.string(),
      status: HeartNoteStatusSchema,
      scheduled_for: z.string().date().nullable(),
      created_at: z.string().datetime(),
      updated_at: z.string().datetime(),
    });

    export const HeartNotePayloadSchema = z.object({ note: HeartNoteResponseSchema });
    export const HeartNoteNullablePayloadSchema = z.object({ note: HeartNoteResponseSchema.nullable() });
    export const GetHeartNotesQuerySchema = z.object({
      child_id: z.string().uuid(),
      date: z.string().date().optional(),
    });
    export const HeartNoteIdParamSchema = z.object({ id: z.string().uuid() });

    export type HeartNoteStatus = z.infer<typeof HeartNoteStatusSchema>;
    export type CreateHeartNoteBody = z.infer<typeof CreateHeartNoteBodySchema>;
    export type PatchHeartNoteBody = z.infer<typeof PatchHeartNoteBodySchema>;
    export type HeartNoteResponse = z.infer<typeof HeartNoteResponseSchema>;
    export type GetHeartNotesQuery = z.infer<typeof GetHeartNotesQuerySchema>;
    ```
  - [x] T2.2 In `packages/contracts/src/children.ts`, add at the bottom:
    ```typescript
    export const ListChildrenResponseSchema = z.object({ children: z.array(ChildResponseSchema) });
    export type ListChildrenResponse = z.infer<typeof ListChildrenResponseSchema>;
    ```
  - [x] T2.3 In `packages/contracts/src/index.ts`, add:
    ```typescript
    export * from './heart-notes.js';
    // ListChildrenResponseSchema is already covered by the existing children export
    ```
    (If `children.ts` is already re-exported, `ListChildrenResponseSchema` will auto-export.)

- [x] **T3 — Audit types**
  - [x] T3.1 In `apps/api/src/audit/audit.types.ts`, add to the `AuditEventType` union:
    `'heart_note.created' | 'heart_note.updated'`

- [x] **T4 — API repository**
  - [x] T4.1 New file `apps/api/src/modules/heart-notes/heart-note.repository.ts`
    ```typescript
    // Methods (all scoped to household_id for safety):
    create(data: { householdId, childId, authorUserId, content, scheduledFor? }): Promise<HeartNoteRow>
    findByChildAndDate(householdId, childId, date): Promise<HeartNoteRow | null>
    patch(id, householdId, data): Promise<HeartNoteRow | null>  // null = not found in household
    ```
    `HeartNoteRow` = the DB row shape (mirror `HeartNoteResponseSchema` fields).
    Use `fastify.supabase` (service-role) — follow the same `.from('heart_notes')` pattern as other repositories.

- [x] **T5 — API service**
  - [x] T5.1 New file `apps/api/src/modules/heart-notes/heart-note.service.ts`
    ```typescript
    createDraft(householdId, authorUserId, body: CreateHeartNoteBody): Promise<HeartNoteRow>
    getDraft(householdId, childId, date: string): Promise<HeartNoteRow | null>
    patchNote(id, householdId, body: PatchHeartNoteBody): Promise<HeartNoteRow>
      // throws NotFoundError if patch returns null (row not in caller's household)
    ```

- [x] **T6 — API routes**
  - [x] T6.1 New file `apps/api/src/modules/heart-notes/heart-note.routes.ts`
    - `requireMember = authorize(['primary_parent', 'secondary_caregiver'])`
    - `POST /v1/heart-notes` → `service.createDraft()`; set `request.auditContext` to `heart_note.created`
    - `GET /v1/heart-notes` (querystring: `GetHeartNotesQuerySchema`) → `service.getDraft()`; defaults `date` to today's ISO date (`new Date().toISOString().slice(0, 10)`) if omitted
    - `PATCH /v1/heart-notes/:id` (params: `HeartNoteIdParamSchema`) → `service.patchNote()`; set `request.auditContext` to `heart_note.updated`
    - All handlers follow thin-handler rule: call service, return result.
  - [x] T6.2 In `apps/api/src/modules/children/children.routes.ts`, add list endpoint **before** the single-child GET:
    ```typescript
    fastify.get('/v1/households/:id/children', {
      preHandler: requireMember,
      schema: { response: { 200: ListChildrenResponseSchema } },
    }, async (request) => {
      const { id: householdId } = request.params as { id: string };
      assertCallerInHousehold(request.user.household_id, householdId);
      const children = await childrenRepository.findByHouseholdId(householdId);
      return { children };
    });
    ```
    `ListChildrenResponseSchema` is already imported from `@hivekitchen/contracts` — add it to the imports block.
  - [x] T6.3 In `apps/api/src/app.ts`:
    - Add import: `import { heartNoteRoutes } from './modules/heart-notes/heart-note.routes.js';`
    - Register: `await fastify.register(heartNoteRoutes);` — add it alongside the other module route registrations.

- [x] **T7 — Web: wire `heart-note.tsx` route**
  - [x] T7.1 Add `onTextChange?: (text: string) => void` to `StationeryCardProps` in `StationeryCard.tsx`. Call it in the `onChange` handler: `onChange={(e) => { setText(e.target.value); props.onTextChange?.(e.target.value); }}`.
  - [x] T7.2 Rewrite `apps/web/src/routes/(app)/heart-note.tsx`:
    - Remove all `heartNoteMock` imports and usages.
    - `const { user } = useAuthStore()` — household_id comes from `user.household_id`.
    - `const todayDate = new Date().toISOString().slice(0, 10)` (YYYY-MM-DD).
    - On mount (useEffect with `[]`): fetch children → pick `children[0]` → fetch today's draft.
    - State: `noteId`, `children`, `activeChild`, `savedHint`, `saveStatus: 'idle' | 'saving' | 'saved'`.
    - Autosave via `useRef` debounce timer (see pattern below).
    - "Save the note" button: `onSave={() => { clearTimeout(timer.current); flushSave(); }}`.
    - Pass `draftText` (from loaded note), `onTextChange`, `savedHint` to `StationeryCard`.
    - Pass `childName`, `eyebrow` derived from `activeChild`.
    - `MealPreviewCard`, `ReactionCard`, `LumiPresenceCard` remain static with mock or placeholder props — do not block on real data.

    **Autosave debounce pattern:**
    ```typescript
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    function handleTextChange(text: string) {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      setSaveStatus('idle');
      saveTimerRef.current = setTimeout(() => void flushSave(text), 1500);
    }

    async function flushSave(text: string) {
      setSaveStatus('saving');
      try {
        if (noteId === null) {
          // first save — POST
          const { note } = await hkFetch<{ note: HeartNoteResponse }>('/v1/heart-notes', {
            method: 'POST',
            body: { child_id: activeChild.id, content: text },
          });
          setNoteId(note.id);
        } else {
          await hkFetch(`/v1/heart-notes/${noteId}`, { method: 'PATCH', body: { content: text } });
        }
        const t = new Date();
        setSavedHint(`Saved at ${t.getHours().toString().padStart(2,'0')}:${t.getMinutes().toString().padStart(2,'0')}`);
        setSaveStatus('saved');
      } catch {
        setSavedHint('Save failed');
        setSaveStatus('idle');
      }
    }
    ```
  - [x] T7.3 Delete `apps/web/src/features/heart-note/data/mockData.ts` once the route no longer imports it.

- [x] **T8 — Tests**
  - [x] T8.1 `packages/contracts/src/heart-notes.test.ts` — round-trip tests:
    - Valid `HeartNoteResponseSchema` parse (with `scheduled_for: null`).
    - Valid `HeartNoteResponseSchema` parse (with `scheduled_for: '2026-09-01'`).
    - Reject missing `id`.
    - Reject invalid `status` enum value.
    - `CreateHeartNoteBodySchema` rejects content > 280 chars.
  - [x] T8.2 `apps/api/src/modules/heart-notes/heart-note.service.test.ts` — unit tests with mock repository:
    - `createDraft` returns the created row.
    - `patchNote` throws `NotFoundError` when repo returns null.
  - [x] T8.3 `apps/api/src/modules/heart-notes/heart-note.routes.test.ts` — Fastify inject:
    - POST 201 with valid body.
    - GET returns `{ note: null }` when no draft exists.
    - PATCH 200 on existing note.
    - PATCH 404 when note not in household.
    - GET/POST/PATCH 401 without auth token.

---

## File List

**New files:**
- `supabase/migrations/20260901000000_create_heart_notes.sql`
- `supabase/migrations/20260901000100_add_heart_note_audit_types.sql`
- `packages/contracts/src/heart-notes.ts`
- `packages/contracts/src/heart-notes.test.ts`
- `apps/api/src/modules/heart-notes/heart-note.repository.ts`
- `apps/api/src/modules/heart-notes/heart-note.service.ts`
- `apps/api/src/modules/heart-notes/heart-note.routes.ts`
- `apps/api/src/modules/heart-notes/heart-note.service.test.ts`
- `apps/api/src/modules/heart-notes/heart-note.routes.test.ts`

**Modified files:**
- `packages/contracts/src/children.ts` — add `ListChildrenResponseSchema`
- `packages/contracts/src/index.ts` — export `./heart-notes.js`
- `apps/api/src/audit/audit.types.ts` — add new event types
- `apps/api/src/modules/children/children.routes.ts` — add list endpoint
- `apps/api/src/app.ts` — import + register `heartNoteRoutes`
- `apps/web/src/routes/(app)/heart-note.tsx` — replace mock with real API
- `apps/web/src/features/heart-note/components/StationeryCard.tsx` — add `onTextChange` prop

**Deleted files:**
- `apps/web/src/features/heart-note/data/mockData.ts`

---

## Dev Agent Record

**Implementation notes:**

- Followed the story tasks in order T1→T8 with one substitution at T7.1: the slice doc proposed inlining the `Envelope` type from a mock file, but the cleanest path was to (a) export `Envelope` from `StationeryCard.tsx` itself (the only owner) and (b) move `ChildReaction` / `MealPreview` into `ReactionCard.tsx` / `MealPreviewCard.tsx`. This let `mockData.ts` be deleted without leaving orphan type imports.
- `StationeryCard` gains a `useEffect` that re-syncs internal `text` state when the parent's `draftText` changes (the initial value is null on first render, then the API resolves and seeds the textarea). The card's own controlled state keeps typing responsive even when the autosave fetch is in flight.
- Autosave is implemented with a `useRef`-held timer + a `pendingTextRef`. If the user types while a save is in flight, the in-flight handler drains the latest pending text after it resolves so we never miss a keystroke.
- The dev preview route `apps/web/src/routes/_dev-heart-note.tsx` inlined the prior mock values (it imported `heartNoteMock` from the deleted file). The dev preview is intentionally a static stub — only the production `/app/heart-note` route loads real data.
- 4-S1 ships the sacred-channel doctrine deliberately incomplete: content is plaintext at rest. The 4-S5 slice adds envelope encryption + the lint rule that blocks LLM calls anywhere near the heart-note delivery path. Reviewers should not treat the plaintext storage as a bug.

**Deviations from story (none material):**

- Story task T2.3 referenced "add `export * from './heart-notes.js'`". Implemented as written; the children re-export was already in place so `ListChildrenResponseSchema` flows through without extra wiring.
- T7.2's autosave pattern in the story file was a sketch; the actual implementation adds in-flight drain handling (in case the user types faster than the network) and a `bootError` surface for the no-children-yet edge case.

**Test results:**

- `packages/contracts` — 33/33 heart-notes tests pass; full contracts run 618/620 (the 2 unrelated failures in `cultural.test.ts` and `day-override.test.ts` are pre-existing — `git diff HEAD --stat` confirms zero changes to those files this session).
- `apps/api` — 84/84 across heart-notes + children pass (service: 7, routes: 11, contracts: 33, plus 33 children tests untouched).
- `pnpm typecheck` — all 4-S1 files clean. Pre-existing API typecheck errors in `plan-regeneration.job.test.ts`, `voice.service.test.ts`, `households.routes.test.ts`, `brief-state.composer.test.ts`, `day-overrides.repository.test.ts`, `plans.service.test.ts` are unchanged from HEAD (zero diff against any of them this session).
- `pnpm lint` — no heart-notes / children files appear in the lint failure list.

**⚠️ Pre-existing audit-types parity gap surfaced by 4-S1 work (not introduced here):**

The `audit.types.test.ts` parity check now fails. Investigation shows the TS file already contained `onboarding.reset / onboarding.resume_offered / onboarding.resumed` (added in slice 2-S26, committed yesterday), but no SQL migration was created to add those values to the `audit_event_type` Postgres enum. My 4-S1 heart_note entries DO have a paired migration (`20260901000100_add_heart_note_audit_types.sql`), so they are not the cause. Recommend a one-line follow-up migration adding the 3 missing `onboarding.*` ALTER TYPE statements — out of scope for this slice but the user should be aware before the next deploy.

**Completion checklist:**
- [x] All tasks ticked
- [x] Story-relevant typecheck passes (all 4-S1 files clean)
- [x] Story-relevant lint passes (no 4-S1 files in lint failures)
- [x] All 3 API endpoints unit-tested via Fastify `inject()` (happy path, validation failure, auth failure, 404)
- [x] Story status updated to `review`

---

## Review Findings (Pass 1 — 2026-05-17)

All 10 ACs pass. 4 findings fixed:

| # | Sev | Finding | Fix |
|---|---|---|---|
| 1 | MEDIUM | POST `child_id` ownership not validated — cross-household child could be referenced | Added `HeartNoteRepository.childBelongsToHousehold()` (SELECT id only, no DEK); `HeartNoteService.createDraft()` throws 404 if check fails; routes test updated with `children` mock + new 404 test case |
| 2 | LOW | `bootError` not cleared at start of re-mount — stale error banner persisted after recovery | Added `setBootError(null)` before async boot in `heart-note.tsx` |
| 3 | LOW | `StationeryCard` showed green checkmark even on 'Save failed' — false positive | Added `saveError?: boolean` prop; `StationeryFooter` renders `AlertTriangleIcon` + `text-safety-red` on error, hides hint area when `savedHint` is empty |
| 4 | LOW | Missing `correlation_id` in heart-note audit contexts | Added `correlation_id: request.id` to POST and PATCH `request.auditContext` |

Post-patch test run: 20/20 heart-notes tests pass. Zero TypeScript errors in patched files.

**Pre-existing parity gap (not caused by 4-S1):** `onboarding.reset / onboarding.resume_offered / onboarding.resumed` exist in `audit.types.ts` but have no SQL migration. Recommend follow-up one-liner migration before next deploy.

---

## Change Log

| Date | Change |
|---|---|
| 2026-05-15 | Story created |
| 2026-05-15 | All tasks T1–T8 implemented and tested; status → review |
| 2026-05-17 | Review pass 1 — 4 findings patched; status → done |

---

- [Source: _bmad-output/planning-artifacts/epic-4-vertical-slices.md#Slice-4-S1]
