# Story 3.2: Domain Orchestrator + LLMProvider Adapter (OpenAI primary, Anthropic stub)

Status: ready-for-dev

## Story

As a developer,
I want the agent orchestrator wrapped behind a `LLMProvider` interface with an OpenAI adapter and Anthropic stub,
So that the NFR-mandated 15-min provider failover (NFR-REL-5, AR-2) is achievable without rewriting agent code.

## Acceptance Criteria

1. **Given** Story 1.6 (OpenAI plugin) is complete (it is — `fastify.openai` decorator exists),
   **When** Story 3.2 is complete,
   **Then** `apps/api/src/agents/providers/llm-provider.interface.ts` exports `interface LLMProvider` with at minimum `complete(prompt: string, tools: ToolSpec[], options: LLMCallOptions): Promise<LLMResponse>` and `stream(prompt: string, tools: ToolSpec[], options: LLMCallOptions): AsyncIterable<LLMStreamEvent>`.
   No SDK types (`openai`, `@anthropic-ai/sdk`, etc.) appear in this file — it is SDK-agnostic.

2. **Given** `llm-provider.interface.ts` exists,
   **When** Story 3.2 is complete,
   **Then** `apps/api/src/agents/providers/openai.adapter.ts` exports `OpenAIAdapter implements LLMProvider`; `apps/api/src/agents/providers/anthropic.adapter.ts` exports `AnthropicAdapter implements LLMProvider` whose `complete()` and `stream()` methods throw `NotImplementedError` (from `common/errors.ts`).

3. **Given** the two adapters exist,
   **When** Story 3.2 is complete,
   **Then** `apps/api/src/agents/orchestrator.ts` exports `DomainOrchestrator` whose constructor accepts `{ providers: LLMProvider[], services: OrchestratorServices, auditService: AuditService }` (providers is an ordered chain — index 0 is primary); a circuit-breaker on `provider.complete()` opens after 5 consecutive failures within 60s, swaps to the next provider, writes `audit.service.write({ event_type: 'llm.provider.failover', metadata: { from, to, reason } })`, and schedules a passive health-check probe after 15 min to potentially restore the primary.

4. **Given** `allergy.tools.ts` already exports `createAllergyCheckSpec` and `memory.tools.ts` already exports `createMemoryNoteSpec`,
   **When** the `DomainOrchestrator` is constructed,
   **Then** it calls those factories with the injected services and replaces the stub `fn` entries in `TOOL_MANIFEST` for `'allergy.check'` and `'memory.note'` — so from this point forward both tools are callable without throwing.

5. **Given** `orchestrator.hook.ts` registers a `DomainOrchestrator` instance as `fastify.orchestrator`,
   **When** `app.ts` registers the hook (after `allergyGuardrailHook` and `memoryHook`),
   **Then** `fastify.orchestrator` is accessible to route handlers for future stories (3.3, 3.4) without additional wiring.

---

## Tasks / Subtasks

### Task 1 — LLMProvider interface + supporting types (AC: #1)

- [ ] Create `apps/api/src/agents/providers/llm-provider.interface.ts`
  - [ ] Import `type ToolSpec` from `'../tools.manifest.js'`
  - [ ] Define and export:
    ```typescript
    export interface LLMCallOptions {
      model: string;
      temperature?: number;
      maxTokens?: number;
      systemPrompt?: string;
    }

    export interface LLMToolCall {
      id: string;
      name: string;
      arguments: unknown;
    }

    export interface LLMResponse {
      content: string | null;
      toolCalls: LLMToolCall[];
      finishReason: 'stop' | 'tool_calls' | 'length' | 'error';
      usage: { promptTokens: number; completionTokens: number };
    }

    export interface LLMStreamEvent {
      type: 'delta' | 'tool_call_delta' | 'done';
      content?: string;
      toolCallDelta?: { id: string; name?: string; argumentsDelta?: string };
    }

    export interface LLMProvider {
      readonly name: string;
      complete(prompt: string, tools: ToolSpec[], options: LLMCallOptions): Promise<LLMResponse>;
      stream(prompt: string, tools: ToolSpec[], options: LLMCallOptions): AsyncIterable<LLMStreamEvent>;
      probe(): Promise<boolean>;
    }
    ```
  - [ ] No SDK imports in this file — it must be SDK-agnostic

