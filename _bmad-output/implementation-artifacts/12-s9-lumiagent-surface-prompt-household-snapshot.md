# Story 12-S9: LumiAgent — Surface Prompt Dispatch + Household Snapshot

Status: done

## Story

As a Primary Parent using HiveKitchen,
I want Lumi to respond with contextual awareness of my surface, my family, and our conversation history,
so that the ambient companion feels genuinely present and knowledgeable on every screen.

## Acceptance Criteria

1. **Given** any non-onboarding surface, **When** I type a message in the LumiPanel, **Then** the response is produced by the real `LumiAgent` (not the "Got it." stub) and references my household — child names, active allergens, or plan context — rather than giving a generic reply.

2. **Given** the surface is `planning`, **When** I ask "what should we have Tuesday?", **Then** Lumi's response demonstrates surface-specific framing (planning vocabulary: days of the week, dish names, swap suggestions) consistent with the `planning` surface prompt.

3. **Given** the surface is `grocery-list`, **When** I ask "what do I still need?", **Then** Lumi's response demonstrates surface-specific framing (grocery vocabulary: items, store, list categories) consistent with the `grocery-list` surface prompt, NOT planning vocabulary.

4. **Given** a household with children and active allergens, **When** LumiAgent responds, **Then** the assembled system prompt includes a `# Household Snapshot` block containing the household display name, each child's first name + age band + active allergens in a readable format — assembled by the API before the agent call; the agent never reads the DB directly.

5. **Given** a prior conversation exists on this surface thread, **When** the parent sends a new message, **Then** the last ≤20 turns of the thread are included in the OpenAI messages array (before the current user turn), giving Lumi conversation memory on that surface.

6. **Given** a request on the `planning` surface and a separate request on `grocery-list`, **When** both are submitted, **Then** each response is shaped by its surface's prompt; neither surface thread crosses into the other (thread isolation is preserved from 12-S8).

7. **Given** the `LumiAgent` class, **When** it calls OpenAI, **Then** it assembles the system prompt in this exact order:
   - `lumi_base_persona` (from `lumi-base.prompt.ts`)
   - surface-specific instructions (from `agents/prompts/surfaces/{surface}.ts`)
   - `# Household Snapshot` block (injected by the service, passed to `respond()`)
   - `# Current Surface` block (from `context_signal`)
   - `# Recent Actions` block (from `context_signal.recent_actions`, if any)

8. **Given** the `OnboardingAgent` exists and uses the same "You are Lumi" persona, **When** `lumi-base.prompt.ts` is extracted and referenced, **Then** all existing onboarding agent tests still pass — the refactor must not change onboarding prompt output.

9. **Given** the onboarding guard from 12-S8, **When** `POST /v1/lumi/turns` is called with `surface === 'onboarding'`, **Then** the API still returns 400 with `type: '/errors/validation'` (unchanged).

10. **Given** a surface directory `apps/api/src/agents/prompts/surfaces/`, **Then** all seven surfaces defined in `LumiSurfaceSchema` — `planning`, `meal-detail`, `child-profile`, `grocery-list`, `evening-check-in`, `heart-note`, `general` — have a dedicated `.ts` file exporting `getSurfacePrompt(): string`.

## Tasks / Subtasks

