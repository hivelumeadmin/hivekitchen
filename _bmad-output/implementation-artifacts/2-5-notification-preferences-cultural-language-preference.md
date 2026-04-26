# Story 2.5: Notification preferences + cultural-language preference

Status: done

## Story

As a Primary Parent,
I want to configure when Lumi reaches out (weekly plan ready, grocery list ready) and set my preferred cultural-language for family terms,
so that the system respects my contact preferences and renders culturally-correct family-language without re-asking (FR105, FR106).

## Acceptance Criteria

1. **Given** I am authenticated, **When** I `PATCH /v1/users/me/notifications` with one or both of `{ weekly_plan_ready, grocery_list_ready }`, **Then** the `notification_prefs` JSONB column on the `users` table is updated (merged, not replaced) and the response is `200` with the updated `UserProfile`.
2. **Given** I am authenticated, **When** I `PATCH /v1/users/me/preferences` with `{ cultural_language }`, **Then** the `cultural_language` column is updated and the response is `200` with the updated `UserProfile`.
3. **Given** the family-language ratchet (UX-DR47), **When** `cultural_language` is currently any non-`'default'` value and a PATCH attempts to set it back to `'default'`, **Then** the service returns `409 Problem+JSON { type: "/errors/conflict" }` and the column is unchanged.
4. **Given** the Heart Note anti-pattern constraint (Story 4.13), **Then** `notification_prefs` contains ONLY `weekly_plan_ready` and `grocery_list_ready` fields — NO `heart_note_*` field of any kind — and the account page renders NO Heart Note toggle.
5. **Given** an unauthenticated request to either new endpoint, **Then** the response is `401`.
6. **Given** a request body with no recognized fields or invalid types, **Then** the response is `400 Problem+JSON { type: "/errors/validation" }`.
7. **Given** the updated profile, **When** `GET /v1/users/me` is called, **Then** the response includes `notification_prefs` (object) and `cultural_language` (string) at the top level.

## Tasks / Subtasks

- [x] Task 1 — DB migration: add `cultural_language` to `users` table (AC: 2, 3, 7)
  - [x] Create `supabase/migrations/20260503100000_add_cultural_language_to_users.sql`
  - [x] Define `CREATE TYPE cultural_language_preference AS ENUM (...)` (see Schema Design section for values)
  - [x] `ALTER TABLE users ADD COLUMN cultural_language cultural_language_preference NOT NULL DEFAULT 'default'`
  - [x] Rollback comment at top: `ALTER TABLE users DROP COLUMN cultural_language; DROP TYPE cultural_language_preference;`

- [x] Task 2 — Contracts: new Zod schemas (AC: 1, 2, 4, 6, 7)
  - [x] Add `NotificationPrefsSchema`, `UpdateNotificationPrefsRequestSchema`, `CulturalLanguageSchema`, `UpdateCulturalPreferenceRequestSchema` to `packages/contracts/src/users.ts`
  - [x] Extend `UserProfileSchema` with `notification_prefs: NotificationPrefsSchema` and `cultural_language: CulturalLanguageSchema`
  - [x] Export `CULTURAL_LANGUAGE_VALUES` const from `packages/contracts/src/users.ts`
  - [x] Add new types to `packages/types/src/index.ts`
  - [x] Add contract tests to `packages/contracts/src/users.test.ts`

- [x] Task 3 — API repository: extend for new columns (AC: 1, 2, 7)
  - [x] Add `notification_prefs` and `cultural_language` to `UserProfileRow` interface
  - [x] Update `PROFILE_COLUMNS` constant to include `notification_prefs, cultural_language`
  - [x] Add `notification_prefs` and `cultural_language` to `UpdateUserProfileInput` partial type
  - [x] The existing `updateUserProfile` method handles these automatically — no new repository methods needed

- [x] Task 4 — API service: business logic (AC: 1, 2, 3)
  - [x] Add `updateMyNotifications(userId, input): Promise<UserProfile>` — merges input over existing prefs
  - [x] Add `updateMyPreferences(userId, input): Promise<{ profile: UserProfile; fieldsChanged: string[] }>` — includes ratchet check
  - [x] Ratchet: `if (input.cultural_language === 'default' && currentRow.cultural_language !== 'default') throw new ConflictError(...)`

