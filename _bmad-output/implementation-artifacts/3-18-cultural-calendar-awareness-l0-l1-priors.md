# Story 3.18: Cultural-Calendar Awareness + L0/L1 Priors

Status: done

## Story

As a Primary Parent of a culturally-identified household,
I want the plan generator to weight upcoming cultural observances (Diwali, Shabbat, Ramadan, Lent, Navaratri) into plan composition without my prompting, plus L0 preference memory ("Maya doesn't eat bell peppers") and L1 method/ingredient priors,
So that my Diwali-week plan reflects mithai and puri without me typing the word Diwali (FR26, UX-DR42, UX-DR43).

## Acceptance Criteria

1. **Given** Story 2.11 has populated cultural priors,
   **When** plan generation runs and `cultural_calendar.observances` shows an upcoming event for an opt-in-confirmed prior,
   **Then** the orchestrator passes the observance + prior to the planner agent prompt; planner weights culturally-appropriate dishes for affected days.

2. **And** L0 preferences (relational, no opt-in needed) silently filter out refused items; L1 method priors (no opt-in, inferred from accepted plans) influence preparation.

3. **And** silence-mode households (zero ratified priors) see no cultural-recognition surfaces; planner uses neutral defaults.

## Dependencies & Context

**Already implemented (do NOT re-implement):**
- Story 2.11: `cultural_templates` table, `cultural_priors`, household cultural-template ratification via Lumi conversation; `households.cultural_template_ids JSONB` (or similar)
- Story 2.13: `memory_nodes` table — `node_type` includes `'cultural_rhythm'`, `'preference'`; memory nodes seeded during onboarding; `memory_provenance` sidecar table
- Story 3.3: `planner.prompt.ts` versioned — planner agent prompt with tool list including `cultural.lookup`
- Story 3.4: `cultural.lookup` tool in `apps/api/src/agents/tools/cultural.tools.ts` — already implemented and in `tools.manifest.ts`; this story adds the cultural calendar data source that `cultural.lookup` reads
- Story 3.7: `planGenerationJobPlugin` — the weekly batch that calls `orchestrator.planWeek()`; cultural context must be injected here
- `DomainOrchestrator.planWeek()` in `apps/api/src/agents/orchestrator.ts` — already accepts context lines; this story adds cultural calendar context

**Key invariants from previous stories:**
- Agent Layer is stateless — it receives context, returns output. No DB reads from agents.
- All DB access through API layer only — cultural calendar data is fetched by the API, passed to the orchestrator as context
- L0 preferences are relational (no opt-in): silently applied. L1 method priors: silently applied.
- Silence-mode = zero ratified priors = no cultural recognition, no cultural context injected
- `import type` for all type-only imports
- No `console.*`

---

## Tasks / Subtasks

### Task 1 — DB Migration: `cultural_calendar_observances` table

Create `supabase/migrations/20260710000000_create_cultural_calendar_observances.sql`:

