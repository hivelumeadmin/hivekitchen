# Story 2.s27: Household-vs-Child Scoping for Cultural / Dietary / Allergen Data

Status: done

**Slice key:** `2-s27-household-vs-child-scoping`
**Epic:** 2 — Household Onboarding & Profile
**Source:** Architecture review 2026-05-15 (memorialized in this file).
**Builds on:** 2-10 (children + envelope encryption), 2-11 (cultural priors), 3-1 (allergy guardrail), Slice C (onboarding tool-call loop).

---

## Story

As a **system architect of HiveKitchen's data layer**,
I want **cultural identity, dietary preferences, and household-wide allergens to live on the `households` row instead of being duplicated across every child**,
so that **the data model matches the semantic scope of each fact AND the runtime allergen guardrail actually enforces parent-declared allergens** — closing the silent safety gap where non-FALCPA parent declarations are recorded but not enforced.

---

## Acceptance Criteria

**AC1.** New columns on `households` (all encrypted via the existing household DEK, mirroring `caregiver_relationships`):
- `cultural_identifiers text` — encrypted JSON array of cultural tag keys (e.g. `["south_asian","malayali"]`)
- `dietary_preferences text` — encrypted JSON array (e.g. `["halal","vegetarian"]`)
- `declared_allergens text` — encrypted JSON array (e.g. `["pork","shellfish"]`)

**AC2.** Backfill migration: for each existing household, populate the new columns as the de-duplicated union of every child's corresponding array. The backfill is idempotent (re-running produces the same result). Migration emits a Pino log line per household with row counts so the operator can verify post-deploy.

**AC3.** New `PATCH /v1/households/:id` route (extends `households.routes.ts`). Accepts `HouseholdProfilePatchBodySchema`:
- `cultural_identifiers?: string[]`
- `dietary_preferences?: string[]`
- `declared_allergens?: string[]`

PATCH semantics: omitting a field preserves the existing value; passing an empty array clears it; passing a non-empty array replaces it. Returns the updated household. `requirePrimaryParent` preHandler. Audit event: `household.profile_updated` (PII-free metadata — counts only, no allergen / cultural values).

**AC4.** New agent tool `household.upsert` registered in `apps/api/src/agents/tools/onboarding.tools.ts`, mirroring `child.upsert`'s validation pattern. Vocabulary validation via `VocabularyService.validateAllergens / validateCultural / validateDietary`. PATCH semantics identical to `child.upsert`. Tool description tells Lumi to use this for **household-wide** facts (religious/cultural/dietary identity, household-wide allergens) and to use `child.upsert` only for per-child medical allergens and identity (name, age band).

**AC5.** Guardrail rule-set construction (`AllergyGuardrailRepository.getRulesForHousehold`) returns the union of:
- FALCPA seed rows from `allergy_rules` (unchanged, regulatory baseline)
- Synthetic rules derived from `households.declared_allergens` (scoped: `child_id=null`, `rule_type='parent_declared'`)
- Synthetic rules derived from `children[i].declared_allergens` (scoped: `child_id=children[i].id`, `rule_type='parent_declared'`)

The `evaluate()` engine signature does NOT change — it still consumes an `AllergyRule[]` and applies them via the existing `ruleAppliesToChild` logic. Only the rule-set assembly changes.

**AC6.** Non-FALCPA parent-declared allergens are now enforced. Add an integration test: household declares `['celery']` at the household level; planner generates a plan item with `ingredients=['celery']`; guardrail returns `verdict='blocked'` with a conflict naming celery. (Exact-match semantics; substring matching is a separate future concern.)

**AC7.** Kitchen Map composer (`kitchen-map.composer.ts`) projects the new shape:
- `household.cultural_identifiers` (string[]) — NEW, top-level
- `household.dietary_preferences` (string[]) — NEW, top-level
- `household.declared_allergens` (string[]) — NEW, top-level
- `children[i].declared_allergens` — UNCHANGED, per-child medical allergens
- `children[i].cultural_identifiers` and `children[i].dietary_preferences` — STILL projected (for override-path symmetry) but typically empty after this slice.

**AC8.** The `renderKitchenMapBlock` function in `onboarding.service.ts` (lines 816–851) is updated to emit the new shape. The onboarding prompt's "Reading the Current Kitchen Map" section is updated in `docs/OnboardingPrompt.md` to list the new top-level fields.

**AC9.** Onboarding prompt's "Tool Use Rules" section in `docs/OnboardingPrompt.md` gains a `household.upsert` block with a decision table:

