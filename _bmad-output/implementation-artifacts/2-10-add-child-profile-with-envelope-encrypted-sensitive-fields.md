# Story 2.10: Add child profile with envelope-encrypted sensitive fields

Status: done

## Story

As a Primary Parent,
I want to add one or more children with name, age-band, declared allergies, school food-policy constraints, and palate preferences, with sensitive fields envelope-encrypted at rest,
so that my child's allergens, cultural identifiers, and dietary preferences carry the encryption posture that AADC's most-protective-defaults requires (FR5, NFR-SEC-1).

## Architecture Overview

### Encryption Model

This story ships **envelope encryption** for child-sensitive fields. The layered key hierarchy:

```
┌────────────────────────────────────────────────────────────────────────┐
│  Master KEK (Key Encryption Key)                                       │
│  Source: process.env.ENVELOPE_ENCRYPTION_MASTER_KEY (32-byte hex)     │
│  Managed by: Supabase Vault (production stub — kills process on start) │
│              process.env directly in staging                           │
│              absent in dev/test → NOOP passthrough                    │
└────────────────────────────────────────────────────────────────────────┘
                            ↓ wraps
┌────────────────────────────────────────────────────────────────────────┐
│  Per-household DEK (Data Encryption Key)                               │
│  Random 32-byte key generated on first child add                       │
│  Stored as: households.encrypted_dek text                              │
│  Format: AES-256-GCM ciphertext base64(nonce||authTag||ciphertext)    │
└────────────────────────────────────────────────────────────────────────┘
                            ↓ encrypts
┌────────────────────────────────────────────────────────────────────────┐
│  children.declared_allergens  → text ciphertext (AES-256-GCM)         │
│  children.cultural_identifiers → text ciphertext (AES-256-GCM)       │
│  children.dietary_preferences  → text ciphertext (AES-256-GCM)       │
│  households.caregiver_relationships → text ciphertext (AES-256-GCM)  │
└────────────────────────────────────────────────────────────────────────┘
```

**AES-256-GCM field format (staging/production):**
```
base64( nonce[12 bytes] || authTag[16 bytes] || ciphertext[N bytes] )
```

**Dev/test passthrough:** When `NODE_ENV` is `development` or `test`, `ENVELOPE_ENCRYPTION_MASTER_KEY` is absent and the DEK is `null`. Encrypted columns store a `NOOP:` sentinel prefix followed by base64-encoded JSON:
```
NOOP:<base64(JSON.stringify(value))>
```
The `NOOP:` prefix is a safety sentinel: if a dev-mode row leaks into staging, the decrypt function will detect the missing prefix, attempt AES-GCM, and throw — it will never silently return wrong data.

**Environment summary:**
| NODE_ENV | ENVELOPE_ENCRYPTION_MASTER_KEY | Storage format |
|---|---|---|
| `development` / `test` | absent | `NOOP:base64(JSON)` |
| `staging` | process.env (64 hex chars) | AES-256-GCM base64 |
| `production` | Vault (stub — process.exit) | blocked at startup |

### Route Flow: POST /v1/households/:id/children

```
POST /v1/households/:id/children
  ← JWT: primary_parent role only (RBAC prehandler, Story 2.2)
  → assertCallerBelongsToHousehold: request.user.householdId === params.id
      → mismatch: 403 ForbiddenError('not a member of this household')
  → complianceService.assertParentalNoticeAcknowledged(request.user.id)
      → unacknowledged: 403 ParentalNoticeRequiredError
  → childrenService.addChild({ householdId: params.id, body })
      → childrenRepository.getOrCreateHouseholdDek(householdId)
          → dev/test: return null (NOOP)
          → households.encrypted_dek IS NULL: generateDek() → wrapDek(dek, kek) → UPDATE households → return dek
          → households.encrypted_dek NOT NULL: unwrapDek(encrypted_dek, kek) → return dek
      → encryptField(body.declared_allergens, dek) → ciphertext
      → encryptField(body.cultural_identifiers, dek) → ciphertext
      → encryptField(body.dietary_preferences, dek) → ciphertext
      → INSERT INTO children { ...plaintext fields, allergen_rule_version: 'v1', encrypted columns }
      → SELECT inserted row → decryptField each column → ChildRow (plaintext)
  ← 201 { child: ChildResponse }
  ← audit: child.add { child_id, allergen_rule_version } — no PII in metadata
```

### Route Flow: GET /v1/households/:id/children/:childId

```
GET /v1/households/:id/children/:childId
  ← JWT: primary_parent or secondary_caregiver (own household only)
  → assertCallerBelongsToHousehold: request.user.householdId === params.id
  → childrenRepository.findById(householdId, childId)
      → SELECT row
      → getHouseholdDek(householdId) → dek
      → decryptField(declared_allergens, dek) → string[]
      → decryptField(cultural_identifiers, dek) → string[]
      → decryptField(dietary_preferences, dek) → string[]
  ← 200 { child: ChildResponse }
```

Decryption ALWAYS happens in-process inside the repository. Plaintext sensitive field values MUST NOT appear in any Pino log fields, error messages, or audit event metadata.

