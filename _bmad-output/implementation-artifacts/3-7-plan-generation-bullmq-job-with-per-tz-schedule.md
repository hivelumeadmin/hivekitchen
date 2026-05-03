# Story 3.7: Plan-generation BullMQ job with per-TZ schedule

Status: done

## Story

As a Primary Parent,
I want next week's plan composed automatically Friday PM through Sunday AM in my local timezone,
So that the Sunday-evening Ready-Answer Open finds a plan already ready (resolves AR-18, FR21).

## Acceptance Criteria

1. **Given** ioredis + BullMQ plugins wired (Story 1.6),
   **When** Story 3.7 is complete,
   **Then** `apps/api/src/jobs/plan-generation.job.ts` enqueues per-household plan-generation jobs based on `households.timezone`; Pacific kicks Friday 6pm local, Eastern Friday 6pm local, etc.

2. **And** worker concurrency tuned to LLM provider rate-limit; per-household max queue wait ≤4h; full batch completes within 36h for entire active base.

3. **And** per-job retry on transient failure (3 retries with exponential backoff); permanent failure escalates to ops anomaly dashboard via `plan.generation.failed` audit event.

## Tasks / Subtasks

---

### Task 1 — Update `PlanComposeInputSchema` and `PlanComposeOutputSchema` (AC: #1, #2, #3)

The current `DayPlan: { day, meal: MealItem }` is insufficient for per-child/per-slot plan generation. Story 3.7 replaces it with a schema that captures the real plan structure the LLM must produce.

- [x] In `packages/contracts/src/plan.ts`, add after the existing `DayPlan` block (do NOT remove `DayPlan` or `WeeklyPlan` — they remain for backward compatibility in existing routes):

  ```typescript
  // --- Story 3.7 — updated plan.compose tool I/O schemas ---

  // Per-child, per-slot item within a single day's plan.
  // recipe_id/item_id: optional at compose time; resolver fills them in later stories.
  const PlanComposeItemSchema = z.object({
    child_id: z.string().uuid(),
    slot: z.string().min(1).max(SLOT_MAX),           // 'main' | 'snack' | 'extra'
    ingredients: z.array(z.string().min(1).max(INGREDIENT_MAX)).min(1),
    recipe_id: z.string().uuid().optional(),
    item_id: z.string().uuid().optional(),
  });
  export type PlanComposeItem = z.infer<typeof PlanComposeItemSchema>;

  const PlanComposeDaySchema = z.object({
    day: z.enum(['monday', 'tuesday', 'wednesday', 'thursday', 'friday']),
    items: z.array(PlanComposeItemSchema).min(1),
  });
  export type PlanComposeDay = z.infer<typeof PlanComposeDaySchema>;
  ```

- [x] Replace the existing `PlanComposeInputSchema` and `PlanComposeOutputSchema` definitions:

  ```typescript
  export const PlanComposeInputSchema = z.object({
    household_id: z.string().uuid(),
    week_of: z.string().date(),          // Monday's ISO date, e.g. "2026-05-11"
    days: z.array(PlanComposeDaySchema).min(1),
    prompt_version: z.string().min(1),
  });
  export type PlanComposeInput = z.infer<typeof PlanComposeInputSchema>;

  // plan.compose output — carries plan_id so the BullMQ worker can build CommitPlanInput.
  export const PlanComposeOutputSchema = z.object({
    plan_id: z.string().uuid(),
    household_id: z.string().uuid(),
    week_of: z.string().date(),
    days: z.array(PlanComposeDaySchema),
    prompt_version: z.string(),
  });
  export type PlanComposeOutput = z.infer<typeof PlanComposeOutputSchema>;
  ```

- [x] In `packages/contracts/src/index.ts`, add re-exports:
  ```typescript
  export {
    PlanComposeInputSchema,
    PlanComposeOutputSchema,
    // PlanComposeItemSchema and PlanComposeDaySchema are not re-exported (tool-internal)
  } from './plan.js';
  export type { PlanComposeInput, PlanComposeOutput, PlanComposeItem, PlanComposeDay } from './plan.js';
  ```
  > `packages/contracts/src/index.ts` currently uses `export * from './plan.js'` — confirm the new named exports don't conflict. If `export *` already covers them, no change needed.

- [x] In `packages/types/src/index.ts`, add:
  ```typescript
  export type { PlanComposeInput, PlanComposeOutput, PlanComposeItem, PlanComposeDay } from '@hivekitchen/contracts';
  ```

- [x] Update `packages/contracts/src/plan.test.ts`:
  - Replace old `PlanComposeInputSchema` tests using `{ day, meal }` shape with new `{ day, items: [{ child_id, slot, ingredients }] }` shape
  - `PlanComposeInputSchema` — valid parse with 1 day, 1 item; reject missing `household_id`; reject empty `days` array; reject item with empty `ingredients`
  - `PlanComposeOutputSchema` — valid parse with `plan_id` present; reject missing `plan_id`

- [x] Update `apps/api/src/agents/tools/plan.tools.test.ts` — replace `VALID_INPUT` with new schema shape:
  ```typescript
  const CHILD_ID = '22222222-2222-4222-8222-222222222222';
  const VALID_INPUT = {
    household_id: HOUSEHOLD_ID,
    week_of: '2026-05-11',
    days: [{
      day: 'monday' as const,
      items: [{ child_id: CHILD_ID, slot: 'main', ingredients: ['rice', 'lentils'] }],
    }],
    prompt_version: 'v1.0.0',
  };
  ```

---

### Task 2 — Add `LLMMessage` + `completeWithMessages()` to `LLMProvider` interface (AC: #1)

The current `complete(prompt: string)` is single-turn. The planner agentic loop requires multi-turn with tool results. Add a messages-based method.

- [x] In `apps/api/src/agents/providers/llm-provider.interface.ts`, add:

  ```typescript
  // Multi-turn message for agentic loops (planWeek, replyToTurn).
  export interface LLMMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | null;
    toolCalls?: LLMToolCall[];    // populated for role='assistant' when the LLM called tools
    toolCallId?: string;           // required for role='tool' (links result to the call)
    name?: string;                 // for role='tool': the tool name, aids debugging
  }

  export interface LLMProvider {
    readonly name: string;
    complete(prompt: string, tools: ToolSpec[], options: LLMCallOptions): Promise<LLMResponse>;
    completeWithMessages(messages: LLMMessage[], tools: ToolSpec[], options: LLMCallOptions): Promise<LLMResponse>;
    stream(prompt: string, tools: ToolSpec[], options: LLMCallOptions): AsyncIterable<LLMStreamEvent>;
    probe(): Promise<boolean>;
  }
  ```

---

### Task 3 — Implement `completeWithMessages()` in `OpenAIAdapter` (AC: #1)

