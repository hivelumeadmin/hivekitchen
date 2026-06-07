# Story 5-S6: Latency Doctrine — Early-Ack Primitive + Filler-Phrase Lint

Status: done

<!-- folds: 5.8 (early-ack / sync-vs-async split), 5.10 (filler-phrase lint) -->
<!-- cited PRD: AR-14, AR-15, FR63 partial -->
<!-- DECISIONS (Menon, 2026-06-07): (1) Deliverable D (early-ack continuation transport) DEFERRED — confirmed. (2) FOLDED into Epic 12 domain for tracking; 5-s6 key/file retained to preserve the ready-for-dev flow (physical renumber to 12-sNN available on request — no code impact). (3) LUMI_FALLBACK_REPLY revised to a calmer reasoning-toned copy (see Task 1.6 / AC#3). -->
<!-- slice source: _bmad-output/planning-artifacts/epic-5-vertical-slices.md §"Slice 5-S6" -->
<!-- architecture source: _bmad-output/planning-artifacts/architecture.md §3.5 -->

## Story

As a parent talking to Lumi by voice,
I want Lumi to give a calm non-verbal "thinking" signal while she works rather than a chirpy "Let me pull that up…",
so that waiting feels like a person thinking, not an assistant performing —
and as a developer, I want the codebase to make the chirpy-filler anti-pattern **impossible to merge** (CI-enforced) and the sync-vs-early-ack latency decision to live in **one tested primitive** keyed off the tool-latency manifest.

---

## ⚠️ READ FIRST — Scope reconciliation (codebase reality vs. architecture §3.5)

**This slice was specced against an architecture that no longer matches the code. Read this before writing anything.**

Architecture §3.5 (and epic story 5.8) describe early-ack as: *"the orchestrator sums `maxLatencyMs` of the expected tool chain; ≤6000ms → synchronous webhook response; >6000ms → early-ack `{response: "one sec.", continuation: {resume_token, expected_within_ms}}` delivered async; ElevenLabs plays the acknowledgement first, then the continuation."*

That model assumed **two things that are now false**:

1. **The ElevenLabs ConvAI Agent + `POST /v1/webhooks/elevenlabs` synchronous-webhook transport** — **deprecated 2026-06-07** (see architecture.md §3.4/§3.5 banner, story 5-S5 Completion Notes). HiveKitchen now owns its own voice WebSocket; there is no webhook to "respond synchronously" to.
2. **A real-time conversational orchestrator that fans out to a budgeted tool chain.** It does not exist. Both conversational agents are **single-shot OpenAI completions with no tool-calling**:
   - `LumiAgent.respond()` (`apps/api/src/agents/lumi.agent.ts:43`) — one `chat.completions.create`, no tools.
   - `OnboardingAgent.respond()` — same shape.
   - The **only** tool-calling, `maxLatencyMs`-budgeting orchestrator is `DomainOrchestrator.planWeek()` / `swapBlockedItems()` — and that runs as a **background BullMQ job**, not a live turn a user is waiting on. (Its own code comment confirms the design intent: *"When Lumi voice/chat orchestration arrives (Epic 12 phase 2+)…"* — `orchestrator.ts:500`.)

**Consequence:** in today's code, a live voice turn's estimated tool-chain latency is effectively **0ms** — the `>6000ms` early-ack branch has **no real query that can trigger it**. The single real latency gap a parent experiences is the **STT→reply gap** (the `LumiAgent.respond` OpenAI call between the `transcript` frame and `response.start` in `lumi.service.processVoiceUtterance`, `lumi.service.ts:223–245`), which is ~1–3s.

**What this story therefore ships (the honest, demoable, non-speculative subset):**

| # | Deliverable | Status in this slice |
|---|---|---|
| A | `no-assistant-filler` ESLint rule (folds 5.10-lint) | **Ship — fully demoable, CI-enforced** |
| B | `latency-doctrine` primitive — pure, tested `classifyLatency()` over `TOOL_MANIFEST.maxLatencyMs` + the sanctioned `"one sec."` copy constant (folds 5.8 budget logic) | **Ship — tested primitive ahead of consumer** |
| C | Non-verbal `lumi.thinking` orb-pulse, wired LIVE into the ambient Lumi voice WS path for the real STT→reply gap | **Ship — demoable non-verbal signal** |
| D | Full early-ack **continuation transport** (`>6000ms → "one sec." now, real answer later over thread SSE` w/ `resume_token` + `expected_within_ms`) | **DEFER — see WALL below** |

> Shipping a tested primitive ahead of its live consumer is an established pattern in this repo — see `7-s13-payload-scrubbing-primitive` ("built but unused at MVP — no caller wires it in yet"). Deliverable B follows that precedent.

**🚧 WALL — RESOLVED (Menon, 2026-06-07): Deliverable D is DEFERRED.** It builds an async-continuation transport for a consumer (a real-time tool-calling conversational orchestrator) that **does not exist yet**. Per CLAUDE.md §2 ("Nothing speculative. No abstractions for single-use code.") it waits until that orchestrator lands (Epic 12 phase 2+). The primitive (B) + the early-ack frame contract (Task 3.2) ship now so the future wiring is additive. See "Decisions" at the bottom of this file.

---

## Acceptance Criteria

### Filler-phrase lint (folds 5.10)

1. **Given** the shared ESLint config (`@hivekitchen/eslint-config`), **When** any source file under `apps/*/src/**` contains a string literal (or template literal) matching an assistant-theatrical waiting-filler — e.g. `"Let me pull that up"`, `"Just a moment"`, `"Hang on a sec"`, `"Bear with me"`, `"Let me look that up"`, `"Give me a moment"` — **Then** `pnpm lint` reports a `hivekitchen/no-assistant-filler` error on that literal, and CI fails.

2. **Given** the `no-assistant-filler` rule, **When** a literal contains the **sanctioned** early-ack copy `"one sec."` (the §3.5 parent-authored-feeling acknowledgement), **Then** the rule does **NOT** flag it. (Exactly one waiting phrase is sanctioned; everything theatrical is forbidden.)

3. **Given** the rule ships, **When** `pnpm lint` runs across the **existing** `apps/api` + `apps/web` source as-is, **Then** there are **zero new violations**. As part of this slice, `LUMI_FALLBACK_REPLY` at `lumi.agent.ts:31` is **revised** from `'Let me think about that for a moment.'` to the calmer reasoning-toned `'Let me think that through.'` (Menon decision, 2026-06-07) — and the new value must NOT match the `no-assistant-filler` regex. (Also sweep for any other incidental literals — test fixtures, prompt strings — that trip the rule; see Dev Notes "Regex + existing copy".)

### Latency-doctrine primitive (folds 5.8 budget logic)

4. **Given** a list of tool names, **When** `classifyLatency(toolNames)` is called, **Then** it sums each tool's `maxLatencyMs` from `TOOL_MANIFEST` plus the §3.5 fixed overhead (200ms thread load + 300ms intent classification + 500ms audit/persist = **1000ms base**) and returns `{ estimatedMs, mode, expectedWithinMs }` where:
   - `estimatedMs ≤ 6000` → `mode: 'sync'`
   - `estimatedMs` in `[1500, 4000]` → `mode: 'thinking-pulse'` (non-verbal orb pulse band, still within the sync ceiling)
   - `estimatedMs > 6000` → `mode: 'early-ack'`, with `expectedWithinMs = estimatedMs`
   - An unknown tool name (absent from `TOOL_MANIFEST`) throws (mirrors the §3.5 "any tool without a declaration fails" contract — the manifest is the source of truth).

   > Band note: `sync` and `thinking-pulse` are not mutually exclusive outcomes of two separate ceilings — `thinking-pulse` is the **sub-band of sync** where the wait is long enough (≥1500ms) to warrant a non-verbal signal but short enough (≤4000ms, ≤6000ms total) to still answer in one turn. Resolve precedence as: `>6000 → early-ack`; else `≥1500 → thinking-pulse`; else `sync`.

5. **Given** the primitive module, **When** other code needs the acknowledgement copy, **Then** it imports the single exported constant `EARLY_ACK_COPY = 'one sec.'` (no other module hardcodes a waiting phrase — this is the one allowed by the lint rule via AC#2).

### Non-verbal thinking pulse (folds 5.8 orb-pulse layer)

6. **Given** an active ambient Lumi **voice** session, **When** the server has emitted the `transcript` frame and is about to run the reply generation (the STT→reply gap in `lumi.service.processVoiceUtterance`), **Then** the server emits a `{ type: 'lumi.thinking', seq }` WS frame **before** `submitTextTurn`, and emits nothing spoken in that gap.

7. **Given** the client receives a `lumi.thinking` frame, **When** it renders, **Then** the LumiOrb shows a non-verbal "thinking" pulse (distinct from the existing voice-active `animate-ping`), and **Given** `prefers-reduced-motion`, **Then** the pulse is static (no animation) — consistent with the established `motion-reduce:animate-none` pattern on the orb.

8. **Given** the turn completes (`response.start` / `response.end` / any `error` frame arrives), **When** the client processes it, **Then** the thinking pulse clears (it is bounded to the gap, never left hanging).

---

## Tasks / Subtasks

### Task 1 — ESLint rule: `no-assistant-filler` (AC: #1, #2, #3)

- [x] 1.1 Create `packages/eslint-config-hivekitchen/src/rules/no-assistant-filler.ts`. **Mirror `no-heart-note-frequency-reference.ts` exactly** (same `Rule.RuleModule` shape, `meta.type: 'problem'`, `messages`, `Literal` + `TemplateElement` visitors). Key differences:
  - The rule is **unconditional** — no "context gate" (the heart-note rule only fires near heart-note imports; this one fires on any matching literal anywhere).
  - Also visit `TemplateElement` (template-literal chunks) so `` `Let me pull that up for ${name}` `` is caught, not just plain strings.
  - `FORBIDDEN` regex targets the **waiting-filler / fetch-theatrical** class only. Suggested starting set (tune per AC#3):
    ```ts
    const FORBIDDEN =
      /let me pull (that|this|it) up|let me (look|check) (that|this|it) up|just a (moment|sec(ond)?)|one moment|hang on( a (sec|moment|minute))?|bear with me|give me a (moment|second|minute)|hold on( a (sec|moment))?/i;
    ```
  - **Do NOT** match the sanctioned `"one sec."` — verify the regex above does not (it matches `one moment` and `just a sec`, but not the bare `one sec`). Add a unit test asserting `"one sec."` passes (AC#2).
  - `meta.messages.forbidden`: cite the doctrine, e.g. `'AR-14 / §3.5: "{{value}}" is an assistant-theatrical waiting filler. Lumi waits like a person, not a chatbot performing. Use the sanctioned non-verbal pulse, or EARLY_ACK_COPY ("one sec.") for the rare >6s case.'`

- [x] 1.2 Colocate `no-assistant-filler.test.ts` mirroring `no-heart-note-frequency-reference.test.ts` (uses `RuleTester`). Cover: each forbidden phrase flagged (plain + template literal), `"one sec."` NOT flagged, an innocuous string NOT flagged.

- [x] 1.3 Register in `packages/eslint-config-hivekitchen/src/index.ts`:
  - import + re-export `noAssistantFiller` (lines ~21–27 pattern),
  - add `'no-assistant-filler': noAssistantFiller` to `hivekitchenPlugin.rules` (line ~46),
  - add `'hivekitchen/no-assistant-filler': 'error'` to the `baseConfig()` rules block (line ~64) — `baseConfig` is inherited by BOTH `apiConfig()` and `webConfig()`, so this single registration covers `apps/api/src` + `apps/web/src` (= the spec's "across apps/*/src/"). This is exactly how `no-heart-note-frequency-reference` is wired.

- [x] 1.4 Update `packages/eslint-config-hivekitchen/src/index.test.ts` if it asserts the rule set / plugin shape (it does — see existing `noHeartNoteFrequencyReference` coverage). Add the new rule to those assertions.

- [x] 1.5 **Build the package** (`pnpm --filter @hivekitchen/eslint-config build`) — the apps consume `dist/`, NOT `src/`. The rule will not take effect in `apps/*` lint until `dist/index.js` is rebuilt. (Confirm by checking that `dist/rules/` contains the new compiled rule.)

- [x] 1.6 **Revise `LUMI_FALLBACK_REPLY`** (`apps/api/src/agents/lumi.agent.ts:31`) from `'Let me think about that for a moment.'` to `'Let me think that through.'` (Menon decision — calmer, genuine-cognition tone, not a waiting filler). Update any test that asserts the old string (e.g. `lumi.agent.test.ts` fallback-path coverage). Then run `pnpm lint` for `apps/api` AND `apps/web`: net new `no-assistant-filler` violations MUST be zero. If any OTHER pre-existing literal trips the rule, tune the regex to exclude genuine reply copy (not waiting-fillers) and note it in Completion Notes.

### Task 2 — Latency-doctrine primitive (AC: #4, #5)

- [x] 2.1 Create `apps/api/src/agents/latency-doctrine.ts`:
  ```ts
  import { TOOL_MANIFEST } from './tools.manifest.js';

  // §3.5 fixed budget overhead: 200ms thread load + 300ms intent classification
  // + 500ms audit/persist. Tool estimates are summed on top of this base.
  export const LATENCY_BASE_OVERHEAD_MS = 1000;
  export const SYNC_CEILING_MS = 6000;        // ≤ this → answer in one turn
  export const THINKING_PULSE_FLOOR_MS = 1500; // ≥ this (and ≤ ceiling) → non-verbal pulse
  export const THINKING_PULSE_CEIL_MS = 4000;

  // The ONE sanctioned waiting phrase (AR-14 / §3.5, Sally's amendment).
  // Every other waiting phrase is blocked by hivekitchen/no-assistant-filler.
  export const EARLY_ACK_COPY = 'one sec.';

  export type LatencyMode = 'sync' | 'thinking-pulse' | 'early-ack';

  export interface LatencyDecision {
    estimatedMs: number;
    mode: LatencyMode;
    expectedWithinMs: number; // === estimatedMs; carried for the early-ack continuation contract
  }

  export function classifyLatency(toolNames: readonly string[]): LatencyDecision {
    let estimatedMs = LATENCY_BASE_OVERHEAD_MS;
    for (const name of toolNames) {
      const spec = TOOL_MANIFEST.get(name);
      if (!spec) {
        throw new Error(
          `classifyLatency: tool "${name}" has no maxLatencyMs declaration in TOOL_MANIFEST (§3.5: declarations are the contract)`,
        );
      }
      estimatedMs += spec.maxLatencyMs;
    }

    let mode: LatencyMode;
    if (estimatedMs > SYNC_CEILING_MS) {
      mode = 'early-ack';
    } else if (estimatedMs >= THINKING_PULSE_FLOOR_MS && estimatedMs <= THINKING_PULSE_CEIL_MS) {
      mode = 'thinking-pulse';
    } else {
      mode = 'sync';
    }

    return { estimatedMs, mode, expectedWithinMs: estimatedMs };
  }
  ```
  > Keep it a pure function in one file. No class, no DI — it only reads the static manifest. (CLAUDE.md §2.)

- [x] 2.2 Colocate `apps/api/src/agents/latency-doctrine.test.ts`:
  - `[]` → base 1000ms → `sync`.
  - A single high-latency tool (`recipe.discover` = 8000ms) → estimated 9000ms → `early-ack`, `expectedWithinMs === 9000`.
  - A mid tool combo landing in `[1500,4000]` → `thinking-pulse` (e.g. base 1000 + `plan.compose` 2000 = 3000ms).
  - Unknown tool name → throws.
  - `EARLY_ACK_COPY === 'one sec.'` (guards the sanctioned-copy contract; also a canary that the lint rule whitelist and this constant agree).

### Task 3 — Contracts: voice WS `lumi.thinking` frame + early-ack frame shape (AC: #6)

- [x] 3.1 In `packages/contracts/src/voice.ts`, add the non-verbal thinking frame to the server→client union:
  ```ts
  export const WsLumiThinkingSchema = z.object({
    type: z.literal('lumi.thinking'),
    seq: z.number().int().min(1),
  });
  ```
  Add `WsLumiThinkingSchema` to `WsServerMessageSchema` discriminated union and export `WsLumiThinking = z.infer<...>`.

- [x] 3.2 (Contract-only, for the deferred continuation consumer — see WALL) Add the early-ack frame shape so the transport contract exists when D is built:
  ```ts
  export const WsResponseEarlyAckSchema = z.object({
    type: z.literal('response.early_ack'),
    seq: z.number().int().min(1),
    text: z.string(),            // EARLY_ACK_COPY — spoken first
    expected_within_ms: z.number().int().positive(),
  });
  ```
  Add to the union + export the type. **No server currently emits this** (D is deferred); the schema lands now so the future wiring is additive. Note this clearly in a code comment.

- [x] 3.3 Add contract tests in `packages/contracts/src/voice.test.ts`: `lumi.thinking` frame parses; `response.early_ack` frame parses; an unknown `type` is rejected by the union.

### Task 4 — Wire the live thinking pulse into the ambient Lumi voice path (AC: #6)

- [x] 4.1 In `apps/api/src/modules/lumi/lumi.service.ts`, in `processVoiceUtterance`, emit the non-verbal pulse **after** the `transcript` frame and **before** `submitTextTurn` (the real STT→reply gap):
  ```ts
  this.sendJson(ws, { type: 'transcript', seq, text: transcript });
  this.sendJson(ws, { type: 'lumi.thinking', seq });   // ← non-verbal: no speech in this gap
  let result: Awaited<ReturnType<typeof this.submitTextTurn>>;
  ```
  > Today this fires on every voice turn (estimated tool latency is ~0 since `LumiAgent.respond` does not tool-call — see Scope reconciliation). That is correct behaviour for the real STT→reply gap. When a tool-calling conversational orchestrator lands, gate this on `classifyLatency(plannedTools).mode === 'thinking-pulse'` — leave a `// TODO(5-S6-D / Epic 12 phase 2): gate on classifyLatency` marker so the seam is obvious.

- [x] 4.2 Do **not** add the pulse to the onboarding `VoiceService.processAudioChunk` path unless trivial — onboarding is its own surface and not in this slice's demo. (Mention in Completion Notes if you choose to mirror it; default is to leave it.)

### Task 5 — Web: render the thinking pulse on LumiOrb (AC: #7, #8)

- [x] 5.1 In the ambient voice WS handler (`apps/web/src/hooks/useLumiVoiceSession.ts`), add a case for the `lumi.thinking` frame that sets a store flag (e.g. `lumiThinking: true`). Clear it on `response.start`, `response.end`, and any `error` frame (AC#8). Parse incoming frames with the updated `WsServerMessageSchema` (the hook already `safeParse`s server frames — extend, don't replace).

- [x] 5.2 Add `lumiThinking` boolean + setter to `apps/web/src/stores/lumi.store.ts` (mirror the existing `captionTranscript`/`voiceStatus` state pattern from 5-S5). Reset to `false` in the session-teardown path (`endTalkSession`) alongside the caption reset, so a dropped turn never leaves the pulse on.

- [x] 5.3 In `apps/web/src/components/LumiOrb.tsx`, read `lumiThinking` from the store and render a thinking pulse **distinct from** the existing voice-active `animate-ping` overlay (e.g. a slower `animate-pulse` ring in a calmer tone). Honor reduced-motion with `motion-reduce:animate-none` (the orb already uses this pattern). The pulse is non-verbal and decorative → `aria-hidden="true"`, like the existing ping overlay.

- [x] 5.4 Update `apps/web/src/components/LumiOrb.test.tsx` + `apps/web/src/stores/lumi.store.test.ts`: pulse renders when `lumiThinking === true`; cleared after `response.end`; reduced-motion class present.

### Task 6 — Verification (AC: all)

- [x] 6.1 `pnpm --filter @hivekitchen/eslint-config build && pnpm --filter @hivekitchen/eslint-config test` (rule unit tests green).
- [x] 6.2 `pnpm lint` (api + web) — **zero new violations** (AC#3); then add a throwaway literal `const x = 'Let me pull that up...';` to a scratch file and confirm lint fails on it, then remove it (proves AC#1 end-to-end; do not commit the scratch line).
- [x] 6.3 `pnpm typecheck` — zero new errors vs. baseline.
- [x] 6.4 `pnpm test` for `apps/api` (latency-doctrine + lumi.service voice), `packages/contracts` (voice frames), `apps/web` (orb + store). Confirm against the baselines in Dev Notes.

---

## Dev Notes

### Source file map

| What | Where | Action |
|------|-------|--------|
| `no-assistant-filler` rule (NEW) | `packages/eslint-config-hivekitchen/src/rules/no-assistant-filler.ts` | create — mirror `no-heart-note-frequency-reference.ts` |
| rule test (NEW) | `packages/eslint-config-hivekitchen/src/rules/no-assistant-filler.test.ts` | create |
| rule registration | `packages/eslint-config-hivekitchen/src/index.ts` | import/export + `hivekitchenPlugin.rules` + `baseConfig()` rules |
| index test | `packages/eslint-config-hivekitchen/src/index.test.ts` | extend |
| latency-doctrine primitive (NEW) | `apps/api/src/agents/latency-doctrine.ts` | create |
| primitive test (NEW) | `apps/api/src/agents/latency-doctrine.test.ts` | create |
| voice WS contracts | `packages/contracts/src/voice.ts` | add `lumi.thinking` + `response.early_ack` |
| voice contract tests | `packages/contracts/src/voice.test.ts` | add frames |
| ambient voice service | `apps/api/src/modules/lumi/lumi.service.ts` (`processVoiceUtterance`, ~line 223) | emit `lumi.thinking` |
| ambient voice tests | `apps/api/src/modules/lumi/lumi.service.test.ts` | assert frame emitted in gap |
| web voice hook | `apps/web/src/hooks/useLumiVoiceSession.ts` | handle frame |
| lumi store | `apps/web/src/stores/lumi.store.ts` | `lumiThinking` state |
| LumiOrb | `apps/web/src/components/LumiOrb.tsx` | render pulse |
| orb + store tests | `apps/web/src/components/LumiOrb.test.tsx`, `apps/web/src/stores/lumi.store.test.ts` | extend |

### CRITICAL: Regex + existing copy (AC#3)

`LUMI_FALLBACK_REPLY` (`apps/api/src/agents/lumi.agent.ts:31`) is being **revised** this slice to `'Let me think that through.'` (Menon decision — Task 1.6). That value is a genuine-cognition statement, not a waiting filler, and must NOT match the `no-assistant-filler` regex — add a unit test asserting it passes. The suggested regex in Task 1.1 (matches `give me a moment` / `one moment` / `just a moment`, etc.) does not match `'Let me think that through.'` — keep it that way; do not broaden it to catch the word "think" or "moment" generically (that would flag legitimate reasoning copy).

Run `pnpm lint` across the **whole** api + web tree before declaring AC#3 met — there may be other incidental literals (test fixtures, prompt strings). Test files under `apps/*/src` ARE linted; the rule's own fixtures live in `packages/eslint-config-hivekitchen` (not `apps/*/src`) so they are not linted by the app configs. If a legitimate non-filler literal trips, tune the regex narrower rather than weakening the doctrine.

### CRITICAL: eslint-config consumes `dist/`, not `src/`

`apps/api/eslint.config.mjs` and `apps/web/eslint.config.mjs` import from `@hivekitchen/eslint-config` which resolves to `dist/index.js`. **You must rebuild the package** (`pnpm --filter @hivekitchen/eslint-config build`) after editing `src/` or the new rule will silently not run in the apps. This is the #1 trap for this slice.

### CRITICAL: `TOOL_MANIFEST` already carries `maxLatencyMs` — do not re-declare

Every tool in `apps/api/src/agents/tools.manifest.ts` already has a `maxLatencyMs` (the §3.5 / story 1.9 CI lint enforces it). The latency-doctrine primitive **reads** it; it does not add or change any manifest entry. Current values you'll see in tests: `recipe.discover` 8000, `plan.compose` 2000, `recipe.search` 300, `pantry.read` 80, etc.

### Why the pulse is wired to the ambient Lumi path, not the orchestrator

`DomainOrchestrator.planWeek/swapBlockedItems` is the only tool-calling agent, but it runs as a **background BullMQ job** — there is no live socket/turn waiting on it to early-ack. The live conversational gap a parent feels is in `lumi.service.processVoiceUtterance` (STT done → waiting on `LumiAgent.respond`). That is the correct and only place to emit a live non-verbal "thinking" signal today. See the Scope reconciliation at the top.

### Voice WS frame conventions (match the existing path)

Server→client frames are plain JSON via `this.sendJson(ws, {...})` (`lumi.service.ts:272`). The existing sequence per turn is: `transcript` → (`lumi.thinking` ← NEW) → `response.start` → [binary TTS] → `response.end`. `seq` is the per-turn counter (`++state.seq`); reuse the same `seq` for the `lumi.thinking` frame as the rest of that turn. The client `safeParse`s every server frame against `WsServerMessageSchema` (5-S5b pattern) — adding to the discriminated union is required or the new frame is silently dropped client-side (this exact class of bug was a 5-S5 P-patch: `audio_too_large` missing from the schema).

### LumiOrb current animation states (don't collide)

`LumiOrb.tsx` today: `animate-pulse` on the button when there's a pending nudge + panel closed; an `animate-ping` overlay span when `voiceStatus === 'active'`. The thinking pulse is a THIRD state — make it visually distinct (calmer/slower) and ensure it only shows during the gap, not for the whole voice-active duration. All animations carry `motion-reduce:animate-none`.

### DESIGN.md / Honey rule

The thinking pulse is "invisible intelligence made just barely visible" — calm, non-verbal, never a spinner or "Lumi is typing…" text. No words. Warm tone, soft motion. (See `docs/DESIGN.md`; `apps/web/CLAUDE.md` §"Invisible Intelligence".)

### Test baselines (from 5-S5 done state, 2026-06-07 — confirm with `pnpm test` before starting)

- **API:** ~1689 pass / 20 fail (documented pre-existing: auth×7, children.repository×3, extra-library×3, lunch-link-dev, onboarding.tools, audit-parity, catalog-seed, households-memory-200, plan-adjustment, memory-partial-seeding).
- **Web:** ~526 pass / 2 fail (pre-existing 5-S3 debt: `PackerAssignmentDialog`, `sse.test` packer.assigned key).
- **Contracts:** ~696 pass / 7 fail (pre-existing: auth×3 working-tree, cultural×1, heart-notes×3).
- **Typecheck baseline:** API 11, web 6, contracts/types 1 — all in untouched files.

Expected new tests this slice: eslint-config rule (~5), latency-doctrine (~5), voice contracts (~3), lumi.service voice (~2), web orb/store (~3). ~18 new, all green.

### No USER-SIDE GATES

No DB migration, no new env var, no new dependency. Pure code + lint. (The voice demo for AC#6/#7 needs a live ElevenLabs voice session, same as 5-S5 — but that is a manual demo, not a gate to merge.)

### Project Structure Notes

- ESLint custom rules live in `packages/eslint-config-hivekitchen/src/rules/` and are registered through `baseConfig()` → inherited by both app configs. This is the canonical place (3 rules already there); do not put the rule in `apps/*`.
- The latency primitive lives in `apps/api/src/agents/` next to `tools.manifest.ts` (its only dependency). It is API-only; the web app does not import it.
- Contracts changes are additive to an existing discriminated union — no breaking change to existing frame consumers.

### References

- [Source: _bmad-output/planning-artifacts/epic-5-vertical-slices.md#Slice 5-S6 — Latency doctrine]
- [Source: _bmad-output/planning-artifacts/architecture.md#3.5 Tool-latency manifest + early-ack] (note the §3.4/§3.5 off-Agent deprecation banner immediately above it)
- [Source: _bmad-output/planning-artifacts/epics.md#Story 5.8] (early-ack + filler lint) and [#Story 5.10] (adaptive tone — only the lint clause is in this slice; full adaptive tone is slice 5-S11)
- [Source: apps/api/src/agents/tools.manifest.ts] — `maxLatencyMs` declarations
- [Source: packages/eslint-config-hivekitchen/src/rules/no-heart-note-frequency-reference.ts] — the rule pattern to mirror
- [Source: apps/api/src/modules/lumi/lumi.service.ts:170] — `processVoiceUtterance` (pulse wiring site)
- [Source: apps/api/src/agents/lumi.agent.ts:43] — `LumiAgent.respond` (single-shot, no tools — the reason D is deferred)
- [Source: _bmad-output/implementation-artifacts/5-s5-voice-thread-standard-tier-captions.md] — voice WS frame + schema-union discipline
- [Source: _bmad-output/implementation-artifacts/7-s13-payload-scrubbing-primitive.md] — precedent for shipping a tested primitive ahead of its consumer

---

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (Opus 4.8, 1M context)

### Debug Log References

- `pnpm --filter @hivekitchen/eslint-config build && test` — 44 pass (rule unit tests green; `dist/rules/no-assistant-filler.js` confirmed present).
- AC#1 end-to-end proof: scratch `src/__filler_scratch.ts` with `'Let me pull that up for you'` → eslint reported `hivekitchen/no-assistant-filler` error; scratch removed (not committed).
- `pnpm typecheck` (per-package) — contracts 1 / api 11 / web 6 errors, all in untouched files = documented baseline; **0 new**.
- Full suites: API 1709p/20f (20 = documented baseline, 0 new), contracts 701p/7f (7 = baseline), web 532p/2f (2 = pre-existing 5-S3 debt).

### Completion Notes List

**Shipped the honest subset (A, B, C); Deliverable D deferred per the WALL.**

- **A — `no-assistant-filler` ESLint rule (AC#1,2,3).** New rule mirrors `no-heart-note-frequency-reference.ts` but is **unconditional** (no context gate) and also visits `TemplateElement` so fillers inside template literals are caught. `FORBIDDEN` regex is the Task 1.1 suggested set verbatim. Registered in `baseConfig()` (inherited by both `apiConfig` + `webConfig` → covers `apps/*/src`). **Rebuilt `dist/`** (the apps consume `dist/index.js`, not `src/`). Verified the sanctioned `"one sec."` and the revised `'Let me think that through.'` both pass.
- **AC#3 — `LUMI_FALLBACK_REPLY` revised** `'Let me think about that for a moment.'` → `'Let me think that through.'` (`lumi.agent.ts:31`). Updated the two `lumi.agent.test.ts` fallback assertions. Full api+web lint sweep: **zero `no-assistant-filler` violations** across the existing tree (no incidental literals tripped — regex left un-broadened, does not touch "think"/"moment" generically).
- **B — `latency-doctrine.ts` primitive (AC#4,5).** Pure `classifyLatency()` over `TOOL_MANIFEST.maxLatencyMs` + 1000ms base overhead; precedence `>6000 → early-ack`; else `[1500,4000] → thinking-pulse`; else `sync`. Unknown tool throws. Exports `EARLY_ACK_COPY = 'one sec.'`. Built-but-unused-at-MVP (no live consumer yet) — same precedent as 7-s13.
- **C — live non-verbal thinking pulse (AC#6,7,8).** Contracts: added `WsLumiThinkingSchema` + `WsResponseEarlyAckSchema` (the latter for deferred-D; **no server emits it**) to `WsServerMessageSchema`. API: `processVoiceUtterance` emits `{type:'lumi.thinking', seq}` after `transcript`, before `submitTextTurn`, with the `// TODO(5-S6-D / Epic 12 phase 2)` gating seam. Web: hook sets `lumiThinking` on the frame and clears it on `response.start`/`response.end`/`error`; store flag resets in `endTalkSession`; `LumiOrb` renders a calmer slower `animate-pulse` overlay (distinct from the voice-active `animate-ping`), `aria-hidden`, `motion-reduce:animate-none`.
- **D — DEFERRED (WALL, confirmed by Menon).** Full early-ack continuation transport not built — no real-time tool-calling conversational path exists to trigger the `>6000ms` branch. The primitive (B) + the `WsResponseEarlyAckSchema` frame land now so future wiring is additive.
- **Onboarding voice path left untouched** (Task 4.2 default) — the pulse is wired only into the ambient Lumi voice surface that is this slice's demo.
- **No USER-SIDE GATES** — no migration, no env var, no new dependency. The AC#6/#7 voice behaviour needs a live ElevenLabs voice session to demo (manual, same as 5-S5), not a merge gate.

### File List

- `packages/eslint-config-hivekitchen/src/rules/no-assistant-filler.ts` (new)
- `packages/eslint-config-hivekitchen/src/rules/no-assistant-filler.test.ts` (new)
- `packages/eslint-config-hivekitchen/src/index.ts` (modified — import/export + plugin + baseConfig rule)
- `packages/eslint-config-hivekitchen/src/index.test.ts` (modified — baseConfig rule assertion)
- `apps/api/src/agents/lumi.agent.ts` (modified — `LUMI_FALLBACK_REPLY` copy revision)
- `apps/api/src/agents/lumi.agent.test.ts` (modified — fallback assertions)
- `apps/api/src/agents/latency-doctrine.ts` (new)
- `apps/api/src/agents/latency-doctrine.test.ts` (new)
- `packages/contracts/src/voice.ts` (modified — `lumi.thinking` + `response.early_ack` frames + union + types)
- `packages/contracts/src/voice.test.ts` (modified — new frame tests)
- `apps/api/src/modules/lumi/lumi.service.ts` (modified — emit `lumi.thinking` in the STT→reply gap)
- `apps/api/src/modules/lumi/lumi.service.test.ts` (modified — frame-sequence + thinking-frame tests)
- `apps/web/src/stores/lumi.store.ts` (modified — `lumiThinking` state + setter + teardown reset)
- `apps/web/src/stores/lumi.store.test.ts` (modified — thinking-flag tests)
- `apps/web/src/hooks/useLumiVoiceSession.ts` (modified — handle `lumi.thinking`, clear on reply/error)
- `apps/web/src/components/LumiOrb.tsx` (modified — render thinking pulse)
- `apps/web/src/components/LumiOrb.test.tsx` (modified — thinking-pulse tests)
- `packages/eslint-config-hivekitchen/dist/**` (rebuilt — generated output, apps consume `dist/`)

---

### Review Findings

- [x] [Review][Patch] P1: Object URL leak when endSession interrupts in-flight audio [apps/web/src/hooks/useLumiVoiceSession.ts — playBufferedAudio/endSession] — `URL.revokeObjectURL()` only in audio.ended/error/catch; external pause (endSession) never revokes; fix: store objectUrl in a ref and revoke in endSession cleanup
- [x] [Review][Patch] P2: Orphaned talk session row when accessToken is null [apps/web/src/hooks/useLumiVoiceSession.ts — startSession] — POST creates DB row before access token check; if check fails, talkSessionId is never set in store so DELETE never fires; fix: check accessToken before the POST
- [x] [Review][Patch] P3: Missing test for [4001, 6000] sync band (above thinking-pulse ceiling) [apps/api/src/agents/latency-doctrine.test.ts] — AC#4 specifies estimates ≤6000 → sync but no test covers the (4000, 6000] gap; add one case e.g. 5000ms tool combo → mode:'sync'
- [x] [Review][Defer] W1: `resolvedState!` non-null assertion in lumi.routes.ts drain loop [apps/api/src/modules/lumi/lumi.routes.ts] — deferred, pre-existing from 5-S5b; safe today (synchronous drain), fragile on future refactor
- [x] [Review][Defer] W2: Partial TTS audio chunks played on mid-stream failure [apps/api/src/modules/lumi/lumi.service.ts + useLumiVoiceSession.ts] — deferred, pre-existing TTS streaming architecture from 5-S5b; garbled audio artifact on rare ElevenLabs mid-stream disconnect
- [x] [Review][Defer] W3: WS auth checks user_id but not household_id [apps/api/src/modules/lumi/lumi.routes.ts] — deferred, pre-existing from 5-S5b; asymmetric vs REST DELETE path; low practical risk pending account-reassignment support
- [x] [Review][Defer] W4: JWT in WS URL query param exposed in logs/history [apps/web/src/hooks/useLumiVoiceSession.ts] — deferred, accepted design decision; same pattern as /v1/voice/ws; documented in authenticate.hook.ts
- [x] [Review][Defer] W5: TALK_SESSION_TTL_SECONDS=20 never refreshed mid-session [apps/api/src/modules/lumi/lumi.service.ts] — deferred, pre-existing; Story 12.8 auto-close owns this
- [x] [Review][Defer] W6: lumiThinking stuck if server closes WS with code 1000 mid-turn [apps/web/src/hooks/useLumiVoiceSession.ts] — deferred, theoretical; no server-side close-with-1000 logic today; becomes relevant when Story 12.8 ships
- [x] [Review][Defer] W7: startingRef blocks retry tap briefly after mic permission failure [apps/web/src/hooks/useLumiVoiceSession.ts] — deferred, pre-existing; very short window (one DELETE round-trip), minor UX nuisance
- [x] [Review][Defer] W8: no-assistant-filler regex misses "for a moment" phrasing in onboarding.agent.ts [packages/eslint-config-hivekitchen] — deferred, coverage gap not correctness bug; onboarding phrase unchanged by this slice
- [x] [Review][Defer] W9: Silent empty turn (response.start before empty-reply guard) provides no user feedback [apps/api/src/modules/lumi/lumi.service.ts] — deferred, deliberate P3 design from 5-S5b, explicitly tested

---

## Change Log

| Date | Change |
|------|--------|
| 2026-06-07 | Implemented slice (Deliverables A/B/C; D deferred per WALL). Added `no-assistant-filler` ESLint rule + `latency-doctrine` primitive + live non-verbal `lumi.thinking` pulse (contracts/api/web). Revised `LUMI_FALLBACK_REPLY`. Status → review. |

---

## Decisions (Menon, 2026-06-07 — resolved)

1. **🚧 WALL — Deliverable D (early-ack continuation transport) is DEFERRED.** ✅ Confirmed. This story ships the lint (A), the tested latency primitive (B), and the live non-verbal thinking pulse (C). The `>6000ms → "one sec." now, real answer later over thread SSE` async-continuation machinery is **not built** — no real-time conversational path tool-calls today, so its branch has no live trigger (CLAUDE.md §2). The primitive (B) + the `WsResponseEarlyAckSchema` frame contract (Task 3.2) land now so the future wiring (Epic 12 phase 2+, when a tool-calling conversational orchestrator exists) is additive. Leave the `// TODO(5-S6-D / Epic 12 phase 2)` seam marker in `lumi.service.ts` (Task 4.1).

2. **Folded into Epic 12 domain (tracking).** ✅ Confirmed. 5-S6's only live consumer (the voice thinking-gap) is an Epic 12 surface, so it is tracked as Epic-12-domain going forward. The `5-s6` key and this file are **retained** (not physically renumbered) so the ready-for-dev → dev-story flow isn't disrupted; the fold is recorded as an annotation in `sprint-status.yaml` and `epic-5-vertical-slices.md §5-S6`. A physical renumber to `12-sNN` is available on request (file rename + sprint-status move only — no code impact).

3. **`LUMI_FALLBACK_REPLY` revised to a calmer copy.** ✅ `'Let me think about that for a moment.'` → `'Let me think that through.'` (see Task 1.6 / AC#3). Implemented as part of this slice.