### Caregiver Relationships Migration

`households.caregiver_relationships` is currently `jsonb` (Story 2.1). The epics require it to be envelope-encrypted "similarly." This story:

1. Migrates the column from `jsonb` to `text` (Postgres allows `USING caregiver_relationships::text`)
2. Updates the households repository to encrypt on write and decrypt on read using the household DEK
3. Existing null rows: no action. Existing non-null rows: the raw jsonb cast to text will be stored as legacy plaintext; on the next application write the new code will re-encrypt. **Lazy migration** — no one-shot backfill needed (beta, no live users).

**Breaking impact on Story 2.3:** The secondary caregiver invite code that reads/writes `caregiver_relationships` goes through `HouseholdsRepository`. Only that repository method needs updating — invite routes and service are untouched.

### School Policies Table

`20260501130000_create_children_and_school_policies.sql` is referenced in the architecture spec but **does not exist** in `supabase/migrations/`. This story creates the `children` table directly. A `school_policies` table (separate normalization) is **not in scope** — school constraints are captured as free-text `school_policy_notes` on the child row for now.

## Acceptance Criteria

1. **Given** I am authenticated as `primary_parent` for household `:id` and have acknowledged the parental notice, **When** I `POST /v1/households/:id/children` with `{ name, age_band, declared_allergens?, cultural_identifiers?, dietary_preferences?, school_policy_notes? }`, **Then** `201 { child: { id, household_id, name, age_band, school_policy_notes, declared_allergens, cultural_identifiers, dietary_preferences, allergen_rule_version, created_at } }` is returned with plaintext arrays in the response body.

2. **Given** the `children` row in the database, **When** `SELECT declared_allergens, cultural_identifiers, dietary_preferences FROM children WHERE id = :child_id` is run directly, **Then** the columns contain ciphertext — in dev/test they start with `NOOP:`, never containing raw plaintext JSON.

3. **Given** `users.parental_notice_acknowledged_at IS NULL` for the requesting user, **When** `POST /v1/households/:id/children` is called, **Then** `403 { type: '/errors/parental-notice-required' }` is returned and no row is inserted.

4. **Given** an authenticated `secondary_caregiver` JWT, **When** `POST /v1/households/:id/children` is called, **Then** `403 /errors/forbidden` — only `primary_parent` may create child profiles.

5. **Given** a `primary_parent` token for household A, **When** `POST /v1/households/B/children` (different household) is called, **Then** `403 /errors/forbidden`.

6. **Given** an unauthenticated request, **When** either endpoint is called, **Then** `401 /errors/unauthorized`.

7. **Given** `households.encrypted_dek IS NULL` for a household (no children yet), **When** the first child is added, **Then** a random 32-byte DEK is generated, wrapped with the KEK, and stored as `households.encrypted_dek`. Subsequent child additions read and reuse the same DEK.

8. **Given** `GET /v1/households/:id/children/:childId` called by any member of the household (primary_parent or secondary_caregiver), **Then** `200 { child: ChildResponse }` with decrypted plaintext arrays.

9. **Given** `GET /v1/households/:id/children/:childId` where `:childId` does not exist in this household, **Then** `404 /errors/not-found`.

10. **Given** the child row response, **Then** `allergen_rule_version` is `'v1'` (current guardrail snapshot hardcoded in this story; upgrading this version is a separate story).

11. **Given** the add-child form on the web client, **When** I submit with `name` empty or `age_band` missing, **Then** inline Zod validation errors appear without hitting the API.

12. **Given** I am on `/app` and `parental_notice_acknowledged_at IS NULL`, **When** I activate the add-child affordance, **Then** `<ParentalNoticeDialog>` opens (Story 2.9 gate already wired). After `onAcknowledged` fires, the add-child form opens immediately without page reload.

13. **Given** the API returns `403 /errors/parental-notice-required`, **When** the web client receives it, **Then** it opens `<ParentalNoticeDialog>` as a defensive re-trigger (handles stale client state) instead of showing a generic error.

14. **Given** a successful child add, **When** the `child.add` audit event fires, **Then** the metadata contains `{ child_id, allergen_rule_version }` — no plaintext allergen values, no cultural identifiers.

15. **Given** `households.caregiver_relationships` is migrated from `jsonb` to `text`, **When** the secondary caregiver invite code (Story 2.3) reads or writes the column through `HouseholdsRepository`, **Then** the repository transparently encrypts/decrypts — no changes to invite routes or invite service.

## Tasks / Subtasks