- [x] Task 1 — Extract `lumi-base.prompt.ts` (AC: #8, #7)
  - [x] Create `apps/api/src/agents/prompts/lumi-base.prompt.ts` exporting:
    ```ts
    // Core Lumi persona — shared across ambient Lumi (LumiAgent) and
    // onboarding (OnboardingAgent). Keep concise; surface-specific tasks
    // are added by each consumer on top of this base.
    export const LUMI_BASE_PERSONA = `
    You are Lumi, a warm and knowledgeable family lunch companion. You know this family — their
    children by name, their allergen constraints, their cultural food traditions, and their
    weekly rhythms. You speak with warmth, specificity, and quiet confidence — always for this
    particular family, never generically. You are not a chatbot; you are the intelligence behind
    their kitchen. When you don't have enough information to be specific, be honest about it
    briefly and then be as helpful as possible with what you do know.
    `;
    ```
  - [x] In `apps/api/src/agents/prompts/onboarding.prompt.ts`, import `LUMI_BASE_PERSONA` and prepend it to `ONBOARDING_CORE_VOICE` and `ONBOARDING_CORE_TEXT_V2` where "You are Lumi" currently begins:
    - `ONBOARDING_CORE_VOICE`: Replace the opening "You are Lumi, a warm and knowledgeable family lunch companion. Your job right now is to learn about this family through a short, natural conversation." with `${LUMI_BASE_PERSONA}\nYour job right now is to learn about this family through a short, natural conversation.`
    - `ONBOARDING_CORE_TEXT_V2`: Same surgery — keep everything after the first sentence (the moment structure) intact; replace only the identity sentence with a `${LUMI_BASE_PERSONA}` injection.
    - **Regression guard**: Verify that `getOnboardingSystemPrompt('voice')` and `getOnboardingSystemPrompt('text')` still return strings containing all the same domain-specific onboarding content (moments, chip handling, tool routing, etc.). Running `pnpm test --filter=@hivekitchen/api -- onboarding` should pass unchanged.
  - [x] Add a simple test to `apps/api/src/agents/prompts/onboarding.prompt.test.ts` verifying that `getOnboardingSystemPrompt('text')` still contains `"[NEXT_MOMENT:"` and `"You are Lumi"` (regression guard for the base-persona extraction).

- [x] Task 2 — Create surface prompt files (AC: #10, #2, #3, #7)
  - [x] Create directory `apps/api/src/agents/prompts/surfaces/`
  - [x] Create one file per surface, each exporting `getSurfacePrompt(): string`. The prompt should tell Lumi what the user is looking at, what kinds of questions are typical on this surface, and how to frame answers. Do NOT replicate the base persona here — it is already in the system prompt. Keep each surface prompt focused and under 200 words:
    - `planning.prompt.ts` — Lumi is on the weekly plan canvas. Questions are about specific days, dish choices, swaps, allergen clearance, and next-week planning. Reference the snapshot's plan context (Tuesday's dish, active allergens) when available.
    - `meal-detail.prompt.ts` — Lumi is on a specific meal's detail view. Questions are about that meal's recipe, ingredients, prep steps, and whether a child will like it.
    - `child-profile.prompt.ts` — Lumi is on a child's profile or flavor passport. Questions are about that child's preferences, progress, and allergen profile.
    - `grocery-list.prompt.ts` — Lumi is on the grocery/pantry view. Questions are about what to buy, what's already stocked, and how to organize the shop.
    - `evening-check-in.prompt.ts` — Lumi is on the evening check-in surface. Questions are about how today went, how the lunch landed, and what to adjust.
    - `heart-note.prompt.ts` — Lumi is on the heart note composition surface. Questions are about writing a note for a child or grandparent, choosing a warm tone, or reviewing draft text.
    - `general.prompt.ts` — Fallback surface. Lumi is on the home screen or an unspecified route. Answer broadly; help with whatever the parent is thinking about.
  - [x] Add a smoke test to `apps/api/src/agents/lumi.agent.test.ts` verifying that `getSurfacePrompt()` from each of the 7 surface files returns a non-empty string (import and call them; no OpenAI call required).

- [x] Task 3 — Refactor `LumiAgent` with real LLM dispatch (AC: #1, #7, #5)
  - [x] In `apps/api/src/agents/lumi.agent.ts`, replace the stub class with the real implementation:
    ```ts
    import OpenAI from 'openai';
    import type { LumiSurface, LumiContextSignal, Turn } from '@hivekitchen/types';
    import { LUMI_BASE_PERSONA } from './prompts/lumi-base.prompt.js';
    import { getSurfacePrompt } from './prompts/surfaces/index.js';

    export interface LumiAgentRespondInput {
      message: string;
      surface: LumiSurface;
      contextSignal: LumiContextSignal | null;
      conversationHistory: Turn[];  // prior turns, up to last 20 (S8 getThreadTurns)
      householdSnapshot: string;    // assembled by LumiService.fetchHouseholdSnapshot()
      modality: 'text' | 'voice';
    }

    const LUMI_MODEL = 'gpt-4o';
    const LUMI_MAX_TOKENS = 400;
    const LUMI_TEMPERATURE = 0.7;

    export class LumiAgent {
      constructor(private readonly openai: OpenAI) {}

      async respond(input: LumiAgentRespondInput): Promise<string> {
        const systemPrompt = this.buildSystemPrompt(input);
        const messages = this.buildMessages(systemPrompt, input.conversationHistory, input.message);

        const completion = await this.openai.chat.completions.create({
          model: LUMI_MODEL,
          messages,
          temperature: LUMI_TEMPERATURE,
          max_tokens: LUMI_MAX_TOKENS,
        });

        return completion.choices[0]?.message?.content
          ?? 'Let me think about that for a moment.';
      }

      private buildSystemPrompt(input: LumiAgentRespondInput): string {
        const parts: string[] = [
          LUMI_BASE_PERSONA.trim(),
          getSurfacePrompt(input.surface).trim(),
        ];

        if (input.householdSnapshot.length > 0) {
          parts.push(`\n# Household Snapshot\n${input.householdSnapshot}`);
        }

        if (input.contextSignal !== null) {
          const ctx: string[] = [`Surface: ${input.contextSignal.surface}`];
          if (input.contextSignal.entity_type !== undefined) {
            ctx.push(`Viewing: ${input.contextSignal.entity_type}${input.contextSignal.entity_summary !== undefined ? ` — ${input.contextSignal.entity_summary}` : ''}`);
          }
          parts.push(`\n# Current Surface\n${ctx.join('\n')}`);

          if (input.contextSignal.recent_actions !== undefined && input.contextSignal.recent_actions.length > 0) {
            parts.push(`\n# Recent Actions\n${input.contextSignal.recent_actions.map(a => `- ${a}`).join('\n')}`);
          }
        }

        return parts.join('\n');
      }

      private buildMessages(
        systemPrompt: string,
        history: Turn[],
        currentMessage: string,
      ): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
        const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
          { role: 'system', content: systemPrompt },
        ];

        // Inject prior turns as conversation history. Only 'user' and 'lumi' roles
        // translate to OpenAI roles ('lumi' → 'assistant'). System turns are skipped.
        for (const turn of history) {
          if (turn.role === 'user') {
            const content = turn.body.type === 'message' ? turn.body.content : '';
            if (content) messages.push({ role: 'user', content });
          } else if (turn.role === 'lumi') {
            const content = turn.body.type === 'message' ? turn.body.content : '';
            if (content) messages.push({ role: 'assistant', content });
          }
        }

        // Current user message (not yet persisted when respond() is called)
        messages.push({ role: 'user', content: currentMessage });
        return messages;
      }
    }
    ```
  - [x] Create `apps/api/src/agents/prompts/surfaces/index.ts` that exports `getSurfacePrompt(surface: LumiSurface): string`:
    ```ts
    import type { LumiSurface } from '@hivekitchen/types';
    import { getSurfacePrompt as planning } from './planning.prompt.js';
    import { getSurfacePrompt as mealDetail } from './meal-detail.prompt.js';
    import { getSurfacePrompt as childProfile } from './child-profile.prompt.js';
    import { getSurfacePrompt as groceryList } from './grocery-list.prompt.js';
    import { getSurfacePrompt as eveningCheckIn } from './evening-check-in.prompt.js';
    import { getSurfacePrompt as heartNote } from './heart-note.prompt.js';
    import { getSurfacePrompt as general } from './general.prompt.js';

    const SURFACE_PROMPTS: Record<LumiSurface, () => string> = {
      planning,
      'meal-detail': mealDetail,
      'child-profile': childProfile,
      'grocery-list': groceryList,
      'evening-check-in': eveningCheckIn,
      'heart-note': heartNote,
      general,
      onboarding: general,  // should never be reached (assertAmbientSurface guard)
    };

    export function getSurfacePrompt(surface: LumiSurface): string {
      return (SURFACE_PROMPTS[surface] ?? SURFACE_PROMPTS.general)();
    }
    ```

- [x] Task 4 — Add household snapshot fetching to `LumiRepository` and `LumiService` (AC: #4)
  - [x] In `apps/api/src/modules/lumi/lumi.repository.ts`, add:
    ```ts
    async getHouseholdDisplayName(householdId: string): Promise<string | null> {
      const { data, error } = await this.client
        .from('households')
        .select('display_name')
        .eq('id', householdId)
        .maybeSingle();
      if (error) throw error;
      return (data as { display_name: string | null } | null)?.display_name ?? null;
    }
    ```
  - [x] In `apps/api/src/modules/lumi/lumi.service.ts`, extend `LumiServiceDeps`:
    ```ts
    import type OpenAI from 'openai';
    import type { ChildrenRepository } from '../children/children.repository.js';
    import type { ChildAllergensRepository } from '../children/child-allergens.repository.js';

    export interface LumiServiceDeps {
      repository: LumiRepository;
      redis: Redis;
      logger: FastifyBaseLogger;
      elevenLabsApiKey: string;
      voiceId: string;
      openai: OpenAI;                             // NEW — real LumiAgent dispatch
      childrenRepository: ChildrenRepository;     // NEW — for household snapshot
      childAllergensRepository: ChildAllergensRepository; // NEW — per-child allergens
    }
    ```
  - [x] Store new deps on `LumiService` (private readonly fields — same pattern as existing fields)
  - [x] Add private method `fetchHouseholdSnapshot(householdId: string): Promise<string>`:
    ```ts
    private async fetchHouseholdSnapshot(householdId: string): Promise<string> {
      const [displayName, children, allergenRows] = await Promise.all([
        this.repository.getHouseholdDisplayName(householdId),
        this.childrenRepository.findByHouseholdId(householdId),
        this.childAllergensRepository.findByHousehold(householdId),
      ]);

      // Build a child_id → allergen[] map
      const allergensByChild = new Map<string, string[]>();
      for (const { child_id, allergen } of allergenRows) {
        const list = allergensByChild.get(child_id) ?? [];
        list.push(allergen);
        allergensByChild.set(child_id, list);
      }

      const lines: string[] = [];
      if (displayName !== null) lines.push(`Family: ${displayName}`);
      for (const child of children) {
        const allergens = allergensByChild.get(child.id) ?? [];
        const allergenStr = allergens.length > 0
          ? `allergens: ${allergens.join(', ')}`
          : 'no known allergens';
        lines.push(`- ${child.name} (${child.age_band}) — ${allergenStr}`);
      }
      return lines.join('\n');
    }
    ```

- [x] Task 5 — Update `submitTextTurn` to pass full context to `LumiAgent` (AC: #1, #4, #5)
  - [x] In `apps/api/src/modules/lumi/lumi.service.ts`, update `submitTextTurn`:
    - Import `LumiAgent` and the new `LumiAgentRespondInput` type
    - After finding/creating the thread, fetch prior turns for context:
      ```ts
      const priorTurns = existing !== null
        ? await this.repository.getThreadTurns(thread.id, input.householdId)
        : [];
      ```
    - Fetch household snapshot in parallel (or sequentially before agent call):
      ```ts
      const householdSnapshot = await this.fetchHouseholdSnapshot(input.householdId);
      ```
    - Replace `new LumiAgent()` (no-arg stub) with `new LumiAgent(this.openai)` and call `respond()` with the full input:
      ```ts
      const agent = new LumiAgent(this.openai);
      const lumiText = await agent.respond({
        message: input.message,
        surface,
        contextSignal: input.contextSignal,
        conversationHistory: priorTurns,
        householdSnapshot,
        modality: 'text',
      });
      ```
  - [x] The return value and insertTurn calls are unchanged from S8.

- [x] Task 6 — Wire new deps in `lumi.routes.ts` (AC: #1)
  - [x] In `apps/api/src/modules/lumi/lumi.routes.ts`, add before `new LumiService(...)`:
    ```ts
    import { Buffer } from 'node:buffer';
    import { ChildAllergensRepository } from '../children/child-allergens.repository.js';
    import { ChildrenRepository } from '../children/children.repository.js';

    // inside lumiRoutes plugin:
    const kekHex = fastify.env.ENVELOPE_ENCRYPTION_MASTER_KEY;
    const kek = kekHex ? Buffer.from(kekHex, 'hex') : null;
    const childAllergensRepository = new ChildAllergensRepository(fastify.supabase, kek);
    const childrenRepository = new ChildrenRepository(
      fastify.supabase,
      kek,
      fastify.log,
      childAllergensRepository,
    );
    ```
  - [x] Add `openai: fastify.openai`, `childrenRepository`, and `childAllergensRepository` to the `LumiService` constructor call (alongside the existing `repository`, `redis`, `logger`, `elevenLabsApiKey`, `voiceId`).

- [x] Task 7 — Tests (AC: all)
  - [x] `apps/api/src/agents/lumi.agent.test.ts` — replace stub test, add:
    - Mock `OpenAI` client: create a fake client whose `chat.completions.create` resolves to `{ choices: [{ message: { content: 'Mocked response.' } }] }`
    - Test: `respond()` calls OpenAI with a `system` message containing `LUMI_BASE_PERSONA`
    - Test: `respond()` with `surface='planning'` includes the planning surface prompt in the system message
    - Test: `respond()` with `surface='grocery-list'` includes the grocery-list surface prompt (NOT planning)
    - Test: `respond()` with `householdSnapshot='Family: The Garcias\n- Sofia (child) — allergens: peanut'` includes that snapshot in the system message
    - Test: `respond()` with 2 prior `Turn` objects in `conversationHistory` produces 5 messages (system + 2 history user/lumi + current user)
    - Test: system messages in `conversationHistory` are skipped (not added to OpenAI messages)
    - Test: when OpenAI returns null content, `respond()` returns the fallback string `'Let me think about that for a moment.'`
    - Test: surface prompt smoke — all 7 `getSurfacePrompt(surface)` calls return non-empty strings
  - [x] `apps/api/src/modules/lumi/lumi.service.test.ts` (create if absent, or add to routes test) — add:
    - `fetchHouseholdSnapshot` unit: mock `repository.getHouseholdDisplayName`, `childrenRepository.findByHouseholdId`, `childAllergensRepository.findByHousehold` → assert snapshot string includes family name, child name, allergen
    - `fetchHouseholdSnapshot` handles empty children list gracefully (no crash)
    - `submitTextTurn` calls `agent.respond` with `surface`, `contextSignal`, and `conversationHistory` (mock the agent and assert it receives the full input)
  - [x] `apps/api/src/modules/lumi/lumi.routes.test.ts` — update `POST /turns` tests:
    - The mock `LumiService.submitTextTurn` stub returns the same shape as before — no change to response contract tests
    - Add: verify the 400 `onboarding` guard still returns 400 (unchanged from S8)
  - [x] `apps/api/src/agents/prompts/onboarding.prompt.test.ts` — add regression guard:
    - `getOnboardingSystemPrompt('text')` must include `'You are Lumi'`
    - `getOnboardingSystemPrompt('text')` must include `'[NEXT_MOMENT:'`
    - `getOnboardingSystemPrompt('voice')` must include `'[SESSION_COMPLETE]'`
    - These ensure the base-persona extraction didn't silently drop onboarding content

## Dev Notes

### CRITICAL: LumiAgent constructor change + DI refactor (S8 deferral closed in S9)

From 12-S8 Dev Notes §"LumiService dependency injection":
> For S8, the direct instantiation is deliberate — it keeps S8 simple and minimal, and **S9 owns the DI refactor into LumiServiceDeps**.

`lumi.agent.ts` currently: `constructor()` (no-arg). S9 changes it to `constructor(private readonly openai: OpenAI)`. The service `submitTextTurn` currently does `new LumiAgent()` — change to `new LumiAgent(this.openai)`.

`fastify.openai` is decorated by the `openaiPlugin` registered in `app.ts` before the lumi routes plugin. Pattern from `apps/api/src/plugins/openai.plugin.ts`:
```ts
const client = new OpenAI({ apiKey: fastify.env.OPENAI_API_KEY });
fastify.decorate('openai', client);
```
So `fastify.openai` is a real `OpenAI` instance in the route handler scope.

### System prompt assembly order (ADR-002 Decision 6 — canonical)

```
1. LUMI_BASE_PERSONA         ← who Lumi is (lumi-base.prompt.ts)
2. surface instructions       ← what she's looking at (surfaces/{surface}.prompt.ts)
3. # Household Snapshot       ← family name, children, allergens
4. # Current Surface          ← from contextSignal (entity_type, entity_summary)
5. # Recent Actions           ← from contextSignal.recent_actions (if any)
```

This order is intentional: base persona is the most stable (cache-hot), snapshot changes per household version, context signal changes every turn.

### Conversation history pattern

Fetch prior turns **before** inserting the new user turn. `getThreadTurns(threadId, householdId)` returns the last 20 turns in ascending order (newest last). This is the correct order for OpenAI message history. When `existing === null` (first message in thread), `priorTurns = []`.

```ts
// CORRECT: fetch before inserting user turn
const priorTurns = existing !== null
  ? await this.repository.getThreadTurns(thread.id, input.householdId)
  : [];