- [x] In `apps/api/src/agents/providers/openai.adapter.ts`, add a `buildMessagesFromLLM()` helper and implement `completeWithMessages()`:

  ```typescript
  import type { ChatCompletionMessageParam, ChatCompletionToolMessageParam } from 'openai/resources/chat/completions';
  import type { LLMMessage } from './llm-provider.interface.js';

  function buildMessagesFromLLM(messages: LLMMessage[]): ChatCompletionMessageParam[] {
    return messages.map((m): ChatCompletionMessageParam => {
      if (m.role === 'tool') {
        return {
          role: 'tool',
          tool_call_id: m.toolCallId ?? '',
          content: m.content ?? '',
        } as ChatCompletionToolMessageParam;
      }
      if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
        return {
          role: 'assistant',
          content: m.content,
          tool_calls: m.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: toExternalName(tc.name),
              arguments: typeof tc.arguments === 'string'
                ? tc.arguments
                : JSON.stringify(tc.arguments),
            },
          })),
        };
      }
      return {
        role: m.role as 'system' | 'user' | 'assistant',
        content: m.content ?? '',
      };
    });
  }

  async completeWithMessages(
    messages: LLMMessage[],
    tools: ToolSpec[],
    options: LLMCallOptions,
  ): Promise<LLMResponse> {
    const params: ChatCompletionCreateParams = {
      model: options.model,
      messages: buildMessagesFromLLM(messages),
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      ...(options.maxTokens !== undefined ? { max_tokens: options.maxTokens } : {}),
      ...(tools.length > 0 ? { tools: toOpenAITools(tools), tool_choice: 'auto' } : {}),
    };

    const response = await this.client.chat.completions.create(params, {
      headers: { ...ZERO_RETENTION_HEADER },
    });

    // Same response mapping as complete()
    const choice = response.choices[0];
    if (!choice) {
      return {
        content: null, toolCalls: [], finishReason: 'error',
        usage: { promptTokens: response.usage?.prompt_tokens ?? 0, completionTokens: response.usage?.completion_tokens ?? 0 },
      };
    }
    const message = choice.message;
    const toolCalls: LLMToolCall[] = (message?.tool_calls ?? [])
      .filter((c): c is { id: string; type: 'function'; function: { name: string; arguments: string } } =>
        c.type === 'function',
      )
      .map((c) => ({
        id: c.id,
        name: toInternalName(c.function.name),
        arguments: parseToolCallArguments(c.function.arguments),
      }));

    return {
      content: message?.content ?? null,
      toolCalls,
      finishReason: mapFinishReason(choice?.finish_reason),
      usage: {
        promptTokens: response.usage?.prompt_tokens ?? 0,
        completionTokens: response.usage?.completion_tokens ?? 0,
      },
    };
  }
  ```

  > Share `toOpenAITools`, `toExternalName`, `toInternalName`, `parseToolCallArguments`, `mapFinishReason` with the existing `complete()` — do NOT duplicate them.

---

### Task 4 — Add stub `completeWithMessages()` to `AnthropicAdapter` (AC: #1)

- [x] In `apps/api/src/agents/providers/anthropic.adapter.ts`, add:
  ```typescript
  async completeWithMessages(
    _messages: LLMMessage[],
    _tools: ToolSpec[],
    _options: LLMCallOptions,
  ): Promise<LLMResponse> {
    throw new Error('AnthropicAdapter.completeWithMessages — not implemented (failover stub)');
  }
  ```
  > The Anthropic adapter is a circuit-breaker failover stub throughout this epic. It does not need a real implementation until a future story wires Anthropic for multi-turn use.

---

### Task 5 — Add `completeWithMessages()` + `planWeek()` to `DomainOrchestrator` (AC: #1, #2)

- [x] In `apps/api/src/agents/orchestrator.ts`, add imports at the top:
  ```typescript
  import type { LLMMessage } from './providers/llm-provider.interface.js';
  import type { PlanComposeOutput } from '@hivekitchen/types';
  import { PLANNER_PROMPT } from './prompts/planner.prompt.js';
  import { PlanComposeOutputSchema } from '@hivekitchen/contracts';
  ```

- [x] Add `completeWithMessages()` to `DomainOrchestrator` (mirrors `complete()` with circuit-breaker + forbidden-tool enforcement):

  ```typescript
  async completeWithMessages(
    messages: LLMMessage[],
    tools: ToolSpec[],
    options: LLMCallOptions,
    allowedTools?: readonly string[],
  ): Promise<LLMResponse> {
    const provider = this.providers[this.currentProviderIndex];
    if (!provider) {
      throw new Error(`No active LLM provider at index ${String(this.currentProviderIndex)}`);
    }

    const effectiveTools = allowedTools
      ? tools.filter((t) => allowedTools.includes(t.name))
      : tools;

    let result: LLMResponse;
    try {
      result = await provider.completeWithMessages(messages, effectiveTools, options);
      this.breaker.recordSuccess();
    } catch (err) {
      this.breaker.recordFailure();
      throw err;
    }

    if (allowedTools) {
      for (const tc of result.toolCalls ?? []) {
        if (!allowedTools.includes(tc.name)) {
          throw new ForbiddenToolCallError(tc.name);
        }
      }
    }

    return result;
  }
  ```

- [x] Add `planWeek()` to `DomainOrchestrator`:

  ```typescript
  // Agentic planner loop. Runs the PLANNER_PROMPT agent until it calls plan.compose,
  // then returns the composed PlanComposeOutput. The BullMQ worker calls plansService.commit()
  // with the result — the orchestrator does NOT commit.
  //
  // - MAX_PLAN_ITERATIONS guards against runaway tool-calling loops.
  // - rejectionContext: pass guardrail rejections from a previous attempt so the
  //   planner can avoid repeating unsafe ingredients on retry (Story 3.7 guardrail re-run path).
  async planWeek(
    householdId: string,
    weekOf: string,
    requestId: string,
    rejectionContext?: string,
  ): Promise<PlanComposeOutput> {
    const MAX_PLAN_ITERATIONS = 20;
    const tools = Array.from(TOOL_MANIFEST.values());

    const contextLines = [
      `Household ID: ${householdId}`,
      `Planning week starting: ${weekOf} (Monday)`,
      `Request ID: ${requestId}`,
      rejectionContext
        ? `Previous attempt was blocked by the allergy guardrail. Blocked ingredients/reasons:\n${rejectionContext}\nCompose a revised plan that avoids these.`
        : 'This is the first generation attempt for this household and week.',
    ];

    const messages: LLMMessage[] = [
      { role: 'system', content: PLANNER_PROMPT.text },
      { role: 'user', content: contextLines.join('\n') },
    ];

    let planComposeResult: PlanComposeOutput | null = null;

    for (let i = 0; i < MAX_PLAN_ITERATIONS; i++) {
      const response = await this.completeWithMessages(
        messages,
        tools,
        { model: 'gpt-4o', temperature: 0.7, maxTokens: 4096 },
        PLANNER_PROMPT.toolsAllowed,
      );

      messages.push({
        role: 'assistant',
        content: response.content,
        toolCalls: response.toolCalls,
      });

      if (response.finishReason === 'stop' || response.toolCalls.length === 0) {
        break;
      }

      for (const tc of response.toolCalls) {
        const spec = TOOL_MANIFEST.get(tc.name);
        if (!spec) {
          this.logger.error(
            { requestId, toolName: tc.name },
            'planWeek: unregistered tool called — treating as fatal',
          );
          throw new ForbiddenToolCallError(tc.name);
        }

        let result: unknown;
        try {
          result = await spec.fn(tc.arguments);
        } catch (err) {
          // Tool errors are surfaced as a result string so the LLM can adapt.
          // plan.compose errors are fatal — no point continuing without a plan.
          if (tc.name === 'plan.compose') throw err;
          result = { error: err instanceof Error ? err.message : String(err) };
        }

        if (tc.name === 'plan.compose') {
          planComposeResult = PlanComposeOutputSchema.parse(result);
        }

        messages.push({
          role: 'tool',
          content: JSON.stringify(result),
          toolCallId: tc.id,
          name: tc.name,
        });
      }

      if (planComposeResult !== null) break;
    }

    if (planComposeResult === null) {
      throw new Error(
        `planWeek: planner agent did not call plan.compose within ${MAX_PLAN_ITERATIONS} iterations (householdId=${householdId}, weekOf=${weekOf})`,
      );
    }

    this.logger.info(
      { requestId, householdId, weekOf, planId: planComposeResult.plan_id },
      'planWeek: plan composed',
    );

    return planComposeResult;
  }
  ```