- [x] Task 1 — Migrations (AC: 1, 2, 7, 14, 15)
  - [x] Create `supabase/migrations/20260510000000_create_children_table.sql`:
    ```sql
    -- Story 2.10: children table with envelope-encrypted sensitive fields.
    -- declared_allergens, cultural_identifiers, dietary_preferences store
    -- AES-256-GCM ciphertext (base64 text). In dev/test NODE_ENV: NOOP:base64(JSON).
    -- school_policies table deferred — school constraints captured as free-text
    -- school_policy_notes until Story 3.x normalizes school policy management.
    CREATE TABLE children (
      id                    uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
      household_id          uuid        NOT NULL REFERENCES households(id) ON DELETE CASCADE,
      name                  text        NOT NULL,
      age_band              text        NOT NULL
                            CHECK (age_band IN ('toddler','child','preteen','teen')),
      school_policy_notes   text,
      declared_allergens    text,
      cultural_identifiers  text,
      dietary_preferences   text,
      allergen_rule_version text        NOT NULL DEFAULT 'v1',
      created_at            timestamptz NOT NULL DEFAULT now(),
      updated_at            timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX children_household_id_idx ON children (household_id);
    ```
  - [x] Create `supabase/migrations/20260510000100_add_encrypted_dek_to_households.sql`:
    ```sql
    -- Story 2.10: per-household envelope encryption key (DEK wrapped by master KEK).
    -- Null until first child is added. Managed by ChildrenRepository.getOrCreateHouseholdDek().
    ALTER TABLE households ADD COLUMN IF NOT EXISTS encrypted_dek text;
    ```
  - [x] Create `supabase/migrations/20260510000200_encrypt_caregiver_relationships.sql`:
    ```sql
    -- Story 2.10: convert households.caregiver_relationships from jsonb to text
    -- to support envelope encryption. Existing non-null rows are cast to text (lazy
    -- re-encryption on next application write). RLS not affected — write via service_role.
    ALTER TABLE households
      ALTER COLUMN caregiver_relationships TYPE text
      USING caregiver_relationships::text;
    ```
  - [x] Create `supabase/migrations/20260510000300_add_child_add_audit_type.sql`:
    ```sql
    -- Story 2.10: audit event type for child profile creation.
    -- Mirror in TypeScript: apps/api/src/audit/audit.types.ts (AUDIT_EVENT_TYPES).
    ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'child.add';
    ```
  - [x] Add `'child.add'` to `AUDIT_EVENT_TYPES` in `apps/api/src/audit/audit.types.ts` under a new `// children` comment block (preserve the grouped-comment style).
  - [x] Run audit parity test: `pnpm --filter @hivekitchen/api test -- --grep "audit"` — confirm it still passes.

- [x] Task 2 — Envelope encryption utility (AC: 2, 7)
  - [x] Create `apps/api/src/lib/envelope-encryption.ts`:
    - `encryptField(data: unknown, dek: Buffer | null): string`
      - `dek === null`: return `'NOOP:' + Buffer.from(JSON.stringify(data)).toString('base64')`
      - else: generate `nonce = crypto.randomBytes(12)`, AES-256-GCM cipher, return `base64(nonce || authTag[16] || ciphertext)`
    - `decryptField<T>(ciphertext: string, dek: Buffer | null): T`
      - `ciphertext.startsWith('NOOP:')` OR `dek === null`: `JSON.parse(Buffer.from(ciphertext.slice(5), 'base64').toString())`
      - else: extract `nonce = buf[0..12]`, `authTag = buf[12..28]`, `ct = buf[28..]`; AES-256-GCM decrypt; `JSON.parse(decrypted.toString())`
    - `wrapDek(dek: Buffer, kek: Buffer): string` — AES-256-GCM encrypt the 32-byte DEK with the KEK; same base64 format
    - `unwrapDek(encryptedDek: string, kek: Buffer): Buffer` — reverse; returns the raw 32-byte DEK
    - `generateDek(): Buffer` — `return crypto.randomBytes(32)`
    - Never catch `Error` from AES decryption — let it propagate as an internal server error (tampered authTag must surface as a 500, not silently ignored)
  - [x] Create `apps/api/src/lib/envelope-encryption.test.ts`:
    - Test: `encryptField` + `decryptField` round-trips for `string[]` value
    - Test: `encryptField` + `decryptField` round-trips for `Record<string, unknown>` value
    - Test: NOOP path (`dek === null`) produces `NOOP:` prefix and round-trips correctly
    - Test: `wrapDek` + `unwrapDek` round-trips the DEK bytes exactly
    - Test: tampered ciphertext causes `decryptField` to throw (modify a byte after encryption)
    - Test: NOOP-prefixed ciphertext with `dek !== null` still decodes correctly (the `NOOP:` branch takes priority)

