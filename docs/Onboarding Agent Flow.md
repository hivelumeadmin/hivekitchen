# Onboarding Agent Flow

Living reference for how Lumi behaves during onboarding — moments, chips, tools, and transitions.
Update this file whenever the prompt, service logic, or chip config changes.

_Last updated: 2026-06-15_

---

## Overview

Every text turn follows this loop:

```
Parent sends message
  → Service injects CURRENT ONBOARDING STATE into system prompt
  → Agent reads state, fires tool calls, writes prose + [NEXT_MOMENT:key]
  → Service strips directive, persists tool results, updates moment state
  → Response delivered to parent
```

The agent never touches the database directly. It reads two injected blocks:

- **CURRENT ONBOARDING STATE** — which moment, what's required, what's complete
- **Kitchen Map** — everything captured so far (children, allergens, cuisines, favourites, etc.)

---

## State block (injected every turn)

```
CURRENT ONBOARDING STATE
current_moment: m2_safe
required_set:
  m1_household_name: true
  m1_child_declared: true
  m2_allergen_response: false
  m5_favorite_count: 3
  m5_complete: false
required_set_complete: false
cold_start_triggered: false
```

The agent uses `current_moment` to stay in the right moment, and `required_set` to know whether gates are open. It cannot transition to `summary` or trigger finalize until `required_set_complete: true`.

---

## Required-set gate

All four booleans must be true before the agent can advance to the summary:

| Flag | Satisfied when |
|---|---|
| `m1_household_name` | `household.set_name` has been called |
| `m1_child_declared` | At least one `child.upsert` row exists |
| `m2_allergen_response` | Allergen response captured for at least one child |
| `m5_complete` | `favorite_lunches` count ≥ 10 |

If the parent tries to end early, the agent guides them warmly to the missing moment. It never refuses rudely and never says "finalize" until `required_set_complete = true`.

---

## Moment 1 — Who's at the table (`m1_table`)

**Goal:** capture child names and ages, then name the household.

**Flow:**
1. Agent opens warmly, asks about the family
2. As the parent names children → `child.upsert(name, age_band)` fires per child
3. Once ≥1 child is captured, agent pivots: "What should I call your household?" and appends `[CHIP_PROMPT:household_name]` to that exact turn
4. Client swaps chips to show household-name format examples (e.g. "Menon Kitchen", "The Khan Family")
5. Parent types or selects → `household.set_name(display_name)` fires
6. Agent confirms and embeds `[NEXT_MOMENT:m2_safe]`

**Chips:**
- Opening: hint chips (illustrative, not selectable)
- Household name: format examples via `[CHIP_PROMPT:household_name]`

**Tools:**

| Tool | When |
|---|---|
| `child.upsert` | One call per child as named; idempotent by name |
| `household.set_name` | Once, when the parent names the household |

**Exit gate:** `m1_household_name = true` AND `m1_child_declared = true`

---

## Moment 2 — What I need to keep safe (`m2_safe`)

**Goal:** explicit allergen response for every child. The safety wall — cannot be skipped.

**Flow:**
1. Agent asks about allergies; client renders allergen chip cards per child
2. Parent taps chips or types prose
3. Agent fires `allergen.declare` per allergen per child (never batched)
4. If `no_known_allergens` chip → no tool call, acknowledge warmly
5. Once all children have a response → agent confirms allergens AND bridges to M3 in the **same turn**:
   > "Noted — peanut for Layla, nothing for Adam. Now let's talk about your kitchen's food identity…" `[NEXT_MOMENT:m3_taste]`

**Critical rule:** Never end M2 with just an acknowledgement and no bridge sentence. M3 chips appear immediately after the response — the parent must know why.

**Chips:**

| Chip key | Action |
|---|---|
| `peanut`, `tree_nut`, `dairy`, `egg`, `wheat`, `soy`, `sesame`, `shellfish`, `fish` | `allergen.declare(child_name, allergen)` — one call per chip |
| `no_known_allergens` | No tool call. Acknowledge and advance when all children answered |

**Tools:**

| Tool | When |
|---|---|
| `allergen.declare` | One call per allergen per child. Never batch. |
| `child.upsert` | PATCH only, if correcting an existing child field |

**Exit gate:** `m2_allergen_response = true` (service flips this when the agent advances out of M2)