---

### Task 6 — Implement `PlansService.compose()` (AC: #1)

- [x] In `apps/api/src/modules/plans/plans.service.ts`, add import at top:
  ```typescript
  import { randomUUID } from 'node:crypto';
  ```

- [x] Replace the stub `compose()`:
  ```typescript
  // Converts the LLM planner's structured output (PlanComposeInput) into a
  // PlanComposeOutput by attaching a newly-generated plan_id. Does NOT commit —
  // the caller (BullMQ worker or test) drives the commit flow separately.
  async compose(input: PlanComposeInput): Promise<PlanComposeOutput> {
    return {
      plan_id: randomUUID(),
      household_id: input.household_id,
      week_of: input.week_of,
      days: input.days,
      prompt_version: input.prompt_version,
    };
  }
  ```

  > Type import: add `PlanComposeInput, PlanComposeOutput` to the existing `@hivekitchen/types` import.

---

### Task 7 — Add `HouseholdsRepository.findAllActive()` (AC: #1)

- [x] In `apps/api/src/modules/households/households.repository.ts`, add:
  ```typescript
  // Returns every household's id + timezone for the plan-generation fan-out.
  // Service-role client bypasses RLS — this is a background system query, not
  // a user-scoped read. No active/inactive flag exists yet; all households qualify.
  async findAllActive(): Promise<Array<{ id: string; timezone: string }>> {
    const { data, error } = await this.client
      .from('households')
      .select('id, timezone');
    if (error) throw error;
    return (data ?? []) as Array<{ id: string; timezone: string }>;
  }
  ```

---

### Task 8 — Extend `bullmq.plugin.ts` for worker options (AC: #2)

- [x] Update `apps/api/src/plugins/bullmq.plugin.ts`:
  ```typescript
  import fp from 'fastify-plugin';
  import { Queue, Worker } from 'bullmq';
  import type { Processor, WorkerOptions } from 'bullmq';

  export const bullmqPlugin = fp(async (fastify) => {
    const connection = fastify.redis;
    const queues = new Map<string, Queue>();
    const workers = new Map<string, Worker>();

    fastify.decorate('bullmq', {
      getQueue: (name: string) => {
        let q = queues.get(name);
        if (!q) {
          q = new Queue(name, { connection });
          queues.set(name, q);
        }
        return q;
      },
      getWorker: (name: string, processor: Processor, opts?: Partial<WorkerOptions>) => {
        let w = workers.get(name);
        if (!w) {
          w = new Worker(name, processor, { connection, ...opts });
          workers.set(name, w);
        }
        return w;
      },
    });

    fastify.addHook('onClose', async () => {
      await Promise.all([...workers.values()].map((w) => w.close()));
      await Promise.all([...queues.values()].map((q) => q.close()));
    });
  });
  ```

- [x] Update `apps/api/src/types/fastify.d.ts`:
  ```typescript
  import type { Queue, Worker, Processor, WorkerOptions } from 'bullmq';

  interface BullMQFacade {
    getQueue(name: string): Queue;
    getWorker(name: string, processor: Processor, opts?: Partial<WorkerOptions>): Worker;
  }
  ```

---

### Task 9 — Add `plan.generation.failed` audit event type (AC: #3)

- [x] In `apps/api/src/audit/audit.types.ts`, add `'plan.generation.failed'` in the `// plan` category:
  ```typescript
  'plan.generation.failed',    // all BullMQ retries exhausted; escalated to ops dashboard
  ```

---

### Task 10 — Create `apps/api/src/jobs/plan-generation.job.ts` (Core — AC: #1, #2, #3)

This is the main deliverable. Two BullMQ queues:

| Queue | Purpose |
|---|---|
| `plan-generation-schedule` | Weekly fan-out scheduler: queries all active households, enqueues per-household delayed jobs |
| `plan-generation` | Per-household plan generation: calls orchestrator, commits plan, handles retries |

**`week_id` derivation utility** — place at the top of the file (export for testing):

```typescript
import { createHash, randomUUID } from 'node:crypto';

// Produces a deterministic UUID-v4-shaped identifier from the week's Monday date.
// The same weekOf string always yields the same week_id, which prevents duplicate
// (household_id, week_id) plan rows on job retries.
export function deriveWeekId(weekOf: string): string {
  const hash = createHash('sha256').update(`hivekitchen-week:${weekOf}`).digest();
  // Set UUID v4 version (0100xxxx) and RFC 4122 variant (10xxxxxx) bits
  hash[6] = (hash[6]! & 0x0f) | 0x40;
  hash[8] = (hash[8]! & 0x3f) | 0x80;
  const h = hash.slice(0, 16).toString('hex');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`;
}

// Given a Friday date at fan-out time, returns the ISO date of the following Monday.
// "Following Monday" = 3 days after Friday.
export function getNextMondayFrom(fridayDate: Date): string {
  const d = new Date(fridayDate);
  d.setUTCDate(d.getUTCDate() + 3);
  return d.toISOString().slice(0, 10);
}

// Returns the UTC timestamp (ms) when 18:00 local time arrives in the given IANA timezone
// on the same calendar day as `referenceDate`. If 18:00 local has already passed,
// returns the timestamp for 18:00 local on the NEXT day.
//
// Uses UTC noon of the local date as a stable probe point — noon is well clear of
// DST midnight transitions and works for all IANA timezones including half-hour offsets
// (IST, NPT) to within 1 hour, which is acceptable for this scheduling use case.
// US timezones (whole-hour offsets) are always exact.
export function getLocalSixPmUtcMs(timezone: string, referenceDate: Date): number {
  // Get the current local date string in the target timezone (YYYY-MM-DD format)
  const localDateStr = new Intl.DateTimeFormat('sv-SE', { timeZone: timezone }).format(referenceDate);

  // Probe: what is the local hour in `timezone` at UTC noon on the local date?
  // For EST (UTC-5): UTC 12:00 → local 07:00 → localHour = 7
  // For PDT (UTC-7): UTC 12:00 → local 05:00 → localHour = 5
  const noonUtcMs = new Date(`${localDateStr}T12:00:00Z`).getTime();
  const localHourAtNoon = parseInt(
    new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: '2-digit', hour12: false }).format(
      new Date(noonUtcMs),
    ),
    10,
  );

  // Adjust from UTC noon to local 18:00:
  // For EST: noonUtcMs + (18 - 7) * 3600s = noonUtcMs + 11h = 23:00 UTC (= 18:00 EST) ✓
  // For PDT: noonUtcMs + (18 - 5) * 3600s = noonUtcMs + 13h = 01:00 UTC next day (= 18:00 PDT) ✓
  const targetMs = noonUtcMs + (18 - localHourAtNoon) * 3_600_000;

  // Guard: if the computed target is already in the past, schedule for the same local
  // time tomorrow. This handles edge cases where the fan-out scheduler fires after 18:00
  // local in some timezone (e.g., a scheduler restart mid-batch).
  return targetMs < referenceDate.getTime() ? targetMs + 86_400_000 : targetMs;
}
```

> **Note:** The `getLocalSixPmUtcMs` helper needs to be accurate. The job file should import from a separate utility if this grows complex. For Story 3.7, inline it. The fallback handles edge cases where `new Date('date TZ')` fails on some Node versions.
>
> **Simpler alternative:** Use `Intl.DateTimeFormat` with `sv-SE` locale (returns `YYYY-MM-DD`) to get the local date string, then compute the UTC ms for `localDate + T18:00:00Z` adjusted by the timezone offset. The dev agent should test this utility against known TZ offsets (Eastern, Pacific, UTC) in the job test file.

**Full job plugin:**

```typescript
import { randomUUID } from 'node:crypto';
import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import type { Job } from 'bullmq';
import { HouseholdsRepository } from '../modules/households/households.repository.js';