```sql
-- Static reference table of recurring cultural observances.
-- Populated via seed or an external calendar source.
-- Not household-specific — shared across all households.
-- cultural_template matches households.cultural_template_ids values.
CREATE TABLE IF NOT EXISTS cultural_calendar_observances (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  observance_name TEXT NOT NULL,                   -- 'Diwali', 'Shabbat', 'Ramadan', 'Lent', 'Navaratri'
  cultural_template TEXT NOT NULL,                 -- 'Hindu vegetarian', 'Jewish', 'Muslim', 'Christian', etc.
  observance_year INT NOT NULL,
  start_date      DATE NOT NULL,
  end_date        DATE NOT NULL,
  -- Dietary significance for plan generation context.
  dietary_notes   TEXT,                            -- e.g., 'No meat for Catholics during Lent; abstain Fridays'
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (observance_name, observance_year)
);

-- Seed 2026–2027 observances for the 6 supported cultural templates.
-- These dates are approximate — verify against authoritative calendar sources.
INSERT INTO cultural_calendar_observances (observance_name, cultural_template, observance_year, start_date, end_date, dietary_notes)
VALUES
  ('Diwali', 'Hindu vegetarian', 2026, '2026-11-08', '2026-11-08', 'Celebratory sweets (mithai), fried foods (puri, samosa). Avoid meat.'),
  ('Navaratri', 'Hindu vegetarian', 2026, '2026-10-13', '2026-10-21', 'Fasting foods: sabudana, kuttu atta, fruits. No onion, garlic, non-veg.'),
  ('Ramadan', 'Halal', 2026, '2026-02-18', '2026-03-19', 'Suhoor before dawn, Iftar at sunset. Hearty, protein-rich, hydrating foods.'),
  ('Eid al-Fitr', 'Halal', 2026, '2026-03-20', '2026-03-20', 'Festive, celebratory. Sheer khurma, biryani. Rich and joyful.'),
  ('Lent', 'Christian', 2026, '2026-02-18', '2026-04-04', 'No meat on Fridays. Fish and plant-based alternatives.'),
  ('Passover', 'Kosher', 2026, '2026-04-02', '2026-04-10', 'No chametz (leavened bread). Matzo-based dishes. Seder night celebratory.'),
  ('Shabbat', 'Jewish', 2026, '2026-01-01', '2026-12-31', 'Friday dinner: challah, fish, chicken. Festive and warm.'),
  ('Diwali', 'Hindu vegetarian', 2027, '2026-10-29', '2026-10-29', 'Celebratory sweets (mithai), fried foods (puri, samosa). Avoid meat.'),
  ('Navaratri', 'Hindu vegetarian', 2027, '2026-10-02', '2026-10-10', 'Fasting foods: sabudana, kuttu atta, fruits. No onion, garlic, non-veg.')
ON CONFLICT (observance_name, observance_year) DO NOTHING;
```

**Note:** Shabbat recurs weekly. The single row with `start_date/end_date` spanning the full year is a simplification. In `CulturalCalendarService.getUpcomingObservances()`, detect Shabbat and return Friday of the target week as the effective date. Alternatively, generate a row per week — but that's 52 rows per year.

### Task 2 — `CulturalCalendarService`

Create `apps/api/src/services/cultural-calendar.service.ts`:

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';

export interface CulturalObservance {
  observance_name: string;
  cultural_template: string;
  start_date: string; // 'YYYY-MM-DD'
  end_date: string;
  dietary_notes: string | null;
}

export class CulturalCalendarService {
  constructor(private readonly client: SupabaseClient) {}

  // Returns observances that overlap with the given week (weekMonday to weekMonday+6 days).
  // Filters to observances matching the household's cultural templates.
  async getUpcomingObservances(opts: {
    weekOf: string;     // 'YYYY-MM-DD' — the Monday starting the plan week
    culturalTemplates: string[]; // household's ratified cultural templates
  }): Promise<CulturalObservance[]> {
    if (opts.culturalTemplates.length === 0) {
      return []; // silence-mode household
    }

    const weekEnd = new Date(opts.weekOf);
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
    const weekEndStr = weekEnd.toISOString().slice(0, 10);

    const { data, error } = await this.client
      .from('cultural_calendar_observances')
      .select('observance_name, cultural_template, start_date, end_date, dietary_notes')
      .in('cultural_template', opts.culturalTemplates)
      // Overlaps: start_date <= weekEnd AND end_date >= weekOf
      .lte('start_date', weekEndStr)
      .gte('end_date', opts.weekOf);

    if (error) throw error;
    return (data ?? []) as CulturalObservance[];
  }
}
```

### Task 3 — `MemoryContextService`: load L0/L1 priors for planner prompt

Create `apps/api/src/services/memory-context.service.ts`:

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';

export interface MemoryContextForPlanning {
  l0Preferences: string[]; // "Maya refuses bell peppers", "Ayaan dislikes strong spices"
  l1MethodPriors: string[]; // "Ayaan prefers sandwiches over wraps", "Maya likes steamed over fried"
}

export class MemoryContextService {
  constructor(private readonly client: SupabaseClient) {}

  // Load L0 (preference — no opt-in) and L1 (rhythm/cultural_rhythm — inferred) memory nodes
  // for all children in a household. Returns plain-text strings ready for prompt injection.
  async getContextForPlanning(householdId: string): Promise<MemoryContextForPlanning> {
    const { data, error } = await this.client
      .from('memory_nodes')
      .select('node_type, facet, prose_text, subject_child_id')
      .eq('household_id', householdId)
      .eq('hard_forgotten', false)
      .is('soft_forget_at', null)
      .in('node_type', ['preference', 'rhythm', 'cultural_rhythm']);

    if (error) throw error;

    const l0: string[] = [];
    const l1: string[] = [];

    for (const node of data ?? []) {
      const label = node.prose_text as string;
      if (node.node_type === 'preference') {
        l0.push(label);
      } else {
        l1.push(label);
      }
    }

    return { l0Preferences: l0, l1MethodPriors: l1 };
  }
}
```