---

## Moment 3 — How your kitchen tastes (`m3_taste`)

**Goal:** cultural identity, dietary identity, cuisine tradition, food preferences. Optional — parent can skip.

**Flow:**
1. Client renders cuisine + dietary choice chips (multi-select)
2. Parent selects or types
3. Agent fires tools for each selection
4. If enforcement is ambiguous ("strictly Halal" but strength unclear) → agent emits `[CHIP_PROMPT:elevation:halal:Halal]` instead of committing; client shows three clarification chips
5. On clarification response → agent commits with the resolved enforcement level
6. Agent acknowledges the selection AND opens M4 in the **same turn**:
   > "Great — South Indian and Mediterranean noted. Now, what usually goes into the lunchbox?" `[NEXT_MOMENT:m4_bag]`

**Critical rule:** M3 acknowledgement and M4 opening must be in the same turn — M4 chips appear immediately after.

**Chips:**

| Chip key | Action |
|---|---|
| Cuisine keys (`south_indian`, `levantine`, `italian`, `mexican`, `caribbean`, etc.) | `cuisine.declare(key)` for each |
| Dietary keys (`halal`, `kosher`, `vegetarian`, `vegan`, `pescatarian`, `gluten_free`, `dairy_free`, etc.) | `dietary.declare(tag, enforcement)` for each |
| `skip` | Acknowledge, `[NEXT_MOMENT:m4_bag]`, no tools |
| `always-respect` (elevation follow-up) | Commit previous tag with `enforcement='non_negotiable'` |
| `prefer` (elevation follow-up) | Commit with `enforcement='strong'` |
| `just-context` (elevation follow-up) | Commit with `enforcement='just_for_context'` |

**Tools:**

| Tool | When |
|---|---|
| `cultural.note` | Cultural/religious identity ("we're a Hindu family"). `state='suggested'` always. |
| `cuisine.declare` | Cuisine tradition |
| `dietary.declare` | Dietary identity tag with enforcement |
| `food_preference.declare` | Item-level likes/dislikes/refuses. "hates broccoli" → `valence='refuses'`. Never use `allergen.declare` for dislikes. |
| `rule.set` | Household-wide rules (`no_pork`, `no_alcohol`). Defaults to `enforcement='strong'`. |

**Exit gate:** Parent finishes M3 response or taps `skip`

---

## Moment 4 — What goes in the bag (`m4_bag`)

**Goal:** capture bag composition pattern per child.

**Flow:**
1. Client renders four action chips
2. Single chip tap = "all children get this pattern" → `child.upsert` per child, fired in parallel
3. If the parent types prose with per-child variation ("Layla bento, Adam thermos") → agent infers per child, fires one `child.upsert` per child
4. Agent confirms and embeds `[NEXT_MOMENT:m5_starting_line]`

**Chips:**

| Chip key | Action |
|---|---|
| `main_only` | `child.upsert(bag_composition_pattern='main_only')` for all children |
| `main_plus_snack` | Same, `main_plus_snack` |
| `main_plus_extra` | Same, `main_plus_extra` |
| `main_plus_snack_plus_extra` | Same, `main_plus_snack_plus_extra` |

**Tools:**

| Tool | When |
|---|---|
| `child.upsert` | One call per child with `bag_composition_pattern` set |

**Exit gate:** Every declared child has a `bag_composition_pattern`

---

## Moment 5 — A starting line (`m5_starting_line`)

**Goal:** collect favourite lunch items as the household cold-start seed. Target: 10 items.

### Normal mode (`cold_start_triggered: false`)

1. Client renders recipe choice chips (multi-select, up to ~18 recipes from the catalog)
2. Chip selections arrive with **names already resolved** by the service (the service resolves recipe UUIDs to names before the agent sees them):
   ```
   [Chips selected: Chicken Sandwich, Shawarma Wrap, Pasta Salad]
   ```
3. Agent fires `favorite_lunch.add(item=<name>)` for every name in the bracket — one call per item, no lookup needed
4. Free-text items the parent types → `favorite_lunch.add` with raw text
5. At count ≥ 10 → agent delivers the **full profile summary AND** embeds `[NEXT_MOMENT:summary]` in the **same turn**

**Control key:** `override_fewer` → skip count gate, embed `[NEXT_MOMENT:summary]` immediately, no `favorite_lunch.add`