// Queues
const SCHEDULE_QUEUE = 'plan-generation-schedule';
const GENERATE_QUEUE = 'plan-generation';
const SCHEDULE_JOB_ID = 'weekly-plan-generation-fanout';

// Per-job BullMQ options for household plan generation
const GENERATION_JOB_OPTS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 300_000 },  // 5m → 10m → 20m
  removeOnComplete: { count: 200 },
  removeOnFail: { count: 48 },
};

export interface PlanGenerationJobData {
  household_id: string;
  week_of: string;      // "YYYY-MM-DD" — Monday's ISO date for the target week
  request_id: string;   // correlation ID for audit trail
}

const planGenerationPlugin: FastifyPluginAsync = async (fastify) => {
  if (!fastify.orchestrator) {
    throw new Error('planGenerationPlugin requires orchestrator decorator — register orchestratorHook first');
  }
  if (!fastify.plansService) {
    throw new Error('planGenerationPlugin requires plansService decorator — register plansHook first');
  }
  if (!fastify.auditService) {
    throw new Error('planGenerationPlugin requires auditService decorator — register auditHook first');
  }
  if (!fastify.supabase) {
    throw new Error('planGenerationPlugin requires supabase decorator — register supabasePlugin first');
  }

  const scheduleQueue = fastify.bullmq.getQueue(SCHEDULE_QUEUE);
  const generateQueue = fastify.bullmq.getQueue(GENERATE_QUEUE);

  // --- Fan-out scheduler ---
  // Runs Friday 10:00 UTC (= 06:00 ET / 03:00 PT).
  // For each active household, enqueues a delayed per-household job that fires at
  // 18:00 local on Friday. The 36h window (Fri 18:00 → Sun 06:00 UTC) covers all
  // US timezones and matches the architecture NFR (≤4h queue wait per HH).
  void scheduleQueue
    .upsertJobScheduler(
      SCHEDULE_JOB_ID,
      { pattern: '0 10 * * 5', tz: 'UTC' },
      {
        name: 'fan-out',
        data: {},
        opts: {
          attempts: 2,
          backoff: { type: 'exponential', delay: 60_000 },
          removeOnComplete: { count: 8 },
          removeOnFail: { count: 8 },
        },
      },
    )
    .catch((err: unknown) => {
      fastify.log.error(
        { err, module: 'plan-generation', action: 'scheduler.registration.failed' },
        'failed to register plan-generation fan-out scheduler',
      );
    });

  fastify.bullmq.getWorker(SCHEDULE_QUEUE, async (_job: Job) => {
    const now = new Date();
    const weekOf = getNextMondayFrom(now);   // planning for next week
    const householdsRepo = new HouseholdsRepository(fastify.supabase, null);
    const households = await householdsRepo.findAllActive();

    fastify.log.info(
      { module: 'plan-generation', action: 'fanout.start', count: households.length, weekOf },
      'plan-generation fan-out: enqueuing per-household jobs',
    );

    const enqueueResults = await Promise.allSettled(
      households.map(async (hh) => {
        const fireAtMs = getLocalSixPmUtcMs(hh.timezone, now);
        const delay = Math.max(0, fireAtMs - Date.now());
        const jobData: PlanGenerationJobData = {
          household_id: hh.id,
          week_of: weekOf,
          request_id: randomUUID(),
        };
        await generateQueue.add('generate-plan', jobData, {
          ...GENERATION_JOB_OPTS,
          delay,
          // Idempotent: same household+week always maps to the same jobId.
          // BullMQ skips duplicate adds when a job with this id is already queued.
          jobId: `plan-gen-${hh.id}-${weekOf}`,
        });
      }),
    );

    const failures = enqueueResults.filter((r) => r.status === 'rejected');
    if (failures.length > 0) {
      fastify.log.error(
        { module: 'plan-generation', action: 'fanout.partial', failed: failures.length, total: households.length },
        'plan-generation fan-out: some enqueues failed',
      );
    } else {
      fastify.log.info(
        { module: 'plan-generation', action: 'fanout.complete', count: households.length, weekOf },
        'plan-generation fan-out: all household jobs enqueued',
      );
    }
  });

  // --- Per-household generation worker ---
  // concurrency: 2 — conservative default to respect LLM provider rate limits.
  // Increase at scaling time (Story 3.30 circuit-breaker audit).
  const generationWorker = fastify.bullmq.getWorker(
    GENERATE_QUEUE,
    async (job: Job<PlanGenerationJobData>) => {
      const { household_id, week_of, request_id } = job.data;
      const weekId = deriveWeekId(week_of);

      fastify.log.info(
        { module: 'plan-generation', action: 'generate.start', household_id, week_of, weekId, attempt: job.attemptsMade },
        'plan-generation job started',
      );

      // Run planner agent — returns PlanComposeOutput (no commit yet)
      const composeOutput = await fastify.orchestrator.planWeek(
        household_id,
        week_of,
        request_id,
      );

      // Convert PlanComposeOutput → CommitPlanInput
      const commitInput = buildCommitInput(composeOutput, weekId, request_id);

      // Commit with allergy guardrail + brief_state refresh (already in PlansService.commit).
      // regenerate callback re-runs the planner with guardrail rejection context.
      await fastify.plansService.commit(
        commitInput,
        request_id,
        async (rejections) => {
          const rejectionContext = rejections
            .flatMap((r) => (r.verdict === 'blocked' ? r.conflicts : []))
            .map((c) => `allergen: ${c.allergen ?? 'unknown'}, ingredient: ${c.ingredient ?? 'unknown'}`)
            .join('; ');

          const retryOutput = await fastify.orchestrator.planWeek(
            household_id,
            week_of,
            request_id,
            rejectionContext,
          );
          return buildCommitInput(retryOutput, weekId, request_id);
        },
      );

      fastify.log.info(
        { module: 'plan-generation', action: 'generate.complete', household_id, week_of, weekId },
        'plan-generation job completed — brief_state updated',
      );

      // SSE plan.updated — deferred to Story 5.2 (Redis pub/sub fan-out not yet implemented).
      // Story 5.2 will emit: fastify.sseDispatcher.publish(household_id, { type: 'plan.updated', week_id: weekId })
      fastify.log.debug(
        { module: 'plan-generation', action: 'sse.deferred', household_id, weekId },
        'plan.updated SSE emission deferred to Story 5.2',
      );
    },
    { concurrency: 2 },
  );

  // Permanent failure escalation: audit log plan.generation.failed.
  // BullMQ emits 'failed' ONLY when all attempts are exhausted (job transitions to
  // 'failed' state). Individual retry failures do NOT trigger this event.
  generationWorker.on('failed', (job: Job<PlanGenerationJobData> | undefined, err: Error) => {
    if (!job) return;
    const { household_id, week_of, request_id } = job.data;

    fastify.log.error(
      { module: 'plan-generation', action: 'generate.permanent_failure', household_id, week_of, err },
      'plan-generation job permanently failed — all retries exhausted',
    );

    void fastify.auditService.write({
      event_type: 'plan.generation.failed',
      household_id,
      request_id,
      metadata: {
        week_of,
        error: err.message,
        attempts: job.attemptsMade,
        job_id: job.id,
      },
    });
  });
};

