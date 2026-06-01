# Story 4-S5: Sacred-Channel Doctrine — Encryption + Lint

Status: done

**Slice key:** `4-s5-sacred-channel-doctrine-encryption-lint`
**Epic:** 4 — Lunch Link & Heart Note Sacred Channel
**Source slice doc:** `_bmad-output/planning-artifacts/epic-4-vertical-slices.md` §Slice 4-S5
**Builds on:** 4-S4 (emoji rating wired; `HeartNoteRepository.findByChildAndDate` is the current delivery read path; `LunchLinkService.verifyAndFetch` calls it at line 200 of `lunch-link.service.ts`)
**Folds:** FR38 (delivery fidelity — no AI modification), FR39 (no system messaging on Heart Note surface), AR-10 (envelope encryption, full)

**WALL: MVP wall.** This is the smallest set that delivers a sacred-channel-compliant Heart Note flow end-to-end. Beta-cohort decisions hinge on this slice landing.

---

## Story

As a **parent**,
I want **my Heart Note to be stored encrypted and delivered to my child exactly as I wrote it**,
so that **the system cannot modify, read without audit, or route through AI the content of the most personal thing I send my child**.

---

## Acceptance Criteria

**AC1.** `heart_notes.content` is stored as AES-256-GCM ciphertext (per-household DEK) in staging/production. In dev/test (no `ENVELOPE_ENCRYPTION_MASTER_KEY`), content is stored as `NOOP:<base64>` (plaintext passthrough). In both modes, the service returns decrypted plaintext to all callers — encryption is transparent above the repository layer.

**AC2.** `HeartNoteRepository` accepts a `kek: Buffer | null` constructor parameter. All write paths (`create`, `patch`) call `getOrCreateHouseholdDek(this.client, this.kek, householdId)` to obtain the DEK, then `encryptField(content, dek)` before persisting. All read paths decrypt with `decryptField<string>(row.content, dek)`.

**AC3.** A new `HeartNoteRepository.findForDelivery(householdId, childId, isoDate)` method is the exclusive delivery read path. It has the same query and decryption logic as the existing `findByChildAndDate`, but is separately named so the sacred-channel lint rule can target it. `LunchLinkService.verifyAndFetch` changes its call from `heartNoteRepo.findByChildAndDate` to `heartNoteRepo.findForDelivery`.

**AC4.** `heart-note.routes.ts` extracts kek from `fastify.env.ENVELOPE_ENCRYPTION_MASTER_KEY` and passes it to `HeartNoteRepository`. `lunch-link.routes.ts` does the same for the `HeartNoteRepository` it constructs for `LunchLinkService`. No other changes to service or routes logic.

**AC5.** A DB migration `20261002000000_heart_note_content_encryption_marker.sql` marks the column as now containing ciphertext (comment only — no schema change; column stays `text`). A backfill script `apps/api/scripts/backfill-heart-note-content.ts` encrypts any existing plaintext rows. It is idempotent (safe to re-run), skips rows already in NOOP or AES format, and exits 0 on success.

**AC6.** A sacred-channel boundary check script `apps/api/scripts/check-sacred-channel-boundary.ts` exits non-zero if any TypeScript source file under `apps/api/src/` both:
- calls `.findForDelivery(` (the delivery read path), AND
- calls the LLM orchestrator (matches `orchestrator.complete(` or `this.orchestrator.complete(`).

The script exits 0 when no violations are found. It is wired as `pnpm --filter @hivekitchen/api check:sacred-channel` and runs in CI.

**AC7.** All existing heart-note routes tests pass with the encrypted repository. New tests cover: round-trip encrypt/decrypt on `create`→`findByChildAndDate`, empty-content NOOP round-trip, `findForDelivery` decrypts correctly, `patch` encrypts updated content.

**AC8.** `pnpm typecheck` introduces no new type errors. `pnpm --filter @hivekitchen/api test -- heart-note` passes.

---

## Demo Path

> 1. Write a Heart Note via `/app/heart-note` (S1 compose flow).
> 2. Open Supabase SQL editor → `SELECT content FROM heart_notes` → see ciphertext blob (staging/prod) or `NOOP:` prefix (dev).
> 3. Reload `/app/heart-note` → see your plaintext (decryption working on parent read path).
> 4. Reload child Lunch Link → note renders correctly (decryption working on delivery read path).
> 5. As a developer: add `this.orchestrator.complete(` next to a `findForDelivery(` call in any file, run `pnpm --filter @hivekitchen/api check:sacred-channel` → script exits 1 with a clear violation message.
> 6. Remove the violation → script exits 0.

Manual test steps:
1. Run `pnpm dev:api` with `ENVELOPE_ENCRYPTION_MASTER_KEY` unset (dev mode).
2. POST `POST /v1/heart-notes` with `{ child_id, content: "Have a great day!", scheduled_for: "<today>" }`.
3. `SELECT content FROM heart_notes ORDER BY created_at DESC LIMIT 1` → see `NOOP:SGF2ZS...` (base64 of JSON-encoded string).
4. `GET /v1/heart-notes?child_id=<id>&date=<today>` → response shows `content: "Have a great day!"` (decrypted).
5. Open child Lunch Link → Heart Note text renders correctly.
6. Now set a real 64-char hex `ENVELOPE_ENCRYPTION_MASTER_KEY`, restart API, POST a new note.
7. `SELECT content FROM heart_notes ORDER BY created_at DESC LIMIT 1` → see a base64 blob (NOT `NOOP:` prefixed).
8. GET the note → still decrypts correctly.
9. Run `pnpm --filter @hivekitchen/api check:sacred-channel` → exits 0.

---

## Critical Guardrails — Read First

**DO NOT touch any service logic.** `HeartNoteService` methods (`createDraft`, `getDraft`, `patchNote`) do NOT change. Encryption/decryption is purely at the repository layer. The service receives and returns plaintext strings.

