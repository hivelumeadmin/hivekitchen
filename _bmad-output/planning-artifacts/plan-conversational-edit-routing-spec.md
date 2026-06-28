# Spec — Plan Conversational-Edit Intent Routing + `CatalogRepo.pick()`

**Date:** 2026-06-26
**Author:** Drafted by Claude (engineering) at Menon's request
**Status:** DRAFT — pre-epic spec. Not yet sliced.
**Scope:** The conversational-editing layer for the weekly planner — "talk to your plan" — and the deterministic catalog selector it depends on.
**Companion doc:** [`lumi-conversational-ux-rebuild-vision.md`](./lumi-conversational-ux-rebuild-vision.md) — the UX *what / why* (valet model, onboarding, planner). This spec is the *how* for that vision's planner conversational-editing (§4). Read them together.

> **✅ RECONCILED 2026-06-28 against the shipped Epic 2.7 (MVP wall reached 2026-06-27).**
> The planner conversational-edit layer is the **same control-inversion pattern** Epic 2.7 shipped for onboarding: a deterministic controller owns flow, the LLM is a stateless turn function that only classifies and fills slots. The real contracts now exist and this doc points at them: `OnboardingController.nextMoment()` (pure FSM over `MOMENT_SLOT_PREDICATES`), `OnboardingTurnRunner.run()` (the stateless turn fn), the `LLMProvider` seam with named tiers `'flagship'`/`'mini'`, `stripNulls` + `toStrictJsonSchemaParameters`/`makeNullable` for strict schemas, `OnboardingTracer`/`ONBOARDING_TRACE_DIR`, and `onboarding-chips.ts`'s zero-call `applyPureChipTurn`. Signatures below are aligned to those.

---

## 0. Why this exists (the cost premise)

The planner presents a **ready answer** (the Brief) to keep per-week LLM cost low. Conversational editing must not undo that. The governing rule:

> The expensive agentic path (`plan.compose` / RecipeAgent / Tavily) stays a **once-per-week batch**. Conversation operates *on top* of the existing plan tree via a cheap-tier intent classifier + **deterministic** catalog/variation ops. The expensive path fires again only for a genuine catalog miss (net-new dish) or an explicit whole-week recompose — exactly as it does today.

Under that rule, engagement ("change anything by talking") goes up while the expensive path fires the same number of times per week.

---

## 1. Architecture — control inversion (mirrors shipped Epic 2.7)

| Planner (this doc) | Onboarding — actual shipped contract | Role |
|---|---|---|
| `routeIntent()` | `OnboardingTurnRunner.run()` — the stateless turn fn (`onboarding-turn-runner.ts`) | Stateless LLM classifier. **Agent layer, no DB.** One `'mini'`-tier call. |
| `dispatchIntent()` | `OnboardingController.nextMoment()` over `MOMENT_SLOT_PREDICATES` (`onboarding.controller.ts`, pure fn) | Deterministic executor. **API layer, owns data + persistence.** |
| chip tap → pre-built intent | `OnboardingTurnRunner.applyPureChipTurn()` + code-filled ack templates (`onboarding-chips.ts`) | Structured affordance bypasses the LLM entirely (zero calls). |
| strict tool schema for the classifier | `provider.completeWithMessages(..., { strictAllTools:true })` + `stripNulls` before Zod (`openai.adapter.ts`, `onboarding.agent.ts`) | `anyOf:[T,null]` + null-strip before Zod. |
| `'mini'`-tier classifier call | `LLMProvider` tiers `TEXT_MODEL_TIER='flagship'` / `CLASSIFIER_TIER='mini'` (`onboarding.agent.ts`) | Routes through `LLMProvider`, not raw `OpenAI`. *(Onboarding ships with a bare `OpenAIAdapter`, not `ResilientProvider` — only the planner orchestrator wraps Resilient.)* |
| routing trace | `OnboardingTracer` / `ONBOARDING_TRACE_DIR` (`onboarding-tracer.ts`, `env.ts`) | Per-turn trace, off by default. |
| routing golden eval | onboarding golden eval (`agents/eval/onboarding-golden.eval.test.ts`) | Regression gate: utterance → expected intent + tier. |

