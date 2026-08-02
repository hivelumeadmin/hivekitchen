# Story 15.2: signals-log-dual-write

Status: done

<!-- Epic 15: Canonical Data Model v2. Source spec: _bmad-output/planning-artifacts/canonical-data-model-v2-spec.md §4.9 (Signals), §7.1 (encryption), §7.2 (RLS), §7.4 (JSONB policy), §8 step 2 (strangler: dual-write first). -->
<!-- Grounded in 2-agent codebase research 2026-08-02. Key reconciliations vs the spec's prose: "leftover log" has NO existing producer (enum-reserved only); the extra_removal service is DORMANT (its only caller was retired in 3-DM-C1); the parity-correct seam for lunch_rating is the per-slot expansion, not the session-level route. -->

## Story

As the household's learning loop,
I want every "the family told us something" event appended to one immutable `signals` log at the moment it happens,
so that next week's plan can be explained and replayed from accumulated signals — and 15-s3 can build the `child_preferences` projection against a log that already has parity with the live write paths.

## Scope (strangler step 2 of 5 — dual-write ONLY)

This slice: `signals` table + append-only guarantees + Zod-validated dual-writes from the live learning paths. **No reads, no projection, no parity check, no retirement of old paths** (that is 15-s3). No REST routes, no web changes.

## Acceptance Criteria