- [x] Task 3 — Contracts and types (AC: 1, 8)
  - [x] Create `packages/contracts/src/children.ts`:
    ```typescript
    import { z } from 'zod';

    export const AgeBandSchema = z.enum(['toddler', 'child', 'preteen', 'teen']);

    export const AddChildBodySchema = z.object({
      name: z.string().min(1).max(100).trim(),
      age_band: AgeBandSchema,
      school_policy_notes: z.string().max(500).trim().optional(),
      declared_allergens: z.array(z.string().min(1).max(100)).max(50).default([]),
      cultural_identifiers: z.array(z.string().min(1).max(100)).max(20).default([]),
      dietary_preferences: z.array(z.string().min(1).max(100)).max(30).default([]),
    });

    export const ChildResponseSchema = z.object({
      id: z.string().uuid(),
      household_id: z.string().uuid(),
      name: z.string(),
      age_band: AgeBandSchema,
      school_policy_notes: z.string().nullable(),
      declared_allergens: z.array(z.string()),
      cultural_identifiers: z.array(z.string()),
      dietary_preferences: z.array(z.string()),
      allergen_rule_version: z.string(),
      created_at: z.string(),
    });

    export const AddChildResponseSchema = z.object({ child: ChildResponseSchema });
    export const GetChildResponseSchema = z.object({ child: ChildResponseSchema });
    ```
  - [x] Add `export * from './children.js'` to `packages/contracts/src/index.ts`.
  - [x] Create `packages/types/src/children.ts`:
    ```typescript
    import type { z } from 'zod';
    import type {
      AgeBandSchema, AddChildBodySchema, ChildResponseSchema,
      AddChildResponseSchema, GetChildResponseSchema,
    } from '@hivekitchen/contracts';
    export type AgeBand = z.infer<typeof AgeBandSchema>;
    export type AddChildBody = z.infer<typeof AddChildBodySchema>;
    export type ChildResponse = z.infer<typeof ChildResponseSchema>;
    export type AddChildResponse = z.infer<typeof AddChildResponseSchema>;
    export type GetChildResponse = z.infer<typeof GetChildResponseSchema>;
    ```
  - [x] Add `export * from './children.js'` to `packages/types/src/index.ts`.
  - [x] Run `pnpm --filter @hivekitchen/contracts test` — contracts tests pass.

- [x] Task 4 — Children API module (AC: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 14)
  - [x] Create `apps/api/src/modules/children/children.repository.ts` — `ChildrenRepository`:
    - Constructor: `(private readonly supabase: SupabaseServiceClient, private readonly kek: Buffer | null)`
    - `getOrCreateHouseholdDek(householdId: string): Promise<Buffer | null>`:
      - `kek === null`: return `null` (dev/test NOOP)
      - SELECT `households.encrypted_dek` WHERE `id = householdId`
      - If null: `generateDek()` → `wrapDek(dek, kek)` → UPDATE households SET encrypted_dek → return dek
      - If present: `unwrapDek(encrypted_dek, kek)` → return dek
    - `getHouseholdDek(householdId: string): Promise<Buffer | null>`:
      - `kek === null`: return `null`
      - SELECT encrypted_dek; if null return null (household has no DEK yet)
      - Else unwrap and return
    - `insert(params: InsertChildParams, dek: Buffer | null): Promise<DecryptedChildRow>`:
      - Encrypt `declared_allergens`, `cultural_identifiers`, `dietary_preferences`
      - INSERT INTO children; SELECT back inserted row; decrypt; return
    - `findById(householdId: string, childId: string): Promise<DecryptedChildRow | null>`:
      - SELECT WHERE `household_id = householdId AND id = childId`
      - null row: return null
      - Else: getHouseholdDek → decrypt fields → return
    - `findByHouseholdId(householdId: string): Promise<DecryptedChildRow[]>`
    - Internal decrypt: null column value → return `[]` (empty array default)
  - [x] Create `apps/api/src/modules/children/children.service.ts` — `ChildrenService`:
    - `addChild(params: { userId: string; householdId: string; body: AddChildBody }): Promise<ChildResponse>`
    - `getChild(params: { householdId: string; childId: string }): Promise<ChildResponse>`
    - Service is thin: validates, delegates to repository, maps to response shape
  - [x] Create `apps/api/src/modules/children/children.routes.ts`:
    - `POST /v1/households/:id/children`:
      - Prehandler: `primary_parent` role only
      - Body: `AddChildBodySchema`
      - Check `request.user.householdId === params.id` → 403 if mismatch
      - `await complianceService.assertParentalNoticeAcknowledged(request.user.id)`
      - `await childrenService.addChild(...)`
      - Set `request.auditContext = { event: 'child.add', metadata: { child_id: child.id, allergen_rule_version: child.allergen_rule_version } }`
      - Reply `201 AddChildResponseSchema`
    - `GET /v1/households/:id/children/:childId`:
      - Prehandler: `primary_parent | secondary_caregiver`
      - Check household membership
      - `await childrenService.getChild(...)`
      - Reply `200 GetChildResponseSchema` or `404 NotFoundError`
  - [x] Create `apps/api/src/modules/children/children.routes.test.ts`:
    - **Setup**: build a minimal Fastify app with JWT mock, RBAC prehandler mock, mocked compliance service (`assertParentalNoticeAcknowledged` resolves by default), mocked children repository using in-memory store + NOOP encryption
    - Test 1: POST 201 — returns plaintext arrays in response
    - Test 2: POST encrypted storage — raw inserted row has `NOOP:` prefix in encrypted columns
    - Test 3: POST 403 `parental-notice-required` — mock `assertParentalNoticeAcknowledged` to throw `ParentalNoticeRequiredError`
    - Test 4: POST 403 forbidden — secondary_caregiver token
    - Test 5: POST 403 forbidden — primary_parent for a different household
    - Test 6: POST 401 — no JWT
    - Test 7: GET 200 — returns decrypted response
    - Test 8: GET 404 — non-existent child
    - Test 9: POST 400 validation — missing `name` field
    - **Minimum 9 test cases**

