# HiveKitchen — Canonical Data Model v2 (Spec for Review)

> **Status:** Draft for review · **Author:** Claude (architecture pass) · **Date:** 2026-07-28
> **Supersedes framing of:** `canonical-data-model-design.md` (the 3-DM series, already shipped)
> This is a **second-generation reshape**, not a rewrite. Most of the shipped canonical model
> is kept verbatim. This doc formalizes what was left implicit and fixes the warts that
> re-accumulated after the first redesign.

---

## 0. Why this doc exists

The first canonical redesign (3-DM series, migrations `20261005`–`20261034`) already did the hard
structural work: it replaced the flat `plan_items` table with a real plan tree, consolidated three
allergen stores into one, promoted `recipes.instructions` jsonb into `recipe_steps`, and turned the
Kitchen Map into a versioned projection. **That work stands.**

But three things pull the model back toward complexity, and one whole feature area is missing:

1. **The snack un-fold reintroduced a dual-FK on the slot** — the exact pattern the redesign killed on `plan_items`, now living on `plan_slots` (`recipe_id` XOR `snack_sku_id`).
2. **The learning loop is scattered** across `lunch_link_sessions.rating`, `child_preferences`, `child_lunch_requests`, `extra_removal_signals`, and `food_preferences` — five write paths for "the family told us something."
3. **New JSONB escape hatches crept back in** (`preferred_family_language_terms`, `children.extra_rules`, `school_policy_notes` alongside the `school_policies` table).
4. **There is no first-class Calendar** — the product concept's "Family Calendar" (term dates, No-Lunch days, early release) is only expressible *after* a plan exists, as `plan_days.paused_at`. The planner cannot know which days need a lunch *before* it composes.

This spec resolves those four and, above all, **makes the constraint hierarchy — the "Family Safety
& Identity Engine" from the product glossary — an explicit, first-class part of the schema** rather
than an emergent property of `enforcement_level` defaults scattered across six tables.

---

## 1. Governing principles

1. **The constraint hierarchy is the spine.** Every suggestion Lumi makes is gated by a single, documented precedence: **Safety → Identity → School & Calendar → Preference.** The schema encodes which tier each constraint lives in; the deterministic guardrail enforces the hard tiers; the planner LLM only ever sees the soft tier as weights.
2. **The LLM proposes; the deterministic core disposes.** No safety- or identity-hard decision is ever made by a model. The guardrail is a pure function over declared constraints.
3. **Relational core, append-only signals.** Resources (household, child, plan, catalog) stay normalized and mutable. *Learning inputs* (feedback, leftovers, requests, edits) become one append-only event log; everything derived is a projection.
4. **Projections may denormalize; sources may not.** `kitchen_map` and `brief_state` are read-models and are allowed jsonb/denormalized shapes. Source tables get first-class columns, enums for stable sets, vocab tables for evolving sets.
5. **Encryption and RLS are schema properties, declared once.** Every PII column's encryption status and every table's RLS policy is specified in this doc (§10), not retrofitted per migration.
6. **One reference, one meaning.** A foreign key points at exactly one kind of thing. Polymorphic "this OR that" references are modeled explicitly, never as two nullable FKs with a CHECK.

---

## 2. The domain at a glance

```
                          ┌─────────────┐
                          │  Household  │──── users (caregivers)
                          └──────┬──────┘
             ┌───────────────────┼────────────────────────┐
             ▼                   ▼                         ▼
       ┌──────────┐      ┌───────────────┐         ┌──────────────┐
       │ Children │      │  CONSTRAINTS  │         │   Calendar   │  ← NEW first-class
       └────┬─────┘      │ (4 tiers)     │         │ terms + days │
            │            └───────┬───────┘         └──────┬───────┘
            │                    │                        │
            │            ┌───────▼────────────────────────▼───────┐
            │            │      Family Safety & Identity Engine    │
            │            │  (deterministic guardrail + resolver)   │
            │            └───────┬────────────────────────┬───────┘
            │                    │ hard filters           │ soft weights
            ▼                    ▼                         ▼
     ┌────────────┐      ┌──────────────┐         ┌─────────────────┐
     │  Signals   │─────▶│  Kitchen Map │◀────────│  Planner (LLM)  │
     │ (event log)│ proj │ (projection) │ context │  single-shot    │
     └────────────┘      └──────────────┘         └────────┬────────┘
            ▲                                               ▼
            │                                        ┌────────────┐
     ┌──────┴───────┐                                │  Plan tree │
     │  Lunch Link  │◀───────────────────────────────│ (kept)     │
     │ + Heart Note │        child experience         └────────────┘
     └──────────────┘
```

