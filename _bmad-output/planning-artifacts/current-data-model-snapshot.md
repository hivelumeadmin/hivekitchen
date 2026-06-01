---
status: phase-1-output
date: 2026-05-29
author: Menon (with Sally facilitating)
phase: 1
scope: |
  Honest read-only inventory of the lunch-planning data layer as of 2026-05-29.
  Documents every relevant table, column, accumulated bolt-on, coexistence pattern,
  query pattern, and storage shape inconsistency. NO design judgments yet — those
  belong in Phase 2.
project_name: HiveKitchen
inputs:
  - supabase/migrations/* (109 files, 2026-05-01 → 2026-10-03)
  - apps/api/src/modules/plans/plans.repository.ts
  - apps/api/src/modules/plans/brief-state.composer.ts
  - apps/api/src/modules/children/children.repository.ts
  - apps/api/src/modules/recipe/recipes.repository.ts
  - packages/contracts/src/plan.ts
  - packages/contracts/src/recipe.ts
  - packages/contracts/src/children.ts
---

# Current Data Model Snapshot — Lunch-Planning Layer

**Purpose:** an honest read-only inventory. No design judgments yet; those belong in Phase 2. The goal here is to know exactly what we have before we design what we want.

**Scope:** the tables and columns that the family-first redesign would touch — directly (plans, plan_items, brief_state, recipes, children, related preference tables) or indirectly (households columns the lunch layer reads, vocabulary tables, day_overrides, variant_proposals, curated baseline).

---

## 1. Core lunch-planning tables

### 1.1 `plans` — one row per (household, week)

**Created** 2026-05-02 (Story 3.5, `20260502110000`).

| Column | Type | Origin | Notes |
|---|---|---|---|
| `id` | uuid PK | initial | gen_random_uuid() |
| `household_id` | uuid FK | initial | households(id) ON DELETE CASCADE |
| `week_id` | uuid | initial | derived from deriveWeekId() SHA-256 hash |
| `revision` | int NOT NULL DEFAULT 1 | initial | bumped on user-visible regenerations |
| `generated_at` | timestamptz NOT NULL | initial | when planner ran |
| `guardrail_cleared_at` | timestamptz NULL | initial | **presentation-bind gate** — UI never sees rows where this IS NULL |
| `guardrail_version` | varchar(32) NULL | initial | which guardrail rules version cleared this |
| `prompt_version` | varchar(32) NOT NULL | initial | which planner prompt version emitted this |
| `created_at` | timestamptz | initial | |
| `updated_at` | timestamptz (trigger) | initial | |
| **`week_of`** | **varchar(10) NULL** | **+ 2026-06-30 (Story 3.13)** | **ISO date string parallel to `week_id` hash; added so regeneration doesn't need to reverse the hash** |

**Constraints:** `UNIQUE (household_id, week_id)` — one active plan per household per week (re-commits use the same `plan_id` via `commit_plan()` RPC).

**Observation:** `week_of` and `week_id` are dual representations of the same concept — one is a hash UUID, the other a human-readable ISO date. The hash was the original choice; the date string was bolted on because the hash couldn't be reversed.

### 1.2 `plan_items` — one row per (plan, child, day, slot)

**Created** 2026-05-02 (Story 3.5).

| Column | Type | Origin | Notes |
|---|---|---|---|
| `id` | uuid PK | initial | |
| `plan_id` | uuid FK | initial | plans(id) ON DELETE CASCADE |
| `child_id` | uuid | initial — **FK added later** | FK added 2026-05-10 (`20260510000600`) because `children` table didn't exist when `plan_items` was created |
| `day` | text NOT NULL | initial | free-text, not enum (composer treats as `'monday'..'saturday'`) |
| `slot` | text NOT NULL | initial | free-text, not enum; values in use: `'main'`, `'snack'`, `'extra'`. Contract validates as `z.string().min(1).max(64)` |
| `recipe_id` | uuid NULL — **FK added later** | initial — **FK added 2026-08-20 (`20260820000200`)** | Before the FK landed, this column carried opaque planner-emitted UUIDs that referenced nothing. The 2026-08 migration NULLed all existing values and added the FK. |
| `item_id` | uuid NULL | initial | unclear current semantic; pre-dates `item_sku_id` |
| **`item_sku_id`** | **uuid NULL** | **+ 2026-08-? (Story 3.20)** | **snack-slot SKU reference; CONFLICTS with `recipe_id` on main slot per `PlanComposeItemSchema.superRefine`** |
| `ingredients` | jsonb NOT NULL DEFAULT `'[]'` | initial | Array of plain strings (NOT structured like recipes.ingredients) |
| **`paused_at`** | **timestamptz NULL** | **+ 2026-06-21 (Story 3.12)** | **NULL = active. Used by Lunch Link delivery to skip.** |
| **`replaced_by_plan_id`** | **uuid NULL FK self-ish** | **+ 2026-06-30 (Story 3.13)** | **Archive semantics — old items marked `replaced_by_plan_id = <plan_id>` (self-reference: "superseded when this plan was last updated"). Two partial indexes: archived rows vs current rows.** |
| `created_at` | timestamptz | initial | |
| `updated_at` | timestamptz (trigger) | initial | |

**Indexes:**
- `plan_items_plan_child_idx` on `(plan_id, child_id)` (initial)
- `plan_items_recipe_id_idx` PARTIAL `WHERE recipe_id IS NOT NULL` (+ 2026-08-20)
- `idx_plan_items_plan_id_current` PARTIAL `WHERE replaced_by_plan_id IS NULL` (+ 2026-06-30)
- `idx_plan_items_replaced_by_plan_id` PARTIAL `WHERE replaced_by_plan_id IS NOT NULL` (+ 2026-06-30)

**Observation — the bolt-on accumulation:** plan_items now carries **8 columns added after initial creation** (child_id FK, recipe_id FK, item_id, item_sku_id, paused_at, replaced_by_plan_id, plus the slot/recipe_id semantic refinements). `slot` is free-text but logic depends on it being one of three values. `recipe_id` and `item_sku_id` are mutually exclusive depending on slot — a constraint enforced only at the Zod layer, not in the database. `ingredients` is plain string array; method steps live nowhere on this table.

### 1.3 `brief_state` — denormalized projection, one row per household

**Created** 2026-05-02 (Story 3.6, `20260502120000`).

| Column | Type | Origin | Notes |
|---|---|---|---|
| `household_id` | uuid PK FK | initial | households(id) ON DELETE CASCADE |
| `moment_headline` | text NOT NULL DEFAULT `''` | initial | |
| `lumi_note` | text NOT NULL DEFAULT `''` | initial | |
| `memory_prose` | text NOT NULL DEFAULT `''` | initial | |
| `plan_tile_summaries` | jsonb NOT NULL DEFAULT `'[]'` | initial | Array of per-day tile summaries; structure validated by Zod only |
| `generated_at` | timestamptz NOT NULL DEFAULT now() | initial | |
| `plan_revision` | int NOT NULL DEFAULT 0 | initial | optimistic concurrency guard against stale composer writes |
| `updated_at` | timestamptz (trigger) | initial | |
| **`cleared_allergies`** | **jsonb NOT NULL DEFAULT `'[]'`** | **+ 2026-05-04 (Story 3.10)** | **Array of (child_id, allergen) entries the guardrail cleared for current plan** |
| **`scaffolding_diff`** | **jsonb NULL** | **+ 2026-05-04 (Story 3.11)** | **Per-slot mutation summary for QuietDiff; NULL ≠ '[]' (null = "no mutations since last view")** |
| **`plan_id`** | **uuid NULL FK** | **+ 2026-06-21 (Story 3.12)** | **Exposed so client can PATCH plan items without separate lookup** |
| **`plan_state`** | **plan_state_enum NULL** | **+ 2026-09-20 (Story 3.29)** | **'degraded' \| 'hard_failed' \| NULL** |
| **`plan_state_set_at`** | **timestamptz NULL** | **+ 2026-09-20** | |
| **`plan_state_message`** | **text NULL CHECK ≤500** | **+ 2026-09-20** | |

**Observation:** brief_state has **6 columns added after initial creation**, all jsonb or plan-related metadata. Three of the additions are JSONB blobs with shape validated only at the Zod layer (`cleared_allergies`, `scaffolding_diff`, `plan_tile_summaries`). The projection writer is `BriefStateComposer.refresh()`; it reads plan + items + children + suppression + ratings on every call, builds the tile summaries in-memory, and upserts.

### 1.4 `recipes` — canonical catalog

**Created** 2026-08-20 (`20260820000200_create_recipes_and_usage`). Migration note explicitly cites that this closes a gap logged in `deferred-work.md`: "plan_items.recipe_id is a nullable uuid with NO foreign key … There is no `recipes` table to FK to." The migration NULLs all existing `plan_items.recipe_id` values and adds the FK constraint.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `canonical_name` | text NOT NULL | |
| `slug` | text NULL | optional URL-friendly form |
| `ingredients` | jsonb NOT NULL DEFAULT `'[]'` | Array of structured ingredient objects per `RecipeIngredientSchema`: `{ key, modifier, display, quantity, unit, optional, substitutes }` |
| `instructions` | jsonb NULL | **No documented shape.** Migration comment: "nullable: lightweight v1 ok without." |
| `ingredient_keys` | text[] NOT NULL DEFAULT `'{}'` | Denormalized from `ingredients[].key`, base keys only, deduplicated. GIN-indexed. Maintained by `RecipesService` on every write. |
| `primary_ingredient_key` | text NULL | Headline ingredient for leftover matching |
| `allergen_flags` | text[] NOT NULL DEFAULT `'{}'` | Vocabulary: `allergen_tags` table; service-layer validates |
| `dietary_flags` | text[] NOT NULL DEFAULT `'{}'` | Vocabulary: `dietary_tags`; service-layer expands implies-closure |
| `cultural_tags` | text[] NOT NULL DEFAULT `'{}'` | Vocabulary: `cultural_tags` |
| `cuisine_tags` | text[] NOT NULL DEFAULT `'{}'` | Vocabulary: `cuisine_tags`; service-layer auto-fans-out parents |
| `applicable_slots` | text[] NOT NULL DEFAULT `'{main}'` | What slots this recipe is valid for |
| `prep_time_minutes` | int NULL | (no `finish_time_minutes`) |
| `source` | text NOT NULL CHECK IN `('agent_generated','curated','imported')` | |
| `created_by_household_id` | uuid NULL FK | households(id) ON DELETE SET NULL |
| `visibility` | text NOT NULL DEFAULT `'private'` CHECK IN `('private','shared')` | |
| `community_use_count` | int NOT NULL DEFAULT 0 | denormalized aggregate |
| `community_rating_avg` | numeric(3,2) NULL | denormalized aggregate |
| `community_rating_count` | int NOT NULL DEFAULT 0 | denormalized aggregate |
| `is_active` | boolean NOT NULL DEFAULT true | |
| `created_at`, `updated_at` | timestamptz | |

**Indexes:** 5 GIN indexes (`ingredient_keys`, `allergen_flags`, `dietary_flags`, `cultural_tags`, `cuisine_tags`), 1 btree on `primary_ingredient_key` partial, 1 partial on `(visibility, is_active)` for community-pool browse.

**Observation — the recipe shape:** `ingredients` is a well-structured, Zod-validated JSONB array with a precise schema. `instructions` is also JSONB but with **no documented shape** and is nullable. Method steps that the Wall Card's Prep/Finish toggle needs (each step tagged `make-ahead` vs `morning-of`) have no place to live today.

### 1.5 `household_recipe_usage` — per-household engagement signal

**Created** 2026-08-20.

| Column | Type | Notes |
|---|---|---|
| `household_id`, `recipe_id` | uuid (composite PK) | both FKs ON DELETE CASCADE |
| `use_count`, `acceptance_count`, `swap_out_count`, `positive_outcome_count`, `negative_outcome_count` | int NOT NULL DEFAULT 0 | engagement counters |
| `confidence_score` | smallint NOT NULL DEFAULT 50 CHECK 0..100 | derived: `clamp(0, 100, 20*use + 10*pos - 15*neg - 10*swap)` |
| `is_household_favorite` | boolean DEFAULT false | stable signal — gates "use without asking" |
| `is_household_banned` | boolean DEFAULT false | stable signal — permanent exclusion |
| `first_used_at`, `last_used_at`, `last_outcome_at` | timestamptz | |
| **`discover_failed_at`** | **timestamptz NULL** | **+ 2026-09-10 (Slice 2.6-s3)** | **Layer 2 discovery failure marker** |

**Constraints:** `CHECK NOT (is_household_favorite AND is_household_banned)`.

**Triggers:** `bump_kitchen_map_from_recipe_usage` on INSERT/DELETE and on UPDATE only when stable flags flip (not on counter increments — would thrash cache).

### 1.6 `recipe_comments` + `recipe_comments_public` view

Per-recipe community comments + a stripped view for non-owner reads. Includes `author_household_id`, `author_user_id`, `display_handle`, `rating` (1–5), `prose_text`, moderation columns. RLS denies authenticated SELECT on the raw table; the view is the read path.

### 1.7 `curated_baseline_items` — global seed pool (~50 items)

**Created** 2026-09-09 (Slice 2.6-s2). Hand-tagged global reference table — no `household_id`, no FK from `recipes` back. Used at household creation by Stage 0 catalog materialization. Columns include `canonical_name`, the five tag arrays, `applicable_slots`, `notes`, `is_active`. The migration body INSERTs the 50 seed rows directly.

---

## 2. Children + preference layer

### 2.1 `children`

**Created** 2026-05-10 (`20260510000000`).

| Column | Type | Origin | Notes |
|---|---|---|---|
| `id` | uuid PK | initial | |
| `household_id` | uuid FK | initial | households(id) ON DELETE CASCADE |
| `name` | text NOT NULL | initial | |
| `age_band` | text NOT NULL CHECK IN `('toddler','child','preteen','teen')` | initial | |
| `school_policy_notes` | text NULL | initial | free-text; `school_policies` table deferred at the time |
| `declared_allergens` | text NULL (encrypted) | initial | AES-256-GCM envelope-encrypted JSON array |
| `cultural_identifiers` | text NULL (encrypted) | initial | same |
| `dietary_preferences` | text NULL (encrypted) | initial | same |
| `allergen_rule_version` | text NOT NULL DEFAULT `'v1'` | initial | rules-version stamp on the rows |
| **`bag_composition`** | **jsonb NOT NULL DEFAULT `{...}` CHECK main=true** | **+ 2026-05-20 (Story 2.12)** | **Boolean struct `{ main, snack, extra }`; planner-facing source of truth** |
| **`bag_composition_pattern`** | **text NULL CHECK IN (4 enum values)** | **+ 2026-09-07 (Slice 2.5-s8)** | **Parent-stated pattern from Moment 4; COEXISTS with `bag_composition`. Planner derives from booleans when this is NULL.** |
| **`variant_eligible`** | **boolean NOT NULL DEFAULT false** | **+ 2026-09-11 (Story 3.27)** | **Gate for Lumi-proposed preparation variants** |
| `created_at`, `updated_at` | timestamptz | initial | |

**Observation:** children has accumulated **3 added columns post-initial** (bag_composition, bag_composition_pattern, variant_eligible). Two of them describe the same thing (`bag_composition` boolean struct AND `bag_composition_pattern` enum text) and explicitly COEXIST. The encrypted-JSON columns (`declared_allergens`, `cultural_identifiers`, `dietary_preferences`) are being phased out in favor of structured tables (§2.2–§2.4) but the columns remain until backfill completes.

### 2.2 `child_allergens` — structured, per-child, replaces children.declared_allergens

**Created** 2026-09-03 (Slice 2.5-s1).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `household_id`, `child_id` | uuid FKs ON DELETE CASCADE | |
| `allergen` | text NOT NULL | AES-256-GCM ciphertext under household DEK |
| `allergen_hash` | text NOT NULL | SHA-256(lower(trim(plaintext))); dedupe key |
| `source` | text CHECK IN 5 values (onboarding_declared, memory_promoted, vocabulary_inferred, parent_edited, backfill_migration) | |
| `created_at`, `updated_at` | | |

**Constraint:** `UNIQUE (child_id, allergen_hash)` — idempotent.

**Observation:** explicitly designed to replace `children.declared_allergens` long-term; coexists through Epic 2.5. No severity column — allergens are uniformly hard.

### 2.3 `food_preferences` — per-child OR household

**Created** 2026-09-03 (Slice 2.5-s1).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `household_id` | uuid FK | |
| `child_id` | uuid FK NULL | NULL = household-wide |
| `item` | text NOT NULL | AES-256-GCM encrypted; open-vocabulary |
| `item_hash` | text NOT NULL | for idempotency |
| `valence` | text CHECK IN `('loves','likes','neutral','dislikes','refuses')` | |
| `enforcement` | enforcement_level NOT NULL DEFAULT `'soft'` | shared enum |
| `source` | text CHECK IN 5 values | |
| `created_at`, `updated_at` | | |

**Idempotency:** `UNIQUE (household_id, COALESCE(child_id, sentinel-uuid), item_hash)` — NULL-coercion workaround for Postgres treating NULLs as distinct.

### 2.4 `dietary_preferences` (table) — per-child OR household, closed vocab

**Created** 2026-09-03 (Slice 2.5-s1). **Table name COLLIDES with the legacy `households.dietary_preferences` and `children.dietary_preferences` columns by design** (migration comment cites the pattern). Closed vocabulary validated against `dietary_tags` at write time.

| Column | Type | Notes |
|---|---|---|
| `id`, `household_id`, `child_id` | uuid (child_id nullable) | |
| `tag` | text NOT NULL | closed-vocab; no encryption, no hash |
| `enforcement` | enforcement_level DEFAULT `'default'` | |
| `source` | text CHECK IN 4 values | |

### 2.5 `household_rules`

**Created** 2026-09-03 (Slice 2.5-s1).

| Column | Type | Notes |
|---|---|---|
| `id`, `household_id` | uuid | |
| `rule_type` | text CHECK IN 6 values (`no_pork`, `no_alcohol`, `no_beef`, `no_overnight_leftovers`, `no_microwave_at_school`, `custom`) | |
| `custom_label` | text NULL (encrypted) | required iff `rule_type='custom'` |
| `custom_label_hash` | text NULL | for idempotency |
| `enforcement` | enforcement_level DEFAULT `'strong'` | |
| `source` | text CHECK IN 4 values | |

**Constraint:** consistency CHECK linking `rule_type`/`custom_label`/`custom_label_hash`.

---

## 3. Adjacent feature tables

### 3.1 `day_overrides`

**Created** 2026-07-20 (Story 3.19). Per-`(plan_item, child, date)` one-off override with enum `day_override_type` (8 values including `bag_suspended`, `half_day`, `field_trip`, `sick_day`, `post_dentist`, `early_release`, `sport_practice`, `test_day`). Auto-reverts after the day via nightly job or at-read filtering. Confirmed/reverted timestamps gate active state.

### 3.2 `variant_proposals`

**Created** 2026-09-11 (Story 3.27). Lumi-proposed preparation variant tracking. Fields include `plan_item_id` (FK to plan_items), `plan_id` (**NO FK**), `base_recipe_name`, `base_method`, `variant_description`, `variant_method`, `proposed_at`/`confirmed_at`/`rejected_at`, `base_rating`/`variant_rating` (Epic 4 hooks). Active = both timestamps NULL. Gated by `children.variant_eligible`.

### 3.3 Vocabulary tables (`allergen_tags`, `dietary_tags`, `cultural_tags`, `cuisine_tags`)

**Created** 2026-05-14 (`20260514005000_create_vocabulary_tables` — not read in this inventory but referenced everywhere). Lookup vocabulary; `recipes` references them via text array columns + service-layer validation (Postgres can't FK array elements).

### 3.4 `snack_skus`

Referenced by `plan_items.item_sku_id` (Story 3.20). Not read in this inventory.

### 3.5 Other adjacent tables not deeply inventoried

- `extra_rules` (per-child extra-slot rules; Story 2-s? )
- `school_policies` + `school_policies_..._tables` (normalized school-side constraints)
- `cultural_priors` (Story 2.x) + `cultural_calendar_observances` (Story 3.x)
- `memory_nodes` and provenance (memory layer)
- `audit_log` partitioned
- `lunch_link_sessions` + `lunch_link_keys` (child-side surface)
- `heart_notes`

These exist and inform the planner but are not directly altered by the family-first model.

---

## 4. Households columns relevant to the lunch layer

The `households` table has accumulated lunch-relevant columns over time:

| Column | Origin | Purpose |
|---|---|---|
| `encrypted_dek` | + 2026-05-10 | envelope encryption DEK |
| `kitchen_map_version` | + 2026-08-20 | invalidation for Kitchen Map projection (bumped by `household_recipe_usage` trigger on stable flag flips) |
| **`tier`** | **+ 2026-06-20 (Story 12.5)** | `'standard' \| 'premium'` — billing gate |
| `tier_variant` | (earlier) | A/B cohort label (distinct from `tier`) |
| **`cultural_identifiers`** | **+ 2026-09-02 (Slice 2-s27)** | encrypted household-level; coexists with per-child column |
| **`dietary_preferences`** | **+ 2026-09-02** | encrypted household-level; coexists with `dietary_preferences` table AND per-child column |
| **`declared_allergens`** | **+ 2026-09-02** | encrypted household-level; coexists with `child_allergens` table AND per-child column |
| `display_name` | + 2026-09-03 | onboarding addition |
| `stage0_materialized_at` | + 2026-09-09 (Slice 2.6-s2) | catalog Stage 0 completion marker |
| `stage1_completed_at` | + 2026-09-10 (Slice 2.6-s3) | catalog Stage 1 completion marker |
| `cold_start_flag` | + 2026-09-22 (Slice 2.6-s6) | Stage 0 fallback gate |
| `sovereignty_mode` | + 2026-09-20 | (degraded-plan related; tier 1 of Story 3.29) |
| `tile_ghost_timestamp` | + 2026-06-01 | tile UI ghost-state |

**Observation:** households is the second-most-bolt-on-prone table after plan_items.

---

## 5. Query patterns observed in code

From `plans.repository.ts` + `brief-state.composer.ts`:

- **Plans read for presentation** — `findByIdForPresentation`, `findByHouseholdAndWeek`, `findCurrentByHousehold` all filter `guardrail_cleared_at IS NOT NULL`. This is the architecture §3.5 presentation-bind contract at the query layer.
- **Plans read for ops/audit** — `findByIdForOps` bypasses the guardrail filter explicitly.
- **Plan items read** — `findItemsByPlanId` returns only current (non-archived) rows; archive query (Story 3.15 historical view) reads `replaced_by_plan_id IS NOT NULL` rows.
- **Plan item swap** — direct UPDATE by `(plan_id, id)`; single-row mutation.
- **Brief state read** — `findByHousehold(householdId)` — single row PK lookup; the projection is materialized.
- **Brief state write** — `upsert()` with `plan_revision` optimistic concurrency guard against stale composer writes.
- **Composer refresh flow** (BriefStateComposer.refresh):
  1. Read current cleared plan for the week
  2. Parallel read: previous brief, current plan items, children, suppression map, ratings map
  3. Compose tile summaries in-memory (grouped by day)
  4. Upsert with revision guard
- **Recipes** — by id (most common); community-pool browse via GIN indexes on tag arrays; household scope via `household_recipe_usage`.
- **Children** — `findByHouseholdId` is the dominant pattern.

---

## 6. Storage shape inconsistencies

Several places where the same conceptual data is stored differently:

1. **Ingredients** — `recipes.ingredients` is structured (Zod-validated objects); `plan_items.ingredients` is plain text array.
2. **Method/Instructions** — `recipes.instructions` is jsonb-with-no-documented-shape and nullable; `plan_items` carries no method at all. The Wall Card's Prep/Finish mode-tagged step model has no DB home.
3. **Slot semantics** — `plan_items.slot` is `text NOT NULL` (free-form); the contract validates as `z.string().min(1).max(64)`. Logic in the planner + composer + service layer all branch on hard-coded values (`'main'`, `'snack'`, `'extra'`). Not enforced as a DB enum.
4. **Recipe references on plan items** — `plan_items` carries TWO mutually-exclusive references (`recipe_id` and `item_sku_id`) plus a third legacy `item_id`. Mutual exclusion + slot semantics enforced only at the Zod layer (`PlanComposeItemSchema.superRefine`).
5. **Allergens** — three places: `children.declared_allergens` (encrypted text, legacy), `households.declared_allergens` (encrypted text, household-level, added 2026-09-02), `child_allergens` (structured table, current path).
6. **Dietary preferences** — three places: `children.dietary_preferences` (encrypted text, legacy), `households.dietary_preferences` (encrypted text, household-level, added 2026-09-02), `dietary_preferences` table (current path) — and the table name COLLIDES with both column names.
7. **Bag composition** — two places: `children.bag_composition` (JSONB booleans) AND `children.bag_composition_pattern` (text enum). Migration explicitly notes coexistence and that planner derives from booleans when pattern is NULL.
8. **Week identification** — `plans.week_id` (UUID hash) AND `plans.week_of` (ISO date string). Hash was original; date string added because hash couldn't be reversed.

---

## 7. Implicit relationships and missing FKs

- **`variant_proposals.plan_id`** — declared `UUID NOT NULL` but NO FK constraint to `plans(id)`. Implicit relationship; data integrity depends on application discipline.
- **`plan_items.item_id`** — uuid, no FK, unclear current semantic (pre-dates `item_sku_id` introduction; relationship not documented in migration headers).
- **`curated_baseline_items` ↔ `recipes`** — no FK from `recipes.created_by_household_id` back; relationship is "Stage 0 materialization writes curated rows into recipes per household." The migration comment notes "no FK from recipes back to this table because referential history matters even though there's no FK."
- **`recipes.ingredient_keys`** — denormalized text[] maintained by application code. Vocabulary tables (`allergen_tags` etc.) can't be FK'd from text[] elements per Postgres limits; service layer validates.
- **`day_overrides.plan_item_id`** — FK exists but the relationship between `day_overrides` and `paused_at`/`bag_suspended` on `plan_items` is logically overlapping (both can pause a day). Two mechanisms for similar outcomes.

---

## 8. What the family-first frame would need that's missing

Honest observation, not yet design — just naming the gaps the family-first model exposes:

- **No grouping entity** — the 2-day-repeat pattern (M1 Mon+Tue, M2 Wed+Thu) has no DB representation. A "Main group" or "Main base" concept would need to be modeled.
- **No structured method steps** — `recipes.instructions` is jsonb with no documented shape and is nullable. The Prep/Finish mode tag per step (`make-ahead` vs `morning-of`) has no place. Each step's text + mode would need a structured shape.
- **No variation primitive** — per-child differences on a shared Main are not modeled. `plan_items` is flat — one row per child per day per slot. To express "same Main, three Variations" requires either a `family_main_group_id` patch (what I had been proposing — explicitly rejected) or a proper grouping entity.
- **No appetite / texture / spice fields on children** — the model has only `age_band`. Variations driven by child profile need richer attributes.
- **No `finish_time_minutes`** — recipes only have `prep_time_minutes`. The dual budget (Finish ≤15 / Total ≤40) needs both.
- **No optional-extra differentiation** — `slot='extra'` is just a free-text slot; the Optional Extra kinds (drink, sports-add, sweet, etc.) have no enum or modeling.
- **No school-week structure** — `plans` is per-week, but the 5-day-flow (Mon–Fri with the M1/M2/M3 rhythm) is implicit. The plan composer iterates 5 days but the structure isn't first-class.

---

## 9. Migration count by table (bolt-on density)

For the lunch-planning tables specifically:

| Table | Initial migration | Bolt-on migrations since | Total touch-points |
|---|---|---|---|
| `plans` | 1 (2026-05-02) | 1 (`week_of`) | 2 |
| `plan_items` | 1 (2026-05-02) | 6+ (`child_id` FK, `recipe_id` FK, `item_sku_id`, `paused_at`, `replaced_by_plan_id`) | 7+ |
| `brief_state` | 1 (2026-05-02) | 6+ (`cleared_allergies`, `scaffolding_diff`, `plan_id`, `plan_state` + 2 ancillary) | 7+ |
| `children` | 1 (2026-05-10) | 5+ (encrypted columns NOT NULL, `bag_composition`, `bag_composition_pattern`, `variant_eligible`) | 6+ |
| `recipes` | 1 (2026-08-20) | 0 documented (table is younger; less time to accumulate) | 1 |
| `household_recipe_usage` | 1 (2026-08-20) | 1 (`discover_failed_at`) | 2 |
| `households` (lunch-relevant subset) | 1 (initial) | 12+ added columns (encryption, tier, kitchen_map_version, sovereignty, stages, identity, allergen lock helpers, …) | 13+ |
| `child_allergens` | 1 (2026-09-03) | 0 | 1 |
| `food_preferences` | 1 (2026-09-03) | 0 | 1 |
| `dietary_preferences` (table) | 1 (2026-09-03) | 0 | 1 |
| `household_rules` | 1 (2026-09-03) | 0 | 1 |
| `day_overrides` | 1 (2026-07-20) | 0 | 1 |
| `variant_proposals` | 1 (2026-09-11) | 0 | 1 |
| `curated_baseline_items` | 1 (2026-09-09) | 0 | 1 |

**Observation:** the four oldest tables (`plans`, `plan_items`, `brief_state`, `children`, `households`) carry virtually all the accumulated bolt-on weight. Tables created in the 2.5/2.6 wave (Sept 2026) are clean and structured. The newer tables follow disciplined patterns; the older core has not been revisited.

---

## 10. Dropped tables (historical cleanup)

- `favorite_lunches` — DROPPED 2026-09-08 (Slice 2.6-s1, `20260908000200_2_6_s1_drop_favorite_lunches`). Replaced by catalog provenance extensions.
- `allergy_rules` — DROPPED 2026-09-08 (Slice 2.6-s7, `20260908000400_2_6_s7_drop_allergy_rules`).

Both drops are recent and demonstrate that the project HAS pruned legacy tables when better alternatives ship. Encouraging precedent for Phase 2/4 migration planning.

---

## End of Phase 1 — what Phase 2 should resolve

This is the honest inventory. The picture it paints:

- **Five core tables carry the accumulated bolt-on weight** (plan_items, brief_state, children, households, plans). The newer slice tables are cleanly structured.
- **The family-first model has no first-class home for at least 7 concepts**: main-group, per-child variation, structured method steps, child profile attributes (appetite/texture/spice), finish-time budget, optional-extra kinds, school-week rhythm.
- **Coexistence/legacy patterns are real and load-bearing** — three places to look for allergens; three for dietary preferences; two for bag composition; two for week identification.
- **The slot field has lived as free-text for over a year**, with hard-coded logic branches at every layer.
- **`recipes.instructions` is undefined-shape JSONB** — the single biggest "we haven't figured out method yet" debt.

Phase 2 will sketch the canonical model addressing these. The aim is to enter beta with a foundation where the family-first features fit naturally — not patched on top.
