# Epic 3.5 Brief — Planner Agentic-Module Re-Architecture (Reliability · Cost · Maintainability)

**Date:** 2026-06-24
**Author:** Drafted via `bmad-correct-course` (Developer persona) at Menon's request, following a deep read of the live plan-compose pathway
**Triggered by:** Menon (architecture review of `apps/api/src/agents/` after Epic 3 planner stories 3-s32 → 3-s44 shipped)
**Scope classification:** **Major** (architecture-level re-architecture of Epic 3's plan-compose core) — but **zero PRD / FR / user-facing change.** Needs Architect sign-off; no PM replan.
**Status:** Awaiting approval
**Format:** Sprint-change-proposal style (mirrors `epic-2.6-brief.md` and `sprint-change-proposal-2026-05-19.md`)

---

## Section 0 — Decisions Already Locked (pre-brief)

Three gating decisions were made by Menon before this brief was drafted (via structured Q&A 2026-06-24). They are baked into the structure below and are **not** re-litigated here:

1. **Vehicle:** Correct-course brief first → then epic + slices. (This document is that brief.)
2. **Launch timing — SPLIT:** Slices **s1–s4 ship pre-Oct-1 launch** (high reward, low risk, no behavior change to the safety path). Slices **s5–s7 are post-launch hardening** (the loop-collapse rewrite waits until after the NFR-SCAL-2 5,000-HH launch).
3. **Epic identity:** **New decimal epic — Epic 3.5** (re-architecture of Epic 3's core; mirrors how 2.5 and 2.6 were inserted).

---

## Section 1 — Issue Summary

### Problem statement

The plan-compose pathway works and is, in places, genuinely well-designed (pre-loaded context, deterministic snack rotation, deterministic post-hoc allergy guardrail, low-temp decoding, tiered models, provider failover). But its **core control structure — an open agentic ReAct loop in `DomainOrchestrator.planWeek`** — forces a large amount of imperative compensation code that is the source of the module's reliability, cost, and maintainability tax:

- A `MAX_PLAN_ITERATIONS` ceiling (currently 8) that must be hand-tuned every time the tool set changes.
- A "stopped without calling plan.compose" re-injection branch that rescans the entire message history to reconstruct recipe IDs.
- A `recipe_id`-as-name resolution layer (`recipeService.findIdByName`) plus a "Recipe not found → feed the error back to the model → retry" self-correction loop, because the model emits free-text names that may not resolve.
- A schema-validate-then-throw path on `plan.compose` output, with a `planner.bad_output` audit event and a documented **prompt-rollback runbook** (`planner-prompt-rollback.md`, §10.7) that fires when the bad-output rate exceeds 5%.

Every one of those exists to compensate for the model being free to *not* produce the one structured artifact we need. The reliability problem is an **architecture** problem, not a prompting problem.

### The key insight

The project's own commit history already points the right way. Planner prompt versions **v2.5.0 → v2.8.0** progressively *removed* tools from the allowlist (`memory.recall`, `cultural.lookup`, `allergy.check`, `child_signal`, `pantry.read`) because their data became **pre-loaded** into the prompt as context blocks (`<user_profile>`, `<household_memory>`, `<memory_policy>`, `<child_signals>`, `<pantry>`, `<recipe_candidates>`). Documented effect: planning turns dropped from ~15–36 down to **~1–2 on a warm catalog**.

The logical conclusion of that trajectory: **on the happy path, plan compose should not be an agent loop at all.** It should be a single constrained-decoding call with the schema *forced* at the decode layer and no tools. The loop only ever existed to service the `recipe.search / recipe.fetch / recipe.discover` fallback — which can be lifted out into a deterministic pre-flight ("can the candidate slate fill every slot? if not, acquire recipes first") that runs as ordinary async code, not as model-driven control flow.

### Why now (and why a split)

- **Cost & reliability are launch-relevant.** NFR-COST-3 caps LLM cost per plan at ≤$0.25; NFR-SCAL-2 targets 5,000 concurrent households on Oct 1, 2026; NFR-SCAL-5 requires the weekend batch to clear in ≤36h. Self-correction turns and schema-drift retries are pure waste against all three. The **s1–s4 subset** (eval harness + forced schema + handle-index + render/assemble extraction) buys most of the reliability/cost win with **no behavior change to the safety path** — safe to land pre-launch.
- **The deep rewrite is not launch-safe.** Collapsing the loop to single-shot (s5) is a medium-risk change to an allergen-critical flow. Doing it during launch crunch is the wrong risk. Deferred to **post-launch hardening (s5–s7)**.
- **Alignment with standing commitment.** The `data-model-redesign-before-beta` memory records a pre-beta commitment to *canonical, from-first-principles* redesign over bolt-on patches. This epic is the agent-layer analogue of that commitment, scoped to respect the launch.

### Evidence (specific, from the live code)

1. **Self-correction machinery in `orchestrator.ts`.** `planWeek` (`apps/api/src/agents/orchestrator.ts:372–735`) contains: the stopped-without-compose nudge (`:556–593`), the validation-error-feedback branch that rebuilds a `knownRecipes` list by re-parsing every prior tool result (`:609–666`), and the `planner.bad_output` audit + throw (`:680–701`). ~150 lines exist purely to recover from the model's freedom to produce wrong/no output.

2. **Name→UUID resolution as a reliability crutch.** `createPlanComposeSpec` (`apps/api/src/agents/tools/plan.tools.ts:37–63`) resolves recipe *names* to catalog UUIDs because "the model is more reliable at producing recipe names than at copying long UUID strings." Unknown name throws "Recipe not found," which is then fed back into the loop for a retry. A handle-index (`m2`/`e1` into the pre-loaded slate) removes the failure mode entirely.

3. **Schema asked-for, not enforced.** `plan.compose` output is validated with `PlanComposeTreeOutputSchema.safeParse` *after* generation (`orchestrator.ts:681`), and `temperature: 0.2` plus the §10.7 rollback runbook are explicitly there to suppress format drift (`orchestrator.ts:520–531`). Provider-native strict JSON-schema / forced `tool_choice` makes schema-invalid output structurally impossible.

4. **Context rendering buried in the orchestrator.** `renderPlannerKitchenMapBlock` and its sibling renderers (`orchestrator.ts:1256–1486`, ~230 lines) carry correctness-critical escaping (`yamlStr`, `sanitizePromptField` — which strips `<`, `>`, `\n` to prevent prompt-block injection from user-controlled strings) with **no isolated test surface**. They live inside a 1,000-line file that mixes provider failover + the ReAct loop + rendering.

### Categorization

Per checklist item 1.2: **Strategic / proactive re-architecture surfaced by review of shipped, working code** — not a bug, not a failed approach. The plan-compose path passes acceptance for every Epic 3 story it implements. The opportunity is structural: subtraction of model-driven control flow that the system has already been trending away from.

---

## Section 2 — Impact Analysis

### Epic Impact

| Epic | Status before | Status after | Notes |
|---|---|---|---|
| **Epic 3 — Weekly Plan & Ready-Answer Open** | `in-progress` (3-s32 → 3-s44 done/review) | **Unchanged in scope.** Epic 3.5 re-architects the *internals* of the planner Epic 3 built; it adds no Epic 3 stories and removes none. | Coordination risk only (shared files — see Technical Impact). |
| **Epic 3.5 — Planner Agentic-Module Re-Architecture (this brief)** | — | **NEW. `backlog` → `in-progress` when s1 begins.** 7 slices, split s1–s4 (pre-launch) / s5–s7 (post-launch). | Strangler-fig, eval-gated. |
| **Epic 3 — Story 3-31 (Recipe Agent — Tavily fetch)** | `done` | **Unchanged.** `recipe.discover` / `RecipeAgent` remain the fallback acquisition path; s5's pre-flight calls the same path, just deterministically. | Reused, not modified. |
| **Epic 3 — Story 3-39 (commit-time recipe-ingredient guardrail)** | `done` | **Unchanged — and load-bearing for this epic.** The deterministic guardrail is the safety backstop that makes a forced-schema, fewer-turns planner safe. | Hard dependency. |
| **Epic 12 — Ambient Lumi / conversational orchestration** | partially shipped | **Unchanged; benefits later.** The "merged orchestrator / no separate triage agent" principle (orchestrator.ts:749–754) is preserved; s5's single-shot pattern is the reference the conversational path can adopt. | No contract dependency. |
| **Epics 4, 5, 6, 7, 8, 9, 10, 11** | various | No change. | No contract dependency on planner internals. |

### Story Impact

**Added (Epic 3.5):** 7 slices (Section 4).

**No pauses.** Unlike Epic 2.5's birth, Epic 3.5 pauses no downstream work. Each slice lands behind the existing `planWeek` / `plan.compose` interface (strangler-fig); the live path keeps working until a slice supersedes a piece of it, gated by the s1 eval harness.

**No new stories in other epics.** No FR is added, amended, or removed.

### Artifact Conflicts

| Artifact | Conflict | Slice | Action |
|---|---|---|---|
| **PRD** (`planning-artifacts/prd.md`) | **None.** No FR changes. Reliability/cost targets (NFR-COST-3, NFR-PERF-1, NFR-SCAL-2/5, NFR-REL-5, NFR-INT-6) are *served better*, not changed. | — | No edit |
| **Architecture** (`planning-artifacts/architecture.md`) | AR-2 (LLMProvider adapter + circuit breaker) gains a "single-shot compose / forced structured output" note; a new sub-section describes the planner pipeline `assemble → ensure-coverage → compose → guardrail → swap → commit`. AR-3/AR-4 unchanged. | Pre-s1 (note) + s5 (pipeline) | 2 amendments |
| **UX Spec** | **None.** Planner internals are not user-visible. | — | No edit |
| **Sprint Status** (`implementation-artifacts/sprint-status.yaml`) | Add `epic-3.5` block with 7 slices + retrospective key; mark s1–s4 pre-launch, s5–s7 post-launch. | At brief approval | Direct edit |
| **Contracts** (`packages/contracts/src/`) | `PlanComposeTreeInputSchema` / `PlanComposeTreeOutputSchema` may gain a **candidate-handle** form (s3) — additive (handle XOR name XOR uuid), no breaking change. The strict-JSON-schema projection for forced decoding (s2) is derived from the existing schema, not a new wire shape. | s2, s3 | Additive code change |
| **Agent orchestrator** (`apps/api/src/agents/orchestrator.ts`) | Render functions extracted (s4); loop collapsed (s5); resilience extracted (s7). | s4, s5, s7 | Code change |
| **Plan tool** (`apps/api/src/agents/tools/plan.tools.ts`) | Forced-schema decode (s2); handle-index resolution replaces `findIdByName` fuzzy path (s3). | s2, s3 | Code change |
| **Provider adapters** (`apps/api/src/agents/providers/*.ts`) | `openai.adapter.ts` / `anthropic.adapter.ts` gain a strict-structured-output call mode; resilience (circuit breaker + 429 reset-token parsing) extracted to a decorator (s7). | s2, s7 | Code change |
| **Planner prompt** (`apps/api/src/agents/prompts/planner.prompt.ts`) | Stable doctrine separated from the manual `// vX.Y.Z` changelog; worked examples become schema-aligned few-shot validated in CI. Versioning moves to content-hash bound to an eval run (s1). | s1, s5 | Code change |
| **Project Context** (`_bmad-output/project-context.md`) | Add invariant: "planner compose is forced-schema single-shot on the happy path; recipe acquisition is a deterministic pre-flight, not model-driven control flow" (after s5). | At s5 ship | Two-line edit |
| **Memory** | Update `recipe-agent-lazy-catalog` (discover is now a pre-flight call site) and add a note to `data-model-redesign-before-beta` linking this epic. | At epic close | Memory edits |

### Technical Impact

- **New test infrastructure (s1):** a planner **golden-set eval harness** — recorded household fixtures (KitchenMap + signals + candidate slate) → run the planner → assert: (a) **allergen-safe** against declared allergens, (b) **slot coverage** for every active slot, (c) **no two consecutive days share a Main**, (d) **schema-valid** output, (e) **cost/turn budget** (tokens + tool-call count). Deterministic via stubbed LLM responses per the project-context testing rule ("Test decisions… not LLM output verbatim"). This is the gate every subsequent slice must pass; it is also the highest-leverage maintainability deliverable.
- **Forced structured output (s2):** OpenAI strict `response_format: json_schema` / Anthropic forced `tool_choice`. Deletes the self-correction branch and the `planner.bad_output` → throw path. Net code *removed*, not added.
- **Candidate handle-index (s3):** the pre-loaded `<recipe_candidates>` slate is rendered with stable short handles (`main: m1,m2…`, `extra: e1,e2…`); the model returns a handle; deterministic map back to UUID. Removes `findIdByName` fuzzy resolution and the "Recipe not found" retry. Free-text-name path retained behind a flag for the cold-acquisition case until s5.
- **Render/assemble extraction (s4):** pure `context/assemble.ts` (typed `PlannerContext` from repos) + pure `context/render.ts` (string from `PlannerContext`), snapshot-tested. No behavior change — a refactor that makes prompt iteration safe.
- **Loop collapse (s5, post-launch):** `planWeek` becomes `assemble → ensureCandidateCoverage (deterministic; only place tools run) → compose (single forced call, no tools) → guardrail → swap → commit`. Removes `MAX_PLAN_ITERATIONS`, the stopped-without-compose nudge, and the validation-feedback loop.
- **Push rules out of the LLM (s6, post-launch):** the no-consecutive-Main rule (currently prompt-only/best-effort, v2.6.0, no validator) becomes a deterministic post-pass; portion/spice defaults by `age_band` move to code. Shrinks the model's judgment surface to "which recipe fits this family."
- **Provider resilience extraction + mini-tier eval (s7, post-launch):** circuit-breaker + `x-ratelimit-reset-tokens` parsing (orchestrator.ts:306–350, 955–1020) move to a `providers/resilience.ts` decorator with its own tests; an eval compares flagship-vs-mini compose quality on the golden set to test whether compose can drop a tier (NFR-COST-3 headroom).
- **Coordination risk (shared files).** Epic 3 actively edits `orchestrator.ts` and `planner.prompt.ts` (3-s40, 3-s42 touched both). s4 (extraction) and s5 (collapse) collide with any in-flight Epic 3 planner slice. **Mitigation:** schedule s4/s5 when the planner files are quiescent, or rebase-coordinate; s1/s2/s3 touch mostly distinct surfaces (test dir, plan.tools.ts, providers) and are lower-collision.
- **Cost impact:** **net negative (cheaper).** s2+s3 remove self-correction turns; s5 removes the loop; s7 tests a tier drop. No new external services. s1 adds CI eval cost (stubbed LLM — negligible).
- **Safety posture:** **unchanged or stronger.** The deterministic allergy guardrail (AR-3, story 3-39) remains the sole authority on render-eligibility (FR76/FR77, NFR-INT-6: "allergen decisions never routed through LLM judgment alone"). Nothing in this epic moves an allergen decision into the model. The s1 eval adds a *second*, earlier allergen check at plan-generation time as a regression net.

---

## Section 3 — Recommended Approach

### Selected path: Strangler-fig re-architecture behind the existing interface, eval-gated, split across the launch

**Concretely:** Land each improvement behind the current `planWeek` / `plan.compose` interface, gated by the s1 golden-set eval so no slice can regress allergen-safety, coverage, or the no-consecutive-Main rule. Ship the low-risk reliability/cost subset (s1–s4) before Oct 1; defer the loop-collapse rewrite (s5–s7) to post-launch hardening.

### Why this path over alternatives

| Alternative | Why rejected |
|---|---|
| **Big-bang rewrite of `planWeek`** | Rewrites an allergen-critical path in one PR with no incremental safety net. Unreviewable (<500-line PR discipline), un-rollbackable per slice, and directly against the `data-model-redesign-before-beta` "no bolt-on, but also no reckless rewrite" spirit. |
| **Straight to stories, skip the brief** | This changes the contract of in-flight Epic 3 work and a safety path. The project's precedent (2.6 brief, 2026-05-19 proposal) is to record scope/sequencing/Epic-relationship in a brief *first*. Skipping it is how the 2.5→2.6 scope collision happened. |
| **Do the whole epic pre-launch** | s5 is a medium-risk rewrite; doing it during the NFR-SCAL-2 launch window concentrates risk at the worst time. The split captures ~most of the reward (s1–s4) at low risk now and sequences the risk after launch. |
| **Prompting-only fixes (lower temp, better examples, bigger rollback runbook)** | Treats the symptom. The bad-output rate, the name-resolution loop, and the iteration ceiling are all downstream of the model being free to not emit the artifact. Forcing the schema and removing tool freedom is the root fix. |
| **Defer entirely to post-launch** | Leaves NFR-COST-3 / NFR-SCAL-5 paying the self-correction tax through the launch peak — exactly when turn-count waste is most expensive. s1–s4 are low-risk enough to bank now. |

### Eval-as-gate decision (resolved)

The s1 golden-set harness is **the** gate, not an optional add-on. Every slice s2–s7 must pass it before merge. This converts the current reactive posture — "bad-output rate spiked >5% in prod, execute the §10.7 rollback runbook" — into a preventive one: "the change failed eval, it never merged." Prompt and model versions become **content-hash bound to an eval run**, retiring the manual `// vX.Y.Z` changelog and the rollback runbook as the primary safety mechanism.

### Risk register

| Risk | Mitigation |
|---|---|
| A slice silently regresses allergen-safety | s1 eval asserts allergen-safety on every fixture and gates every downstream merge; the deterministic commit-time guardrail (3-39) remains the independent backstop. Two independent nets. |
| Forced JSON-schema differs in capability across providers (OpenAI strict vs Anthropic tool_choice) | s2 implements per-adapter; the eval runs against the primary (OpenAI) path; Anthropic failover path validated separately. If a provider can't force the full schema, fall back to that provider's forced-`tool_choice` + post-validate (current behavior) for that provider only. |
| Merge collision with in-flight Epic 3 planner slices on `orchestrator.ts` / `planner.prompt.ts` | Sequence s4/s5 in a quiescent window; keep s1/s2/s3 on lower-collision surfaces; rebase-coordinate. Flagged in Section 5 sequencing. |
| Handle-index breaks the cold-acquisition path (recipe not yet in slate) | s3 retains the free-text-name resolution behind a flag for cold acquisition; s5's deterministic pre-flight is what finally removes the need for in-loop acquisition. |
| Single-shot (s5) can't handle a genuinely empty/insufficient slate | s5's `ensureCandidateCoverage` runs `recipe.search`/`discover` *before* compose when the deterministic coverage check fails; compose is only called once coverage is guaranteed. The loop's job moves earlier, it isn't deleted blindly. |
| Mini-tier compose (s7) degrades plan quality | s7 is gated by an explicit flagship-vs-mini eval on the golden set; ship the tier drop only if quality holds. Otherwise keep flagship and bank only the structural wins. |
| Post-launch slices (s5–s7) get deprioritized and the loop tax persists | The epic carries an explicit post-launch retrospective key; s1–s4 are structured to make s5 a smaller, well-bounded change (the recovery branches are already dead code by then). |

---

## Section 4 — Slice Decomposition (Draft)

**7 slices.** `WALL` marks a decision moment where the next slice cannot proceed without confirming the prior slice's invariant. **[PRE-LAUNCH]** / **[POST-LAUNCH]** mark the split.

### 3.5-s1 — Planner golden-set eval harness (the safety net) **[PRE-LAUNCH]**

**Folds:** Foundation. Characterization + regression gate. Prompt/model versioning by eval.

**Acceptance criteria sketch:**
- New test suite (e.g. `apps/api/src/agents/eval/planner-golden.eval.test.ts` + `fixtures/`) with ≥8 recorded household fixtures spanning: single-child Anglo; multi-child with a declared FALCPA allergen (peanut-fork case); Halal + vegetarian intersection; partial-week / day-scope; empty-ish candidate slate (cold-acquisition); sovereignty `alternating`; high-activity Extra proposal; banned-recipe present.
- Each fixture carries a full `PlannerContext` (KitchenMap + `<child_signals>` + `<pantry>` + `<recipe_candidates>`) and a deterministic stubbed LLM response (per project-context testing rule — assert decisions, not live LLM output).
- Assertions per fixture: (a) **allergen-safe** — no slot's effective ingredient set contains a declared allergen for that child; (b) **slot coverage** — every active slot filled; (c) **no-consecutive-Main** — adjacent days differ; (d) **schema-valid** — output parses `PlanComposeTreeOutputSchema`; (e) **budget** — tool-call count and prompt/completion tokens within a recorded ceiling.
- A single `runPlannerEval()` entry callable from CI; failure prints the violated assertion + fixture id.
- Prompt/model version recorded as a **content hash** alongside each eval run; the `// vX.Y.Z` changelog in `planner.prompt.ts` is annotated as descriptive-only (no longer the safety mechanism).
- Documents the **current** behavior as the baseline (characterization) — this slice asserts parity, it does not change planner behavior.

**Edge cases to handle:**
- **Stubbed LLM must exercise the recovery branches too.** Include at least one fixture whose stubbed response is initially schema-invalid, to pin current self-correction behavior before s2 removes it (so s2's diff is provably a no-op on outcome).
- **Allergen assertion must walk the effective set** (recipe ingredients − removals + add_ons), matching the commit-time guardrail (story 3-39), not just declared slot ingredients.
- **Determinism:** no `Date.now()` / `Math.random()` in fixtures or assertions; seed any variability.

**WALL: baseline wall.** No downstream slice merges until the golden set is green and ratified as the parity baseline.

---

### 3.5-s2 — Forced structured output on `plan.compose` **[PRE-LAUNCH]**

**Folds:** Reliability — eliminate schema drift + the self-correction loop.

**Acceptance criteria sketch:**
- `openai.adapter.ts` gains a strict structured-output mode (`response_format: { type: 'json_schema', strict: true }`) derived from `PlanComposeTreeInputSchema`; `anthropic.adapter.ts` uses forced `tool_choice` on the `plan.compose` tool.
- The orchestrator's `plan.compose` output path drops the `safeParse`-then-throw + `planner.bad_output` self-correction branch on the primary provider (kept as a fallback only for a provider that cannot force the full schema).
- The stopped-without-compose nudge and the validation-error-feedback `knownRecipes` reconstruction become unreachable on the forced path; remove the now-dead code paths they guard (clean up own orphans only).
- Eval (s1) passes unchanged; tool-call count and token budget for the schema-invalid fixture **improve** (no self-correction turn).
- `temperature` decision documented: forced schema lets us decouple format-stability from temperature; keep 0.2 unless the eval shows variety headroom.

**Edge cases to handle:**
- **Provider parity:** Anthropic failover path validated to still produce a valid tree via forced `tool_choice`; if not fully forceable, that provider retains post-validate behavior (documented, eval-covered).
- **`reasoning` field:** the optional `reasoning` metadata (Slice 5-S9) currently recovered from raw args (plan.tools.ts:71–76) must survive the strict-schema projection — include it in the forced schema or keep the raw-args recovery.

---

### 3.5-s3 — Candidate handle-index (no model-emitted identifiers) **[PRE-LAUNCH]**

**Folds:** Reliability — remove `findIdByName` fuzzy resolution + "Recipe not found" retry.

**Acceptance criteria sketch:**
- `renderPlannerRecipeCandidatesBlock` emits stable short handles per group (`main: m1,m2,…`, `extra: e1,e2,…`); the prompt instructs the model to return the **handle** as the slot's recipe reference.
- `PlanComposeTreeInputSchema` accepts a candidate-handle form (additive: handle XOR catalog-name XOR uuid); `plan.compose` resolves handle → slate row → UUID deterministically (no DB fuzzy match for slate hits).
- `findIdByName` is retained only for the cold-acquisition path (recipe surfaced by `recipe.search`/`discover` mid-run, not in the pre-loaded slate), behind a flag; for slate-sourced recipes it is bypassed.
- The "Recipe not found → feed error back" loop is removed for slate-sourced compositions (unreachable once handles resolve deterministically).
- Eval (s1) passes; add a fixture asserting a handle that doesn't exist in the slate is a **hard, non-retried** error (caught by s1's schema/coverage assertion), not a self-correction turn.

**Edge cases to handle:**
- **Handle stability across a regen/guardrail-retry** within the same job: the slate is assembled once per job (plan-generation.job.ts), so handles are stable across the retry callback — assert this.
- **Extra vs main handle namespaces** must not collide (`m*` vs `e*`); snack is server-assigned (no handle).

---

### 3.5-s4 — Extract `context/assemble.ts` + `context/render.ts` (pure) **[PRE-LAUNCH]**

**Folds:** Maintainability — lift ~230 lines of rendering out of the orchestrator; make prompt iteration safe.

**Acceptance criteria sketch:**
- New `apps/api/src/agents/planner/context/render.ts` holds `renderPlannerKitchenMapBlock`, `renderPlannerChildSignalsBlock`, `renderPlannerPantryBlock`, `renderPlannerRecipeCandidatesBlock`, and the `buildXxxLines` helpers — moved verbatim, now pure `(PlannerContext) → string`.
- New `apps/api/src/agents/planner/context/assemble.ts` defines the typed `PlannerContext` and assembles it from the already-loaded repo outputs (the job's `Promise.all` batch), so `planWeek`'s caller passes a typed object instead of 20 positional-ish options.
- **Snapshot tests** on `render.ts` against the s1 fixtures (snapshot structured prompt strings — permitted by the testing rule, which bans DOM snapshots, not data snapshots). Escaping invariants (`yamlStr`, `sanitizePromptField` stripping `<`,`>`,`\n`) get explicit assertions, including a prompt-injection fixture (user-controlled child name containing `</user_profile>`).
- `orchestrator.ts` shrinks to provider failover + the loop; no behavior change; eval (s1) byte-stable on prompt output (snapshot equality).
- Respect the 300-line file ceiling (project-context) — `orchestrator.ts` should drop well under it for the rendering concern.

**Edge cases to handle:**
- **Pure refactor discipline:** zero behavior change. The snapshot must match the pre-refactor prompt string exactly for every fixture (prove the move is mechanical).
- **No circular imports** between `planner/context/*` and the orchestrator (project-context invariant).

**WALL: pre-launch wall.** After s4, the reliability/cost subset is complete and parity-verified. s5–s7 are post-launch and must not start before the Oct 1 launch is stable.

---

### 3.5-s5 — Collapse the loop: single-shot compose + deterministic pre-flight coverage **[POST-LAUNCH]**

**Folds:** The core re-architecture. Removes model-driven control flow on the happy path.

**Acceptance criteria sketch:**
- New `ensureCandidateCoverage(context)` — deterministic check: can the slate fill every active slot under the household's constraints? If yes, no tool runs. If no, run `recipe.search` → (then `recipe.discover` if still short) to acquire, augment the slate, re-check. This is the **only** place tools run.
- `compose(context)` — a single forced-schema call with **no tools** (builds on s2). Returns the tree or throws (no loop, no nudge, no iteration ceiling).
- `planWeek` becomes the linear pipeline `assemble → ensureCandidateCoverage → compose → (guardrail/swap/commit handled by caller as today)`.
- `MAX_PLAN_ITERATIONS`, the stopped-without-compose branch, and the validation-feedback loop are **deleted** (dead since s2/s3).
- The Swap Agent (`swapBlockedItems`) is untouched — it remains the mini-tier surgical retry on guardrail block.
- Eval (s1) passes; tool-call count on the warm-slate fixtures is **0 tools before compose** (compose is the single call).
- Architecture.md AR-2 sub-section added describing the pipeline; project-context invariant added.

**Edge cases to handle:**
- **Cold slate / acquisition still insufficient after search+discover:** `compose` is still called once with the best available slate; the deterministic guardrail + Swap Agent catch any unsafe result; if no safe plan exists, the existing degraded-result / hard-fail path (FR24/FR82) fires — unchanged.
- **Partial-week / day-scope / sovereignty framing** currently injected as context lines must move into `PlannerContext` cleanly (they already are user-message content, not tool-driven).
- **Regen callback** (guardrail retry in plan-generation.job) calls the same pipeline; assert it composes once per retry.

**WALL: point-of-no-return wall.** After s5 the ReAct loop is gone. Requires the s1 eval green on the full fixture set + an explicit post-launch-stability sign-off before merge.

---

### 3.5-s6 — Push rules out of the LLM (deterministic constraints) **[POST-LAUNCH]**

**Folds:** Shrink the model's judgment surface to recipe-fit only.

**Acceptance criteria sketch:**
- No-consecutive-Main becomes a **deterministic post-pass / validator** over `main_assignments` + day ordering (currently prompt-only/best-effort, v2.6.0, no validator). A violation is corrected deterministically or surfaced as a hard error caught by s1, not left to the prompt.
- Portion defaults (`regular`), spice default (`mild` — the safe choice), and texture-by-`age_band` defaults move to code applied post-compose, so the model only overrides when the profile asks.
- Prompt text for these mechanical rules is trimmed; the eval asserts the deterministic post-pass produces identical or better outcomes on the golden set.

**Edge cases to handle:**
- **Allergen-fork variations** (per-child removals/add_ons) must not be flattened by the defaults pass — the model still owns those; defaults only fill unset fields.
- **2-day plans** where every Main necessarily differs — validator must not false-positive (D-3S33-CR3 already noted sequence ambiguity for 2-day plans).

---

### 3.5-s7 — Provider resilience extraction + mini-tier compose eval **[POST-LAUNCH]**

**Folds:** Maintainability (isolate failover) + cost (test a tier drop).

**Acceptance criteria sketch:**
- Circuit-breaker + `x-ratelimit-reset-tokens` 429 retry (orchestrator.ts:306–350, 955–1020) extracted to `providers/resilience.ts` as a decorator around `LLMProvider`, with its own unit tests (incl. the header-format regex: `"54.726s"` and `"1m21.587s"`).
- `complete` / `completeWithMessages` in the orchestrator call through the decorator; behavior identical; failover audit events (`llm.provider.failover` / `llm.provider.recovered`) unchanged (AR-2).
- An eval variant runs `compose` at `mini` tier across the golden set and reports quality delta vs `flagship`. **Ship the tier drop only if quality holds**; otherwise keep flagship and record the finding (NFR-COST-3 headroom note).

**Edge cases to handle:**
- **Recovery probe race** (orchestrator.ts:965–996) must survive the extraction — keep the `currentProviderIndex === 0` guard.
- **Mini-tier on the safety path:** even if compose drops to mini, the deterministic guardrail (NFR-INT-6) remains the authority; the eval must still assert allergen-safety at mini tier before any tier drop ships.

---

## Section 5 — Implementation Handoff

### Sequence

```
[PRE-LAUNCH]
3.5-s1 (golden-set eval harness)                         ← WALL: baseline
  ├─ 3.5-s2 (forced structured output)
  ├─ 3.5-s3 (candidate handle-index)
  └─ 3.5-s4 (context assemble/render extraction)         ← WALL: pre-launch complete
        │  (s2, s3, s4 parallelizable after s1; lower-collision surfaces preferred)
        ▼
─────────────────  Oct 1 launch + stabilization  ─────────────────
        ▼
[POST-LAUNCH]
3.5-s5 (single-shot loop collapse + pre-flight)          ← WALL: point of no return
  ├─ 3.5-s6 (push rules out of the LLM)
  └─ 3.5-s7 (provider resilience extraction + mini eval)
```

- **3.5-s1 first.** Baseline wall; every downstream slice is gated by it.
- **3.5-s2 / s3 / s4 parallelizable** after s1 (capacity permitting). Prefer landing them when Epic 3's planner files are quiescent to avoid `orchestrator.ts` / `planner.prompt.ts` collisions; s2 (providers + plan.tools) and s3 (plan.tools + render) are lower-collision than s4 (orchestrator).
- **3.5-s5 / s6 / s7** start only after the launch is stable. s5 is the convergence point; s6/s7 touch distinct surfaces and can follow in either order.

### Epic walls

- **Baseline wall (after s1):** golden set green + ratified as parity baseline.
- **Pre-launch wall (after s4):** reliability/cost subset complete and parity-verified; hold s5–s7 until post-launch.
- **Point-of-no-return wall (after s5):** ReAct loop removed; requires full-fixture eval green + post-launch-stability sign-off.

### Pre-flight before approval

1. **Confirm fixture cohorts for s1** — the ≥8 households must cover the allergen-fork, cultural-intersection, partial-week, and cold-slate cases (drafted in s1 ACs; confirm none are missing).
2. **Architecture note (AR-2)** — add the "forced structured output / single-shot compose" note now; the full pipeline sub-section lands with s5.
3. **Confirm the forced-schema capability** of the current OpenAI model tier (`flagship` → resolved model) supports strict `json_schema` for the `PlanComposeTreeInputSchema` shape; if a nested-union limitation exists, s2's per-provider fallback covers it.
4. **Coordinate the shared-file window** with any in-flight Epic 3 planner slice (3-s41 is in `review`; check for `orchestrator.ts` / `planner.prompt.ts` churn before scheduling s4).

### Acceptance criteria — epic-level

Epic 3.5 is **done** when:

1. The golden-set eval harness gates planner changes in CI (s1).
2. `plan.compose` output is schema-forced at decode; the self-correction loop + `planner.bad_output` runbook are retired on the primary path (s2).
3. Recipe references are resolved from a deterministic handle-index; `findIdByName` is fallback-only (s3).
4. Context assembly/rendering is a pure, snapshot-tested module outside `orchestrator.ts` (s4).
5. *(post-launch)* `planWeek` is a linear `assemble → ensure-coverage → compose → guardrail → swap → commit` pipeline; the ReAct loop is removed (s5).
6. *(post-launch)* Mechanical constraints (no-consecutive-Main, portion/spice/texture defaults) are deterministic (s6).
7. *(post-launch)* Provider resilience is an isolated, tested decorator; a flagship-vs-mini compose eval has been run and the tier decision recorded (s7).
8. No FR/UX regression; the deterministic allergy guardrail remains the sole render-eligibility authority throughout (FR76/FR77, NFR-INT-6).

### What this brief explicitly does NOT cover

- **The Swap Agent re-architecture.** `swapBlockedItems` is left as-is (mini-tier surgical retry); only its surrounding orchestrator plumbing moves.
- **Conversational / voice Lumi orchestration (Epic 12).** The single-shot pattern is offered as a reference, not migrated here.
- **The deterministic guardrail itself (AR-3 / story 3-39).** Unchanged; it is the dependency that makes this epic safe.
- **Any FR/PRD/UX change.** This is an internal re-architecture; no user-visible behavior changes.
- **New LLM providers or a model migration.** Tier semantics are unchanged except the s7 mini-tier *evaluation* (ship only if quality holds).

---

## Approval

- [ ] **PM (Menon):** approve brief shape, the s1–s4 / s5–s7 launch split, and Epic 3.5 numbering
- [ ] **Architecture review:** forced-structured-output + single-shot pipeline reviewed against AR-2; guardrail authority (AR-3/NFR-INT-6) confirmed untouched
- [ ] **Sprint plan update:** Epic 3.5 added to `sprint-status.yaml` with 7 slices (s1–s4 pre-launch, s5–s7 post-launch) + retrospective key

Upon approval, this brief is the input to `bmad-sprint-planning` (or `bmad-create-story` for 3.5-s1) for Epic 3.5 generation.

---

## Appendix — References

- `apps/api/src/agents/orchestrator.ts` — `DomainOrchestrator.planWeek` (agentic loop), context renderers (lines 1256–1486), provider failover/circuit-breaker
- `apps/api/src/agents/tools/plan.tools.ts` — `createPlanComposeSpec`, `findIdByName` name→UUID resolution
- `apps/api/src/agents/prompts/planner.prompt.ts` — `PLANNER_PROMPT` v2.8.0, toolsAllowed, manual version changelog
- `apps/api/src/agents/tools.manifest.ts` — `TOOL_MANIFEST` (stub→real wiring), AR-4 latency manifest
- `apps/api/src/agents/providers/{openai,anthropic}.adapter.ts` — `LLMProvider` adapters (AR-2)
- `apps/api/src/jobs/plan-generation.job.ts` — context pre-load + commit + guardrail-retry callback
- `_bmad-output/implementation-artifacts/planner-prompt-rollback.md` — the §10.7 rollback runbook this epic retires
- `_bmad-output/planning-artifacts/epic-2.6-brief.md` — format precedent
- `_bmad-output/planning-artifacts/sprint-change-proposal-2026-05-19.md` — original precedent
- Architecture requirements: AR-2 (LLMProvider/failover), AR-3 (Allergy Guardrail boundary), AR-4 (tool-latency manifest), AR-5 (audit)
- NFRs served: NFR-COST-3 (≤$0.25/plan), NFR-PERF-1 (plan-gen p95), NFR-SCAL-2 (5,000 HH Oct 1), NFR-SCAL-5 (36h weekend batch), NFR-REL-5 (15-min LLM failover), NFR-INT-6 (allergen decisions never LLM-alone)
- Memory: `data-model-redesign-before-beta`, `recipe-agent-lazy-catalog`, `guardrail-two-tier-allergen-doctrine`, `kitchen-map-cache-trigger-gap`
</content>
</invoke>