---

## 3. The Constraint Hierarchy (the Family Safety & Identity Engine)

This is the most important section. Everything else serves it.

### 3.1 The four tiers, in precedence order

| Tier | Name | Enforcement | Decided by | Source tables |
|------|------|-------------|------------|---------------|
| **0** | **Safety** | Hard, fail-closed | Deterministic guardrail | `household_allergens`, `allergen_tags` (FALCPA vocab) |
| **1** | **Identity** | Hard *when the family opts in*; otherwise strong-soft | Guardrail (hard mode) or resolver (soft) | `household_cultural_identifiers`, `household_rules`, `cultural_priors` |
| **2** | **School & Calendar** | Hard planning constraint | Resolver (pre-flight) | `school_policies`, `calendar_*` (NEW) |
| **3** | **Preference** | Soft weights | Planner LLM ranking | `food_preferences`, `dietary_preferences`, `children.{appetite,texture,spice}`, `signals` (projected) |

**The invariant:** a higher tier can never be overridden by a lower one. A recipe the child loves
(tier 3) is discarded without appeal if it contains a declared allergen (tier 0). This is enforced
*structurally* — tiers 0–2 produce a **hard candidate filter** applied in code before the planner
sees anything; tier 3 produces **weights** the planner uses to rank the survivors.

### 3.2 How enforcement is expressed

Today the softer-than-safety ordering rides on `enforcement_level` defaults scattered across tables.
v2 keeps `enforcement_level` but adds a single **`constraint_tier`** derivation so the ordering is
readable, not implied:

- Tier 0 is not a column — allergens are *uniformly* hard. There is no severity field. An allergen is either declared or it isn't.
- Tier 1 rows carry `enforcement enforcement_level` where `strict` promotes them to guardrail-hard (a Halal household that sets pork enforcement to `strict` gets the same fail-closed treatment as an allergen). This closes the "religious enforcement kept out" gap noted in prior slices — it becomes a per-family setting, not a code branch.
- Tier 2 is always hard but *pre-flight*, not fail-closed: a No-Lunch day removes the slot entirely; a no-nut school policy filters candidates.
- Tier 3 never blocks. It only ranks.

### 3.3 The resolver — one function, two outputs

```
resolveConstraints(householdId, weekOf) → {
  hardFilter:  (candidate) => boolean          // tiers 0–2, deterministic
  softWeights: { childId, weights[] }          // tier 3, fed to planner prompt
  lunchDays:   Date[]                           // tier 2 calendar, which days need a lunch
}
```

The guardrail (`allergy-rules.engine.ts`, already pure and versioned at `GUARDRAIL_VERSION`) becomes
the tier-0/tier-1-hard implementation behind `hardFilter`. The resolver is the single place the
precedence lives. **No other code re-derives priority.**

---

## 4. Canonical tables

Tables marked **KEEP** are unchanged from the shipped model and specified here only by reference.
Tables marked **CHANGE** or **NEW** carry DDL sketches.

### 4.1 Household core — KEEP (with two subtractions)

`households`, `users` — **KEEP**. Two changes:
- **Remove** `preferred_family_language_terms jsonb`. Promote to satellite table `family_language_terms(household_id, term, added_at, source)` — it's a growing set with provenance, which is a table, not a jsonb array.
- `caregiver_relationships jsonb` — **KEEP as-is** (encrypted, genuinely irregular shape, read whole).

### 4.2 Children & profiles — KEEP (with one subtraction)

`children` — **KEEP** the 3-DM-B1 shape (`appetite_level`, `texture_needs`, `spice_tolerance`, `bag_composition_pattern` enums). Two changes:
- **Remove** `children.extra_rules jsonb {pins,bans}`. Normalize into `child_extra_rules(child_id, extra_library_id, rule enum('pin','ban'), created_at)`. Pins/bans are queried by the planner per-child; they should be rows.
- **Remove** `children.school_policy_notes text`. It duplicates `school_policies` (§4.5). Migrate any surviving free-text into a `school_policies` row with `policy_type='note'`.

### 4.3 Tier 0 — Safety: allergens — KEEP