### Task 2 — OpenAI adapter (AC: #2)

- [ ] Create `apps/api/src/agents/providers/openai.adapter.ts`
  - [ ] Import `type OpenAI from 'openai'` (type-only) and the `ToolSpec` / interface types
  - [ ] **Note:** `@openai/agents` is NOT installed — only `openai` (^4.0.0). Use `openai.chat.completions.create()` with the `tools` parameter (OpenAI function-calling format). The interface contract is the isolation boundary; the underlying SDK can be swapped later.
  - [ ] Export `OpenAIAdapter implements LLMProvider`:
    ```typescript
    constructor(private readonly client: OpenAI) {}
    readonly name = 'openai';
    ```
  - [ ] `complete()` implementation:
    - Convert `ToolSpec[]` to OpenAI `ChatCompletionTool[]` format: each tool maps to `{ type: 'function', function: { name: spec.name, description: spec.description, parameters: zodToJsonSchema(spec.inputSchema) } }`
    - Use `zodToJsonSchema` from `zod-to-json-schema` if installed, or manually call `spec.inputSchema._def` — **check if `zod-to-json-schema` is installed first**; if not, implement a lightweight inline converter for the schemas used
    - Call `client.chat.completions.create({ model, messages, tools, tool_choice: 'auto', temperature, max_tokens })`
    - Map response to `LLMResponse`; extract `tool_calls` array from `choices[0].message`
    - Set `usage` from `response.usage` (prompt_tokens, completion_tokens)
    - Include `'OpenAI-Data-Privacy': 'zero-retention'` in request headers (zero data retention per architecture §Technical Constraints)
  - [ ] `stream()` implementation:
    - Call `client.chat.completions.create({ ..., stream: true })`
    - Yield `LLMStreamEvent` items from the async iterable
    - For now, a basic implementation is acceptable — full streaming optimization is Story 3.3+
  - [ ] `probe()` implementation:
    - Minimal `chat.completions.create({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 })` — returns `true` on success, `false` on throw

### Task 3 — Anthropic stub adapter (AC: #2)

- [ ] Create `apps/api/src/agents/providers/anthropic.adapter.ts`
  - [ ] Import `{ NotImplementedError }` from `'../../common/errors.js'` — ensure `NotImplementedError` exists in `errors.ts`; if it doesn't, add it: `export class NotImplementedError extends DomainError { constructor(feature: string) { super(501, '/errors/not-implemented', 'Not Implemented', feature) } }`
  - [ ] Export `AnthropicAdapter implements LLMProvider`:
    ```typescript
    readonly name = 'anthropic';
    complete(): Promise<LLMResponse> { throw new NotImplementedError('AnthropicAdapter.complete'); }
    stream(): AsyncIterable<LLMStreamEvent> { throw new NotImplementedError('AnthropicAdapter.stream'); }
    probe(): Promise<boolean> { return Promise.resolve(false); }
    ```
  - [ ] No `@anthropic-ai/sdk` import — this is a structural stub, not a real implementation

### Task 4 — Circuit breaker (AC: #3)

- [ ] Create `apps/api/src/agents/circuit-breaker.ts`
  - [ ] Export `CircuitBreaker` class:
    ```typescript
    export class CircuitBreaker {
      private failureTimestamps: number[] = [];
      private isOpen = false;
      private recoveryTimeoutId: ReturnType<typeof setTimeout> | null = null;

      constructor(
        private readonly failureThreshold: number,  // default: 5
        private readonly windowMs: number,          // default: 60_000
        private readonly recoveryMs: number,        // default: 900_000 (15 min)
        private readonly onOpen: () => void,
        private readonly onRecovered: () => void,
      ) {}
    ```
  - [ ] `recordFailure(): void` — pushes `Date.now()` to `failureTimestamps`, prunes entries older than `windowMs`, opens if count ≥ `failureThreshold`
  - [ ] `recordSuccess(): void` — clears `failureTimestamps`; if open, resets and calls `onRecovered`
  - [ ] `isTripped(): boolean` — returns `this.isOpen`
  - [ ] Opening logic: sets `isOpen = true`, calls `onOpen()`, schedules `setTimeout` after `recoveryMs` to attempt re-probe via an injected async callback
  - [ ] Keep this a pure value class — no Pino, no imports from other app code. Accept logger callback in constructor if logging is needed.