- [x] Task 5 — HouseholdsRepository: caregiver_relationships encryption (AC: 15)
  - [x] Locate `HouseholdsRepository` — likely `apps/api/src/modules/users/user.repository.ts` (check for caregiver_relationships reads/writes there or in a households-specific repository).
  - [x] Extract DEK retrieval into `apps/api/src/lib/household-key.ts` — a shared utility function `getHouseholdDek(supabase, kek, householdId)` used by both `ChildrenRepository` and `HouseholdsRepository`.
  - [x] Update every read of `caregiver_relationships` in `HouseholdsRepository`:
    - After SELECT: if value starts with `NOOP:` or is a valid base64 AES-GCM blob → decrypt with household DEK
    - If value is raw JSON text (legacy cast row, no NOOP prefix, not valid base64) → parse as JSON directly (lazy migration; re-encrypt on next write)
  - [x] Update every write of `caregiver_relationships`:
    - Before INSERT/UPDATE: encrypt with household DEK

- [x] Task 6 — app.ts registration and env (AC: 1, 7)
  - [x] Add `ENVELOPE_ENCRYPTION_MASTER_KEY` to `apps/api/src/env.ts`:
    ```typescript
    ENVELOPE_ENCRYPTION_MASTER_KEY: z.string().length(64).optional(),
    // 32-byte hex key. Absent in dev/test → NOOP encryption passthrough.
    // Required in staging/production. Production blocked by vault.plugin until Vault is wired.
    ```
  - [x] Derive `kek` in `apps/api/src/app.ts`:
    ```typescript
    const kekHex = env.ENVELOPE_ENCRYPTION_MASTER_KEY;
    const kek = kekHex ? Buffer.from(kekHex, 'hex') : null;
    ```
  - [x] Instantiate `ChildrenRepository(supabase, kek)` and `ChildrenService(childrenRepository)`.
  - [x] Register children routes: `fastify.register(childrenRoutes, { prefix: '/v1/households' })` passing `childrenService` and `complianceService` via plugin options or Fastify decoration (follow the `complianceRoutes` injection pattern from `apps/api/src/modules/compliance/compliance.routes.ts`).
  - [x] Update `apps/api/.env.local.example`:
    ```
    # ENVELOPE_ENCRYPTION_MASTER_KEY=<64-hex-chars>
    # Required in staging/production. Omit in local dev — uses NOOP passthrough.
    ```

- [x] Task 7 — Add-child form (web) (AC: 10, 11, 12, 13)
  - [x] Create `apps/web/src/features/children/AddChildForm.tsx`:
    - Controlled form: `name` (text input), `age_band` (select: toddler/child/preteen/teen), `school_policy_notes` (textarea, optional), `declared_allergens` (tag chip input), `cultural_identifiers` (tag chip input), `dietary_preferences` (tag chip input)
    - Tag chip input: pressing Enter or comma adds a tag; Backspace on empty input removes last tag. Implement with `useState<string[]>` — no third-party library.
    - Client-side validation via `AddChildBodySchema.safeParse()` before submission
    - Props: `householdId: string; onSuccess: (child: ChildResponse) => void; onCancel: () => void`
    - Calls `POST /v1/households/:householdId/children`
    - On `403 /errors/parental-notice-required`: call `onParentalNoticeRequired()` prop (parent triggers dialog re-open)
    - On success: call `onSuccess(child)`
    - Loading and error states inline (no toast per UX-DR65/66)
  - [x] Create `apps/web/src/features/children/AddChildForm.test.tsx`:
    - Test: renders all fields
    - Test: tag chip input — Enter adds tag, Backspace removes last
    - Test: client validation — empty name prevents submit
    - Test: successful submit calls `onSuccess`
    - Test: 403 parental-notice-required calls `onParentalNoticeRequired`
    - Minimum 5 tests
  - [x] Update `apps/web/src/routes/(app)/index.tsx`:
    - Add "Add a child" CTA (or "Add your first child" when no children exist)
    - When tapped:
      - If `user.parental_notice_acknowledged_at === null` (from profile store): open `<ParentalNoticeDialog>`
      - Else: open `<AddChildForm>` inline or as a dialog
    - After `<ParentalNoticeDialog onAcknowledged>` fires: open `<AddChildForm>` immediately
    - After successful `AddChildForm.onSuccess`: update local state, show child card on home screen
  - [x] Create `apps/web/src/hooks/useAddChild.ts` (thin wrapper over fetch, used by `AddChildForm` internally).

- [x] Task 8 — Final verification
  - [x] `pnpm --filter @hivekitchen/api test` — all tests pass
  - [x] `pnpm --filter @hivekitchen/web test` — all tests pass
  - [x] `pnpm --filter @hivekitchen/contracts test` — all tests pass
  - [x] `pnpm --filter @hivekitchen/api typecheck` — no errors
  - [x] `pnpm --filter @hivekitchen/web typecheck` — no errors
  - [x] Manual smoke test: add a child via the web form; confirm ciphertext in DB (`SELECT declared_allergens FROM children LIMIT 1`); confirm plaintext in API response