- [x] Task 5 — API routes: two new PATCH endpoints (AC: 1, 2, 5, 6)
  - [x] `PATCH /v1/users/me/notifications` in `user.routes.ts`
  - [x] `PATCH /v1/users/me/preferences` in `user.routes.ts`
  - [x] Wire `request.auditContext = { event_type: 'account.updated', ... }` on both (consistent with existing PATCH /v1/users/me)

- [x] Task 6 — API tests (AC: 1–6)
  - [x] Extend `user.routes.test.ts`: PATCH /v1/users/me/notifications tests (update, merge, 400 empty, 401)
  - [x] Extend `user.routes.test.ts`: PATCH /v1/users/me/preferences tests (update, ratchet 409, 400 invalid, 401)
  - [x] Extend `defaultUserRow()` to include `notification_prefs: {}` and `cultural_language: 'default'`

- [x] Task 7 — Frontend: extend account page (AC: 1, 2, 4)
  - [x] Extend `apps/web/src/routes/(app)/account.tsx` with a Notifications section (two checkboxes — no Heart Note)
  - [x] Add Family language section (select with ratchet UI: disable `'default'` option once a non-default value is stored)
  - [x] Update `GET /v1/users/me` fetch to initialize new state slices from `profile.notification_prefs` and `profile.cultural_language`

### Review Findings

- [x] [Review][Patch] Concurrent notification toggles: only the saving field's checkbox is disabled — enables concurrent in-flight PATCHes and read-modify-write clobber [apps/web/src/routes/(app)/account.tsx:329, 340]
- [x] [Review][Patch] Stale `previous` closure in `handleNotificationToggle`: concurrent toggle + failure sequence restores wrong baseline state [apps/web/src/routes/(app)/account.tsx:147]
- [x] [Review][Patch] `culturalLanguageLocked` derived from optimistic local `culturalLanguage` state — shows incorrect lock state on initial load before profile fetch completes [apps/web/src/routes/(app)/account.tsx:216]
- [x] [Review][Patch] `GET /v1/users/me` route test has no assertions for `notification_prefs` or `cultural_language` — AC7 is untested at the route level [apps/api/src/modules/users/user.routes.test.ts]
- [x] [Review][Patch] Merge test does not assert the argument passed to `_updateProfileSpy` — a replace-instead-of-merge regression would pass all current tests [apps/api/src/modules/users/user.routes.test.ts:146]
- [x] [Review][Patch] Unsafe `as CulturalLanguagePreference` cast in `toUserProfile` — no runtime validation; use `CulturalLanguageSchema.parse()` [apps/api/src/modules/users/user.service.ts:179]
- [x] [Review][Patch] `CULTURAL_LANGUAGE_VALUES` not re-exported from `packages/types` — `account.tsx` maintains a manually-duplicated enum array that will silently diverge when the enum is extended [packages/types/src/index.ts]
- [x] [Review][Patch] Test title "accepts both fields true" is incorrect — `grocery_list_ready` is `false` in that assertion [packages/contracts/src/users.test.ts:121]
- [x] [Review][Patch] Missing `UserProfileSchema` rejection test for a profile with `cultural_language` omitted [packages/contracts/src/users.test.ts]
- [x] [Review][Defer] Service-layer read-modify-write on `notification_prefs` has no row lock — concurrent PATCHes can silently overwrite each other [apps/api/src/modules/users/user.service.ts:95-107] — deferred, pre-existing infrastructure pattern; requires `jsonb_set` or `FOR UPDATE` locking
- [x] [Review][Defer] Ratchet check is service-only, not DB-enforced — concurrent forward-move PATCHes both reading `'default'` can both pass the guard [apps/api/src/modules/users/user.service.ts:121] — deferred, add DB CHECK constraint in a future hardening pass
- [x] [Review][Defer] `UnauthorizedError` (401) for user-not-found after valid JWT — should be 404/403; pre-existing pattern throughout this service [apps/api/src/modules/users/user.service.ts:96] — deferred, pre-existing
- [x] [Review][Defer] `updateMyPreferences` writes to DB even when input equals current value — wasted DB + Admin API round-trips on no-op PATCHes [apps/api/src/modules/users/user.service.ts:130] — deferred, minor optimisation

## Dev Notes

### Critical Constraints

