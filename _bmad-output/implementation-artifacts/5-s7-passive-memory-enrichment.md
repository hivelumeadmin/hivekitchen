# Story 5-S7: Passive Memory Enrichment

Status: done

<!-- folds: 5.11 -->
<!-- cited PRD: FR59, AR-7 -->
<!-- slice source: _bmad-output/planning-artifacts/epic-5-vertical-slices.md §"Slice 5-S7" -->

## Story

As a parent having a conversation with Lumi,
I want conversational signals (cultural events, food rhythms, observations) to be automatically captured in Visible Memory,
so that Lumi builds a richer picture of our family over time without me having to explicitly declare it.

---

## ⚠️ READ FIRST — Scope reconciliation

The epic description says "LumiAgent invokes `memory.note` agent tool when enrichment signals detected." In the current codebase:

- **`LumiAgent.respond()` is a single-shot OpenAI completion with NO tool calling** — it calls `openai.chat.completions.create()` with no `tools` parameter (see `apps/api/src/agents/lumi.agent.ts:47`).
- **`memory.note` tool spec exists** in `TOOL_MANIFEST` as a stub (`apps/api/src/agents/tools.manifest.ts:84`) and `createMemoryNoteSpec()` is in `apps/api/src/agents/tools/memory.tools.ts` — but these are wired only for `DomainOrchestrator.planWeek`, not for the ambient text/voice path.
- **`MemoryService.noteFromAgent()` already exists** and is fully functional (`apps/api/src/modules/memory/memory.service.ts:288`).

**What this slice ships:** A post-reply extraction pass wired into `LumiService.submitTextTurn()`. After Lumi's reply is committed to the thread, a best-effort background call to OpenAI extracts memory-worthy signals from the exchange and writes them via `MemoryService.noteFromAgent()`. The extraction fires as a void (fire-and-forget) promise — it **never blocks** the text or voice turn response.

**What this slice does NOT do:**
- Does NOT add tool calling to `LumiAgent.respond()` — that's a larger refactor for a future orchestrator slice.
- Does NOT replace the `memory.note` TOOL_MANIFEST stub with a real wiring — the planning tool path is separate.
- Does NOT emit SSE invalidation events to Visible Memory (parent refreshes to see new nodes).
- Does NOT deduplicate across turns (the parent can soft-forget duplicates via Epic 7 7-S4).

---

## Acceptance Criteria

1. **Given** a parent sends a text (or voice) turn to Lumi containing a memory-worthy signal (e.g., "Diwali is in three weeks", "Layla hates broccoli", "We always do pasta on Tuesdays"), **When** `submitTextTurn()` processes the turn, **Then** a passive enrichment extraction fires after the Lumi reply turn is committed to the thread — writing detected signals as `memory_nodes` with `source_type='turn'`.

2. **Given** the enrichment extraction detects a signal, **When** the memory node and its provenance are written, **Then** `memory_provenance.source_type = 'turn'`, `memory_provenance.source_ref = { thread_id: <thread.id>, turn_id: <userTurn.id> }`, and `confidence` matches the extracted value (0.8 if explicitly stated; 0.6 if implied; 0.5 if uncertain).

3. **Given** the enrichment extraction returns an empty signals array (mundane conversation, question-only, or nothing memory-worthy), **When** `submitTextTurn()` returns, **Then** no memory nodes are written and no warn logs are emitted.

4. **Given** the OpenAI extraction call fails (network error, malformed JSON, rate limit) OR the extracted result fails Zod schema validation, **When** the error occurs, **Then** a single `warn` log is emitted with `action: 'lumi.passive_enrichment_failed'` (for extraction errors) or `action: 'lumi.passive_enrichment_parse_failed'` (for schema errors), and the text/voice turn response is unaffected. The extraction is never on the critical path.

5. **Given** the `memory_nodes` table and Visible Memory page (`/app/memory`, Epic 7 7-S1) already exist, **When** a passive enrichment node is written with `source_type='turn'`, **Then** it appears on the Visible Memory page after a manual page refresh (no SSE real-time update in this slice). The provenance popover (7-S2) already handles `source_type: 'turn'` — no frontend changes needed.

6. **Given** `lumi-nudge.job.ts` creates its own `LumiService` instance (a second construction site confirmed in the 12-S11 implementation), **When** the nudge job runs `persistNudge()`, **Then** passive enrichment never fires (`persistNudge` does not call `submitTextTurn`) and the nudge job's `LumiService` is constructed without `memoryService` (the field is optional in `LumiServiceDeps`).

---

## Tasks / Subtasks