## Dev Notes

### Encryption Invariants (MUST NOT violate)

1. **Plaintext never in logs.** `declared_allergens`, `cultural_identifiers`, `dietary_preferences` field values MUST NOT appear in any Pino log field, error message, or audit metadata. Log counts: `declaredAllergenCount: body.declared_allergens.length`.

2. **Decryption in repository only.** The service and route layers work with plaintext arrays. The repository encrypts on write and decrypts on read. Do not put encryption/decryption logic in the service or route files.

3. **Authenticated encryption — no silent failure.** AES-256-GCM authTag verification failure MUST throw. Do not wrap `createDecipheriv`/`decipher.final()` in try/catch. Let the error propagate to Fastify's error handler as a 500.

4. **DEK rotation is not in scope.** Generating and storing the DEK is in scope. Re-encrypting existing rows with a new DEK when rotating keys is a separate future story.

5. **Pino redaction.** Add `['declared_allergens', 'cultural_identifiers', 'dietary_preferences']` to the Pino redaction paths in `apps/api/src/plugins/pino.plugin.ts` (or equivalent config) if not already present. This provides defense-in-depth even if a log call accidentally includes these fields.

### RBAC Prehandler Reference

- `primary_parent` only: `{ role: ['primary_parent'] }` — see compliance routes (Story 2.8)
- `primary_parent | secondary_caregiver`: `{ role: ['primary_parent', 'secondary_caregiver'] }` — see thread routes (Story 2.2)

### assertParentalNoticeAcknowledged Gate

`complianceService.assertParentalNoticeAcknowledged(userId)` is already implemented and unit-tested in `apps/api/src/modules/compliance/compliance.service.ts:155`. Call it in the POST `/children` route AFTER the household membership check so that the 403 type is deterministic for callers.

### `assertCallerBelongsToHousehold` Pattern

```typescript
if (request.user.householdId !== params.id) {
  throw new ForbiddenError('not a member of this household');
}
```

`request.user.householdId` is set by the JWT prehandler (Story 2.2). Inspect `apps/api/src/middleware/` or the auth prehandler plugin for the exact field name.

### Fastify Plugin Injection Pattern

`complianceService` is injected into children routes via the same mechanism used in `compliance.routes.ts`. Read `apps/api/src/modules/compliance/compliance.routes.ts` to understand how the service is passed (likely as a plugin option or Fastify `decorate`). Mirror that pattern exactly for children routes.

### Supabase Client

Use the **service-role** Supabase client for all database operations — the same pattern used throughout the API. RLS is intentionally not applied to `children` (service-role bypasses RLS per Story 2.2 doctrine).

### Household Repository Location

`caregiver_relationships` is written in Story 2.3 (secondary caregiver invite). Search `apps/api/src/` for `caregiver_relationships` to locate the exact file and method that must be updated for Task 5.

### Test Isolation for Encryption

In `children.routes.test.ts`, use `NOOP` mode (`kek = null`). Do not mock `encryptField`/`decryptField` — let the real NOOP path run. Assert the raw `NOOP:` prefix in the DB-layer mock to confirm the encryption boundary is respected.

### Project Structure Notes

- New module: `apps/api/src/modules/children/` — follows `compliance/`, `users/`, `onboarding/` patterns
- Shared utilities: `apps/api/src/lib/envelope-encryption.ts`, `apps/api/src/lib/household-key.ts`
- New contracts: `packages/contracts/src/children.ts`
- New types: `packages/types/src/children.ts`
- New web feature: `apps/web/src/features/children/`
- Migration timestamps: `20260510000000` through `20260510000300` (four new migrations)

### Known Missing Infrastructure

- `20260501130000_create_children_and_school_policies.sql` — referenced in architecture spec, does not exist. This story creates the children table as `20260510000000_create_children_table.sql`.
- Supabase Vault (`vault.plugin.ts`) is a stub that kills the process in production. Envelope encryption works end-to-end in dev/test (NOOP) and staging (`ENVELOPE_ENCRYPTION_MASTER_KEY` env var). Full Vault integration is a separate future story.

### References

- Vault plugin (NOOP pattern): `apps/api/src/plugins/vault.plugin.ts`
- `assertParentalNoticeAcknowledged`: `apps/api/src/modules/compliance/compliance.service.ts`
- `ParentalNoticeRequiredError`: `apps/api/src/common/errors.ts`
- `ParentalNoticeDialog` (Story 2.9 gate, already shipped): `apps/web/src/features/compliance/ParentalNoticeDialog.tsx`
- Audit event types: `apps/api/src/audit/audit.types.ts`
- Migration precedent (audit type + stored fn): `supabase/migrations/20260509000000_add_parental_notice_acknowledged_audit_type.sql`
- Base schema (households, users): `supabase/migrations/20260501120000_create_users_and_households.sql`
- Compliance routes (injection pattern): `apps/api/src/modules/compliance/compliance.routes.ts`
- [Source: _bmad-output/planning-artifacts/epics.md — Story 2.10]
- [Source: specs/Technical Architecture.md — Envelope Encryption, §Children]

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