### Cold-start mode (`cold_start_triggered: true`)

Triggers when the catalog is empty after allergen/dietary filtering, or Stage 1 timed out before enough rows were ready. Agent opens with:

> "I want to make sure I get this right — tell me three dishes your family eats most weeks."

Fires `favorite_lunch.add` after each dish. At count = 3, delivers the full profile summary + `[NEXT_MOMENT:summary]` in the same turn. Exit threshold: 3 dishes.

**Critical rule (both modes):** Never say "let me read it back" and then stop. The summary must be delivered in the same turn as the exit directive.

**Tools:**

| Tool | When |
|---|---|
| `favorite_lunch.add` | One call per item; idempotent on item name |

**Exit gate:** `m5_complete = true` (count ≥ 10) OR `override_fewer` chip

---

## Summary moment (`summary`)

**Goal:** wait for explicit parent confirmation of the profile read-back, then invite Finalize.

The full profile summary was delivered in the M5 exit turn. The agent responds to the parent's message:

| Parent response | Agent action |
|---|---|
| Explicit confirmation ("yes, looks right", "that's us") | Congratulate warmly + invite Finalize button (right side of screen) |
| Correction | Fire the fix tool, confirm in one sentence, re-invite Finalize |
| Question | Answer naturally, re-invite Finalize |
| `required_set_complete = false` | Name the specific missing moment, do NOT say "finalize" |

**Key rules:**
- Never assume confirmation — wait for the parent's explicit words
- Never emit `[NEXT_MOMENT:finalized]` — the Finalize button is the only terminal gate
- Input bar is always visible in summary mode so the parent can respond

---

## Tool reference (all moments)

| Tool | Moment | Notes |
|---|---|---|
| `household.set_name` | M1 | Once per onboarding |
| `child.upsert` | M1 first; later moments for PATCH | Idempotent by name within household |
| `allergen.declare` | M2 | One allergen, one child, one call — never batch |
| `cultural.note` | M3 | `state='suggested'` always |
| `cuisine.declare` | M3 | |
| `dietary.declare` | M3 | Enforcement reflects stated strength |
| `food_preference.declare` | M3 | `valence='refuses'` for "won't eat X" |
| `rule.set` | M2 or M3 | Household-wide; defaults to `enforcement='strong'` |
| `favorite_lunch.add` | M5 | Household-scoped; idempotent on item name |
| `household.upsert` | Any | PATCH corrections only — not first writes |
| `memory.note` | Any | For facts with no dedicated tool. `node_type`: `rhythm`, `child_obsession`, `other`. Never for allergens, preferences, cultural identity, or dietary rules. |

---

## Common failure modes

| Symptom | Root cause |
|---|---|
| M3 chips appear with no context | Agent ended M2 without the bridge sentence to M3 |
| M4 chips appear with no context | Agent split M3 ack and M4 opening across two turns |
| Agent says "let me read it back" then stops in M5 | Summary must be in the same turn as `[NEXT_MOMENT:summary]` |
| `allergen.declare` fired for "hates broccoli" | Should be `food_preference.declare(valence='refuses')` |
| Multiple allergens in one tool call | Each allergen needs its own `allergen.declare` call |
| "I've recorded that" / "Let me add…" in Lumi's text | Anti-narration violation — tools are invisible plumbing |
| Ghost names appearing in family panel | Frontend `extractChildren` heuristic matching common words — see `NAME_STOP_WORDS` in `OnboardingText.tsx` |
| "Add your first child" showing post-onboarding | BriefCanvas empty state — button removed; onboarding guarantees ≥1 child |

---

## Source files

| File | What it controls |
|---|---|
| `apps/api/src/agents/prompts/onboarding.prompt.ts` | Agent system prompt — moments, tools, directives |
| `apps/api/src/modules/onboarding/onboarding.service.ts` | Moment state machine, directive parsing, UUID resolution, finalize gate |
| `apps/api/src/modules/catalog/catalog-projection.service.ts` | M5 chip catalog — personalization filter, cold-start detection |
| `apps/web/src/features/onboarding/OnboardingText.tsx` | Frontend chat UI, chip rendering, `extractChildren` heuristic |
| `packages/contracts/src/onboarding-tools.ts` | Zod schemas for all onboarding tool calls |