### Task 5 — DomainOrchestrator (AC: #3, #4)

- [ ] Create `apps/api/src/agents/orchestrator.ts`
  - [ ] Define and export `OrchestratorServices` interface:
    ```typescript
    export interface OrchestratorServices {
      memory: MemoryService;
      allergyGuardrail: AllergyGuardrailService;
    }
    ```
    (recipe, pantry, cultural are Story 3.4 — do NOT add stub imports for them now)
  - [ ] Export `DomainOrchestrator` class:
    ```typescript
    export class DomainOrchestrator {
      constructor(
        private providers: LLMProvider[],
        private readonly services: OrchestratorServices,
        private readonly auditService: AuditService,
        private readonly logger: pino.Logger,
      ) {}
    ```
  - [ ] Constructor body:
    1. Assert `providers.length >= 1` — throw if empty
    2. Wire real tool fns into TOOL_MANIFEST (replacing stubs):
       ```typescript
       TOOL_MANIFEST.set('allergy.check', createAllergyCheckSpec(services.allergyGuardrail));
       TOOL_MANIFEST.set('memory.note', createMemoryNoteSpec(services.memory));
       ```
    3. Initialize `CircuitBreaker` for primary provider with thresholds (5, 60_000, 900_000)
    4. `onOpen` callback: log `warn` + call `swapProvider(reason)`
    5. Recovery probe: after 15 min, call `providers[0].probe()` → if `true`, restore primary + log `info`
  - [ ] Private `currentProviderIndex = 0` field
  - [ ] Private `swapProvider(reason: string): void`:
    - Increments to next provider index (wrapping if no more: stays on last)
    - Calls `this.auditService.write({ event_type: 'llm.provider.failover', request_id: randomUUID(), metadata: { from: providers[prev].name, to: providers[current].name, reason } })`
    - Logs `error` with structured fields
  - [ ] Public `complete(prompt: string, tools: ToolSpec[], options: LLMCallOptions): Promise<LLMResponse>`:
    - Calls `providers[currentProviderIndex].complete(prompt, tools, options)`
    - On success: `circuitBreaker.recordSuccess()`; return result
    - On error: `circuitBreaker.recordFailure()`; rethrow
  - [ ] Public `getActiveProvider(): LLMProvider` — returns `providers[currentProviderIndex]`
  - [ ] **Do NOT implement `planWeek()` or `replyToTurn()` yet** — those land in Story 3.3+
  - [ ] Import Pino logger type: `import type pino from 'pino'`
  - [ ] Import `randomUUID` from `'node:crypto'`

### Task 6 — Orchestrator Fastify hook (AC: #5)

- [ ] Create `apps/api/src/agents/orchestrator.hook.ts`
  - [ ] Follow the exact pattern from `allergy-guardrail.hook.ts` + `memory.hook.ts`:
    ```typescript
    import fp from 'fastify-plugin';
    import type { FastifyPluginAsync } from 'fastify';
    import { DomainOrchestrator } from './orchestrator.js';
    import { OpenAIAdapter } from './providers/openai.adapter.js';
    import { AnthropicAdapter } from './providers/anthropic.adapter.js';

    const orchestratorHookPlugin: FastifyPluginAsync = async (fastify) => {
      if (!fastify.openai || !fastify.memoryService || !fastify.allergyGuardrailService || !fastify.auditService) {
        throw new Error('orchestratorHook requires openai + memoryService + allergyGuardrailService + auditService');
      }
      const openaiAdapter = new OpenAIAdapter(fastify.openai);
      const anthropicAdapter = new AnthropicAdapter();
      const orchestrator = new DomainOrchestrator(
        [openaiAdapter, anthropicAdapter],
        { memory: fastify.memoryService, allergyGuardrail: fastify.allergyGuardrailService },
        fastify.auditService,
        fastify.log,
      );
      fastify.decorate('orchestrator', orchestrator);
    };

    export const orchestratorHook = fp(orchestratorHookPlugin, { name: 'orchestrator-hook' });
    ```