`household_allergens` (consolidated, `child_id` nullable = household-wide vs attributed) — **KEEP verbatim.**
`allergen_tags` FALCPA vocab — **KEEP.** This table is the single best-designed part of the constraint
layer. Do not touch it.

### 4.4 Tier 1 — Identity: cultural & religious — KEEP + promote enforcement

`household_cultural_identifiers`, `household_rules`, `cultural_priors` — **KEEP shapes.** One semantic
change: the guardrail repository (`getRulesForHousehold`) now *also* reads tier-1 rows whose
`enforcement = 'strict'` and emits them as hard blocks alongside allergens. No schema change — a read
change. Document that `enforcement='strict'` on a tier-1 row is load-bearing for safety.

### 4.5 Tier 2 — School policy — CHANGE (kill the dual representation)

`school_policies` (child-scoped, `slot_scope` enum) — **KEEP the table**, **remove** the coexisting
`children.school_policy_notes` free-text path (see §4.2).

**Resolved (§9-A → keep child-scoped):** school policy stays child-scoped. Two siblings at the same
school duplicate a handful of policy rows — cheap, and it keeps the model join-free. A `schools` entity
is explicitly *not* introduced; revisit only if multi-kid-same-school becomes a proven pain point.

### 4.6 Tier 2 — Calendar — **NEW (fills the product gap)**

The product concept's "Family Calendar" has no home today. No-Lunch days only exist as
`plan_days.paused_at` *after* a plan is generated. The planner must know lunch days *before* composing.

```sql
-- Recurring term structure (the default rhythm)
CREATE TABLE calendar_terms (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  child_id     uuid REFERENCES children(id) ON DELETE CASCADE,  -- NULL = whole household
  label        text NOT NULL,                    -- "Autumn Term"
  start_date   date NOT NULL,
  end_date     date NOT NULL,
  weekdays     smallint[] NOT NULL DEFAULT '{1,2,3,4,5}',  -- ISO weekdays that need lunch
  source       calendar_source NOT NULL,          -- manual | google_readonly | school_import
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);

-- One-off exceptions (holidays, trips, early release) — override the term
CREATE TABLE calendar_exceptions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  child_id     uuid REFERENCES children(id) ON DELETE CASCADE,   -- NULL = whole household
  on_date      date NOT NULL,
  kind         calendar_exception_kind NOT NULL,  -- no_lunch | early_release | school_meal | trip | other
  note         text CHECK (char_length(note) <= 200),
  source       calendar_source NOT NULL,
  UNIQUE (household_id, COALESCE(child_id, '00000000-0000-0000-0000-000000000000'::uuid), on_date)
);
```

**Derived, not stored:** whether a given date is a Lunch Day is a *function* — `isLunchDay(child, date)`
= inside a term's weekdays AND not overridden by a `no_lunch`/`school_meal`/`trip` exception. The
resolver (§3.3) computes `lunchDays` from these two tables. `plan_days` continues to represent
*generated* days; the calendar represents *intent*. This cleanly separates "which days need a lunch"
(calendar, tier 2, pre-flight) from "what's on the plate" (plan tree).

The read-only Google Calendar sync (concept §5) writes `calendar_exceptions` rows with
`source='google_readonly'` — it never mutates the external calendar, matching the concept's "read-only"
constraint. No new tables needed for sync; it's an ingestion source.

### 4.7 Catalog — CHANGE (resolve the snack dual-FK)

Two catalogs stay — and *should* stay. Snacks are domain-different from recipes: pre-packaged SKUs,
no cooking, parent-attested allergens, deterministic (non-LLM) rotation. Folding them into `recipes`
was tried and correctly reversed. The problem is not two catalogs; it's the **two nullable FKs on
`plan_slots`**.

`recipes` + `recipe_steps` (prep/finish `step_mode`) — **KEEP.**
`snack_skus` (household-scoped shelf + global seeds, CHECK-pinned `allergen_tags`/`dietary_tags` arrays) — **KEEP.**

**Change — introduce a single slot→item reference.** Replace `plan_slots.recipe_id` +
`plan_slots.snack_sku_id` + `plan_slots.main_assignment_id` with one polymorphic reference resolved
through a thin join table, so the slot has *one* meaning:

```sql
CREATE TYPE slot_item_type AS ENUM ('main_assignment', 'recipe', 'snack_sku');

-- plan_slots keeps slot_kind + extra_kind + paused_at, but its item reference becomes:
--   item_type slot_item_type NOT NULL
--   item_id   uuid NOT NULL
-- with a CHECK matrix mapping slot_kind → allowed item_type
--   (main → main_assignment; snack → recipe|snack_sku; extra → recipe)
```

