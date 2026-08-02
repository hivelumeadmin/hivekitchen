# HiveKitchen — `runTurn` Agent-Layer Collapse (Design for Review)

> **Status:** Draft for review · **Author:** Claude (architecture pass) · **Date:** 2026-07-29
> **Companion to:** `canonical-data-model-v2-spec.md`
> Collapses three separate turn implementations into one stateless `runTurn` primitive + per-surface
> config. No stack change, no new dependency. The `LLMProvider` seam, `ToolSpec` shape, `ResilientProvider`,
> and the `OnboardingController` FSM are all **kept** — this design generalizes them, it doesn't replace them.

---

## 0. The problem in one sentence

There are **three "turn" implementations** — `DomainOrchestrator` (planner), `LumiAgent` (chat),
`OnboardingAgent` (onboarding) — built on **two different transports**, returning **three different
shapes**, with the tool-call loop **copied ~90% verbatim** across all three, and the "agents never
touch the DB" invariant honored **three incompatible ways**.

| Path | Transport | Loop lives in | Returns | Persistence model |
|------|-----------|---------------|---------|-------------------|
| Planner | `LLMProvider` seam | `orchestrator.swapBlockedItems` (5-iter) + single-shot `planWeek` | `PlanComposeTreeOutput` (in-memory tree) | pure compose → **commit after** the turn (job) |
| Lumi chat | **raw OpenAI SDK** (`gpt-4o` hardcoded) | `LumiAgent.respondWithTools` (5-iter) | **plain string** | **externally-owned** `toolExecutor` callback |
| Onboarding | `LLMProvider` seam | `OnboardingAgent.respondWithTools` (6-iter) | `OnboardingAgentResponse` (structured) | injected `ToolSpec.fn`s persist **mid-turn** |

Every new surface today means re-deriving the loop, the allowlist enforcement, the tool-error-to-JSON
convention, the latency guard, and the tracing. That's the accidental complexity to delete.

---

## 1. Governing principles

1. **One loop, one place.** The iterate → call model → execute tools → append results → break loop
   exists exactly once. Everything else is configuration.
2. **`runTurn` is stateless and owns no control flow.** It runs a single conversational turn to
   completion (possibly several tool rounds) and returns. It never advances an FSM, never decides "what
   moment comes next," never persists domain data. (This is exactly what `OnboardingTurnRunner` already
   promises — "owns NO control flow" — generalized.)
3. **A surface is data, not a class.** Each surface (Lumi-planning, onboarding, planner-compose,
   planner-swap, …) is a config object: how to build the prompt, which tools, what options, optional
   pre/post hooks. No agent subclasses.
4. **One transport.** Everything goes through the `LLMProvider` seam + `ResilientProvider`. The raw
   OpenAI SDK usage in `LumiAgent` is deleted.
5. **One tool shape.** Everything is a `ToolSpec` (Zod in/out + `fn` + `maxLatencyMs`). Lumi's raw
   `ChatCompletionTool[]` + `toolExecutor` callback is deleted.
6. **The persistence contract is uniform and honest** (§5): `runTurn` never writes; tool `fn`s (API-owned)
   may; post-turn commits are the caller's job. The invariant is *where the code lives*, not *when the
   write happens*.

---

## 2. The primitive: `runTurn`

```ts
// agents/run-turn.ts — the one and only tool-call loop.
export async function runTurn(input: RunTurnInput): Promise<TurnResult>;

interface RunTurnInput {
  provider: LLMProvider;          // ResilientProvider in practice
  systemPrompt: string;           // fully assembled by the surface
  messages: LLMMessage[];         // conversation history (no system role — that's systemPrompt)
  tools: ToolSpec[];              // may be empty → single-shot, no loop
  options: TurnOptions;
  logger: FastifyBaseLogger;
  tracer?: TurnTracer;            // existing agentic-trace machinery, unchanged
}

interface TurnOptions {
  tier: LLMTier;                  // 'flagship' | 'mini' | 'reasoning'
  temperature?: number;
  maxTokens?: number;
  forcedToolName?: string;        // e.g. 'plan.compose' — forced on iteration 0 only
  strictAllTools?: boolean;       // OpenAI strict mode (see strict-tool-schema-nullable-rule)
  allowedTools?: string[];        // allowlist → throws ForbiddenToolCallError on violation
  maxIterations: number;          // 1 = single forced call; 5/6 = ReAct-style
  responseFormat?: 'text' | 'json_object';
}

interface TurnResult {
  text: string;                   // final assistant prose ('' when the turn ended on a forced tool)
  toolCalls: ExecutedToolCall[];  // { name, input, output, latencyMs, ok, error? }
  finishReason: LLMResponse['finishReason'];
  usage: TokenUsage;              // incl. cachedPromptTokens
  iterations: number;
}
```