1. **Migration `20261035000200_create_signals.sql`** creates `signal_kind` + `signal_source` enums and the `signals` table per the DDL in Dev Notes — including both spec indexes, RLS **in the same file** (spec §7.2), and a DB-level append-only guard (`BEFORE UPDATE OR DELETE` trigger raising an exception — the API uses service-role which bypasses RLS, so RLS alone cannot enforce append-only). **NO kitchen-map bump trigger**: `KitchenMapRepository.loadRaw()` does not read `signals` (verified against `kitchen-map.repository.ts:283-441`); §7.3 binds triggers to loadRaw sources only — record this decision in the migration header so a future reviewer doesn't blind-copy the 15-s1 precedent. A `-- Rollback:` comment block lists the DROPs. **USER-SIDE GATE:** `supabase db push --include-all`.
2. **Contracts** `packages/contracts/src/signals.ts` (+ colocated test): `SignalKindSchema` (`lunch_rating | lunch_request | leftover_log | extra_removal | preference_edit`), `SignalSourceSchema` (`lunch_link | app | voice | import`), per-kind payload schemas composed as `z.discriminatedUnion('kind', ...)` (`TurnBody` precedent, `thread.ts:73`), `SignalRowSchema`, `RecordSignalInputSchema`. Types plumbed through `packages/types`; `contracts:check` passes. Payload shapes in Dev Notes are authoritative.
3. **`SignalsRepository`** (`apps/api/src/modules/signals/signals.repository.ts`) extends `BaseRepository` and is **insert-only** — `insert()` plus nothing else (AuditRepository precedent, `audit.repository.ts:20`). No update/delete methods exist.
4. **`SignalsService`** (`apps/api/src/modules/signals/signals.service.ts`) is the single write boundary: (a) runtime `.parse()` of the discriminated payload BEFORE insert — this is a deliberately **stricter pattern than existing jsonb writes** (brief_state/thread_turns validate at compile time only; spec §7.4 explicitly requires runtime Zod for signal payloads); (b) free-text payload fields are encrypted under the household DEK before insert — `lunch_request.text` and `preference_edit.item` — via `encryptField` + `getOrCreateHouseholdDek` (heart_notes pattern, `heart-note.repository.ts:56-73`; kek injected via constructor, `heart-note.routes.ts:50-53` precedent); (c) **`record()` never throws** — any failure (Zod, DEK, insert) is caught and warn-logged with `{ household_id, kind }` and no free text. The secondary-write convention is warn-and-continue (`lunch-link.routes.ts:211-232` precedent); a signals failure must never 5xx a primary path.
5. **`lunch_rating` dual-write** at the per-slot expansion seam: `ChildPreferencesService.recordRatingSignals` (`child-preferences.service.ts:42-114`) writes one `signals` row per slot alongside each existing `upsertSignal` call — `subject_ref: { recipe_id, slot_kind }`, `payload: { kind: 'lunch_rating', rating, date }`, `source: 'lunch_link'`, `occurred_at` = submission time. This seam (not the session-level route) is chosen because 15-s3's projection must reproduce `child_preferences`, which is per-slot — parity is impossible from a session-level signal. Re-rating before 8pm appends a NEW signal (spec §4.9: a correction is a new signal); the `lunch_link_sessions.rating` overwrite behavior is unchanged.
6. **`lunch_request` dual-write** at the submit seam: `ChildRequestService.submitRequest` (`child-request.service.ts:41-69`) after the `create()` at line 47 — `subject_ref: { request_id, session_id }`, `payload: { kind: 'lunch_request', text: <ciphertext> }`, `source: 'lunch_link'`. Note: this makes the signal STRICTER than its source table (`child_lunch_requests.request_text` is plaintext today) per spec §7.1's explicit listing of `signals.payload` free text as encrypted — record this asymmetry, do NOT "fix" the source table (that is not this slice).
7. **`preference_edit` dual-write** at all three `FoodPreferencesRepository.declare()` call seams — (a) onboarding tool `food_preference.declare` (`onboarding.tools.ts:781-788`), (b) child-request approval mirror (`child-request.service.ts:105-116`), (c) Lumi shared-tastes tool (`lumi.service.ts:413-461`) — `payload: { kind: 'preference_edit', item: <ciphertext>, valence, enforcement, scope }`, `source: 'app'` for all three (onboarding is text-first; revisit `voice` when the voice path ships). `item` MUST be ciphertext: `food_preferences.item` is encrypted at rest today — a plaintext copy in `signals` would silently weaken existing encryption.
8. **`extra_removal` dual-write** inside `ExtraRemovalSignalService.recordRemoval` (`extra-removal-signal.service.ts:55-102`) alongside the existing insert — `subject_ref: { plan_item_id }`, `payload: { kind: 'extra_removal', component_type }`, `source: 'app'`. **DISCLOSED: this service has NO production caller** (the flat `swapItem` path was retired in 3-DM-C1; `plans.service.ts:477-489` documents the re-wiring as its own follow-up slice). The dual-write ships so the seam is signal-complete when the caller returns; tests exercise it directly. **`leftover_log` gets NO producer** — the feature does not exist (only the deferred `'pantry_leftover_changed'` trigger type, `plan-adjustment.types.ts:9,20`, Epic 6); the enum value is reserved and this is an explicit non-goal.
9. **No behavior change on primary paths:** no read path touches `signals`; planner, kitchen map, briefs are byte-identical (no loadRaw change, no prompt change). Every seam's dual-write is fire-and-forget; each seam has a test proving the primary write succeeds when the signals write fails. **No new audit_event_type**: every producing path already audits (`lunch_link.rated`, `household.profile_updated`, `plan.extra_bias_applied`) — a `signals` row is itself an append-only record; adding audit events for it would be double bookkeeping.
10. **Gates:** `pnpm turbo lint typecheck test` green; `knip` exit 0; `contracts:check` passes; API suite zero new failures vs baseline **2450 passed / 0 failed / 39 skipped**; zero `apps/web` source changes; full E2E at baseline **425 passed / 13 skipped / 0 failed** (contracts package changes shape → run the full suite even though web is untouched, 15-s1 precedent).

## Tasks / Subtasks

