---
status: phase-3-final
date: 2026-05-29
decisionsResolvedOn: 2026-05-31
phase3ReviewCompletedOn: 2026-05-31
phase3Reviewers:
  - Winston (Architect) — query patterns, scalability, commit_plan txn discipline, Saturday-audit risk
  - Amelia (Dev) — implementation cost, test surface, contracts cascade, hard-cutover endorsement
author: Menon (with Sally facilitating)
phase: 2 (design) / 3 (reviewed and revised)
scope: |
  Canonical lunch-planning data model designed from first principles. Resolves the
  bolt-on accumulation and storage shape inconsistencies catalogued in Phase 1.
  All five open questions resolved 2026-05-31; Phase 3 architect+dev review applied
  same day. Ready for Phase 4 (migration story breakdown for Epic 3 solutioning pickup).
project_name: HiveKitchen
inputs:
  - current-data-model-snapshot.md (Phase 1 output)
  - ux-design-spec-family-first-lunch.md
  - 7 family-first project memories
---

# Canonical Data Model Design — Lunch-Planning Layer

**Purpose:** specify the clean canonical lunch-planning data model. Resolves the accumulated bolt-ons + storage shape inconsistencies + missing concepts surfaced by Phase 1. Designed against the family-first frame.

**Status:** Phase 3 reviewed and final. All five decisions locked; Winston + Amelia revisions applied 2026-05-31. Next: Phase 4 migration story breakdown.

---

## 1. Design Principles

Five principles bind every choice below.

1. **First-class entities, not bolt-on columns.** When a concept proves persistent (sick-day pause, archive semantics, variation per child, main-group identity), it deserves its own structure — not another column on an aging table.

2. **Enums for known stable values, vocab tables for evolving sets.** Days of the week, slot kinds, optional-extra kinds, portion sizes, textures, spice levels → enums. Allergens, cuisines, cultural tags → vocab tables (existing).

3. **Normalize sources of truth, denormalize projections.** `brief_state` remains a Tier B projection optimized for read speed. The normalized plan/recipe/child tables are the authoritative shape; the projection layer is what gets read at the Brief route.

4. **Validate at the layer that knows best.** Hard structure → Postgres CHECK + FK. Open vocabulary → service-layer Zod against vocab tables. Both layers must agree on the shape; never one without the other.

5. **Migration discipline — every reshape comes with a clear path.** Project precedent (`favorite_lunches`, `allergy_rules` were dropped 2026-09-08) proves clean migrations ship in this codebase. No long-term coexistence; every "legacy column phase-out" gets a committed drop date.

---

## 2. The Three Reshapes

The family-first model and the bolt-on accumulation cluster naturally into three coordinated reshapes:

| Reshape | Solves |
|---|---|
| **Plan Structure** | Main-group + Variation + Slot enum + Optional Extra kinds + School-week rhythm + plan_items bolt-ons |
| **Recipe Shape** | Structured method steps with mode tags + dual time budget + snack/recipe unification |
| **Child Profile** | Variation-driving attributes (appetite, texture, spice) + consolidate the 3-places-to-look-for-allergens pattern |

The reshapes are independent enough to migrate in stages but cohesive enough to design together.

---

## 3. Reshape 1: Plan Structure

### 3.1 Conceptual model

```
Plan (per household per week)
  ├── PlanMainAssignment (M1, M2, M3 — Lumi's 3 main bases per week)
  └── PlanDay (one per Mon-Fri)
        └── PlanSlot (main, snack, extra — one per slot per day)
              └── PlanSlotVariation (one per child per slot)
```

This explicit hierarchy expresses the family-first frame structurally:
- The 2-day-repeat pattern is a `PlanMainAssignment` referenced by two `PlanDay` rows
- The shared Main is a `PlanSlot(kind=main)` carrying a recipe FK
- Per-child differences are `PlanSlotVariation` rows
- Snack + Optional Extra are sibling `PlanSlot` rows

### 3.2 New types (enums)

```sql
-- Includes Saturday — preserves the Mon-Sat school-week support already in the brief
-- composer (Israel/orthodox/some private US schools). Per Q3 decision (2026-05-31).
CREATE TYPE weekday AS ENUM ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday');
CREATE TYPE slot_kind AS ENUM ('main', 'snack', 'extra');
CREATE TYPE extra_kind AS ENUM (
  'drink', 'extra_snack', 'protein_boost', 'sports_add',
  'sweet', 'toddler_safe', 'allergy_substitute', 'custom'
);
CREATE TYPE portion_size AS ENUM ('small', 'regular', 'large');
CREATE TYPE texture_level AS ENUM ('soft', 'normal', 'diced', 'finger');
CREATE TYPE spice_level AS ENUM ('mild', 'regular', 'spicy');
CREATE TYPE pause_reason AS ENUM ('sick_day', 'holiday', 'snow_day', 'field_trip', 'half_day', 'other');
```

### 3.3 Table: `plans` (kept; cleaned up)

```sql
CREATE TABLE plans (
  id                    uuid PRIMARY KEY,
  household_id          uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  week_of               date NOT NULL,              -- replaces week_id+week_of dual rep
  revision              int  NOT NULL DEFAULT 1,
  generated_at          timestamptz NOT NULL,
  guardrail_cleared_at  timestamptz,                -- presentation-bind gate (unchanged)
  guardrail_version     varchar(32),
  prompt_version        varchar(32) NOT NULL,

  -- Absorbed from brief_state.plan_state* (lived on the projection but is a plan-level concern)
  state                 plan_state_enum,
  state_set_at          timestamptz,
  state_message         text CHECK (char_length(state_message) <= 500),

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  UNIQUE (household_id, week_of)
);
```