// Converts PlanComposeOutput to CommitPlanInput (the shape plansService.commit() expects).
function buildCommitInput(
  output: import('@hivekitchen/types').PlanComposeOutput,
  weekId: string,
  requestId: string,
): import('@hivekitchen/types').CommitPlanInput {
  const items = output.days.flatMap((d) =>
    d.items.map((item) => ({
      child_id: item.child_id,
      day: d.day,
      slot: item.slot,
      ingredients: item.ingredients,
      ...(item.recipe_id !== undefined ? { recipe_id: item.recipe_id } : {}),
      ...(item.item_id !== undefined ? { item_id: item.item_id } : {}),
    })),
  );

  return {
    plan_id: output.plan_id,
    household_id: output.household_id,
    week_id: weekId,
    revision: 1,                                 // initial generation always revision 1
    generated_at: new Date().toISOString(),
    prompt_version: output.prompt_version,
    items,
  };
}

export const planGenerationJobPlugin = fp(planGenerationPlugin, {
  name: 'plan-generation-job',
});
```

> **`HouseholdsRepository` KEK:** The constructor takes `kek: Buffer | null`. The existing pattern in `households.routes.ts` converts `fastify.env.ENVELOPE_ENCRYPTION_MASTER_KEY` (64-char hex) via `Buffer.from(kekHex, 'hex')` — there is NO `HOUSEHOLD_KEK` env var. However, `findAllActive()` only selects `id, timezone` (no encrypted fields), so pass `null` directly — no env conversion needed.

---

### Task 11 — Register plugin in `app.ts` (AC: #1)

- [x] In `apps/api/src/app.ts`, add import:
  ```typescript
  import { planGenerationJobPlugin } from './jobs/plan-generation.job.js';
  ```

- [x] Register AFTER `orchestratorHook` and `auditPartitionRotationPlugin`:
  ```typescript
  await app.register(orchestratorHook);
  await app.register(auditPartitionRotationPlugin);
  await app.register(planGenerationJobPlugin);   // NEW — depends on orchestrator + plansService
  ```

---

### Task 12 — Tests (AC: all)

- [x] Create `apps/api/src/jobs/plan-generation.job.test.ts`:
  - `deriveWeekId('2026-05-11')` returns consistent UUID-shaped string across calls
  - `deriveWeekId('2026-05-11')` !== `deriveWeekId('2026-05-18')` (different weeks differ)
  - `getNextMondayFrom(new Date('2026-05-08T10:00:00Z'))` returns `'2026-05-11'` (Friday → Monday)
  - `getLocalSixPmUtcMs('America/New_York', new Date('2026-05-08T10:00:00Z'))` returns UTC ms that resolves to 18:00 ET (22:00 UTC during EDT) — verify with `new Date(result).toISOString()` ending in `'22:00:00.000Z'`
  - `getLocalSixPmUtcMs('America/Los_Angeles', new Date('2026-05-08T10:00:00Z'))` returns UTC ms resolving to 01:00 UTC Saturday (18:00 PDT = UTC+7)
  - `buildCommitInput(composeOutput, weekId, requestId)` — flattens multi-day/multi-child items correctly; sets `plan_id`, `household_id`, `week_id`, `revision: 1`

- [x] Create `apps/api/src/agents/orchestrator.planweek.test.ts`:
  - `planWeek()` calls `completeWithMessages()`, processes tool calls, returns result when agent calls `plan.compose`
  - `planWeek()` throws when agent never calls `plan.compose` within `MAX_PLAN_ITERATIONS`
  - `planWeek()` feeds rejectionContext into the system prompt when provided
  - `planWeek()` stops iterating after `plan.compose` result captured even if more iterations remain
  - `planWeek()` propagates `ForbiddenToolCallError` when agent calls disallowed tool

- [x] Update `apps/api/src/agents/orchestrator.test.ts` — add `completeWithMessages()` to `buildPlansService()` mock:
  ```typescript
  // The orchestrator.test.ts beforeEach stubs currently only stub `plan.compose`.
  // After Task 5, `completeWithMessages()` must also be stubbed on the mock provider.
  // In buildProvider(), add:
  const completeWithMessages = overrides.completeWithMessages ?? vi.fn().mockResolvedValue(stoppedResponse);
  return { name, complete, completeWithMessages, stream, probe } as LLMProvider;
  ```

- [x] Update `apps/api/src/modules/plans/plans.service.test.ts` — add test for `compose()`:
  ```typescript
  it('compose() returns a PlanComposeOutput with a generated plan_id', async () => {
    const service = buildPlansService(); // uses existing test helper
    const input: PlanComposeInput = {
      household_id: HOUSEHOLD_ID,
      week_of: '2026-05-11',
      days: [{
        day: 'monday',
        items: [{ child_id: CHILD_ID, slot: 'main', ingredients: ['rice'] }],
      }],
      prompt_version: 'v1.0.0',
    };
    const output = await service.compose(input);
    expect(output.plan_id).toMatch(/^[0-9a-f-]{36}$/); // UUID shape
    expect(output.household_id).toBe(HOUSEHOLD_ID);
    expect(output.week_of).toBe('2026-05-11');
    expect(output.days).toEqual(input.days);
  });
  ```

- [x] Run: `pnpm --filter @hivekitchen/contracts test` — all tests pass (includes updated plan.test.ts)
- [x] Run: `pnpm --filter @hivekitchen/api exec vitest run src/jobs/plan-generation` — all tests pass
- [x] Run: `pnpm --filter @hivekitchen/api exec vitest run src/agents/orchestrator` — all tests pass (including planWeek tests)
- [x] Run: `pnpm --filter @hivekitchen/api typecheck` — zero new errors

---

## Dev Notes

### Critical — `orchestrator.planWeek()` is the only entry point for plan generation

The BullMQ worker calls `fastify.orchestrator.planWeek()`. The orchestrator runs the agentic loop using `PLANNER_PROMPT` with `completeWithMessages()`. `planWeek()` does NOT call `plansService.commit()` — it returns `PlanComposeOutput`, and the worker drives the commit. This separation allows the worker to build the `CommitPlanInput` shape (including `weekId` and `revision`) before committing.

### Critical — `PlansService.compose()` does NOT commit

`compose()` is a pure transform: `PlanComposeInput → PlanComposeOutput`. It generates a `plan_id` via `randomUUID()` and returns the structured plan without persisting anything. The `plan.compose` tool calls `planService.compose()` during the agentic loop. After the loop completes, the BullMQ worker calls `planService.commit()` with the result. Do NOT add any DB writes to `compose()`.

### Critical — `deriveWeekId(weekOf)` must be deterministic and idempotent

`week_id` in the `plans` table is a UUID used in the `(household_id, week_id)` unique index. If a job retries (e.g., the LLM call succeeded but the DB commit failed), `PlansService.commit()` calls `repo.findActiveByHouseholdAndWeek()` to find the existing plan and upsert it via `commit_plan()`. For this to work, the same `weekOf` string must always produce the same `week_id` UUID across retries and across worker restarts. The `deriveWeekId()` SHA-256 approach guarantees this. **Never use `randomUUID()` for `week_id`.**

### Critical — `jobId` deduplication prevents double-generation

The `plan-generation` queue uses `jobId: \`plan-gen-${household_id}-${weekOf}\`` on every `add()` call. BullMQ skips the `add()` when a job with the given `jobId` already exists in `waiting`, `delayed`, `active`, or `completed` states. This prevents the fan-out scheduler from enqueuing a second generation for the same household+week if the scheduler fires twice (e.g., after a worker restart). Do NOT remove the `jobId` option.