**What `runTurn` owns (deleted from all three call sites):**
- The tool-call loop and its iteration cap.
- Allowlist enforcement (`ForbiddenToolCallError`) — currently only in the orchestrator.
- Per-tool Zod input/output validation around `ToolSpec.fn`.
- The tool-error-to-JSON convention (all three re-implement this).
- The `maxLatencyMs` guard per tool call.
- Assistant/tool message threading (`LLMMessage` append discipline).
- Tracing hooks (`PLAN_TRACE_DIR`-style agentic traces).

**What `runTurn` does NOT own:** prompt assembly, tool wiring, FSM advance, persistence-after,
streaming (§9). Those belong to the surface or the caller.

The loop, in essence:
```
msgs = messages
for i in 0..maxIterations:
  resp = tools.length
       ? provider.completeWithMessages(msgs, tools, { ...opts, forcedToolName: i===0 ? opts.forcedToolName : undefined })
       : provider.complete(systemPrompt, [], opts)
  if !resp.toolCalls?.length: return { text: resp.content, ... }   // natural stop
  enforceAllowlist(resp.toolCalls, opts.allowedTools)              // → ForbiddenToolCallError
  msgs.push(assistant(resp))
  for call of resp.toolCalls:
    out = await withLatencyGuard(spec.maxLatencyMs, () => spec.fn(spec.inputSchema.parse(call.input)))
    msgs.push(toolResult(call, spec.outputSchema.parse(out) | errorJson))
return capReached(...)   // finishReason marks the cap
```

---

## 3. The config layer: `Surface`

```ts
// agents/surfaces/types.ts
interface Surface<Ctx> {
  name: SurfaceName;                                   // 'lumi.planning' | 'onboarding' | 'planner.compose' | ...
  buildSystemPrompt(ctx: Ctx): string;
  buildTools(ctx: Ctx): ToolSpec[];                    // closure-captures householdId/userId/deps
  options: TurnOptions | ((ctx: Ctx) => TurnOptions);
  preTurn?(ctx: Ctx): PreTurnDecision;                 // e.g. onboarding zero-LLM pure-chip turn
  postTurn?(result: TurnResult, ctx: Ctx): SurfaceOutcome;   // e.g. ratification detect, plan post-passes
}

type PreTurnDecision =
  | { kind: 'proceed'; messages?: LLMMessage[] }       // optionally rewrite/augment history
  | { kind: 'short-circuit'; outcome: SurfaceOutcome }; // skip the LLM entirely (pure-chip)
```

A surface is consumed by a ~15-line runner: `preTurn` → `runTurn` → `postTurn`. The three existing
entry points become surface configs:

| Surface | `buildSystemPrompt` | `buildTools` | key `options` | hooks |
|---------|--------------------|--------------|---------------|-------|
| `lumi.<7 surfaces>` | `LUMI_BASE_PERSONA` + `getSurfacePrompt(s)` + snapshot + tod | Lumi tools as `ToolSpec[]` (rewritten from `toolExecutor`) | tier flagship, maxIter 5 | — |
| `onboarding` | `getOnboardingSystemPrompt(modality)` + kitchen-map/moment/vocab blocks | `createOnboardingToolSpecs(ctx)` | tier flagship, maxIter 6, `strictAllTools` | `preTurn`=pure-chip; `postTurn`=ratification |
| `planner.compose` | `PLANNER_PROMPT` + context lines + candidate slate | `[planComposeTool(handleMap)]` | `forcedToolName:'plan.compose'`, maxIter **1**, tier flagship, temp 0.2 | `postTurn`=`applyPlanDefaults`+`enforceNoConsecutiveMain` |
| `planner.swap` | `SWAP_PROMPT` | swap toolset | `allowedTools`, maxIter **5**, tier mini | `postTurn`=guardrail re-check |

Note this is **not new machinery** — `prompts/surfaces/index.ts` (`SURFACE_PROMPTS: LumiSurface → () => string`)
is already the per-surface config precedent. This generalizes it from "prompt only" to
"prompt + tools + options + hooks," and extends it to onboarding and the planner.

---

## 4. What each current file becomes