- [ ] In `apps/api/src/types/fastify.d.ts`:
  - [ ] Add `import type { DomainOrchestrator } from '../agents/orchestrator.js'`
  - [ ] Add `orchestrator: DomainOrchestrator` to `FastifyInstance`

- [ ] In `apps/api/src/app.ts`:
  - [ ] Import `orchestratorHook` from `'./agents/orchestrator.hook.js'`
  - [ ] Register: `await app.register(orchestratorHook)` — after `allergyGuardrailHook` (line ~91), before route registrations

### Task 7 — Tests (AC: all)

- [ ] Create `apps/api/src/agents/providers/openai.adapter.test.ts`
  - [ ] Mock `OpenAI` client
  - [ ] `complete()` with no tools → calls `chat.completions.create` with empty tools array; returns `LLMResponse` with `finishReason: 'stop'`
  - [ ] `complete()` when model returns tool_calls → returns `LLMResponse` with `finishReason: 'tool_calls'` and `toolCalls` populated
  - [ ] `complete()` when API throws → re-throws (no swallowing)
  - [ ] `probe()` returns `true` on success, `false` on throw

- [ ] Create `apps/api/src/agents/circuit-breaker.test.ts`
  - [ ] `recordFailure()` called < threshold → `isTripped()` returns `false`
  - [ ] `recordFailure()` called = threshold within window → `isTripped()` returns `true`, `onOpen` called
  - [ ] Failures older than `windowMs` are pruned — does not count toward threshold
  - [ ] `recordSuccess()` when open → clears, `isTripped()` returns `false`
  - [ ] Recovery timeout fires → calls probe callback

- [ ] Create `apps/api/src/agents/orchestrator.test.ts`
  - [ ] Constructor wires `allergy.check` fn in TOOL_MANIFEST → calling `TOOL_MANIFEST.get('allergy.check')!.fn(validInput)` does NOT throw `NotImplementedError`
  - [ ] Constructor wires `memory.note` fn in TOOL_MANIFEST → same
  - [ ] `complete()` delegates to primary provider and returns result
  - [ ] After 5 consecutive provider failures, `swapProvider` fires, `auditService.write` called with `event_type: 'llm.provider.failover'`
  - [ ] `complete()` after swap delegates to secondary provider (index 1)

---

## Dev Notes

### Critical — What is and is NOT in scope for Story 3.2

**In scope:**
- `LLMProvider` interface + types
- `OpenAIAdapter` (using the installed `openai` package, NOT `@openai/agents`)
- `AnthropicAdapter` stub
- `DomainOrchestrator` with circuit-breaker and tool-wiring
- `orchestratorHook` Fastify registration
- Wire real `allergy.check` and `memory.note` fns (factories already exist in `allergy.tools.ts` and `memory.tools.ts`)

**NOT in scope (defer to Story 3.3+):**
- `planWeek()` orchestrator method
- `replyToTurn()` orchestrator method
- `planner.prompt.ts` versioned prompt — that's Story 3.3
- recipe, pantry, plan, cultural tools — those are Story 3.4
- Redis-backed circuit-breaker state — in-memory per-process is correct for Story 3.2

### Critical — @openai/agents NOT installed

The architecture document references `@openai/agents` SDK for the orchestrator, but the installed package is `openai` (^4.0.0). The `openai.plugin.ts` and `onboarding.agent.ts` both use the `openai` package directly. **Do NOT install `@openai/agents`** — use `openai.chat.completions.create()` with the `tools` array for the adapter. The `LLMProvider` interface is the isolation boundary; the SDK can be changed behind the adapter in a future story without touching the orchestrator.