The architectural boundary is load-bearing: **`routeIntent()` classifies (agent, stateless), `dispatchIntent()` executes (API, owns catalog/tree/guardrail).** This is the only split that lets the deterministic ops touch data without the agent reaching the DB — per the standing doctrine that agents never read/write the DB directly.

---

## 2. The three tiers

| Tier | Engine | Per-call cost | Fires when |
|---|---|---|---|
| **T0 — Deterministic** | No LLM. Catalog ops, tree mutations, variation writes, stored-data render, allergen writes | $0 | Chip taps; swaps satisfiable from cached catalog; spice/portion/texture changes; inspection; safety writes; confirmations |
| **T1 — Cheap tier** | `'mini'` tier via `LLMProvider` seam (`CLASSIFIER_TIER`, same as onboarding's `extractSummary`/`inferCulturalPriors`) | ~cents | Parsing free text → structured intent + slots; short clarifying replies |
| **T2 — Expensive agentic** | RecipeAgent + Tavily + `plan.compose` / swap agent | ~dollars | Net-new dish not in catalog (after explicit confirm); explicit full (re)compose |

**Guardrail validation runs deterministically on every mutation** — it is never an LLM cost and is never skipped.

---

## 3. Routing flow

```
utterance
  ├─ chip tap ─────────────────────────────► T0 (no classifier, free)
  └─ free text ─► T1 routeIntent() (1 cheap call, strict schema)
                    └─ emits {intent, slots} ─► dispatchIntent():
                          ├─ resolvable on cached tree/catalog ─► T0 execute
                          ├─ needs small NL reply ─────────────► T1 reply
                          └─ catalog MISS or full recompose ───► T2 (after confirm)
```

---

## 4. Intent taxonomy (corrected against real schema)

```ts
// packages/contracts/src/plan-intent.ts
export const PLAN_INTENT = {
  // T0 — deterministic, no LLM downstream
  INSPECT:        'inspect',          // "show me Tuesday"
  EXPLAIN:        'explain',          // "why this main?" -> render persisted rationale
  COMMIT:         'commit',           // "confirm the week"
  AFFIRM:         'affirm',           // "looks great" (ack)
  SWAP_SLOT:      'swap_slot',        // "swap Tuesday's main" -> CatalogRepo.pick()
  EXCLUDE_FILTER: 'exclude_filter',   // "no fish this week", "quicker mornings" -> pick() with constraint
  VARY_SLOT:      'vary_slot',        // "less spicy", "smaller portion" -> plan_slot_variations write
  SAFETY_WRITE:   'safety_write',     // "add a peanut allergy" -> household_allergens write

  // T2 — expensive agentic path
  ADD_DISH:       'add_dish',         // net-new dish not in catalog
  RECOMPOSE:      'recompose',        // "redo the whole week"
  COMPOSE_NEXT:   'compose_next',     // "draft next week"

  // T1 — cheap reply only
  FALLBACK:       'fallback',
} as const;
```

### Correction from the first draft — `"less spicy"` is NOT a swap

There is **no `spice_level` column on `recipes`.** Spice is a per-child variation: `plan_slot_variations.spice_level` (migration `20261010000000`). So "less spicy / smaller portion / softer texture" is a **`VARY_SLOT`** — a deterministic write to the existing slot's variation row, *cheaper than a catalog pick* (no selection at all). This splits the old `CONSTRAIN` intent into two:

- **`EXCLUDE_FILTER`** — a constraint the catalog can filter on (`exclude:fish`, `time:down`) → re-select via `pick()`.
- **`VARY_SLOT`** — a per-child adjustment with no dish change (spice/portion/texture/cut/add-on) → variation write, no `pick()`.

This matches the family-first doctrine: a Variation narrows *down* from the shared Main; it never changes the dish.

---

## 5. `routeIntent()` — agent layer, stateless, one cheap call

Call shape mirrors onboarding's shipped classifier calls (`extractSummary`/`inferCulturalPriors` use `provider.complete(..., { tier: CLASSIFIER_TIER })`; the tool-loop turn uses `completeWithMessages(..., { strictAllTools: true })`). `routeIntent()` is a single forced-tool classification → use `completeWithMessages` with one strict tool at `tier: 'mini'`.

```ts
// apps/api/src/agents/routePlanIntent.ts
import { PlanIntentResult, PLAN_INTENT_TOOL_SCHEMA } from '@hivekitchen/contracts';
import { stripNulls } from './onboarding.agent.js';  // real helper shipped in 2.7-s2 (null -> dropped before Zod)
import type { LLMProvider } from './providers/llm-provider.interface.js';

const CLASSIFIER_TIER = 'mini' as const;             // same tier as onboarding extractSummary/inferCulturalPriors

/** Pure turn fn. No DB. Classifies one utterance against light plan context. */
export async function routePlanIntent(
  utterance: string,
  ctx: PlanContextLite,   // { weekId, days:[{day, mainTitle, childNames}], childIndex }
  provider: LLMProvider,  // Epic 3.5 / 2.7 seam — NOT raw OpenAI
): Promise<PlanIntentResult> {
  const messages = [
    { role: 'system', content: PLAN_ROUTER_SYSTEM + renderContext(ctx) }, // "Maya" -> childId resolves HERE
    { role: 'user', content: utterance },
  ];
  const res = await provider.completeWithMessages(messages, [PLAN_ROUTE_TOOL], {
    tier: CLASSIFIER_TIER,
    strictAllTools: true,   // anyOf:[T,null] via makeNullable; emitted with strict:true
  });
  const args = JSON.parse(res.toolCalls[0].arguments);
  return PlanIntentResult.parse(stripNulls(args));   // stripNulls BEFORE Zod (the bea6d4b rule)
}
```

### Structured output contract (strict mode — the `bea6d4b` rule)

Every property is in `required`; optionals are `anyOf:[T, null]` and **null-stripped before Zod**, or the classifier emits invalid values exactly as it broke every `plan.compose` pre-`bea6d4b`. Reuse `toStrictJsonSchemaParameters` / `makeNullable` from `apps/api/src/agents/providers/openai.adapter.ts:97-178`.

```ts
export const PlanIntentResult = z.object({
  intent:     z.enum(Object.values(PLAN_INTENT) as [string, ...string[]]),
  confidence: z.number().min(0).max(1),
  slots: z.object({
    day:        Weekday.nullable(),       // mon..fri
    slotKind:   SlotKind.nullable(),      // main | snack | extra
    childId:    z.string().nullable(),    // "Maya's bored" -> resolved child
    constraint: z.string().nullable(),    // normalized: "exclude:fish" | "time:down"
    variation:  z.string().nullable(),    // normalized: "spice:down" | "portion:down" | "texture:soft"
    dishQuery:  z.string().nullable(),    // for ADD_DISH
    scope:      z.enum(['slot','day','week']).nullable(),
  }),
});
```

Chip taps **skip `routeIntent()` entirely** — the client POSTs a pre-built `PlanIntentResult` (`confidence: 1.0`). That is the free path (mirrors 2.7-s5/4b).

---

## 6. `dispatchIntent()` — API layer controller, tiers the work

```ts
// apps/api/src/services/dispatchPlanIntent.ts
export async function dispatchPlanIntent(
  r: PlanIntentResult,
  hh: HouseholdCtx,
  deps: { catalog: CatalogRepo; tree: PlanTreeRepo; guardrail: Guardrail; agents: AgentOrchestrator },
): Promise<DispatchResult> {  // { delta, tier, escalated, reply? }

  switch (r.intent) {
    // ---- T0: deterministic ----
    case 'inspect':
    case 'explain':       return render(deps.tree, r);          // persisted rationale/slot data
    case 'affirm':        return noop();
    case 'commit':        return deps.tree.commitWeek(hh.weekId);

    case 'vary_slot': {                                          // spice/portion/texture — NO pick()
      const delta = deps.tree.writeVariation(r, hh);            // plan_slot_variations
      deps.guardrail.assert(delta);                            // variations never widen safety
      return ok(delta, { tier: 'T0' });
    }

    case 'swap_slot':
    case 'exclude_filter': {
      const cand = deps.catalog.pick({                          // cached only, allergen pre-filtered
        slot: r.slots.slotKind ?? 'main',
        day:  r.slots.day,
        constraint: r.slots.constraint,
        household: hh.safety,                                    // from KitchenMap projection
        exclude: hh.weekExclude,
      });
      if (!cand) return escalateToAddDish(r, deps);             // catalog MISS -> T2 (after confirm)
      const delta = deps.tree.applySwap(r, cand);
      deps.guardrail.assert(delta);                             // deterministic, fail-closed
      return ok(delta, { tier: 'T0' });
    }

    case 'safety_write': {
      const delta = deps.tree.writeAllergen(r, hh);             // household_allergens (deterministic)
      const orphans = deps.guardrail.revalidateWeek(hh.weekId); // deterministic
      const fixes = orphans.map(o => deps.catalog.pick(safePick(o, hh)));
      if (fixes.some(f => !f)) return escalateToAddDish(r, deps); // unfixable from cache -> T2
      return ok(deps.tree.applyFixes(orphans, fixes), { tier: 'T0' });
    }

    // ---- T1: cheap reply ----
    case 'fallback':      return reply(await deps.agents.cheapReply(r));

    // ---- T2: expensive agentic (only paid generation) ----
    case 'add_dish':      return ok(await deps.agents.fetchAndPlaceDish(r, hh), { tier: 'T2' });
    case 'recompose':
    case 'compose_next':  return ok(await deps.agents.composeWeek(r, hh),       { tier: 'T2' });
  }
}
```

### The escalation chokepoint = your cost ceiling

```ts
function escalateToAddDish(r, deps): DispatchResult {
  trace('plan_intent.escalate', { from: r.intent, reason: 'catalog_miss' });
  // RECOMMENDED: return a confirm prompt — "I don't have one cached; want me to find
  // something new?" -> user taps -> THEN T2 fires. A catalog miss never silently spends.
}
```

With the confirm gate, the expensive path per week = **1 baseline compose (T2) + only explicitly-confirmed net-new-dish / redo requests.** Everything else is T0 + occasional T1 cents.

---

## 7. `CatalogRepo.pick()` — the deterministic selector (corrected to real schema)

**Verdict from schema check (2026-06-26): buildable. The snack half largely already exists.**

### 7.1 Governing rules

1. **Pre-filter, not authority.** `pick()` returns only candidates the guardrail will also accept, using a cheap tag-set membership filter. `guardrail.assert()` remains the authoritative safety gate after placement. `pick()` is never the sole safety gate.
2. **No RNG.** `Math.random` / `Date.now` are banned in this stack. Determinism is proven achievable — `assignSnackRotation()` already does a polynomial-hash deterministic pick seeded by `sortedChildIds | weekOf | dayIdx`.
3. **A Main is shared across the family.** It must clear the **union** of every child's declared allergens, not just the requesting child (family-first doctrine). Variations narrow down from a safe Main; they never widen it.

### 7.2 Two slot branches

| Slot | Source | Selector |
|---|---|---|
| **snack** | `snack_skus` (household-scoped) | **Extend the existing `assignSnackRotation()`** in `apps/api/src/services/snack-rotation.service.ts` — already deterministic, fail-closed (empty pool → `[]`), allergen pre-filtered, with category bans/pins + no-adjacent-repeat. Do **not** reinvent. |
| **main / extra** | cached `recipes` | New selector over `RecipesRepository.findCandidateSlateForHousehold()` (`recipes.repository.ts:838`) — the slate already returns `allergen_flags`, `applicable_slots`, `use_count`, `is_household_favorite`, `confidence_score`. |

### 7.3 Real field names (corrections to the first draft)

| First-draft assumption | Reality | Source |
|---|---|---|
| `recipes.title` | `recipes.canonical_name` (no `title`) | `20260820000200_create_recipes_and_usage.sql` |
| `recipes.total_minutes` | `prep_time_minutes` + `finish_time_minutes`; **total = computed in app** | `20261005000000_recipe_canonical.sql` |
| `recipes.allergen_tags` | `recipes.allergen_flags` text[] (GIN-indexed) | base migration |
| `recipes.spice_level` | **does not exist** → `plan_slot_variations.spice_level` | `20261010000000` |
| `snack_skus.allergen_tags` (assumed) | correct — `allergen_tags` text[], CHECK-pinned to FALCPA-9; title is `name` | `20261031000000_snack_sku_allergen_dietary_tags.sql` |
| `snack_skus.provenance` / `parent_attested` | **no such column.** Attestation is implicit via `created_by_household_id` | `20260730000000` + see open decision Q1 |
| declared allergens from `households.declared_allergens` JSONB / `child_allergens` | **both dropped.** Single `household_allergens` table; resolved arrays surface via the **KitchenMap projection** | `20261008000000_household_allergens_consolidation.sql` |

### 7.4 Algorithm (main/extra branch)

```ts
pick(req): Candidate | null {
  if (req.slot === 'snack')
    return assignSnackRotation(...).forDay(req.day);   // reuse existing deterministic selector

  // 1. SOURCE — the per-household slate (carries allergen_flags + ranking signals)
  const slate = recipesRepo.findCandidateSlateForHousehold(req.household.id);

  // 2. SAFETY pre-filter — tag-set membership on allergen_flags (cheap, GIN-backed).
  //    declaredUnion = household ∪ EVERY child, from the KitchenMap projection.
  const safe = slate.filter(r => !r.allergen_flags.some(t => req.declaredUnion.has(t)));

  // 3. CONSTRAINT filter (EXCLUDE_FILTER only — spice is a VARY_SLOT, not here)
  const ok = safe.filter(r => satisfies(r, req.constraint));   // exclude:X, time:down (soft)

  // 4. DEDUP — no repeat within the week
  const fresh = ok.filter(r => !req.exclude.weekDishIds.has(r.id));
  if (fresh.length === 0) return null;                          // MISS -> escalate to T2

  // 5. RANK deterministically; stable tiebreak, no RNG
  return fresh
    .sort((a, b) =>
      score(b, req) - score(a, req)                             // fit: constraint, favorite, time headroom
      || recencyOf(a) - recencyOf(b)                            // older (last_used_at) first = variety
      || a.id.localeCompare(b.id))                              // stable
    [0];
}
```

### 7.5 The shared allergen predicate (reality: two predicates)

The schema check found **two** existing safety predicates, not one:

- **Recipe authority:** `evaluate()` in `apps/api/src/modules/allergy-guardrail/allergy-rules.engine.ts:218` — ingredient-string based, **declared-only blocks** (`rule_type === 'parent_declared'`), `GUARDRAIL_VERSION = '1.4.0'`. The FALCPA-9 floor is **not** an independent block list (only baseline-presence sanity + synonym vocabulary).
- **Snack pre-filter:** `filterAllergenConflicts()` in `snack-rotation.service.ts:75` — tag-set membership on `allergen_tags`.

`pick()` uses **tag-set membership** (`allergen_flags` for recipes, `allergen_tags` for snacks) as its cheap pre-filter for both branches; the ingredient-string `evaluate()` engine stays the authoritative gate at placement/commit. **Do not reimplement safety in `pick()`** — derive the declared-allergen set from the same KitchenMap projection the guardrail consumes, so the pre-filter and the authority cannot drift.

### 7.6 Ranking signals (soft only; hard constraints already filtered)

| Signal | Source |
|---|---|
| Constraint fit / time headroom (Finish ≤15, Total ≤40 — **soft**, rank-down not filter-out) | `prep_time_minutes + finish_time_minutes` |
| Household favorite / confidence | `household_recipe_usage.is_household_favorite`, `confidence_score` (in slate) |
| Variety / recency (older = better) | `household_recipe_usage.last_used_at` (see open decision Q2) |
| 3-Main weekly pattern fit (Mon/Tue cluster, Fri-flex) | `req.day` |

---

## 8. Cost instrumentation

One trace tag per turn (reuse the `PLAN_TRACE_DIR` / `plan-tracer.ts` facility; the shipped 2.7 analog is `OnboardingTracer` / `ONBOARDING_TRACE_DIR` in `onboarding-tracer.ts`, which records `model: null` on a zero-LLM chip turn — do the same here so T0 turns are visibly free):

```
plan_intent.routed   { intent, confidence, tier: 'T1' }     // the classifier call
plan_intent.dispatch { intent, tier: 'T0'|'T2', escalated } // the execution
```

Per-week LLM cost rolls up as:
`1 compose (T2) + Σ classifier calls (T1) + Σ confirmed escalations (T2)`.
Chip-driven turns and T0 swaps/variations **do not appear** — they cost nothing.

---

## 9. Open decisions (block a clean build)

1. **Snack parent-attested exemption.** No `provenance` column on `snack_skus`; attestation is implicit via `created_by_household_id`, and the engine notes suggest the Phase-1 `attested` exemption may have been retired — yet `allergy-guardrail.service.ts` still has `if (u.attested) continue;`. **Decision needed:** is current doctrine "snack SKUs always checked by tag-set on declared allergens, full stop" (recommended — simpler, fail-closed), or is there still an attested-exempt path? This gates `pick()`'s snack-safety branch. *(Stale memory caveat: `snacks-as-household-skus` says "Phase-1 parent-attested → exempt"; schema contradicts a clean exemption — verify before trusting.)*

2. **Recency source.** No first-class cross-week served-history reader exists. Per-week history is reconstructable from `plans → plan_days → plan_slots` but unexposed. **Decision:** v1 uses `household_recipe_usage.last_used_at` (aggregate, exists, cheap); defer a per-week reader. Variety is coarser but deterministic.

3. **`plan_slots` snack storage is in flux.** There is both a `snack_sku_fold` migration (snack as `recipe_id`) and a later `snack_sku_rotation_unfold`. Whether a placed snack is a `recipe_id` or a `snack_sku_id` determines the delta shape `applySwap` writes. **Nail down before wiring.**

---

## 10. Integration points to verify (file-grounded)

| Precondition | Where | Status |
|---|---|---|
| Allergen data is a queryable `text[]` column (not JSONB/computed) | `recipes.allergen_flags`, `snack_skus.allergen_tags` | ✅ confirmed (GIN / CHECK) |
| Per-household slate read with ranking signals exists | `RecipesRepository.findCandidateSlateForHousehold` (`:838`) | ✅ exists |
| Deterministic, fail-closed snack selector exists | `assignSnackRotation()` (`snack-rotation.service.ts:123`) | ✅ exists — extend, don't rebuild |
| Standalone allergen authority (callable outside compose) | `evaluate()` (`allergy-rules.engine.ts:218`) | ✅ standalone, pure |
| Declared allergens resolvable as arrays | KitchenMap projection (`household.declared_allergens ∪ child.declared_allergens`) | ✅ exists |
| Plan rationale persisted at compose time (so `EXPLAIN` is T0) | `tree-adapter.ts` / compose output | ⚠️ **verify** — if regenerated on demand, `EXPLAIN` is a needless call |
| `revalidateWeek()` / `writeAllergen()` callable standalone | guardrail service | ⚠️ verify (needed for `SAFETY_WRITE` to stay T0) |
| Cross-week recency reader | `plans/plan_days/plan_slots` | ❌ not exposed — see decision Q2 |

---

## 11. Suggested slice shape (when this becomes an epic)

Mirrors Epic 2.7's "regression gate first, deterministic core, LLM last" ordering — each step now has a shipped reference implementation to copy from:

1. **Routing golden eval** — fixed utterances → expected `{intent, tier}`; the regression gate. *(Copy `agents/eval/onboarding-golden.eval.test.ts` + its fixtures/harness.)*
2. **`CatalogRepo.pick()` main/extra branch** over the existing slate + tag-set pre-filter; snack branch = thin wrapper over `assignSnackRotation()`. Pure T0, no LLM — testable with no model mock. *(The keystone. Determinism reference: `assignSnackRotation`. Pure-fn-controller reference: `OnboardingController`.)*
3. **`routeIntent()`** — `'mini'`-tier classifier via `provider.completeWithMessages(..., {strictAllTools:true})` + `stripNulls`. *(Reference: `OnboardingAgent.respondWithTools` + `extractSummary`.)*
4. **`dispatchIntent()` controller** + the escalation confirm gate + variation/safety writes. *(Reference: `OnboardingController.nextMoment` over `MOMENT_SLOT_PREDICATES`; service derives slots, controller is a pure fn.)*
5. **Chip-tap bypass** (pre-built intents, zero LLM) + routing trace tags. *(Reference: `OnboardingTurnRunner.applyPureChipTurn` + `onboarding-chips.ts` ack templates; `OnboardingTracer` records `model:null`.)*

---

## Appendix — References

- `apps/api/src/modules/recipe/recipes.repository.ts` — `findCandidateSlateForHousehold` (`:838`), `CandidateSlateRow` (`:79`)
- `apps/api/src/modules/recipe/snack-sku.repository.ts` — `SnackSkuRow` (`:4`), `findActiveForHousehold` (`:52`)
- `apps/api/src/services/snack-rotation.service.ts` — `assignSnackRotation` (`:123`), `filterAllergenConflicts` (`:75`), `deterministicIndex` (`:26`)
- `apps/api/src/modules/allergy-guardrail/allergy-rules.engine.ts` — `evaluate` (`:218`), `GUARDRAIL_VERSION='1.4.0'` (`:29`)
- `apps/api/src/modules/allergy-guardrail/allergy-guardrail.service.ts` — service wrapper, attested path (`:137`)
- `apps/api/src/agents/providers/openai.adapter.ts` — strict-schema machinery (`:97-178`)
- Migrations: `20260820000200` (recipes), `20261005000000` (canonical/finish_time), `20261010000000` (plan_slots + `plan_slot_variations.spice_level`), `20261008000000` (household_allergens consolidation), `20260730000000` / `20261031000000` (snack_skus + allergen_tags)
- `_bmad-output/planning-artifacts/epic-2.7-brief.md` — the onboarding control-inversion this doc rhymes with
- **Shipped Epic 2.7 reference implementations (use as templates):**
  - `apps/api/src/modules/onboarding/onboarding.controller.ts` — `OnboardingController.nextMoment()`, `MOMENT_SLOT_PREDICATES`, `OnboardingSlots` (pure-fn controller pattern for `dispatchIntent`)
  - `apps/api/src/modules/onboarding/onboarding-turn-runner.ts` — `OnboardingTurnRunner.run()`, `applyPureChipTurn()` (stateless turn fn + zero-call chip path)
  - `apps/api/src/modules/onboarding/onboarding-chips.ts` — schema/vocab-derived chips + code-filled ack templates
  - `apps/api/src/agents/onboarding.agent.ts` — `LLMProvider` seam, `TEXT_MODEL_TIER='flagship'`/`CLASSIFIER_TIER='mini'`, `stripNulls`, `respondWithTools` (`strictAllTools`)
  - `apps/api/src/agents/onboarding-tracer.ts` — `OnboardingTracer` / `ONBOARDING_TRACE_DIR` (per-turn trace, `model:null` on zero-LLM turns)
  - `apps/api/src/agents/eval/onboarding-golden.eval.test.ts` — golden-eval harness pattern
- Memory: `epic-2-7-brief-drafted` (now MVP-wall-reached), `strict-tool-schema-nullable-rule`, `guardrail-two-tier-allergen-doctrine`, `snacks-as-household-skus`, `allergen-storage-model`, `family-first-main-then-variations`, `three-main-weekly-pattern`, `lumi-valet-not-chat-app`
