# Story 3.18: Cultural-Calendar Awareness + L0/L1 Priors

Status: ready-for-dev

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

## Change Log

| Date | Author | Change |
|------|--------|--------|
| 2026-05-05 | Menon | Story 3.18 created — ready-for-dev. |