**Heart Note anti-pattern (Story 4.13 — lint rule active):** `notification_prefs` contains ONLY `weekly_plan_ready` (bool) and `grocery_list_ready` (bool). No `heart_note_*` field anywhere. The lint rule `no-heart-note-frequency-reference` blocks string literals matching `streak|reminder|absence|haven't written|been quiet` adjacent to `heart_note` references in all three app source dirs. Do not add any such field or string.

**Family-language ratchet (UX-DR47):** "Forward only; once a household uses 'Nani', Lumi never retreats to 'Grandma'." Implement this at the service layer: if `input.cultural_language === 'default'` and the current stored value is any non-`'default'` enum member, throw `new ConflictError('Family language cannot be reversed once set')` — this surfaces as `409`. Changing from one non-default value to another non-default value IS allowed.

**`notification_prefs` column already exists:** The column `notification_prefs jsonb NOT NULL DEFAULT '{}'` was added in migration `20260501120000_create_users_and_households.sql`. Do NOT add it again. The migration for this story adds only `cultural_language`.

**`account.updated` audit event:** Reuse the existing `'account.updated'` event type for both new PATCH endpoints. Pass `metadata: { fields_changed: ['notification_prefs'] }` or `['cultural_language']`. No new audit event types needed.

**Idempotency-Key (architecture §3.2):** The global idempotency plugin (`apps/api/src/plugins/idempotency.ts`) has not yet been implemented — story 2-4's PATCH /v1/users/me shipped without it, and its tests omit the header. Do NOT implement the global plugin in this story. Accept an `Idempotency-Key` header silently on both new routes but do not enforce it.

### Project Structure Notes

- All new API code stays in `apps/api/src/modules/users/` — consistent with story 2-4 (overrides the architecture table which maps FR105–FR106 to `modules/auth/` + `households/`).
- Frontend route: architecture says `/app/household/settings` but the existing account page is `apps/web/src/routes/(app)/account.tsx` at `/account`. Extend the existing route — do NOT create a new route.
- Next migration filename after `20260502190000_create_invites.sql`: `20260503100000_add_cultural_language_to_users.sql`.

### Schema Design

**`cultural_language_preference` Postgres enum** (aligned with FR6 cultural templates):

```sql
CREATE TYPE cultural_language_preference AS ENUM (
  'default',        -- English family terms (Grandma, Grandpa)
  'south_asian',    -- South Asian (Nani, Nana, Dadi, Dada)
  'hispanic',       -- Spanish (Abuela, Abuelo)
  'east_african',   -- Swahili / East African
  'middle_eastern', -- Arabic (Teta, Jiddo)
  'east_asian',     -- Chinese/Japanese/Korean
  'caribbean'       -- Caribbean
);
```

**Contracts** (`packages/contracts/src/users.ts` additions):

```typescript
// Notification prefs JSONB shape — NO heart_note fields (Story 4.13)
export const NotificationPrefsSchema = z.object({
  weekly_plan_ready: z.boolean(),
  grocery_list_ready: z.boolean(),
});

// PATCH /v1/users/me/notifications body — partial, at least one field
export const UpdateNotificationPrefsRequestSchema = z
  .object({
    weekly_plan_ready: z.boolean().optional(),
    grocery_list_ready: z.boolean().optional(),
  })
  .refine((d) => d.weekly_plan_ready !== undefined || d.grocery_list_ready !== undefined, {
    message: 'At least one field required',
  });

export const CULTURAL_LANGUAGE_VALUES = [
  'default', 'south_asian', 'hispanic', 'east_african', 'middle_eastern', 'east_asian', 'caribbean',
] as const;
export const CulturalLanguageSchema = z.enum(CULTURAL_LANGUAGE_VALUES);

// PATCH /v1/users/me/preferences body
export const UpdateCulturalPreferenceRequestSchema = z.object({
  cultural_language: CulturalLanguageSchema,
});
```

**Extended `UserProfileSchema`** — add alongside existing fields:

```typescript
notification_prefs: NotificationPrefsSchema,
cultural_language: CulturalLanguageSchema,
```

### Repository Changes

**`UserProfileRow`** — add:

```typescript
notification_prefs: { weekly_plan_ready?: boolean; grocery_list_ready?: boolean };
cultural_language: string;
```

**`PROFILE_COLUMNS`** — update:

```typescript
const PROFILE_COLUMNS = 'id, email, display_name, preferred_language, role, notification_prefs, cultural_language';
```