| Today | LOC | After |
|-------|-----|-------|
| `agents/lumi.agent.ts` | 255 | **Deleted.** Becomes `surfaces/lumi/*` config + `LumiService` calls `runTurn`. Raw OpenAI SDK usage gone. |
| `agents/onboarding.agent.ts` | 568 | **~120.** `respondWithTools` loop → `runTurn`. Keeps only `extractSummary`/`inferCulturalPriors`/`isSummaryConfirmed` (mini-tier classifier calls — these are one-shot, not turns; keep as small provider calls). |
| `agents/orchestrator.ts` | 821 | **~350.** `swapBlockedItems` loop → `runTurn`; `completeWithMessages`/`complete` allowlist logic → `runTurn`. Keeps: `planWeek` pipeline glue, `assemblePlannerContext`, `ensureCandidateCoverage`, provider/breaker wiring, audit writes. |
| `onboarding-turn-runner.ts` | 544 | **~200.** Becomes the onboarding surface's `buildTools`/`preTurn`/`postTurn` + block renderers. The round-trip delegates to `runTurn`. |
| **NEW** `agents/run-turn.ts` | — | **~150.** The one loop. |
| **NEW** `agents/surfaces/*` | — | thin config per surface (~30–60 each). |

Net: roughly **−1,400 LOC of duplicated loop/transport/error machinery**, replaced by ~150 shared +
thin configs. Three transports → one. Three return shapes → one `TurnResult`.

---

## 5. The unified persistence contract

The three paths persist three ways today. The unification — stated plainly so ADR-002 can be updated:

> **`runTurn` never persists domain data. Tool `fn`s — supplied by the API layer — may persist,
> synchronously, as part of executing a tool call. Any persistence that must happen *after* the whole
> turn (e.g. `plansService.commit()`) is the caller's / surface `postTurn`'s job.**

This keeps the real invariant — *the agent layer contains no persistence logic; every write goes
through an API-layer-owned function* — while dropping the false uniformity that everything is
"payload-return, persist-after." It isn't, and it shouldn't be:

- **Onboarding needs mid-turn persistence.** Within one turn, `child.upsert` must commit before
  `allergen.declare` can attribute to that child. Buffering-and-replaying writes after the turn would
  be strictly worse. Mid-turn persistence via injected `fn`s is correct — the *agent class* stays
  stateless because it only calls injected functions.
- **Planner is legitimately payload-return.** `plan.compose`'s `fn` is a pure assembler; the commit is
  a deliberate post-turn step gated by the guardrail. Keep it.
- **Lumi's `toolExecutor` becomes `ToolSpec[]`.** Same effect (API-owned handlers), uniform shape.

So the contract is: **who persists = API-owned tool `fn` or caller. When = tool-time or post-turn,
per surface. Where the code lives = never in `runTurn` or a surface's prompt/loop logic.**

---

## 6. Control flow / FSM stays out of `runTurn`

The Epic 2.7 split is the model to preserve and generalize:

- **Pure FSM** (`OnboardingController`, no I/O) — decides moment/slot advance. **Kept, unchanged.**
- **Stateless turn** (`runTurn`) — runs one round-trip. **New, shared.**
- **Stateful orchestration** (the service) — persists, invokes the FSM, invokes `runTurn`. **Kept.**

`runTurn` returning `TurnResult` gives the service everything it needs to (a) persist the lumi turn and
(b) call `controller.nextMoment(current, slots)`. The **shadow-vs-authoritative moment bug** noted in
the exploration (the service still computes the next moment inline at `onboarding.service.ts:876` while
`OnboardingController` runs in shadow) should be resolved *as part of this work* — cut over to the
controller as authoritative. That's the natural moment to do it, since the turn boundary is being
touched anyway.

---

## 7. Provider seam consolidation (adjacent, high-value)

The seam is good; two things around it are not:

1. **Lumi bypasses it** (raw OpenAI SDK, hardcoded `gpt-4o`). Migrating Lumi onto `runTurn` migrates it
   onto the seam for free — deleting a whole second transport and centralizing model selection in
   `TIER_TO_MODEL`.
2. **The Anthropic adapter is a `NotImplementedError` stub that is wired as the circuit-breaker's
   failover target.** If the breaker ever opens and swaps to it, every call throws. This is a latent
   outage, not a feature. **Decision needed (§10-C):** either implement it for real or remove it from
   the failover list so the breaker degrades to retry-only. Separately, the `TIER_TO_MODEL` map
   (`flagship=gpt-4o`, `mini=gpt-4o-mini`, `reasoning=o1-mini`) is dated — worth a `claude-api`-style
   model-currency review when this is touched. `runTurn` makes adding a real second provider a config
   change, not a code change — which is the point of having the seam.