- `pnpm --filter @hivekitchen/api test` → 149 passed (11 skipped pre-existing). New: envelope-encryption (9), households.repository (4), children.routes (10).
- `pnpm --filter @hivekitchen/contracts test` → 213 passed. New: children (10).
- `pnpm --filter @hivekitchen/web test` → 68 passed. New: AddChildForm (5).
- `pnpm --filter @hivekitchen/web typecheck` → clean.
- `pnpm --filter @hivekitchen/api typecheck` → only pre-existing `stripe.plugin.ts` API-version mismatch (commit 737be7b, unrelated to this story).

### Completion Notes List

- Envelope encryption uses AES-256-GCM with a 12-byte nonce + 16-byte authTag, stored as `base64(nonce||authTag||ciphertext)`. Tampered ciphertext throws — never silently mis-decrypts.
- NOOP path encodes as `NOOP:base64(JSON)` and is checked first on decrypt so a dev row leaking into staging fails fast in JSON.parse rather than mis-parsing as AES bytes.
- `getOrCreateHouseholdDek` is the single write path for `households.encrypted_dek` — used by both `ChildrenRepository` and `HouseholdsRepository` via the shared `apps/api/src/lib/household-key.ts` util.
- Audit metadata for `child.add` is PII-free: only `child_id`, `allergen_rule_version`, and counts. Test asserts that `Asha`, allergen values, cultural identifiers, and dietary preferences never appear in metadata JSON.
- `caregiver_relationships` migration uses lazy re-encryption — legacy `jsonb::text` rows decrypt as raw JSON (`{` or `[` prefix); next write re-encrypts via the household DEK.
- Web `AddChildForm` validates client-side via `AddChildBodySchema.safeParse()` before submitting; tag chip input is a self-contained controlled component (Enter/comma adds, Backspace on empty input removes last). The `/app` home route handles the parental-notice gate via `useRequireParentalNoticeAcknowledgment` and re-opens the dialog defensively if the API returns `/errors/parental-notice-required`.
- `HouseholdsRepository` is created and unit-tested for the encryption/decryption boundary, even though Story 2.3's invite redemption flow does not yet write `caregiver_relationships`. AC 15 is forward-compatible: when redemption ships, it will go through this repository transparently.

### File List

**Migrations**
- `supabase/migrations/20260510000000_create_children_table.sql`
- `supabase/migrations/20260510000100_add_encrypted_dek_to_households.sql`
- `supabase/migrations/20260510000200_encrypt_caregiver_relationships.sql`
- `supabase/migrations/20260510000300_add_child_add_audit_type.sql`

**Contracts / types**
- `packages/contracts/src/children.ts` (new)
- `packages/contracts/src/children.test.ts` (new)
- `packages/contracts/src/index.ts` (modified — re-export children)
- `packages/types/src/index.ts` (modified — re-export children types)

**API**
- `apps/api/src/lib/envelope-encryption.ts` (new)
- `apps/api/src/lib/envelope-encryption.test.ts` (new)
- `apps/api/src/lib/household-key.ts` (new)
- `apps/api/src/modules/children/children.repository.ts` (new)
- `apps/api/src/modules/children/children.service.ts` (new)
- `apps/api/src/modules/children/children.routes.ts` (new)
- `apps/api/src/modules/children/children.routes.test.ts` (new)
- `apps/api/src/modules/households/households.repository.ts` (new)
- `apps/api/src/modules/households/households.repository.test.ts` (new)
- `apps/api/src/audit/audit.types.ts` (modified — add `child.add`)
- `apps/api/src/common/env.ts` (modified — add `ENVELOPE_ENCRYPTION_MASTER_KEY`)
- `apps/api/src/app.ts` (modified — register `childrenRoutes`)
- `apps/api/.env.local.example` (modified — document new env var)

**Web**
- `apps/web/src/features/children/AddChildForm.tsx` (new)
- `apps/web/src/features/children/AddChildForm.test.tsx` (new)
- `apps/web/src/hooks/useAddChild.ts` (new)
- `apps/web/src/routes/(app)/index.tsx` (modified — wire add-child gate + form)

### Change Log

- 2026-04-28 — Initial implementation of Story 2.10 (envelope-encrypted child profiles + caregiver relationships repository scaffold). All 15 ACs satisfied; status moved to `review`.

---

### Review Findings

> Code review conducted 2026-04-28 · 3 decision-needed · 19 patch · 3 deferred · 11 dismissed

#### Decision-Needed