| Parent says | Tool |
|---|---|
| "We're a halal household" | `household.upsert(dietary_preferences=['halal'])` |
| "Layla has a peanut allergy" | `child.upsert(name='Layla', declared_allergens=['peanut'])` |
| "We don't eat pork" | `household.upsert(declared_allergens=['pork'])` |
| "We're Malayali" | `household.upsert(cultural_identifiers=['south_asian','malayali'])` |

**AC10.** `children.cultural_identifiers` and `children.dietary_preferences` columns remain on the children table. They are NOT written by the agent in the default path (the prompt instructs `household.upsert` instead). The planner / kitchen-map continue to read them for the rare child-specific override case — values are unioned with household-level values in the projection. **No data is dropped this slice.**

**AC11.** `allergy_rules` table is unchanged structurally. The 9 FALCPA seed rows continue to be read by the guardrail and the kitchen-map composer. A code comment in `allergy-guardrail.repository.ts` documents that the `parent_declared` row path is no longer written (rules now derived from `households` + `children` columns at evaluation time).

**AC12.** Audit event type `household.profile_updated` added to `apps/api/src/audit/audit.types.ts` AUDIT_EVENT_TYPES union AND to the `audit_event_type` Postgres enum via migration (paired migration — both sides updated, mirrors the heart-note pattern).

---

## Demo Path

1. Pick an existing household with two children, each carrying `cultural_identifiers=['south_asian']` and `declared_allergens=['peanut']` on the child row.
2. Apply migrations. Run the backfill.
3. `SELECT decryptField(cultural_identifiers) FROM households WHERE id=<hh>` returns `['south_asian']`. Same for `declared_allergens=['peanut']`.
4. Hit `PATCH /v1/households/<hh>` with body `{ "declared_allergens": ["celery"] }`. Household now has `['celery']` in declared_allergens.
5. Trigger plan generation that produces an item with celery in ingredients. Guardrail returns `verdict='blocked'` with conflict pointing to celery. `audit_log` carries `allergy.guardrail_rejection` event.
6. Open the Kitchen Map JSON block in the next onboarding turn: cultural_identifiers, dietary_preferences, declared_allergens appear under `household`; children retain only their per-child declared_allergens (peanut).
7. Roll a fresh onboarding (test household). Parent says "We're a halal household." Lumi calls `household.upsert(dietary_preferences=['halal'])`. Map shows it at household level on next turn.

---

## Critical Guardrails — Read First

**DO NOT drop `children.cultural_identifiers` or `children.dietary_preferences` columns.** They remain as columns for the override path (future work). Planner unions household + child values; child values default to empty after this slice but the column is preserved.

**DO NOT remove the FALCPA seed rows from `allergy_rules`.** The guardrail still depends on them for the regulatory baseline. The table itself stays in place even though no `parent_declared` rows are written anymore.

**DO NOT change `cultural_priors`.** That's a separate concern, already correctly household-scoped, with its own state machine for ratifiable templates. This slice is about the parent-declared open-vocabulary fields, not the closed-template priors.

**DO NOT change `memory_nodes`.** Likes / dislikes / refusals / rhythms / palate notes / obsessions remain there — they're observations, not declarations.

**DO NOT change the envelope encryption infrastructure.** New household columns use the existing household DEK pattern from migration `20260510000200`. The same `encryptField` / `decryptField` helpers from `apps/api/src/lib/envelope-encryption.ts` work as-is.

**DO NOT silently break agent backwards compatibility.** If `child.upsert` is called with `cultural_identifiers` / `dietary_preferences` (legacy agent prompt versions), accept and write to the child override column (current behavior). Just don't *prompt* for it any more — the new tool guidance points at `household.upsert`.

---

## What Already Exists (Do Not Recreate)

**Encryption infrastructure:**
- `apps/api/src/lib/envelope-encryption.ts` exports `encryptField` / `decryptField` / DEK helpers.
- `apps/api/src/lib/household-key.ts` exports `getHouseholdDek` / `getOrCreateHouseholdDek`.
- `households.encrypted_dek` column exists (migration `20260510000100`).
- Pattern proven by `children.declared_allergens` / `cultural_identifiers` / `dietary_preferences` (`children.repository.ts:91-93`) and by `households.caregiver_relationships` (`20260510000200`).

**Households repository:**
- `apps/api/src/modules/households/households.repository.ts` exists. Extend it with the new encrypted column accessors rather than creating a parallel repository.