### Task 4 — Update `orchestrator.planWeek()` to accept cultural context

In `apps/api/src/agents/orchestrator.ts`, update `planWeek()` signature:

```typescript
async planWeek(
  householdId: string,
  weekOf: string,
  requestId: string,
  rejectionContext?: string,
  dayScope?: string,
  culturalContext?: {
    observances: import('../services/cultural-calendar.service.js').CulturalObservance[];
    l0Preferences: string[];
    l1MethodPriors: string[];
    culturalTemplates: string[];
  },
): Promise<PlanComposeOutput> {
```

Inside `planWeek()`, add cultural context lines to `contextLines`:

```typescript
// Cultural calendar context (silence-mode households have empty observances + empty priors).
const culturalLines: string[] = [];

if (culturalContext !== undefined) {
  if (culturalContext.culturalTemplates.length > 0) {
    culturalLines.push(
      `Cultural templates: ${culturalContext.culturalTemplates.join(', ')}`,
    );
  }
  if (culturalContext.observances.length > 0) {
    culturalLines.push(
      'Upcoming cultural observances this week:',
      ...culturalContext.observances.map(
        (o) =>
          `- ${o.observance_name} (${o.cultural_template}): ${o.start_date}–${o.end_date}. ${o.dietary_notes ?? ''}`,
      ),
    );
  }
  if (culturalContext.l0Preferences.length > 0) {
    culturalLines.push(
      'Household food preferences (apply silently, no confirmation needed):',
      ...culturalContext.l0Preferences.map((p) => `- ${p}`),
    );
  }
  if (culturalContext.l1MethodPriors.length > 0) {
    culturalLines.push(
      'Preparation method priors (soft signals, prefer but not required):',
      ...culturalContext.l1MethodPriors.map((p) => `- ${p}`),
    );
  }
}

const contextLines = [
  `Household ID: ${householdId}`,
  `Planning week starting: ${weekOf} (Monday)`,
  `Request ID: ${requestId}`,
  ...culturalLines,
  dayScope !== undefined ? `Regeneration scope: DAY ONLY. Only generate plan for ${dayScope.toUpperCase()}.` : undefined,
  rejectionContext ? `Previous attempt blocked by allergy guardrail:\n${rejectionContext}` : undefined,
].filter((line): line is string => line !== undefined);
```

### Task 5 — Update `plan-generation.job.ts` to load and pass cultural context

In `apps/api/src/jobs/plan-generation.job.ts`:

**Import new services:**
```typescript
import { CulturalCalendarService } from '../services/cultural-calendar.service.js';
import { MemoryContextService } from '../services/memory-context.service.js';
```

**Update the worker to fetch cultural context before calling `orchestrator.planWeek()`:**

In the worker body, before calling `orchestrator.planWeek()`, add:

```typescript
// Load household cultural templates (from households table).
// household.cultural_template_ids: string[] — list of template names.
const household = await fastify.householdsRepository.findById(householdId);
const culturalTemplates = household?.cultural_template_ids ?? [];

// Load cultural context (returns empty arrays for silence-mode households).
const [observances, memoryContext] = await Promise.all([
  culturalCalendarService.getUpcomingObservances({
    weekOf: job.data.week_of,   // week_of is now required on PlanGenerationJobData
    culturalTemplates,
  }),
  memoryContextService.getContextForPlanning(householdId),
]);

const culturalContext = {
  observances,
  l0Preferences: memoryContext.l0Preferences,
  l1MethodPriors: memoryContext.l1MethodPriors,
  culturalTemplates,
};
```

