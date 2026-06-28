# Epic 2.7 Brief — Onboarding Agentic Re-Architecture (Controller-Led, Hardened)

**Date:** 2026-06-26
**Author:** Drafted by Claude (engineering) at Menon's request, following the Epic 3.5 planner re-architecture
**Triggered by:** Menon — "now that the planner is improved, do the same for onboarding: lower technical debt, reliability, LLM cost, maintainability, efficiency"
**Scope classification:** **Major** (cross-cutting re-architecture of a shipped agentic module; control-flow inversion in the final slices changes runtime behavior)
**Status:** Awaiting approval
**Format:** Sprint-change-proposal style (mirrors `epic-2.6-brief.md` and the Epic 3.5 planner re-architecture)

---

## Section 0 — Revision History

- **Rev 1 (2026-06-26):** Initial draft. 6 slices. Ports the three disciplines Epic 3.5 proved on the planner (strict tool schemas, an `LLMProvider` seam, a per-run trace dir) to onboarding, adds a chip-system cleanup slice, then inverts control flow so a deterministic controller — not the LLM — owns the interview state machine.
- **Rev 2 (2026-06-26, this version):** Two open questions resolved by Menon — (a) zero-call chip acknowledgment = Option A (code-filled template); (b) onboarding golden-set eval is **in scope**. Per Menon, the eval is pulled out of the controller slice into its own **opening slice (2.7-s1)**, mirroring how the planner built its golden eval first (3.5-s1) so every later change had a regression gate under it. **Now 7 slices**, renumbered: eval is s1; the former s1–s6 shift to s2–s7.
- **Rev 3 (2026-06-26):** Added [Section 4.5 — Reconciliation with the UX rebuild + planner routing docs](#section-45--reconciliation-with-the-ux-rebuild--planner-routing-docs-2026-06-26). Records one decision-point (the §3d deferred-onboarding gate — affects s6/s7 + the s1 eval baseline) and three alignment notes (s4 provider-seam reusability, s5/s7 structured chip plumbing, s6/s7 controller-split naming) surfaced when the two new planning docs (`lumi-conversational-ux-rebuild-vision.md`, `plan-conversational-edit-routing-spec.md`) were checked against this brief before developing s2. **No change to the 7-slice scope; s2 is unaffected.**

---

## Section 1 — Issue Summary

### Problem statement

The planner and the onboarding agent were built to the same brief — an OpenAI tool-calling agent over the Kitchen Map — but they have **diverged in engineering discipline**. Epic 3.5 hardened the planner: forced structured output via a strict-schema adapter, a `ResilientProvider` / `LLMProvider` seam, a per-run agentic trace (`PLAN_TRACE_DIR`), a golden-set eval harness, and a single-shot loop collapse. Onboarding received none of these. It is still the pre-3.5 shape:

- **`OnboardingAgent`** — `apps/api/src/agents/onboarding.agent.ts` (582 lines)
- **`submitTextTurn`** — `apps/api/src/modules/onboarding/onboarding.service.ts:468-1417` (a single ~950-line method)
- **Tool handlers** — `apps/api/src/agents/tools/onboarding.tools.ts` (951 lines, 11 tools)
- **Prompt** — `apps/api/src/agents/prompts/onboarding.prompt.ts` (417 lines)

### The root-cause insight: control is inverted

The single architectural fact that drives every problem below: **the LLM owns the interview's control flow, and the service compensates for the LLM's mistakes.**

The agent advances the interview by emitting sentinels in its prose — `[NEXT_MOMENT:<key>]`, `[CHIP_PROMPT:...]`, `[SESSION_COMPLETE]`. The service parses these back out with regex (`onboarding.service.ts:828`, `:835`, `:240`), enforces forward-only transitions, strips the sentinels before display, and — because the LLM forgets the directive often enough to matter — layers on a growing set of **service-side safety nets** that guess the transition when the sentinel is missing: pre_start→m1 fallback, kitchen-map-inference re-anchoring (`:929`), M3 chip auto-advance (`:956`), M4 chip auto-advance (`:979`). The flow therefore lives in *two* places (the prompt and the safety nets) that must agree, and the second exists only to patch the first.

This is the same lesson Epic 3.5 already learned on the planner ("3.5-s5 single-shot loop collapse" deleted the `MAX_PLAN_ITERATIONS` loop and the stopped-without-compose fallback). Onboarding has not had its turn.

### Categorization

Per checklist item 1.2: **Engineering-discipline drift surfaced by a successful sister-module re-architecture.** Nothing in onboarding is a bug against its own contract — its ~4,250 lines of tests pass. The issue is global: two agentic modules that should share discipline no longer do, and the divergent one carries the reliability/cost/maintainability cost.

### Evidence (the specific gaps)

1. **No strict tool schema — the highest-risk gap.** Onboarding calls `tool_choice:'auto'` with loose JSON Schema (`onboarding.agent.ts:236`, schemas via `z.toJSONSchema` at `:99`). It does **not** use the strict-hardening machinery (`toStrictJsonSchemaParameters` / `addStrictConstraints` / `makeNullable`) that lives in `apps/api/src/agents/providers/openai.adapter.ts:97-178` and that the planner depends on. This is the exact failure class that broke *every* `plan.compose` until commit `bea6d4b` (see memory `strict-tool-schema-nullable-rule`): optional fields emitted without `anyOf:[…,null]` let the model produce invalid values. In onboarding the only guard is the per-handler `Schema.parse(input)`, and a malformed call is bounced back to the LLM as an `{error}` tool-result — costing an extra round-trip (up to `MAX_TOOL_ITERATIONS=6`).

2. **`gpt-4o` hardcoded in five places, bypassing the provider seam.** `TEXT_MODEL='gpt-4o'` (`onboarding.agent.ts:71`) plus literal `'gpt-4o'` in `extractSummary` (`:379`), `inferCulturalPriors` (`:448`), and `isSummaryConfirmed` (`:562`). The agent talks to the raw `OpenAI` client, not the `LLMProvider` interface the planner uses. The classifier/extractor calls — including a **5-token yes/no** (`isSummaryConfirmed`, `max_tokens:5` at `:572`) — run on a frontier model. That is pure recurring waste.

3. **No onboarding trace facility.** There is no `ONBOARDING_TRACE_DIR` analog to the planner's `PLAN_TRACE_DIR` / `plan-tracer.ts`. Debugging a bad interview means reconstructing it from Pino logs. The planner trace is precisely the tool that let us diagnose gap #1's strict-schema bug.

4. **Chips come from three channels, one of them fragile.** `momentToChipConfig` (`onboarding.service.ts:296`) is deterministic for M1–M4; M5 is projected per-household from `CatalogProjectionService` (`:1079`). Both are fine. But two chip behaviors ride **prose sentinels**: `[CHIP_PROMPT:household_name]` swaps M1 hint chips (`:835`) and `[CHIP_PROMPT:elevation:<tag>:<label>]` (`:240`) raises an allergen-ratification chip. These fail the same way `[NEXT_MOMENT:]` fails. Separately, the deterministic chip lists are kept in sync with their tool/vocab keys by **hand-copied comments** ("Labels copied verbatim from Moment2Page.tsx" at `:304`; "mirror `BagCompositionPatternSchema` exactly" at `:355`) — three silent drift points with no test to catch divergence.

5. **`submitTextTurn` is a ~950-line god method** (`onboarding.service.ts:468-1417`) mixing thread I/O, chip resolution, the moment FSM, fire-and-forget catalog side-effects, cold-start logic, and telemetry. High cognitive load; a known refactor magnet.

6. **Duplicate tool definitions.** `apps/api/src/agents/tools.manifest.ts:177-238` still carries `NotImplementedError` onboarding tool stubs alongside the real specs in `onboarding.tools.ts`. Two definitions of the same tool names is a live maintenance trap.

7. **Per-turn LLM-call count is higher than it needs to be.** A turn is 1–6 tool round-trips (each tool batch is a full round-trip, `onboarding.agent.ts:270-309`) **plus** a separate `isSummaryConfirmed` classifier call once history ≥ 6 messages (`:1385`). Chip-only turns still route the keys back through the LLM purely to map known chip keys → known tool calls.

### What is already right (and stays)

- **Split persistence** — the agent writes nothing; tools + the service own all DB writes. Matches the architecture doctrine. **Unchanged.**
- **Vocabulary validation at the handler boundary** (not in the schema) so the model gets a recoverable error on a bad allergen/dietary/cuisine tag. Deliberate and correct (`onboarding-tools.ts:27-30`). **Unchanged.**
- **Idempotent-by-name `child.upsert`** and the PII-redaction discipline in tool logs. **Unchanged.**
- **Prompt-injection hardening** (forge-resistant delimiters, sentinel stripping). Kept — though the control inversion removes most of the sentinels that needed stripping.

---

## Section 2 — Impact Analysis

### Epic Impact

| Epic | Status before | Status after | Notes |
|---|---|---|---|
| **Epic 2.5 — Onboarding Robustness** | `done` | **Unchanged. Stays as-shipped.** | The moment FSM, chips, and finalize gate it introduced are re-implemented behind the same external behavior. |
| **Epic 2.6 — Personalized Onboarding Catalog** | (per its own brief) | **Unchanged.** M5 catalog projection (`CatalogProjectionService`) is consumed as-is by the new controller. | 2.7 must not regress the Stage-0/1/2 + cold-start chip paths. |
| **Epic 2.7 — Onboarding Agentic Re-Architecture (this brief)** | — | **NEW. `backlog` → `in-progress` when first slice begins.** | 7 slices. Mirrors Epic 3.5's relationship to Epic 3. |
| **Epic 3.5 — Planner Re-Architecture** | `done` (WALL: do-not-merge until post-launch sign-off) | **Unchanged.** Source of the ported patterns. | 2.7 reuses `openai.adapter.ts`, the `LLMProvider`/`ResilientProvider` seam, and the `plan-tracer.ts` pattern. |
| **Epic 5 — Voice / Lumi** | `in-progress` | **Watch.** Onboarding's dormant single-shot voice path (`respondSingleShot`, `onboarding.agent.ts:149`) is touched by the provider seam (Slice 4). | Voice onboarding is deferred (memory `onboarding-text-first`); the single-shot path stays behaviorally identical. |
| **Epics 4, 6, 7, 8–12** | various | No change. | No contract dependency. |

### Story Impact

**Added (Epic 2.7):** 7 slices (see Section 4).

**No pauses.** Like Epic 2.6 (and unlike Epic 2.5's birth), 2.7 supersedes the existing onboarding internals slice-by-slice; the shipped external behavior keeps working throughout. Slice 1 (eval) and Slices 2–5 are behavior-preserving by construction; only Slices 6–7 change runtime control flow, and they are gated behind the eval (Slice 1), the trace dir (Slice 3), and a shadow-run.

### Artifact Conflicts

| Artifact | Conflict | Slice | Action |
|---|---|---|---|
| **Eval** (`apps/api/src/agents/eval/...`) | An onboarding golden-set harness (structured-outcome regression gate) mirroring the planner's; built first against current behavior | s1 | New file |
| **Agent** (`apps/api/src/agents/onboarding.agent.ts`) | Tool serialization routed through strict adapter; raw `OpenAI` calls replaced by `LLMProvider`; trace hooks added | s2, s3, s4 | Code change |
| **Provider adapter** (`apps/api/src/agents/providers/openai.adapter.ts`) | Reused as-is for onboarding tool hardening; no change expected, possibly a shared helper export | s2 | Reuse (verify no change) |
| **Trace** (`apps/api/src/agents/...` new `onboarding-tracer.ts`) | New per-turn trace artifact mirroring `plan-tracer.ts` | s3 | New file |
| **Env** (`apps/api/src/config/env.ts`) | New `ONBOARDING_TRACE_DIR` (off by default), model-tier env for classifiers | s3, s4 | Code change |
| **Tool manifest** (`apps/api/src/agents/tools.manifest.ts`) | Delete `NotImplementedError` onboarding stubs (`:177-238`) | s4 | Code change |
| **Service** (`apps/api/src/modules/onboarding/onboarding.service.ts`) | `submitTextTurn` split into controller + turn-runner + thin service; safety nets deleted; sentinel parsing removed | s6, s7 | Code change |
| **Chip config** (`onboarding.service.ts:296` `momentToChipConfig`) | M2/M3/M4 chip lists generated from vocab/schema source of truth; `[CHIP_PROMPT:]` sentinels removed | s5, s7 | Code change |
| **Contracts** (`packages/contracts/src/onboarding-tools.ts`) | `allergen.declare` gains structured `enforcement` / `request_ratification` fields (replaces elevation sentinel); chip-key derivation source | s5 | Code change |
| **Prompt** (`apps/api/src/agents/prompts/onboarding.prompt.ts`) | Remove `[NEXT_MOMENT:]` / `[CHIP_PROMPT:]` / `[SESSION_COMPLETE]` directive instructions once the controller owns flow | s7 | Code change |
| **Moment repo** (`apps/api/src/modules/onboarding/onboarding-moment.repository.ts`) | Slot predicates read alongside moment state; no schema change expected | s6 | Code change |
| **Tests** (`onboarding.agent.test.ts`, `onboarding.tools.test.ts`, `onboarding.service.test.ts`) | New strict-schema test; controller transition tests with no LLM mock; deleted safety-net tests | all | Code change |
| **Project Context** (`_bmad-output/project-context.md`) | Add invariant: "the onboarding controller owns moment transitions; the LLM converses and fills slots, it does not decide flow" | At approval | Two-line edit |
| **Memory** (`onboarding-builds-kitchen-map`, `strict-tool-schema-nullable-rule`) | Cross-link the strict-schema rule to onboarding once Slice 2 lands | s2 | Update memory |

### Technical Impact

- **No DB schema change expected.** Slot predicates read existing `onboarding_moment_state` + the Kitchen Map projection. (If a slot needs a column the moment state doesn't already carry, it is surfaced in Slice 6 — not anticipated.)
- **Tool surface:** `allergen.declare` gains optional structured `enforcement` (e.g. `'strict'`) + `request_ratification` fields, replacing the `[CHIP_PROMPT:elevation:...]` prose channel. All 11 tools otherwise unchanged in count and intent. Strict-mode null-stripping added before each handler's Zod parse.
- **Cost impact (the headline win):** target **~1 LLM call per typical turn** (down from 1–2 plus a separate classifier call once history ≥ 6). The `isSummaryConfirmed` classifier *call* is deleted entirely (completion becomes a slot predicate). Classifier/extractor calls that remain (`extractSummary`, `inferCulturalPriors`) move to a cheap model tier. Strict schemas remove error-recovery round-trips. Chip-only turns drop to zero conversational calls (deterministic tool application).
- **Latency:** fewer round-trips per turn → lower p95 turn latency. Trace writes are async/off-path and gated off by default.
- **Behavior preservation:** Slice 1 (eval) and Slices 2–5 are externally behavior-preserving (validated against the existing Epic 2.5/2.6 E2E suite and the new golden eval). Slices 6–7 change *internal* control but must hold the same external interview behavior, proven via the eval + shadow-run before cutover.
- **No new external services.** Reuses existing OpenAI + the planner's provider seam.

---

## Section 3 — Recommended Approach

### Selected path: build the regression gate first, port Epic 3.5's proven discipline, then invert control last

Four phases, lowest-risk first:

0. **Lock the behavior contract** (Slice 1): build the onboarding golden-set eval against *current* behavior before changing anything, so every later slice has a regression gate under it. This mirrors the planner exactly — its golden eval was 3.5-s1, shipped first.
1. **Port what the planner proved** (Slices 2–4): strict tool schemas, an `LLMProvider` seam with cheap classifier tiers, and an `ONBOARDING_TRACE_DIR`. These are largely *reuse of existing planner code*, behavior-preserving, and independently shippable. They also deliver the trace tooling that de-risks the inversion.
2. **Chip cleanup** (Slice 5): generate deterministic chips from the vocab/schema source of truth; move the two prose-sentinel chip behaviors onto structured channels; make chip-only turns cost ~zero LLM calls. Independently shippable; depends on Slice 2 for the `enforcement` tool field.
3. **Control inversion** (Slices 6–7): a deterministic `OnboardingController` owns the FSM via per-moment slot predicates; the LLM becomes a stateless turn function; the safety nets, sentinels, and the god method are deleted. Gated behind the eval (Slice 1), the trace dir (Slice 3), and a shadow-run.

### Why this path over alternatives

| Alternative | Why rejected |
|---|---|
| **Big-bang rewrite of the onboarding agent** | High blast radius on a shipped, well-tested module with live Epic 2.6 catalog integration. The phased path ships value (reliability + cost) from Slice 2 and isolates the one risky change (inversion) to the end, on top of the eval + trace tooling. |
| **Keep LLM-led FSM, just add strict schemas + cheap models** | Captures the cheap wins but leaves the root cause — the safety-net pile and the god method keep growing. The inversion is what makes onboarding *stop being fragile* and become testable without an LLM mock. |
| **Invert control first, build the eval/trace later** | Inverting without the regression gate (Slice 1 eval) and the trace dir (Slice 3) under it means debugging the riskiest change blind. Both must precede the inversion (Slices 6–7). |
| **Defer entirely (onboarding "works")** | It works at the cost of every malformed-tool-call round-trip, every frontier-model yes/no, and every new safety net. The planner already paid down this exact debt; the asymmetry compounds. |

### Risk register

| Risk | Mitigation |
|---|---|
| Strict schema rejects valid calls (the `bea6d4b` failure mode in reverse) | Slice 2 reuses the *exact* `makeNullable` + null-strip path the planner validated; add a test asserting optional fields serialize as `anyOf:[…,null]` and are stripped before Zod (memory `strict-tool-schema-nullable-rule`). |
| Cheap classifier model degrades summary/cultural-prior quality | Slice 4 validates `extractSummary` + `inferCulturalPriors` on fixtures against the current `gpt-4o` output before flipping; `inferCulturalPriors` already swallows failures to `[]` (silence-mode), so worst case is no regression. |
| Control inversion changes interview behavior subtly | The Slice 1 golden eval (built against current behavior) + Slice 3's trace dir + a shadow-run (old LLM-led path and new controller path on the same transcripts) before cutover; the eval and the Epic 2.5/2.6 E2E suite are the regression gates. |
| Deleting safety nets re-opens a transition the LLM used to "mostly" handle | The slot predicates are *stricter* than the heuristics they replace (state-derived, not prose-derived). Each deleted safety net maps to a slot predicate with a transition test. |
| Chip-key generation drifts from tool/vocab keys | Slice 5 adds the test that the hand-copied comments never had: generated chip keys ≡ accepted tool/vocab keys for M2/M3/M4. |
| Epic 2.6 M5 catalog projection regresses | Slices 5/6 treat `CatalogProjectionService` as a black-box input; M5 cold-start + Stage-0/1/2 behavior is asserted unchanged. |
| Zero-call chip turns drop the warm acknowledgment prose | **Resolved (Option A):** pure-chip turns use a code-filled template (zero calls); turns mixing chips + free text route through the LLM as normal. A small set of per-moment templates is authored in Slice 5. |

---

## Section 4 — Slice Decomposition (Draft)

**7 slices.** Walls are decision moments where the next slice cannot proceed without confirming the prior slice's invariant.

### 2.7-s1 — Onboarding golden-set eval harness (the regression gate, built first)

**Folds:** Port of Epic 3.5's golden-eval discipline (3.5-s1 analog). Built against *current* LLM-led behavior so every later slice has a regression gate under it.

**Acceptance criteria sketch:**
- New eval harness under `apps/api/src/agents/eval/` mirroring the planner's golden-set structure.
- A fixed set of representative interview scenarios — fixed user inputs (chip taps + free text) paired with **recorded/mocked LLM responses** so the harness is deterministic despite the conversational LLM (asserts structured outcomes, not prose).
- Per scenario, the golden assertion covers: moment transitions, slot fills (the resulting Kitchen Map state), and the tool calls fired (name + args). Cover the spine: M1 household+child, M2 allergen declare (incl. elevation), M3 dietary/cuisine, M4 bag, M5 starting-line (with Epic 2.6 catalog projection mocked), and finalize eligibility.
- Harness runs green against `main` *today* — this is the captured baseline. It is the byte-stable proof the later slices must keep green through the control inversion.
- Wired into CI alongside the planner eval.

**Edge cases to handle:**
- Conversational prose is non-deterministic → the eval asserts **structured outcomes only** (transitions, slot state, tool calls), never the assistant's wording. Document this explicitly so later slices don't over-fit to prose.
- Epic 2.6 M5 catalog projection (`CatalogProjectionService`) is mocked to a fixed fixture so M5 scenarios are stable.
- Scenarios must include the cases the safety nets currently rescue (LLM omits `[NEXT_MOMENT:]`, M3/M4 chip-only advance) so the inversion can be proven to preserve those outcomes.

**WALL: baseline wall.** The harness must capture and pass against current behavior before any behavior-touching slice proceeds.

---

### 2.7-s2 — Strict tool schemas for onboarding (behavior-preserving)

**Folds:** Port of Epic 3.5's strict-schema discipline (3.5-s2 analog) to onboarding's 11 tools.

**Acceptance criteria sketch:**
- `OnboardingAgent.toOpenAITools()` (`onboarding.agent.ts:99`) routes each tool's JSON Schema through `toStrictJsonSchemaParameters` / `makeNullable` from `openai.adapter.ts:97-178`.
- Tool args are null-stripped before the handler's `Schema.parse(input)` (memory `strict-tool-schema-nullable-rule`).
- Vocabulary validation stays at the handler boundary (NOT in the schema) — the model still gets a recoverable error on a bad tag.
- New test: every optional/nullable Zod field serializes as `anyOf:[…,null]` and is stripped before Zod; a previously-bounced malformed-arg fixture now succeeds without a recovery round-trip.
- `onboarding.agent.test.ts` + `onboarding.tools.test.ts` green; no change to tool count or intent.

**Edge cases to handle:**
- Open-vocab fields (`food_preference.declare`, free-text labels) must remain loose strings, not strict enums — strict mode applies to *shape*, not vocabulary.
- `rule.set`'s `.refine` (custom_label xor non-custom) and `household.upsert`'s mutually-exclusive `declared_allergens` vs `declared_allergens_add` must survive the strict transform (refinements don't serialize to JSON Schema — verify the handler-side throw still guards them).

**WALL: schema wall.** No downstream slice that relies on the tool schema (chips s5, inversion s6–s7) proceeds until the strict path is proven against the full tool suite, with the Slice 1 eval still green.

---

### 2.7-s3 — `ONBOARDING_TRACE_DIR` per-turn agentic trace

**Folds:** Port of the planner's `PLAN_TRACE_DIR` / `plan-tracer.ts`.

**Acceptance criteria sketch:**
- New `onboarding-tracer.ts` mirroring `plan-tracer.ts`. Env-gated by `ONBOARDING_TRACE_DIR` (`env.ts`), **off by default**, zero cost when unset.
- Per-turn artifact captures: assembled system prompt + the three dynamic blocks (Kitchen Map, moment-state, vocabulary — rendered at `onboarding.service.ts:1957-2100`), each tool call with args + result, model + token usage (`OnboardingAgentUsage`, `onboarding.agent.ts:23-35`, incl. `cachedPromptTokens`), and moment-state before/after.
- Test: with the var set, one artifact per turn containing all fields; with it unset, no artifact and no added latency.

**WALL: none, but this is the safety net for the inversion.** Must land before Slice 6.

---

### 2.7-s4 — `LLMProvider` seam + cheap classifier tiers + manifest dedupe

**Folds:** Port of Epic 3.5's provider-resilience/mini-tier work (3.5-s7 analog).

**Acceptance criteria sketch:**
- `OnboardingAgent` talks to the planner's `LLMProvider` (and `ResilientProvider` where retry/backoff applies) instead of the raw `OpenAI` client.
- `extractSummary`, `inferCulturalPriors`, and `isSummaryConfirmed` move to a cheap model tier (Haiku-class); the conversational turn stays on the strong tier. No remaining hardcoded `'gpt-4o'` in onboarding (grep-clean).
- Cheap-tier output validated against current `gpt-4o` output on fixtures before flip (extraction key-completeness, cultural-prior plausibility, yes/no exactness).
- `NotImplementedError` onboarding stubs deleted from `tools.manifest.ts:177-238`; one source of truth.
- Telemetry (`onboarding.text_turn_usage`) shows the per-turn token drop.

**Edge cases to handle:**
- `isSummaryConfirmed`'s strict `verdict === 'yes'` regex + prompt-injection delimiters must hold on the cheap model. (Note: this *call* is deleted in Slice 7 once completion is a slot predicate; keep it correct in the interim.)
- The dormant `respondSingleShot` voice path must stay behaviorally identical through the provider swap.

---

### 2.7-s5 — Chips as deterministic state output

**Folds:** Cleanup of the chip system's three channels into one deterministic source. Depends on Slice 2 (for the `enforcement` tool field).

**Acceptance criteria sketch (three independently valuable parts):**
- **4a — Schema-derived chips.** M2 chips generated from the allergen vocab, M3 from the dietary/cuisine vocab, M4 from `BagCompositionPatternSchema` — replacing the hand-copied lists in `momentToChipConfig` (`onboarding.service.ts:300-365`). New test: generated chip keys ≡ accepted tool/vocab keys for M2/M3/M4 (the drift guard the comments never had).
- **4b — Zero-call chip turns.** A pure-chip selection is applied deterministically (chip key `peanut` at M2 → `allergen.declare` directly), with **zero conversational LLM calls**; mixed chip+free-text still routes through the model. **DECIDED (Menon, 2026-06-26): acknowledgment prose for the pure-chip path is a code-filled template (Option A), no LLM call** — e.g. `"Got it — I've noted {allergens} to keep out of every plan."` filled deterministically by the controller from the selected chips. The rule: pure-chip turn → template (zero calls); chip + free text → LLM call.
- **4c — Elevation via tool, not sentinel.** `[CHIP_PROMPT:elevation:...]` regex (`onboarding.service.ts:240`) replaced by structured `allergen.declare(..., enforcement:'strict', request_ratification:true)`; the ratification chip renders as a deterministic consequence of the structured result (traced, validated, cannot half-leak into the message).

**Edge cases to handle:**
- M5 catalog-projected chips (`CatalogProjectionService`, Epic 2.6) are out of scope for derivation — treated as a black-box input; cold-start + Stage-0/1/2 behavior asserted unchanged.
- The `[CHIP_PROMPT:household_name]` hint swap is a *sub-state* of M1 → deferred to Slice 6 (needs slot state to know "kids asked, name not yet"); do not fake it here.
- Client-side 'none' mutual-exclusion for M2 (existing behavior) must keep working with generated chips.

**WALL: chip-source wall.** After this, chips have one deterministic source + the drift test; the two prose channels are gone (except the household_name swap, which lands in s6).

---

### 2.7-s6 — Slot model + `OnboardingController`

**Folds:** The core control inversion — deterministic FSM ownership. Depends on Slice 3 (trace) and gated by the Slice 1 eval.

**Acceptance criteria sketch:**
- Per-moment **required slots** defined as predicates over the Kitchen Map + `onboarding_moment_state` (e.g. M1: `household_name` + `≥1 child`; M2: `allergen_response` per child; M5: starting-line complete per Epic 2.6 gate).
- `OnboardingController` advances the moment the instant required slots are satisfied — by reading state, not parsing `[NEXT_MOMENT:]`. Forward-only ordering preserved (`MOMENT_ORDER`, `onboarding.service.ts:267`).
- The `household_name` M1 hint-chip swap (Slice 5 deferral) implemented as slot-derived.
- Controller transition tests run with **no LLM mock at all** — feed slot states, assert moment + chip config. (This testability is the headline maintainability win.)
- The Slice 1 golden eval stays green — the controller's transitions/slot-fills/tool-calls must match the captured baseline.

**Edge cases to handle:**
- Each existing safety net (M3/M4 chip auto-advance, kitchen-map re-anchoring, pre_start→m1 fallback) must map to a named slot predicate with a transition test before the safety net is deleted in Slice 7.
- Resume / reset mid-interview must reconstruct moment from slot state (covered by existing `onboarding.service.test.ts` resume/reset cases).

**WALL: controller wall.** Controller must shadow-run green (and keep the Slice 1 eval green) against representative transcripts before Slice 7 deletes the LLM-led path.

---

### 2.7-s7 — Pure turn function + delete safety nets + break up the god method

**Folds:** Retire the compensating heuristics, the sentinels, and the ~950-line `submitTextTurn`. Depends on Slices 5 and 6.

**Acceptance criteria sketch:**
- The LLM becomes a stateless turn function: `(moment, kitchen-map, user msg) → converse + fill slots`. No `[NEXT_MOMENT:]`, no `[CHIP_PROMPT:]`, no `[SESSION_COMPLETE]` — directive instructions removed from `onboarding.prompt.ts`.
- Deleted: M3/M4 chip auto-advance (`:956`, `:979`), kitchen-map re-anchoring (`:929`), pre_start fallback, and the `isSummaryConfirmed` **LLM call** (`:1385`) — completion is now a slot predicate. The deleted safety-net tests are *removed*, not skipped.
- `submitTextTurn` split into `OnboardingController` (FSM, from s6) + `TurnRunner` (assemble prompt → call provider → execute tools → trace) + a thin service (thread bookkeeping only).
- Per-turn LLM-call count drops to ~1 (was up to 6 + 1); telemetry confirms.
- Slice 1 golden eval + full Epic 2.5 + 2.6 onboarding E2E suite green; shadow-run parity confirmed before cutover.

**Edge cases to handle:**
- Finalization stays **never-auto** (explicit user Finalize tap; prompt `:296-297`) — the slot predicate gates *eligibility*, not auto-commit.
- The dormant voice single-shot path (`respondSingleShot`) keeps its `[SESSION_COMPLETE]` handling if it is genuinely still used; otherwise remove with the rest (confirm in slice).

**WALL: MVP wall.** After this slice, onboarding is controller-led, ~1 call/turn, and testable without an LLM mock.

---

## Section 4.5 — Reconciliation with the UX rebuild + planner routing docs (2026-06-26)

Two companion planning docs were drafted the same day as this brief and checked against it before developing 2.7-s2:

- [`lumi-conversational-ux-rebuild-vision.md`](./lumi-conversational-ux-rebuild-vision.md) — the Lumi-led conversational UX north star (onboarding §3, planner §4).
- [`plan-conversational-edit-routing-spec.md`](./plan-conversational-edit-routing-spec.md) — the "talk to your plan" intent-routing + `CatalogRepo.pick()` layer.

**Both are explicitly downstream of this epic** — they land *on top of* the inverted backend and reconcile to 2.7's finalized contracts (vision §0/§7/§8; routing spec §0/§1). **The 7-slice scope is unchanged and s2–s4 are unaffected.** The check surfaced exactly one decision-point and three alignment notes.

### Decision-point — UX §3d "front-load safety, defer the rest" vs. the required-set gate

The UX vision (§3d) proposes letting a parent reach a first plan after **Moments 1–2 only** (household + allergens), deferring M3/M4/M5 to conversational follow-up over the first week. This is the **only** item in either doc that would *change* 2.7 rather than layer on it, because 2.7 is built to **preserve** the current finalize gate:

> today's gate requires **M1 + M2 + M5** complete (`m1_household_name && m1_child_declared && m2_allergen_response && m5_complete`; `onboarding.service.ts` finalize + `required_set_complete`).

If §3d is adopted it changes (a) the completion/finalize **slot predicate** defined in **2.7-s6**, (b) the **2.7-s1 golden-eval baseline** (the `spine-happy-path` finalize-eligibility and `finalize-gate-negative` scenarios pin the current m1+m2+m5 gate), and (c) it depends on resolving the vision's own **open tension §6.1** ("does an M1+M2-minimum Kitchen Map produce a safe, non-embarrassing first week?").

**Default for Epic 2.7 (unless Menon says otherwise): PRESERVE the current m1+m2+m5 gate.** 2.7 is a re-architecture, not an interview-content change (see "What this brief explicitly does NOT cover"), and §3d is flagged unresolved in its own source doc. **If §3d is wanted, decide it BEFORE 2.7-s6** — that is where the predicate is defined and is the cheapest point to re-baseline the s1 eval; adopting it after s7 stacks a second behavior change on top of the inversion. Folding it in would require updating: this brief's gate references, the s6 AC for the completion predicate, and the s1 goldens (re-capture against the new gate).

### Alignment notes (reusability — NOT scope changes; bake into the named slice)

1. **2.7-s4 (provider seam) — keep the tiered call + null-strip reusable.** The planner routing spec (§5) plans to reuse 2.7's exact shapes: a `llm.completeWithTool({ tier: 'cheap', ... })`-style call and an importable `stripNulls`/`makeNullable` helper. s4 already routes onboarding through `LLMProvider` with cheap tiers — just ensure the tiered-call shape and the null-strip helper are *exported/shared*, not onboarding-private, so the planner epic can "rename, don't rethink."
2. **2.7-s5/s7 (chips) — plumb structured `chip_selections`, kill the bracket string.** The UX vision (§3b) wants the internal `[Chips selected: …]` bracket-string encoding gone — which is exactly s5's zero-call chip path. Ensure s5 passes the structured `chip_selections` (existing `ChipTurnBodySchema`) straight to the controller rather than re-parsing the bracket string, so the deterministic chip turn and the UI rebuild share one structured channel.
3. **2.7-s6/s7 (controller split) — stable, documented names.** The planner routing spec mirrors the `OnboardingController` / `TurnRunner` names verbatim (its `dispatchIntent()` / `routeIntent()` are the planner analogs). Keep those names clean and record the split in `project-context.md` (already planned in the artifact-conflicts table) so the future planner epic reconciles by renaming, not redesigning.

### No API / contract / DB change beyond what this brief already lists

The only contract delta remains s5's `allergen.declare` gaining `enforcement` / `request_ratification`. The routing spec's new surfaces (`packages/contracts/src/plan-intent.ts`, `routePlanIntent.ts`, `dispatchPlanIntent.ts`, `CatalogRepo.pick()`) belong to the **separate future planner epic**, not 2.7. The UI rebuild consumes the turn response 2.7 already returns (`chip_config`, `moment_key`, `required_set_complete`, `cold_start_mode`, `household_display_name`) — no new onboarding endpoint or field.

---

## Section 5 — Implementation Handoff

### Sequence

```
2.7-s1 (golden-set eval — built against current behavior)  ← WALL: baseline (regression gate for all later slices)
  └─ 2.7-s2 (strict tool schemas)                            ← WALL: schema
     2.7-s3 (ONBOARDING_TRACE_DIR)                            ← safety net for the inversion
     2.7-s4 (LLMProvider seam + cheap tiers + dedupe)
       └─ (s2, s3, s4 independent of each other; any order; all behavior-preserving, all kept green by s1 eval)
            └─ 2.7-s5 (chips deterministic; needs s2)          ← WALL: chip-source
                 └─ 2.7-s6 (controller + slots; needs s3, gated by s1) ← WALL: controller (shadow-run + eval)
                      └─ 2.7-s7 (pure turn fn; needs s5+s6)    ← WALL: MVP
```

- **Slice 1 (eval) ships first** — it captures the behavior baseline and is the regression gate every later slice must keep green.
- **Slices 2, 3, 4 ship in any order** after s1 and deliver reliability + cost value alone (behavior-preserving).
- **Slice 5** depends on Slice 2 (for the `enforcement` field) but not on the FSM work.
- **Slices 6–7** are the control inversion; the Slice 1 eval and Slice 3's trace must be under them.

### Epic MVP wall

**Wall placement:** 2.7-s7. The user-invisible-but-real win (controller-led, ~1 call/turn, no safety nets) lands here. Slices 1–5 each ship measurable value before it.

### Pre-flight before approval

1. **Confirm the `LLMProvider` / `ResilientProvider` seam is reusable as-is** from Epic 3.5 for a second consumer (quick check — the interface was built generic).
2. **Pick the cheap classifier tier** (Haiku-class) and confirm fixtures exist for `extractSummary` + `inferCulturalPriors` quality validation (Slice 4).
3. ~~Decide the zero-call chip acknowledgment treatment~~ — **DECIDED (Menon, 2026-06-26): Option A, code-filled template for pure-chip turns; chip + free text routes through the LLM. Slice 5 authors the per-moment templates.**
4. ~~Decide whether the onboarding golden-set eval is in scope~~ — **DECIDED (Menon, 2026-06-26): in scope, and pulled out into its own opening slice (2.7-s1)** so it is the regression gate under every later slice — mirroring the planner's 3.5-s1.
5. **Confirm no DB column is missing for any slot predicate** (Slice 6) — not anticipated, but verify against `onboarding_moment_state` + Kitchen Map projection.
6. **Project Context invariant** — add "onboarding controller owns moment transitions; the LLM converses and fills slots."

### Acceptance criteria — epic-level

Epic 2.7 is **done** when:

1. An onboarding golden-set eval harness (`agents/eval/`) exists, captured the pre-change baseline, and stays green across every slice — the regression gate for the whole epic.
2. All onboarding tool calls go through the strict-schema adapter; malformed-arg recovery round-trips are eliminated.
3. No hardcoded `'gpt-4o'` in onboarding; classifiers/extractors run on the cheap tier; provider goes through `LLMProvider`.
4. `ONBOARDING_TRACE_DIR` produces a per-turn trace artifact (off by default).
5. Chips have one deterministic source with a key↔vocab drift test; the two prose-sentinel chip channels are gone.
6. An `OnboardingController` owns moment transitions via slot predicates; the LLM no longer emits `[NEXT_MOMENT:]` / `[CHIP_PROMPT:]` / `[SESSION_COMPLETE]`.
7. The service-side safety nets and the `isSummaryConfirmed` LLM call are deleted; per-turn LLM calls ≈ 1.
8. `submitTextTurn` is decomposed into controller + turn-runner + thin service.
9. Full Epic 2.5 + 2.6 onboarding E2E suite green; no behavior regression (eval + shadow-run confirmed).

### What this brief explicitly does NOT cover

- **Voice onboarding.** Text-first remains the doctrine (memory `onboarding-text-first`); the single-shot voice path is kept behaviorally identical, not enhanced.
- **New onboarding moments or interview content.** This is a re-architecture of *how* the interview runs, not *what* it asks.
- **Epic 2.6 catalog internals.** `CatalogProjectionService` and the Stage-0/1/2 + cold-start chip paths are consumed as a black box, not modified.
- **Kitchen Profile edit paths (Epic 7) / Visible Memory.** Out of scope.
- **The planner.** Epic 3.5 already shipped; 2.7 only *borrows* its patterns.

---

## Approval

- [ ] **PM (Menon):** brief shape and slice scope
- [ ] **Architecture review:** control-inversion model (controller owns FSM, LLM as stateless turn function) reviewed; provider-seam reuse confirmed
- [ ] **Sprint plan update:** Epic 2.7 added to `sprint-status.yaml` with 7 slices

Upon approval, this brief is the input to `bmad-create-epics-and-stories` (then `bmad-sprint-planning`) for Epic 2.7 generation.

---

## Appendix — References

- `_bmad-output/planning-artifacts/epic-2.6-brief.md` — Precedent format for this brief
- `apps/api/src/agents/onboarding.agent.ts` — `OnboardingAgent` (582 lines; gaps #1, #2, #7)
- `apps/api/src/modules/onboarding/onboarding.service.ts` — `submitTextTurn` god method (`:468-1417`); `momentToChipConfig` (`:296`); sentinel parsing (`:240`, `:828`, `:835`); safety nets (`:929`, `:956`, `:979`); dynamic prompt blocks (`:1957-2100`)
- `apps/api/src/agents/tools/onboarding.tools.ts` — 11 tool handlers (951 lines)
- `packages/contracts/src/onboarding-tools.ts` — onboarding tool Zod schemas
- `apps/api/src/agents/prompts/onboarding.prompt.ts` — interview prompt (417 lines)
- `apps/api/src/agents/providers/openai.adapter.ts` — strict-schema machinery (`:97-178`), reused by Slice 2
- `apps/api/src/agents/tools.manifest.ts` — `NotImplementedError` onboarding stubs (`:177-238`), deleted by Slice 4
- `apps/api/src/modules/onboarding/onboarding-moment.repository.ts` — 8-state moment machine (`:26-34`)
- Planner re-architecture (Epic 3.5) — `plan-tracer.ts` / `PLAN_TRACE_DIR`, `LLMProvider` / `ResilientProvider`, `agents/eval/` (patterns ported here)
- Memory: `strict-tool-schema-nullable-rule`, `onboarding-text-first`, `onboarding-builds-kitchen-map`, `chip-taxonomy-three-types`, `kitchen-map-cache-trigger-gap`