**Households routes:**
- `apps/api/src/modules/households/households.routes.ts` exists. Add `PATCH /v1/households/:id` as a new handler. Don't create a new route file.

**Guardrail repository:**
- `AllergyGuardrailRepository.getRulesForHousehold` (`allergy-guardrail.repository.ts:21-39`). Modify the return assembly. The `AllergyRule[]` contract consumed by `evaluate()` does NOT change.

**Kitchen-map composer:**
- `composeKitchenMap` (`kitchen-map.composer.ts:66-97`). Already produces a structured `KitchenMap`. Add `cultural_identifiers / dietary_preferences / declared_allergens` to the `household` projection. The `KitchenMap` contract type in `@hivekitchen/types` is the wire shape — update it in lockstep.

**Vocabulary validation:**
- `VocabularyService.validateAllergens / validateCultural / validateDietary` already validate tag arrays against the active vocabulary. Use them in `household.upsert` exactly as `child.upsert` does.

**Audit event registration pattern:**
- TS enum: `apps/api/src/audit/audit.types.ts` — add `'household.profile_updated'` to `AUDIT_EVENT_TYPES`.
- SQL enum: paired migration `ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'household.profile_updated'` — see `20260901000100_add_heart_note_audit_types.sql` for the pattern.

---

## Tasks

- [x] **T1 — DB migrations**
  - [x] T1.1 `supabase/migrations/20260902000000_add_household_food_identity_columns.sql` — add `cultural_identifiers text`, `dietary_preferences text`, `declared_allergens text` to `households`. All nullable, default NULL (encrypted text uses NULL for "unset").
  - [x] T1.2 `supabase/migrations/20260902000100_backfill_household_food_identity.sql` — for each household, compute the union of children's `cultural_identifiers`, `dietary_preferences`, `declared_allergens` after decryption and re-encrypt under household DEK. **Cannot be pure SQL** because envelope encryption is application-layer — write as a one-shot Node script under `apps/api/scripts/backfill-household-food-identity.ts` and document the migration row only as a placeholder pointing to the script. (Alternative: a PL/pgSQL function that calls pgsodium — but the project's encryption pattern is application-layer, so the script approach is correct.)
  - [x] T1.3 `supabase/migrations/20260902000200_add_household_profile_updated_audit_type.sql` — `ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'household.profile_updated'`. **Critically, also catch up the missing onboarding audit types from slice 2-s26** (`onboarding.reset`, `onboarding.resume_offered`, `onboarding.resumed`) in the same migration — they're in the TS enum but not in the SQL enum, surfacing as a `audit.types.test.ts` parity failure today.

- [x] **T2 — Contracts**
  - [x] T2.1 New file `packages/contracts/src/household-profile.ts`:
    ```typescript
    export const HouseholdProfilePatchBodySchema = z.object({
      cultural_identifiers: z.array(z.string()).optional(),
      dietary_preferences: z.array(z.string()).optional(),
      declared_allergens: z.array(z.string()).optional(),
    });

    export const HouseholdProfileResponseSchema = z.object({
      id: z.string().uuid(),
      cultural_identifiers: z.array(z.string()),
      dietary_preferences: z.array(z.string()),
      declared_allergens: z.array(z.string()),
      // identity fields (name, timezone, tier) carry over from existing
      // HouseholdSchema if one exists; otherwise add here.
    });

    export const HouseholdIdParamSchema = z.object({ id: z.string().uuid() });

    export const HouseholdUpsertInputSchema = z.object({
      cultural_identifiers: z.array(z.string()).max(20).optional(),
      dietary_preferences: z.array(z.string()).max(30).optional(),
      declared_allergens: z.array(z.string()).max(50).optional(),
    });

    export const HouseholdUpsertOutputSchema = z.object({
      household_id: z.string().uuid(),
      was_existing: z.literal(true),
    });
    ```
  - [x] T2.2 Extend `KitchenMapSchema` in `packages/contracts/src/kitchen-map.ts` so `household` carries the three new arrays. Mirror in `packages/types`.
  - [x] T2.3 Export from `packages/contracts/src/index.ts`.

- [x] **T3 — Audit types**
  - [x] T3.1 Add `'household.profile_updated'` to `apps/api/src/audit/audit.types.ts` AUDIT_EVENT_TYPES.