**Changes from current:**
- `week_id` (UUID hash) **DROPPED** — `week_of` (ISO date) is sufficient and human-readable.
- `state` / `state_set_at` / `state_message` **moved here** from `brief_state` (they're plan facts, not projection facts).
- All other columns unchanged.

### 3.4 Table: `plan_main_assignments` (NEW)

Models Lumi's "3 Mains per week" pattern explicitly.

```sql
CREATE TABLE plan_main_assignments (
  id          uuid PRIMARY KEY,
  plan_id     uuid NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  -- 1..6 ceiling: matches Mon-Sat school-week support. Per Q3 decision (2026-05-31).
  -- The sequence can become SPARSE after parent overrides — e.g., a swap-this-Main
  -- that replaces M2 may leave only M1, M3, M4 active. Sequence is a within-plan
  -- identifier, not an ordering claim.
  sequence    smallint NOT NULL CHECK (sequence >= 1 AND sequence <= 6),
  recipe_id   uuid NOT NULL REFERENCES recipes(id),
  created_at  timestamptz NOT NULL DEFAULT now(),

  UNIQUE (plan_id, sequence)
);

CREATE INDEX plan_main_assignments_plan_idx ON plan_main_assignments (plan_id);
```

**Why explicit:** the M1/M2/M3 grouping is a planning artifact Lumi produces. Today it's implicit (multiple `plan_items` for different days happen to share a `recipe_id`). Making it explicit:
- Reduces denormalization (a Main change updates one row, not N)
- Enables planner output validation (M1 and M2 must be distinct recipes; sequence enforced)
- Surfaces grocery aggregation: "buy ingredients for M1×2 days + M2×2 days + M3×1 day"

### 3.5 Table: `plan_days` (NEW — replaces flat `plan_items`)

```sql
CREATE TABLE plan_days (
  id              uuid PRIMARY KEY,
  plan_id         uuid NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  day             weekday NOT NULL,
  paused_at       timestamptz,                                 -- full-day pause
  paused_reason   pause_reason,
  paused_note     text CHECK (char_length(paused_note) <= 200),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (plan_id, day),
  CONSTRAINT plan_days_pause_consistency CHECK (
    (paused_at IS NULL AND paused_reason IS NULL AND paused_note IS NULL) OR
    (paused_at IS NOT NULL AND paused_reason IS NOT NULL)
  )
);
```

**Why a day row:** day is no longer just a column on items; it's a first-class entity. Pause semantics (the existing `plan_items.paused_at` + `day_overrides.override_type='bag_suspended'` overlap) consolidate here.

### 3.6 Table: `plan_slots` (NEW — replaces per-row plan_items)

```sql
CREATE TABLE plan_slots (
  id                   uuid PRIMARY KEY,
  plan_day_id          uuid NOT NULL REFERENCES plan_days(id) ON DELETE CASCADE,
  slot_kind            slot_kind NOT NULL,                     -- main | snack | extra

  -- For slot_kind='main': the recipe comes from the main assignment (M1/M2/M3).
  -- For slot_kind='snack' or 'extra': the recipe is direct.
  main_assignment_id   uuid REFERENCES plan_main_assignments(id),
  recipe_id            uuid REFERENCES recipes(id),

  -- For slot_kind='extra' only: what KIND of extra
  extra_kind           extra_kind,

  -- Slot-level pause (rare — usually pause is per-day or per-child)
  paused_at            timestamptz,

  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),

  UNIQUE (plan_day_id, slot_kind),

  -- Hard enforcement: which references must be present per slot_kind
  CONSTRAINT plan_slots_main_uses_assignment CHECK (
    slot_kind != 'main' OR
    (main_assignment_id IS NOT NULL AND recipe_id IS NULL AND extra_kind IS NULL)
  ),
  CONSTRAINT plan_slots_snack_uses_recipe CHECK (
    slot_kind != 'snack' OR
    (recipe_id IS NOT NULL AND main_assignment_id IS NULL AND extra_kind IS NULL)
  ),
  CONSTRAINT plan_slots_extra_uses_recipe_and_kind CHECK (
    slot_kind != 'extra' OR
    (recipe_id IS NOT NULL AND main_assignment_id IS NULL AND extra_kind IS NOT NULL)
  )
);

CREATE INDEX plan_slots_main_assignment_idx
  ON plan_slots (main_assignment_id)
  WHERE main_assignment_id IS NOT NULL;
CREATE INDEX plan_slots_recipe_idx
  ON plan_slots (recipe_id)
  WHERE recipe_id IS NOT NULL;
```

**Why a slot row:**
- Replaces the per-`(plan, child, day, slot)` flat `plan_items` row with a per-`(plan, day, slot)` row. Per-child detail moves to variations (next).
- The XOR enforcement (`main_uses_assignment`, `snack_uses_recipe`, `extra_uses_recipe_and_kind`) lives in DB CHECK, not just Zod. Catches malformed planner output at write time.
- `slot_kind` is finally an enum. The current `plan_items.slot text` + `PlanComposeItemSchema.superRefine` + service-layer branching collapses to one constraint.

### 3.7 Table: `plan_slot_variations` (NEW — the variation primitive)

```sql
CREATE TABLE plan_slot_variations (
  id              uuid PRIMARY KEY,
  plan_slot_id    uuid NOT NULL REFERENCES plan_slots(id) ON DELETE CASCADE,
  child_id        uuid NOT NULL REFERENCES children(id) ON DELETE CASCADE,

  -- The variation attributes (per family-first spec §3.3.2)
  portion_size    portion_size NOT NULL DEFAULT 'regular',
  texture         texture_level NOT NULL DEFAULT 'normal',
  spice_level     spice_level NOT NULL DEFAULT 'regular',
  cutting_style   text CHECK (char_length(cutting_style) <= 80),
  container       text CHECK (char_length(container) <= 60),
  add_ons         text[] NOT NULL DEFAULT '{}',
  removals        text[] NOT NULL DEFAULT '{}',
  notes           text CHECK (char_length(notes) <= 280),

  -- Per-child pause on this slot (e.g., "Aarav sick today, Mira+Kabir eat normally")
  paused_at       timestamptz,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (plan_slot_id, child_id)
);

CREATE INDEX plan_slot_variations_slot_idx ON plan_slot_variations (plan_slot_id);
CREATE INDEX plan_slot_variations_child_idx ON plan_slot_variations (child_id);
```

**Why a variation row:** this is the first-class home for the per-child adjustments the family-first model treats as primary. Same Main, three Variations — three rows here. No more "variation as JSONB column on plan_items."

### 3.8 What happens to `plan_items`?

**`plan_items` is replaced** by the four new tables (`plan_main_assignments` + `plan_days` + `plan_slots` + `plan_slot_variations`). Migration plan in §8.

**Functions that move:**
- `commit_plan()` RPC — rewritten to upsert into the new table set in one transaction (see §3.9).
- `replaced_by_plan_id` archive semantics → handled at the `plans.revision` level + soft-delete on `plan_days` if needed (most archive needs are met by the new shape because regenerations bump `revision` and create a new tree).
- `paused_at` → distributed across `plan_days.paused_at` (full-day), `plan_slots.paused_at` (slot-level), and `plan_slot_variations.paused_at` (per-child).

### 3.9 `commit_plan()` rewrite pattern (Phase 3 Winston guidance)

Per Phase 3 Architect review (2026-05-31), the rewritten `commit_plan()` RPC follows these discipline rules. They aren't aesthetic preferences — each prevents a specific failure mode.

**One transaction, never staged.** Staged commits with a partial guardrail flip invent an intermediate plan state that the composer, SSE fanout, and Brief route all have to learn to ignore. That's a permanent coordination tax to avoid a failure mode that doesn't exist yet (50–90 inserts in one PG txn finish in ~20–50ms on warm cache).

**Insert order: parents → children → leaves.** Insert `plans` row first, then `plan_main_assignments`, then `plan_days`, then `plan_slots` (with their XOR-CHECK), then `plan_slot_variations` last. If a variation CHECK fails, the whole txn rolls back — which is what we want. Don't catch and partial-commit.

**Use multi-row INSERTs per table** (`INSERT INTO plan_slots VALUES (...), (...), (...)`), not 18 separate statements. Cuts in-function round-trips from ~90 to ~5.

**Update `plans` row LAST, just before COMMIT.** The plans row update (including the `state` column moved from brief_state per Q2) acquires a row lock. Doing the UPDATE last minimizes lock hold time during the insert burst. Important at scale where concurrent regenerations on the same household could contend.

**Phase C cutover gate: load test with 100 concurrent `commit_plan()` calls.** Catches lock-contention surprises and txn-timeout edges before flipping the write path.

---

## 4. Reshape 2: Recipe Shape

### 4.1 Conceptual model

```
Recipe (canonical catalog entry — unified for mains, snacks, extras)
  └── RecipeStep (structured method, tagged by mode)
```

`snack_skus` is folded into `recipes` (snacks are lightweight recipes with `applicable_slots=['snack']` and few or no steps).

### 4.2 Table: `recipes` (kept; small changes)

```sql
ALTER TABLE recipes
  ADD COLUMN finish_time_minutes int CHECK (finish_time_minutes >= 0);

-- The opaque jsonb `instructions` is REPLACED by structured recipe_steps (next).
-- Drop after backfill (§8).
ALTER TABLE recipes
  DROP COLUMN instructions;
```

**Other changes:**
- All existing columns kept (ingredients structured, tag arrays, GIN indexes, source enum, visibility, community signals).
- `finish_time_minutes` added — the dual-budget design needs both prep and finish times queryable per recipe.

### 4.3 Table: `recipe_steps` (NEW)

```sql
CREATE TYPE step_mode AS ENUM ('prep', 'finish');

CREATE TABLE recipe_steps (
  id          uuid PRIMARY KEY,
  recipe_id   uuid NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  sequence    smallint NOT NULL CHECK (sequence >= 1),
  mode        step_mode NOT NULL,
  text        text NOT NULL CHECK (char_length(text) BETWEEN 1 AND 600),
  created_at  timestamptz NOT NULL DEFAULT now(),

  UNIQUE (recipe_id, sequence)
);

CREATE INDEX recipe_steps_recipe_seq_idx
  ON recipe_steps (recipe_id, sequence);

-- Mode-filtered read pattern (Prep/Finish toggle): supports planner
-- and Wall Card rendering without scanning all steps and discarding.
CREATE INDEX recipe_steps_recipe_mode_idx
  ON recipe_steps (recipe_id, mode);
```

**Why structured steps:**
- Replaces `recipes.instructions` (jsonb, undefined-shape, nullable — the single biggest "we haven't figured out method yet" debt).
- `mode` tag is the data backing for the Wall Card's Prep | Finish toggle. The toggle's filter becomes `WHERE recipe_id = ? AND mode = ?`.
- Per-step constraints are enforceable (length, sequence uniqueness).

### 4.4 What happens to `snack_skus`?

**`snack_skus` is dropped entirely** after migration (Q4 decision, 2026-05-31 — pure fold).

The 10 existing seed rows migrate to `recipes` with:
- `applicable_slots = ['snack']`
- `allergen_flags` translated from the 9 `contains_*` booleans (only the ones marked true)
- `cultural_tags` includes `'halal'` / `'kosher'` if those booleans were true
- `dietary_flags` includes `'vegetarian'` / `'vegan'` if those booleans were true
- No `brand` or `is_packaged_item` columns are added to recipes — household-level systems don't need a packaged-goods catalog discipline. If a household wants to remember a brand, it lives in the variation's `notes` field.

This collapses:
- The current dual reference on `plan_items` (`recipe_id` for main, `item_sku_id` for snack).
- The `PlanComposeItemSchema.superRefine` validation that today enforces the dichotomy at the Zod layer.
- The conceptual split between "things-that-are-recipes" and "things-that-are-snack-SKUs" — they're all `recipes` rows.

**Note on Story 3.20 retirement:** the snack_skus design shipped July 2026 solving the snack/main dual-FK pattern in one direction. The canonical model solves it differently. Pre-beta is exactly when this clean-slate move is cheap — and the project precedent (`favorite_lunches`, `allergy_rules` dropped Sept 2026) shows the discipline for it.

---

## 5. Reshape 3: Child Profile

### 5.1 Conceptual model

```
Child (clean shape)
  ├── age_band (existing enum)
  ├── appetite_level (NEW enum)
  ├── texture_needs (NEW enum)
  ├── spice_tolerance (NEW enum)
  ├── bag_composition_pattern (NEW dedicated enum — replaces both bag_composition JSONB and bag_composition_pattern text)
  ├── variant_eligible (existing boolean)
  ├── school_policy_notes (existing free text)
  └── (per-child allergens, food prefs, dietary prefs live in their structured tables — already exist)
```

### 5.2 New types

```sql
CREATE TYPE appetite_level AS ENUM ('light', 'normal', 'heavy');
CREATE TYPE texture_needs AS ENUM ('soft', 'mixed', 'normal');
CREATE TYPE spice_tolerance AS ENUM ('mild', 'regular', 'spicy');
CREATE TYPE bag_composition_pattern AS ENUM (
  'main_only',
  'main_plus_snack',
  'main_plus_extra',
  'main_plus_snack_plus_extra'
);
```

### 5.3 Table: `children` (cleaned)

```sql
ALTER TABLE children
  ADD COLUMN appetite_level   appetite_level NOT NULL DEFAULT 'normal',
  ADD COLUMN texture_needs    texture_needs  NOT NULL DEFAULT 'normal',
  ADD COLUMN spice_tolerance  spice_tolerance NOT NULL DEFAULT 'mild',
  -- bag_composition_pattern already exists as text; promote to enum (drop the CHECK)
  ALTER COLUMN bag_composition_pattern TYPE bag_composition_pattern
    USING bag_composition_pattern::bag_composition_pattern,
  ALTER COLUMN bag_composition_pattern SET NOT NULL,
  ALTER COLUMN bag_composition_pattern SET DEFAULT 'main_plus_snack_plus_extra';

-- Phase out the JSONB / encrypted columns after structured tables are the read source:
ALTER TABLE children
  DROP COLUMN bag_composition,           -- replaced by bag_composition_pattern enum
  DROP COLUMN declared_allergens,         -- replaced by child_allergens
  DROP COLUMN cultural_identifiers,       -- not lunch-relevant per-child; lives at household level (different table TBD §6)
  DROP COLUMN dietary_preferences,        -- replaced by dietary_preferences table
  DROP COLUMN allergen_rule_version;      -- version stamps move to allergen_tags vocab rows
```

**Why these additions:**
- `appetite_level`, `texture_needs`, `spice_tolerance` are the variation-driving attributes the family-first model uses to auto-derive `plan_slot_variations` per child. Without them, variations have to be hand-spec'd; with them, Lumi proposes defaults.
- `bag_composition_pattern` becomes the single source of truth — the current dual representation (JSONB booleans + text enum) collapses to one enum column.

**Why the drops:**
- `bag_composition` JSONB: superseded by the enum. Two columns expressing the same thing was an explicit transitional decision (migration `20260907000000`); transition is now complete.
- `declared_allergens` (encrypted): superseded by `child_allergens` (slice 2.5-s1 was explicit about this).
- `cultural_identifiers` (encrypted, per-child): not lunch-relevant at per-child grain in production data (cultural identity is a household trait, not a per-child one). Household-level cultural identity lives elsewhere (§6).
- `dietary_preferences` (encrypted, per-child): superseded by `dietary_preferences` table.
- `allergen_rule_version`: rule versioning belongs on `allergen_tags.rule_class` (where it already lives via `expand_allergen_vocabulary` migration) — child rows don't need a per-row stamp.

### 5.4 Per-child allergen/preference tables

Per the Q1 decision (2026-05-31), the allergen layer consolidates:

- **`child_allergens`** — **DROPPED**. Data migrates 1:1 into `household_allergens` (§6.2) with `child_id` preserved (attribution metadata). The slice 2.5-s1 intent (per-child encrypted allergens with dedupe hash + source enum) is preserved — the table is just renamed and gains a nullable `child_id` to also absorb household-wide rules.
- **`food_preferences`** — KEEP. Per-child OR household-wide via nullable `child_id` (existing pattern).
- **`dietary_preferences`** (table) — KEEP. Closed-vocabulary validated against `dietary_tags`.
- **`household_rules`** — KEEP. Existing slice 2.5-s1 table; clean.

---

## 6. Households (lunch-relevant subset)

The `households` table has accumulated 12+ lunch-relevant columns. Most are infrastructure (encryption DEK, kitchen_map_version) or billing (tier) — those stay. The cleanup focuses on the encrypted preference columns added 2026-09-02.

```sql
ALTER TABLE households
  DROP COLUMN cultural_identifiers,     -- relocated to NEW household_cultural_identifiers table
  DROP COLUMN dietary_preferences,       -- expressed via dietary_preferences table with child_id NULL
  DROP COLUMN declared_allergens;        -- expressed via NEW household_allergens table OR via child_allergens (TBD §9)
```

### 6.1 Table: `household_cultural_identifiers` (NEW)

```sql
CREATE TABLE household_cultural_identifiers (
  household_id  uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  cultural_tag  text NOT NULL,                                  -- vocabulary: cultural_tags
  enforcement   enforcement_level NOT NULL DEFAULT 'default',
  source        text NOT NULL CHECK (source IN (
    'onboarding_declared', 'memory_promoted', 'parent_edited', 'backfill_migration'
  )),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (household_id, cultural_tag)
);
```

**Why structured:** mirrors the pattern of `child_allergens`, `dietary_preferences` (table), `household_rules` — vocab-validated, idempotent, source-tracked. Replaces the encrypted-JSON `households.cultural_identifiers` text column.

### 6.2 `household_allergens` (NEW — replaces both `child_allergens` and `households.declared_allergens`)

Per Q1 decision (2026-05-31), this single table absorbs both the per-child medical allergens (formerly `child_allergens`) and the household-wide kitchen rules (formerly `households.declared_allergens` encrypted column). The `child_id` is nullable — NULL by default means "household-wide" (the common case); a non-NULL value attributes the allergen to a specific kid for the parent's reference.

```sql
CREATE TABLE household_allergens (
  id              uuid PRIMARY KEY,
  household_id    uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  child_id        uuid REFERENCES children(id) ON DELETE CASCADE,
                  -- NULL = household-wide rule (default).
                  -- NOT NULL = parent attributed to a specific kid (metadata only;
                  --           guardrail behavior is the same — kitchen avoids).
  allergen        text NOT NULL,                       -- AES-256-GCM ciphertext under household DEK
  allergen_hash   text NOT NULL,                       -- SHA-256(lower(trim(plaintext))) for idempotency
  source          text NOT NULL CHECK (source IN (
    'onboarding_declared', 'child_medical', 'memory_promoted',
    'parent_edited', 'backfill_migration'
  )),
  reason          text CHECK (reason IS NULL OR char_length(reason) <= 200),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  -- COALESCE-sentinel pattern matches food_preferences and dietary_preferences:
  -- treats NULL child_id as a distinct value so household-wide vs per-kid rows
  -- with the same allergen don't violate uniqueness.
  UNIQUE (
    household_id,
    COALESCE(child_id, '00000000-0000-0000-0000-000000000000'::uuid),
    allergen_hash
  )
);

CREATE INDEX household_allergens_household_idx ON household_allergens (household_id);
CREATE INDEX household_allergens_child_idx ON household_allergens (child_id) WHERE child_id IS NOT NULL;
```

**Guardrail evaluation pattern:** `SELECT allergen FROM household_allergens WHERE household_id = ?` — a single indexed query returns everything the household avoids. The `child_id` attribution is metadata for the parent's reference; the guardrail treats every row as a kitchen-shared constraint.

**Edge case — child-specific allergen the household doesn't extend to everyone:** rare and dangerous (cross-contamination risk), but supported via `plan_slot_variations.removals` (per-kid only, no household-wide implication). The allergen layer is for household-shared constraints; per-kid-only exceptions live on the variation.

---

## 7. Brief State Projection

The Brief is a Tier B projection (architecture §1.5). Its job is fast read. The current shape has accumulated 6+ added columns — most are JSONB payloads that the composer writes. The canonical model treats `brief_state` as a true denormalized cache:

```sql
CREATE TABLE brief_state (
  household_id    uuid PRIMARY KEY REFERENCES households(id) ON DELETE CASCADE,
  plan_id         uuid REFERENCES plans(id) ON DELETE SET NULL,

  moment_headline text NOT NULL DEFAULT '',
  lumi_note       text NOT NULL DEFAULT '',
  memory_prose    text NOT NULL DEFAULT '',

  -- Single denormalized payload. Validated by BriefStatePayloadSchema in contracts.
  -- Contains: per-day tile summaries, cleared_allergies, scaffolding_diff snapshot,
  -- plan_state mirror (for routes that read brief only).
  payload         jsonb NOT NULL DEFAULT '{}',

  generated_at    timestamptz NOT NULL DEFAULT now(),
  plan_revision   int NOT NULL DEFAULT 0,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
```

**Changes from current:**
- `plan_state`, `plan_state_set_at`, `plan_state_message` **moved to plans** (where they belong). The projection mirrors them inside `payload` for read convenience.
- `plan_tile_summaries`, `cleared_allergies`, `scaffolding_diff` **consolidated into single `payload` jsonb** with a Zod-validated shape (`BriefStatePayloadSchema`).
- Result: 4 jsonb columns collapse to 1.

**Why single payload:**
- The composer writes them together. The Brief route reads them together. Splitting added no query advantage — it just gave the impression of structure where Zod was the actual validator anyway.
- Future projection adds (e.g., variation summaries) extend `BriefStatePayloadSchema` rather than triggering another `ALTER TABLE`.

---

## 8. Adjacent Tables (kept; some clarified)

### 8.1 `day_overrides` → `plan_day_context` (renamed, semantics clarified)

The current `day_overrides` table mixes two jobs: pausing (sick_day, bag_suspended) AND context hints (sport_practice, field_trip). In the canonical model, **pausing moves to `plan_days.paused_at` / `plan_slots.paused_at` / `plan_slot_variations.paused_at`** (§3). What remains is the contextual hint job — useful for the planner to know about field trips, sport days, etc.

```sql
ALTER TABLE day_overrides RENAME TO plan_day_context;

-- Update the enum to drop pause-overlapping values:
-- KEEP: field_trip, half_day, post_dentist, early_release, sport_practice, test_day
-- DROP: bag_suspended (now plan_days.paused_at), sick_day (now plan_days.paused_reason)
```

### 8.2 `variant_proposals` (kept; FK target re-pointed per Q4 decision)

Per the Phase 3 follow-up on Q4 (2026-05-31), `variant_proposals` is repointed to **per-child grain** to match Story 3.27's existing per-child `variant_eligible` gate and the family-first variation primitive:

```sql
-- Add the missing plan_id FK (was implicit-only).
ALTER TABLE variant_proposals
  ADD CONSTRAINT variant_proposals_plan_id_fk
  FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE CASCADE;

-- Repoint plan_item_id → plan_slot_variation_id (per-child grain).
-- Hard cutover: drop the old column entirely (no production data per Menon 2026-05-31).
ALTER TABLE variant_proposals
  RENAME COLUMN plan_item_id TO plan_slot_variation_id;
ALTER TABLE variant_proposals
  DROP CONSTRAINT IF EXISTS variant_proposals_plan_item_id_fkey;
ALTER TABLE variant_proposals
  ADD CONSTRAINT variant_proposals_plan_slot_variation_id_fk
  FOREIGN KEY (plan_slot_variation_id) REFERENCES plan_slot_variations(id) ON DELETE CASCADE;
```

**Semantic meaning:** *"Lumi suggests Aarav specifically tries the baked variant of Tuesday's pita"* — not *"Lumi suggests Tuesday's pita variant for everyone."* Matches the per-child grain of the variation primitive and the per-child `variant_eligible` flag. Up to N variant proposals per slot (one per kid); the UI surfaces variants on the kid's variation chip, not on the whole slot.

Hard-cutover note (per Menon 2026-05-31): we're pre-beta with nothing in production. No backfill-from-old-column needed; existing variant_proposals rows can be truncated and Lumi will re-emit them on the next plan-commit pass.

### 8.3 Unchanged tables

These are already clean per Phase 1's bolt-on density analysis:
- `child_allergens`, `food_preferences`, `dietary_preferences` (table), `household_rules` — the 2.5-s1 wave; well-structured.
- Vocabulary tables (`allergen_tags`, `dietary_tags`, `cultural_tags`, `cuisine_tags`).
- `recipe_comments` + `recipe_comments_public` view.
- `household_recipe_usage`.
- `curated_baseline_items`.

---

## 9. Query Pattern Walkthroughs

How key workflows look against the canonical model. These are the same workflows from Phase 1 §5, re-walked.

### 9.1 Brief composition (BriefStateComposer.refresh)

```
1. Read current cleared plan:
     SELECT FROM plans WHERE household_id = ? AND week_of = ?
       AND guardrail_cleared_at IS NOT NULL;
2. Parallel: read main_assignments, plan_days, plan_slots, plan_slot_variations, children, suppression, ratings:
     SELECT FROM plan_main_assignments WHERE plan_id = ?;
     SELECT FROM plan_days WHERE plan_id = ?;
     SELECT FROM plan_slots WHERE plan_day_id IN (...);
     SELECT FROM plan_slot_variations WHERE plan_slot_id IN (...);
     SELECT FROM children WHERE household_id = ?;
     (suppression, ratings as today)
3. Compose payload in-memory.
4. UPSERT brief_state with plan_revision guard.
```

5 → 5 queries — same complexity as today. The reads are bounded and indexed (plan_id IDX on each child table). Composer logic gets simpler: no JSONB-blob manipulation; just tree assembly from typed rows.

### 9.2 Day card read (Wall Card render)

```
Option A (projection): SELECT FROM brief_state WHERE household_id = ?
  → 1 query, deep payload object. (Default for the Brief route.)

Option B (live join, used by the swap re-eval path):
  SELECT
    pd.day, pd.paused_at, pd.paused_reason,
    pma.sequence AS main_sequence, mr.canonical_name AS main_dish, mr.id AS main_recipe_id,
    ps.slot_kind, ps.extra_kind,
    psv.child_id, psv.portion_size, psv.texture, psv.spice_level, psv.add_ons, psv.removals, psv.notes
  FROM plan_days pd
  LEFT JOIN plan_slots ps ON ps.plan_day_id = pd.id
  LEFT JOIN plan_main_assignments pma ON ps.main_assignment_id = pma.id
  LEFT JOIN recipes mr ON pma.recipe_id = mr.id
  LEFT JOIN plan_slot_variations psv ON psv.plan_slot_id = ps.id
  WHERE pd.plan_id = ? AND pd.day = ?;
```

Indexed joins: pd → ps (plan_day_id), ps → pma (main_assignment_id), ps → recipes (recipe_id), ps → psv (plan_slot_id). All sub-queries hit indexes.

### 9.3 Drag-drop day swap (Tuesday ↔ Friday)

```sql
BEGIN;
  UPDATE plan_days SET day = 'friday', updated_at = now()
    WHERE id = ?;  -- (Tuesday id)
  UPDATE plan_days SET day = 'tuesday', updated_at = now()
    WHERE id = ?;  -- (Friday id)
  -- Re-run guardrail per plan_day (each day's plan_slots evaluated)
  -- Re-project brief_state
COMMIT;
```

Two single-row updates, one txn. Brief projection refreshes once. Compare to today: per-child per-slot multi-row updates across `plan_items`.

### 9.4 Variation edit (parent changes Aarav's portion from small to regular)

```sql
UPDATE plan_slot_variations
  SET portion_size = 'regular', updated_at = now()
  WHERE id = ?;
-- Re-project brief_state (1 query each side; variation change doesn't re-eval guardrail unless ingredients change)
```

One row update. No guardrail re-eval needed for portion-only changes.

### 9.5 Pause day (Wednesday is a snow day)

```sql
UPDATE plan_days
  SET paused_at = now(), paused_reason = 'snow_day', updated_at = now()
  WHERE id = ?;
```

One row update. The brief projection mirrors `paused_at` on the tile; Lunch Link delivery reads `paused_at` to skip.

### 9.6 Pause for one kid (Aarav is sick today, Mira+Kabir eat normally)

```sql
UPDATE plan_slot_variations
  SET paused_at = now(), updated_at = now()
  WHERE child_id = ?
    AND plan_slot_id IN (
      SELECT id FROM plan_slots WHERE plan_day_id = ?
    );
```

Affects all of Aarav's variations on this day (one per slot). Mira and Kabir's variations unchanged. This trivially expresses what the archived spec deferred as "partial-child pause."

### 9.7 Swap this Main (parent says "make something else today")

```
1. Lumi proposes 2-3 alternatives via conversation handoff.
2. Parent picks one. Suppose they pick a different recipe.
3. UPDATE plan_main_assignments
     SET recipe_id = <new>, updated_at = now()
     WHERE id = ? AND plan_id = ?;
4. Re-run guardrail for affected plan_slots.
5. Re-project brief_state.
```

ONE row update affects every `plan_day` that referenced this `main_assignment` (because they all FK to it). The 2-day-repeat preservation is automatic — both Mon and Tue change together if they share the assignment.

---

## 10. Decisions (resolved 2026-05-31)

The five open questions from the draft have been walked through and resolved. Each decision is in force unless Phase 3 pressure-test surfaces a reason to revisit.

### 10.1 ✅ Allergen consolidation — single `household_allergens` table

**Decision:** drop both the existing `child_allergens` table AND the `households.declared_allergens` encrypted column. Replace with a single `household_allergens` table with **nullable `child_id`** (NULL = household-wide, default; non-NULL = parent-attributed to a specific kid as metadata).

**Why:** in practice a child's medical allergen and the kitchen-shared constraint co-occur 95%+ of the time — modeling them as separate tables creates a semantic distinction the data layer doesn't need. The nullable `child_id` matches the existing pattern on `food_preferences` and `dietary_preferences` (table). Guardrail evaluation collapses to one query per household. See §6.2 for the schema.

**Edge case:** rare "child-specific only, no household-wide" allergens live on `plan_slot_variations.removals`, not on the allergen table.

### 10.2 ✅ Brief state payload — single `payload jsonb` column

**Decision:** consolidate the four existing JSONB columns on `brief_state` (`plan_tile_summaries`, `cleared_allergies`, `scaffolding_diff`, and the `plan_state_*` set) into a single `payload jsonb` column with a Zod-validated `BriefStatePayloadSchema`. `plan_state*` move to `plans` (where they belong); the projection mirrors them inside `payload` for read convenience.

**Why:** the composer writes all four together; the Brief route reads them together. Splitting added no query advantage — Zod was the actual validator anyway. Reporting/audit queries that need to inspect plan state should hit `plans` (the source), not the projection.

**Discipline going forward:** "the projection mirrors source; ops queries hit the source tables." If we later discover a real query pattern that needs a top-level column, promote that field out of `payload` via a single `ALTER TABLE` + generated column at that point — don't pre-pay for unknown needs.

### 10.3 ✅ `plan_main_assignments.sequence` ceiling — `BETWEEN 1 AND 6`

**Decision:** `CHECK (sequence >= 1 AND sequence <= 6)`. Also: restore Saturday to the `weekday` enum (matches the existing `SCHOOL_DAYS` list in `brief-state.composer.ts`).

**Why:** one Main per day is the natural ceiling. 6 accommodates Mon-Sat school weeks (orthodox / Israel / some private US schools). 3 (family-first default) would be too tight — `[[three-main-weekly-pattern]]` says "default not hard rule," so the DB shouldn't enforce 3. Sequence numbers can become sparse after parent overrides; that's documented behavior, not a bug.

### 10.4 ✅ Snack SKU fold — pure drop, no SKU metadata preserved

**Decision:** `snack_skus` table dropped entirely after migration. 10 seed rows become `recipes` with `applicable_slots=['snack']`. Allergen booleans translate to `allergen_flags` array (only true ones); compatibility booleans translate to `cultural_tags` / `dietary_flags`. **No `brand` or `is_packaged_item` columns added to recipes** — household-level systems don't need a packaged-goods catalog discipline.

**Why:** as Menon framed it: "when adding snacks that are not prepared, the household already knows which ones are good for their kids." Trust the parent; don't reinvent a SKU database. See §4.4 for migration details.

### 10.5 ✅ Migration sequencing — A → (B + D parallel) → C → E

**Decision:** five phases shipping in this order, with B and D parallel-safe alongside A. **Revised post-Phase 3 (2026-05-31)** per Amelia's hard-cutover endorsement and the Q1/Q2/Q3 code-investigation findings (zero composer coalescing → defer; zero shared test factories → C-0 added to Phase A; all plan tests mocked → no real-DB migration sequencing concern).

| Phase | Scope | Stories | Sprints |
|---|---|---|---|
| **A. Recipe & Snack canonical + test factories + Saturday audit** | (1) recipes.finish_time_minutes; recipe_steps table + backfill from instructions; instructions column drop; snack_skus → recipes migration; snack_skus table drop. (2) **C-0 promoted in: introduce shared `apps/api/test/factories/` module** with `buildPlan`, `buildPlanMainAssignment`, `buildPlanDay`, `buildPlanSlot`, `buildPlanSlotVariation`; refactor existing inline `buildPlanRow` / `buildPlanItem` helpers to the shared module. (3) **Saturday-support audit**: grep + fix `deriveWeekId`, `dayOfWeek` comparisons, cron schedules, planner prompt day examples, calendar exports, client-side 5-column grid renderers. | **3** | 1 |
| **B. Child Profile & Allergen consolidation** *(parallel-safe with A)* | children gains appetite/texture/spice enums; bag_composition_pattern promoted to enum; encrypted children columns dropped; household_allergens table created + backfilled from child_allergens + households.declared_allergens; child_allergens dropped; households.cultural_identifiers/dietary_preferences/declared_allergens dropped; household_cultural_identifiers table created + backfilled | 2 | 1 |
| **D. Brief State Cleanup** *(parallel-safe with A and B)* | brief_state consolidates 4 jsonb columns into payload; plan_state columns move to plans; BriefStatePayloadSchema defined | 1 | 0.5 |
| **C. Plan Structure — atomic cutover** *(depends on A and B)* | (1) **Atomic cutover PR**: new types (weekday with Saturday, slot_kind, extra_kind, portion_size, texture_level, spice_level, pause_reason); plan_main_assignments + plan_days + plan_slots + plan_slot_variations created; commit_plan() RPC rewritten (per §3.9 pattern); BriefStateComposer.refresh() rewritten to read from new tree; PlanComposeOutputSchema / orchestrator tool-call interface / planner prompt examples rewritten to tree shape; plan_items dropped; plans.week_id dropped; plan-adjustment.service + day-overrides.service + variant-proposal.service migrated to new tables. (2) **Cleanup story** for any test breakage shaken out of the cutover. **No shadow mode, no dormant `commit_plan_v2()`** per hard-cutover decision — pre-beta, we cut over directly behind a maintenance window. | **2** | 1.5 |
| **E. Adjacent table cleanup** *(final pass)* | day_overrides → plan_day_context rename; pause-overlapping enum values dropped; recipes.instructions removed if still present | 1 | 0.5 |

**Total:** ~9 stories across 5 phases. **~3 sprints if A/B/D ship parallel** (saved roughly a sprint vs the v2-draft estimate by dropping shadow-mode scaffolding). Fits the 5-month pre-Oct-1 window with comfortable iteration room.

**Risk note:** Phase C is still the largest single migration window — it rewrites `commit_plan()` RPC, `BriefStateComposer.refresh()`, AND the orchestrator tool-call interface + planner prompt examples in one atomic PR. **Pre-beta hard cutover is the right strategy** (per Menon 2026-05-31): nothing in production, no backwards-compat scaffolding required. Rollback path = revert PR + restore from backup if needed.

**Test breakage profile (Phase 3 Q3 finding):** all plan tests use Vitest mocks, not real Postgres. TypeScript compiler catches the breakage cascade at build time — no CI migration-sequencing concerns. The Story C-0 factory introduction in Phase A pre-pays the refactor work; cutover just changes factory internals.

### 10.6 Deferred runtime optimizations (post-beta)

Phase 3 surfaced one runtime optimization that is orthogonal to the canonical model and deliberately deferred past Oct 1 beta launch:

**Composer coalescing window.** Today's `BriefStateComposer.refresh()` is invoked synchronously from each call site (7 sites: lunch-link.routes, day-overrides.service ×2, plans.service ×4) with `await`. No debounce, no coalescing. During a Lumi conversation turn that fires `plan.updated` + `memory.updated` + `thread.turn` within ~200ms, the composer rebuilds three times back-to-back (24 reads where 8 would do).

**Why deferred:** the canonical model works without coalescing. The 8 reads per refresh are bounded and indexed. Pre-beta load is far below the threshold where the redundancy hurts. Post-beta, if metrics show composer-refresh thrashing under SSE-tier load, add a 200ms debounce window inside the composer — a small change that absorbs bursts into a single refresh.

**Logged in:** `_bmad-output/implementation-artifacts/deferred-work.md` (to be added during Phase 4 story breakdown). Not on Phase A–E roadmap.

### 10.7 Orchestrator + planner prompt rewrite scope (Phase C explicit)

Phase 3 surfaced an under-articulated risk: the contracts package change from flat `PlanComposeOutputSchema` to a tree shape **cascades into the orchestrator tool-call interface and the planner prompt examples**. Both agents flagged this.

This is **explicit Phase C scope**, not a separate story:

- **Orchestrator tool schema** — the `plan.compose` tool's I/O schema changes from `{ days: [{ items: [{ child_id, slot, ingredients, recipe_id?, item_sku_id? }] }] }` to a nested tree: `{ main_assignments: [{ sequence, recipe_id }], days: [{ day, paused_at?, slots: [{ slot_kind, main_assignment_ref?, recipe_id?, variations: [{ child_id, portion_size, ... }] }] }] }`.
- **Planner prompt examples** — the JSON shape examples embedded in the planner system prompt MUST be rewritten to the new tree. This is **prompt-engineering risk, not just code**. The LLM has to learn the new structure via examples; a bad example shape produces malformed output that fails the new CHECK constraints.
- **Prompt rollback plan** — if the new prompt produces bad output rates >5% after cutover, restore prompt-only (no code changes) to a known-good version while the example library is refined.

Phase C's atomic cutover PR includes: schema + RPC + composer + **orchestrator tool schema + planner prompt examples** — all in one merge. Test coverage for the prompt rewrite: synthetic plan_compose runs against the new schema with stubbed LLM responses to validate the tool I/O before the live planner sees it.

---

## 11. What This Buys Us

Five concrete wins from the canonical model:

1. **Family-first features fit naturally.** Variation, main-group, slot kind, optional-extra kind, dual time budget all have first-class homes. No bolt-ons required for the Wall Card to ship.

2. **Storage shape consistency.** Every concept has one home: allergens in `child_allergens`, dietary in `dietary_preferences`, cultural in `household_cultural_identifiers`, bag in `bag_composition_pattern` enum, week in `week_of`, slot in `slot_kind` enum, instructions in `recipe_steps`.

3. **Query patterns simplify.** Pause becomes one update at one of three levels; swap-this-Main becomes one update on `plan_main_assignments` affecting all days that share the M-group; variation edit is one row.

4. **Guardrail correctness improves.** Mode-tagged steps + structured ingredients + canonical recipes make the guardrail's job O(1) per row rather than O(scan jsonb blob).

5. **The bolt-on pattern stops.** Future features extend canonical tables OR add new entities — not "ALTER TABLE plan_items ADD COLUMN feature_xyz."

---

## 12. What This Will Cost

Honest about the work to get there (revised post-Phase 3):

- **~9 migration stories** across 5 phases (per §10.5). Each phase bounded; A/B/D parallel-safe.
- **Three service-layer rewrites in Phase C's atomic cutover PR:** `commit_plan()` RPC (per §3.9 discipline), `BriefStateComposer.refresh()`, and the orchestrator `plan.compose` tool interface + planner prompt examples (per §10.7).
- **Two contract-package updates:** plan + recipe Zod schemas materially change (plus the new `BriefStatePayloadSchema` and tree-shape `PlanComposeOutputSchema`).
- **One UX impact:** Wall Card mock data shape can stay (already matches the new model conceptually); production wiring uses the canonical schemas.
- **Test-suite update:** Story C-0 in Phase A pre-pays the factory refactor (~5 helpers in `apps/api/test/factories/`). All plan tests are Vitest mocks (Phase 3 Q3 finding), so TypeScript compiler catches the cascade at build time — no CI migration-sequencing concerns. Mechanical, not risky.

**Risk profile:** the migrations are bounded. **~3 sprints total** if A/B/D ship parallel with available capacity (saved ~1 sprint vs draft estimate by dropping shadow-mode scaffolding per the hard-cutover decision). Comfortably fits the 5-month pre-Oct-1-launch window.

**Two specific risks to track during Phase C:**
1. **Planner prompt regression** — the LLM has to learn the new tree shape via examples (§10.7). Have a prompt-only rollback path; instrument bad-output rate post-cutover.
2. **commit_plan() lock contention** — load-test gate per §3.9 (100 concurrent calls) catches surprises before the live planner sees them.

---

## 13. Next Step — Phase 4

**Phase 3 closed 2026-05-31** with Winston + Amelia review, all five revisions applied to this document, Q1/Q2/Q3 code investigations complete, hard-cutover scope endorsed by Menon.

**Phase 4** — decompose the ~9 stories (per §10.5) into Epic-3-ready solutioning artifacts. For each story:
- Pre-conditions and dependency chain
- Acceptance criteria (story-grain, not implementation-grain)
- Migration SQL outline (DDL + backfill DML + drop sequence)
- Code-touch inventory (files + functions + tests)
- Test-suite delta (which factories, which Vitest mocks, which assertions)
- Rollback path

Output: a Phase 4 doc per phase (Phase A migration plan, Phase B migration plan, etc.) or a single consolidated plan — TBD when Phase 4 starts. Either way, the artifacts should let Epic-3 solutioning pick stories up and break them into Slice files without re-deriving design rationale.