---

## 8. What this deliberately does NOT do

- **No streaming through `runTurn`.** `runTurn` is request/response with tool rounds. Streamed replies
  (voice narration, `provider.stream`) stay a separate, thin path — a tool loop and a token stream are
  different shapes; forcing them together would complicate both. A future `streamTurn` can share the
  prompt/tool assembly but not the loop.
- **No FSM inside `runTurn`** (§6).
- **No "everything is payload-return"** (§5) — that would be over-engineering onboarding.
- **No new agent base class / inheritance.** Surfaces are data.
- **No stack, dependency, or `ToolSpec`/`LLMProvider` interface change.**

---

## 9. Migration strategy (strangler — each step ships alone)

1. **Extract `runTurn`** from the most-structured existing loop (`OnboardingAgent.respondWithTools`).
   Land it with unit tests (forced-tool single-shot, multi-round, allowlist violation, tool-error-JSON,
   iteration cap). No caller changes yet.
2. **Cut onboarding over** to `runTurn` (`onboarding.agent.ts` shrinks to classifiers; turn-runner
   delegates). Resolve the shadow-FSM cutover (§6) in the same PR. Verify against the onboarding eval
   harness (`agents/eval/onboarding-eval.harness.ts`).
3. **Cut the planner over** — `swapBlockedItems` and the `plan.compose` single-shot both call `runTurn`.
   Verify against the planner eval harness. `planWeek`'s deterministic pre-flight
   (`ensureCandidateCoverage`) is untouched.
4. **Migrate Lumi off the raw SDK** — rewrite `toolExecutor` handlers as `ToolSpec[]`, delete
   `lumi.agent.ts`, `LumiService` calls `runTurn`. This is the biggest single behavior-surface change;
   do it last and lean on the Lumi surface prompts (`surfaces/index.ts`) that already exist.
5. **Introduce the `Surface` config layer** as the organizing sugar once all three call `runTurn`
   directly (optional but recommended — it's what makes adding surface #5 cheap).
6. **Resolve the Anthropic-stub hazard** (§7, §10-C) — independent, can land any time.

Steps 1–4 each keep the eval harnesses green as the gate. Nothing requires the whole set to land together.

---

## 10. Decisions (all resolved 2026-07-29)

| Ref | Decision | Resolution |
|-----|----------|------------|
| **10-A** | Introduce the formal `Surface` config layer, or just have each caller assemble `RunTurnInput`? | ✅ **Introduce it — after step 4.** Shape driven by three real call sites, not guessed up front (migration step 5) |
| **10-B** | Onboarding mini-tier classifiers: one-shot provider calls, or zero-tool `runTurn`s? | ✅ **Keep as one-shot provider calls.** They're not turns (no tools, no history threading); `runTurn` would be ceremony |
| **10-C** | Anthropic failover stub: implement for real, or remove from failover? | ✅ **Remove from failover now.** Breaker degrades to retry-only; implement a real adapter only if a genuine multi-provider need lands |
| **10-D** | Onboarding shadow-FSM cutover: in migration step 2, or its own slice? | ✅ **In step 2.** The turn boundary is already being touched; splitting doubles the eval-harness runs |

---

## 11. How this composes with the data-model v2 spec

The planner surface's `buildSystemPrompt`/context assembly is where `resolveConstraints()` (data-model
spec §3.3) plugs in: the resolver produces the **hard candidate filter** (applied in
`ensureCandidateCoverage`, pre-LLM) and the **soft weights** (rendered into the planner context lines).
`runTurn` never sees the constraint hierarchy — it only runs the turn. That separation is the whole
point: **deterministic constraint resolution and the LLM turn are different layers**, and this design
keeps them apart.

---

## Appendix — the seam, unchanged

`runTurn` sits *on top of* `LLMProvider` and `ToolSpec`, which are unchanged:
- `LLMProvider.completeWithMessages(messages, tools, options)` / `.complete(...)` — the transport.
- `ResilientProvider` — retry + circuit-breaker + failover, wraps the provider list.
- `ToolSpec { name, description, inputSchema, outputSchema, maxLatencyMs, fn }` — the tool.
- `OnboardingController` — the pure FSM.

The collapse is entirely in the layer *between* those and the module services — the layer that is
currently three copies.