### Critical — Tool manifest wiring

The stubs in `tools.manifest.ts` (as of Story 3.1) have `fn` implementations that throw:
```typescript
fn: async (): Promise<unknown> => {
  throw new Error('allergy.check not yet wired — Story 3.2 injects fn via createAllergyCheckSpec(allergyGuardrailService)');
};
```

Story 3.2's orchestrator constructor replaces these in `TOOL_MANIFEST`:
```typescript
TOOL_MANIFEST.set('allergy.check', createAllergyCheckSpec(services.allergyGuardrail));
TOOL_MANIFEST.set('memory.note', createMemoryNoteSpec(services.memory));
```

`createAllergyCheckSpec` is in `apps/api/src/agents/tools/allergy.tools.ts` (already implemented in Story 3.1).
`createMemoryNoteSpec` is in `apps/api/src/agents/tools/memory.tools.ts` (already implemented).

### Critical — Circuit breaker is in-process only

The circuit breaker must be in-process per-instance (no Redis). Its state is ephemeral — a process restart resets it. This is by design: the 15-min recovery probe is a `setTimeout`, not a BullMQ job. Across-instance synchronization (if multiple Fly.io machines) is acceptable to defer — each machine tracks its own failure count.

### Critical — llm.provider.failover audit event already defined

`'llm.provider.failover'` is ALREADY in `AUDIT_EVENT_TYPES` at line 62 of `apps/api/src/audit/audit.types.ts`. Do NOT add it again. No migration needed.

### Critical — agents/ boundary lint rules

Architecture §2.2 hard rules (enforced by `eslint-plugin-boundaries`):
- Files in `agents/` **cannot** import from `fastify`, `routes/`, or any `.routes.ts`
- Files in `agents/` **cannot** import Supabase client or any plugin SDK directly
- The orchestrator receives services via constructor injection — it does NOT import services from their module paths directly. However, it DOES import **types** (`import type`) which is acceptable.
- `OpenAIAdapter` receives the `OpenAI` client via constructor (from the hook) — it does NOT import `openai` SDK directly at module level in agent files that aren't adapters. The adapter file itself (`openai.adapter.ts`) is the one exception where `openai` SDK types appear.

### Pattern — Hook registration (follow exactly from Story 3.1)

`allergy-guardrail.hook.ts` is the template:
- `fp()` from `fastify-plugin` to unwrap encapsulation
- Dependency assertions at top of plugin function (if `!fastify.dependency`) throw Error
- `fastify.decorate('orchestrator', orchestrator)`
- Register in `app.ts` after all dependencies (after line ~91 where `allergyGuardrailHook` registers)

Current `app.ts` registration order:
1. otelPlugin, requestIdPlugin
2. vaultPlugin, supabasePlugin, openaiPlugin, elevenlabsPlugin, stripePlugin, sendgridPlugin, twilioPlugin, ioredisPlugin, bullmqPlugin
3. auditHook, memoryHook, allergyGuardrailHook, auditPartitionRotationPlugin
4. **Add `orchestratorHook` here**
5. cookie, jwt, authenticateHook, householdScopeHook, sensible, websocket, cors
6. Routes

### Pattern — Pino logger in orchestrator

Architecture §5.6: use `request.log` in route handlers; for non-route contexts (like the orchestrator), accept a Pino child logger via constructor. In the hook: `fastify.log` is the root Pino logger — pass it as the `logger` arg. The orchestrator should log:
- `logger.warn({ provider: name, reason }, 'circuit breaker opened — swapping provider')`
- `logger.info({ provider: name }, 'primary provider recovered')`
- `logger.error({ from, to, reason }, 'llm provider failover triggered')`

Never use `console.*` — the Pino logger is the only channel.

### Pattern — `NotImplementedError`

Check `apps/api/src/common/errors.ts` before adding `NotImplementedError`. If it doesn't exist, add it in this story (it's needed by `AnthropicAdapter`). If it does exist, import it — don't create a duplicate.

### Pattern — Tool Schema Conversion (OpenAI format)