### Critical — `revision: 1` in `buildCommitInput()` for initial generation

`PlansService.commit()` calls `repo.findActiveByHouseholdAndWeek()` to detect if a plan already exists for this `(household_id, week_id)`. If found, it reuses the `plan_id` (so `commit_plan()` takes the `ON CONFLICT (id)` upsert path). However, `revision` must be bumped. For Story 3.7, initial generation always uses `revision: 1`. The `commit_plan()` stored procedure increments revision on upsert — verify this in `20260502111000_create_commit_plan_function.sql`. If the SP does NOT auto-increment, add a `findActiveRevision()` step to read the current revision and pass `revision: current + 1`.

### Critical — `plan.generation.failed` is an ops-only signal

When `generationWorker.on('failed', ...)` fires, the job has exhausted ALL retries. This event must:
1. Write `plan.generation.failed` audit row with `household_id`, `week_of`, `error`, `attempts`
2. The audit row is what ops personnel use in the allergy-safety anomaly dashboard (FR95/FR96)
3. Do NOT throw in the `'failed'` event handler — BullMQ has already finalized the job state

### Critical — Worker `'failed'` event vs. job `'failed'` status

BullMQ's `Worker.on('failed', callback)` fires ONCE per job after all retries are exhausted. Do NOT confuse this with the in-job error handling (which uses retries). The `callback` receives `job | undefined` and `err: Error`. Guard against `job === undefined` (BullMQ passes `undefined` in rare cases where job data is not available).

### Architecture — SSE `plan.updated` is deferred to Story 5.2

The architecture integration path requires SSE `plan.updated` emission after successful plan commit. The real SSE fan-out (Redis pub/sub, per-user/per-tab channels) is Story 5.2. In Story 3.7, log a `debug` message with the `household_id` and `weekId` that WOULD be emitted. Add a clear `// Story 5.2:` comment at the emission point.

### Architecture — `HouseholdsRepository` KEK parameter

`HouseholdsRepository` takes a `kek: Buffer | null` constructor param. `findAllActive()` queries only `id` and `timezone` — no encrypted fields — so pass `null` directly (confirmed: `households.repository.ts` line 94 has no `findAllActive()` yet; you are adding it in Task 7, and it only calls `.select('id, timezone')`). The existing pattern in `households.routes.ts` uses `Buffer.from(fastify.env.ENVELOPE_ENCRYPTION_MASTER_KEY, 'hex')` for encrypted-field operations — do NOT replicate that pattern here since the KEK is not needed.

### Architecture — Worker concurrency = 2

`{ concurrency: 2 }` is conservative. At beta scale (150 HH), 2 concurrent plan-generation jobs means the 36h window is vastly sufficient. At 5k HH, 2 workers × ~90s per plan = ~250 HH/h → full batch in ~20h (within the 36h window). Increase concurrency in Story 3.30 when circuit-breaker audit is implemented and LLM rate limits are profiled.

### Architecture — Fan-out scheduler timing (Friday 10:00 UTC)

The fan-out scheduler fires at `0 10 * * 5` UTC (Friday 10am UTC):
- This is 6am ET (Eastern), 3am PT (Pacific)
- Eastern households: delay ≈ 12h until 6pm ET (22:00 UTC)
- Pacific households: delay ≈ 15h until 6pm PT (01:00 UTC Saturday)
- BullMQ delayed jobs remain in the `delayed` set until their `delay` elapses — no polling cost

### Architecture — `getLocalSixPmUtcMs()` must handle DST transitions correctly

IANA timezone strings (e.g., `America/New_York`) correctly account for DST when used with `Intl.DateTimeFormat`. Do NOT use fixed UTC offsets (e.g., `-5 * 3600000`) — they break during DST transitions. The `Intl` approach automatically handles EDT vs. EST, PDT vs. PST, etc. Test against known DST boundary dates if the implementation diverges from the spec.

### Architecture — `PlanComposeInput.days` uses `PlanComposeDay`, NOT `DayPlan`

`DayPlan` (the original `{ day, meal: MealItem }`) remains in contracts for backward compatibility with the pre-3.7 `WeeklyPlan`/`CreatePlanResponse` schemas. `PlanComposeDaySchema` (added in Task 1) is the schema the `plan.compose` tool now uses. They are different. Do NOT confuse them.

### Pattern — `orchestrator.planWeek()` tool error handling

Tool errors (non-`plan.compose` tools) are caught and returned as `{ error: "..." }` strings to the LLM so the agent can recover. `plan.compose` tool errors are fatal — the planner has declared an invalid plan structure and regeneration is needed. Rethrow `plan.compose` errors immediately so the BullMQ job fails and triggers the retry or permanent-failure path.

### Pattern — `buildCommitInput()` item flattening

`output.days` is `PlanComposeDay[]` where each day has `items: PlanComposeItem[]` (per-child, per-slot). `CommitPlanInput.items` is a flat array of `PlanItemWriteInput`. `buildCommitInput()` uses `flatMap` to produce one entry per `(day, child, slot)` combination. The mapping: `{ child_id, slot, ingredients, recipe_id?, item_id?, day }` — `day` comes from the outer `PlanComposeDay.day`, not from the item itself.

### Pattern — `revisionupdate` for re-generation (future Story 3.13)

Story 3.7 uses `revision: 1` for all initial generations. Story 3.13 (plan regeneration request) will need to read the current revision and pass `revision: current + 1`. When Story 3.13 is implemented, extract `buildCommitInput()` logic so it can accept a `revision` override parameter.

### Project Structure — New and Modified Files

**New files:**
```
apps/api/src/jobs/
  plan-generation.job.ts        scheduler + fan-out + per-household worker
  plan-generation.job.test.ts   tests for deriveWeekId, getNextMondayFrom, getLocalSixPmUtcMs, buildCommitInput
apps/api/src/agents/
  orchestrator.planweek.test.ts tests for planWeek() agentic loop
```

