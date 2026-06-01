# Story 3-DM-B1: Child profile attributes + bag_composition_pattern enum promotion

Status: planned

## Story

As Epic 3 data-model solutioning,
We want to add variation-driving attributes (`appetite_level`, `texture_needs`, `spice_tolerance`) to children AND consolidate `bag_composition` (JSONB) and `bag_composition_pattern` (text-with-CHECK) into a single proper `bag_composition_pattern` enum column,
So that Lumi can auto-derive `plan_slot_variations` per child from profile attributes AND the duplicate-representation-of-bag-composition pattern retires cleanly.

## Acceptance Criteria

1. Three new enums exist:
   - `appetite_level` = `('light', 'normal', 'heavy')`
   - `texture_needs` = `('soft', 'mixed', 'normal')`
   - `spice_tolerance` = `('mild', 'regular', 'spicy')`
2. `bag_composition_pattern` enum exists with canonical values; the existing `children.bag_composition_pattern text` column is promoted to this enum type.
3. `children` table gains:
   - `appetite_level appetite_level NOT NULL DEFAULT 'normal'`
   - `texture_needs texture_needs NOT NULL DEFAULT 'normal'`
   - `spice_tolerance spice_tolerance NOT NULL DEFAULT 'mild'` (safe default per family-first principle)
4. `children.bag_composition_pattern` is NOT NULL DEFAULT `'main_plus_snack_plus_extra'` (was nullable text-with-CHECK).
5. Drops:
   - `children.bag_composition` (jsonb) — superseded by enum
   - `children.allergen_rule_version` — versioning moves to `allergen_tags.rule_class`
   - `children_bag_main_true` CHECK constraint (no longer applicable)
   - `children_bag_composition_pattern_valid` CHECK constraint (replaced by enum)
6. `ChildrenRepository` updated:
   - `CHILD_COLUMNS` includes the three new enum columns
   - Old `bag_composition` read/write removed
7. `ChildSchema` in contracts extended with new enum fields; `bag_composition` jsonb removed.

## Dependencies & Context

**Design references:**
- Authoritative: canonical `§5` (Reshape 3: Child Profile)
- Breakdown: phase-4 doc Story B1
- Project context: `[[onboarding-builds-kitchen-map]]` — onboarding captures structured per-child data

**Story dependencies:** none — parallel-safe with B2 (same-day deploy preferred).

**Downstream blockers:** C1 (plan_slot_variations are auto-derived from these attributes per Lumi's planner).

**Key invariants:**
- [[family-first-main-then-variations]] — variations are per-child adjustments to a shared Main; these new columns are how Lumi proposes defaults
- Default `spice_tolerance = 'mild'` is the safe choice (parent must opt in to spicier; no kid gets accidentally over-spiced)

## Tasks / Subtasks

### Task 1 — Enum creation

- [ ] Create `supabase/migrations/<timestamp>_child_profile_attrs.sql`
- [ ] `CREATE TYPE appetite_level AS ENUM ('light', 'normal', 'heavy');`
- [ ] `CREATE TYPE texture_needs AS ENUM ('soft', 'mixed', 'normal');`
- [ ] `CREATE TYPE spice_tolerance AS ENUM ('mild', 'regular', 'spicy');`
- [ ] `CREATE TYPE bag_composition_pattern AS ENUM ('main_only', 'main_plus_snack', 'main_plus_extra', 'main_plus_snack_plus_extra');`

### Task 2 — Children column additions

- [ ] `ALTER TABLE children ADD COLUMN appetite_level appetite_level NOT NULL DEFAULT 'normal', ADD COLUMN texture_needs texture_needs NOT NULL DEFAULT 'normal', ADD COLUMN spice_tolerance spice_tolerance NOT NULL DEFAULT 'mild';`

### Task 3 — Promote bag_composition_pattern to enum

- [ ] `ALTER TABLE children DROP CONSTRAINT children_bag_composition_pattern_valid;`
- [ ] `ALTER TABLE children ALTER COLUMN bag_composition_pattern TYPE bag_composition_pattern USING bag_composition_pattern::bag_composition_pattern;`
- [ ] `ALTER TABLE children ALTER COLUMN bag_composition_pattern SET NOT NULL;`
- [ ] `ALTER TABLE children ALTER COLUMN bag_composition_pattern SET DEFAULT 'main_plus_snack_plus_extra';`

### Task 4 — Drop superseded columns

- [ ] `ALTER TABLE children DROP CONSTRAINT children_bag_main_true;`
- [ ] `ALTER TABLE children DROP COLUMN bag_composition;`
- [ ] `ALTER TABLE children DROP COLUMN allergen_rule_version;`

### Task 5 — Repository + contract updates

- [ ] `apps/api/src/modules/children/children.repository.ts`:
  - Update `CHILD_COLUMNS` constant to include new enum columns + remove dropped ones
  - Update `DecryptedChildRow` type if needed
  - Update INSERT path to populate new columns from contract values
- [ ] `packages/contracts/src/children.ts`:
  - `ChildSchema` gains enum fields with their zod enums
  - `bag_composition` jsonb shape removed
  - `bag_composition_pattern` typed as enum (no longer text + manual validator)
- [ ] `packages/types/src/index.ts`: types regenerate cleanly

### Task 6 — Onboarding moment audit

- [ ] Check onboarding moments (slices 2.5-s1 through 2.5-s11) for any place that captures appetite/texture/spice — if found, route to new columns
- [ ] If no moment captures these today, flag as follow-up Epic 3 onboarding story (don't block B1 on UX work)

## Test Plan

- `children.repository.test.ts` updates:
  - Expect 3 new enum columns in CHILD_COLUMNS
  - Insert path tests assert default values when overrides not provided
  - Old `bag_composition` mock-shape removed
- `children.service.test.ts` updates:
  - Pass new enum fields through the onboarding write path
- Use `buildChild` factory from A3 (if A3 lands first; otherwise inline)
- Estimated: ~8-10 test changes

## Rollback

Revert PR. Down migration restores `bag_composition` jsonb (default `{"main":true,"snack":true,"extra":true}`) and `allergen_rule_version` (default `'v1'`); drops new enum columns. The `bag_composition_pattern` reverts to text-with-CHECK.

Pre-beta hard cutover: backup `children` table; values for new enum columns lost on rollback (default to 'normal'/'normal'/'mild' on re-apply).