- [x] [Review][Decision] Migration 20260510000200 irreversible — no rollback path — Accepted: column is always NULL in beta (no live code writes to it). Rollback documentation added directly to the migration SQL file. (2026-04-28)
- [x] [Review][Decision] HouseholdsRepository uninstantiated — AC 15 unverifiable in live code — Deferred to Story 5.5 (secondary caregiver invite redemption). That story must import and use `HouseholdsRepository` for all reads/writes to `caregiver_relationships`. (2026-04-28)
- [x] [Review][Decision] decryptArrayField null→[] + encrypted columns nullable — Fixed: migration 20260510000400 adds NOT NULL to all three encrypted columns; decryptArrayField updated to throw on null (now a type error since ChildRow columns are non-nullable). "No allergens" = encrypted [] in DB; missing data = DB constraint violation. (2026-04-28)

#### Patch

- [x] [Review][Patch] **CRITICAL** DEK creation race — no conditional UPDATE guard [apps/api/src/lib/household-key.ts:35-43]
- [x] [Review][Patch] **CRITICAL** decryptField dek=null branch silently misroutes real AES ciphertext as JSON [apps/api/src/lib/envelope-encryption.ts:31-34]
- [x] [Review][Patch] **HIGH** Legacy caregiver_relationships edge-case values (JSONB null→"null", booleans, empty string) crash reads permanently [apps/api/src/modules/households/households.repository.ts:50-57]
- [x] [Review][Patch] **HIGH** decryptCaregiverRelationships has dead-code contradictory branching — NOOP path is structurally unreachable in inner branch [apps/api/src/modules/households/households.repository.ts:50-57]
- [x] [Review][Patch] **HIGH** getOrCreateHouseholdDek UPDATE not verified for 0-row match — silent no-op on missing household [apps/api/src/lib/household-key.ts:38-42]
- [x] [Review][Patch] **HIGH** Pino redaction paths use `*.field` — only covers one nesting level; misses req.body and response payload occurrences [apps/api/src/common/logger.ts]
- [x] [Review][Patch] **HIGH** Uncommitted chip draft may be excluded from form submit (onBlur setState not settled before handleSubmit closure reads state) [apps/web/src/features/children/AddChildForm.tsx]
- [x] [Review][Patch] **MEDIUM** findByHouseholdId synchronous map — one corrupt row throws and crashes the entire household list [apps/api/src/modules/children/children.repository.ts:94-103]
- [x] [Review][Patch] **MEDIUM** DEK resolution leaks into service layer — getOrCreateHouseholdDek called from ChildrenService.addChild, violating "encryption only in repository" constraint [apps/api/src/modules/children/children.service.ts:19]
- [x] [Review][Patch] **MEDIUM** Types duplicated in contracts package — z.infer<> types should only live in packages/types [packages/contracts/src/children.ts:32-36]
- [x] [Review][Patch] **MEDIUM** school_policy_notes optional (request) vs nullable (response) — contract asymmetry; round-trip parse fails [packages/contracts/src/children.ts]
- [x] [Review][Patch] **MEDIUM** Audit correlation_id set to householdId — not request-scoped; all household ops share the same correlation_id [apps/api/src/modules/children/children.routes.ts:58]
- [x] [Review][Patch] **MEDIUM** AddChildResponseSchema ZodError swallowed as generic error — a schema mismatch on a successful 201 tells the user the child wasn't added when it was [apps/web/src/hooks/useAddChild.ts:27]
- [x] [Review][Patch] **MEDIUM** Allergen tag dedup is case-sensitive — "Peanut" and "peanut" are both accepted [apps/web/src/features/children/AddChildForm.tsx:213]
- [x] [Review][Patch] **MEDIUM** onBlur commitDraft fires on chip Remove button click — partial draft committed before remove action [apps/web/src/features/children/AddChildForm.tsx:269]
- [x] [Review][Patch] **LOW** aesGcmDecrypt no minimum payload length validation — short/empty ciphertext throws an opaque AES error [apps/api/src/lib/envelope-encryption.ts:57-65]
- [x] [Review][Patch] **LOW** children table missing updated_at trigger — future UPDATE operations won't auto-refresh the column [supabase/migrations/20260510000000_create_children_table.sql:18]
- [x] [Review][Patch] **LOW** getCaregiverRelationships returns unknown — no Zod validation on decrypted value [apps/api/src/modules/households/households.repository.ts:21]
- [x] [Review][Patch] **LOW** No max chip count visual guard in UI — 50 allergens × 100 chars renders as unbounded flex-wrap with no overflow control [apps/web/src/features/children/AddChildForm.tsx]

#### Deferred

- [x] [Review][Defer] No AAD binding wrapped DEK to its household [apps/api/src/lib/envelope-encryption.ts:40-46] — deferred, requires DB write + KEK access (total compromise); out of scope for this story
- [x] [Review][Defer] Array element strings have no content validation beyond length — allergens accept any non-empty string [packages/contracts/src/children.ts] — deferred, XSS risk depends on rendering context; rendered as text nodes not innerHTML
- [x] [Review][Defer] CHILD_COLUMNS raw string — column-name typos silently return undefined fields [apps/api/src/modules/children/children.repository.ts:43-44] — deferred, pre-existing pattern in codebase; no TypeScript-safe Supabase column selector available