**`UpdateUserProfileInput`** — add to the `Partial<{...}>`:

```typescript
notification_prefs: { weekly_plan_ready?: boolean; grocery_list_ready?: boolean };
cultural_language: string;
```

The existing `updateUserProfile(id, input)` method handles all columns generically — no new repository methods needed.

### Service Logic

```typescript
async updateMyNotifications(userId: string, input: UpdateNotificationPrefsRequest): Promise<UserProfile> {
  const currentRow = await this.repository.findUserById(userId);
  if (!currentRow) throw new UnauthorizedError('User not found');
  // Merge: preserve existing prefs keys not present in input
  const merged = {
    weekly_plan_ready: currentRow.notification_prefs?.weekly_plan_ready ?? true,
    grocery_list_ready: currentRow.notification_prefs?.grocery_list_ready ?? true,
    ...input,
  };
  const row = await this.repository.updateUserProfile(userId, { notification_prefs: merged });
  const auth_providers = await this.fetchAuthProviders(userId);
  return toUserProfile(row, auth_providers);
}

async updateMyPreferences(
  userId: string,
  input: UpdateCulturalPreferenceRequest,
): Promise<{ profile: UserProfile; fieldsChanged: string[] }> {
  const currentRow = await this.repository.findUserById(userId);
  if (!currentRow) throw new UnauthorizedError('User not found');
  // UX-DR47: family-language ratchet — forward only
  if (input.cultural_language === 'default' && currentRow.cultural_language !== 'default') {
    throw new ConflictError('Family language cannot be reversed once set');
  }
  const fieldsChanged: string[] = [];
  if (input.cultural_language !== currentRow.cultural_language) fieldsChanged.push('cultural_language');
  const row = await this.repository.updateUserProfile(userId, { cultural_language: input.cultural_language });
  const auth_providers = await this.fetchAuthProviders(userId);
  return { profile: toUserProfile(row, auth_providers), fieldsChanged };
}
```

**`toUserProfile` must be updated** to map the two new columns:

```typescript
function toUserProfile(row: UserProfileRow, auth_providers: string[]): UserProfile {
  return {
    id: row.id,
    email: row.email,
    display_name: row.display_name,
    preferred_language: row.preferred_language,
    role: row.role,
    auth_providers,
    notification_prefs: {
      weekly_plan_ready: row.notification_prefs?.weekly_plan_ready ?? true,
      grocery_list_ready: row.notification_prefs?.grocery_list_ready ?? true,
    },
    cultural_language: row.cultural_language as CulturalLanguagePreference,
  };
}
```

### Route Handler Sketch

```typescript
fastify.patch(
  '/v1/users/me/notifications',
  { schema: { body: UpdateNotificationPrefsRequestSchema, response: { 200: UserProfileSchema } } },
  async (request) => {
    const body = request.body as UpdateNotificationPrefsRequest;
    const profile = await service.updateMyNotifications(request.user.id, body);
    request.auditContext = {
      event_type: 'account.updated',
      user_id: request.user.id,
      household_id: request.user.household_id,
      request_id: request.id,
      metadata: { fields_changed: ['notification_prefs'] },
    };
    return profile;
  },
);

fastify.patch(
  '/v1/users/me/preferences',
  { schema: { body: UpdateCulturalPreferenceRequestSchema, response: { 200: UserProfileSchema } } },
  async (request) => {
    const body = request.body as UpdateCulturalPreferenceRequest;
    const { profile, fieldsChanged } = await service.updateMyPreferences(request.user.id, body);
    request.auditContext = {
      event_type: 'account.updated',
      user_id: request.user.id,
      household_id: request.user.household_id,
      request_id: request.id,
      metadata: { fields_changed: fieldsChanged },
    };
    return profile;
  },
);
```

### Testing Requirements

**Mock update for `user.routes.test.ts`:**

```typescript
function defaultUserRow(overrides: Partial<UserProfileRow> = {}): UserProfileRow {
  return {
    id: SAMPLE_USER_ID,
    email: 'parent@example.com',
    display_name: 'Sample Parent',
    preferred_language: 'en',
    role: 'primary_parent',
    notification_prefs: {},            // add this
    cultural_language: 'default',      // add this
    ...overrides,
  };
}
```

**Required test cases:**

