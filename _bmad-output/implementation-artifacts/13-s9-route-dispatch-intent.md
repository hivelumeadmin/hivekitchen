# Story 13.s9: routeIntent() + dispatchIntent() — conversational plan-edit routing + execution wiring

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **⏯️ MID-FLIGHT STORY.** The DECISION layer (Tasks 1–2) already shipped on branch `feat/catalog-repo-pick` / PR #52 (commits `35cd67c`, `400b9f8`; 21 passing tests) and is pre-checked below. This story file scopes the REMAINING work: T0 execution wiring, slot-id resolution, the HTTP edit endpoint, routing-spec §9 #3 resolution, trace tags, and the routing golden eval. Do NOT rewrite Tasks 1–2 code — build on it.

## Story

As a parent editing my week by talking to Lumi,
I want my free-text plan edits ("swap Tuesday's main", "less spicy for Maya", "no fish this week") classified by a cheap-tier model and executed deterministically against the existing plan tree,
so that conversational editing works end-to-end without firing the expensive agentic path (`plan.compose` / RecipeAgent / Tavily) more than once per week.

## Acceptance Criteria

1. **Classifier (SHIPPED — verify only):** `routePlanIntent(utterance, ctx, provider)` classifies one utterance via a single `'mini'`-tier forced-tool call through the `LLMProvider` seam with `strictAllTools` semantics; nulls stripped before Zod (`bea6d4b` rule); parse/tool failure returns `{intent:'fallback', confidence:0}` — never throws.
2. **Decision layer (SHIPPED — verify only):** `dispatchPlanIntent(intent, ctx, deps)` deterministically maps all 12 intents to a typed `DispatchResult` (T0 `swap|swap_snack|vary|safety_write|commit|noop|read`, T1 `reply`, T2 `escalate`); catalog MISS on swap/exclude escalates with `reason:'catalog_miss'`; T2 never fires without going through the escalate action (confirm gate is the caller's job — escalation never silently spends).
3. **§9 #3 resolved:** a placed snack in `plan_slots` is stored as `snack_sku_id` (with `recipe_id` null), satisfying the schema XOR (`slot_kind='snack'` requires exactly one of `recipe_id`/`snack_sku_id`). The snack-swap execution path writes `snack_sku_id` and nulls `recipe_id`. Decision recorded in Dev Notes and in the routing spec's §9 (append resolution note).
4. **Slot-id resolution:** a pure helper resolves a `SlotTarget` (`{day?, slotKind?, childId?}`) + loaded plan tree → the concrete row to mutate: `main_assignment_id` for main swaps, `plan_slot_id` for snack/extra swaps, `variation_id` (per child) for VARY_SLOT. Ambiguous/unresolvable targets (no day, day paused, no matching slot, childId required but missing) return a typed miss — never a throw, never a guess.
5. **T0 execution:** each T0 `DispatchResult` action executes through EXISTING services — `PlansService.swapMain` (main), `PlansService.swapSlotRecipe` (extra), new snack-SKU swap path (snack, per AC3), `PlansService.updateVariation` (vary), `HouseholdAllergensRepository.declareIfNew` (safety_write), `PlansService.commit` (commit). Guardrail re-evaluation happens inside those services (do not re-implement). No new mutation SQL outside the snack-SKU swap.
6. **HTTP endpoint:** `POST /v1/plans/:planId/edit` (Fastify, Zod contracts in `packages/contracts`, `authorize(['primary_parent','secondary_caregiver'])`, required `Idempotency-Key`) accepts `{utterance}` OR a pre-built `{intent}` (chip-tap bypass, zero LLM), runs route→dispatch→execute, and returns `{result, slot?|variation?|main_assignment?}` typed by contract. Escalations return the escalate payload (no T2 firing in this story). After a successful T0 mutation the route emits a `plan.updated` SSE event via `fastify.sseDispatcher.emit(householdId, …)` so 13-s10 can reconcile.
7. **Trace tags:** per turn, `plan_intent.routed {intent, confidence, tier:'T1', model}` (classifier call; omitted entirely on chip bypass) and `plan_intent.dispatch {intent, tier, escalated, model:null on T0}` — written under `PLAN_TRACE_DIR`, no-op when unset (mirror `OnboardingTracer`'s `model:null` zero-LLM convention).
8. **Routing golden eval:** fixed utterance fixtures → expected `{intent, tier}` regression gate, copying the `agents/eval/onboarding-golden.eval.test.ts` harness pattern (skipped without API key, like onboarding's).
9. All new logic unit-tested (pure fns with no mocks; wrappers with stubbed deps); full `apps/api` suite green; typecheck + lint clean.

## Tasks / Subtasks

- [x] Task 1: `routePlanIntent` mini-tier classifier (AC: 1) — SHIPPED commit `35cd67c`
  - [x] `PLAN_INTENT` taxonomy (12 intents), `PlanIntentResult` Zod schema, `PlanContextLite`
  - [x] Forced-tool `'mini'`-tier call via `LLMProvider`; `stripNulls` before Zod; fallback-never-throw
  - [x] 6 unit tests (`route-plan-intent.test.ts`)
- [x] Task 2: `dispatchPlanIntent` decision layer (AC: 2) — SHIPPED commit `400b9f8`
  - [x] Exhaustive switch over taxonomy → typed `DispatchResult` (decides, does NOT write)
  - [x] Catalog hit/miss via `deps.catalog.pickRecipe` (13-s8); snack → `swap_snack` (no catalog call)
  - [x] 15 unit tests (`dispatch-plan-intent.test.ts`)
- [x] Task 3: Resolve §9 #3 + snack-SKU swap execution path (AC: 3)
  - [x] Add `PlansService.swapSlotSnackSku({planId, planSlotId, householdId, requestId, input:{new_snack_sku_id}})`: validates `slot_kind='snack'`, writes `snack_sku_id`, nulls `recipe_id` (schema XOR), refreshes `brief_state`, writes audit — mirror `swapSlotRecipe` (plans.service.ts:966) shape exactly
  - [x] SKU choice is deterministic: `pickReplacementSnackSku()` wraps `assignSnackRotation()` restricted to the target day with the current SKU excluded — no RNG, fail-closed null
  - [x] Append resolution note to `plan-conversational-edit-routing-spec.md` §9 item 3
  - [x] Unit tests: XOR write shape; snack slot currently holding `recipe_id` migrates to `snack_sku_id`; non-snack slot rejected (9 service tests + 5 picker tests)
- [x] Task 4: Slot-target → row-id resolution (AC: 4)
  - [x] Pure fn `resolvePlanEditTarget(mode, target, tree)` → discriminated union in `apps/api/src/modules/plans/plan-edit-target.ts`
  - [x] Rules: main+day → that day's main assignment; snack/extra+day → that day's slot of that kind; vary needs childId + existing variation row (missing → `miss:'variation_not_found'`); paused day → `miss:'day_paused'`; no day on slot-scoped intents → `miss:'day_required'`
  - [x] 11 unit tests, no mocks (pure fn over fixture tree)
- [x] Task 5: Execution service wiring T0 actions (AC: 5)
  - [x] `executePlanEdit(dispatchResult, …)` in `plan-edit.service.ts` mapping: `swap`(main)→`swapMain`, `swap`(extra)→`swapSlotRecipe`, `swap_snack`→`pickReplacementSnackSku`+`swapSlotSnackSku`, `vary`→`variationPatchOf`+`updateVariation`, `safety_write`→`declareIfNew({source:'plan_edit'})`, `read`/`noop`→no mutation, `reply`/`escalate`→pass through. DEVIATION: `commit` → `acknowledged` no-op, NOT `PlansService.commit` (that is the compose-time commit; no user-facing confirm mutation exists — 13-s10 scope). Also: intent schema gained optional `allergen` (safety_write was un-executable without it); dispatch clarifies when allergen missing.
  - [x] `miss` from Task 4 resolution → typed `clarify` result (client renders clarify), NOT an escalation
  - [x] 22 unit tests with stubbed services asserting exact call args per action (incl. PlanEditTurnService + variationPatchOf, +6 turn/wire tests = 28 total in file)
- [x] Task 6: HTTP endpoint `POST /v1/plans/:planId/edit` (AC: 6)
  - [x] Contracts in NEW `packages/contracts/src/plan-intent.ts`: `PLAN_INTENT` + `PlanIntentResultSchema` (moved from agent layer — now a wire shape), `PlanEditParamSchema`, `PlanEditInputSchema` (utterance XOR intent), `PlanEditResultSchema` (discriminated union), `PlanEditResponseSchema`; types re-exported from `packages/types`; `route-plan-intent.ts` re-exports for agent-layer consumers
  - [x] Route in `plans.routes.ts` following the `swapMain` route pattern (preHandler `requireMember`, `requireIdempotencyKey`, Zod params/body/response); orchestration lives in `PlanEditTurnService` (wired in `plans.hook.ts` with `OpenAIAdapter`, `CatalogRepo`, `HouseholdAllergensRepository`, KitchenMap-derived snack context loader; decorated `fastify.planEditService`)
  - [x] Pre-built intent path skips `routePlanIntent` entirely (zero LLM — the chip-tap bypass, spec §5)
  - [x] On applied mutation: `sseDispatcher.emit(householdId, 'message', buildPlanUpdatedPayload(deriveWeekId(weekOf)))` — reuses the 13-s2.5 `plan.updated` event shape
  - [x] 8 route tests: utterance path, chip path, SSE emit on applied, no emit on escalate, 401/403, missing idempotency key, invalid body, NotFound→404
- [x] Task 7: Routing trace tags (AC: 7)
  - [x] `plan-intent-tracer.ts` under `PLAN_TRACE_DIR` mirroring `onboarding-tracer.ts` (no-op-when-unset); tags `plan_intent.routed` (null on chip bypass) / `plan_intent.dispatch` (`model:null` always — deterministic); wired fire-and-forget in the route
  - [x] 4 unit tests: T0 turn records `model:null`; chip bypass records null routed tag; escalation marked; unset env → no-op
- [x] Task 8: Routing golden eval (AC: 8)
  - [x] `agents/eval/plan-routing-golden.eval.test.ts` on the LIVE-eval pattern (`planner-mini-tier.eval.test.ts` precedent, NOT the mocked onboarding harness — the model half can only be gated live): 15 fixtures (one per intent + child-ref + catalog-miss) asserting `{intent, tier}` through route→dispatch with a stubbed catalog, + child-resolution and allergen-slot spot checks; gated by `RUN_LIVE_ROUTING_EVAL` (skips 17 tests in CI)
- [x] Task 9: Full validation (AC: 9)
  - [x] All story test files green: 205 passed + 17 live-gated skipped. Full api suite: 2316 passed, 31 failed — ALL 31 verified pre-existing (identical failures at HEAD via stash baseline). Typecheck: contracts/types clean; api has ONE pre-existing error (events.routes.ts ioredis StreamReader, from commit ac43434/13-s2.5). Lint: all story-touched files clean; 179 pre-existing repo errors at HEAD.

## Dev Notes

### Authoritative sources — read these first
- `_bmad-output/planning-artifacts/plan-conversational-edit-routing-spec.md` — THE spec (§4 taxonomy, §5 routeIntent, §6 dispatchIntent, §8 trace tags, §9 open decisions)
- `_bmad-output/planning-artifacts/epic-13-lumi-ux-rebuild-brief.md` §13-s9 — AC sketch + sequencing (s8 done → s9 → s10)
- Shipped code (Tasks 1–2): `apps/api/src/agents/route-plan-intent.ts`, `apps/api/src/agents/dispatch-plan-intent.ts` (+ tests)
- 13-s8 keystone (done): `apps/api/src/services/catalog-pick.service.ts` (`pickCatalogCandidate`, pure), `catalog-pick.repository.ts` (`CatalogRepo.pickRecipe`, `computeSharedDeclaredUnion`)

### Cost doctrine (the reason this story exists)
Expensive agentic path stays once-per-week. This story wires ONLY T0 execution + the classifier. T2 actions return the escalate payload to the client — the confirm-then-fire UX is 13-s10. A catalog miss must never silently spend (spec §6 chokepoint).

### Architectural boundary (non-negotiable)
`routePlanIntent` = agent layer, stateless, no DB. `dispatchPlanIntent` = pure decision, no DB. Execution (Tasks 3–6) = API layer (`modules/plans`), owns all persistence. Agents never touch the DB (standing doctrine + project-context).

### Key signatures you will call (verified in-repo)
- `PlansService.swapMain({planId, mainAssignmentId, householdId, requestId, input:{new_recipe_id}})` — shared-Main swap, guardrail re-eval inside
- `PlansService.swapSlotRecipe({planId, planSlotId, householdId, requestId, input:{new_recipe_id}})` (plans.service.ts:966) — snack/extra only; REJECTS main
- `PlansService.updateVariation({planId, variationId, householdId, requestId, input: UpdateVariationInput})` (plans.service.ts:1069) — spice/portion/texture/add-ons/removals; guardrail re-eval inside
- `HouseholdAllergensRepository.declareIfNew({household_id, child_id /*null=household-wide*/, allergen, source})` — idempotent, preserves provenance, handles KitchenMap version bump
- `assignSnackRotation({snackOnChildIds, extraRulesByChildId, allSnackSkus, declaredAllergensByChildId, weekOf})` → `SnackSlotAssignment[]` — deterministic polynomial hash, fail-closed
- `fastify.sseDispatcher.emit(householdId, event, data)` (sse-dispatcher.plugin.ts) — Redis pub/sub + Last-Event-ID replay (13-s2.5); sync fire-and-forget
- Tree reads: `PlansRepository.findDaysByPlanId` / `findSlotsByPlanId` / `findSlotsByDayId(s)` (plans.repository.ts:297–335)

### `plan_slots` shape (contracts/src/plan.ts:454–499 — the §9 #3 ground truth)
- `main`: `main_assignment_id` set; `recipe_id`/`extra_kind`/`snack_sku_id` null
- `snack`: EXACTLY ONE of `recipe_id` | `snack_sku_id`; others null (DB CHECK mirrors Zod superRefine)
- `extra`: `recipe_id` + `extra_kind`; others null

### VARY_SLOT is not a swap (spec §4 correction)
No `spice_level` on `recipes`. "Less spicy / smaller portion" = `plan_slot_variations` write via `updateVariation` — no catalog pick, cheaper than a swap. Variations narrow down from a shared safe Main; never widen (family-first doctrine).

### Strict-schema rule (bea6d4b — already honored in Task 1, keep honoring)
Strict mode forces ALL props required; optionals MUST be `anyOf:[T,null]` + null-stripped before Zod (`stripNulls` in `strict-schema-utils.ts`). Violating this broke every `plan.compose` once.

### Scope guards
- NO T2 execution (add_dish/recompose/compose_next fire in s10 after confirm). NO confirm UI. NO client work (s10).
- T1 `reply`/clarify: return a typed clarify payload; do NOT add a `cheapReply` LLM call in this story (nothing downstream consumes it yet — s10 decides the reply UX).
- SSE emit is ONE line via the existing dispatcher; do not build new event plumbing. (The `plans.routes.ts:534` comment saying "SSE plan.updated deferred to Story 5.2" predates 13-s2.5 — the dispatcher now exists; emitting here is what s10's "plan.updated reconcile" depends on.)
- Guardrail: NEVER re-implement safety in this layer. `swapSlotRecipe`/`updateVariation` already re-evaluate; `pickCatalogCandidate` pre-filters by tag-set; `evaluate()` (allergy-rules.engine.ts:218, v1.4.0 declared-only) stays the authority inside the services.
- SAFETY_WRITE post-write week revalidation + auto-fix (spec §6 `revalidateWeek` orphan repair): OUT of this slice — `declareIfNew` + response is enough for s9; note it in Dev Agent Record as deferred.

### §9 decision state
- **#1 RESOLVED (PR #52):** snacks always tag-set-checked against declared allergens, fail-closed, no attested exemption (matches `filterAllergenConflicts`).
- **#2 RESOLVED (PR #52):** variety proxy = `household_recipe_usage` aggregate (`use_count`/`last_used_at`); per-week reader deferred.
- **#3 RESOLVED BY THIS STORY (AC3):** placed snack = `snack_sku_id`; snack swap writes `snack_sku_id`, nulls `recipe_id`. Rationale: `snack_sku_rotation_unfold` is the later migration, `SnackRotationService` already injects `snack_sku_id` slots, and snacks-as-household-SKUs (Option B, 2026-06-20) is standing doctrine. A legacy snack slot holding `recipe_id` migrates to `snack_sku_id` on first swap (the XOR permits either; writes converge on SKU).

### Testing standards
Vitest, `cd apps/api && npm test` (single file: `npm test -- <name>.test.ts`). Pure fns → zero mocks over fixtures (see `dispatch-plan-intent.test.ts`, `catalog-pick.service.test.ts`). Wrappers/routes → stubbed deps, never mock contracts. Colocated `*.test.ts`, Arrange/Act/Assert, no `console.*` (Pino/tracer only).

### Project Structure Notes

- New execution code in `apps/api/src/modules/plans/` (service + resolution helper), route added to existing `plans.routes.ts`, tracer in `apps/api/src/agents/` beside `onboarding-tracer.ts`, eval in `apps/api/src/agents/eval/`, wire schemas in `packages/contracts/src/plan.ts`
- Files kebab-case; Zod schemas `PascalCaseSchema`; imports ordered node → external → `@hivekitchen/*` → relative
- Commits: `feat(planner): … (Epic 13-s9)` — one independently-testable commit per task, matching `35cd67c`/`400b9f8` style

### References

- [Source: _bmad-output/planning-artifacts/plan-conversational-edit-routing-spec.md#5–6, 8, 9]
- [Source: _bmad-output/planning-artifacts/epic-13-lumi-ux-rebuild-brief.md#13-s9]
- [Source: packages/contracts/src/plan.ts#PlanSlotRowSchema (454–499), UpdateVariationInputSchema (858), SwapSlotRecipeInputSchema (878)]
- [Source: apps/api/src/modules/plans/plans.service.ts#swapSlotRecipe (966), updateVariation (1069), swapMain]
- [Source: apps/api/src/plugins/sse-dispatcher.plugin.ts#SseDispatcher.emit]
- [Source: apps/api/src/services/snack-rotation.service.ts#assignSnackRotation (123)]
- [Source: apps/api/src/modules/households/household-allergens.repository.ts#declareIfNew]
- [Source: apps/api/src/agents/onboarding-tracer.ts#model:null convention]
- [Source: _bmad-output/project-context.md#agent-seam, services, testing]

## Dev Agent Record

### Agent Model Used

claude-fable-5 (Tasks 1–2 authored under claude-opus-4-8 on PR #52)

### Debug Log References

### Completion Notes List

- Tasks 1–2 shipped pre-story on PR #52 (commits 35cd67c, 400b9f8): routePlanIntent classifier + dispatchPlanIntent decision layer, 21 tests, typecheck/lint clean. Decision layer emits typed actions; deliberately does not write.
- **§9 #3 RESOLVED (AC3):** placed snack = `snack_sku_id`; `PlansRepository.updateSlotSnackSku` writes `snack_sku_id` + nulls `recipe_id` in one UPDATE (XOR holds; legacy recipe-backed snack slots converge on first swap). Replacement choice = `pickReplacementSnackSku()` (single-day `assignSnackRotation` with current SKU excluded; fail-closed null → escalate as catalog_miss). Resolution note appended to routing spec §9.
- **Schema extension to shipped Task 1/2 code (necessary, minimal):** `PlanIntentResult` gained optional `allergen` — SAFETY_WRITE was un-executable without a value to write; dispatch now clarifies (T1) when allergen is absent (safety data is never guessed). Prompt gained the corresponding slot rule. Existing tests updated + 1 added.
- **Deviation from Task-5 sketch:** `commit` ("confirm the week") maps to an `acknowledged` no-op, NOT `PlansService.commit` — that method is the compose-time guardrail commit, and no user-facing confirmed-status mutation exists in the schema. Wiring a real confirm (with the StickyBar button, currently also unwired per 13-s7 W1) is 13-s10 scope.
- `PLAN_INTENT`/`PlanIntentResultSchema` promoted to `packages/contracts/src/plan-intent.ts` (the chip-tap bypass makes it a wire shape — exactly the promotion condition the original agent-layer comment named); `route-plan-intent.ts` re-exports so agent-layer imports are unchanged.
- Snack re-pick inputs derive entirely from the KitchenMap projection (per-child `bag_composition`/`extra_rules`/`declared_allergens` all live there) + the SKU shelf — no new repository reads (`buildSnackContextLoader`).
- SAFETY_WRITE post-write week revalidation + orphan auto-fix (spec §6 `revalidateWeek`) deferred as planned (Dev Notes scope guard); `declareIfNew` handles the KitchenMap version bump internally.
- New audit event `plan.slot_snack_swapped` + migration `20261033000000` (the enum-parity test enforces TS↔SQL). NOTE (pre-existing, not fixed): that parity test fails at HEAD — ~17 TS audit events (plan.main_swapped, plan.slot_recipe_swapped, …) were never added via migrations.
- Validation: 205 story-file tests green (+17 live-gated eval skips). Full api suite 2316 passed / 31 failed — all 31 verified identical at HEAD (stash baseline), none from this story. Typecheck: contracts/types clean; api has one pre-existing error (events.routes.ts ioredis StreamReader, introduced by commit ac43434 / 13-s2.5). Lint: all story-touched files clean (179 pre-existing errors repo-wide at HEAD).
- Pre-existing issue noticed, NOT fixed (out of scope): `PlansRepository.updateSlotRecipe` does not null `snack_sku_id`, so a recipe swap on a SKU-backed snack slot would violate the slot XOR at the DB. Dispatch never routes that path (snacks always go `swap_snack`), but the legacy PATCH slot-recipe route could hit it.

### File List

- apps/api/src/agents/route-plan-intent.ts (Task 1 — shipped; Task 5/6 — allergen slot + schema moved to contracts, re-exported)
- apps/api/src/agents/route-plan-intent.test.ts (Task 1 — shipped)
- apps/api/src/agents/dispatch-plan-intent.ts (Task 2 — shipped; Task 5 — safety_write carries allergen, clarifies when absent)
- apps/api/src/agents/dispatch-plan-intent.test.ts (Task 2 — shipped; Task 5 — safety_write tests updated/added)
- apps/api/src/agents/strict-schema-utils.ts (Task 1 — shipped)
- apps/api/src/agents/plan-intent-tracer.ts (Task 7 — new)
- apps/api/src/agents/plan-intent-tracer.test.ts (Task 7 — new)
- apps/api/src/agents/eval/plan-routing-golden.eval.test.ts (Task 8 — new)
- apps/api/src/modules/plans/plan-edit-target.ts (Task 4 — new)
- apps/api/src/modules/plans/plan-edit-target.test.ts (Task 4 — new)
- apps/api/src/modules/plans/plan-edit.service.ts (Task 5/6 — new: executePlanEdit, variationPatchOf, toWireResult, buildSnackContextLoader, PlanEditTurnService)
- apps/api/src/modules/plans/plan-edit.service.test.ts (Task 5/6 — new, 28 tests)
- apps/api/src/modules/plans/plans.service.ts (Task 3 — swapSlotSnackSku)
- apps/api/src/modules/plans/plans.service.swap-snack.test.ts (Task 3 — new, 9 tests)
- apps/api/src/modules/plans/plans.repository.ts (Task 3 — updateSlotSnackSku)
- apps/api/src/modules/plans/plans.routes.ts (Task 6 — POST /v1/plans/:planId/edit)
- apps/api/src/modules/plans/plans.routes.test.ts (Task 6 — 8 new route tests + harness mocks)
- apps/api/src/modules/plans/plans.hook.ts (Task 6 — PlanEditTurnService wiring + planEditService decorator)
- apps/api/src/services/snack-rotation.service.ts (Task 3 — pickReplacementSnackSku)
- apps/api/src/services/snack-rotation.service.test.ts (Task 3 — 5 new tests)
- apps/api/src/audit/audit.types.ts (Task 3 — plan.slot_snack_swapped event)
- apps/api/src/types/fastify.d.ts (Task 6 — planEditService decorator type)
- packages/contracts/src/plan-intent.ts (Task 6 — new: PLAN_INTENT, PlanIntentResultSchema, PlanEdit* wire schemas)
- packages/contracts/src/plan.ts (Task 3 — SwapSlotSnackSkuInput/ResponseSchema)
- packages/contracts/src/index.ts (Task 6 — plan-intent export)
- packages/types/src/index.ts (Task 3/6 — new schema imports + inferred types)
- supabase/migrations/20261033000000_add_plan_slot_snack_swapped_audit_type.sql (Task 3 — new)
- _bmad-output/planning-artifacts/plan-conversational-edit-routing-spec.md (Task 3 — §9 #3 resolution note)

## Change Log

- 2026-07-02: Story file created mid-flight (Tasks 1–2 already shipped on PR #52); scopes remaining execution/wiring work. Status: ready-for-dev.
- 2026-07-02: Tasks 3–9 implemented (dev-story, claude-fable-5): snack-SKU swap path (§9 #3 → snack_sku_id), slot-target resolution, executePlanEdit T0 execution, POST /v1/plans/:planId/edit + contracts + PlanEditTurnService + plan.updated SSE emit, plan-intent tracer (model:null), live-gated routing golden eval (15 fixtures). Intent schema gained `allergen`; `commit` intent acknowledged (no confirm mutation exists — s10). 82 new/updated tests across 9 files. Status: review.

## Review Findings

_Code review 2026-07-02 (bmad-code-review, 3 adversarial layers: Blind Hunter / Edge Case Hunter / Acceptance Auditor). All 9 ACs verified satisfied; the cost invariants (no T2 firing, catalog miss never silently spends, agents never touch DB, SSE only on applied) hold. No Critical/High defects newly introduced. Findings below._

- [x] [Review][Defer] SSE `plan.updated` emitted for `safety_write` (plan tree unchanged) and on no-op re-declaration [plans.routes.ts:681] — deferred to 13-s10 (decision 2026-07-02). Emit left as-is; it's AC6-compliant and an allergen write affects KitchenMap/guardrail, so a reconcile nudge is defensible — s10 defines the reconcile contract and decides emit/suppress-on-noop then.
- [x] [Review][Patch] FIXED — `safety_write` chip-bypass wrote client-supplied `childId` with no household-ownership check [apps/api/src/modules/plans/plan-edit.service.ts] — verified `declareIfNew` does NOT scope `child_id` to the household. Added a guard in `PlanEditTurnService.run`: a `safety_write` with a `childId` not in the household's KitchenMap roster returns `clarify:'unknown_child'` instead of writing a mis-scoped row. Soft-degrades on KitchenMap read failure (matches the utterance-path doctrine). +3 tests (foreign→clarify/no-write, known→applied, failed-roster→soft-allow). Typecheck clean; 31/31 file tests green.
- [x] [Review][Defer] `safety_write` does not revalidate/re-screen the current week [apps/api/src/modules/plans/plan-edit.service.ts:256] — deferred, documented (spec §6 `revalidateWeek` + orphan repair explicitly scoped OUT in Dev Notes). Newly-declared mid-week allergen is stored but the placed plan is not re-evaluated. **Highest-impact deferred safety item — must land in 13-s10.**
- [x] [Review][Defer] Snack-swap guardrail gated on `variations.length > 0` — tagged SKU on a variation-less snack slot skips the service guardrail [apps/api/src/modules/plans/plans.service.ts:1112] — deferred, pre-existing pattern. `swapSlotRecipe` (the method 13-s9 was told to mirror exactly) has the identical `guardrailItems.length > 0` gate (plans.service.ts:1008); routed path is protected by `pickReplacementSnackSku`'s per-child fail-closed pre-filter. If a real hole (do sharing children always have variation rows?), it exists in `swapSlotRecipe` too — investigate separately, out of s9 scope. Copied doc-comment slightly overstates coverage.
- [x] [Review][Defer] Idempotency-Key format-validated but never deduplicated — retries apply divergent mutations [apps/api/src/modules/plans/plans.routes.ts:671] — deferred, pre-existing. All sibling mutation routes (`swapMain` etc.) behave identically; no replay cache exists anywhere in the codebase. Repo-wide concern, not s9-specific.
- [x] [Review][Defer] `exclude_filter` `scope` field never consumed — "no fish this week" with no day → clarify, week-wide exclusion unfulfillable [apps/api/src/agents/dispatch-plan-intent.ts:118] — deferred. Matches spec §6 (single `pick()` dispatch); `scope` is a forward-looking captured field. Product-behavior gap for a later slice.

_Dismissed as noise (5): stale-pick window on two shelf reads (fail-closed re-validate at write is correct); `stepIn` boundary on null current (−1 fallback yields the correct one-step for the natural `regular` middle-default); `plan_intent.routed` hardcoded `tier:'T1'` (matches spec §8 — routed tag = classifier-tier cost, not dispatch tier); `routed` written `null` vs "omitted" on chip bypass (semantically equivalent, tested); `PlanIntentResult` const re-export shim (intentional wire-shape promotion)._