```

Do NOT fetch after inserting the user turn — the user's new turn would appear twice (once in history, once as `currentMessage`).

### KEK pattern in lumi.routes.ts

Follow the identical pattern from `households.routes.ts` lines 58–60:
```ts
const kekHex = fastify.env.ENVELOPE_ENCRYPTION_MASTER_KEY;
const kek = kekHex ? Buffer.from(kekHex, 'hex') : null;
```

Children names are envelope-encrypted in the DB — `ChildrenRepository.findByHouseholdId()` uses the `kek` to decrypt them. A null kek means "no encryption" (dev mode). Never hardcode or construct a kek directly.

`ChildrenRepository` 4-arg constructor (reconciliation from 12-S8 Dev Agent Record):
```ts
new ChildrenRepository(fastify.supabase, kek, fastify.log, childAllergensRepository)
```
The story snippet in older artifacts had 2 args — this is wrong. Use 4 args.

### OnboardingAgent refactor — regression safety

The ADR-002 Decision 6 says: "OnboardingAgent switched to use lumi-base.prompt.ts as its persona source — all existing onboarding behavior unchanged."

The extraction is **additive** — you are REMOVING the "You are Lumi, a warm and knowledgeable family lunch companion." opening sentence from `ONBOARDING_CORE_VOICE` and `ONBOARDING_CORE_TEXT_V2`, and PREPENDING `LUMI_BASE_PERSONA` in its place. The sentence already in the prompt and `LUMI_BASE_PERSONA` must convey the same identity — Lumi, warm, family lunch companion.

**Do NOT change** any of the following (regression guard):
- The five-moment structure in `ONBOARDING_CORE_TEXT_V2`
- The `[NEXT_MOMENT:<key>]` directive syntax
- The `TEXT_RULES` or `VOICE_RULES` blocks
- The `SESSION_COMPLETE_SENTINEL`
- `getOnboardingSystemPrompt()` return type/signature
- Any `OnboardingAgent` methods

Run `pnpm test --filter=@hivekitchen/api -- onboarding` before and after to confirm zero regressions.

### Zod 4 gotchas (retro action item #2 — document here)

The project-context.md says "Zod 3.23" but the actual installed version is **Zod 4**. Known footguns:
- `z.record()` requires two-arg form: `z.record(z.string(), z.SomeSchema())`. One-arg form throws.
- `z.string().uuid()` uses strict RFC-4122 validation. The variant nibble in the 4th group must be `8`, `9`, `a`, or `b`. A fixture using `4444-4444-4444-4444-444444444444` will fail.
- `z.string().datetime()` rejects Supabase offset timestamps (`+00:00` suffix). Normalize: `new Date(ts).toISOString()` before passing to a datetime-schema-validated field.

S9 itself does not add new Zod schemas, so these are informational for the dev agent's general awareness.

### hkFetch double-encoding trap (retro action item #3 — reminder)

`apps/web/src/lib/fetch.ts` internally calls `JSON.stringify(init.body)` when body is provided.
**Do NOT pass `JSON.stringify(body)` to hkFetch.** Pass the raw object. Passing a pre-stringified value double-encodes it and the API receives a string literal.

S9 has no new web fetch calls, but this is a standing note for any developer touching the web layer.

### Turn body content shape

Turns use `body.content` (not `body.text`). In `buildMessages()`:
```ts
const content = turn.body.type === 'message' ? turn.body.content : '';
```
Do not use `turn.body.text` — this field does not exist. (S8 reconciliation #4.)

### No new contracts, no new DB migrations

S9 is purely agent-layer + service layer. The `POST /v1/lumi/turns` contract (`LumiTurnRequestSchema`, `LumiTurnResponseSchema`) is unchanged. The DB schema is unchanged. No new Supabase migration.

### Model and temperature

`LUMI_MODEL = 'gpt-4o'` — flagship tier. Lumi's conversational quality justifies the cost. `LUMI_MAX_TOKENS = 400` — ambient panel responses should be concise; 400 is generous for the UI. `LUMI_TEMPERATURE = 0.7` — matches the onboarding agent (warmth, some variation).

No streaming in S9 — single-shot completion, same as `OnboardingAgent.respondSingleShot`. Streaming is a potential future enhancement.

### Test baseline (from 12-S8 done state)
- web: 395/395 — S9 has no web changes; baseline should hold
- api: 1428 pass / 19 fail (documented pre-existing baseline)
- contracts: lumi 48/48 — S9 adds no new contracts

S9 adds ~15–25 new API tests. The 19 pre-existing failures are in auth/children/extra-library/lunch-link/onboarding.tools/audit-parity-drift — NONE in the lumi/agent module. Confirm via `git stash` verify if ever in doubt.

### Manual test path (from Epic 12 vertical slices doc)

1. Seed test household with 2 children (e.g., Layla 7 + peanut allergy, Ayaan 4 + no allergens)
2. Generate a plan for the current week
3. On Brief (`surface='planning'`), ask "tell me about Tuesday" → response should cite Layla, peanut, and Tuesday's actual dish from the snapshot
4. Navigate to `/app/grocery-list` (`surface='grocery-list'`), ask "what do I still need?" → response should use grocery framing, NOT plan-day framing
5. Reload the Brief page → tap LumiOrb → both prior turns should still be visible (thread persistence unchanged from S8)
6. Open onboarding flow in dev mode → confirm OnboardingAgent still behaves identically (regression check on shared-persona extraction)

USER-SIDE GATE: none (no migration, no new bucket). Live stack + Supabase + OpenAI API key required for manual test path; unit tests do not require them.

### Project Structure Notes

**New files:**
- `apps/api/src/agents/prompts/lumi-base.prompt.ts`
- `apps/api/src/agents/prompts/surfaces/index.ts`
- `apps/api/src/agents/prompts/surfaces/planning.prompt.ts`
- `apps/api/src/agents/prompts/surfaces/meal-detail.prompt.ts`
- `apps/api/src/agents/prompts/surfaces/child-profile.prompt.ts`
- `apps/api/src/agents/prompts/surfaces/grocery-list.prompt.ts`
- `apps/api/src/agents/prompts/surfaces/evening-check-in.prompt.ts`
- `apps/api/src/agents/prompts/surfaces/heart-note.prompt.ts`
- `apps/api/src/agents/prompts/surfaces/general.prompt.ts`

**Modified files:**
- `apps/api/src/agents/lumi.agent.ts` — real LLM dispatch, full `LumiAgentRespondInput`, constructor takes `openai: OpenAI`
- `apps/api/src/agents/lumi.agent.test.ts` — replace stub test with real-agent tests (mock OpenAI client)
- `apps/api/src/agents/prompts/onboarding.prompt.ts` — import + use `LUMI_BASE_PERSONA`
- `apps/api/src/agents/prompts/onboarding.prompt.test.ts` — add 3 regression guard assertions
- `apps/api/src/modules/lumi/lumi.repository.ts` — add `getHouseholdDisplayName()`
- `apps/api/src/modules/lumi/lumi.service.ts` — extend `LumiServiceDeps` (openai, childrenRepo, childAllergensRepo); add private fields + `fetchHouseholdSnapshot()`; update `submitTextTurn()` to fetch history + snapshot + call real agent
- `apps/api/src/modules/lumi/lumi.routes.ts` — add kek/childrenRepository/childAllergensRepository wiring; pass `fastify.openai` to service
- `apps/api/src/modules/lumi/lumi.routes.test.ts` — update mocks for new `LumiServiceDeps` shape; add `lumi.service.test.ts` cases
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — status tracking

**No changes to:**
- `packages/contracts/src/lumi.ts` — contract is unchanged
- `packages/contracts/src/index.ts` — no new exports
- `apps/web/src/**` — no frontend changes (the LumiPanel + composer shipped in S8 are unchanged; real responses appear automatically via the API)
- `apps/api/src/modules/lumi/lumi.routes.ts` route handlers — response shape unchanged; only constructor call changes
- `apps/api/src/agents/onboarding.agent.ts` — no changes; uses `onboarding.prompt.ts` which internally references `LUMI_BASE_PERSONA`

### References

- [Source: `_bmad-output/planning-artifacts/epic-12-vertical-slices.md` §Slice 12-S9] — demo path, layer breakdown, manual test path
- [Source: `_bmad-output/planning-artifacts/adr-ambient-lumi.md` §Decision 6] — prompt assembly order, surface prompt directory structure, household snapshot spec
- [Source: `_bmad-output/implementation-artifacts/12-s8-ambient-text-turn-stub-agent.md` §Dev Notes] — LumiService DI deferral note, body.content shape, hkFetch note, conversation history invariants
- [Source: `apps/api/src/agents/lumi.agent.ts`] — current stub class (to be replaced)
- [Source: `apps/api/src/agents/onboarding.agent.ts`] — respondSingleShot/respondWithTools pattern for OpenAI call shape
- [Source: `apps/api/src/agents/prompts/onboarding.prompt.ts`] — `LUMI_BASE_PERSONA` extraction target; `getOnboardingSystemPrompt()` refactor target
- [Source: `apps/api/src/modules/lumi/lumi.service.ts`] — `LumiServiceDeps` interface, `submitTextTurn()`, `assertAmbientSurface()`
- [Source: `apps/api/src/modules/lumi/lumi.repository.ts`] — `getThreadTurns()`, `findActiveAmbientThread()`, `insertTurn()`
- [Source: `apps/api/src/modules/lumi/lumi.routes.ts`] — existing plugin, LumiService instantiation site
- [Source: `apps/api/src/plugins/openai.plugin.ts`] — `fastify.openai` decoration pattern
- [Source: `apps/api/src/modules/children/children.repository.ts`] — `findByHouseholdId()` signature, `DecryptedChildRow` shape (name, age_band, id)
- [Source: `apps/api/src/modules/children/child-allergens.repository.ts`] — `findByHousehold()` signature, `{ child_id, allergen }[]` return shape
- [Source: `apps/api/src/modules/households/households.repository.ts` lines 388–400] — `getDisplayName()` pattern for `display_name` select
- [Source: `apps/api/src/modules/children/children.routes.ts` lines 51–60] — kek init + ChildrenRepository 4-arg constructor pattern
- [Source: `_bmad-output/implementation-artifacts/epic-7-retro-2026-06-05.md` §Key Insights] — Zod 4 gotchas (z.record two-arg, .uuid() strict, .datetime() normalization); hkFetch double-encoding trap
- [Source: `_bmad-output/project-context.md`] — monorepo conventions, Fastify 5, ESM `.js` extensions, Zustand 5 curried create

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (Claude Opus 4.8, 1M context)

### Debug Log References

- Full API suite: 1617 pass / 20 fail / 13 skip. The 20 failures were confirmed
  PRE-EXISTING by stashing all S9 tracked changes and re-running: identical 20
  failures on baseline (auth ×7, children.repository ×3, extra-library ×3,
  onboarding.tools, audit-parity-drift, catalog-seed, households memory-200-case,
  lunch-link-dev, memory partial-seeding, plan-adjustment). NONE in lumi/agent.
- Typecheck: API reports 11 errors = documented baseline (≤14), 0 new in any S9
  file. All 11 are in pre-existing files (evals/runner ×3, voice ×4,
  households.routes.test, health.routes.test ×2, contracts heart-notes).

### Completion Notes List

Implemented all 10 ACs / 7 tasks. Real LumiAgent LLM dispatch (gpt-4o), 7 surface
prompts + dispatcher, LUMI_BASE_PERSONA extraction shared with OnboardingAgent,
household snapshot injected by the service, and last-≤20-turn conversation
history. 81 lumi/agent/onboarding tests green (16 agent + 6 service + the updated
routes suite + 19 onboarding-prompt). No migration, no new contracts, no web
changes.

**Spec reconciliations (surfaced per CLAUDE.md "don't pick silently"):**

1. **`LumiSurfaceSchema` has NINE members, not seven.** The story's Task-3
   `SURFACE_PROMPTS` record (`Record<LumiSurface, () => string>`) maps only 8
   keys (the 7 named surfaces + `onboarding → general`) and OMITS `brief`. Since
   `Record<LumiSurface,…>` is exhaustive, the story snippet as written would fail
   `tsc`. Reconciled by adding `brief: planning` — the Brief IS the weekly-plan
   ready-answer canvas (contract comment + the story's own manual-test path sends
   `surface='planning'` for the Brief), so planning vocabulary is the correct fit.
   `onboarding → general` kept (unreachable behind `assertAmbientSurface`).

2. **Conversation-history message count is 4, not "5".** AC#5 / Task-7 says "2
   prior Turn objects … produces 5 messages (system + 2 history + current user)".
   That parenthetical itself sums to 4 (1+2+1), which is what `buildMessages`
   actually emits. The agent test asserts the correct count (4) and documents the
   story's arithmetic slip inline.

3. **Onboarding persona extraction is surgical and additive.** Removed only the
   identity sentence from `ONBOARDING_CORE_VOICE` ("You are Lumi, a warm and
   knowledgeable family lunch companion.") and `ONBOARDING_CORE_TEXT_V2` ("You are
   Lumi, a warm family lunch companion.") and prepended `${LUMI_BASE_PERSONA}` in
   each. All onboarding domain content (5 moments, directives, tool routing, chip
   handling, rules) is untouched — verified by the unchanged 19-test
   onboarding.prompt suite plus 3 new base-persona regression guards.

4. **Routes test keeps the real-service architecture** (the existing suite wires
   the real `LumiService` against a mock Supabase, NOT a mocked service as the
   story's Task-7 note assumed). Extended `buildTestApp` to decorate a fake
   `fastify.openai` and `buildMockSupabase` to answer the new snapshot reads
   (`children` + `household_allergens` → `[]`; `households` already covered the
   `display_name` select). Updated the stale "Got it." assertion → the mocked
   agent reply, and added `threadOwnershipRow` to the thread-reuse test (reusing a
   thread now triggers `getThreadTurns`, which runs an ownership check).

**Conversation-history ordering:** prior turns are fetched BEFORE the new user
turn is inserted (and only when an existing thread was found), so the current
message never appears twice in the OpenAI messages array.

### File List

**New:**
- `apps/api/src/agents/prompts/lumi-base.prompt.ts`
- `apps/api/src/agents/prompts/surfaces/index.ts`
- `apps/api/src/agents/prompts/surfaces/planning.prompt.ts`
- `apps/api/src/agents/prompts/surfaces/meal-detail.prompt.ts`
- `apps/api/src/agents/prompts/surfaces/child-profile.prompt.ts`
- `apps/api/src/agents/prompts/surfaces/grocery-list.prompt.ts`
- `apps/api/src/agents/prompts/surfaces/evening-check-in.prompt.ts`
- `apps/api/src/agents/prompts/surfaces/heart-note.prompt.ts`
- `apps/api/src/agents/prompts/surfaces/general.prompt.ts`
- `apps/api/src/modules/lumi/lumi.service.test.ts`

**Modified:**
- `apps/api/src/agents/lumi.agent.ts` — real LLM dispatch; constructor takes `openai: OpenAI`
- `apps/api/src/agents/lumi.agent.test.ts` — replaced stub test with real-agent + surface-smoke tests (mock OpenAI)
- `apps/api/src/agents/prompts/onboarding.prompt.ts` — import + prepend `LUMI_BASE_PERSONA`
- `apps/api/src/agents/prompts/onboarding.prompt.test.ts` — +3 base-persona regression guards
- `apps/api/src/modules/lumi/lumi.repository.ts` — `getHouseholdDisplayName()`
- `apps/api/src/modules/lumi/lumi.service.ts` — extend `LumiServiceDeps`; `fetchHouseholdSnapshot()`; real-agent `submitTextTurn()`
- `apps/api/src/modules/lumi/lumi.routes.ts` — kek + children/childAllergens repos + `fastify.openai` wiring
- `apps/api/src/modules/lumi/lumi.routes.test.ts` — fake openai + snapshot-table mocks; updated reply assertion
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — status tracking

### Review Findings

_Code review 2026-06-05 — 3-layer adversarial (Blind Hunter + Edge Case Hunter + Acceptance Auditor)_

**Decision needed (resolve before patching):**
- [x] [Review][Decision] D1 — Household-wide allergens (`child_id=null`) possibly dropped from snapshot — `ChildAllergensRepository.findByHousehold` may filter out rows where `child_id IS NULL` (household-scoped allergens). If such rows exist after the 2.6-s8 cutover, Lumi's prompt omits them and may suggest allergen-unsafe dishes. Needs schema verification: do `child_allergens` rows with `child_id=null` exist? If yes, snapshot must include them. [`apps/api/src/modules/lumi/lumi.service.ts`, `apps/api/src/modules/children/child-allergens.repository.ts`]
- [x] [Review][Decision] D2 — AC8 intentionality: onboarding prompt output materially changed — `LUMI_BASE_PERSONA` prepended to `ONBOARDING_CORE_VOICE` and `ONBOARDING_CORE_TEXT_V2` adds new prose ("...cultural food traditions...weekly rhythms...not a chatbot...intelligence behind their kitchen...") not in the original single identity sentence. Tests pass via substring check only (`toContain('You are Lumi')`). AC8 says "must not change onboarding prompt output." Decision: accept as intentional persona unification (update AC8 wording) or revert to exact-sentence swap? [`apps/api/src/agents/prompts/onboarding.prompt.ts`, `apps/api/src/agents/prompts/onboarding.prompt.test.ts`]

**Patch:**
- [x] [Review][Patch] P1 — Duplicate `# Current Surface` heading — surface prompt files each open with `# Current Surface — <Name>` (e.g. `planning.prompt.ts:6`), but `buildSystemPrompt` also appends a `# Current Surface` block from `context_signal` (AC7 / ADR-002 Decision 6). The assembled prompt contains two `# Current Surface` sections. Rename the surface prompt heading (e.g. `## Surface Role`) to avoid the collision. [`apps/api/src/agents/prompts/surfaces/*.prompt.ts`, `apps/api/src/agents/lumi.agent.ts`]

**Deferred (pre-existing or design decisions):**
- [x] [Review][Defer] DR1 — User turn orphaned when `agent.respond()` throws (no rollback) [`apps/api/src/modules/lumi/lumi.service.ts:187-209`] — deferred, pre-existing (explicitly deferred from 12-S8 review: "user-turn orphan on agent failure")
- [x] [Review][Defer] DR2 — Retry duplicates user message in OpenAI history (consequence of DR1) [`apps/api/src/modules/lumi/lumi.service.ts:181-202`] — deferred, pre-existing (follows from DR1 deferral)
- [x] [Review][Defer] DR3 — Fallback reply (`'Let me think about that for a moment.'`) persisted as a real Lumi turn with no error signal when OpenAI returns null/empty content [`apps/api/src/agents/lumi.agent.ts:42`] — deferred, design choice (intentional graceful degradation per MVP scope)
- [x] [Review][Defer] DR4 — TOCTOU between `findActiveAmbientThread` and `getThreadTurns`: stale thread could be closed concurrently, producing a spurious 403 on a legitimate request [`apps/api/src/modules/lumi/lumi.repository.ts:31-55`] — deferred, pre-existing codebase-wide pattern
- [x] [Review][Defer] DR5 — Empty snapshot silently emitted when household has no display name and no children; Lumi answers personalized surfaces with zero household context and no indication [`apps/api/src/modules/lumi/lumi.service.ts:218-241`] — deferred, graceful degraded mode by design (no crash; expected for incomplete households)

## Change Log

| Date       | Change                                                                 |
|------------|------------------------------------------------------------------------|
| 2026-06-05 | Implemented 12-S9: real LumiAgent (gpt-4o) surface-prompt dispatch across 7 surfaces, LUMI_BASE_PERSONA extraction, household snapshot, ≤20-turn history. 10/10 ACs, 7/7 tasks. Status → review. |
| 2026-06-05 | Code review: 3-layer adversarial pass. 2 decision-needed, 1 patch, 5 deferred, 7 dismissed. |
| 2026-06-05 | Post-review patches applied: D1 (switched to `HouseholdAllergensRepository.findByHouseholdId`, handle `child_id=null` as Kitchen allergens line), D2 (reverted `LUMI_BASE_PERSONA` injection in onboarding prompts — restored standalone identity sentences), P1 (renamed `# Current Surface — <Name>` to `## Surface Instructions — <Name>` in 7 surface prompt files). 70/70 lumi/agent/onboarding tests pass. Status → done. |