`PATCH /v1/users/me/notifications`:
- Updates `weekly_plan_ready: false` → 200 with updated `notification_prefs`
- Empty body → 400 `/errors/validation`
- Unauthenticated → 401
- Merges: existing `grocery_list_ready: false`, PATCH `{ weekly_plan_ready: true }` → `grocery_list_ready` stays false

`PATCH /v1/users/me/preferences`:
- Sets `cultural_language: 'south_asian'` from `'default'` → 200 with updated value
- Ratchet: set to `'south_asian'` then attempt `'default'` → 409 `/errors/conflict`
- Ratchet allows: `'south_asian'` → `'caribbean'` → 200 (forward/sideways is fine)
- Unknown value `'klingon'` → 400 `/errors/validation`
- Unauthenticated → 401

**Contract tests (`packages/contracts/src/users.test.ts`):**
- `NotificationPrefsSchema` accepts `{ weekly_plan_ready: true, grocery_list_ready: false }`
- `UpdateNotificationPrefsRequestSchema` rejects `{}` (empty)
- `UpdateNotificationPrefsRequestSchema` accepts `{ weekly_plan_ready: false }` (single field)
- `UpdateCulturalPreferenceRequestSchema` accepts each valid enum value, rejects unknown string
- `UserProfileSchema` with `notification_prefs` and `cultural_language` fields accepts valid full shape

### Frontend Implementation Notes

**State additions in `account.tsx`:**

```typescript
const [notifPrefs, setNotifPrefs] = useState({ weekly_plan_ready: true, grocery_list_ready: true });
const [culturalLanguage, setCulturalLanguage] = useState<string>('default');
```

Initialize both from `result.notification_prefs` and `result.cultural_language` in the `useEffect` load block.

**Notification prefs section** — add after the Password section:

- `<section>` with `<h2 className="font-serif text-xl">Notifications</h2>`
- Two `<label>` / `<input type="checkbox">` rows: "Weekly plan is ready" and "Grocery list is ready"
- On change: call `hkFetch<UserProfile>('/v1/users/me/notifications', { method: 'PATCH', body: { [field]: checked } })` then update local state from response
- NO Heart Note checkbox — the word "heart_note" must not appear in the UI label or field name

**Cultural language section** — add after Notifications:

- `<section>` with `<h2 className="font-serif text-xl">Family language</h2>`
- `<select>` with human-friendly option labels (e.g., `'south_asian'` → "South Asian (Nani, Nana)")
- Ratchet UI: if `culturalLanguage !== 'default'`, add `disabled` attribute to the `<option value="default">` entry and render a `<p className="text-sm text-warm-neutral-700">` note "Family language cannot be changed back once set."
- On change: call `hkFetch<UserProfile>('/v1/users/me/preferences', { method: 'PATCH', body: { cultural_language: value } })`; handle 409 with a clear user-facing error message

**`updateUser` in auth store** — the existing `useAuthStore.getState().updateUser(...)` call in `handleSave` does not need updating; the new sections make their own direct PATCH calls and update local component state from responses.

### Previous Story Learnings (from story 2-4)

- **`notification_prefs` column already exists** — do not re-add. Check migration file before writing any ALTER TABLE for notification_prefs.
- **Supabase SDK returns `{ data, error }` — never throws** — always destructure and check `.error`.
- **`UserProfileRow` `PROFILE_COLUMNS`** — adding a column requires updating both the interface AND the string constant; the repository uses a static select string, not `*`.
- **`toUserProfile` mapper** — any new column on the DB row must be explicitly mapped in this function; it does not pass through unknowns.
- **`didLoad.current = false` on logout** — if extending the profile load logic, preserve this reset.
- **Reset field state on PATCH failure** — pattern from story 2-4: on any catch, reset draft state to the last-known good profile value.
- **React `no-unescaped-entities` lint** — apostrophes in JSX text require `&apos;` not `'`.
- **`UserProfileSchema` is used for both GET response and PATCH responses** — adding fields here changes all three endpoints simultaneously; this is intentional and correct.

### References