### Task 1 — `MemoryService.noteFromAgent()` — add optional `sourceType` param (AC: #2)

- [x] 1.1 In `apps/api/src/modules/memory/memory.service.ts`, add `SourceType` to the `@hivekitchen/types` import (it's already exported from there — `MemoryRepository` imports it from the same package):
  ```ts
  import type {
    NodeType,
    SourceType,  // ← ADD
    MemoryNoteOutput,
    MemoryRecallInput,
    MemoryRecallOutput,
  } from '@hivekitchen/types';
  ```

- [x] 1.2 Add `sourceType?: SourceType` to the `NoteFromAgentInput` interface (after `confidence`; before `sourceRef`). The default is `'tool'` (existing callers are unaffected):
  ```ts
  export interface NoteFromAgentInput {
    householdId: string;
    nodeType: NodeType;
    facet: string;
    proseText: string;
    subjectChildId: string | null;
    confidence: number;
    sourceType?: SourceType;  // defaults to 'tool'; 5-S7 passes 'turn'
    sourceRef?: Record<string, unknown>;
  }
  ```

- [x] 1.3 In the `noteFromAgent()` method body, change the hardcoded `'tool'` to `input.sourceType ?? 'tool'`:
  ```ts
  await this.repository.insertProvenance({
    memory_node_id: node.id,
    source_type: input.sourceType ?? 'tool',  // ← was hardcoded 'tool'
    source_ref: input.sourceRef ?? {},
    captured_by: null,
    confidence: input.confidence,
  });
  ```
  No other changes to `noteFromAgent()`.

### Task 2 — `LumiService` — passive enrichment extraction + wiring (AC: #1, #3, #4, #6)

- [x] 2.1 Add imports to `apps/api/src/modules/lumi/lumi.service.ts`:
  ```ts
  import { z } from 'zod';  // ← NEW
  import type { MemoryService } from '../memory/memory.service.js';  // ← NEW
  ```
  `zod` is already in `apps/api/package.json` (it's used throughout). The `MemoryService` import is type-only (no runtime circular dep).

- [x] 2.2 Add local schemas at module scope (top of file, after imports):
  ```ts
  // 5-S7 — enrichment signal extraction result (internal, not a public contract).
  const ENRICHMENT_NODE_TYPES = [
    'preference', 'rhythm', 'cultural_rhythm', 'allergy',
    'child_obsession', 'school_policy', 'other',
  ] as const;
  const EnrichmentSignalSchema = z.object({
    node_type: z.enum(ENRICHMENT_NODE_TYPES),
    facet: z.string().min(1).max(40),
    prose_text: z.string().min(1).max(150),
    confidence: z.number().min(0).max(1),
  });
  const EnrichmentResultSchema = z.object({
    signals: z.array(EnrichmentSignalSchema).max(5),
  });
  ```
  These are NOT in `@hivekitchen/contracts` — they are an internal implementation detail of the enrichment extraction call.

- [x] 2.3 Add the extraction system prompt constant (module scope, near the existing `STT_FAILED_COPY` / `AGENT_FAILED_COPY` constants):
  ```ts
  const ENRICHMENT_SYSTEM_PROMPT =
    `You are a memory signal extractor for Lumi, a family kitchen assistant.
  Given one parent↔Lumi exchange, identify memory-worthy facts the PARENT explicitly stated about their family: food preferences, cultural events or practices, family rhythms, or child-specific observations.

  Return ONLY valid JSON:
  {"signals": [{"node_type": "...", "facet": "...", "prose_text": "...", "confidence": 0.0}]}
  or {"signals": []} if nothing memory-worthy was stated.

  node_type: preference | rhythm | cultural_rhythm | child_obsession | school_policy | other
  facet: short stable kebab-case identifier, max 40 chars (e.g. "diwali-2026", "layla-no-broccoli", "tuesday-pasta-night")
  prose_text: one complete sentence capturing the fact, max 150 chars
  confidence: 0.8 if explicitly stated; 0.6 if implied; 0.5 if uncertain

  Rules:
  - Only capture facts the PARENT explicitly stated. Do NOT invent or infer beyond their words.
  - Ignore greetings, questions, logistics, and Lumi's own reply content.
  - Max 3 signals per turn. Signal facets must be distinct.`.trim();
  ```

- [x] 2.4 Add `memoryService?: MemoryService` to `LumiServiceDeps` interface (optional — nudge job does not wire it):
  ```ts
  export interface LumiServiceDeps {
    repository: LumiRepository;
    redis: Redis;
    logger: FastifyBaseLogger;
    elevenLabsApiKey: string;
    voiceId: string;
    openai: OpenAI;
    childrenRepository: ChildrenRepository;
    householdAllergensRepository: HouseholdAllergensRepository;
    voiceTranscriptRepository: VoiceTranscriptRepository;
    memoryService?: MemoryService;  // ← NEW — 5-S7 passive enrichment; optional so nudge job ctor is unchanged
  }
  ```

- [x] 2.5 Add `private readonly memoryService?: MemoryService` field to the `LumiService` class and assign it in the constructor:
  ```ts
  // (in class body)
  private readonly memoryService?: MemoryService;

  // (in constructor)
  this.memoryService = deps.memoryService;
  ```

- [x] 2.6 Add the private `runPassiveEnrichment()` method to `LumiService`. This method must catch **all** errors internally — it is fire-and-forget and an uncaught rejection would emit `unhandledRejection`:
  ```ts
  private async runPassiveEnrichment(
    householdId: string,
    turnId: string,
    threadId: string,
    userMessage: string,
    lumiReply: string,
  ): Promise<void> {
    if (!this.memoryService) return;  // nudge-job path has no memoryService
    try {
      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o',
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: ENRICHMENT_SYSTEM_PROMPT },
          { role: 'user', content: `Parent: ${userMessage}\nLumi: ${lumiReply}` },
        ],
        max_tokens: 400,
        temperature: 0,  // deterministic extraction, not creative
      });
      const raw = completion.choices[0]?.message?.content ?? '{"signals":[]}';
      let parsed: ReturnType<typeof EnrichmentResultSchema.safeParse>;
      try {
        parsed = EnrichmentResultSchema.safeParse(JSON.parse(raw));
      } catch {
        this.logger.warn(
          { module: 'lumi', action: 'lumi.passive_enrichment_parse_failed' },
          'passive enrichment JSON.parse threw — raw response was not valid JSON',
        );
        return;
      }
      if (!parsed.success) {
        this.logger.warn(
          { module: 'lumi', action: 'lumi.passive_enrichment_parse_failed' },
          'passive enrichment result failed schema validation',
        );
        return;
      }
      const sourceRef: Record<string, unknown> = { thread_id: threadId, turn_id: turnId };
      for (const signal of parsed.data.signals) {
        try {
          await this.memoryService.noteFromAgent({
            householdId,
            nodeType: signal.node_type,
            facet: signal.facet,
            proseText: signal.prose_text,
            subjectChildId: null,
            confidence: signal.confidence,
            sourceType: 'turn',
            sourceRef,
          });
        } catch (err) {
          this.logger.warn(
            { err, module: 'lumi', action: 'lumi.passive_enrichment_note_failed', facet: signal.facet },
            'passive enrichment note write failed — skipping signal',
          );
        }
      }
    } catch (err) {
      this.logger.warn(
        { err, module: 'lumi', action: 'lumi.passive_enrichment_failed', household_id: householdId },
        'passive enrichment extraction failed — non-fatal',
      );
    }
  }
  ```

- [x] 2.7 In `submitTextTurn()`, fire-and-forget `runPassiveEnrichment()` after `lumiTurn` is persisted and BEFORE the voice transcript block. Both `userTurn.id` and `thread.id` are resolved at this point. Add exactly this line (with the 5-S7 comment):
  ```ts
  const lumiTurn = await this.repository.insertTurn({
    threadId: thread.id,
    role: 'lumi',
    body: { type: 'message', content: lumiText },
    modality,
  });

  // 5-S7 — passive enrichment. Fire-and-forget: never blocks the text or voice
  // turn response. Source ref anchors to the user turn so Visible Memory can
  // link back to the conversation. subject_child_id is always null here; Lumi
  // detects household-level signals only (per-child linking is a future slice).
  void this.runPassiveEnrichment(input.householdId, userTurn.id, thread.id, input.message, lumiText);

  // 5-S5 — persist the user's speech transcript …
  if (modality === 'voice') {
  ```

### Task 3 — `lumi.routes.ts` — wire `memoryService` (AC: #1)

- [x] 3.1 In `apps/api/src/modules/lumi/lumi.routes.ts`, add `memoryService: fastify.memoryService` to the `LumiService` constructor args:
  ```ts
  const service = new LumiService({
    repository,
    redis: fastify.redis,
    logger: fastify.log,
    elevenLabsApiKey: fastify.env.ELEVENLABS_API_KEY,
    voiceId: fastify.env.ELEVENLABS_VOICE_ID,
    openai: fastify.openai,
    childrenRepository,
    householdAllergensRepository,
    voiceTranscriptRepository,
    memoryService: fastify.memoryService,  // ← NEW — 5-S7; wired by memory-hook
  });
  ```
  No new import needed in `lumi.routes.ts` — `fastify.memoryService` is typed via the `memory-hook` Fastify decorator and already used in `memory.routes.ts`.

- [x] 3.2 Confirm in `apps/api/src/app.ts` that `memoryHook` is registered **before** `lumiRoutes`. If the registration order is wrong, `fastify.memoryService` will be undefined at the time `lumiRoutes` runs. (Based on codebase patterns — `memory.hook.ts` registers a global decorator, so it should be registered early in the plugin chain before route-scoped plugins.)

### Task 4 — Tests (AC: all)

- [x] 4.1 Add `noteFromAgent` test to `apps/api/src/modules/memory/memory.service.test.ts`:
  - **"stores source_type='turn' when sourceType option is passed"** — verify `insertProvenance` is called with `source_type: 'turn'` and the provided `sourceRef`.
  - **"defaults source_type to 'tool' when sourceType is omitted"** — verify existing behavior is unchanged. (Can be the existing test with explicit assertion added.)

- [x] 4.2 Add `runPassiveEnrichment` / enrichment-wiring tests to `apps/api/src/modules/lumi/lumi.service.test.ts`. The existing service tests use fake OpenAI via `fastify.openai` — follow the same pattern. Key cases:
  - **"enrichment writes memory node with source_type=turn when OpenAI returns signals"** — mock `openai.chat.completions.create` to return `{"signals": [{"node_type":"cultural_rhythm","facet":"diwali-2026","prose_text":"Diwali is in three weeks.","confidence":0.8}]}`; verify `memoryService.noteFromAgent` called with `sourceType:'turn'`, `sourceRef:{thread_id:...,turn_id:userTurn.id}`.
  - **"enrichment is skipped when OpenAI returns empty signals array"** — mock returns `{"signals":[]}`; verify `noteFromAgent` is NOT called.
  - **"enrichment failures do not propagate to submitTextTurn"** — mock `openai.chat.completions.create` (the SECOND call, for enrichment) to throw; verify `submitTextTurn` still resolves and returns the turn pair.
  - **"enrichment is skipped when memoryService is absent"** — construct `LumiService` without `memoryService`; verify no OpenAI enrichment call is made and `submitTextTurn` still resolves.

  **Testing pattern note:** `runPassiveEnrichment` is private but fires as `void this.runPassiveEnrichment(...)` inside `submitTextTurn`. To test its effects, await the result of `submitTextTurn()` and then wait for any queued microtasks (use `await Promise.resolve()` or `await new Promise(resolve => setTimeout(resolve, 0))` to flush the fire-and-forget). The `memoryService.noteFromAgent` mock assertion then captures the call.

  Alternatively, test `runPassiveEnrichment` indirectly by checking the side effects on the mocked `memoryService`.

- [x] 4.3 Verify baseline test counts before starting:
  - API: `pnpm --filter @hivekitchen/api test` — confirm ~1709 pass / 20 fail (documented pre-existing failures: auth×7, children.repository×3, extra-library×3, lunch-link-dev, onboarding.tools, audit-parity, catalog-seed, households-memory-200, plan-adjustment, memory-partial-seeding).
  - Expected new tests: ~4-6 in `lumi.service.test.ts` + ~2 in `memory.service.test.ts`.

### Task 5 — Verification (AC: all)

- [x] 5.1 `pnpm typecheck` — zero new errors vs baseline (API 11, web 6, contracts/types 1 — all in untouched files).
- [x] 5.2 `pnpm test` for `apps/api` — all new tests green; documented pre-existing baseline unchanged.
- [x] 5.3 Manual smoke test (optional, non-blocking): Start local stack → send "Diwali is in three weeks" in the Lumi panel → navigate to `/app/memory` → verify new node appears with `source_type: 'turn'` in the provenance popover.

---

## Dev Notes

### CRITICAL: Fire-and-forget discipline

`runPassiveEnrichment()` is called as `void this.runPassiveEnrichment(...)`. This means:
1. The enrichment runs in the background — `submitTextTurn()` returns immediately after firing it.
2. **ALL errors must be caught inside `runPassiveEnrichment()`** — any unhandled rejection from a void promise emits `unhandledRejection` which can crash Node.js. The method has three layers of try/catch: outer (OpenAI call), middle (JSON.parse), and per-signal inner (noteFromAgent). Do NOT let any path escape uncaught.
3. The guard `if (!this.memoryService) return;` must be the FIRST statement — if `memoryService` is absent, skip the OpenAI call entirely (no point extracting signals we can't store).

### CRITICAL: `subjectChildId` is always `null` in this slice

The extraction model receives the household snapshot text (from `householdSnapshot` string) but not a machine-readable child ID map. Resolving "Layla" → child UUID would require passing children by ID in the extraction prompt — that's a follow-up enhancement. For this slice, all enrichment signals are household-scoped (`subjectChildId: null`). Note this in Completion Notes.

### CRITICAL: `temperature: 0` for extraction

Use `temperature: 0` (not `LUMI_TEMPERATURE` = 0.7). Extraction is a classification/parsing task, not creative generation. Deterministic responses make testing predictable and reduce hallucination.

### CRITICAL: `response_format: { type: 'json_object' }` requires JSON in the prompt

OpenAI requires the word "JSON" to appear in either the system prompt or user message when using `response_format: { type: 'json_object' }`. The system prompt's `Return ONLY valid JSON:` line satisfies this. Do NOT remove it or the API will return a 400.

### Which OpenAI call is the enrichment call?

In `submitTextTurn()`, OpenAI is called TWICE after this slice ships:
1. `agent.respond()` — the existing conversational reply call (temperature 0.7, max_tokens 400, no `response_format`)
2. `this.openai.chat.completions.create(...)` inside `runPassiveEnrichment()` — the new extraction call (temperature 0, max_tokens 400, `response_format: { type: 'json_object' }`)

The extraction call is the SECOND one and is fire-and-forget. In tests that mock `openai.chat.completions.create`, be careful to mock both calls distinctly if needed (e.g., mock the first call to return the Lumi reply, and the second to return the JSON signal).

### Source file map

| File | Action | Notes |
|------|--------|-------|
| `apps/api/src/modules/memory/memory.service.ts` | Modify | Add `SourceType` import + optional `sourceType` to `NoteFromAgentInput` + use it in `noteFromAgent()` |
| `apps/api/src/modules/lumi/lumi.service.ts` | Modify | Add `z` import, `MemoryService` type import, local Zod schemas, extraction system prompt, `memoryService` dep, `runPassiveEnrichment()` method, fire-and-forget call in `submitTextTurn()` |
| `apps/api/src/modules/lumi/lumi.routes.ts` | Modify | Add `memoryService: fastify.memoryService` to `LumiService` constructor |
| `apps/api/src/modules/lumi/lumi.service.test.ts` | Modify | Add enrichment extraction tests |
| `apps/api/src/modules/memory/memory.service.test.ts` | Modify | Add `sourceType: 'turn'` test for `noteFromAgent` |

**No changes to:**
- `packages/contracts/` — no new API contracts (enrichment is internal)
- `apps/web/` — no UI changes; Visible Memory page already renders turn-sourced nodes; provenance popover already handles `source_type: 'turn'`
- `apps/api/src/agents/lumi.agent.ts` — LumiAgent unchanged
- `apps/api/src/agents/tools.manifest.ts` — TOOL_MANIFEST stub stays; it's for DomainOrchestrator planning, not for this path
- `apps/api/src/agents/tools/memory.tools.ts` — `createMemoryNoteSpec` unchanged
- Any migration file — `memory_nodes` + `memory_provenance` tables exist since Epic 7; `source_type='turn'` is already a valid enum value (see `SourceTypeSchema` in `packages/contracts/src/memory.ts:26`)

### Existing code to reuse (do NOT reinvent)

| What | Where | Pattern |
|------|-------|---------|
| `noteFromAgent()` service method | `apps/api/src/modules/memory/memory.service.ts:288` | Already writes `memory_nodes` + `memory_provenance`; just add `sourceType` option |
| `MemoryRepository.insertNode/insertProvenance` | `apps/api/src/modules/memory/memory.repository.ts:52` | Already handles `source_type: 'turn'` (it's in `SourceType` union) |
| `fastify.memoryService` | Wired by `apps/api/src/modules/memory/memory.hook.ts` | Available in any route plugin that loads after `memory-hook` |
| Voice transcript best-effort pattern | `lumi.service.ts:349–371` | Same `try/catch` + `warn` log pattern for the per-signal `noteFromAgent()` call inside the loop |
| Source ref pattern | `memory.service.ts:76` (seedFromOnboarding) | `{ thread_id, turn_id }` — mirror this exactly |

### Behavior of `runPassiveEnrichment` in the voice path

In the voice path, the call sequence is:
```
STT → [lumi.thinking pulse] → submitTextTurn() → ← returns {user_turn, lumi_turn}
                                                        └─ void runPassiveEnrichment() fires here
TTS streams to browser ←                               (concurrent with TTS — no added voice latency)
```

The enrichment extraction fires concurrently with TTS streaming. The browser receives Lumi's audio before the extraction completes. This is intentional.

### `lumi-nudge.job.ts` — second LumiService construction site

The nudge job at `apps/api/src/jobs/lumi-nudge.job.ts` creates its own `LumiService` instance. Since `memoryService` is optional in `LumiServiceDeps`, no change is needed at that site. The nudge job calls `persistNudge()` not `submitTextTurn()` — enrichment never fires there regardless.

### Test flushing pattern for fire-and-forget

Since `runPassiveEnrichment` is fired as `void this.runPassiveEnrichment(...)`, tests must flush the microtask queue after `await submitTextTurn(...)` before asserting on `memoryService.noteFromAgent` calls:

```ts
await service.submitTextTurn({ ... });
// Flush fire-and-forget void promise and its awaited internals
await new Promise<void>((resolve) => setTimeout(resolve, 0));
expect(mockMemoryService.noteFromAgent).toHaveBeenCalledWith({ ... });
```

Alternatively, if the test spy on `openai.chat.completions.create` is a resolved promise (not truly async), a single `await Promise.resolve()` may be sufficient. Use `setTimeout(resolve, 0)` as the safe default.

### USER-SIDE GATES

None. No migration, no new env var, no new npm dependency. `gpt-4o` is already the configured model (`LUMI_MODEL` in `lumi.agent.ts:24`) and `this.openai` is already wired. The enrichment call reuses the same OpenAI client.

### Test baselines (from 5-S6 done state, 2026-06-07)

- **API:** ~1709 pass / 20 fail (documented pre-existing: auth×7, children.repository×3, extra-library×3, lunch-link-dev, onboarding.tools, audit-parity, catalog-seed, households-memory-200, plan-adjustment, memory-partial-seeding)
- **Web:** ~532 pass / 2 fail (pre-existing 5-S3 debt: PackerAssignmentDialog, sse packer.assigned key)
- **Contracts:** ~701 pass / 7 fail (pre-existing: auth×3 working-tree, cultural×1, heart-notes×3)
- **Typecheck baseline:** API 11, web 6, contracts/types 1 — all in untouched files

Expected new tests: ~6 in `lumi.service.test.ts` + ~2 in `memory.service.test.ts` = ~8 total, all green.

### Project Structure Notes

- All new logic is API-only (`apps/api/src/`). No web, no contracts, no migration changes.
- `runPassiveEnrichment()` is a private method on `LumiService` — keep it there, not a separate file (it's single-use within the class; CLAUDE.md §2: no abstractions for single-use code).
- The local Zod schemas (`EnrichmentSignalSchema`, `EnrichmentResultSchema`) are module-scope constants in `lumi.service.ts`. They are not exported — they are internal parsing utilities for a single call site.
- `ENRICHMENT_SYSTEM_PROMPT` is a module-scope `const string`. Use a tagged template literal or regular string — NOT a function (no dynamic content needed).

### References

- [Source: _bmad-output/planning-artifacts/epic-5-vertical-slices.md#Slice 5-S7 — Passive memory enrichment]
- [Source: apps/api/src/modules/lumi/lumi.service.ts] — `submitTextTurn()` (lines 296–374) and `processVoiceUtterance()` (lines 170–277)
- [Source: apps/api/src/modules/memory/memory.service.ts:288] — `noteFromAgent()` (the write path)
- [Source: apps/api/src/modules/memory/memory.hook.ts] — `fastify.memoryService` wiring
- [Source: apps/api/src/agents/lumi.agent.ts:43] — `LumiAgent.respond()` (single-shot, no tool calling — explains why extraction is a separate call)
- [Source: apps/api/src/agents/tools.manifest.ts:84] — `memory.note` stub (NOT wired into this path)
- [Source: packages/contracts/src/memory.ts:16] — `NodeTypeSchema` enum values (copy verbatim for local `ENRICHMENT_NODE_TYPES`)
- [Source: packages/contracts/src/memory.ts:26] — `SourceTypeSchema` includes `'turn'` — no migration needed
- [Source: apps/api/src/modules/memory/memory.service.ts:76] — `sourceRef` pattern: `{ thread_id, turn_id }` — mirror exactly
- [Source: _bmad-output/implementation-artifacts/5-s6-latency-doctrine-early-ack-filler-phrase-lint.md] — previous story (5-S6); baseline test counts and ESLint rule that now blocks `"Let me pull that up"` style fillers in the ENRICHMENT_SYSTEM_PROMPT (not an issue — the prompt is not in `apps/*/src`, it's a string constant; the lint rule targets filler phrases matching the theatrical-waiting regex, not arbitrary strings).
- [Source: _bmad-output/implementation-artifacts/7-s13-payload-scrubbing-primitive.md] — precedent for shipping a background-only enrichment primitive that is best-effort

---

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (Opus 4.8, 1M context)

### Debug Log References

- `pnpm --filter @hivekitchen/api exec vitest run src/modules/lumi/lumi.service.test.ts src/modules/memory/memory.service.test.ts` — 57 pass / 1 fail (the 1 fail is the pre-existing `seedFromOnboarding › partial seeding` baseline failure, confirmed failing on the unmodified tree via `git stash`).
- `pnpm --filter @hivekitchen/api typecheck` — 11 API + 1 contracts pre-existing errors, none in any file touched by this slice (0 new).
- `pnpm --filter @hivekitchen/api exec vitest run` (full suite) — 1717 pass / 20 fail / 13 skip. Baseline was 1709 pass / 20 fail, so +8 net new passing tests and the 20 failures are exactly the documented pre-existing baseline.

### Completion Notes List

- **AC#1–#3** — `submitTextTurn()` fires `void this.runPassiveEnrichment(...)` immediately after the Lumi turn is committed and before the voice-transcript block, anchored to `userTurn.id` + `thread.id`. Empty `{"signals":[]}` results write nothing and emit no warn log. Verified by the "writes a memory node…" and "does not write…when…empty signals array" tests.
- **AC#2** — provenance is written with `source_type='turn'`, `source_ref={ thread_id, turn_id }`, and the model-supplied `confidence`. `MemoryService.noteFromAgent()` gained an optional `sourceType?: SourceType` param (defaults to `'tool'`, so all existing callers — onboarding tools, planning tools — are unaffected).
- **AC#4** — three guard layers (outer OpenAI call → `lumi.passive_enrichment_failed`; `JSON.parse` + schema validation → `lumi.passive_enrichment_parse_failed`; per-signal note write → `lumi.passive_enrichment_note_failed`). All caught internally so the `void` promise can never reject. The OpenAI-failure and schema-validation-failure paths are covered by tests asserting `submitTextTurn` still resolves and the matching warn log fires.
- **AC#6** — `memoryService` is optional on `LumiServiceDeps`; `runPassiveEnrichment` returns immediately (no OpenAI call) when it is absent. The nudge-job `LumiService` construction site is unchanged and `persistNudge` never calls `submitTextTurn`, so enrichment never fires there. Covered by the "skips enrichment entirely…when memoryService is absent" test.
- **AC#5** — no frontend or contract changes were needed; the Visible Memory page (7-S1) and the provenance popover (7-S2) already render `source_type='turn'` nodes. No SSE invalidation is emitted (out of scope, per the slice's "does NOT" list) — the node appears on manual refresh.
- **subjectChildId is always `null`** this slice (household-scoped signals only); per-child UUID resolution is a deferred follow-up, as noted in Dev Notes.
- Extraction uses `gpt-4o`, `temperature: 0`, `response_format: { type: 'json_object' }`, `max_tokens: 400`, reusing the already-wired `this.openai` client. No migration, no new env var, no new npm dependency.
- Task 3.2 verified: `app.ts` registers `memoryHook` (line 130) before `lumiRoutes` (line 257), so `fastify.memoryService` is defined when `lumiRoutes` constructs the service.

### File List

- `apps/api/src/modules/memory/memory.service.ts` — Modified: `SourceType` import; optional `sourceType` on `NoteFromAgentInput`; `input.sourceType ?? 'tool'` in `noteFromAgent()`.
- `apps/api/src/modules/lumi/lumi.service.ts` — Modified: `z` import, `MemoryService` type import, `EnrichmentSignalSchema`/`EnrichmentResultSchema`/`ENRICHMENT_NODE_TYPES`/`ENRICHMENT_SYSTEM_PROMPT` module-scope consts, optional `memoryService` dep + field + ctor assignment, `runPassiveEnrichment()` method, fire-and-forget call in `submitTextTurn()`.
- `apps/api/src/modules/lumi/lumi.routes.ts` — Modified: pass `memoryService: fastify.memoryService` to the `LumiService` constructor.
- `apps/api/src/modules/memory/memory.service.test.ts` — Modified: 2 new `noteFromAgent` tests (source_type='turn' with sourceRef; defaults to 'tool').
- `apps/api/src/modules/lumi/lumi.service.test.ts` — Modified: `buildDeps` now accepts `memoryService` and returns `openai`/`memoryService`; new "passive enrichment (Story 5-S7)" describe block (5 tests) + fire-and-forget flush helper.

### Change Log

| Date | Change |
|------|--------|
| 2026-06-07 | 5-S7 passive memory enrichment implemented — post-reply best-effort OpenAI extraction wired fire-and-forget into `LumiService.submitTextTurn()`; `noteFromAgent` gains optional `sourceType`; +8 tests; status → review. |

---

### Review Findings

- [x] [Review][Decision] **Confidence scale diverges from AC#2** — RESOLVED: 3-tier scale (0.8 explicit / 0.6 implied / 0.5 uncertain) accepted as deliberate improvement over spec's rough 2-tier guidance. AC#2 updated to reflect actual values.
- [x] [Review][Decision] **`'allergy'` in `ENRICHMENT_NODE_TYPES` but absent from prompt's node_type list** — RESOLVED: add `allergy` to the `ENRICHMENT_SYSTEM_PROMPT` node_type list so the model can capture allergy mentions as soft memory signals. Note: these land in `memory_nodes` (soft context), not in `household_allergens` (the structured safety table — confirmed canonical allergen source). Converted to patch P3.
- [x] [Review][Patch] **`EnrichmentResultSchema` allows `.max(5)` but prompt says "Max 3 signals per turn"** — FIXED: changed `.max(5)` → `.max(3)`. [`apps/api/src/modules/lumi/lumi.service.ts` — `EnrichmentResultSchema`]
- [x] [Review][Patch] **Empty-signals test does not assert `logger.warn` not called** — FIXED: added `expect(logger.warn).not.toHaveBeenCalled()` + destructured `logger` in the empty-signals test. [`apps/api/src/modules/lumi/lumi.service.test.ts` — empty signals test]
- [x] [Review][Defer] **Third action `lumi.passive_enrichment_note_failed` not listed in AC#4** — AC#4 enumerates exactly two action values; the per-signal write failure emits a third undocumented action. Behavior is reasonable (per-signal catch + warn), just unspecified in the AC. [`apps/api/src/modules/lumi/lumi.service.ts` — `runPassiveEnrichment` inner catch] — deferred, minor spec omission
- [x] [Review][Defer] **User message interpolated raw into extraction prompt** — `\`Parent: ${userMessage}\nLumi: ${lumiReply}\`` allows a crafted user message to inject fake Lumi content, skewing signal extraction. Risk is low (authenticated single-household, memory is editable, no cross-household impact), but persistent false signals are possible. [`apps/api/src/modules/lumi/lumi.service.ts` — `runPassiveEnrichment`] — deferred, low-risk in authenticated household context
- [x] [Review][Defer] **Enrichment fires on voice turns including degraded Lumi responses** — in-spec per AC#1 ("text (or voice) turn"); degraded response risk is mitigated by the prompt rule "Ignore Lumi's own reply content." No voice-path–specific enrichment tests exist. [`apps/api/src/modules/lumi/lumi.service.ts` — fire-and-forget call] — deferred, in-spec; voice-path test coverage is a follow-up enhancement
- [x] [Review][Defer] **Duplicate facet silently skipped (unique constraint hit)** — if the same `(household_id, node_type, facet, child=null)` combination is extracted across two turns, the second `noteFromAgent` call hits the unique constraint, the per-signal catch swallows it, and no new provenance row is written for the re-stated fact. [`apps/api/src/modules/lumi/lumi.service.ts` — per-signal catch] — deferred, conservative safe behavior; upsert/merge is a future enhancement
- [x] [Review][Defer] **`gpt-4o` hardcoded in `runPassiveEnrichment`** — no configuration path; pre-existing codebase pattern (LumiAgent also hardcodes the model). [`apps/api/src/modules/lumi/lumi.service.ts:437`] — deferred, pre-existing pattern
- [x] [Review][Defer] **Schema-level all-or-nothing validation — one bad signal discards all** — `EnrichmentResultSchema.safeParse` validates the whole array; a single signal with a 41-char facet causes all signals in the response to be dropped. Conservative and safe, but per-signal validation would be more resilient. [`apps/api/src/modules/lumi/lumi.service.ts` — `EnrichmentResultSchema`] — deferred, conservative behavior is defensible; per-signal filtering is a future enhancement
