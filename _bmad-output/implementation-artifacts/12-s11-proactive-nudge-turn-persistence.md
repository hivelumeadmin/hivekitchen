# Story 12-S11: Proactive Nudge — Turn Persistence (Rate-Limited)

Status: done

## Story

As a parent using HiveKitchen,
I want Lumi to proactively reach out when something important happens (plan ready, allergen flagged),
so that I notice it the next time I open the panel without having to ask.

## Acceptance Criteria

1. **Given** a plan-generation job completes successfully for a household, **When** the job's commit step succeeds, **Then** within ~5 seconds an async nudge job is enqueued and processed: `LumiAgent.generateNudge()` is called with `trigger: 'plan_completed'` and the household snapshot + a brief plan context summary; the resulting text is persisted as a `lumi` role turn in the household's active `brief` surface ambient thread (lazy-created if none exists), with `nudge_trigger = 'plan_completed'` recorded in the `thread_turns.nudge_trigger` column.

2. **Given** the nudge turn was just persisted, **When** the Redis key `lumi:nudge:household:{householdId}` does NOT exist, **Then** the key is set with a 30-minute TTL (`SET NX EX 1800`). If the key already exists (rate-limited window), it is NOT reset.

3. **Given** the nudge is persisted, **When** the user opens the Lumi panel on the `brief` surface, **Then** the nudge turn appears in the panel thread (it is a normal `lumi` turn fetched by the existing GET `/v1/lumi/threads/:threadId/turns` endpoint).

4. **Given** a second nudge event fires within 30 minutes for the same household, **When** the job runs, **Then** the second nudge turn IS persisted (persistence is unconditional), but the Redis rate-limit key is NOT reset (the orb signal in S12 will be suppressed by the key still being present).

5. **Given** the plan-generation job succeeds but the nudge enqueue or processing fails (OpenAI error, Redis error, DB error), **Then** the plan delivery is NOT affected — the nudge is fire-and-forget with per-turn error logging only.

6. **Given** a `NudgeTrigger` type is defined in `@hivekitchen/contracts` as `z.enum(['plan_completed', 'meal_rating_received', 'allergen_flagged', 'evening_checkin_completed'])`, **Then** the nudge job data uses this contract type for its `trigger` field.

7. **Given** the nudge persisted to an ambient thread, **When** the nudge thread is fetched via GET `/v1/lumi/threads/:threadId/turns`, **Then** the nudge turn is returned as a normal Turn object (its `nudge_trigger` DB column is NOT included in the API response — it is internal traceability only).

## Tasks / Subtasks