**Modified files:**
```
packages/contracts/src/
  plan.ts               + PlanComposeItemSchema, PlanComposeDaySchema (new)
                          updated PlanComposeInputSchema (per-child/per-slot days)
                          updated PlanComposeOutputSchema (+ plan_id field)
  plan.test.ts          updated to use new PlanComposeInputSchema shape
  index.ts              updated exports for new types (if not already covered by export *)

packages/types/src/
  index.ts              + PlanComposeInput, PlanComposeOutput, PlanComposeItem, PlanComposeDay

apps/api/src/agents/
  providers/llm-provider.interface.ts  + LLMMessage interface, completeWithMessages() in LLMProvider
  providers/openai.adapter.ts          + completeWithMessages() implementation
  providers/anthropic.adapter.ts       + completeWithMessages() stub
  orchestrator.ts                      + completeWithMessages(), planWeek()
  orchestrator.test.ts                 + buildProvider() extended with completeWithMessages mock

apps/api/src/modules/plans/
  plans.service.ts              compose() implemented (was NotImplementedError stub)
  plans.service.test.ts         + compose() test

apps/api/src/modules/households/
  households.repository.ts      + findAllActive()

apps/api/src/plugins/
  bullmq.plugin.ts              getWorker() extended with opts?: Partial<WorkerOptions>

apps/api/src/audit/
  audit.types.ts                + 'plan.generation.failed'

apps/api/src/types/
  fastify.d.ts                  updated BullMQFacade with WorkerOptions opts param
  
apps/api/src/app.ts             + planGenerationJobPlugin registration

apps/api/src/agents/tools/
  plan.tools.test.ts            VALID_INPUT updated to new PlanComposeInputSchema shape
```

**Unchanged:**
- `apps/api/src/modules/plans/plans.repository.ts` — no changes
- `apps/api/src/modules/plans/plans.hook.ts` — no changes
- `apps/api/src/modules/plans/brief-state.composer.ts` — no changes; `commit()` already calls `refresh()`
- `supabase/migrations/` — no new migrations needed for this story
- `apps/api/src/agents/prompts/planner.prompt.ts` — PLANNER_PROMPT unchanged; context injected at runtime by `planWeek()`

### Story 3.8 Handoff

Story 3.8 (BriefCanvas frontend) depends on `GET /v1/households/:id/brief` returning populated data. Before Story 3.8 can be fully tested, Story 3.7 must be able to generate and commit at least one plan, populating the `brief_state` projection row. The test flow:

1. Run story 3.7's fan-out scheduler manually (or directly call the generation worker with test data)
2. Verify `brief_state` row updated for the test household
3. `GET /v1/households/:id/brief` returns non-null `brief`
4. Story 3.8 can now render `<BriefCanvas>` with real data

Note: `moment_headline`, `lumi_note`, and `memory_prose` remain empty strings from Story 3.6's stub. Story 3.8 must render gracefully when these fields are empty strings.

### References

- Architecture §1.5 — brief_state projection design; plan-generation batch NFR (line ~308)
- Architecture §3.6 — rate limiting; plan regen 5/week/HH (line ~390)
- Architecture integration path — weekend plan-generation batch (line ~1400)
- Architecture §5.1 — API 99.9% school-hours; RPO 1h/RTO 4h (line ~79)
- Story 3.5 completion notes — `PlansService.commit()` + `CommitPlanInput` shape
- Story 3.6 completion notes §Story 3.7 Handoff — `briefStateComposer.refresh()` already in commit; SSE deferred
- Story 3.6 completion notes §Critical — `moment_headline`, `lumi_note` stubs until Story 3.7
- `audit-partition-rotation.job.ts` — canonical BullMQ job plugin pattern
- `orchestrator.ts` `complete()` — circuit-breaker + provider-failover pattern to mirror in `completeWithMessages()`
- `PlansService.commit()` — allergy guardrail + brief_state refresh already wired
- `PLANNER_PROMPT` — `apps/api/src/agents/prompts/planner.prompt.ts`
- `PlanComposeInputSchema` (pre-story) — `packages/contracts/src/plan.ts`
- `CommitPlanInput` / `PlanItemWriteInput` — `packages/contracts/src/plan.ts` (Story 3.5)
- `households` table `timezone` column — `supabase/migrations/20260501120000_create_users_and_households.sql` line 14

---

## Dev Agent Record

### Agent Model Used

claude-opus-4-7 (Claude Code)

### Debug Log References

- TS strict-mode `Buffer` indexing in `deriveWeekId()` — `@types/node` types `Buffer[i]` as `number` (not `number | undefined`), so the spec's `hash[6]!` non-null assertion was dropped; bit-mutation works without it.
- `orchestrator.planweek.test.ts` initially failed Zod parse at the `plan.compose` boundary because `DomainOrchestrator`'s constructor reinstalls the real `createPlanComposeSpec` after construction, overwriting any pre-test stub. Fixed by calling `wirePlanComposeStub()` AFTER `buildOrchestrator()` in every test.
- Pre-existing typecheck/test failures in `households.routes.test.ts:436`, `brief-state.composer.test.ts:283`, `plans.service.test.ts:373` (uncertain verdict missing `reason`), `voice.service.test.ts` (RequestInfo), and `memory.service.test.ts` (partial seeding) — all confirmed pre-existing via `git stash`; not introduced by this story.

### Completion Notes List

- Replaced the legacy `{ day, meal: MealItem }` `PlanComposeInputSchema` / `PlanComposeOutputSchema` with the per-child / per-slot schema the planner agent actually needs. Added two tool-internal schemas (`PlanComposeItemSchema`, `PlanComposeDaySchema`) — the inferred types `PlanComposeItem` and `PlanComposeDay` are exported for the BullMQ worker.
- Extended `LLMProvider` with `LLMMessage` and `completeWithMessages()`; implemented in `OpenAIAdapter` (sharing response-mapping logic with `complete()` via a new private `mapChatCompletion()` helper), stubbed in `AnthropicAdapter`.
- Added `DomainOrchestrator.completeWithMessages()` (mirrors `complete()` for circuit-breaker accounting + forbidden-tool enforcement) and `DomainOrchestrator.planWeek()` — the agentic loop that runs the planner prompt until `plan.compose` is invoked, with `MAX_PLAN_ITERATIONS = 20` runaway guard and JSON-encoded tool-error fallback for non-`plan.compose` tools.
- Implemented `PlansService.compose()` as a pure transform — generates a `plan_id` via `randomUUID()` and returns the structured `PlanComposeOutput`. No DB write; the BullMQ worker drives the commit flow.
- Added `HouseholdsRepository.findAllActive()` (selects `id, timezone` only — no encrypted fields, so passes `null` KEK).
- Extended `bullmqPlugin.getWorker()` to accept `Partial<WorkerOptions>` (used by the new job for `concurrency: 2`).
- Added `'plan.generation.failed'` to `AUDIT_EVENT_TYPES` and shipped the matching `ALTER TYPE audit_event_type ADD VALUE` migration so the parity test passes.
- Created `apps/api/src/jobs/plan-generation.job.ts` with two BullMQ queues:
  - `plan-generation-schedule` runs `'0 10 * * 5'` UTC; fans out a delayed per-household job that fires at 18:00 local using `getLocalSixPmUtcMs()` (Intl-based, DST-correct).
  - `plan-generation` per-household worker runs `orchestrator.planWeek()` → `buildCommitInput()` → `plansService.commit()`. Concurrency 2; 3 attempts with exponential 5m backoff; idempotent `jobId: plan-gen-${hh.id}-${weekOf}` so scheduler restarts cannot double-generate.
  - Permanent-failure handler (`worker.on('failed')`) writes the `plan.generation.failed` audit row with `attempts`, `error`, and `job_id` for the ops anomaly dashboard.