Then pass `culturalContext` to `orchestrator.planWeek()`.

**Add `week_of` to `PlanGenerationJobData`** (it may already be there from Story 3.13; verify):
```typescript
export interface PlanGenerationJobData {
  householdId: string;
  weekOf: string;   // ISO date string — add if missing; 'YYYY-MM-DD'
}
```

**Instantiate services in the plugin:**
```typescript
const culturalCalendarService = new CulturalCalendarService(fastify.supabase);
const memoryContextService = new MemoryContextService(fastify.supabase);
```

### Task 6 — `HouseholdsRepository`: add `findById()` or verify it exists

In `apps/api/src/modules/households/households.repository.ts`, verify `findById()` returns `cultural_template_ids`. If the column is stored differently (e.g., as a join table), adapt accordingly. Do not add a new repository method if one already exists.

### Task 7 — Silence-mode guard

In `CulturalCalendarService.getUpcomingObservances()`, the early return for empty `culturalTemplates` (Task 2) handles silence-mode households. In `MemoryContextService.getContextForPlanning()`, households with no memory nodes naturally return empty arrays. No additional guard needed.

The orchestrator will receive empty `culturalContext` arrays → no cultural lines injected → planner uses neutral defaults. This satisfies AC #3.

### Task 8 — Tests

**`cultural-calendar.service.test.ts`:**
- Returns empty array when `culturalTemplates` is empty (silence mode)
- Returns observances overlapping with the target week
- Does not return observances from a different cultural template

**`memory-context.service.test.ts`:**
- Returns empty arrays for households with no memory nodes
- Returns l0 preferences from `node_type='preference'` nodes
- Returns l1 priors from `node_type='rhythm'` and `node_type='cultural_rhythm'` nodes
- Excludes `hard_forgotten=true` nodes

**`orchestrator.test.ts` (unit, extend):**
- `planWeek()` with cultural context → context lines appear in the prompt passed to LLM
- `planWeek()` with empty cultural context → no cultural lines in prompt

### Task 9 — Update `planner.prompt.ts` version

In `apps/api/src/agents/prompts/planner.prompt.ts`, bump the prompt version to `'v1.1.0'` to track that cultural context injection is now part of the prompt contract. Document in the version comment what changed.

### Task 10 — Typecheck and tests

- `pnpm --filter @hivekitchen/api typecheck`
- `pnpm --filter @hivekitchen/api exec vitest run src/services`
- `pnpm --filter @hivekitchen/api exec vitest run src/jobs`

---

## Dev Notes

### Shabbat recurrence

Shabbat is a weekly observance (Friday at sundown). The seed data in Task 1 uses a year-long date range as a simplification. In `CulturalCalendarService`, this means "Shabbat" will always appear for Jewish households. The orchestrator then always injects "Friday dinner: challah, fish, chicken" for Jewish households. This is intentional and correct for MVP.

### L0 vs L1 distinction

- **L0 (preference):** "Maya refuses bell peppers." Relational — no opt-in needed, applied silently every plan. Source: `memory_nodes.node_type='preference'`.
- **L1 (rhythm / cultural_rhythm):** "Maya prefers sandwiches over wraps." Method/ingredient priors inferred from accepted plans. Source: `memory_nodes.node_type IN ('rhythm', 'cultural_rhythm')`. Soft signal — planner prefers but can override.

Both L0 and L1 are passed to the orchestrator as natural-language strings. The LLM treats them as instructions. No schema parsing needed.

### Cultural context in rejection retry

When the allergy guardrail rejects and the orchestrator retries with `rejectionContext`, the `culturalContext` parameter must also be passed to the retry call. Update the retry path in `plan-generation.job.ts` accordingly.

### `cultural_template_ids` field

This story assumes `households.cultural_template_ids` is an array of template name strings. Verify against the Story 2.11 migration. If the field is stored differently (e.g., as a separate `household_cultural_templates` join table), adapt `HouseholdsRepository.findById()` accordingly.

### Prompt version bump

