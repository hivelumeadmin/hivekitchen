import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Story 15-s7 — static invariant checks over the polymorphic-cutover migration.
//
// This repo has no Postgres test harness (no pg-mem / testcontainers / PGlite;
// nothing loads supabase/migrations), the same disclosed gap 15-s5 and 15-s6
// shipped with. The commit_plan() body and the four new triggers therefore
// cannot be EXECUTED here. What can be executed is the one ordering fact the
// whole cutover balances on: inside commit_plan(), the recommit wipe must
// delete plan_days BEFORE plan_main_assignments, or the new
// plan_main_assignments_restrict_delete_if_slotted trigger raises on every
// recommit of an existing plan. These assertions fail loudly if that order is
// ever flipped back — they are not a substitute for running the SQL.

const MIGRATION = readFileSync(
  fileURLToPath(
    new URL(
      '../../../../../supabase/migrations/20261037000000_plan_slots_polymorphic_item_reference.sql',
      import.meta.url,
    ),
  ),
  'utf8',
);

// Header prose intentionally names the pattern Decision D2 rejects, so
// statement-level assertions must not read the comments as code.
const MIGRATION_SQL = MIGRATION.split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n');

describe('20261037000000 commit_plan() delete order', () => {
  it('deletes plan_days before plan_main_assignments', () => {
    const daysIdx = MIGRATION_SQL.indexOf('DELETE FROM plan_days');
    const assnIdx = MIGRATION_SQL.indexOf('DELETE FROM plan_main_assignments');

    expect(daysIdx).toBeGreaterThan(-1);
    expect(assnIdx).toBeGreaterThan(-1);
    expect(daysIdx).toBeLessThan(assnIdx);
  });

  it('has exactly one recommit wipe of each parent table', () => {
    expect(MIGRATION_SQL.match(/DELETE FROM plan_days/g)).toHaveLength(1);
    expect(MIGRATION_SQL.match(/DELETE FROM plan_main_assignments/g)).toHaveLength(1);
  });
});

describe('20261037000000 schema cutover shape', () => {
  it('drops all three legacy item columns', () => {
    for (const column of ['main_assignment_id', 'recipe_id', 'snack_sku_id']) {
      expect(MIGRATION_SQL).toContain(`DROP COLUMN IF EXISTS ${column}`);
    }
  });

  it('constrains both polymorphic columns NOT NULL', () => {
    expect(MIGRATION_SQL).toMatch(/ALTER COLUMN item_type\s+SET NOT NULL/);
    expect(MIGRATION_SQL).toMatch(/ALTER COLUMN item_id\s+SET NOT NULL/);
  });

  it('installs the existence-validation trigger and all three delete guards', () => {
    expect(MIGRATION_SQL).toContain('CREATE TRIGGER plan_slots_validate_item_reference');
    expect(MIGRATION_SQL).toContain('CREATE TRIGGER recipes_restrict_delete_if_slotted');
    expect(MIGRATION_SQL).toContain('CREATE TRIGGER snack_skus_restrict_delete_if_slotted');
    expect(MIGRATION_SQL).toContain('CREATE TRIGGER plan_main_assignments_restrict_delete_if_slotted');
  });

  it('validates item references without dynamic SQL (Decision D2)', () => {
    expect(MIGRATION_SQL).toContain('validate_plan_slot_item_reference');
    expect(MIGRATION_SQL).not.toMatch(/EXECUTE\s+format\(/);
  });

  it('carries the extra_kind presence invariant forward as its own constraint', () => {
    expect(MIGRATION_SQL).toContain('plan_slots_extra_kind_presence');
  });

  it('raises a specific error if the backfill cannot resolve item_type, instead of relying on the bare NOT NULL error', () => {
    expect(MIGRATION_SQL).toMatch(/RAISE EXCEPTION 'plan_slots\.%.*item_type'/);
  });

  it('guards the new CHECK constraints with DROP CONSTRAINT IF EXISTS so the migration can be safely re-run', () => {
    for (const constraint of ['plan_slots_item_type_matches_kind', 'plan_slots_extra_kind_presence']) {
      expect(MIGRATION_SQL).toContain(`DROP CONSTRAINT IF EXISTS ${constraint}`);
    }
  });

  it('scopes the snack_sku_id resolution branch to slot_kind = snack, not a bare presence check', () => {
    expect(MIGRATION_SQL).toContain(
      "ELSIF v_slot_kind = 'snack' AND NULLIF(v_slot->>'snack_sku_id','') IS NOT NULL THEN",
    );
  });

  it('keeps commit_plan() on its existing 10-argument signature', () => {
    const args = [
      'p_plan_id',
      'p_household_id',
      'p_week_of',
      'p_revision',
      'p_generated_at',
      'p_guardrail_cleared_at',
      'p_guardrail_version',
      'p_prompt_version',
      'p_main_assignments',
      'p_days',
    ];
    for (const arg of args) {
      expect(MIGRATION_SQL).toContain(arg);
    }
    expect(MIGRATION_SQL).toContain('CREATE OR REPLACE FUNCTION commit_plan(');
  });
});