- [x] Task 1 — DB migration: `nudge_trigger` column on `thread_turns` (AC: #1, #7)
  - [x] Create `supabase/migrations/20261016000000_thread_turns_nudge_trigger.sql`
  - [x] `ALTER TABLE thread_turns ADD COLUMN nudge_trigger TEXT NULL;`
  - [x] No index needed (write-only traceability at MVP)
  - [x] No contract/types change needed — `nudge_trigger` is API-internal, NOT in the `Turn` schema

- [x] Task 2 — Contract: `NudgeTrigger` in `packages/contracts/src/lumi.ts` (AC: #6)
  - [x] Add `NudgeTriggerSchema` and `NudgeTrigger` type:
    ```ts
    export const NudgeTriggerSchema = z.enum([
      'plan_completed',
      'meal_rating_received',
      'allergen_flagged',
      'evening_checkin_completed',
    ]);
    export type NudgeTrigger = z.infer<typeof NudgeTriggerSchema>;
    ```
  - [x] Re-export `NudgeTrigger` from `packages/types/src/index.ts` (add `export type { NudgeTrigger }` to the lumi type re-exports)
  - [x] Add a round-trip contract test: `NudgeTriggerSchema.parse('plan_completed')` accepts all 4 values + rejects unknown strings
  - [x] **No** other contracts changes — `LumiNudgeEventSchema` already exists in lumi.ts (Story 12.11 pre-populated it); the `turn: Turn` field in that schema does NOT include `nudge_trigger`

- [x] Task 3 — `LumiRepository.insertTurn()`: accept optional `nudge_trigger` (AC: #1, #7)
  - [x] Extend `insertTurn()` input to accept `nudgeTrigger?: string`:
    ```ts
    async insertTurn(input: {
      threadId: string;
      role: 'user' | 'lumi' | 'system';
      body: TurnBody;
      modality: 'text' | 'voice';
      nudgeTrigger?: string;   // NEW — stored in thread_turns.nudge_trigger, not returned in Turn
    }): Promise<Turn>
    ```
  - [x] When `nudgeTrigger` is provided, include `nudge_trigger: input.nudgeTrigger` in the `.insert({...})` payload
  - [x] The return type (`Turn`) remains unchanged — `nudge_trigger` is NOT in `TURN_COLUMNS` select
  - [x] No changes to `mapRowToTurn()` — the column is write-only from the application perspective

- [x] Task 4 — `LumiAgent.generateNudge()`: one-shot proactive message (AC: #1)
  - [x] Add to `apps/api/src/agents/lumi.agent.ts`:
    ```ts
    export interface LumiAgentGenerateNudgeInput {
      trigger: NudgeTrigger;
      surface: LumiSurface;
      householdSnapshot: string;
      planContext?: string; // brief text summary of the plan (for plan_completed trigger)
    }
    ```
  - [x] Add `async generateNudge(input: LumiAgentGenerateNudgeInput): Promise<string>` method:
    - System prompt: `LUMI_BASE_PERSONA` + `getSurfacePrompt(input.surface)` + household snapshot block (same pattern as `buildSystemPrompt` in `respond()`)
    - Add a nudge-generation instruction block at end of system prompt:
      ```
      # Proactive Nudge
      You are about to send a proactive message — the user did NOT ask a question.
      Trigger: {trigger}
      {planContext if provided}
      Write ONE short, warm message (max 2 sentences) referencing what just happened.
      Speak as Lumi; be specific to this family. Do not ask a question.
      ```
    - User message: `"What's your proactive message?"` (single synthetic turn to elicit the response)
    - Same model/tokens/temperature as `respond()`: `gpt-4o`, `max_tokens: 150`, `temperature: 0.7`
    - Return `completion.choices[0]?.message?.content ?? LUMI_FALLBACK_REPLY`
  - [x] Import `NudgeTrigger` from `@hivekitchen/types` in `lumi.agent.ts`

- [x] Task 5 — `LumiService.persistNudge()`: fetch snapshot, call agent, persist turn, set Redis gate (AC: #1, #2, #4, #5)
  - [x] Add `persistNudge(input: { householdId: string; trigger: NudgeTrigger; surface: LumiSurface; planContext?: string; }): Promise<Turn>` to `LumiService`
  - [x] Implementation:
    ```ts
    async persistNudge(input: { householdId, trigger, surface, planContext? }): Promise<Turn> {
      // 1. Fetch household snapshot (same path as submitTextTurn)
      const householdSnapshot = await this.fetchHouseholdSnapshot(input.householdId);

      // 2. Find or lazy-create the surface ambient thread (same path as submitTextTurn)
      const existing = await this.repository.findActiveAmbientThread(input.householdId, input.surface);
      const thread = existing ?? await this.repository.createAmbientThread(input.householdId, input.surface, 'text');

      // 3. Generate nudge text via LumiAgent
      const agent = new LumiAgent(this.openai);
      const nudgeText = await agent.generateNudge({
        trigger: input.trigger,
        surface: input.surface,
        householdSnapshot,
        planContext: input.planContext,
      });

      // 4. Persist the nudge as a lumi turn (with nudge_trigger traceability)
      const turn = await this.repository.insertTurn({
        threadId: thread.id,
        role: 'lumi',
        body: { type: 'message', content: nudgeText },
        modality: 'text',
        nudgeTrigger: input.trigger,   // stored in thread_turns.nudge_trigger
      });

      // 5. Redis rate-limit gate — SET NX EX 1800 (30 min). S12 reads this before SSE emission.
      //    Always fires; best-effort (error logged but not thrown).
      try {
        await this.redis.set(
          `lumi:nudge:household:${input.householdId}`,
          '1',
          'EX', 1800,
          'NX',   // SET only if NOT exists — do not reset a live rate-limit window
        );
      } catch (err) {
        this.logger.warn(
          { err, module: 'lumi', action: 'lumi.nudge_redis_gate_failed', household_id: input.householdId },
          'redis nudge gate SET failed — non-fatal, S12 SSE will skip rate-limit check',
        );
      }

      return turn;
    }
    ```
  - [x] `persistNudge` MUST NOT throw — wrap the whole body in a try/catch; log errors and return gracefully (caller is fire-and-forget)
    - Actually: the method MAY throw; the caller (`runLumiNudge` in the job) wraps in its own try/catch. Don't double-wrap in the service method — keep it direct.

- [x] Task 6 — `lumi-nudge.job.ts`: async BullMQ worker (AC: #1, #2, #4, #5)
  - [x] Create `apps/api/src/jobs/lumi-nudge.job.ts`
  - [x] Queue name constant: `NUDGE_QUEUE = 'lumi-nudge'`
  - [x] Job data type:
    ```ts
    export interface LumiNudgeJobData {
      household_id: string;
      trigger: NudgeTrigger;
      surface: LumiSurface;
      plan_context?: string;  // optional text summary for plan_completed
    }
    ```
  - [x] Extract testable function: `export async function runLumiNudge(deps: LumiNudgeDeps, data: LumiNudgeJobData): Promise<void>`
    ```ts
    export interface LumiNudgeDeps {
      lumiService: LumiService;
      logger: FastifyBaseLogger;
    }
    ```
    - Calls `deps.lumiService.persistNudge({ householdId: data.household_id, trigger: data.trigger, surface: data.surface, planContext: data.plan_context })`
    - On success: logs `{ action: 'lumi.nudge.persisted', household_id, trigger }`
    - Catch block: logs error at `warn` level (not `error` — nudge failure is non-critical); does NOT re-throw (BullMQ will NOT retry on caught exceptions; this is intentional — nudge turns are fire-and-forget at MVP)
    - Wrap in try/catch and swallow: nudge delivery failure MUST NOT surface as a BullMQ job failure
  - [x] `lumiNudgeJobPlugin: FastifyPluginAsync` — plugin factory:
    - Constructs LumiService (using same dep-construction pattern as `lumi.routes.ts` — see reference below)
    - No BullMQ scheduler (on-demand jobs only, not scheduled)
    - Registers worker: `fastify.bullmq.getWorker(NUDGE_QUEUE, async (job) => { await runLumiNudge({ lumiService, logger: fastify.log }, job.data) })`
    - `concurrency: 5` (nudges can run in parallel)
    - Error does NOT propagate out of the worker callback (already caught in `runLumiNudge`)
  - [x] Export `lumiNudgeJobPlugin` as named export + `fp()` wrapped for fastify-plugin encapsulation
  - [x] **Dep-construction pattern for LumiService in the job** (mirrors `lumi.routes.ts:43-55`):
    ```ts
    const kekHex = fastify.env.ENVELOPE_ENCRYPTION_MASTER_KEY;
    const kek = kekHex ? Buffer.from(kekHex, 'hex') : null;
    const childAllergensRepository = new ChildAllergensRepository(fastify.supabase, kek);
    const childrenRepository = new ChildrenRepository(fastify.supabase, kek, fastify.log, childAllergensRepository);
    const householdAllergensRepository = new HouseholdAllergensRepository(fastify.supabase, kek);
    const repository = new LumiRepository(fastify.supabase);
    const lumiService = new LumiService({
      repository, redis: fastify.redis, logger: fastify.log,
      elevenLabsApiKey: fastify.env.ELEVENLABS_API_KEY,
      voiceId: fastify.env.ELEVENLABS_VOICE_ID,
      openai: fastify.openai,
      childrenRepository,
      householdAllergensRepository,
    });
    ```

- [x] Task 7 — Wire `plan_completed` hook in `plan-generation.job.ts` (AC: #1, #5)
  - [x] After `fastify.variantProposalService.createFromTreePlanOutput(...)` try/catch block (line ~440), add:
    ```ts
    // Story 12-S11 — proactive nudge: fire-and-forget enqueue after plan commit.
    // The nudge job generates a Lumi turn in the household's brief-surface thread.
    // Failure must not affect plan delivery — enqueue is best-effort.
    try {
      const planContext = buildPlanNudgeContext(lastAttemptComposeOutput, week_of);
      await fastify.bullmq
        .getQueue(NUDGE_QUEUE)
        .add('plan_completed', {
          household_id,
          trigger: 'plan_completed' as const,
          surface: 'brief',
          plan_context: planContext,
        } satisfies LumiNudgeJobData);
    } catch (err) {
      fastify.log.warn(
        { err, module: 'plan-generation', action: 'lumi.nudge_enqueue_failed', household_id },
        'lumi nudge enqueue failed — plan is committed, nudge silently skipped',
      );
    }
    ```
  - [x] Import `NUDGE_QUEUE` and `LumiNudgeJobData` from `lumi-nudge.job.js`
  - [x] Add helper `buildPlanNudgeContext(output: PlanComposeTreeOutput, weekOf: string): string`:
    - Returns a short human-readable plan summary (1–2 lines): "Week of [weekOf]. Mains: [main1], [main2], [main3]."
    - Extracts `output.main_assignments` (array of `{ recipe_id, canonical_name? }`) or equivalent from the tree shape
    - If `canonical_name` is unavailable, use fallback "new meal" — the nudge still fires
    - Max 200 chars — trim to prevent runaway context

- [x] Task 8 — Register `lumiNudgeJobPlugin` in `app.ts` (AC: #1)
  - [x] Import and register `lumiNudgeJobPlugin` in `apps/api/src/app.ts` after the existing job registrations (after `accountDeletionJobPlugin`)
  - [x] Requires: `supabase`, `redis`, `openai`, `bullmq`, `env` — same as other job plugins

- [x] Task 9 — Tests (AC: all)
  - [x] `packages/contracts/src/lumi.test.ts` or equivalent — add `NudgeTriggerSchema` round-trip tests (+4 valid + 1 invalid = 5 cases)
  - [x] `apps/api/src/agents/lumi.agent.test.ts` — add `generateNudge()` test suite:
    - Test: returns a string (mocked OpenAI completion)
    - Test: passes household snapshot and planContext into the system prompt (spy on `openai.chat.completions.create`)
    - Test: returns `LUMI_FALLBACK_REPLY` when OpenAI returns null content
    - (+3 tests)
  - [x] `apps/api/src/modules/lumi/lumi.repository.test.ts` — add nudge_trigger insert test:
    - Test: `insertTurn()` with `nudgeTrigger` includes the column in the insert payload
    - Test: `insertTurn()` without `nudgeTrigger` does NOT include the column (undefined not sent)
    - (+2 tests)
  - [x] `apps/api/src/modules/lumi/lumi.service.test.ts` — add `persistNudge()` test suite:
    - Test: calls `findActiveAmbientThread` then `generateNudge` then `insertTurn` with `nudgeTrigger`
    - Test: calls `redis.set(key, '1', 'EX', 1800, 'NX')` after inserting the turn
    - Test: does NOT throw when `redis.set` fails (warning logged, turn still returned)
    - Test: creates ambient thread when none exists (lazy creation path)
    - (+4 tests)
  - [x] `apps/api/src/jobs/lumi-nudge.job.test.ts` — new file:
    - Test: `runLumiNudge` calls `lumiService.persistNudge` with correct args
    - Test: `runLumiNudge` swallows `persistNudge` error (does not throw)
    - Test: `runLumiNudge` logs warn on error
    - (+3 tests)
  - [x] **No web tests, no E2E tests** — this is a pure API story; the nudge turn is visible via the existing GET `/v1/lumi/threads/:threadId/turns` endpoint

## Dev Notes

### Architecture: Why a Separate BullMQ Queue?

The nudge involves an OpenAI API call (`generateNudge()`). Making that call synchronously inside the plan-generation job worker would add ~1-3s latency to every plan commit — unacceptable. A separate `lumi-nudge` queue decouples the nudge entirely. The plan-generation job only enqueues a small message (< 1KB); the actual LLM call happens in the nudge worker.

This follows the same pattern as `data-export.job.ts` (enqueued by routes) and `plan-regeneration.job.ts` (enqueued by PlansService).

### LumiService Not Decorated on Fastify

Unlike PlansService (which IS `fastify.plansService`), `LumiService` is currently instantiated inside the encapsulated `lumiRoutes` plugin scope. It is NOT available on the fastify instance globally. The `lumi-nudge.job.ts` constructs its own `LumiService` instance using the same pattern as `lumi.routes.ts` (lines 43–55). Do NOT add a global `fastify.lumiService` decorator — the encapsulated pattern is intentional.

### `thread_turns.nudge_trigger` — DB Only, Not in Turn Contract

The `nudge_trigger` column is write-only traceability. It is:
- Written at insert time (via `nudgeTrigger` on `insertTurn()`)
- NOT in `TURN_COLUMNS` (the select string in `thread.repository.ts`)
- NOT in the `Turn` Zod schema (`packages/contracts/src/thread.ts`)
- NOT returned by GET `/v1/lumi/threads/:threadId/turns`

The client determines a turn is a nudge via the S12 SSE event (`type: 'lumi.nudge'`), not by inspecting `Turn` fields. The `LumiNudgeEventSchema` (already in `packages/contracts/src/lumi.ts`) is the right mechanism for that — S12 uses it.

### Redis Rate-Limit Key — S11 Sets It, S12 Reads It

The Redis key `lumi:nudge:household:{householdId}` with 30-min TTL:
- **S11** (this story): `SET NX EX 1800` after persisting the nudge — set only if not already set
- **S12** (next story): Check if key exists before emitting the SSE `lumi.nudge` event; if the key exists, suppress the SSE emission (orb stays calm); if it doesn't, emit SSE + set the key

This design means:
- The first nudge in 30 min: turn persists + key is set + (in S12) SSE fires
- Subsequent nudges within 30 min: turns persist (always) + key already set + (in S12) SSE suppressed

In S11 we only implement the "set" side. Do NOT add SSE emission — that's S12's job.

### Redis `SET NX EX` Syntax (ioredis)

ioredis supports the multi-arg form:
```ts
await this.redis.set('key', '1', 'EX', 1800, 'NX');
// EX = expire in seconds; NX = only set if not exists
```
This is an atomic operation. If the key already exists (`NX` fails), the SET is a no-op and ioredis returns `null` (not an error). Do NOT check the return value — we don't branch on it in S11.

### `buildPlanNudgeContext()` — Extracting Main Names

`PlanComposeTreeOutput.main_assignments` is an array of objects. Each assignment has at minimum a `recipe_id`. It may have `canonical_name` if the recipe was resolved from the catalog. Use a defensive approach:
```ts
function buildPlanNudgeContext(output: PlanComposeTreeOutput, weekOf: string): string {
  const mains = (output.main_assignments ?? [])
    .slice(0, 3)
    .map((a) => (a as { canonical_name?: string }).canonical_name ?? 'a new meal')
    .join(', ');
  return `Week of ${weekOf}. Mains: ${mains}`.slice(0, 200);
}
```
If `main_assignments` is empty or undefined, returns `"Week of {weekOf}."` — still a valid context.

Check `packages/types/src/index.ts` for the `PlanComposeTreeOutput` type to verify the exact field names. Import `PlanComposeTreeOutput` from `@hivekitchen/types`.

### `generateNudge()` System Prompt Design

The nudge prompt differs from `respond()` in one key way: it is a proactive message, not a reply. The user synthetic message is `"What's your proactive message?"` — this avoids an empty user turn which some models handle poorly.

The nudge instruction block appended to the system prompt:
```
# Proactive Nudge
You are about to send a proactive message to the family. The user did NOT ask a question.
Trigger: plan_completed
Plan context: Week of 2026-10-14. Mains: Dal-rice, Khichdi, Pasta.
Write ONE short, warm sentence (max 25 words). Reference a specific dish or child if possible.
Speak as Lumi. Do not ask a question. Do not start with "I".
```

The `max_tokens: 150` limit (vs `400` for `respond()`) keeps the nudge brief and cost-effective.

### `TURN_COLUMNS` in `thread.repository.ts` — Do Not Modify

The `TURN_COLUMNS` constant defines what columns are SELECTed when reading turns. `nudge_trigger` must NOT be added to it. The column is inserted but not read back via the application layer. Adding it to `TURN_COLUMNS` would:
1. Require adding it to the `Turn` contract
2. Expose internal metadata to the client
3. Break the existing `mapRowToTurn()` function

If you ever need to read `nudge_trigger` for analytics, do it via a separate raw SQL query outside the `TurnRow` shape.

### Existing `LumiNudgeEventSchema` in Contracts

`packages/contracts/src/lumi.ts` line 79–84 already defines:
```ts
export const LumiNudgeEventSchema = z.object({
  type: z.literal('lumi.nudge'),
  turn: Turn,
  surface: LumiSurfaceSchema,
});
```
This contract is NOT used in S11 — it's S12's SSE event schema. Do NOT import or reference it in S11 implementation. Do NOT delete or modify it.

### `NudgeTrigger` Type — Where to Add It

Add to `packages/contracts/src/lumi.ts` (not a new file) alongside the existing `LumiNudgeEventSchema`. Add the `NudgeTrigger` type export to `packages/types/src/index.ts` in the lumi section (add `export type { ..., NudgeTrigger } from './lumi.js'` or equivalent).

### Zod 4 Warning (Standing Note from 12-S9)

The project uses Zod 4, not 3.23 as `project-context.md` claims. For `z.enum()` with a fixed list of strings: Zod 4's API is compatible here — `z.enum(['a', 'b'])` works the same way.

### hkFetch Double-Encoding (Not Applicable Here)

This story has no web changes. The hkFetch double-encoding trap (from S9/S10) does not apply.

### Test Baseline (Post 12-S9 + 12-S9 Review Patches)

From `sprint-status.yaml` (12-S9 done state):
- **API**: 1617 pass / 20 fail / 13 skip (documented pre-existing baseline — see 12-S9 done note)
- **contracts**: lumi 48/48 (no breaking contract changes in S9)
- **web**: 484/484 (from 12-S10 review patches; not relevant to this story — no web changes)

Expected delta for this story:
- API: +12–15 new tests across lumi.agent, lumi.repository, lumi.service, lumi-nudge.job, contracts
- Web: 0 new tests (no web changes)
- Contracts: +5 NudgeTriggerSchema tests

### Deferred (S12)

The following are explicitly OUT OF SCOPE for S11:
- SSE `lumi.nudge` emission on the household channel (S12)
- Orb breathing / glowing animation (S12)
- `notification_prefs.proactive_lumi_nudges` opt-out toggle (S12)
- Skipping `generateNudge()` when the user has opted out (S12 check will be in the job or the service)

### Deferred (Post-S12)

- `meal_rating_received` hook — wire at the emoji-rating mutation in `apps/api/src/modules/lunch-link/lunch-link.routes.ts` (`PATCH /v1/lunch-link/:token/rate` or equivalent). NOT blocked on S12.
- `allergen_flagged` hook — wire in plan-generation job's guardrail-rejection path OR in `AllergyGuardrailService` when it logs `planner.guardrail.blocked`. NOT blocked on S12.
- `evening_checkin_completed` hook — Evening Check-in feature (Epic 5 5-S3/5-S7) not yet built.

### File Structure

**New files:**
- `supabase/migrations/20261016000000_thread_turns_nudge_trigger.sql`
- `apps/api/src/jobs/lumi-nudge.job.ts`
- `apps/api/src/jobs/lumi-nudge.job.test.ts`

**Modified files:**
- `packages/contracts/src/lumi.ts` — add `NudgeTriggerSchema` + `NudgeTrigger` type
- `packages/types/src/index.ts` — re-export `NudgeTrigger`
- `apps/api/src/agents/lumi.agent.ts` — add `generateNudge()` method + `LumiAgentGenerateNudgeInput` interface
- `apps/api/src/agents/lumi.agent.test.ts` — add `generateNudge()` tests
- `apps/api/src/modules/lumi/lumi.repository.ts` — extend `insertTurn()` with optional `nudgeTrigger`
- `apps/api/src/modules/lumi/lumi.repository.test.ts` — add `nudgeTrigger` insert tests (verify the mock captures the column)
- `apps/api/src/modules/lumi/lumi.service.ts` — add `persistNudge()` method
- `apps/api/src/modules/lumi/lumi.service.test.ts` — add `persistNudge()` tests
- `apps/api/src/jobs/plan-generation.job.ts` — fire-and-forget nudge enqueue after commit
- `apps/api/src/app.ts` — register `lumiNudgeJobPlugin`
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — status tracking

**No changes to:**
- `packages/contracts/src/thread.ts` — `Turn` schema unchanged (`nudge_trigger` is DB-only)
- `apps/web/src/**` — no web changes
- `apps/api/src/modules/lumi/lumi.routes.ts` — routes unchanged
- `apps/api/src/modules/lumi/lumi.service.ts` existing methods — `submitTextTurn()` unchanged

### References

- [Source: `_bmad-output/planning-artifacts/epic-12-vertical-slices.md` §Slice 12-S11] — demo path, layers, rate-limit design
- [Source: `apps/api/src/agents/lumi.agent.ts`] — `LumiAgent.respond()` pattern to mirror for `generateNudge()`
- [Source: `apps/api/src/agents/prompts/lumi-base.prompt.ts`] — `LUMI_BASE_PERSONA` constant
- [Source: `apps/api/src/modules/lumi/lumi.service.ts`] — `submitTextTurn()` pattern (snapshot fetch + thread lazy-create + insert)
- [Source: `apps/api/src/modules/lumi/lumi.repository.ts`] — `insertTurn()` for extension; `findActiveAmbientThread()` + `createAmbientThread()`
- [Source: `apps/api/src/jobs/plan-generation.job.ts`] — best-effort post-commit pattern (variantProposalService.createFromTreePlanOutput ~line 424–440); hook point is ~line 463 after `fastify.log.info('plan-generation job completed...')`
- [Source: `apps/api/src/jobs/lumi-nudge.job.ts` (new)] — mirrors `data-export.job.ts` and `account-deletion.job.ts` BullMQ worker patterns
- [Source: `apps/api/src/modules/lumi/lumi.routes.ts` lines 43–55] — LumiService dep-construction to replicate in the job
- [Source: `packages/contracts/src/lumi.ts`] — `LumiNudgeEventSchema` (S12 contract, do not touch); `LumiSurfaceSchema` for `surface: 'brief'`
- [Source: `apps/api/src/app.ts`] — job plugin registration order (register after `accountDeletionJobPlugin`)
- [Source: `apps/api/src/modules/threads/thread.repository.ts`] — `TURN_COLUMNS` (do NOT add `nudge_trigger` here)
- [Source: `_bmad-output/implementation-artifacts/12-s10-tap-to-talk-voice-browser-direct.md` §Dev Notes] — Zod 4 gotchas, test baseline after 12-S9 review patches

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (1M context)

### Completion Notes List

- **All 9 tasks / 7 ACs implemented.** Pure API story — no web, no E2E.
- **Stub→real not used.** Single new tool path (one queue, one service method) — the Stub→Real doctrine applies to ≥4 tool calls with separate tables; this is one cohesive nudge path, so direct wiring is cleaner.
- **AC #1/#7 — `nudge_trigger` is write-only.** Migration `20261016000000` adds the nullable TEXT column; `insertTurn()` spreads `nudge_trigger` into the insert payload only when `nudgeTrigger` is supplied. It is NOT in `TURN_COLUMNS`, NOT in the `Turn` contract, and NOT returned by GET `/v1/lumi/threads/:id/turns`. Verified by repository tests (present-when-supplied / absent-when-undefined).
- **AC #2/#4 — Redis gate is `SET NX EX 1800`.** Best-effort (warn-logged, never throws). Persistence is unconditional; the NX form never resets a live 30-min window, so a second nudge persists its turn but leaves the gate intact for S12 to suppress the orb SSE.
- **AC #5 — fire-and-forget.** Two independent guards: the enqueue in `plan-generation.job.ts` is wrapped in try/catch (plan delivery unaffected), and `runLumiNudge` swallows any `persistNudge` error at `warn` (no re-throw → BullMQ does not retry; nudges are not worth retrying).
- **AC #6 — `NudgeTrigger` contract type** added to `packages/contracts/src/lumi.ts` + re-exported from `packages/types`; the job data and agent input both type their `trigger` field with it.
- **`generateNudge()`** mirrors `respond()`'s prompt assembly (base persona → surface → snapshot) plus a `# Proactive Nudge` instruction block; uses a single synthetic user turn (`"What's your proactive message?"`) and a tighter 150-token cap.
- **`LumiService` not decorated globally** — the nudge job constructs its own instance via the `lumi.routes.ts` dep pattern (ADR-002 encapsulation preserved).
- **`buildPlanNudgeContext`** reads `main_assignments` defensively: the contract shape carries only `sequence`+`recipe_id`, so `canonical_name` is read via a widening cast and falls back to "a new meal"; result trimmed to 200 chars.
- **Verification:** new API tests — agent +4, service +4, repository +2 (new file), nudge job +3 (new file); contracts +2 (`NudgeTriggerSchema`). Full API suite: **1631 pass / 20 fail / 13 skip** — the 20 failures are the documented pre-existing baseline (auth, audit-enum, catalog-seed, children.repository, extra-library, households memory, lunch-link-dev, memory.service, plan-adjustment, onboarding.tools) and are all in files this story did not touch. Typecheck: **0 new errors** in changed files (API/contracts/types baselines unchanged; the `heart-notes.ts` Zod-4 contract error and the ~11 API baseline errors pre-date this story).
- **USER-SIDE GATE:** `supabase db push --include-all` (migration `20261016000000_thread_turns_nudge_trigger.sql`) before this runs against a live DB.
- **Deferred to S12 (out of scope):** SSE `lumi.nudge` emission, orb breathing animation, `proactive_lumi_nudges` opt-out. Deferred post-S12: `meal_rating_received` / `allergen_flagged` / `evening_checkin_completed` hooks.

### File List

**New:**
- `supabase/migrations/20261016000000_thread_turns_nudge_trigger.sql`
- `apps/api/src/jobs/lumi-nudge.job.ts`
- `apps/api/src/jobs/lumi-nudge.job.test.ts`
- `apps/api/src/modules/lumi/lumi.repository.test.ts`

**Modified:**
- `packages/contracts/src/lumi.ts` — `NudgeTriggerSchema` + `NudgeTrigger` type
- `packages/contracts/src/lumi.test.ts` — `NudgeTriggerSchema` round-trip tests
- `packages/types/src/index.ts` — import + re-export `NudgeTrigger`
- `apps/api/src/agents/lumi.agent.ts` — `generateNudge()` + `LumiAgentGenerateNudgeInput`
- `apps/api/src/agents/lumi.agent.test.ts` — `generateNudge()` tests
- `apps/api/src/modules/lumi/lumi.repository.ts` — `insertTurn()` optional `nudgeTrigger`
- `apps/api/src/modules/lumi/lumi.service.ts` — `persistNudge()`
- `apps/api/src/modules/lumi/lumi.service.test.ts` — `persistNudge()` tests + `generateNudge` mock
- `apps/api/src/jobs/plan-generation.job.ts` — `buildPlanNudgeContext()` + fire-and-forget nudge enqueue
- `apps/api/src/app.ts` — register `lumiNudgeJobPlugin`
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — status tracking

### Review Findings

- [ ] [Review][Decision] D1 — S10 web changes present in S11 diff — `apps/web/src/components/LumiOrb.tsx`, `LumiPanel.tsx`, `routes/(app)/layout.tsx`, and their tests contain changes labeled "Story 12-S10" in code comments. The S11 spec explicitly prohibits any `apps/web/src/**` changes. These appear to be S10 (tap-to-talk voice) implementation committed alongside S11. Decision needed: are these S10 changes already reviewed/committed, or do they need their own code-review pass under the 12-S10 story spec?
- [x] [Review][Patch] P1 — `nudgeTrigger` typed as `string` not `NudgeTrigger` in `LumiRepository.insertTurn()` interface [apps/api/src/modules/lumi/lumi.repository.ts:135] — fixed: import + type changed to `NudgeTrigger`
- [x] [Review][Patch] P2 — `generateNudge` prompt instruction block deviates from spec Dev Notes: missing "Do not start with 'I'" constraint, "max 25 words" dropped and replaced with "max 2 sentences", spec's "Write ONE short, warm sentence" vs implementation's "message" [apps/api/src/agents/lumi.agent.ts:88-93] — fixed: aligned to spec wording
- [x] [Review][Defer] W1 — Unbounded `householdSnapshot` injected into LLM prompt with no length cap [apps/api/src/agents/lumi.agent.ts:67] — deferred, pre-existing pattern shared with respond()
- [x] [Review][Defer] W2 — `planContext` injected into system prompt without sanitisation (prompt injection risk from canonical_name data) [apps/api/src/agents/lumi.agent.ts:83] — deferred, mirrors respond() householdSnapshot injection pattern
- [x] [Review][Defer] W3 — Redis rate-limit key `lumi:nudge:household:{id}` lacks surface discriminator; future multi-surface nudges within 30 min will be incorrectly suppressed [apps/api/src/modules/lumi/lumi.service.ts:254] — deferred, intentional single-surface (brief) at MVP
- [x] [Review][Defer] W4 — `buildPlanNudgeContext` silently degrades to "Week of {weekOf}." when `main_assignments` is empty after a surgical swap — non-critical but nudge loses plan context [apps/api/src/jobs/plan-generation.job.ts:118-126] — deferred, pre-existing
- [x] [Review][Defer] W5 — `fetchHouseholdSnapshot` for a deleted household returns empty arrays without error; nudge turn persists against an orphaned household thread — deferred, plan-generation would fail earlier for a deleted household; low risk at MVP
- [x] [Review][Defer] W6 — `createAmbientThread` race-unresolvable error is swallowed by `runLumiNudge` with no distinguishing `action` log field, making concurrent-nudge failures invisible in ops dashboards — deferred, pre-existing repository retry handles normal concurrent case; unresolvable double-fail is rare at MVP
- [x] [Review][Defer] W7 — Contract test for `NudgeTriggerSchema` uses 2 `it`-blocks (one iterating all 4 values) vs spec's stated 5 discrete cases — deferred, functionally equivalent coverage

## Change Log

| Date       | Change                                                                               |
|------------|--------------------------------------------------------------------------------------|
| 2026-06-06 | Story 12-S11 authored: Proactive nudge turn persistence. BullMQ `lumi-nudge` queue, `LumiAgent.generateNudge()`, `LumiService.persistNudge()`, `thread_turns.nudge_trigger` migration, `NudgeTrigger` contract type, plan_completed hook in plan-generation job. No web changes. |
| 2026-06-06 | Story 12-S11 implemented: all 9 tasks / 7 ACs. New migration + `lumi-nudge.job.ts` (on-demand worker, concurrency 5) + 2 new test files; modified contracts/types/agent/service/repository/plan-generation/app. +14 new API tests + 2 contract tests; full API suite 1631 pass / 20 fail (pre-existing baseline) / 13 skip; 0 new typecheck errors. Status → review. |
| 2026-06-06 | Code review: 3-layer adversarial (Blind Hunter inline, Edge Case Hunter via project reads, Acceptance Auditor). 1 decision-needed (D1 web scope), 2 patches (P1 type safety, P2 prompt spec), 7 deferred, 6 dismissed. |