- [x] Task 1 — Migration (AC: #1)
  - [x] 1.1 `supabase/migrations/20261035000200_create_signals.sql`: DO-block idempotent enums → table → 2 indexes (`IF NOT EXISTS`) → RLS (inline `users.current_household_id` subquery form, 20261035000000:104-121 template) → append-only guard trigger → header comment recording the no-kitchen-map-trigger decision → `-- Rollback:` block. Full DDL in Dev Notes. Use `cardinality()` not `array_length()` if any array CHECK is ever added (15-s1 review lesson — none needed here).
- [x] Task 2 — Contracts + types (AC: #2)
  - [x] 2.1 `packages/contracts/src/signals.ts` per Dev Notes shapes; standard story/migration header comment; `.strict()` on every payload member so unknown keys are rejected at the write boundary.
  - [x] 2.2 Export from `packages/contracts/src/index.ts` (append, `.js` extension); `z.infer` aliases in `packages/types/src/index.ts` (both blocks); run `contracts:check`.
  - [x] 2.3 `signals.test.ts`: each kind round-trips; wrong-kind payload vs kind mismatch rejected; unknown payload keys rejected; bad source/kind enums rejected; `child_id` nullability.
- [x] Task 3 — Repository + service (AC: #3, #4)
  - [x] 3.1 `SignalsRepository.insert(row)` — single method, returns the inserted id; raw error propagates to the service (which swallows).
  - [x] 3.2 `SignalsService` with constructor `(supabase, kek: Buffer | null, logger)`: `record(input)` → parse discriminated payload → encrypt free-text fields (`lunch_request.text`, `preference_edit.item`) via `getOrCreateHouseholdDek` + `encryptField` → insert → catch-all warn log `{ household_id, kind }` (never the payload). Export the per-kind input types.
  - [x] 3.3 Unit tests: happy path per kind; Zod-invalid payload → no insert + warn, no throw; DEK failure → no throw; insert failure → no throw; ciphertext actually stored for the two free-text kinds (assert NOT plaintext-equal); no payload content in log calls.
- [x] Task 4 — lunch_rating seam (AC: #5)
  - [x] 4.1 Wire `SignalsService` into `ChildPreferencesService.recordRatingSignals` (constructor-inject; plugin wiring where `childPrefsService` is built — follow the existing wiring in `lunch-link.routes.ts`). One `record()` per slot next to each `upsertSignal`.
  - [x] 4.2 Tests in `child-preferences.service.test.ts`: N slots → N signals with matching `subject_ref`; re-rating appends (2 calls → 2 signal sets); signals failure does not break `upsertSignal` writes.
- [x] Task 5 — lunch_request seam (AC: #6)
  - [x] 5.1 Wire into `ChildRequestService.submitRequest` after `create()`. `subject_ref.request_id` = created row id.
  - [x] 5.2 Tests in `child-request.service.test.ts`: signal recorded with ciphertext text; submit still 201s when signals write fails.
- [x] Task 6 — preference_edit seams (AC: #7)
  - [x] 6.1 Wire the three `declare()` call sites (onboarding tool factory, child-request approve, lumi shared-tastes). Each seam passes `scope: child | household` from its own context.
  - [x] 6.2 Tests: one per seam in the existing test files (`onboarding.tools.test.ts`, `child-request.service.test.ts`, `lumi.service.test.ts`) asserting the signal write + fire-and-forget behavior.
- [x] Task 7 — extra_removal seam + reserved kind (AC: #8)
  - [x] 7.1 Wire into `ExtraRemovalSignalService.recordRemoval`; extend `extra-removal-signal.service.test.ts`.
  - [x] 7.2 No leftover_log producer — confirm nothing references the enum value outside contracts + migration.
- [x] Task 8 — Verification & gates (AC: #9, #10)
  - [x] 8.1 `pnpm turbo lint typecheck test`, `knip`, `contracts:check`.
  - [x] 8.2 Full API suite: zero new failures vs 2450/0/39. Negative control per repo doctrine (e.g. revert one seam wiring → its new test fails; restore → passes).
  - [x] 8.3 Confirm zero `apps/web/src` + `apps/web/test` changes; run full E2E anyway (contracts changed): expect 425/13/0.
  - [x] 8.4 Dev Record: files, decisions, deviations (record them — 15-s1 review flagged undisclosed ones), baselines; update `sprint-status.yaml`.

### Review Findings

<!-- Code review 2026-08-02 (bmad-code-review, claude-fable-5): 3-layer adversarial pass (Blind Hunter / Edge Case Hunter / Acceptance Auditor) on the uncommitted 15-s2 working tree. All locations verified against live code before triage. -->

- [x] [Review][Decision] Dual-write consistency doctrine diverges across seams — RESOLVED 2026-08-02 (user): **signal-always (event doctrine, log ⊇ stores)**. Extra-removal + approve seams aligned to write the signal regardless of the legacy-store outcome; inverse tests flipped; Lumi executor's skip-on-declare-fail kept as a recorded exception (model retries on tool error). [child-preferences.service.ts / extra-removal-signal.service.ts / child-request.service.ts]
- [x] [Review][Patch] Append-only trigger blocks cascaded household/child deletion — account-deletion job deletes the `households` row LAST and re-throws on failure; once a household has ≥1 signal, the `ON DELETE CASCADE` fires `signals_append_only` BEFORE DELETE → the whole deletion aborts → the job retries forever. GDPR erasure permanently broken. Fix: allow deletes when `pg_trigger_depth() > 0` (cascade) while still blocking direct UPDATE/DELETE; add a `BEFORE TRUNCATE` statement guard. Migration not yet pushed (user-side gate), so edit in place. [supabase/migrations/20261035000200_create_signals.sql:92-94; apps/api/src/jobs/account-deletion.job.ts:187-193]
- [x] [Review][Patch] RLS `FOR ALL` policy grants authenticated SDK clients direct INSERT/UPDATE/DELETE — a browser client could insert plaintext/malformed payloads into the append-only log, bypassing SignalsService's Zod validation + DEK encryption entirely (and appended rows can never be corrected). The migration's own comment says RLS exists so SDK keys "cannot read across households" — narrow the policy to `FOR SELECT`, and wrap the subquery as `(SELECT auth.uid())` for initplan caching. [supabase/migrations/20261035000200_create_signals.sql:81-83]
- [x] [Review][Patch] Migration only partially idempotent — enums are DO-guarded and table/indexes use `IF NOT EXISTS`, but `CREATE POLICY` and `CREATE TRIGGER` hard-fail on re-run after a partial apply. Guard both (duplicate_object DO-block or DROP IF EXISTS + CREATE). [supabase/migrations/20261035000200_create_signals.sql:81,92]
- [x] [Review][Patch] AC #9 test gap — every seam's resilience test substitutes "signals service not wired" for "signals write fails"; no seam test exercises a FAILING write through the real `SignalsService` (record() swallowing an insert/DEK/Zod failure). Add one per seam: real SignalsService + failing mock insert → primary write still succeeds. [child-preferences.service.test.ts, child-request.service.test.ts, onboarding.tools.test.ts, lumi.service.test.ts, extra-removal-signal.service.test.ts]
- [x] [Review][Patch] `record()`'s never-throws contract has two unprotected lines — the `kind` extraction executes BEFORE the `try` and the catch dereferences `input.household_id`; a null/undefined `input` from a future JS caller throws a TypeError into seams that deliberately have no try/catch. Move extraction inside the try / null-guard the catch. [apps/api/src/modules/signals/signals.service.ts:41,66]
- [x] [Review][Patch] `enforcement` is a loose `z.string().max(40)` while every sibling field is a closed enum — typo'd values append permanently into the immutable log. `EnforcementLevelSchema` already exists in contracts (enforcement.ts, includes `just_for_context`); reuse it. [packages/contracts/src/signals.ts:62]
- [x] [Review][Patch] Unrecorded contracts deviation — Dev Notes' authoritative `RecordSignalInputSchema` shape includes top-level `kind`; the implementation drops it (carried by the payload discriminant — defensible) but the Dev Record deviation list only discloses the subject_ref-schema removal. Add the deviation line. [packages/contracts/src/signals.ts:102-109; story Dev Record]
- [x] [Review][Defer] Swallowed-failure observability — Zod rejections, DEK failures, and transient insert failures all collapse into one warn log: no counter, no dead-letter, no way to detect log gaps (incl. kind-skewed loss when a household's DEK is unwrappable, and partial per-slot sets from a mid-loop failure) at 15-s3 replay time — deferred, fire-and-forget is the blessed 15-s2 convention; observability lands with the first reader (15-s3)
- [x] [Review][Defer] `extra_removal.componentType` >100 chars: legacy insert lands, signal silently dropped (Zod max(100)) — deferred, service is dormant (no production caller); add the length guard in the 3-DM-C1 re-wiring slice [extra-removal-signal.service.ts:64-93]
- [x] [Review][Defer] `subject_ref` is neither validated nor encrypted — a plaintext side-channel into the uncorrectable log if a future producer puts free text there — deferred, disclosed deviation; per-kind subject_ref schemas arrive with the first reader (15-s3) per the recorded rationale [packages/contracts/src/signals.ts:84-85,105]
- [x] [Review][Defer] Approve-path signal drops request provenance (`subject_ref: null` vs submitRequest's `{request_id, session_id}`) — the projection cannot correlate approval with the original request — deferred, matches the authored per-kind convention (preference_edit → null); revisit when 15-s3 defines reader needs [child-request.service.ts:135-148]
- [x] [Review][Defer] Signals tests never verify insert column names against the migration (hand-rolled mock accepts any shape; `subjectRef` vs `subject_ref` drift would pass) — deferred, integration-level concern; the 15-s3 read path will surface any drift immediately [signals.service.test.ts]
- [x] [Review][Defer] `getOrCreateHouseholdDek` fetched per `record()` call with no caching, across 4 separate `SignalsService` instances (get-or-create race on first use) — deferred, matches heart-notes precedent; revisit if signal volume grows [signals.service.ts:47-50]

## Dev Notes

### DDL (AC #1 — authoritative; deviations must be recorded)

```sql
-- Story 15-s2 (Epic 15, Canonical Data Model v2 §4.9) — the signals log.
-- Append-only: a correction is a NEW signal; the log is the replayable learning
-- record. UPDATE/DELETE are blocked by trigger because the API's service-role
-- client bypasses RLS.
-- NO kitchen_map_version bump trigger: KitchenMapRepository.loadRaw() does not
-- read signals (§7.3 binds triggers to loadRaw sources). 15-s3's
-- child_preferences projection gets its own trigger when it becomes a source.
-- Rollback:
--   DROP TRIGGER IF EXISTS signals_append_only ON signals;
--   DROP FUNCTION IF EXISTS signals_block_mutation();
--   DROP TABLE IF EXISTS signals;
--   DROP TYPE IF EXISTS signal_kind; DROP TYPE IF EXISTS signal_source;

DO $$ BEGIN
  CREATE TYPE signal_kind AS ENUM
    ('lunch_rating', 'lunch_request', 'leftover_log', 'extra_removal', 'preference_edit');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE signal_source AS ENUM ('lunch_link', 'app', 'voice', 'import');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS signals (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  child_id     uuid REFERENCES children(id) ON DELETE CASCADE,  -- NULL = household-level
  kind         signal_kind NOT NULL,
  subject_ref  jsonb,
  payload      jsonb NOT NULL,
  occurred_at  timestamptz NOT NULL,
  source       signal_source NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS signals_household_kind_occurred_idx
  ON signals (household_id, kind, occurred_at DESC);
CREATE INDEX IF NOT EXISTS signals_child_kind_idx
  ON signals (child_id, kind) WHERE child_id IS NOT NULL;

ALTER TABLE signals ENABLE ROW LEVEL SECURITY;
CREATE POLICY signals_household_rw ON signals FOR ALL
  USING (household_id = (SELECT current_household_id FROM users WHERE id = auth.uid()));

CREATE OR REPLACE FUNCTION signals_block_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'signals is append-only (canonical-data-model-v2 §4.9): corrections are new rows';
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER signals_append_only
  BEFORE UPDATE OR DELETE ON signals
  FOR EACH ROW EXECUTE FUNCTION signals_block_mutation();
```

### Payload + subject_ref shapes (AC #2 — authoritative)

Discriminated on `kind` (member schemas `.strict()`); ciphertext fields are `z.string()` documented as AES-256-GCM-at-rest:

| kind | subject_ref | payload |
|---|---|---|
| `lunch_rating` | `{ recipe_id: uuid, slot_kind: string }` | `{ kind, rating: 'loved'\|'ok'\|'not-really', date: YYYY-MM-DD }` |
| `lunch_request` | `{ request_id: uuid, session_id: uuid }` | `{ kind, text: <ciphertext> }` |
| `preference_edit` | `null` | `{ kind, item: <ciphertext>, valence: 'loves'\|'likes'\|'neutral'\|'dislikes'\|'refuses', enforcement: string, scope: 'child'\|'household' }` |
| `extra_removal` | `{ plan_item_id: uuid \| null }` | `{ kind, component_type: string }` |
| `leftover_log` | reserved — schema defined as `z.never()`-guarded placeholder or omitted from the producing union; document | reserved |

`RecordSignalInputSchema` = `{ household_id, child_id: uuid|null, kind, subject_ref, payload, occurred_at: datetime, source }` — the service accepts plaintext free-text fields and encrypts before insert; the ROW schema describes what is at rest.

### The five paths — seams verified 2026-08-02

| Path | Live? | Seam (file:line) | Auth | Source |
|---|---|---|---|---|
| lunch_rating | ✅ | `child-preferences.service.ts:42-114` per-slot expansion (route fan-out from `lunch-link.routes.ts:223-232`) | child-token (public route) | `lunch_link` |
| lunch_request | ✅ | `child-request.service.ts:41-69` (submit, persist at :47) | child-token | `lunch_link` |
| preference_edit | ✅ ×3 | `onboarding.tools.ts:781-788`; `child-request.service.ts:105-116` (approve mirror); `lumi.service.ts:413-461` | parent (agent-tool / route) | `app` |
| extra_removal | ⚠️ DORMANT | `extra-removal-signal.service.ts:55-102` — no production caller since 3-DM-C1 (`plans.service.ts:477-489`) | (was parent) | `app` |
| leftover_log | ❌ does not exist | none — deferred Epic 6 (`plan-adjustment.types.ts:9,20`) | — | — |

### Constraints & conventions (verified against the repo)

- **Fire-and-forget:** every dual-write follows `lunch-link.routes.ts:211-232` / `child-request.service.ts:104-116` — warn-and-continue, never fail the primary. `SignalsService.record()` itself catches everything; seams may `void service.record(...)` or `await` it — either way no throw escapes.
- **Encryption:** `encryptField`/`decryptField` in `apps/api/src/lib/envelope-encryption.ts` (AES-256-GCM; `dek === null` → `NOOP:` dev path); `getOrCreateHouseholdDek` in `apps/api/src/lib/household-key.ts:37-56`; kek from `fastify.env.ENVELOPE_ENCRYPTION_MASTER_KEY` hex → Buffer at plugin scope (`heart-note.routes.ts:50-53`). Encrypt-in-place inside the jsonb field (heart_notes puts ciphertext in the plain column; here the ciphertext string sits in the payload field).
- **Runtime-Zod-at-write is NEW ground** — no existing jsonb insert runtime-parses (brief_state/thread_turns are compile-time-typed only). Spec §7.4(c) mandates it for signals. Say so in a comment at the parse site.
- **Append-only repo shape:** `AuditRepository` (`audit.repository.ts:20`) is the citation — insert + reads only. SignalsRepository is insert-only, full stop (reads come in 15-s3).
- **Migration numbering:** next free is `20261035000200` (15-s1 took `...000000` + `...000100`).
- **No `enum` in TS** (project-context): kinds/sources are `z.enum` + inferred unions.
- **PII in logs:** never log payload content — `{ household_id, kind }` only (`onboarding.tools.ts:790-805` REDACTED precedent).
- **No new audit events** (AC #9 rationale): producing paths already audit; verified `lunch_link.rated` (`lunch-link.routes.ts:203-209`), `household.profile_updated` (`kitchen-profile-edit.routes.ts:99-106`), `plan.extra_bias_applied` (`audit.types.ts:27`).
- **`child_preferences.upsertSignal` is UNTOUCHED** — 15-s2 writes signals *beside* it, never instead of it. The flip is 15-s3.

### Previous story intelligence (15-s1 + its code review, 2026-08-02)

- **Record deviations as you make them** — 15-s1's review flagged two undisclosed DDL/signature deviations; the Dev Record section exists for this.
- **`cardinality()` not `array_length()`** in any array CHECK (`array_length('{}',1)` is NULL → CHECK passes NULL).
- **Worker-body / untestable-seam honesty**: if a branch can't be unit-tested, disclose it — don't check the task box (15-s1 review D-item). All seams in this slice are service-level and testable.
- **Negative controls**: prove one new test fails against un-wired code before trusting green (15-s1 Dev Record pattern).
- **Route-level ownership checks** beat bare FKs (15-s1 review patch) — not applicable here (no REST surface), but the service takes household_id/child_id from already-authenticated seams only.
- Baselines after 15-s1 review commit `8ff06b7`: API **2450/0/39**, E2E **425/13/0**, knip 0, contracts:check 535 exports.

### Project Structure Notes

- New module dir `apps/api/src/modules/signals/` (repository + service + tests) — matches per-resource module layout.
- No `apps/web`, no `packages/design-system`, no prompt/orchestrator changes. No route registration (no REST surface this slice).
- Contracts change is coordinated but consumer-less this slice (schemas + types only; no wire endpoint) — safe by the coordinated-contract-change rule.

### References

- Spec: `_bmad-output/planning-artifacts/canonical-data-model-v2-spec.md` §4.9, §7.1–7.4, §8-2
- Migration template: `supabase/migrations/20261035000000_create_family_calendar.sql`
- Discriminated-union precedent: `packages/contracts/src/thread.ts:73-81`
- Encryption: `apps/api/src/lib/envelope-encryption.ts`, `apps/api/src/lib/household-key.ts`, `apps/api/src/modules/heart-notes/heart-note.repository.ts:56-73`
- Seams: `apps/api/src/modules/child-preferences/child-preferences.service.ts:42-114`, `apps/api/src/modules/child-requests/child-request.service.ts:41-116`, `apps/api/src/agents/tools/onboarding.tools.ts:781-805`, `apps/api/src/modules/lumi/lumi.service.ts:413-461`, `apps/api/src/modules/plans/extra-removal-signal.service.ts:55-102`
- Append-only repo precedent: `apps/api/src/audit/audit.repository.ts:20`
- Existing extra_removal_signals shape: `supabase/migrations/20260810000000_create_extra_removal_signals.sql`

## Dev Agent Record

### Agent Model Used

claude-fable-5 (dev-story, 2026-08-02)

### Debug Log References

**Negative control:** temporarily removed the lunch_request seam wiring in `child-request.service.ts` → exactly the new test `dual-writes a lunch_request signal with the verbatim text` FAILED (13/14); restored → 14/14. The dual-write tests genuinely detect an un-wired seam.

**Zod 4 discovery:** `project-context.md` says "Zod 3.23" but the repo is on **zod 4.3.6**. In Zod 4, one-arg `z.record(z.unknown())` treats the arg as the KEY type and crashes at parse time on any non-null object (`Cannot read properties of undefined (reading '_zod')`). Fixed to `z.record(z.string(), z.unknown())`. Diagnosed via a tsx probe script after two service tests failed only for non-null `subject_ref` inputs. Flag for a project-context.md correction (out of scope here).

### Completion Notes List

**All 10 ACs satisfied.** The append-only signals log exists and every live learning path dual-writes into it.

**Key implementation decisions and deviations:**

0. **AC #2 deviation (recorded post-review): `RecordSignalInputSchema` has no top-level `kind` field.** The Dev Notes shape listed one; the implementation drops it because `kind` is carried by the payload discriminant — a separate field could only agree with or contradict it. Flagged by the 15-s2 code review as undisclosed; disclosed here.
1. **AC #2 deviation (recorded): no exported per-kind subject_ref schemas.** The three `*SubjectRefSchema` exports I initially added were producer-unused (seams construct literals; `contracts:check` correctly failed them as dead exports). Removed; the shapes are documented in a comment in `signals.ts` and per-kind subject_ref validation arrives with the first READER (15-s3 projection). The AC's named schema set (kind/source/payloads/row/input) is complete.
2. **Optional-injection pattern at every seam.** `signalsService` is an optional constructor/deps member everywhere (`Pick<SignalsService, 'record'>` for narrow test doubles), so legacy constructions and test deps compile untouched. Wired for real in: `lunch-link.routes.ts` (shared instance for rating + submit), `child-request.routes.ts` (approve mirror), `onboarding.routes.ts` → `OnboardingService` → `OnboardingTurnRunner` → tool deps, `lumi.routes.ts`.
3. **Seam placement matches the story exactly:** lunch_rating per-slot beside `upsertSignal` (projection parity for 15-s3); lunch_request after `create()` (signal even when the thread injection fails); preference_edit at all 3 declare call sites, INSIDE the approve try-block so the signal only records a mirror that actually landed; extra_removal only after the legacy insert succeeds (stores stay in step for the parity check). **[SUPERSEDED by the 15-s2 code review — signal-always doctrine, user-resolved 2026-08-02]:** the log records the EVENT, not the store update (log ⊇ stores). The approve-mirror `record()` moved OUT of the declare try; extra_removal now records BEFORE (and regardless of) the legacy insert. Deliberate exception: the Lumi shared-tastes executor still skips the signal when `declare` fails, because the failure is returned to the model as a tool error and the model retries — recording the failed attempt would double the event on retry. 15-s3's parity check must assume log ⊇ stores.
4. **Encryption:** `SignalsService` encrypts `lunch_request.text` + `preference_edit.item` via `getOrCreateHouseholdDek` + `encryptField` before insert; tests assert ciphertext-at-rest (decrypts back, ≠ plaintext) and that log lines never carry payload content.
5. **record() never throws** — Zod failure, DEK failure, and insert failure all resolve void with a `{ household_id, kind }` warn. Every seam test set includes the fire-and-forget guarantee.
6. **leftover_log producing-union exclusion works as designed:** the discriminated payload union omits it, so a `leftover_log` write is REJECTED at the boundary until Epic 6 defines the shape (tested).
7. **No kitchen-map bump trigger** — decision + rationale recorded in the migration header (signals is not a `loadRaw()` source; the 15-s1 precedent shipped triggers because calendar tables were scheduled sources).
8. **DB append-only guard**: `BEFORE UPDATE OR DELETE` trigger raising an exception — first of its kind in this repo (no REVOKE/trigger precedent existed), justified because the service-role client bypasses RLS.

**Verification (all green):**

| Gate | Result |
|---|---|
| API full suite | **2472 passed / 0 failed / 39 skipped** (+22 new vs 2450 baseline) |
| Contracts (`signals.test.ts`) | 15/15 |
| SignalsService | 7/7 |
| Seam suites (child-prefs, child-requests, lumi, extra-removal, onboarding.tools) | 290/290 across 14 files |
| `pnpm turbo lint typecheck test` | 20/20 tasks successful |
| `knip` | exit 0 |
| `contracts:check` | PASSED, 553 exports |
| `leftover_log` references outside contracts+migration | none (1 test asserting rejection) |
| `apps/web` diff | empty |
| Full E2E (`VITE_E2E=true`) | 425 passed / 13 skipped / 0 failed (= baseline) |

**USER-SIDE GATE:** `supabase db push --include-all` must be run to apply migration `20261035000200` (plus 15-s1's `20261035000000`/`20261035000100` if not yet pushed). Until then every `SignalsService.record()` warn-logs an insert failure and all primary paths behave exactly as before — the designed failure mode.

### File List

**Created**
- `supabase/migrations/20261035000200_create_signals.sql`
- `packages/contracts/src/signals.ts`
- `packages/contracts/src/signals.test.ts`
- `apps/api/src/modules/signals/signals.repository.ts`
- `apps/api/src/modules/signals/signals.service.ts`
- `apps/api/src/modules/signals/signals.service.test.ts`

**Modified**
- `packages/contracts/src/index.ts` — barrel export
- `packages/types/src/index.ts` — schema imports + type aliases
- `apps/api/src/modules/child-preferences/child-preferences.service.ts` — lunch_rating per-slot dual-write
- `apps/api/src/modules/child-preferences/child-preferences.service.test.ts` — 4 new tests
- `apps/api/src/modules/child-requests/child-request.service.ts` — lunch_request submit + preference_edit approve dual-writes
- `apps/api/src/modules/child-requests/child-request.service.test.ts` — 4 new tests
- `apps/api/src/modules/child-requests/child-request.routes.ts` — SignalsService wiring
- `apps/api/src/modules/lunch-link/lunch-link.routes.ts` — SignalsService wiring (rating + submit seams)
- `apps/api/src/agents/tools/onboarding.tools.ts` — preference_edit dual-write in food_preference.declare
- `apps/api/src/agents/tools/onboarding.tools.test.ts` — 3 new tests
- `apps/api/src/modules/onboarding/onboarding.service.ts` — optional signalsService dep threading
- `apps/api/src/modules/onboarding/onboarding-turn-runner.ts` — dep threading into tool specs
- `apps/api/src/modules/onboarding/onboarding.routes.ts` — SignalsService wiring
- `apps/api/src/modules/lumi/lumi.service.ts` — preference_edit dual-write in shared-tastes executor
- `apps/api/src/modules/lumi/lumi.service.test.ts` — 2 new tests
- `apps/api/src/modules/lumi/lumi.routes.ts` — SignalsService wiring
- `apps/api/src/modules/plans/extra-removal-signal.service.ts` — extra_removal dual-write (dormant seam, disclosed)
- `apps/api/src/modules/plans/extra-removal-signal.service.test.ts` — 2 new tests