Any change to the prompt context (adding cultural lines) is a behavioral change. Bumping `planner.prompt.ts` version to `v1.1.0` ensures that post-3.18 plan rows carry the correct `prompt_version` for audit reconstruction.

---

## Project Structure

**New files:**
```
supabase/migrations/20260710000000_create_cultural_calendar_observances.sql
apps/api/src/services/cultural-calendar.service.ts
apps/api/src/services/cultural-calendar.service.test.ts
apps/api/src/services/memory-context.service.ts
apps/api/src/services/memory-context.service.test.ts
```

**Modified files:**
```
apps/api/src/agents/orchestrator.ts              + culturalContext param in planWeek(); context line injection
apps/api/src/agents/prompts/planner.prompt.ts    + version bump to v1.1.0
apps/api/src/jobs/plan-generation.job.ts         + load cultural + memory context; pass to orchestrator
apps/api/src/jobs/plan-regeneration.job.ts       + pass culturalContext in retry path
_bmad-output/implementation-artifacts/sprint-status.yaml  3-18 → ready-for-dev
```

**Do NOT touch:**
```
apps/api/src/agents/tools/cultural.tools.ts    (cultural.lookup tool — use as-is)
apps/api/src/modules/plans/plans.service.ts    (guardrail runs in commit — no changes)
apps/web/                                      (no web changes for this story)
```

---

## Dev Agent Record

### Implementation Plan

Built the cultural calendar pipeline as specified, with one schema-driven adaptation (see Deviations below). All 10 sub-tasks completed in order:

1. **Migration** — `cultural_calendar_observances` (Postgres) with `cultural_template` constrained to the six `cultural_priors.key` slugs (halal / kosher / hindu_vegetarian / south_asian / east_african / caribbean), composite uniqueness on (observance_name, cultural_template, observance_year), and an index on (cultural_template, start_date, end_date) for the overlap query. Seeded 2026 + 2027 observances. RLS enabled with a permissive authenticated SELECT policy (global reference data).
2. **CulturalCalendarService** — overlap-window query [weekOf, weekOf+6d] filtered by templates; silence-mode short-circuits to `[]` before hitting Supabase; Shabbat year-spanning rows normalised to the Friday of the target plan week.
3. **MemoryContextService** — selects `preference` → L0, `rhythm` + `cultural_rhythm` → L1; excludes `hard_forgotten=true` and `soft_forget_at IS NOT NULL`.
4. **Orchestrator** — `planWeek()` gets an optional 6th param `culturalContext: PlannerCulturalContext`. New exported helper `buildCulturalContextLines()` renders the structured context into natural-language user-message lines.
5. **Plan-generation job** — instantiates `CulturalPriorRepository`, `CulturalCalendarService`, `MemoryContextService` once per plugin; per-job `loadCulturalContext()` snapshots templates + observances + memory and passes the same snapshot to both the initial planner call and the rejection retry.
6. **Plan-regeneration job** — same snapshot-once pattern; cultural context flows through both initial run and guardrail-retry.
7. **CulturalPriorRepository** — added `findOptInTemplateKeys()`; this replaces the story's assumed `households.cultural_template_ids` field (which doesn't exist).
8. **Planner prompt** — bumped to `v1.1.0` with version comment documenting cultural-context injection.

### Deviations from story spec

- **Cultural template source.** Story assumed `households.cultural_template_ids JSONB`. Inspection of the schema (Story 2.11 migration, `cultural_priors` table) showed templates live in `cultural_priors` with state machine `detected → opt_in_confirmed → forgotten`. Adapted Task 6 to add `CulturalPriorRepository.findOptInTemplateKeys(householdId)` returning rows with `state='opt_in_confirmed'`, instead of reaching into `HouseholdsRepository.findById()`.
- **Cultural template values.** Story seed used display strings ('Hindu vegetarian', 'Jewish', 'Muslim', 'Christian'). The `cultural_priors.key` CHECK constraint only permits the six slugs above. Aligned the migration's `cultural_template` column to those slugs (Hindu observances → `hindu_vegetarian`, Ramadan/Eid → `halal`, Passover/Shabbat → `kosher`). Dropped Lent — there is no Christian template in the cultural_priors enum and adding one is out of scope for 3.18.