**DO NOT change any contracts.** `HeartNotePayloadSchema`, `LunchLinkPublicHeartNoteSchema`, and all other contract shapes are unchanged — callers always receive decrypted content. No contract update, no types package update.

**`findForDelivery` is NOT a general-purpose read.** It is the sentinel method name the lint rule targets. Only `LunchLinkService.verifyAndFetch` should call it. The parent-facing compose view continues to use `findByChildAndDate`. Do not merge them into one method.

**DO NOT change `findByChildAndDate`'s signature.** It already accepts `householdId` — use it to look up the DEK. Do not add a new parameter.

**`getOrCreateHouseholdDek` vs `getHouseholdDek`**: Use `getOrCreateHouseholdDek` on ALL write paths (creates the DEK if the household doesn't have one yet). Use `getHouseholdDek` on read paths (fails gracefully to null if no DEK exists yet — the NOOP path handles it).

**NOOP mode must be transparent.** When `kek === null` (dev/test), `encryptField(data, null)` returns `NOOP:<base64>` and `decryptField<string>('NOOP:<base64>', null)` returns the original string. This is handled by the existing `envelope-encryption.ts` functions — do not add your own NOOP logic.

**Empty content edge case.** The existing default is `content: ''`. `encryptField('', dek)` encrypts JSON.stringify('') = `'""'`. `decryptField<string>(..., dek)` returns `''`. Both paths must handle empty strings without special-casing.

**The backfill script must detect already-encrypted rows.** A row whose `content` starts with `NOOP:` is already in NOOP format — skip it. A row whose `content` is a valid base64 string of length >= 40 chars (minimum AES-GCM 28 bytes → 40 base64 chars) is likely already AES-encrypted — skip it. A row with `content: ''` or short non-base64 content is plaintext — encrypt it. The script must NOT double-encode already-encrypted rows.

**The lint script targets co-location in the same file.** It does NOT trace call graphs. If a file imports/calls `findForDelivery` AND `orchestrator.complete`, it's a violation. A call graph analysis is out of scope — same-file co-location is sufficient for the MVP boundary check.

**DO NOT wire the lint script into turbo.json `dependsOn` chains.** Add it as a standalone `check:sacred-channel` script in `apps/api/package.json`. CI runs it separately from the build/test pipeline so it can be adopted without blocking hot-paths.

**No web changes.** Encryption is API-only and transparent to the frontend. Do not touch anything in `apps/web`.

---

## What Already Exists (Do Not Recreate)

**Encryption library** — `apps/api/src/lib/envelope-encryption.ts` exports:
- `encryptField(data: unknown, dek: Buffer | null): string` — AES-256-GCM; returns `NOOP:` prefix when `dek === null`
- `decryptField<T>(ciphertext: string, dek: Buffer | null): T` — decrypts; handles NOOP prefix
- `generateDek(): Buffer`, `wrapDek(dek, kek): string`, `unwrapDek(encryptedDek, kek): Buffer`

**DEK management** — `apps/api/src/lib/household-key.ts` exports:
- `getHouseholdDek(client, kek, householdId): Promise<Buffer | null>` — reads `households.encrypted_dek`, unwraps with KEK; returns null if no DEK yet
- `getOrCreateHouseholdDek(client, kek, householdId): Promise<Buffer | null>` — creates DEK if missing (conditional UPDATE to avoid race), always re-fetches after write

**`households.encrypted_dek` column** — already exists. Same column used by `ChildrenRepository` for allergen + cultural identifier encryption (Story 2.10). Do not add a new DEK column.

**`fastify.env` decorator** — `app.ts` line 91: `app.decorate('env', env)`. All route plugins can access `fastify.env.ENVELOPE_ENCRYPTION_MASTER_KEY` (type: `string | undefined`).

**`HeartNoteRepository`** — `apps/api/src/modules/heart-notes/heart-note.repository.ts`. Current constructor: `constructor(client: SupabaseClient)`. Has `create`, `patch`, `findByChildAndDate`, `childBelongsToHousehold`. **Extend this class** — do not rewrite.

**`HeartNoteService`** — `apps/api/src/modules/heart-notes/heart-note.service.ts`. Calls `repo.create`, `repo.patch`, `repo.findByChildAndDate`. **No changes to this class.**

**`heart-note.routes.ts`** — constructs `HeartNoteRepository` with only `fastify.supabase`. **Change only the constructor call** to pass `kek`.

**`LunchLinkService.verifyAndFetch`** — `apps/api/src/modules/lunch-link/lunch-link.service.ts` line 200. Currently: `this.heartNoteRepo.findByChildAndDate(childInfo.household_id, parsed.child_id, parsed.date)`. **Change only this line** to call `findForDelivery`.

**`lunch-link.routes.ts`** — constructs `HeartNoteRepository` at line 26 with only `fastify.supabase`. **Change only the constructor call** to pass `kek`.

**`BaseRepository`** — `apps/api/src/repository/base.repository.ts`. `HeartNoteRepository extends BaseRepository`. Do not change the base class.

**`audit.types.ts`** — `'heart_note.created'`, `'heart_note.updated'`, `'heart_note.sent'`, `'heart_note.delivered'`, `'heart_note.delivery_failed'` already declared. No new event type needed for this slice.

**`env.ts`** — `ENVELOPE_ENCRYPTION_MASTER_KEY: optionalEmptyAsUndefined(z.string().regex(/^[0-9a-fA-F]{64}$/, ...))`. Type is `string | undefined`. When present in staging/production (enforced by `superRefine`), it is a 64-char hex string. When absent in dev/test, `kek = null`.

---

## Tasks

### T1 — Extend `HeartNoteRepository` with encryption

**File:** `apps/api/src/modules/heart-notes/heart-note.repository.ts`

Add imports at the top:
```typescript
import { Buffer } from 'node:buffer';
import { encryptField, decryptField } from '../../lib/envelope-encryption.js';
import { getHouseholdDek, getOrCreateHouseholdDek } from '../../lib/household-key.js';
```

**T1.1** Change the constructor to accept `kek`:
```typescript
export class HeartNoteRepository extends BaseRepository {
  constructor(
    client: SupabaseClient,
    private readonly kek: Buffer | null,
  ) {
    super(client);
  }
```

**T1.2** Update `create()` to encrypt content:
```typescript
async create(params: CreateHeartNoteParams): Promise<HeartNoteRow> {
  const dek = await getOrCreateHouseholdDek(this.client, this.kek, params.householdId);
  const encryptedContent = encryptField(params.content, dek);

  const { data, error } = await this.client
    .from('heart_notes')
    .insert({
      household_id: params.householdId,
      child_id: params.childId,
      author_user_id: params.authorUserId,
      content: encryptedContent,
      scheduled_for: params.scheduledFor ?? null,
    })
    .select(HEART_NOTE_COLUMNS)
    .single();
  if (error) throw error;
  const row = data as HeartNoteRow;
  return { ...row, content: params.content }; // return plaintext to caller
}
```

**T1.3** Update `findByChildAndDate()` to decrypt content:
```typescript
async findByChildAndDate(
  householdId: string,
  childId: string,
  isoDate: string,
): Promise<HeartNoteRow | null> {
  const { data, error } = await this.client
    .from('heart_notes')
    .select(HEART_NOTE_COLUMNS)
    .eq('household_id', householdId)
    .eq('child_id', childId)
    .eq('scheduled_for', isoDate)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  const row = (data as HeartNoteRow | null) ?? null;
  if (row === null) return null;
  const dek = await getHouseholdDek(this.client, this.kek, householdId);
  return { ...row, content: decryptField<string>(row.content, dek) };
}
```

**T1.4** Add `findForDelivery()` — the sacred-channel delivery boundary method. MUST be a separate method from `findByChildAndDate`; do NOT call `findByChildAndDate` from it (keeps the lint rule's same-file detection clean):
```typescript
// Sacred-channel delivery read path. Named separately from findByChildAndDate
// so the lint rule (check-sacred-channel-boundary.ts) can detect any file that
// calls both this method and the LLM orchestrator — a violation of FR38/FR39.
async findForDelivery(
  householdId: string,
  childId: string,
  isoDate: string,
): Promise<HeartNoteRow | null> {
  const { data, error } = await this.client
    .from('heart_notes')
    .select(HEART_NOTE_COLUMNS)
    .eq('household_id', householdId)
    .eq('child_id', childId)
    .eq('scheduled_for', isoDate)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  const row = (data as HeartNoteRow | null) ?? null;
  if (row === null) return null;
  const dek = await getHouseholdDek(this.client, this.kek, householdId);
  return { ...row, content: decryptField<string>(row.content, dek) };
}
```

**T1.5** Update `patch()` to encrypt updated content:
```typescript
async patch(
  id: string,
  householdId: string,
  params: PatchHeartNoteParams,
): Promise<HeartNoteRow | null> {
  const update: Record<string, unknown> = {};
  if (params.content !== undefined) {
    const dek = await getOrCreateHouseholdDek(this.client, this.kek, householdId);
    update.content = encryptField(params.content, dek);
  }
  if (params.scheduledFor !== undefined) update.scheduled_for = params.scheduledFor;

  const { data, error } = await this.client
    .from('heart_notes')
    .update(update)
    .eq('id', id)
    .eq('household_id', householdId)
    .select(HEART_NOTE_COLUMNS)
    .maybeSingle();
  if (error) throw error;
  const row = (data as HeartNoteRow | null) ?? null;
  if (row === null) return null;
  // Decrypt for the return value so the caller receives plaintext.
  const dek = await getHouseholdDek(this.client, this.kek, householdId);
  return { ...row, content: decryptField<string>(row.content, dek) };
}
```

**⚠️ `patch` DEK efficiency note:** When `params.content !== undefined`, two DEK lookups happen (one for encrypt, one for decrypt at the end). Combine them: call `getOrCreateHouseholdDek` once and reuse the result for both encrypt and the post-patch decrypt. When `params.content === undefined` (content unchanged), call `getHouseholdDek` only for the post-patch decrypt.

Revised `patch` with combined DEK lookup:
```typescript
async patch(
  id: string,
  householdId: string,
  params: PatchHeartNoteParams,
): Promise<HeartNoteRow | null> {
  const update: Record<string, unknown> = {};

  // Determine DEK need: getOrCreate for write path; getHousehold (read-only)
  // for decrypt-only path. Keep to a single round-trip.
  let dek: Buffer | null = null;
  if (params.content !== undefined) {
    dek = await getOrCreateHouseholdDek(this.client, this.kek, householdId);
    update.content = encryptField(params.content, dek);
  }
  if (params.scheduledFor !== undefined) update.scheduled_for = params.scheduledFor;

  const { data, error } = await this.client
    .from('heart_notes')
    .update(update)
    .eq('id', id)
    .eq('household_id', householdId)
    .select(HEART_NOTE_COLUMNS)
    .maybeSingle();
  if (error) throw error;
  const row = (data as HeartNoteRow | null) ?? null;
  if (row === null) return null;

  // Reuse the DEK from the encrypt step if available; otherwise fetch for decrypt.
  if (dek === null) dek = await getHouseholdDek(this.client, this.kek, householdId);
  return { ...row, content: decryptField<string>(row.content, dek) };
}
```

---

### T2 — Inject kek into `heart-note.routes.ts`

**File:** `apps/api/src/modules/heart-notes/heart-note.routes.ts`

Add import:
```typescript
import { Buffer } from 'node:buffer';
```

Change the repository construction in the plugin body:
```typescript
// Before (S1):
const repository = new HeartNoteRepository(fastify.supabase);

// After (S5):
const kek = fastify.env.ENVELOPE_ENCRYPTION_MASTER_KEY
  ? Buffer.from(fastify.env.ENVELOPE_ENCRYPTION_MASTER_KEY, 'hex')
  : null;
const repository = new HeartNoteRepository(fastify.supabase, kek);
```

No other changes to this file.

---

### T3 — Inject kek into `lunch-link.routes.ts` and switch to `findForDelivery`

**File:** `apps/api/src/modules/lunch-link/lunch-link.routes.ts`

Add import:
```typescript
import { Buffer } from 'node:buffer';
```

Change the `HeartNoteRepository` construction (line 26):
```typescript
// Before (S4):
const heartNoteRepo = new HeartNoteRepository(fastify.supabase);

// After (S5):
const kek = fastify.env.ENVELOPE_ENCRYPTION_MASTER_KEY
  ? Buffer.from(fastify.env.ENVELOPE_ENCRYPTION_MASTER_KEY, 'hex')
  : null;
const heartNoteRepo = new HeartNoteRepository(fastify.supabase, kek);
```

No other changes to `lunch-link.routes.ts`.

---

### T4 — Switch `LunchLinkService.verifyAndFetch` to `findForDelivery`

**File:** `apps/api/src/modules/lunch-link/lunch-link.service.ts`

At line 200, change ONE line:
```typescript
// Before (S4):
const noteRow = await this.heartNoteRepo.findByChildAndDate(
  childInfo.household_id,
  parsed.child_id,
  parsed.date,
);

// After (S5):
const noteRow = await this.heartNoteRepo.findForDelivery(
  childInfo.household_id,
  parsed.child_id,
  parsed.date,
);
```

No other changes to this file. The content check `noteRow.content.trim().length > 0` on line 206 remains — it works correctly whether content is plaintext (decrypted by repository) or empty string.

---

### T5 — DB Migration + Backfill Script

**T5.1** Create migration file `supabase/migrations/20261002000000_heart_note_content_encryption_marker.sql`:

```sql
-- heart_notes.content is now persisted as envelope-encrypted ciphertext.
-- The 'content' column schema (text NOT NULL DEFAULT '') is unchanged;
-- the application layer (HeartNoteRepository) encrypts on write and decrypts
-- on read using AES-256-GCM with a per-household DEK.
--
-- Backfill: run `pnpm --filter @hivekitchen/api backfill:heart-notes` BEFORE
-- deploying the 4-s5 API code, to re-encrypt any plaintext rows written
-- by the 4-S1 implementation.
--
-- Operator runbook:
--   1. Apply this migration.
--   2. Run: pnpm --filter @hivekitchen/api backfill:heart-notes
--   3. Verify: SELECT COUNT(*) FROM heart_notes WHERE content NOT LIKE 'NOOP:%' AND length(content) < 40;
--      → should return 0 (all rows now encrypted or empty-string encrypted).
--   4. Deploy 4-s5 API code.
```

**T5.2** Create backfill script `apps/api/scripts/backfill-heart-note-content.ts`:

The script must:
1. Import `parseEnv` from `../src/common/env.js`, `createClient` from `@supabase/supabase-js`, `encryptField` + `decryptField` from `../src/lib/envelope-encryption.js`, `getOrCreateHouseholdDek` from `../src/lib/household-key.js`.
2. Parse env at startup; derive `kek = env.ENVELOPE_ENCRYPTION_MASTER_KEY ? Buffer.from(..., 'hex') : null`.
3. Read `heart_notes` rows in pages of 100 (`ORDER BY id` for stable pagination, using `id > lastId` cursor).
4. For each row, apply skip-or-encrypt logic:
   - `if (row.content.startsWith('NOOP:')) continue;` — already in NOOP format
   - `if (/^[A-Za-z0-9+/=]{40,}$/.test(row.content) && !row.content.includes(' ')) continue;` — likely already AES-encrypted (40+ base64 chars, no spaces)
   - Otherwise: call `getOrCreateHouseholdDek(client, kek, row.household_id)` → `encryptField(row.content, dek)` → UPDATE the row
5. Track `rows_scanned`, `rows_skipped`, `rows_encrypted`, `errors` counters.
6. Log using `console.log` (this is a standalone operator script, not the API — `console.log` is acceptable per project conventions for standalone scripts, as confirmed by 2-s27 deferred entry).
7. Exit 0 on completion, non-zero on unrecovered error.
8. Add `"backfill:heart-notes": "tsx scripts/backfill-heart-note-content.ts"` to `apps/api/package.json` scripts.

**Idempotency invariant:** Running the script twice must produce the same end state. A row that was already encrypted (NOOP or AES) on the second run must be skipped.

---

### T6 — Sacred Channel Lint Rule Script

**T6.1** Create `apps/api/scripts/check-sacred-channel-boundary.ts`:

```typescript
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Sacred-channel boundary check (Story 4-S5).
// Fails if any TypeScript file under apps/api/src/ both:
//   (a) calls the sacred-channel delivery read path: .findForDelivery(
//   (b) calls the LLM orchestrator: orchestrator.complete(
//
// The Heart Note delivery path must NEVER route through the LLM (FR38, FR39).

const SRC_DIR = fileURLToPath(new URL('../src', import.meta.url));

const DELIVERY_PATTERN = /\.findForDelivery\s*\(/;
const LLM_PATTERNS = [
  /\borchestrator\.complete\s*\(/,
  /this\.orchestrator\.complete\s*\(/,
  /fastify\.orchestrator\.complete\s*\(/,
];

async function getTypeScriptFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.ts') && !e.name.endsWith('.test.ts'))
    .map((e) => join(e.parentPath ?? e.path, e.name));
}

async function main(): Promise<void> {
  const files = await getTypeScriptFiles(SRC_DIR);
  const violations: string[] = [];

  for (const file of files) {
    const src = await readFile(file, 'utf-8');
    if (!DELIVERY_PATTERN.test(src)) continue;
    const hasLlmCall = LLM_PATTERNS.some((p) => p.test(src));
    if (hasLlmCall) violations.push(file);
  }

  if (violations.length > 0) {
    console.error('Sacred-channel boundary violation (FR38/FR39):');
    console.error('The following files call both findForDelivery and the LLM orchestrator.');
    console.error('Heart Note delivery must NEVER route through AI. Remove the LLM call.');
    for (const f of violations) console.error(`  ✗ ${f}`);
    process.exit(1);
  }

  console.log(`Sacred-channel check: OK (${files.length} files scanned, 0 violations)`);
}

main().catch((err) => {
  console.error('check-sacred-channel-boundary: unexpected error:', err);
  process.exit(1);
});
```

**T6.2** Add the script to `apps/api/package.json` scripts:
```json
"check:sacred-channel": "tsx scripts/check-sacred-channel-boundary.ts"
```

**T6.3** Wire into CI: The script runs as part of the existing CI pipeline. Add `pnpm --filter @hivekitchen/api check:sacred-channel` to the CI steps that run after `pnpm build` (or alongside `pnpm lint` / `pnpm typecheck`). The exact CI file (`/.github/workflows/*.yml`) must be identified by checking the existing CI workflow files in the repo.

---

### T7 — Tests

**T7.1** Update `apps/api/src/modules/heart-notes/heart-note.repository.test.ts` (or create if it doesn't exist).

Add a `kek = null` (NOOP mode) test suite — keeps tests environment-independent:

```typescript
describe('HeartNoteRepository (NOOP mode — kek = null)', () => {
  it('create: stores NOOP-prefixed content in DB, returns plaintext to caller');
  it('findByChildAndDate: decrypts NOOP-prefixed content, returns plaintext');
  it('findForDelivery: decrypts NOOP-prefixed content, returns plaintext');
  it('findByChildAndDate: returns null when no row matches');
  it('findForDelivery: returns null when no row matches');
  it('patch: encrypts updated content, returns plaintext');
  it('patch: does not re-encrypt when content is undefined (patch scheduledFor only)');
  it('create: handles empty string content (content = "")');
  it('findForDelivery: returns null for empty-string row? No — empty string is valid content');
});
```

**Mock pattern:** Use the same `buildMockSupabase` pattern established in `heart-note.routes.test.ts`. The repository test should mock the Supabase client. When `kek === null`, `encryptField(str, null)` returns `NOOP:<base64>` — assert the DB call receives this value. `decryptField<string>('NOOP:<base64>', null)` returns the original string — assert the returned row has plaintext content.

**T7.2** Update `apps/api/src/modules/heart-notes/heart-note.routes.test.ts`.

The routes plugin now constructs `HeartNoteRepository(fastify.supabase, kek)`. Tests that mock the repository's `create`/`patch`/`findByChildAndDate` behavior remain structurally the same — the mock intercepts at the Supabase client level (the existing pattern). No structural changes to the routes tests needed if they mock the Supabase chain.

If the test builds a `HeartNoteRepository` directly, update the constructor call to `new HeartNoteRepository(client, null)`.

**T7.3** Update `apps/api/src/modules/lunch-link/lunch-link.service.test.ts`.

`LunchLinkService` tests mock `HeartNoteRepository`. The mock's method name changes from `findByChildAndDate` to `findForDelivery` in the S5 mocks:

```typescript
// Before (S4 mocks):
vi.spyOn(heartNoteRepo, 'findByChildAndDate').mockResolvedValue(mockNote);

// After (S5):
vi.spyOn(heartNoteRepo, 'findForDelivery').mockResolvedValue(mockNote);
```

Also add `findForDelivery` to the mocked repository shape.

**T7.4** Add a test for the `check-sacred-channel-boundary.ts` script:

Create `apps/api/scripts/check-sacred-channel-boundary.test.ts` with two fixture-based tests:
```typescript
it('exits 0 when no file calls both findForDelivery and orchestrator.complete');
it('exits 1 when a file calls both findForDelivery and orchestrator.complete');
```

These tests can create temp files in `os.tmpdir()` and call the script's internal `main()` function (extracted to make it testable), or fork the process and check the exit code.

---

## Dev Notes

### Why `findForDelivery` is a separate method, not just `findByChildAndDate`

The lint rule works by scanning for co-location of two patterns in the same file: `findForDelivery` and `orchestrator.complete`. If the delivery path re-used `findByChildAndDate`, the rule would need to track which callers of `findByChildAndDate` are in the delivery path — requiring full call-graph analysis. A distinct method name makes the boundary static and scannable with a simple grep. This is the same approach used by module boundary rules in other large codebases.

### DEK caching

`getOrCreateHouseholdDek` performs a Supabase SELECT + conditional UPDATE. It is called once per write path invocation. At current beta write volume (one note per child per day), this is acceptable with no caching. Do NOT add a module-level DEK cache in the repository — it would share state across Fastify plugin instances in tests.

### `HeartNoteRow.content` after T1

After T1, every `HeartNoteRow` returned from the repository contains decrypted plaintext in `content`. This is a transparent change — callers don't need to know about encryption. The type stays `content: string`.

### Backfill detection heuristic rationale

The heuristic skips rows that are:
1. `content.startsWith('NOOP:')` — previously written by the NOOP path (dev/test machines that already ran S5 code).
2. `/^[A-Za-z0-9+/=]{40,}$/.test(content) && !content.includes(' ')` — base64-only string of 40+ chars with no spaces. AES-GCM with a 12-byte nonce + 16-byte tag = 28 bytes minimum, which base64-encodes to 40 chars. Real heart note plaintext (sentences with spaces) will never pass this test.

If a row passes neither skip condition, it's treated as plaintext and re-encrypted. False positives (encrypting already-encrypted rows) would double-encode — the AES outer ciphertext would be decrypted to reveal an inner AES blob, which `JSON.parse` would reject as invalid. The heuristic is conservative enough to prevent this.

### Sacred-channel lint: what it does NOT cover

The script checks **same-file co-location** only. It does not trace: "does the function that calls `findForDelivery` transitively call the orchestrator in another file?" Full call-graph analysis would require building a TypeScript AST; that is 4-S18 scope (the more sophisticated absence-nudge lint rule). For the MVP sacred-channel enforcement, same-file co-location catches the most obvious violation pattern.

### LunchLinkService still imports HeartNoteRepository

`LunchLinkService` takes `HeartNoteRepository` as a constructor argument — it does not directly import the class in its file body. The lint rule would only flag a violation if `lunch-link.service.ts` contained BOTH a `findForDelivery(` call AND an `orchestrator.complete(` call. Since `verifyAndFetch` calls `findForDelivery` but has no LLM call, no violation is flagged. Correct behavior.

### CI wiring

Look for `/.github/workflows/` (or the equivalent CI config in this project). Find the step that runs `pnpm typecheck` or `pnpm lint` and add `pnpm --filter @hivekitchen/api check:sacred-channel` alongside it. If no CI config file exists in the repo, note it in the PR description and skip this sub-task (do not create one speculatively).

### `readdir` recursive option

`readdir(..., { recursive: true })` requires Node 18.17+. The project requires Node >=22 (`project-context.md` — "Node >=22 required"). The `entry.parentPath` property is available in Node 20+ for `withFileTypes` results; `entry.path` is the fallback for older Node. Use `entry.parentPath ?? entry.path` for safety.

### Existing test count baseline

From 4-S4 dev notes:
- `pnpm --filter @hivekitchen/api test -- lunch-link` → 71/71 (pre-S5)
- `pnpm --filter @hivekitchen/api test -- heart-note` → no count provided (repo tests likely new in S5)

After S5, expect `lunch-link.service.test.ts` to require the `findForDelivery` mock update. All other lunch-link tests are unaffected.

---

## Project Structure Notes

**New files:**
- `supabase/migrations/20261002000000_heart_note_content_encryption_marker.sql`
- `apps/api/scripts/backfill-heart-note-content.ts`
- `apps/api/scripts/check-sacred-channel-boundary.ts`
- `apps/api/scripts/check-sacred-channel-boundary.test.ts` (optional, if test infrastructure supports script testing)
- `apps/api/src/modules/heart-notes/heart-note.repository.test.ts` (if not already present)

**Modified files:**
- `apps/api/src/modules/heart-notes/heart-note.repository.ts` (T1 — constructor + encrypt/decrypt)
- `apps/api/src/modules/heart-notes/heart-note.routes.ts` (T2 — kek injection)
- `apps/api/src/modules/lunch-link/lunch-link.routes.ts` (T3 — kek injection)
- `apps/api/src/modules/lunch-link/lunch-link.service.ts` (T4 — findByChildAndDate → findForDelivery)
- `apps/api/src/modules/heart-notes/heart-note.repository.test.ts` (T7.1)
- `apps/api/src/modules/heart-notes/heart-note.routes.test.ts` (T7.2 — constructor call if applicable)
- `apps/api/src/modules/lunch-link/lunch-link.service.test.ts` (T7.3 — mock update)
- `apps/api/package.json` (T6.2 + T5.2 — new scripts)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — update `4-s5` to `ready-for-dev`
- `.github/workflows/*.yml` (T6.3 — CI wiring, if CI file exists)

**Not modified:**
- `apps/api/src/modules/heart-notes/heart-note.service.ts` — no service changes
- `packages/contracts/` — no contract changes (encryption transparent to callers)
- `packages/types/` — no type changes
- `apps/web/` — no frontend changes
- `apps/api/src/audit/audit.types.ts` — no new event types
- `apps/api/src/app.ts` — plugin registration unchanged
- `apps/api/src/lib/envelope-encryption.ts` — used as-is, not modified
- `apps/api/src/lib/household-key.ts` — used as-is, not modified
- `supabase/migrations/20260901000000_create_heart_notes.sql` — schema unchanged

---

## Task Completion Checklist

- [x] T1.1 — `HeartNoteRepository` constructor adds `kek: Buffer | null` param
- [x] T1.2 — `create()` encrypts content with `getOrCreateHouseholdDek` + `encryptField`; returns plaintext to caller
- [x] T1.3 — `findByChildAndDate()` decrypts content with `getHouseholdDek` + `decryptField<string>`
- [x] T1.4 — `findForDelivery()` added (separate method, same logic as findByChildAndDate)
- [x] T1.5 — `patch()` encrypts updated content; combined DEK lookup to avoid double round-trip
- [x] T2 — `heart-note.routes.ts` extracts kek from `fastify.env` and passes to repository constructor
- [x] T3 — `lunch-link.routes.ts` extracts kek from `fastify.env` and passes to `HeartNoteRepository` constructor
- [x] T4 — `LunchLinkService.verifyAndFetch` calls `findForDelivery` (not `findByChildAndDate`)
- [x] T5.1 — Migration file `20261002000000_heart_note_content_encryption_marker.sql` created
- [x] T5.2 — Backfill script `backfill-heart-note-content.ts` created; idempotent; skip logic correct
- [x] T5.2 — `backfill:heart-notes` script registered in `apps/api/package.json`
- [x] T6.1 — `check-sacred-channel-boundary.ts` script created; exits 1 on violation, 0 on clean
- [x] T6.2 — `check:sacred-channel` registered in `apps/api/package.json`
- [x] T6.3 — CI config updated to run `check:sacred-channel` (added as a `quality` step in `.github/workflows/ci.yml`)
- [x] T7.1 — `heart-note.repository.test.ts` covers NOOP-mode encrypt/decrypt round-trips for all methods
- [x] T7.2 — `heart-note.routes.test.ts` updated (sampleRow auto-wraps content via NOOP encoder)
- [x] T7.3 — `lunch-link.service.test.ts` mock updated from `findByChildAndDate` to `findForDelivery`
- [x] T7.4 — `check-sacred-channel-boundary.test.ts` fixture-based tests (4 cases) covering clean / violation / class-context / `*.test.ts` skip
- [x] `pnpm typecheck` — no new errors introduced by this slice (pre-existing failures in evals/voice/plans/households modules unrelated)
- [x] `pnpm --filter @hivekitchen/api test -- heart-note` — 32/32 pass
- [x] `pnpm --filter @hivekitchen/api test -- lunch-link` — 72/72 pass (was 71, +1 verifyAndFetch findForDelivery round-trip)
- [x] `pnpm --filter @hivekitchen/api check:sacred-channel` — exits 0 (154 files scanned)

---

## Dev Agent Record

### Implementation Plan
1. T1 — repository: add `kek` constructor param; wrap `create`/`patch` writes with `getOrCreateHouseholdDek` + `encryptField`; wrap `findByChildAndDate`/`findForDelivery` reads with `getHouseholdDek` + `decryptField<string>`. `patch` reuses the DEK from the encrypt step for the post-update decrypt to avoid a second round-trip.
2. T2/T3 — routes: extract kek from `fastify.env.ENVELOPE_ENCRYPTION_MASTER_KEY` (or null) and pass through to repository constructor.
3. T4 — `LunchLinkService.verifyAndFetch`: one-line swap from `findByChildAndDate` to `findForDelivery` (the sacred-channel sentinel method).
4. T5 — migration marker SQL + idempotent backfill script with NOOP- and AES-detection skip heuristic + keyset pagination by id.
5. T6 — sacred-channel lint script + CI wiring under the quality job.
6. T7 — repository tests, routes tests (NOOP-wrap sampleRow content), lunch-link service mock swap, fixture tests for the lint script.

### Completion Notes
- **NOOP-mode round-trip is verified.** With `ENVELOPE_ENCRYPTION_MASTER_KEY` unset (dev/test), `encryptField(x, null)` returns `NOOP:<base64>` and `decryptField<string>(...)` reverses it. All repository tests and route tests exercise this path.
- **Tests must wrap mock DB content with NOOP.** Both `heart-note.routes.test.ts` and `lunch-link.routes.test.ts` `sampleRow()`/`sampleNoteRow()` helpers now auto-wrap content via the NOOP encoder. Tests pass plaintext in `overrides.content`; the helper applies `encryptField(..., null)` when the override isn't already NOOP-prefixed. This keeps existing test bodies readable while satisfying the repo's decryption invariant.
- **Lint script entry guard uses `pathToFileURL`.** Initial implementation used a manual `file://` + backslash-to-slash replacement; on Windows the resulting URL is two-slash (`file://F:/...`) but `import.meta.url` is three-slash (`file:///F:/...`), so the entry check never fired. Switched to `pathToFileURL(process.argv[1]).href` (same fix as pre-4-s0). Verified: `pnpm check:sacred-channel` now correctly prints `Sacred-channel check: OK (154 files scanned, 0 violations)`.
- **DEK efficiency in `patch`.** When `content !== undefined`, the encrypt's DEK is reused for the post-update decrypt (single DEK fetch). When `content === undefined`, a single read-only DEK fetch happens after the update.
- **No service-layer or contract changes.** `HeartNoteService` and all Zod schemas are untouched; encryption is transparent above the repository.
- **CI wired.** Added a "Sacred-channel boundary check" step in the `quality` job of `.github/workflows/ci.yml`, after `tools:check`.
- **Backfill script idempotency.** The `isAlreadyEncrypted` helper skips rows that start with `NOOP:` OR look like base64-only ≥40 chars with no spaces. Real plaintext heart notes (English sentences with spaces) won't satisfy the second condition; AES-GCM ciphertext (28 bytes minimum → 40 base64 chars) will.
- **Pre-existing typecheck failures.** Unrelated to this slice — they live in `src/evals/runner.ts`, `src/jobs/plan-regeneration.job.test.ts`, several voice/plans/households test files, and `src/modules/voice/voice.routes.ts`. No new errors introduced.
- **Pre-existing test failures.** 29 failures across 10 unrelated files (auth, plans, audit-types, catalog-seed, extra-library, memory, day-overrides, planner-prompt, onboarding-tools). None touch heart-notes, lunch-link, or the sacred-channel scripts.

### File List

**New files:**
- `supabase/migrations/20261002000000_heart_note_content_encryption_marker.sql`
- `apps/api/scripts/backfill-heart-note-content.ts`
- `apps/api/scripts/check-sacred-channel-boundary.ts`
- `apps/api/scripts/check-sacred-channel-boundary.test.ts`

**Modified files:**
- `apps/api/src/modules/heart-notes/heart-note.repository.ts` — T1
- `apps/api/src/modules/heart-notes/heart-note.routes.ts` — T2
- `apps/api/src/modules/heart-notes/heart-note.repository.test.ts` — T7.1 (replaced with NOOP-mode coverage for all methods)
- `apps/api/src/modules/heart-notes/heart-note.routes.test.ts` — T7.2 (sampleRow content auto-wrap)
- `apps/api/src/modules/lunch-link/lunch-link.routes.ts` — T3
- `apps/api/src/modules/lunch-link/lunch-link.routes.test.ts` — T7.x (sampleNoteRow content auto-wrap)
- `apps/api/src/modules/lunch-link/lunch-link.service.ts` — T4 (verifyAndFetch now calls findForDelivery)
- `apps/api/src/modules/lunch-link/lunch-link.service.test.ts` — T7.3 (mock swap)
- `apps/api/package.json` — added `check:sacred-channel` + `backfill:heart-notes` scripts
- `.github/workflows/ci.yml` — added Sacred-channel boundary check step

### Change Log

| Date | Author | Summary |
|------|--------|---------|
| 2026-05-28 | Amelia (dev agent) | 4-S5 implementation: HeartNoteRepository envelope-encrypts content (AES-256-GCM in staging/prod, NOOP passthrough in dev/test); LunchLinkService.verifyAndFetch routes through `findForDelivery` (sacred-channel sentinel); `check:sacred-channel` lint script + CI wiring; idempotent backfill script + migration marker. Status → review. |
| 2026-05-28 | Code Review (3-layer) | Blind Hunter + Edge Case Hunter + Acceptance Auditor pass. 1 decision-needed, 2 patch, 5 defer, 17 dismissed. |

---

### Review Findings

- [x] [Review][Decision] Backfill uses `process.env` directly instead of `parseEnv` from `env.js` — Resolved: implemented script-scoped `BackfillEnvSchema` (Zod, same patterns as `env.ts`) validating only the 3 needed fields. Full `parseEnv()` requires all API secrets unavailable in a standalone backfill environment. [`apps/api/scripts/backfill-heart-note-content.ts`]

- [x] [Review][Patch] Deployment race window not documented in migration runbook — Added explicit race-window warning to runbook: re-run backfill immediately before switching traffic, or use a maintenance window. [`supabase/migrations/20261002000000_heart_note_content_encryption_marker.sql`]

- [x] [Review][Patch] `.d.ts` declaration files included in lint script scan — Added `!e.name.endsWith('.d.ts')` to `getTypeScriptFiles` filter. [`apps/api/scripts/check-sacred-channel-boundary.ts`]

- [x] [Review][Defer] `isAlreadyEncrypted` heuristic can misclassify 40+ char base64-safe text without spaces — A very long single-word plaintext (e.g., 40+ alphanumeric chars, no spaces) passes `BASE64_ONLY.test()` and is silently skipped, leaving it as plaintext post-deploy. Real heart notes (natural language sentences) have spaces and won't hit this; heuristic documented in spec. [`apps/api/scripts/backfill-heart-note-content.ts:isAlreadyEncrypted`] — deferred, acknowledged heuristic limitation in spec

- [x] [Review][Defer] `findByChildAndDate` and `findForDelivery` are identical query bodies — future patch to one silently leaves the other stale; lint rule only detects co-location violations, not divergence. Acknowledged in spec dev notes as a design trade-off (call-graph analysis deferred to 4-S18). [`apps/api/src/modules/heart-notes/heart-note.repository.ts`] — deferred, pre-existing design limitation per spec

- [x] [Review][Defer] Backfill fetches DEK per-row with no per-household cache — O(rows) DB round-trips vs O(households). Acceptable at current beta write volume per spec dev notes. [`apps/api/scripts/backfill-heart-note-content.ts:runBackfill`] — deferred, pre-existing, acceptable at beta scale

- [x] [Review][Defer] `main()` in lint script calls `getTypeScriptFiles` twice — double `readdir` creates a TOCTOU window; "N files scanned" count in OK message may differ from the actual scan (files created between the two calls). [`apps/api/scripts/check-sacred-channel-boundary.ts:main`] — deferred, minor accuracy issue

- [x] [Review][Defer] `decryptField` auth-tag failures surface with no row/household context — when GCM fails (wrong key or corruption), the thrown error has no `household_id`, `child_id`, or note `id` attached, making DB-level corruption hard to trace. Pino captures request ID but not which row caused the failure. [`apps/api/src/modules/heart-notes/heart-note.repository.ts`] — deferred, logging improvement, pre-existing concern with all encryption paths

---

## References

- [Source: `_bmad-output/planning-artifacts/epic-4-vertical-slices.md` §Slice 4-S5]
- [Source: `_bmad-output/implementation-artifacts/4-s4-emoji-rating.md`] — mock patterns, existing test counts, `findByChildAndDate` call site in `LunchLinkService.verifyAndFetch`, `HeartNoteRepository` current constructor shape
- [Source: `apps/api/src/lib/envelope-encryption.ts`] — `encryptField`, `decryptField`, NOOP prefix, AES-256-GCM
- [Source: `apps/api/src/lib/household-key.ts`] — `getHouseholdDek`, `getOrCreateHouseholdDek`, conditional UPDATE race handling
- [Source: `apps/api/src/modules/heart-notes/heart-note.repository.ts`] — current `HeartNoteRow`, `HEART_NOTE_COLUMNS`, `BaseRepository`
- [Source: `apps/api/src/modules/heart-notes/heart-note.service.ts`] — service is unchanged; receives/returns plaintext
- [Source: `apps/api/src/modules/heart-notes/heart-note.routes.ts`] — `fastify.env.WEB_BASE_URL` pattern shows how env is accessed in routes
- [Source: `apps/api/src/modules/lunch-link/lunch-link.routes.ts`] — `HeartNoteRepository` constructed at line 26; `fastify.env.WEB_BASE_URL` already used at line 30
- [Source: `apps/api/src/modules/lunch-link/lunch-link.service.ts`] — `findByChildAndDate` call site at line 200; content check at line 206
- [Source: `apps/api/src/common/env.ts`] — `ENVELOPE_ENCRYPTION_MASTER_KEY` type `string | undefined`; required in staging/production
- [Source: `apps/api/src/app.ts`] — `app.decorate('env', env)` at line 91; `heartNoteRoutes` registered at line 220
- [PRD Principle 3, FR38, FR39] — Sacred channel doctrine: Heart Note is delivered exactly as authored; no LLM modification, suggestion, or scaffolding
- [AR-10] — Per-household DEK wrapped by Supabase Vault KEK; AES-256-GCM; `heart_notes.content` named as an encrypted field