- Registered `planGenerationJobPlugin` in `app.ts` after `orchestratorHook` + `auditPartitionRotationPlugin`.
- Tests: 11 utility tests (`plan-generation.job.test.ts`) cover `deriveWeekId` determinism, `getNextMondayFrom`, `getLocalSixPmUtcMs` against ET/PT/UTC and the rollover edge case, and `buildCommitInput` flattening with/without `recipe_id`/`item_id`. 6 `planWeek` tests cover happy-path, MAX iterations exhaustion, rejection-context preamble injection, single-iteration exit, `ForbiddenToolCallError` propagation, and `plan.compose` fatal-error rethrow. Updated `orchestrator.test.ts` `buildProvider` mock to stub `completeWithMessages`. Replaced the obsolete `NotImplementedError` test for `PlansService.compose` with two positive tests (deterministic shape + non-memoized plan_id).
- SSE `plan.updated` emission deferred to Story 5.2 — logged at debug level with `household_id` and `weekId` so the integration point exists.
- All my new tests pass (11 + 6 + 2). Pre-existing failures noted in Debug Log are out of scope.

### File List

**New files:**
- `apps/api/src/jobs/plan-generation.job.ts`
- `apps/api/src/jobs/plan-generation.job.test.ts`
- `apps/api/src/agents/orchestrator.planweek.test.ts`
- `supabase/migrations/20260620000200_add_plan_generation_failed_audit_type.sql`

**Modified files:**
- `packages/contracts/src/plan.ts`
- `packages/contracts/src/plan.test.ts`
- `packages/types/src/index.ts`
- `apps/api/src/agents/orchestrator.ts`
- `apps/api/src/agents/orchestrator.test.ts`
- `apps/api/src/agents/providers/llm-provider.interface.ts`
- `apps/api/src/agents/providers/openai.adapter.ts`
- `apps/api/src/agents/providers/anthropic.adapter.ts`
- `apps/api/src/agents/tools/plan.tools.test.ts`
- `apps/api/src/modules/plans/plans.service.ts`
- `apps/api/src/modules/plans/plans.service.test.ts`
- `apps/api/src/modules/households/households.repository.ts`
- `apps/api/src/plugins/bullmq.plugin.ts`
- `apps/api/src/audit/audit.types.ts`
- `apps/api/src/types/fastify.d.ts`
- `apps/api/src/app.ts`

### Review Findings

- [x] [Review][Decision] `attempts: 3` semantics vs AC3 "3 retries" — resolved: keep `attempts: 3` (2 retries); inline comment documents the choice; 5m → 10m backoff accepted as sufficient for transient failures. [AC3] [`apps/api/src/jobs/plan-generation.job.ts:GENERATION_JOB_OPTS`]

- [x] [Review][Patch] `generationWorker.on('failed')` fires on every BullMQ attempt, not only permanent failure — fixed: added `if (job.attemptsMade < maxAttempts) return;` guard; corrected comment. [`apps/api/src/jobs/plan-generation.job.ts:generationWorker.on('failed')`]

- [x] [Review][Patch] `PlanComposeOutputSchema.days` missing `.min(1)` — fixed: changed to `z.array(PlanComposeDaySchema).min(1)` to match input schema constraint. [`packages/contracts/src/plan.ts:PlanComposeOutputSchema`]

- [x] [Review][Patch] `m.toolCallId ?? ''` sends empty `tool_call_id` to OpenAI — fixed: replaced fallback with an explicit `throw new Error(...)` when `toolCallId` is missing on a tool message. [`apps/api/src/agents/providers/openai.adapter.ts:buildMessagesFromLLM`]

- [x] [Review][Patch] `void fastify.auditService.write(...)` in `failed` handler unhandled rejection — fixed: replaced `void` fire-and-forget with `.catch(err => fastify.log.error(...))`. [`apps/api/src/jobs/plan-generation.job.ts:generationWorker.on('failed')`]

- [x] [Review][Defer] `getNextMondayFrom(now)` wrong `week_of` if fan-out fires on Saturday — scheduler `0 10 * * 5` UTC with `backoff: { delay: 60_000 }` retries within minutes; reaching Saturday requires a >14h outage. [`apps/api/src/jobs/plan-generation.job.ts:getNextMondayFrom`] — deferred, requires extreme scheduler outage
- [x] [Review][Defer] Far-east timezones (UTC+9+) trigger Saturday plan generation not Friday — `getLocalSixPmUtcMs` +24h fallback when 18:00 local already past at fan-out time; US beta scope, documented limitation. [`apps/api/src/jobs/plan-generation.job.ts:getLocalSixPmUtcMs`] — deferred, known beta limitation
- [x] [Review][Defer] Inner tool-call loop doesn't break after `plan.compose` captured within same turn — sibling tools in the same response still execute before the outer loop exits. [`apps/api/src/agents/orchestrator.ts:planWeek`] — deferred, low risk in practice
- [x] [Review][Defer] `PlanComposeOutputSchema.parse(result)` ZodError not inside the per-tool try/catch — propagates to BullMQ job failure and triggers a retry; acceptable behavior. [`apps/api/src/agents/orchestrator.ts:planWeek`] — deferred, BullMQ retry handles it
- [x] [Review][Defer] `rejectionContext` filter excludes `verdict !== 'blocked'` guardrail conflicts — verify GuardrailResult type for 'warning' variant; retry prompt may be incomplete. [`apps/api/src/jobs/plan-generation.job.ts:commit callback`] — deferred, verify GuardrailResult shape
- [x] [Review][Defer] `_requestId` accepted but unused in `buildCommitInput()` signature — `requestId` flows to `plansService.commit()` separately; no data loss. [`apps/api/src/jobs/plan-generation.job.ts:buildCommitInput`] — deferred, cosmetic
- [x] [Review][Defer] Fan-out `Promise.allSettled` logs failure count only — individual household IDs and error messages lost; operators cannot identify failed households. [`apps/api/src/jobs/plan-generation.job.ts:fan-out worker`] — deferred, observability improvement
- [x] [Review][Defer] `PlanComposeDaySchema` allows duplicate `day` entries — no uniqueness constraint; LLM can return two Monday entries that both commit. [`packages/contracts/src/plan.ts:PlanComposeDaySchema`] — deferred, schema validation gap
- [x] [Review][Defer] `parseInt(hour, 10)` may return 24 at midnight in some ICU builds — probe is at noon local, midnight unreachable in normal operation. [`apps/api/src/jobs/plan-generation.job.ts:getLocalSixPmUtcMs`] — deferred, extremely low risk
- [x] [Review][Defer] `Date.now()` inside per-household delay loop vs stable `now` reference — sub-second drift at beta scale, negligible. [`apps/api/src/jobs/plan-generation.job.ts:fan-out worker`] — deferred, cosmetic

### Change Log

| Date | Change | Author |
|---|---|---|
| 2026-05-02 | Story 3.7 created — ready-for-dev | bmad-create-story |
| 2026-05-02 | Story 3.7 implemented — plan-generation BullMQ job, planWeek agentic loop, contract + audit-enum changes; status → review | claude-opus-4-7 |
| 2026-05-02 | Code review complete — 1 decision-needed, 4 patches, 10 deferred, 9 dismissed | bmad-code-review |