This keeps the in-DB integrity the XOR CHECKs gave you but collapses three nullable FKs to one typed
reference. Referential integrity is enforced by a trigger (Postgres can't FK a polymorphic column) —
an acceptable, well-understood trade for a single-meaning slot.

**Resolved (§9-B → polymorphic reference):** the slot carries one typed reference
`(item_type slot_item_type, item_id uuid)`. Referential integrity is enforced by an
`AFTER INSERT/UPDATE` trigger that validates `item_id` exists in the table named by `item_type`, and a
CHECK matrix maps `slot_kind → allowed item_type` (main→main_assignment; snack→recipe|snack_sku;
extra→recipe). The two-nullable-FK fallback is rejected — the slot gets one meaning.

Unify allergen vocabulary across both catalogs: `recipes.allergen_flags` and `snack_skus.allergen_tags`
must both draw from `allergen_tags` (FALCPA) so the guardrail reads one vocabulary regardless of item
type. (They nearly do today — make it a hard rule.)

`plan_slot_variations.add_ons`/`removals text[]` — **Open decision (§9-C):** tie to the extra/vocab
tables or leave free-text. Recommendation: leave free-text for now (low safety stakes, high expressive
value); revisit if it feeds the guardrail.

### 4.8 The plan tree — KEEP (this is the crown jewel, don't touch it)

`plans` → `plan_main_assignments` → `plan_days` → `plan_slots` → `plan_slot_variations` — **KEEP entirely.**
`plan_day_context` (contextual hints), `commit_plan()` / `swap_plan_days()` / `pause_child_on_day()`
RPCs — **KEEP.** The only change here is the slot item reference (§4.7). The `guardrail_cleared_at`
presentation-bind gate is exactly right and stays.

### 4.9 Signals — **NEW (unify the learning loop)**

Today "the family told us something" is written in five places. Collapse the *inputs* into one
append-only log; keep the *aggregates* as projections.

```sql
CREATE TABLE signals (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  child_id     uuid REFERENCES children(id) ON DELETE CASCADE,   -- NULL = household-level
  kind         signal_kind NOT NULL,   -- lunch_rating | lunch_request | leftover_log
                                        -- | extra_removal | preference_edit
  subject_ref  jsonb,                   -- typed per kind: {recipe_id, slot_kind} | {sku_id} | free text
  payload      jsonb NOT NULL,          -- typed per kind, Zod-validated at the write boundary
  occurred_at  timestamptz NOT NULL,
  source       signal_source NOT NULL,  -- lunch_link | app | voice | import
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON signals (household_id, kind, occurred_at DESC);
CREATE INDEX ON signals (child_id, kind) WHERE child_id IS NOT NULL;
```

- **Append-only.** Signals are never updated or deleted (a "correction" is a new signal). This is what makes the learning loop auditable and replayable — the moat.
- **Projections derive from it.** `child_preferences` (the planner-facing aggregate) becomes a
  *materialized projection* over `signals WHERE kind='lunch_rating'`, refreshed on write, exactly like
  the Kitchen Map. `food_preferences` remains a *curated* table (parent-edited durable facts), but the
  raw taps that feed it flow through `signals` first.
- **`child_lunch_requests` stays a table** (it has workflow state: pending/approved/declined, and the
  "sacred verbatim channel" invariant) but is *fed by* a `signals` row of `kind='lunch_request'`. The
  signal is the immutable record; the request is the mutable workflow object.

**Why this matters:** the concept's promise is "it compounds." An append-only signal log is the
schema-level expression of compounding — every plan can be explained by the signals that shaped it,
and next week's plan is a pure function of accumulated signals + constraints. It also *reduces* the
table sprawl (`lunch_link_sessions.rating`, `extra_removal_signals` fold in) rather than adding to it.

### 4.10 Conversation threads — KEEP

`threads`, `thread_turns` (`server_seq` monotonic, `modality` text|voice), voice tables — **KEEP.**
The one-thread-per-family, text+voice-share-storage invariant is correct and stays.

### 4.11 Child experience — KEEP (with signal rewiring)

`lunch_link_sessions`, `lunch_link_keys`, `heart_notes` — **KEEP shapes.** Rewire: a rating submitted
via a Lunch Link writes a `signals` row (`kind='lunch_rating'`, `source='lunch_link'`) *first*, and the
`lunch_link_sessions.rating` column becomes a denormalized convenience mirror of that signal (or is
dropped in favor of a join — §9-D). The session table stays the token/delivery record; the signal
becomes the durable feedback fact.

### 4.12 Memory — KEEP

`memory_nodes` (+ `memory_provenance`) — **KEEP.** Memory is *curated, prose* long-term knowledge with
provenance and forgetting; it is deliberately different from raw `signals` (append-only events). The
relationship: signals are the firehose; memory nodes are the durable, human-legible distillations that
`memory_provenance.source_type='plan_outcome'` can trace back to signals. Keep them separate.

### 4.13 Kitchen Map — KEEP the pattern, add two sources

`kitchen_map` stays a **Redis-cached projection** keyed by `households.kitchen_map_version`, composed in
`KitchenMapRepository.loadRaw()`. Changes:
- Add `calendar_terms` / `calendar_exceptions` and the `signals`-derived `child_preferences` projection
  to `loadRaw()`'s parallel reads.
- Add cache-bump triggers on `calendar_terms`, `calendar_exceptions`, and the `child_preferences`
  projection (see §10.3 — *every* new source table feeding `loadRaw` MUST get a version-bump trigger;
  this is the invariant that a prior gap already burned).
- Clean the stale `RawHouseholdRow.cultural_identifiers/declared_allergens` dead references (cosmetic).

---

## 5. What changes from today — delta summary

| # | Change | Type | Rationale |
|---|--------|------|-----------|
| 1 | `calendar_terms` + `calendar_exceptions` | **NEW** | Fills the missing Family Calendar; planner learns lunch days pre-flight |
| 2 | `signals` append-only event log | **NEW** | Unifies 5 scattered learning-input paths; enables auditable compounding |
| 3 | `child_preferences` → projection over `signals` | CHANGE | Aggregate, not a hand-maintained table |
| 4 | `plan_slots`: 3 nullable FKs → 1 polymorphic `(item_type,item_id)` | CHANGE | Kills the snack dual-FK regression; slot has one meaning |
| 5 | Remove `children.school_policy_notes` | CHANGE | Dual representation with `school_policies` |
| 6 | Remove `children.extra_rules jsonb` → `child_extra_rules` rows | CHANGE | JSONB escape hatch → queryable rows |
| 7 | Remove `households.preferred_family_language_terms jsonb` → `family_language_terms` table | CHANGE | Growing set with provenance is a table |
| 8 | Tier-1 `enforcement='strict'` promoted to guardrail-hard | CHANGE (read) | Religious enforcement becomes a family setting, not a code branch |
| 9 | Explicit `constraint_tier` precedence + single `resolveConstraints()` | CHANGE (code) | The hierarchy stops being emergent |
| — | Plan tree, allergens, recipe_steps, threads, memory, Kitchen Map pattern | **KEEP** | The shipped canonical work stands |

---

## 6. What this deliberately does NOT do

- **No stack change, no ORM introduction.** Straight SQL migrations + repository pattern, as today.
- **No full event-sourcing.** Only *learning inputs* are event-logged. Household/child/plan/catalog
  stay relational and mutable. Event-sourcing the whole domain would be over-engineering.
- **No `schools` entity** (deferred, §9-A).
- **No new external dependency.**

---

## 7. Cross-cutting concerns (declared once, here)

### 7.1 Encryption

Columns holding PII are AES-256-GCM under the per-household DEK (`households.encrypted_dek`), with a
SHA-256 `*_hash` sidecar for equality/uniqueness. The canonical encrypted set:

| Table.column | Hash sidecar |
|---|---|
| `household_allergens.allergen` | `allergen_hash` |
| `food_preferences.item` | `item_hash` |
| `household_rules.custom_label` | `custom_label_hash` |
| `households.caregiver_relationships` | — |
| `heart_notes.content` | — |
| `signals.payload` (when it carries free text, e.g. lunch_request) | — |

Child names are **plaintext** post-3-DM-B2 (with the repo's ciphertext-detection fallback for legacy
rows). New encryption is added by *declaring it here first*, then one migration — never ad hoc.

### 7.2 RLS

Every household-scoped table has RLS `ON` with the same policy shape: a row is visible iff its
`household_id` matches the JWT's household claim (child-scoped tables join through `children`). This is
declared as a **table-creation checklist item**, not a later migration. The recurring
"enable-RLS-on-X" migrations that padded the history disappear because RLS ships *with* the table.

### 7.3 Kitchen Map version bump — the load-bearing invariant

**Any table read by `KitchenMapRepository.loadRaw()` MUST have an `AFTER INSERT/UPDATE/DELETE` trigger
that bumps `households.kitchen_map_version`.** A missing trigger = up-to-1-hour stale cache (a gap that
already caused a bug). This spec's new sources (`calendar_*`, `child_preferences` projection) get their
triggers in the same migration that creates them. No exceptions.

### 7.4 JSONB policy

JSONB is permitted only for: (a) **projections** (`brief_state.payload`, `kitchen_map`), (b) genuinely
irregular read-whole blobs (`caregiver_relationships`, `thread_turns.body`, `memory_provenance.source_ref`),
and (c) **typed signal payloads** validated by Zod at the write boundary. JSONB is *not* permitted as a
convenience store for data that is queried by its fields — that data gets columns or rows.

---

## 8. Migration strategy (strangler, not big-bang)

The first redesign used hard pre-beta cutovers. That's still viable pre-launch, but sequence to keep
each step independently shippable:

1. **Calendar first** (`NEW`, additive) — no cutover; planner starts reading it, falls back to
   "all weekdays" when empty. Ships alone.
2. **Signals log** (`NEW`, additive) — dual-write from the five existing paths; build the
   `child_preferences` projection; verify parity; then flip reads to the projection; then retire the
   old write paths. Classic strangler.
3. **JSONB removals** (#5–7) — each is a small, independent migration + repo change + contract update
   in one PR (per the coordinated-contract-change rule).
4. **Slot polymorphic reference** (#4) — the one true cutover. Do it last, atomically, with a
   `commit_plan()` rewrite, exactly as the 3-DM-C1 cutover was done. One transaction, parents-first.
5. **Constraint resolver + tier-1-hard** (#8–9) — pure code; ships behind the existing guardrail
   version bump.

Each step is a valid stopping point. Nothing here requires the whole set to land together.

---

## 9. Decisions

| Ref | Decision | Resolution |
|-----|----------|------------|
| **9-A** | Introduce a `schools` entity, or keep school policy child-scoped? | ✅ **RESOLVED — keep child-scoped.** No `schools` entity; sibling duplication accepted |
| **9-B** | Slot item: polymorphic `(item_type,item_id)` + trigger FK, or keep two nullable FKs? | ✅ **RESOLVED — polymorphic reference.** One typed slot reference + trigger FK + CHECK matrix |
| **9-C** | `plan_slot_variations.add_ons/removals`: vocab-tie or free-text? | Open — recommend **free-text** for now (low safety stakes) |
| **9-D** | `lunch_link_sessions.rating`: keep as denormalized mirror of the signal, or drop and join? | Open — recommend **keep mirror** (one column beats a hot-path join) |
| **9-E** | Tier-1 `strict` → guardrail-hard: ship in this reshape or as its own slice? | Open — recommend **its own slice** (safety-behavior change, focused review) |

---

## 10. Appendix — full canonical table inventory

**KEEP (unchanged):** `households`*, `users`, `children`*, `household_allergens`, `allergen_tags`,
`household_cultural_identifiers`, `household_rules`, `cultural_priors`, `dietary_tags`, `cultural_tags`,
`cuisine_tags`, `food_preferences`, `dietary_preferences`, `school_policies`*, `recipes`,
`recipe_steps`, `household_recipe_usage`, `recipe_comments`, `curated_baseline_items`, `snack_skus`,
`extra_library`, `plans`, `plan_main_assignments`, `plan_days`, `plan_slots`*, `plan_slot_variations`,
`plan_day_context`, `brief_state`, `threads`, `thread_turns`, `voice_sessions`, `voice_transcripts`,
`voice_usage`, `lunch_link_sessions`*, `lunch_link_keys`, `heart_notes`, `memory_nodes`,
`memory_provenance`, `guardrail_decisions`, `cultural_calendar_observances`.
(`*` = minor column change per §5.)

**NEW:** `calendar_terms`, `calendar_exceptions`, `signals`, `family_language_terms`, `child_extra_rules`.

**RETIRED columns:** `children.school_policy_notes`, `children.extra_rules`,
`households.preferred_family_language_terms`.

**Projections (not tables in the source sense):** `kitchen_map` (Redis), `child_preferences`
(materialized over `signals`).
