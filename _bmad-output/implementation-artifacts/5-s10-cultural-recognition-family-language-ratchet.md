# 5-S10 — Cultural Recognition: Family-Language Ratchet

> **Folds:** story 5.14 (the family-language half), PRD UX-DR43, UX-DR44, UX-DR47
> **Status:** done
> **Epic:** 5 — Household Coordination & Ambient Intelligence

---

## Story

**As a** Primary Parent of a culturally-identified household, when I naturally use a
family-language kinship term (e.g. "Nani") in conversation with Lumi, **I want** Lumi to
notice, ask once whether to keep using my word, and — once I say yes — use it forever and
never retreat to the generic English term, **so that** my family's language is preserved as
I introduce it, in language not ornament.

---

## Acceptance Criteria

| # | Criterion |
|---|-----------|
| AC1 | When a parent's ambient Lumi turn contains a recognized family-language kinship term, the household's `preferred_family_language_terms` record for that term increments its `usage_count`. First sighting creates the record at `state: 'candidate'`-pending (`usage_count: 1`, not yet prompted). |
| AC2 | When a term's `usage_count` reaches the ratification threshold (2) AND the term is not already `active`/`forgotten`/already-prompted, Lumi originates a `family_language_prompt` turn in the ambient thread: *"I noticed you call them Nani — want me to keep using that?"* with the term sacred-plum tinted. |
| AC3 | The `family_language_prompt` turn is returned on the same `POST /v1/lumi/turns` response (`ratification_turn` field) so the web client appends it immediately — no SSE round-trip needed for the demo. It is also persisted to the thread so it survives re-hydration. |
| AC4 | `POST /v1/households/:id/family-language/ratify` with `{ term, action: 'opt_in' }` transitions the term to `state: 'active'` and stamps `ratified_at`. Idempotent when already `active`. |
| AC5 | **Forward-only ratchet (UX-DR47):** once a term is `active`, no action can demote it. `forget` on an `active` term is a no-op; `forget` on a `candidate` term sets `state: 'forgotten'` (won't re-prompt). |
| AC6 | `{ action: 'tell_lumi_more' }` makes no state change and returns a warm static follow-up inviting the parent to clarify; the term stays `candidate`. |
| AC7 | Once a term is `active`, Lumi's reply prompt context (household snapshot) instructs the agent to use the family-language word and never substitute the generic English equivalent. Verified at the snapshot-builder layer, not via LLM output assertion. |
| AC8 | Ratify on a real transition (`opt_in` / `forget`) sets `request.auditContext` to a `template.state_changed` event; metadata is PII-safe (`maps_to`, `from_state`, `to_state` — the family-language word itself is NOT written to audit). |
| AC9 | `family_language_prompt` joins the `TurnBody` discriminated union and round-trips through the contract. `LumiThreadTurnsResponseSchema` (hydration) and `LumiTurnResponseSchema.ratification_turn?` both accept it. |
| AC10 | `<LumiPanel>` renders `family_language_prompt` turns as a `<FamilyLanguageRatificationCard>` with three pills ([Yes, keep it in mind] / [Not quite — tell Lumi more] / [Not for us]) and a sacred-plum tinted term word. On opt_in/forget the card resolves and disappears. |
| AC11 | Cross-household and role guards: ratify is `primary_parent`-only (mirrors cultural-prior ratify); cross-household → 403. |

---

## Scope Reconciliation (READ FIRST)

Epic 5.14 bundles **two** capabilities under one story:
1. **L2 meal-pattern recognition** ("Keeping Jollof Friday") — a *plan-surface* recognition line.
2. **L3 family-language recognition + ratchet** ("Nani") — an *ambient-conversation* affordance.

The slice-doc demo path for 5-S10 is the **family-language ratchet** ("use 'Nani' twice →
ratification turn → tap Yes → locks forward"). This story ships **#2 end-to-end** and
**defers #1**, consistent with how this epic's prior slices reconciled spec↔codebase
(5-S6 deferred Deliverable D; 5-S9 stored reasoning in `brief_state.payload` rather than
reading `audit_log`).

### What already exists (do NOT rebuild)
Story 2.11 already shipped a full **cultural-template** ratification system, distinct from
family-language terms:
- `cultural_priors` table + `detected→suggested→opt_in_confirmed→active→dormant→forgotten`
  state machine (`apps/api/src/modules/cultural-priors/`).
- `RatifyAction` (`opt_in`/`forget`/`tell_lumi_more`), `PATCH /v1/households/:id/cultural-priors/:priorId`.
- `TurnBodyRatificationPrompt` (`type: 'ratification_prompt'`, keyed to `CulturalKey` enum +
  prior UUID) and the onboarding-surface `<CulturalRatificationCard>`.

**Family-language terms are a different domain** (free-text kinship words like Nani/Dadi/Lola,
not the 6-value `CulturalKey` enum), so they get their own thin module rather than overloading
`cultural_priors`. Reuse the *patterns* (three-pill card, audit-on-transition, forward-only
guard), not the *tables*.

### Reconciliation decisions
| Spec says | This slice does | Why |
|---|---|---|
| `users.preferred_family_language_terms JSONB` | `households.preferred_family_language_terms JSONB` | UX-DR47 is explicit: ratchet is **"household-scoped on first-person surfaces."** The detection path (`LumiService.submitTextTurn`) is keyed by `householdId` and has **no `userId`** — per-user storage would need a wide signature change for behavior that should be household-wide anyway (both parents' Lumi must say "Nani", never one saying "Grandma"). |
| Family-language inferred (implied LLM) | Deterministic curated **kinship-term dictionary** match | Detection must run **inline** in `submitTextTurn` so the ratification turn can be returned on the same response (AC3) — an extra OpenAI call per turn would add latency to every ambient reply. A dictionary of unambiguous non-English kinship terms is fast, deterministic, and unit-testable. LLM-based open-vocabulary detection is a clean future enhancement. |
| "ratification turn auto-emitted on `suggested` reach" (template state machine) | Family-language `usage_count` threshold (2) → `candidate` → emit turn | The cultural-template `suggested` flow is already covered by 2.11's onboarding inference. The ambient family-language flow has its own lightweight counter; no `cultural_priors` row is touched. |

### Deferred (not in this slice)
- **L2 meal-pattern recognition** ("Keeping Jollof Friday") — plan-surface concern; separate slice.
- **`cultural_priors` ambient re-detection / `suggested→active` from chat** — 2.11 onboarding
  template ratification covers template opt-in already.
- **LLM open-vocabulary kinship detection** beyond the curated dictionary.
- **Voice-path surfacing of the ratification turn** — `processVoiceUtterance` returns over WS
  frames, not the `LumiTurnResponse` shape. Detection still *runs* on voice turns (it's inside
  `submitTextTurn`) and persists the turn; it surfaces on next text hydration. Live voice
  surfacing is a follow-up.

---

## Data Model

### Migration — `supabase/migrations/20261020000000_add_household_family_language_terms.sql`

```sql
-- Slice 5-S10 — household-scoped family-language ratchet (UX-DR47, forward-only).
-- One JSONB array per household; each element is a recognized kinship term and
-- its ratchet state. Forward-only is enforced at the service layer (an 'active'
-- term is never demoted), mirroring the cultural_language enum's service-layer
-- ratchet (migration 20260503100000).
--
-- Element shape (validated by FamilyLanguageTermSchema in @hivekitchen/contracts):
--   { "term": "Nani", "maps_to": "grandmother", "usage_count": 2,
--     "state": "candidate" | "active" | "forgotten",
--     "first_seen_at": "<iso>", "ratified_at": "<iso>" | null }
--
-- Rollback: ALTER TABLE households DROP COLUMN IF EXISTS preferred_family_language_terms;

ALTER TABLE households
  ADD COLUMN preferred_family_language_terms jsonb NOT NULL DEFAULT '[]'::jsonb;
```

> **Timestamp note (avoid the 5-S5 trap):** migrations sort lexically. The latest applied is
> `20261018000000` (voice_transcripts). Use `20261020000000` so this sorts **last**. Do NOT
> reuse a `20260907`-style stamp (it would sort *before* shipped migrations).

> No new RLS policy: adding a column to `households` inherits the existing table policies.
> No new index: reads are always by `household_id` (PK) on a single row.

---

## Contracts

### New file — `packages/contracts/src/family-language.ts`

```ts
import { z } from 'zod';

// Slice 5-S10 — household-scoped family-language ratchet (UX-DR47). A term is a
// non-English kinship word the parent used in conversation; maps_to is its English
// equivalent. State is forward-only at the service layer once 'active'.
export const FamilyLanguageStateSchema = z.enum(['candidate', 'active', 'forgotten']);

export const FamilyLanguageTermSchema = z.object({
  term: z.string().min(1).max(40),
  maps_to: z.string().min(1).max(40),
  usage_count: z.number().int().min(0),
  state: FamilyLanguageStateSchema,
  first_seen_at: z.string(),
  ratified_at: z.string().nullable(),
});

export const FamilyLanguageRatifyActionSchema = z.enum([
  'opt_in',
  'forget',
  'tell_lumi_more',
]);

export const FamilyLanguageRatifyBodySchema = z.object({
  term: z.string().min(1).max(40),
  action: FamilyLanguageRatifyActionSchema,
});

export const FamilyLanguageRatifyResponseSchema = z.object({
  term: FamilyLanguageTermSchema,
  lumi_response: z.string().optional(),
});
```

> **Export:** add `export * from './family-language.js';` to `packages/contracts/src/index.ts`
> (mirror the line for `./cultural.js`). Add the inferred types to `packages/types/src/index.ts`
> (mirror how `CulturalPrior`, `RatifyAction` are re-exported there — they are `z.infer<>` of the
> contract schemas). Required types: `FamilyLanguageTerm`, `FamilyLanguageState`,
> `FamilyLanguageRatifyAction`, `FamilyLanguageRatifyBody`, `FamilyLanguageRatifyResponse`.

### Edit — `packages/contracts/src/thread.ts`

Add a new turn body and include it in the union:

```ts
// Slice 5-S10 — Lumi originates this turn when a family-language kinship term
// crosses the ratification threshold. The web renders it as a
// FamilyLanguageRatificationCard (three pills, sacred-plum tinted term).
export const TurnBodyFamilyLanguagePrompt = z.object({
  type: z.literal('family_language_prompt'),
  term: z.string().min(1).max(40),
  maps_to: z.string().min(1).max(40),
});

export const TurnBody = z.discriminatedUnion('type', [
  TurnBodyMessage,
  TurnBodyPlanDiff,
  TurnBodyProposal,
  TurnBodySystemEvent,
  TurnBodyPresence,
  TurnBodyRatificationPrompt,
  TurnBodyFamilyLanguagePrompt, // ← new
]);
```

### Edit — `packages/contracts/src/lumi.ts`

Add the optional ratification turn to the POST response (additive, existing callers unaffected):

```ts
export const LumiTurnResponseSchema = z.object({
  thread_id: z.string().uuid(),
  user_turn: Turn,
  lumi_turn: Turn,
  // Slice 5-S10 — present only when this turn triggered a family-language
  // ratification. The client appends it immediately (no SSE round-trip).
  ratification_turn: Turn.optional(),
});
```

---

## API

### New module — `apps/api/src/modules/family-language/`

#### `family-language.detector.ts` (pure, no I/O — easy to unit-test)

```ts
// Slice 5-S10 — deterministic curated kinship-term dictionary. Unambiguous
// non-English family-language words ONLY (no "Nana"/"Papa"/"Baba" — those collide
// with English or with given names). Extend the dictionary as new terms surface;
// open-vocabulary LLM detection is a deferred enhancement.
//
// Keep keys lowercase; matching is case-insensitive on word boundaries.
const KINSHIP_TERMS: Record<string, string> = {
  nani: 'grandmother',
  dadi: 'grandmother',
  dada: 'grandfather',
  lola: 'grandmother',
  lolo: 'grandfather',
  bibi: 'grandmother',
  abuela: 'grandmother',
  abuelo: 'grandfather',
  halmoni: 'grandmother',
  yaya: 'grandmother',
  teta: 'grandmother',
  jiddo: 'grandfather',
};

export interface DetectedTerm {
  term: string; // canonical display form, title-cased (e.g. "Nani")
  maps_to: string; // e.g. "grandmother"
  occurrences: number; // count in this single message
}

export function detectFamilyLanguageTerms(message: string): DetectedTerm[] {
  const counts = new Map<string, number>();
  for (const raw of message.toLowerCase().match(/[\p{L}]+/gu) ?? []) {
    if (KINSHIP_TERMS[raw] !== undefined) counts.set(raw, (counts.get(raw) ?? 0) + 1);
  }
  return [...counts.entries()].map(([key, occurrences]) => ({
    term: key.charAt(0).toUpperCase() + key.slice(1),
    maps_to: KINSHIP_TERMS[key]!,
    occurrences,
  }));
}

export const FAMILY_LANGUAGE_RATIFY_THRESHOLD = 2;
```

> Use a Unicode-aware tokenizer (`\p{L}+` with the `u` flag) so non-Latin scripts tokenize
> correctly. Word-boundary matching prevents "Nanika" from matching "Nani".

#### `family-language.repository.ts`

`households` is a single-row read/write per household. Mutate the JSONB array atomically:
read row → mutate in memory → write back. (Onboarding/ambient volume is low; this is the same
read-modify-write the existing cultural code uses for per-row updates.)

Methods:
- `getTerms(householdId): Promise<FamilyLanguageTerm[]>` — `select preferred_family_language_terms`, default `[]`.
- `recordUsage(householdId, detected: DetectedTerm[], threshold): Promise<{ newlyCandidate: FamilyLanguageTerm[] }>`
  - For each detected term: find existing entry by `term`.
    - none → push `{ term, maps_to, usage_count: occurrences, state: 'candidate-pending', first_seen_at: now, ratified_at: null }`.
      - **Naming nit:** there is no `'candidate-pending'` enum value. Model "seen but not yet
        prompted" as `state: 'candidate'` with a separate `prompted: boolean` flag **OR** keep
        `state: 'candidate'` and gate the prompt purely on `usage_count >= threshold && ratified_at === null && !alreadyPrompted`. **Decision:** add a boolean `prompted` field to the
        stored element (NOT in the public contract — it's an internal persistence detail; the
        contract `FamilyLanguageTermSchema` already `.passthrough()`? No — Zod objects strip
        unknowns by default but parsing happens on read; store `prompted` and **omit it when
        projecting to the contract shape**). Simpler alternative below.
    - existing `active` or `forgotten` → only bump `usage_count` (never re-prompt, never demote).
    - existing `candidate` not yet prompted → bump `usage_count`; if it now `>= threshold`, mark prompted and add to `newlyCandidate`.
  - Persist the mutated array; return the terms that crossed the threshold *this call*.
- `ratify(householdId, term, action): Promise<{ updated: FamilyLanguageTerm | null; from: FamilyLanguageState | null }>`
  - `opt_in`: `candidate`→`active` (+`ratified_at`); idempotent if already `active` (return unchanged, `from: null` = no audit). Forbidden to act on `forgotten` (return current).
  - `forget`: `candidate`→`forgotten`; **no-op if `active`** (ratchet locked — return current, `from: null`).
  - `tell_lumi_more`: no state change (`from: null`).

> **Simplify the `prompted` concern:** the cleanest model is to NOT store a separate `prompted`
> flag. Instead emit the prompt the moment `usage_count` *crosses* the threshold (i.e. the bump
> takes it from `< threshold` to `>= threshold`). Because each `recordUsage` call only bumps once
> per message, the crossing happens on exactly one call, so the prompt fires exactly once without
> a flag. Adopt this — it keeps the stored element identical to the public contract shape. (Edge
> case: a single message with the term twice can jump 0→2; treat `prev < threshold && next >= threshold`
> as the crossing. Still fires once.)

#### `family-language.service.ts`

Thin service over the repository (mirror `CulturalPriorService` shape). Two responsibilities:
1. `ratify(input)` — call repo, build the `RatifyResult`-style return with optional `audit` (set
   only when `from !== null`), and for `tell_lumi_more` attach a static `lumi_response`:
   `"Tell me — what should I call them, and I'll use your word."` (No LLM call; keep it minimal.)
2. (Detection is invoked from `LumiService`, not here — see below — so the service does not own
   the conversation loop.)

#### `family-language.routes.ts`

Mirror `cultural-prior.routes.ts` exactly:
- `POST /v1/households/:id/family-language/ratify`
  - `preHandler: authorize(['primary_parent'])`
  - body `FamilyLanguageRatifyBodySchema`, response `FamilyLanguageRatifyResponseSchema`
  - `assertCallerInHousehold(request.user.household_id, householdId)` (403 cross-household)
  - on real transition set `request.auditContext = { event_type: 'template.state_changed', ... metadata: { maps_to, from_state, to_state } }` — **term omitted** (culturally-sensitive, PII rule).
- Register the plugin in the app the same way `culturalPriorRoutes` is registered (find its
  registration in `apps/api/src/app.ts` and add `familyLanguageRoutes` adjacent to it).

> Use `GET` only if needed by tests; the web reads terms via the ratification turn body, so a
> list endpoint is **not required** for this slice. Do not add one speculatively.

### Edit — `apps/api/src/modules/lumi/lumi.service.ts`

1. **Dep (optional, mirrors `memoryService` precedent from 5-S7):**
   ```ts
   familyLanguageRepository?: FamilyLanguageRepository; // 5-S10 — optional so nudge-job ctor is unchanged
   ```
   Store it; detection + snapshot block are skipped when absent.

2. **Detection inside `submitTextTurn`** — after the Lumi turn is persisted, BEFORE returning.
   This must be **inline/awaited** (not fire-and-forget like 5-S7) so the turn can be returned:
   ```ts
   let ratificationTurn: Turn | undefined;
   if (this.familyLanguageRepository) {
     const detected = detectFamilyLanguageTerms(input.message);
     if (detected.length > 0) {
       const { newlyCandidate } = await this.familyLanguageRepository.recordUsage(
         input.householdId, detected, FAMILY_LANGUAGE_RATIFY_THRESHOLD,
       );
       const first = newlyCandidate[0]; // one prompt at a time — keep it calm (UX)
       if (first) {
         ratificationTurn = await this.repository.insertTurn({
           threadId: thread.id,
           role: 'lumi',
           body: { type: 'family_language_prompt', term: first.term, maps_to: first.maps_to },
           modality,
         });
       }
     }
   }
   ```
   Wrap the whole block in try/catch and log-and-continue — a detection failure must never
   break the user's turn (it's an enhancement, not the reply).
   Return `{ thread_id, user_turn, lumi_turn, ...(ratificationTurn ? { ratification_turn: ratificationTurn } : {}) }`.

   > **Return-type note:** widen `submitTextTurn`'s return type to include the optional
   > `ratification_turn?: Turn`. `processVoiceUtterance` ignores it (voice surfacing deferred).

3. **Ratchet application in `fetchHouseholdSnapshot`** — when `familyLanguageRepository` is
   present, read `active` terms and append a block so the agent honors the ratchet:
   ```ts
   const activeTerms = (await this.familyLanguageRepository.getTerms(householdId))
     .filter((t) => t.state === 'active');
   if (activeTerms.length > 0) {
     lines.push(
       'Family language (use these exact words, never the generic English term):',
       ...activeTerms.map((t) => `- call the ${t.maps_to} "${t.term}"`),
     );
   }
   ```

### Edit — `apps/api/src/modules/lumi/lumi.routes.ts`

- Construct `new FamilyLanguageRepository(fastify.supabase)` and pass it into the `LumiService`
  deps (same place `memoryService`, `voiceTranscriptRepository` are wired).
- In the `POST /v1/lumi/turns` handler, pass `result.ratification_turn` through to the response
  (only when present). The route already returns `{ thread_id, user_turn, lumi_turn }`.

### Edit — `apps/api/src/jobs/lumi-nudge.job.ts`

Pass `familyLanguageRepository` into the `LumiService` deps here **too**, so proactive nudges
honor the ratchet (a nudge must not say "Grandma" after the household ratified "Nani"). This is
the one place 5-S7 chose to skip (memoryService) — but the ratchet is an *invariant* ("never
retreats"), so wire it. Detection won't fire in the nudge path (nudges don't call
`submitTextTurn`), but `fetchHouseholdSnapshot` runs and will inject active terms.

---

## Web

### New hook — `apps/web/src/hooks/useRatifyFamilyLanguage.ts`

Mirror `useRatifyCulturalPrior.ts` (same file's shape: a `mutate(householdId, term, action)`
returning a tagged `{ status: 'ok' | 'forbidden' | 'not_found' | 'error', ... }` outcome,
parsing the response with `FamilyLanguageRatifyResponseSchema` via `hkFetch`). Endpoint:
`POST /v1/households/${householdId}/family-language/ratify`, body `{ term, action }`.

### New component — `apps/web/src/components/FamilyLanguageRatificationCard.tsx`

Colocate next to `LumiPanel.tsx` (the ambient surface). Model it on `<CulturalRatificationCard>`
but term-based and using v2.0 sacred-plum tokens:

- Props: `{ term: string; maps_to: string; householdId: string; onResolved: () => void }`.
- Heading (Instrument Serif per UX-DR50): *"I noticed you call them <span sacred-plum>{term}</span> — want me to keep using that?"*
  - Sacred-plum tint on the term word: `text-sacred-700` (token family `sacred` → `--sacred-plum-*`,
    see `docs/DESIGN.md` §color table; `--sacred-plum-500` = `#8A5F72`). Use `font-serif` for the term.
- Three pills (UX-DR44, exact copy):
  - `Yes, keep it in mind` → `opt_in` → on ok, `onResolved()`.
  - `Not quite — tell Lumi more` → `tell_lumi_more` → render the returned `lumi_response` inline
    (`role="status"`), keep card visible.
  - `Not for us` → `forget` → on ok, `onResolved()`.
- `forbidden`/`not_found` outcomes also call `onResolved()` (card no longer applies — don't strand the user).
- `motion-reduce:transition-none`, `disabled` while pending, `role="alert"` for errors. No flag
  emojis, no "Celebrating" copy (UX-DR45).

### Edit — `apps/web/src/components/LumiPanel.tsx`

1. **Append the ratification turn from the POST response** in `handleSubmit`, after appending
   `user_turn` and `lumi_turn`:
   ```ts
   if (data.ratification_turn) useLumiStore.getState().appendTurn(data.ratification_turn);
   ```
   (`LumiTurnResponseSchema` now parses the optional field.)

2. **Render `family_language_prompt` turns.** The visible-turns filter currently keeps only
   `message`. Widen it to also keep `family_language_prompt`, and branch in the row renderer:
   ```ts
   const visibleTurns = turns
     .filter((t) => t.body.type === 'message' || t.body.type === 'family_language_prompt')
     .slice(-MAX_VISIBLE_TURNS);
   ```
   In `TurnRow`, when `turn.body.type === 'family_language_prompt'`, render
   `<FamilyLanguageRatificationCard ... onResolved={() => /* remove this turn from the store */} />`.
   - To remove a resolved card: add a tiny store action `removeTurn(turnId)` (filter `turns`),
     or filter it locally in the panel. Prefer a `removeTurn` store action for testability
     (mirror `appendTurn`). Pass `householdId` from the auth store (same source `usePresence`
     uses — see `apps/web/src/hooks/usePresence.ts` for the auth-store `household_id` accessor).

> The store (`lumi.store.ts`) already keeps ALL turns (only the panel filters at render), so no
> store change is needed for persistence — only the optional `removeTurn` action.

---

## Tests

### Contracts — `packages/contracts/src/family-language.test.ts` (new)
- `FamilyLanguageTermSchema` accepts a valid term; rejects empty `term`; `ratified_at: null` ok.
- `FamilyLanguageRatifyBodySchema` accepts each action; rejects unknown action.
- `FamilyLanguageRatifyResponseSchema` round-trips with/without `lumi_response`.

### Contracts — extend `packages/contracts/src/cultural.test.ts` (or a new `thread.test.ts`)
- `TurnBodyFamilyLanguagePrompt` parses; participates in the `TurnBody` discriminated union
  (mirror the existing `TurnBodyRatificationPrompt` union test at `cultural.test.ts:201`).
- `LumiTurnResponseSchema` parses with and without `ratification_turn`.

### API — `apps/api/src/modules/family-language/family-language.detector.test.ts` (new)
- Detects "Nani" (case-insensitive); counts two occurrences in one message as 2.
- Does NOT match "Nanika" (word boundary) or generic English ("grandma", "nana").
- Returns `maps_to` and title-cased `term`.

### API — `apps/api/src/modules/family-language/family-language.repository.test.ts` (new)
- `recordUsage` first sighting creates `candidate` (`usage_count` = occurrences), no crossing → no `newlyCandidate` when below threshold.
- Bump that crosses threshold returns the term in `newlyCandidate` exactly once; a subsequent bump does NOT re-return it.
- `recordUsage` on an `active` term bumps count but never re-prompts/demotes.
- `ratify opt_in` candidate→active (+`ratified_at`); idempotent on active (`from: null`).
- `ratify forget` candidate→forgotten; **no-op on active** (forward-only — assert state stays `active`).

### API — `apps/api/src/modules/family-language/family-language.routes.test.ts` (new)
- `opt_in` 200 + audit context set (`template.state_changed`, metadata has `maps_to`/states, NOT `term`).
- cross-household 403; non-primary role 403; unknown term → returns current/forgotten gracefully (no 500).

### API — extend `apps/api/src/modules/lumi/lumi.service.test.ts`
- `submitTextTurn` with a message containing the term twice → persists a `family_language_prompt`
  turn and returns it as `ratification_turn` (mock repo `recordUsage` → `newlyCandidate`).
- Detection failure (repo throws) → turn still returns normally, no throw (best-effort).
- `fetchHouseholdSnapshot` includes the "Family language" block for `active` terms (assert the
  agent receives it — inspect the `LumiAgent.respond` call's `householdSnapshot` arg, as existing
  snapshot tests do).
- `familyLanguageRepository` absent (nudge-job ctor path) → no detection, no throw.

### Web — `apps/web/src/components/FamilyLanguageRatificationCard.test.tsx` (new)
- Renders the term in the heading with sacred-plum class; three pills with exact copy present.
- `Yes` click → calls hook with `opt_in` → `onResolved` fired on ok.
- `tell_lumi_more` → renders returned `lumi_response`, card stays.

### Web — extend `apps/web/src/components/LumiPanel.test.tsx`
- A `family_language_prompt` turn in the store renders the card (not a plain message row).
- POST response with `ratification_turn` appends it (mock `hkFetch`).

---

## Dev Notes

### Why inline detection (not 5-S7's fire-and-forget)
5-S7 enrichment is `void this.runPassiveEnrichment(...)` because its output (memory nodes) is
not needed in the response. Here the ratification turn **is** part of the response (AC3), and the
detector is a synchronous dictionary scan + one small DB read-modify-write — cheap enough to
await. This is exactly why the LLM approach was rejected (see Scope Reconciliation).

### Forward-only is the headline invariant (UX-DR47)
Once `state: 'active'`, **nothing** demotes the term. Enforce in the repository, not the route:
`forget` checks current state and no-ops on `active`; `opt_in` is idempotent on `active`. The
snapshot block then guarantees Lumi keeps using the word. There is no "un-ratify" path — by
design.

### Audit PII rule
The family-language word is culturally sensitive (project-context "PII … must never appear in
… Pino logs … OpenAI prompts outside scoped agent context … audit"). Put `maps_to` + state codes
in audit metadata; never the term itself. (The term legitimately appears in the thread turn body
and the agent prompt — those are in-scope household surfaces.)

### `template.state_changed` is already a valid audit event_type
`cultural-prior.routes.ts` already sets `request.auditContext.event_type = 'template.state_changed'`.
Reuse it — **no `audit.types.ts` change, no migration for audit types** (unlike 5-S8, which had
to add enum values).

### `households` JSONB read-modify-write
There is no atomic JSONB-array element upsert via supabase-js; do read → mutate → write on the
single household row. Concurrency risk (two parents bumping simultaneously) is acceptable at beta
volume — a lost increment at most delays a prompt by one turn; it never corrupts the ratchet
(`active` is monotonic). Do not add row locking for this slice.

### `removeTurn` store action
Adding `removeTurn(turnId)` to `lumi.store.ts` keeps the resolved-card removal testable and
mirrors `appendTurn`. Keep it a pure `turns.filter(t => t.id !== turnId)`.

### Relationship to `users.cultural_language` (don't couple)
`users.cultural_language` (enum, Story 2.5) records the family-language *family* chosen at
onboarding and is its own forward-only ratchet. It is **orthogonal** to per-term ratcheting —
do not gate the dictionary on it or read it here. Noted only so you don't think you're
duplicating it.

### `hkFetch` does not double-encode
`hkFetch` JSON-stringifies the body; pass `{ term, action }` as an object, not a pre-stringified
string (same note as 5-S9).

---

## Source File Map

| File | Change |
|------|--------|
| `supabase/migrations/20261020000000_add_household_family_language_terms.sql` | NEW — `households.preferred_family_language_terms jsonb` |
| `packages/contracts/src/family-language.ts` | NEW — term + ratify schemas |
| `packages/contracts/src/family-language.test.ts` | NEW — schema tests |
| `packages/contracts/src/thread.ts` | Add `TurnBodyFamilyLanguagePrompt` to `TurnBody` union |
| `packages/contracts/src/lumi.ts` | Add optional `ratification_turn` to `LumiTurnResponseSchema` |
| `packages/contracts/src/cultural.test.ts` (or new thread.test.ts) | Union + LumiTurnResponse parse tests |
| `packages/contracts/src/index.ts` | `export * from './family-language.js'` |
| `packages/types/src/index.ts` | Re-export inferred family-language types |
| `apps/api/src/modules/family-language/family-language.detector.ts` | NEW — pure dictionary matcher |
| `apps/api/src/modules/family-language/family-language.repository.ts` | NEW — JSONB read/mutate/write |
| `apps/api/src/modules/family-language/family-language.service.ts` | NEW — ratify + tell_lumi_more |
| `apps/api/src/modules/family-language/family-language.routes.ts` | NEW — `POST .../family-language/ratify` |
| `apps/api/src/modules/family-language/*.test.ts` | NEW — detector / repository / routes tests |
| `apps/api/src/modules/lumi/lumi.service.ts` | Optional dep; inline detection in `submitTextTurn`; snapshot ratchet block; widen return type |
| `apps/api/src/modules/lumi/lumi.routes.ts` | Wire `FamilyLanguageRepository`; pass `ratification_turn` through |
| `apps/api/src/modules/lumi/lumi.service.test.ts` | Detection + snapshot + best-effort tests |
| `apps/api/src/jobs/lumi-nudge.job.ts` | Pass `familyLanguageRepository` so nudges honor the ratchet |
| `apps/api/src/app.ts` | Register `familyLanguageRoutes` adjacent to `culturalPriorRoutes` |
| `apps/web/src/hooks/useRatifyFamilyLanguage.ts` | NEW — mirror `useRatifyCulturalPrior` |
| `apps/web/src/components/FamilyLanguageRatificationCard.tsx` | NEW — three pills + sacred-plum term |
| `apps/web/src/components/FamilyLanguageRatificationCard.test.tsx` | NEW |
| `apps/web/src/components/LumiPanel.tsx` | Render `family_language_prompt`; append `ratification_turn` |
| `apps/web/src/components/LumiPanel.test.tsx` | Card render + append tests |
| `apps/web/src/stores/lumi.store.ts` | Add `removeTurn(turnId)` action |

**Files NOT touched:**
- `apps/api/src/modules/cultural-priors/*` — family-language is a separate domain; do not overload `cultural_priors`.
- `apps/api/src/audit/audit.types.ts` — `template.state_changed` already valid; no new event type.
- Any planner / plan-surface files — L2 meal-pattern recognition is deferred.

---

## Test Baselines (inherited from 5-S8 done state; 5-S9 is ready-for-dev, not yet impl)

| Suite | Passing | Failing | Skipped |
|-------|---------|---------|---------|
| API (`pnpm --filter @hivekitchen/api test`) | 1727 | 20 | 13 |
| Web (`pnpm --filter @hivekitchen/web test`) | 537 | 2 | — |
| Contracts (`pnpm --filter @hivekitchen/contracts test`) | 708 | 7 | — |

**Typecheck baselines:** `apps/api` 12 · `apps/web` 7 · `packages/contracts`+`types` 1.

> Passing increases. Failing/skipped must NOT regress (the 20 API + 2 web + 7 contracts failures
> are pre-existing baselines — verify via `git stash` if any new failure appears). Typecheck error
> counts must NOT increase. If 5-S9 has been merged before this starts, re-baseline from its done
> state first.

---

## Done Definition

- [ ] `pnpm --filter @hivekitchen/contracts test` passes with family-language + TurnBody + LumiTurnResponse tests
- [ ] `pnpm --filter @hivekitchen/api test` passes with detector / repository / routes / lumi.service tests
- [ ] `pnpm --filter @hivekitchen/web test` passes with card + LumiPanel tests
- [ ] `pnpm typecheck` counts do not increase from baseline
- [ ] Manual smoke: say "Nani" twice to ambient Lumi → ratification card appears in the panel with sacred-plum term
- [ ] Manual smoke: tap **Yes** → card resolves; subsequent Lumi replies use "Nani" (check `households.preferred_family_language_terms` shows `state: 'active'`)
- [ ] Manual smoke: tap **Not for us** on a candidate → `state: 'forgotten'`, no re-prompt
- [ ] Manual smoke: confirm an `active` term cannot be demoted (forget is a no-op)
- [x] USER-SIDE GATE: `supabase db push --include-all` (migration `20261020000000`) — **applied 2026-06-08**

---

## Open Questions (non-blocking — defaults chosen; flag if you disagree)

1. **Storage location** — slice/5.14 spec literally says `users.preferred_family_language_terms`;
   this story stores on `households` (UX-DR47 household-scoping + detection path has no `userId`).
   If per-user ratcheting is genuinely required, `submitTextTurn` needs a `userId` threaded
   through and the migration moves to `users`. **Default: households.**
2. **Detection mechanism** — curated dictionary vs LLM open-vocabulary. Dictionary chosen for
   inline-latency + determinism; it only catches terms in `KINSHIP_TERMS`. **Default: dictionary,
   extensible list.** Approve the starter term set (12 terms) or expand it.
3. **L2 meal-pattern recognition** ("Keeping Jollof Friday") is deferred to a separate slice.
   Confirm it should NOT be in 5-S10.

---

## Dev Agent Record

### Implementation Plan (as executed)
Built bottom-up, verifying each layer before the next:
1. **Migration** → `households.preferred_family_language_terms jsonb` (`20261020000000`, sorts last).
2. **Contracts** → `family-language.ts` (term + ratify schemas), `TurnBodyFamilyLanguagePrompt`
   in the `TurnBody` union, `LumiTurnResponseSchema.ratification_turn?`, exports + inferred types.
   Verified: contracts suite 722p/7f (+14).
3. **API** → `modules/family-language/` (detector, repository, service, routes) + inline detection
   in `LumiService.submitTextTurn` + active-terms block in `fetchHouseholdSnapshot` + optional
   `familyLanguageRepository` dep wired in `lumi.routes` AND `lumi-nudge.job` + route registration.
   Verified: API suite 1758p/20f/13skip (+31).
4. **Web** → `useRatifyFamilyLanguage`, `<FamilyLanguageRatificationCard>`, `LumiPanel` render +
   append, `lumi.store.removeTurn`. Verified: web suite 544p/2f (+7).

### Reconciliation decisions (deviations from the slice spec, with rationale)
1. **Sacred-plum token is `text-sacred-700` (NOT a bespoke hex).** The design-system color scale
   exposes `sacred` 400/500/600/700 (`colorScale('sacred-plum')`), so `text-sacred-700` resolves.
   Pills use `bg-sacred` / `hover:bg-sacred-600` / `border-sacred` — the live tokens used by
   `CulturalProposalTurn`. The story's `--sacred-plum-500 = #8A5F72` reference is consistent; no
   inline hex was needed.
2. **Unknown term → 404 (`NotFoundError`), not a synthesized 200.** The slice said "unknown term →
   returns current/forgotten gracefully (no 500)". The response schema requires a full
   `FamilyLanguageTerm` and a truly-unknown word has no `maps_to` to reconstruct, so synthesizing a
   fake term would pollute the wire. Instead the service throws `NotFoundError` (404), exactly
   mirroring `CulturalPriorService.ratify`. The web hook maps 404 → `not_found` → `onResolved()`, so
   the card resolves and the user is never stranded — which IS "graceful, no 500". In the real flow
   the term always exists (it was created by `recordUsage` when the prompt was emitted), so this is
   a defensive path only.
3. **No `prompted` flag — prompt fires on the threshold crossing.** Adopted the slice's "simplify"
   note: `recordUsage` bumps each term at most once per call, so a term crosses `< threshold →
   >= threshold` on exactly one call. That crossing (incl. a single 0→2 jump) yields the prompt
   exactly once; subsequent bumps (prev already `>= threshold`) never re-prompt. The stored JSONB
   element therefore matches the public `FamilyLanguageTermSchema` shape 1:1 (no internal field to
   strip on projection).
4. **`POST /v1/lumi/turns` handler needs no pass-through code.** `submitTextTurn` now returns
   `ratification_turn?` conditionally and the route already does `reply.code(201).send(result)`;
   the (additive, optional) response-schema field serializes it through automatically.
5. **Audit reuses `template.state_changed`** (already a valid event type) — no `audit.types.ts`
   change, no audit-types migration. Metadata is `maps_to` + state codes only; the family-language
   word is never written to audit (PII rule). Verified by a routes-test assertion that the metadata
   JSON does not contain "Nani".

### Completion Notes
- All 11 ACs satisfied. AC7 (ratchet honored in the agent prompt) is verified at the
  snapshot-builder layer (`fetchHouseholdSnapshot` test asserting the active-terms block is present
  and that candidate terms are excluded), not via LLM output — as the AC specifies.
- The ratchet is wired into BOTH `lumi.routes` (text/voice turns) and `lumi-nudge.job` (proactive
  nudges) so a nudge can never say "Grandma" after the household ratified "Nani". Detection itself
  does not fire in the nudge path (nudges don't call `submitTextTurn`); only the snapshot block runs.
- Detection is best-effort (try/catch, log-and-continue) so a `households` read/write failure never
  breaks the user's turn. The snapshot block is likewise guarded.
- Voice path: detection still RUNS on voice turns (it lives inside `submitTextTurn`) and persists the
  `family_language_prompt` turn; it surfaces on the next text hydration. Live voice surfacing of the
  ratification turn is deferred (per the slice's Deferred list) — `processVoiceUtterance` ignores the
  new return field.

### Test Results (vs. 5-S8 done-state baselines)
| Suite | Baseline | After 5-S10 | Δ passing | Failing |
|-------|----------|-------------|-----------|---------|
| Contracts | 708p / 7f | 722p / 7f | +14 | 7 (pre-existing) |
| API | 1727p / 20f / 13skip | 1758p / 20f / 13skip | +31 | 20 (pre-existing) |
| Web | 537p / 2f | 544p / 2f | +7 | 2 (pre-existing 5-S3 debt: `sse.test.ts` packer + `PackerAssignmentDialog`) |

**Typecheck:** API 12 · web 7 · contracts 1 · types 1 — all unchanged from baseline; zero new errors
in any touched file (the contracts/types `1` is the pre-existing `heart-notes.ts` Zod-4 issue).

### File List
**New:**
- `supabase/migrations/20261020000000_add_household_family_language_terms.sql`
- `packages/contracts/src/family-language.ts`
- `packages/contracts/src/family-language.test.ts`
- `apps/api/src/modules/family-language/family-language.detector.ts`
- `apps/api/src/modules/family-language/family-language.detector.test.ts`
- `apps/api/src/modules/family-language/family-language.repository.ts`
- `apps/api/src/modules/family-language/family-language.repository.test.ts`
- `apps/api/src/modules/family-language/family-language.service.ts`
- `apps/api/src/modules/family-language/family-language.routes.ts`
- `apps/api/src/modules/family-language/family-language.routes.test.ts`
- `apps/web/src/hooks/useRatifyFamilyLanguage.ts`
- `apps/web/src/components/FamilyLanguageRatificationCard.tsx`
- `apps/web/src/components/FamilyLanguageRatificationCard.test.tsx`

**Modified:**
- `packages/contracts/src/thread.ts` (+`TurnBodyFamilyLanguagePrompt` in `TurnBody` union)
- `packages/contracts/src/thread.test.ts` (+union & `LumiTurnResponse` parse tests)
- `packages/contracts/src/lumi.ts` (+`ratification_turn?` on `LumiTurnResponseSchema`)
- `packages/contracts/src/index.ts` (+`export * from './family-language.js'`)
- `packages/types/src/index.ts` (+inferred family-language types)
- `apps/api/src/modules/lumi/lumi.service.ts` (optional dep; inline detection; snapshot ratchet block; widened return type)
- `apps/api/src/modules/lumi/lumi.service.test.ts` (+detection / snapshot / best-effort tests)
- `apps/api/src/modules/lumi/lumi.routes.ts` (wire `FamilyLanguageRepository`)
- `apps/api/src/jobs/lumi-nudge.job.ts` (wire `FamilyLanguageRepository` so nudges honor the ratchet)
- `apps/api/src/app.ts` (register `familyLanguageRoutes`)
- `apps/web/src/components/LumiPanel.tsx` (append `ratification_turn`; render `family_language_prompt` card)
- `apps/web/src/components/LumiPanel.test.tsx` (+card render & append tests)
- `apps/web/src/stores/lumi.store.ts` (+`removeTurn` action)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (status → in-progress → review)

### Change Log
- 2026-06-08 — Implemented 5-S10 family-language ratchet end-to-end (migration + contracts + API
  module + LumiService detection/snapshot wiring + nudge-job wiring + web card/hook/store). All ACs
  met; suites green at baselines (+14 contracts / +31 API / +7 web); zero new typecheck errors.
  Status → review.

### Outstanding (USER-SIDE GATE)
- ✅ **RESOLVED 2026-06-08** — migration `20261020000000` applied (`supabase db push --include-all`).
  `households.preferred_family_language_terms` now exists; `recordUsage`/`getTerms` and the
  ratification flow are live. No outstanding gates remain for this story.

### Review Findings (code review 2026-06-08 — 3-layer adversarial: Blind / Edge / Auditor)

Acceptance Auditor verdict: **all 11 ACs SATISFIED** (verified independently of the Dev Agent Record). No correctness findings break an AC's happy path. The findings below are invariant/lifecycle gaps surfaced by the Blind and Edge layers.

**Decision-needed (resolved & FIXED 2026-06-08):**
- [x] [Review][Patch] (was Decision) Resolved ratification card reappears on rehydration / new tab. **FIXED via Option B** — added `GET /v1/households/:id/family-language` (`requireMember`, cross-hh 403) returning `{ terms }`; new `useFamilyLanguageTerms(householdId, enabled)` hook (TanStack Query, gated on panel-open + a prompt being present); `LumiPanel` suppresses any `family_language_prompt` whose term is no longer `candidate`; fails OPEN when term-state unknown; resolve invalidates the query. New contract `FamilyLanguageTermsResponseSchema` + type re-export + `QueryKeys.familyLanguage`. (blind+edge)
- [x] [Review][Patch] (was Decision) Concurrent full-array writes can demote an `active` term. **FIXED** — module-level per-household async lock (`withHouseholdLock`) serializes both `recordUsage` and `ratify` read-modify-write paths. No migration. Caveat (logged): in-process only; a multi-instance deploy still needs a DB-level guard. Regression test asserts a concurrent recordUsage never demotes a term being ratified to active. [`apps/api/src/modules/family-language/family-language.repository.ts`] (blind)
- [x] [Review][Defer] Threshold crossing consumed before the prompt turn is durably created. **DEFERRED** — rare failure path (a DB write must fail in the gap between count-save and card-creation); tied to the spec's deliberate no-`prompted`-flag simplification. Logged to deferred-work.md (R0). [`family-language.repository.ts:61`] (edge)

**Patch (FIXED 2026-06-08):**
- [x] [Review][Patch] Card DOM id keyed on non-unique `maps_to` → **FIXED**: keyed on unique `term`. [`apps/web/src/components/FamilyLanguageRatificationCard.tsx`]
- [x] [Review][Patch] Pills not guarded when `householdId` is empty → **FIXED**: pills `disabled` when `householdId === ''` (prevents the `/v1/households//…` POST). [`apps/web/src/components/FamilyLanguageRatificationCard.tsx`]

### Review Outcome (2026-06-08) → Status `done`

3-layer adversarial review (Blind / Edge / Acceptance Auditor): all 11 ACs SATISFIED. 3 decision-needed → 2 FIXED (D1 rehydration-suppression, D2 concurrency lock) + 1 deferred (D3); 2 patches FIXED (E, F); 3 deferred (D3/R0, R1, R2); 4 dismissed.

**New files (review patches):**
- `apps/web/src/hooks/useFamilyLanguageTerms.ts` — TanStack Query read of household terms (D1 suppression source).
- `apps/web/test/e2e/5-s10-family-language-ratchet.spec.ts` — 6 Playwright tests (all green).

**Files changed by patches:**
- `packages/contracts/src/family-language.ts` (+`FamilyLanguageTermsResponseSchema`), `packages/types/src/index.ts` (+type re-export).
- `apps/api/src/modules/family-language/family-language.routes.ts` (+`GET /v1/households/:id/family-language`, `requireMember`).
- `apps/api/src/modules/family-language/family-language.repository.ts` (module-level per-household async lock around `recordUsage`/`ratify`).
- `apps/web/src/lib/realtime/query-keys.ts` (+`QueryKeys.familyLanguage`).
- `apps/web/src/components/LumiPanel.tsx` (suppress resolved prompts; invalidate-on-resolve), `apps/web/src/components/LumiPanel.test.tsx` (+QueryClientProvider wrapper, +suppression test), `apps/web/src/routes/(app)/layout.test.tsx` (+QueryClientProvider wrapper).
- `apps/web/src/components/FamilyLanguageRatificationCard.tsx` (unique-`term` DOM id; pills disabled without household).
- Tests added: `family-language.routes.test.ts` (+4 GET), `family-language.repository.test.ts` (+1 concurrency-regression).

**Verification (post-patch):** API 1763p/20f/13skip · web 545p/2f · contracts 722p/7f (all failing counts = pre-existing baselines). Typecheck API 12 · web 7 · contracts 1 · types 1 (zero new errors). E2E 6/6 green. **No new migration** — patches reuse the existing column; only USER-SIDE GATE remains `20261020000000`.

**Deferred:**
- [x] [Review][Defer] `getTerms` returns the JSONB blob with an unchecked cast (no per-element Zod parse) — a malformed element yields `NaN` usage_count and silently poisons the array. [`apps/api/src/modules/family-language/family-language.repository.ts:361-370`] — deferred, no malformed data can exist yet (new column, `'[]'` default).
- [x] [Review][Defer] `recordUsage` re-runs SELECT + full-row UPDATE on every turn mentioning an already-`active`/`forgotten` term (write amplification on the hot path) — no early-out for "all detected terms terminal". [`apps/api/src/modules/family-language/family-language.repository.ts`, `apps/api/src/modules/lumi/lumi.service.ts`] — deferred, spec sanctioned lock-free read-modify-write at beta volume; optimization not correctness.

**Dismissed (4):** voice turn persists a prompt that surfaces on next text hydration (spec explicitly sanctions this — Deferred list); `forgotten` term accumulates `usage_count` and can't re-surface via usage (intended forward-only/forget-permanent); `opt_in`/`forget` on a `forgotten` term returns 200 silently (benign no-op by design); missing-column → 500 on ratify (migration is a documented USER-SIDE deploy gate; detection path is independently guarded).