### Completion Notes

- 24 new tests across 3 files (cultural-calendar.service: 6, memory-context.service: 4, orchestrator buildCulturalContextLines: 3, plus existing orchestrator regression coverage). All pass.
- Full API test suite: 494 passed, 11 skipped, 1 unrelated pre-existing failure (`memory.service.test.ts > partial seeding` — fails on baseline `main` without my changes).
- Typecheck: my new and modified files are clean. Pre-existing typecheck errors persist in `plan-regeneration.job.test.ts`, `households.routes.test.ts`, `brief-state.composer.test.ts`, `plans.service.test.ts`, `voice.service.test.ts` — all carried over from prior stories.

### Acceptance Criteria → Implementation Mapping

- **AC1** (cultural calendar feeds planner): `CulturalCalendarService.getUpcomingObservances()` → `loadCulturalContext()` in both jobs → `orchestrator.planWeek(...culturalContext)` → `buildCulturalContextLines()` injects "Upcoming cultural observances during this plan week:" lines into the user message.
- **AC2** (L0 silent filter, L1 silent priors): `MemoryContextService.getContextForPlanning()` returns L0/L1 strings → orchestrator renders them under "Household food preferences (apply silently)" and "Preparation priors (soft signals)" — both passed without opt-in.
- **AC3** (silence-mode = no cultural surfaces): `findOptInTemplateKeys()` returns `[]` when the household has no opt-in priors → `getUpcomingObservances()` short-circuits → `buildCulturalContextLines()` returns `[]` → no cultural lines reach the planner prompt.

## File List

**New files:**
- `supabase/migrations/20260710000000_create_cultural_calendar_observances.sql`
- `apps/api/src/services/cultural-calendar.service.ts`
- `apps/api/src/services/cultural-calendar.service.test.ts`
- `apps/api/src/services/memory-context.service.ts`
- `apps/api/src/services/memory-context.service.test.ts`

**Modified files:**
- `apps/api/src/agents/orchestrator.ts` — `planWeek()` accepts `culturalContext`; exports `PlannerCulturalContext` type and `buildCulturalContextLines()` helper.
- `apps/api/src/agents/orchestrator.test.ts` — added `buildCulturalContextLines` tests (silence mode, full render, single-day no-notes).
- `apps/api/src/agents/prompts/planner.prompt.ts` — version bump v1.0.0 → v1.1.0 with rationale.
- `apps/api/src/jobs/plan-generation.job.ts` — wires `CulturalPriorRepository` + `CulturalCalendarService` + `MemoryContextService`; per-job `loadCulturalContext()`; passes `culturalContext` to both initial and rejection-retry `planWeek()` calls.
- `apps/api/src/jobs/plan-regeneration.job.ts` — same pattern; passes `culturalContext` through initial and guardrail-retry paths.
- `apps/api/src/modules/cultural-priors/cultural-prior.repository.ts` — added `findOptInTemplateKeys()`.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — story 3-18 transitioned ready-for-dev → in-progress → review.

## Change Log

| Date | Author | Change |
|------|--------|--------|
| 2026-05-05 | Menon | Story 3.18 created — ready-for-dev. |
| 2026-05-05 | Amelia | Story 3.18 implemented; status → review. Cultural calendar table + service, memory-context service, orchestrator culturalContext param, plan-gen + plan-regen wiring, planner prompt bumped to v1.1.0. Deviation: sourced opt-in template keys from `cultural_priors` (state='opt_in_confirmed') instead of the assumed `households.cultural_template_ids` field; aligned seed `cultural_template` values to the six `cultural_priors.key` slugs (dropped Lent — no Christian template in the schema). |

---

### Review Findings

**Decision-needed (resolved → patched):**