- [Source: epics.md#Story-2.5, lines 1012–1023] Story requirements and AC
- [Source: epics.md#FR105–FR106, lines 197–198] Functional requirements
- [Source: epics.md#UX-DR47, line 401] Family-language ratchet rule
- [Source: epics.md#Story-4.13, lines 1716–1727] Heart Note anti-pattern; Story 2.5 UI constraint
- [Source: architecture.md, line 1329] notification_prefs + cultural_language on users table
- [Source: architecture.md, line 366] Idempotency §3.2 (not yet enforced globally)
- [Source: supabase/migrations/20260501120000_create_users_and_households.sql] notification_prefs column already present; users table schema
- [Source: apps/api/src/modules/users/user.repository.ts] PROFILE_COLUMNS pattern
- [Source: apps/api/src/modules/users/user.service.ts] toUserProfile mapper, ConflictError pattern
- [Source: apps/api/src/audit/audit.types.ts] AUDIT_EVENT_TYPES — 'account.updated' already present

## Dev Agent Record

### Agent Model Used

claude-opus-4-7 (Claude Code, BMAD dev-story workflow)

### Debug Log References

- `pnpm --filter @hivekitchen/contracts test` → 132 passed
- `pnpm --filter @hivekitchen/api test` → 75 passed, 11 skipped (pre-existing skips, unrelated)
- `pnpm --filter @hivekitchen/web typecheck` → clean
- `pnpm --filter @hivekitchen/web lint` → clean
- `pnpm --filter @hivekitchen/api lint` → clean
- `pnpm --filter @hivekitchen/api typecheck` → 1 pre-existing error in `apps/api/src/plugins/stripe.plugin.ts` (Stripe API version literal mismatch — untouched by this story; verified via `git diff HEAD`)

### Completion Notes List

- Migration `20260503100000_add_cultural_language_to_users.sql` adds the `cultural_language_preference` enum + column with `'default'` default. The pre-existing `notification_prefs jsonb` column on `users` (added in `20260501120000_create_users_and_households.sql`) is reused — no schema change needed for it.
- Contracts: added `NotificationPrefsSchema`, `UpdateNotificationPrefsRequestSchema` (refined to require ≥1 field), `CulturalLanguageSchema` (z.enum from `CULTURAL_LANGUAGE_VALUES`), `UpdateCulturalPreferenceRequestSchema`, and extended `UserProfileSchema` with `notification_prefs` + `cultural_language`. Types re-exported via `@hivekitchen/types`.
- Heart Note anti-pattern (Story 4.13) honored: no `heart_note_*` field anywhere in contracts/service/UI; the only `heart_note` token in code is an explanatory anti-pattern comment in `packages/contracts/src/users.ts` that does not match the lint rule's frequency-string regex (`streak|reminder|absence|haven't written|been quiet`).
- Service-layer ratchet (UX-DR47): `updateMyPreferences` rejects `'default'` only when the current stored value is non-default; sideways moves between non-default values are allowed. Surfaces as `409 /errors/conflict` per AC3.
- Notification merge: `updateMyNotifications` reads the current row, layers single-field input on top, and writes the full merged shape so a 1-field PATCH never clobbers the other field. Defaults (`true`) apply only on first write when the JSONB column has never been populated.
- Both new PATCH endpoints reuse the existing `'account.updated'` audit event type with `metadata.fields_changed`. Per Dev Notes: the global `Idempotency-Key` plugin is not yet implemented; routes accept the header silently without enforcement (consistent with story 2.4).
- Frontend: Notifications and Family language sections appended to `apps/web/src/routes/(app)/account.tsx`. Optimistic UI on toggles with rollback on failure. Ratchet UI disables the `'default'` option in the `<select>` once a non-default value is stored and renders an explanatory note. Apostrophe-free copy avoids `react/no-unescaped-entities`.

### File List

**Created**
- `supabase/migrations/20260503100000_add_cultural_language_to_users.sql`

**Modified**
- `packages/contracts/src/users.ts`
- `packages/contracts/src/users.test.ts`
- `packages/types/src/index.ts`
- `apps/api/src/modules/users/user.repository.ts`
- `apps/api/src/modules/users/user.service.ts`
- `apps/api/src/modules/users/user.routes.ts`
- `apps/api/src/modules/users/user.routes.test.ts`
- `apps/web/src/routes/(app)/account.tsx`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`

## Change Log

- 2026-04-26 — Story 2.5 implementation complete. Added cultural_language enum + migration, notification & cultural-language Zod schemas + types, repository + service extensions (with UX-DR47 ratchet), two new PATCH endpoints, contract + integration tests, and account-page UI sections. No Heart Note surface introduced (Story 4.13 anti-pattern honored).