The `openai` SDK (v4) expects tools in this format for function-calling:
```typescript
{
  type: 'function',
  function: {
    name: 'allergy.check',
    description: '...',
    parameters: { type: 'object', properties: {...}, required: [...] }
  }
}
```

`ToolSpec.inputSchema` is a `ZodTypeAny`. You need to convert it to JSON Schema format. Check if `zod-to-json-schema` is in `apps/api/package.json`. If yes, use it. If not, a minimal inline converter is acceptable for the Zod schemas used by `allergy.check` (z.object with z.string, z.array) and `memory.note` — but note this is a hotspot for a follow-up if more complex schemas land in Story 3.4.

Easiest check: `ls apps/api/node_modules | grep zod-to-json-schema` or look at `package.json`. If not installed, add it with `pnpm add zod-to-json-schema --filter @hivekitchen/api`.

### Project Structure Notes

**New files:**
```
apps/api/src/agents/
  providers/
    llm-provider.interface.ts    SDK-agnostic LLMProvider interface + LLMResponse/LLMStreamEvent types
    openai.adapter.ts            OpenAIAdapter implements LLMProvider (uses openai ^4.0.0)
    anthropic.adapter.ts         AnthropicAdapter stub — throws NotImplementedError
  circuit-breaker.ts            CircuitBreaker class (no external deps)
  orchestrator.ts               DomainOrchestrator — circuit-breaker + tool wiring
  orchestrator.hook.ts          fp() Fastify plugin, fastify.decorate('orchestrator')

  providers/openai.adapter.test.ts
  circuit-breaker.test.ts
  orchestrator.test.ts
```

**Modified files:**
```
apps/api/src/agents/tools.manifest.ts
  → No source changes needed — orchestrator.ts calls TOOL_MANIFEST.set() at runtime

apps/api/src/types/fastify.d.ts
  → Add DomainOrchestrator import + orchestrator: DomainOrchestrator field

apps/api/src/app.ts
  → Import orchestratorHook + register after allergyGuardrailHook (~line 91)

apps/api/src/common/errors.ts
  → Add NotImplementedError if not already present
```

No contracts changes needed. No migration needed.

### References

- Architecture §Pre-Step-1 Rulings — Safety Architecture (orchestrator boundary) [Source: `_bmad-output/planning-artifacts/architecture.md`]
- Architecture §Starter Template — OpenAI Agents SDK as internal runtime behind LLMProvider adapter [Source: `_bmad-output/planning-artifacts/architecture.md`]
- Architecture §Core Decisions — AI: OpenAI Agents SDK + LLMProvider adapter (Branch-C hybrid); failover NFR [Source: `_bmad-output/planning-artifacts/architecture.md`]
- Architecture §3.5 — Tool-latency manifest + `maxLatencyMs` declarations [Source: `_bmad-output/planning-artifacts/architecture.md`]
- Architecture §2.2 — `apps/api` internal layout; `agents/` boundary lint rules [Source: `_bmad-output/planning-artifacts/architecture.md`]
- Architecture §Integration — LLM provider failover path (amendment GG): 5 failures in 60s → swap, 15-min probe recovery, audit `llm.provider.failover` [Source: `_bmad-output/planning-artifacts/architecture.md`]
- Epic 3, Story 3.2 acceptance criteria [Source: `_bmad-output/planning-artifacts/epics.md`]
- Story 3.1 completion notes — hook registration pattern (fp(), decorate, app.ts order), tool stub pattern [Source: `_bmad-output/implementation-artifacts/3-1-*.md`]
- Existing hook pattern — `apps/api/src/modules/allergy-guardrail/allergy-guardrail.hook.ts`
- Existing tool factories — `apps/api/src/agents/tools/allergy.tools.ts`, `memory.tools.ts`
- Existing TOOL_MANIFEST — `apps/api/src/agents/tools.manifest.ts` (stubs await Story 3.2 wiring)
- Existing registration order — `apps/api/src/app.ts` lines 89–92
- `llm.provider.failover` already in `AUDIT_EVENT_TYPES` — `apps/api/src/audit/audit.types.ts:62`

---

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List