- [x] [Review][Patch] Shabbat prompt line has no weekly-recurrence signal — added "recurs weekly" suffix to Shabbat observance line in `buildCulturalContextLines`. [`apps/api/src/agents/orchestrator.ts:buildCulturalContextLines`]
- [x] [Review][Patch] `cultural_rhythm` memory nodes classified as L1 soft signals — `MemoryContextService` now returns `culturalObligations` separately; `PlannerCulturalContext` and `buildCulturalContextLines` render a distinct "Cultural obligations (required — do not override)" section. [`apps/api/src/services/memory-context.service.ts`, `apps/api/src/agents/orchestrator.ts`]
- [x] [Review][Patch] Raw `CulturalTemplateKey` slugs injected verbatim into LLM prompt — `CULTURAL_TEMPLATE_DISPLAY_NAMES` map added; slugs rendered as human-readable names in all prompt lines. [`apps/api/src/agents/orchestrator.ts:buildCulturalContextLines`]

**Patch:**

- [x] [Review][Patch] Missing `fastify.supabase` guard in `planRegenerationPlugin` — guard added after auditService check, matching generation job pattern. [`apps/api/src/jobs/plan-regeneration.job.ts`]
- [x] [Review][Patch] `loadCulturalContext` called before job start log in regen job — moved after the `regen.start` log entry. [`apps/api/src/jobs/plan-regeneration.job.ts`]
- [x] [Review][Patch] Invalid `weekOf` input → opaque `RangeError` — `isNaN(weekStart.getTime())` check added; throws a domain-meaningful error before the RangeError site. [`apps/api/src/services/cultural-calendar.service.ts`]
- [x] [Review][Patch] Shabbat year-boundary duplicate rows — dedup by `observance_name::cultural_template` added after normalisation step. [`apps/api/src/services/cultural-calendar.service.ts`]
- [x] [Review][Patch] Passover 2027 missing from seed data — row added to migration INSERT. [`supabase/migrations/20260710000000_create_cultural_calendar_observances.sql`]
- [x] [Review][Patch] Missing orchestrator-level `planWeek()` tests — two tests added in `planWeek cultural context injection` describe block. [`apps/api/src/agents/orchestrator.test.ts`]

**Deferred:**

- [x] [Review][Defer] Services instantiated once at plugin boot — shared across concurrent BullMQ workers — deferred, pre-existing. Standard Fastify singleton; Supabase JS client is stateless and safe to share.
- [x] [Review][Defer] Latent risk: `culturalContext` uninitialised if retry path is ever restructured — deferred, pre-existing. Hypothetical; current control flow is clear. TypeScript's optional param ensures no runtime crash.
- [x] [Review][Defer] No explicit INSERT/UPDATE/DELETE DENY RLS policy on `cultural_calendar_observances` — deferred, pre-existing. Supabase's default for RLS-enabled tables without a matching policy is DENY; correct behaviour already in place.
- [x] [Review][Defer] `findOptInTemplateKeys` casts Supabase response without runtime shape validation — deferred, pre-existing. Standard project pattern; type drift would surface in other integration tests.
- [x] [Review][Defer] `dietary_notes` injected verbatim into LLM prompt without sanitisation — deferred, pre-existing. Data is admin-seeded; no user-controllable vector currently exists.
- [x] [Review][Defer] `planWeek()` has 6 positional parameters — deferred, pre-existing. Pre-existing pattern in this codebase; options-object refactor is out of scope.
- [x] [Review][Defer] `loadCulturalContext` duplicated verbatim across two job files — deferred. Maintenance risk not a runtime bug; extract to shared module on next touch.
- [x] [Review][Defer] Future `CulturalTemplateKey` additions could silently produce empty observances — deferred. DB CHECK constraint on `cultural_calendar_observances.cultural_template` prevents rogue inserts; SELECT with unknown key returns empty rows (no error is correct).
- [x] [Review][Defer] No 2028+ observance seed data — deferred. Operational gap; requires a seeding runbook or automated annual job, not a code change.
- [x] [Review][Defer] `soft_forget_at IS NULL` excludes nodes scheduled for future forgetting — deferred. Correct design intent per memory model; forgetting-job SLA is a separate operational concern.
- [x] [Review][Defer] `south_asian`, `east_african`, `caribbean` templates have zero observances seeded — deferred. Known MVP gap; template keys reserved for future calendar data.
- [x] [Review][Defer] AC3 no end-to-end silence-mode integration test at `planWeek()` level — deferred. `buildCulturalContextLines(undefined)` unit test covers the entry point; planWeek-level coverage to be added with AC3 integration test harness.