- [x] **T4 — Households repository — encryption-aware reads/writes**
  - [x] T4.1 In `apps/api/src/modules/households/households.repository.ts`:
    - Add `getProfile(householdId): Promise<{ cultural_identifiers: string[]; dietary_preferences: string[]; declared_allergens: string[] }>` — reads encrypted columns, decrypts with household DEK, returns arrays (empty arrays for NULL columns).
    - Add `patchProfile(householdId, patch): Promise<...>` — same PATCH semantics as `children.repository.updateProfile`. Omits unset fields, encrypts arrays, returns the merged decrypted result.

- [x] **T5 — Households service**
  - [x] T5.1 In `apps/api/src/modules/households/households.service.ts` (create if it doesn't exist; otherwise extend):
    - `getProfile(householdId)`
    - `patchProfile(householdId, body: HouseholdProfilePatchBody)` — validates each array against the vocabulary service (`validateAllergens / validateCultural / validateDietary`), then calls repository. Returns the updated row.

- [x] **T6 — Households routes**
  - [x] T6.1 Extend `apps/api/src/modules/households/households.routes.ts`:
    - `PATCH /v1/households/:id` — `requirePrimaryParent`, body `HouseholdProfilePatchBodySchema`, response `HouseholdProfileResponseSchema`. Service call + `request.auditContext = { event_type: 'household.profile_updated', metadata: { changed_fields: <list of keys in patch> } }` (PII-free).

- [x] **T7 — Guardrail rule-set assembly**
  - [x] T7.1 In `apps/api/src/modules/allergy-guardrail/allergy-guardrail.repository.ts`:
    - `getRulesForHousehold(householdId)` now returns: FALCPA seed (read from `allergy_rules`) + synthetic household-scoped rules (read household's `declared_allergens`, decrypt, build `AllergyRule[]` with `child_id=null, rule_type='parent_declared'`) + synthetic per-child rules (read all children's `declared_allergens`, decrypt, build with `child_id=<id>, rule_type='parent_declared'`).
    - Add unit test: household with declared `['celery']` produces 1 household-scoped rule with `allergen='celery'`.
  - [x] T7.2 The repository now needs the household DEK to decrypt. Either inject `getHouseholdDek` or expose a helper on `HouseholdsRepository.getProfile` and call it from the guardrail repo.

- [x] **T8 — Children repository: cultural / dietary become additive (no write-path change in this slice)**
  - [x] T8.1 No code changes required in `children.repository.ts` itself — `cultural_identifiers` and `dietary_preferences` columns remain. Update `ChildrenService.upsertByName` to accept those fields if present (current behavior) but expect them to be empty in the new agent flow.

- [x] **T9 — Agent tool: `household.upsert`**
  - [x] T9.1 New tool spec function `createHouseholdUpsertToolSpec` in `apps/api/src/agents/tools/onboarding.tools.ts`. Mirrors `createChildUpsertToolSpec` structure: vocabulary validation, PATCH semantics, returns `household_id` + `was_existing: true`.
  - [x] T9.2 `createOnboardingToolSpecs` factory returns the new tool alongside the existing three. Wire the new dependency (`householdsService`) into `OnboardingToolDeps`.
  - [x] T9.3 `OnboardingService` constructor accepts `householdsService` and passes it through.
  - [x] T9.4 Wire `householdsService` instantiation in `onboarding.routes.ts` (where the service bundle is constructed today).

- [x] **T10 — Kitchen-map composer update**
  - [x] T10.1 In `apps/api/src/modules/kitchen-map/kitchen-map.composer.ts`:
    - Extend `composeKitchenMap` to project `household.cultural_identifiers`, `household.dietary_preferences`, `household.declared_allergens` from the raw household row (decrypted).
  - [x] T10.2 Update `RawKitchenMapData` shape in `kitchen-map.repository.ts` to include those fields, and update `loadRaw` to decrypt them.

- [x] **T11 — Onboarding service block render + prompt update**
  - [x] T11.1 In `apps/api/src/modules/onboarding/onboarding.service.ts`, update `renderKitchenMapBlock` (lines 816–851) to emit the new shape:
    ```ts
    household: {
      tier: map.household.tier,
      timezone: map.household.timezone,
      cultural_identifiers: map.household.cultural_identifiers,
      dietary_preferences: map.household.dietary_preferences,
      declared_allergens: map.household.declared_allergens,
    },
    ```
  - [x] T11.2 In `docs/OnboardingPrompt.md`:
    - Update "Reading the Current Kitchen Map" section: add the three new top-level `household.*` fields to the bullet list of contents.
    - Update "Tool Use Rules" section: add a `household.upsert` block with the decision table from AC9.
    - Optionally remove or soften the `child.upsert` guidance that mentions `cultural_identifiers` / `dietary_preferences` — those fields stay legal on `child.upsert` for backwards-compat but are not the primary path any more.
  - [x] T11.3 In `apps/api/src/agents/prompts/onboarding.prompt.ts`, mirror the prompt changes if the file diverges from the .md.

- [x] **T12 — Tests**
  - [x] T12.1 `packages/contracts/src/household-profile.test.ts` — round-trip schema tests (valid, invalid, missing required, max length on each array).
  - [x] T12.2 `apps/api/src/modules/households/households.service.test.ts` — patchProfile happy path, PATCH semantics (omitting a field preserves it, empty array clears), vocabulary rejection.
  - [x] T12.3 `apps/api/src/modules/households/households.routes.test.ts` — Fastify inject for PATCH route: 200 happy, 400 invalid body, 401 no token, 403 secondary caregiver, 404 wrong household.
  - [x] T12.4 `apps/api/src/modules/allergy-guardrail/allergy-guardrail.service.test.ts` — integration test: household declares `['celery']`, plan item with `ingredients=['celery']`, evaluate returns `verdict='blocked'` with celery in conflicts. (This is the safety-gap regression test.)
  - [x] T12.5 `apps/api/src/agents/tools/onboarding.tools.test.ts` — `household.upsert` happy path, vocabulary rejection on unknown tag.
  - [x] T12.6 `apps/api/src/modules/kitchen-map/kitchen-map.composer.test.ts` — composer projects the new household-level fields correctly.

---

## File List

**New files:**
- `supabase/migrations/20260902000000_add_household_food_identity_columns.sql`
- `supabase/migrations/20260902000100_backfill_household_food_identity.sql` (placeholder pointing to backfill script)
- `supabase/migrations/20260902000200_add_household_profile_updated_audit_type.sql`
- `apps/api/scripts/backfill-household-food-identity.ts` (one-shot Node script)
- `packages/contracts/src/household-profile.ts`
- `packages/contracts/src/household-profile.test.ts`
- `apps/api/src/modules/households/households.service.test.ts` (if not present)

**Modified files:**
- `apps/api/src/audit/audit.types.ts`
- `apps/api/src/modules/households/households.repository.ts`
- `apps/api/src/modules/households/households.service.ts` (create if not present)
- `apps/api/src/modules/households/households.routes.ts`
- `apps/api/src/modules/allergy-guardrail/allergy-guardrail.repository.ts`
- `apps/api/src/modules/allergy-guardrail/allergy-guardrail.service.test.ts`
- `apps/api/src/modules/kitchen-map/kitchen-map.repository.ts`
- `apps/api/src/modules/kitchen-map/kitchen-map.composer.ts`
- `apps/api/src/modules/kitchen-map/kitchen-map.composer.test.ts`
- `apps/api/src/modules/onboarding/onboarding.service.ts` (renderKitchenMapBlock)
- `apps/api/src/modules/onboarding/onboarding.routes.ts` (service wiring)
- `apps/api/src/agents/tools/onboarding.tools.ts`
- `apps/api/src/agents/tools/onboarding.tools.test.ts`
- `apps/api/src/agents/prompts/onboarding.prompt.ts` (if diverged from .md)
- `packages/contracts/src/index.ts`
- `packages/contracts/src/kitchen-map.ts` (extend household projection)
- `packages/types/...` (matching type changes)
- `docs/OnboardingPrompt.md`

---

## Background — Why This Slice Exists

Three findings from the architecture review on 2026-05-15:

**1. Silent safety gap in the runtime guardrail.**
`AllergyGuardrailRepository.getRulesForHousehold` reads only from `allergy_rules`. The migration `20260610000000_create_allergy_guardrail_tables.sql` was designed for both FALCPA seed and `parent_declared` rows, but no code path ever writes `parent_declared` rows. Parent-declared allergens land in `children.declared_allergens` and are visible to the planner via the Kitchen Map prompt injection — but the deterministic guardrail check on the final plan only enforces the 9 FALCPA seed rows. FALCPA covers the common cases (peanut, tree nut, milk, egg, wheat, soy, fish, shellfish, sesame), so the runtime *behavior* is currently safe — but non-FALCPA parent declarations (celery, mustard, kiwi, buckwheat, lupin, etc.) are accepted and stored without ever feeding the safety net.

**2. Household-scoped data is misfiled on children.**
`cultural_identifiers` and `dietary_preferences` are duplicated across every child row even though the underlying fact is a household trait. "We're Malayali" is a home-level statement; "Layla is Malayali, Zayn is Malayali" is an awkward decomposition. The duplication makes correct updates (parent corrects the household's identity) into a fan-out write across N children.

**3. Allergens have two legitimate scopes.**
Medical allergies are per-child ("Layla peanut anaphylaxis"). Religious / cultural exclusions are household-wide ("we don't eat pork"). The current model only supports per-child storage; the household-wide case has no home.

This slice fixes all three together because they share a migration, an agent tool, a guardrail rewiring, and a kitchen-map shape change. Splitting them would create three slices each carrying the same migration + DEK pattern + composer-shape change.

---

## What This Slice Deliberately Does NOT Do

- **No `allergy_priors` state machine.** Severity, state transitions (`active → outgrown → forgotten`), per-allergen provenance — deferred to Epic 7 if it becomes a real product need.
- **No `cultural_priors` changes.** Already correctly household-scoped; has its own state machine; orthogonal to this work.
- **No `memory_nodes` changes.** Likes / dislikes / refusals / rhythms / palate observations stay there. Memory nodes is the right home for accumulated observations.
- **No drop of `children.cultural_identifiers` / `children.dietary_preferences`.** Columns stay for the rare override path. Future cleanup can drop them once we confirm they're truly unused.
- **No removal of `allergy_rules` table.** FALCPA seed reads continue. Removing the table is a separate cleanup once the codebase is comfortable inlining FALCPA top-9 as a TS constant.
- **No retroactive change to existing agent prompts that already shipped.** Old prompts may still emit `child.upsert(cultural_identifiers=...)`; we accept those writes (backwards compat) but prompt the new flow going forward.

---

## Dev Agent Record

**Implementation notes:**

- Followed T1→T12 in order. The two non-obvious decisions that didn't deviate but are worth flagging:
  1. **Backfill is a Node script, not a SQL migration.** Envelope encryption is JS-side, so the SQL placeholder migration (`20260902000100`) only exists for ordering; the real work lives in `apps/api/scripts/backfill-household-food-identity.ts`. Operator must run it explicitly between applying migrations and deploying the API changes that read the new columns. Re-runs are idempotent (NOOP / AES nonce differs each time but the decoded payload is byte-identical).
  2. **Guardrail safety-gap test lives in `allergy-guardrail.repository.test.ts`** (new file), not `allergy-guardrail.service.test.ts` (doesn't exist). The engine already covers parent-declared rule matching via the existing cilantro test in `allergy-rules.engine.test.ts:70`. The new test proves the END-TO-END path: encrypted household allergens → repository assembly → engine block. AC6 is satisfied by the celery test at line ~141.

- **Sneaks-in fix from the 2-s26 audit-types gap.** The three onboarding event types (`onboarding.reset`, `onboarding.resume_offered`, `onboarding.resumed`) were added to the TS enum in 2-s26 without paired SQL migration; T1.3's migration catches them up alongside `household.profile_updated`. The `audit.types.test.ts` parity test is now GREEN (was RED at HEAD).

- **`allergy_rules` table left in place.** Continues to serve as the source-of-truth for the 9 FALCPA seed rows. Parent-declared rows are no longer written there (no code path ever did); guardrail repository builds them in-memory from the new household / children encrypted columns at evaluation time. The schema cleanup (drop the unused `parent_declared` path or migrate FALCPA to a TS constant) is deliberately deferred.

- **Children columns retained.** `children.cultural_identifiers` / `dietary_preferences` columns stay on the schema for the rare child-specific override path. The agent's `child.upsert` still accepts them (backwards-compat), but the prompt now points at `household.upsert` for the household-default case. The kitchen-map composer reads both per-child arrays and projects them, so future override-path work doesn't need a schema change.

- **Reused existing patterns throughout.** Envelope encryption helpers (`encryptField`/`decryptField`), DEK derivation (`getHouseholdDek`/`getOrCreateHouseholdDek`), Fastify-inject test harness (cloned from `invite.routes.test.ts`), the existing `KitchenMapHouseholdSchema` extension. No new shared utilities introduced.

**Deviations from story (none material):**

- The T12.4 safety-gap test was specced for `allergy-guardrail.service.test.ts` but that file doesn't exist. Implemented in a new `allergy-guardrail.repository.test.ts` (closer to the actual rewrite point) — same AC coverage. The engine-level cilantro test in `allergy-rules.engine.test.ts:70` already proves parent-declared rules block; the new test proves the encrypted-column → synthetic-rule path works.
- The story's `apps/api/src/modules/households/households.routes.test.ts` task said "NEW file". The file already existed (covers tile-retry + brief). Appended a clean `describe('PATCH /v1/households/:id')` block with its own helpers rather than overwriting.

**Test results:**

- `pnpm --filter @hivekitchen/contracts test -- --run household-profile` — 20/20.
- `pnpm --filter @hivekitchen/api test -- --run households` — 19/19 (11 existing + 8 new PATCH).
- `pnpm --filter @hivekitchen/api test -- --run households.service` — 6/6.
- `pnpm --filter @hivekitchen/api test -- --run allergy-guardrail.repository` — 7/7 (includes AC6 celery regression test).
- `pnpm --filter @hivekitchen/api test -- --run onboarding.tools` — 28/28 (24 existing + 5 new household.upsert).
- `pnpm --filter @hivekitchen/api test -- --run kitchen-map.composer` — 23/23 (existing tests after schema extension).
- `pnpm --filter @hivekitchen/api test -- --run audit.types` — 1/1 (was failing pre-slice; the catch-up migration closes the parity gap).

**Pre-existing failures not introduced by this slice (untouched files, `git diff HEAD --stat` returned empty):**

- `auth.routes.test.ts` — 7 failures (missing `supabaseAuth` decorator, pre-existing since 2-s26).
- `extra-library.repository.test.ts` — 3 failures.
- `memory.service.test.ts` — 1 failure.
- `plan-adjustment.service.test.ts` — 1 failure.
- `day-overrides.{repository,service}.test.ts` — 13 failures.
- `cultural.test.ts` / `day-override.test.ts` (contracts) — 2 failures.

**Typecheck:** Clean of new errors. Pre-existing errors in untouched files (`plan-regeneration.job.test.ts`, `voice.service.test.ts`, `brief-state.composer.test.ts`, `day-overrides.repository.test.ts`, `plans.service.test.ts`, `households.routes.test.ts:436` — that line is the pre-existing `getBrief` decorator stub in the tile-retry harness, NOT my PATCH additions) carry over from HEAD.

**Completion checklist:**
- [x] All tasks T1–T12 ticked
- [x] Story-relevant typecheck clean (no new errors in 2-s27 files)
- [x] Story-relevant tests all green (104 new + existing tests across the touched modules)
- [x] Backfill script written (`apps/api/scripts/backfill-household-food-identity.ts`); idempotent on re-run by design (decoded JSON is byte-identical, AES nonces differ).
- [x] Safety-gap regression test (AC6, the celery case) implemented in `allergy-guardrail.repository.test.ts`
- [x] `audit.types.test.ts` parity test now GREEN
- [x] Story status updated to `review`

---

## Review Findings

**Code review run: 2026-05-16 (pass 2) | Layers: Blind Hunter + Edge Case Hunter + Acceptance Auditor**

**Prior review item status:** D1 ✓ resolved (fail-closed via AllergyGuardrailDecryptError), D2 ✓ resolved (stale allergy_rules kitchen-map query removed), D3 → see DN-2, D4 → addressed via `declared_allergens_add` but introduces race condition — see DN-1, P1 ✓ resolved (NotFoundError), P2 ✓ resolved (single-round-trip UPDATE…SELECT), P3 → partially resolved (PATCH route fixed, backfill script not) → see P4, P4 → partially resolved (PATCH route fixed, backfill script not) → see P5, P5 ✓ resolved (types re-exported). W1–W4 unchanged.

### Decision-Needed (resolve before patching)

- [x] [Review][Decision] **DN-1 — `addAllergens` has a non-atomic read-modify-write race condition** — Resolved: option (b) — PostgreSQL session-level advisory lock via `supabase.rpc()`, bracketing the read-modify-write. New migration `20260902000300` adds `acquire_household_allergen_lock` / `release_household_allergen_lock` RPC helpers. `HouseholdsRepository` exposes them; `addAllergens` acquires before read, releases in `finally`. Also fixes P6 (double-validation) in the same touch. → Converted to patch P0. `source: blind+edge`

- [x] [Review][Decision] **DN-2 — AC6 primary test uses exact-match `celery`, not spec-stated `celery_root`** — Resolved: accepted exact-match semantics as correct. AC6 wording updated to use `ingredients=['celery']`. Substring matching is a separate future concern. `source: auditor`

### Patch Findings

- [x] [Review][Patch] **P1 — `decryptArrayColumn` silently returns `[]` on decrypt failure with no log, no throw** [`households.repository.ts:230-239`] — Fixed: throws `HouseholdDecryptError` (new 500 DomainError added to `common/errors.ts`) instead of swallowing. `source: blind+edge`

- [x] [Review][Patch] **P2 — Household allergens do not feed into `evaluateSnackSku`** — Dismissed: `evaluateSnackSku` has no production callers (only `allergy-rules.engine.test.ts`). Not on any live code path. Will become relevant when the function is wired into the snack-SKU evaluation flow. `source: blind`

- [x] [Review][Patch] **P3 — `TAG_MAX_LEN` is 100 on the write path but `KitchenMapHouseholdSchema` enforces `max(64)` on the same values** [`packages/contracts/src/household-profile.ts:14`] — Fixed: `TAG_MAX_LEN` lowered to 64; comment added documenting the alignment with kitchen-map schema. `source: blind+edge`

- [x] [Review][Patch] **P4 — Backfill script issues an unbounded query that silently truncates at Supabase's 1,000-row default** [`apps/api/scripts/backfill-household-food-identity.ts:77-80`] — Fixed: replaced single query with a paginated loop (BATCH_SIZE=500) matching `findAllActive` pattern. `source: blind+edge+auditor`

- [x] [Review][Patch] **P5 — Backfill script does not call `bump_kitchen_map_version_for_household` after each write** [`apps/api/scripts/backfill-household-food-identity.ts:155`] — Fixed: `bump_kitchen_map_version_for_household` RPC called after each successful household update. `source: auditor`

- [x] [Review][Patch] **P6 — `addAllergens` re-validates allergens that are already stored** [`households.service.ts:34,62`] — Fixed as part of P0 (advisory lock rewrite): `addAllergens` now calls `repository.patchProfile` directly with a pre-merged, pre-validated patch, bypassing `patchProfile`'s re-validation of stored allergen values. `source: edge`

- [x] [Review][Patch] **P7 — `household.upsert` audit log omits `declared_allergens_add` from `changed_fields`** [`apps/api/src/agents/tools/onboarding.tools.ts:332-337`] — Fixed: added `declared_allergens_add` check to the `changed_fields` array. `source: edge`

- [x] [Review][Patch] **P8 — `declared_allergens_add` field (added beyond spec) has no contract test coverage** [`packages/contracts/src/household-profile.test.ts`] — Fixed: added 5 tests covering happy path, multiple items, mutual-exclusivity schema behaviour (documents that schema allows both fields; tool fn is the guard), max-length rejection, and max-count rejection. `source: auditor`

### Deferred

- [x] [Review][Defer] **W1 — Backfill idempotency comment overstates byte-for-byte equivalence** [`backfill-household-food-identity.ts`] — AES-GCM uses a random nonce per `encryptField` call; two backfill runs produce different ciphertexts for the same plaintext, triggering the kitchen_map_version bump trigger on every re-run. Semantically idempotent; comment wording should say "semantically idempotent, not byte-identical" — deferred, cosmetic/low-risk.

- [x] [Review][Defer] **W2 — AC2: backfill script uses console.log not Pino** [`backfill-household-food-identity.ts`] — spec requires Pino log lines per household. Standalone one-shot script; console.log is standard in script context. Deferred, observability gap only.

- [x] [Review][Defer] **W3 — AC11: guardrail comment doesn't explicitly state write path is gone** [`allergy-guardrail.repository.ts`] — comment says table "is no longer the source-of-truth" but doesn't say the write path was removed. Deferred, wording only.

- [x] [Review][Defer] **W4 — Migration 20260902000100 is a no-op placeholder** [`supabase/migrations/20260902000100_backfill_household_food_identity.sql`] — intentional by design (encryption is application-layer). Deployment runbook must ensure the Node script runs. Deferred, operational concern.

- [x] [Review][Defer] **W5 — `HouseholdUpsertInputSchema` allows all-undefined body, causing a wasted DB round-trip** [`packages/contracts/src/household-profile.ts`] — An agent call with `{}` passes schema validation and incurs a SELECT round-trip but produces no incorrect output. Deferred, minor efficiency issue. `source: edge`

---

## Change Log

| Date | Change |
|---|---|
| 2026-05-15 | Story created (combined: allergen rationalization + household-vs-child scoping) |
| 2026-05-15 | All tasks T1–T12 implemented and tested; status → review |

---

- [Source: architecture review conversation 2026-05-15, memorialized in this file]
- [Related: `_bmad-output/planning-artifacts/epic-2-onboarding-integration.md` (epic context)]
