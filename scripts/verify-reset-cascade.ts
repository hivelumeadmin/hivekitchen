#!/usr/bin/env tsx
/**
 * Dev-only, READ-ONLY verification of dev-db-reset's coverage.
 *
 * `scripts/dev-db-reset.ts` clears household data by naming each table
 * explicitly. Epic 15 added five tables that are NOT in that list
 * (`signals`, `child_extra_rules`, `family_language_terms`, `calendar_terms`,
 * `calendar_exceptions`); they are expected to disappear via FK cascade when
 * `children` / `households` are deleted. That expectation has never been
 * exercised — the tables were empty when Epic 15 landed, so a cascade that
 * silently does nothing would look identical to one that works.
 *
 * This script makes the difference visible. Each table is tagged with HOW it
 * is supposed to be cleared, so a leak points straight at the cause:
 *   - `explicit` — named in dev-db-reset.ts. A leak means the delete failed.
 *   - `cascade`  — NOT named. A leak means the FK is missing, or is not
 *                  ON DELETE CASCADE, and dev-db-reset.ts needs the table
 *                  added to its list.
 *
 * Two modes:
 *
 *   (no flag)        Report row counts. Run this AFTER completing onboarding
 *                    to confirm the cascade-cleared tables actually populate —
 *                    a table that is empty here proves nothing when it is
 *                    empty again after a reset.
 *
 *   --expect-empty   Gate. Run this AFTER `pnpm db:reset`. Exits non-zero if
 *                    any household-scoped table still holds rows, or if any
 *                    preserved vocabulary table was wrongly emptied. Both
 *                    directions matter: a reset that nukes the vocabulary is
 *                    as broken as one that leaks household rows.
 *
 * Invocation:
 *   pnpm db:verify-reset
 *   pnpm db:verify-reset -- --expect-empty
 *
 * Environment:
 *   SUPABASE_URL              — required
 *   SUPABASE_SERVICE_ROLE_KEY — required
 */
import process from 'node:process';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

type ClearedBy = 'explicit' | 'cascade';

interface Group {
  label: string;
  tables: Array<[table: string, clearedBy: ClearedBy]>;
}

// Mirrors dev-db-reset.ts's grouping so the two files read side by side.
// `cascade` entries are the ones dev-db-reset.ts does NOT name.
const HOUSEHOLD_SCOPED: Group[] = [
  {
    label: 'Plan tree',
    tables: [
      ['variant_proposals', 'explicit'],
      ['plan_slot_variations', 'explicit'],
      ['plan_slots', 'explicit'],
      ['plan_days', 'explicit'],
      ['plan_main_assignments', 'explicit'],
      ['extra_removal_signals', 'explicit'],
      ['plan_day_context', 'explicit'],
      ['guardrail_decisions', 'explicit'],
      ['day_assignments', 'explicit'],
      ['plans', 'explicit'],
    ],
  },
  {
    label: 'Recipe / catalog',
    tables: [
      ['recipe_comments', 'explicit'],
      ['recipe_steps', 'explicit'],
      ['household_recipe_usage', 'explicit'],
      ['snack_skus', 'explicit'],
      ['recipes', 'explicit'],
    ],
  },
  {
    label: 'Brief + memory',
    tables: [
      ['brief_state', 'explicit'],
      ['memory_provenance', 'explicit'],
      ['memory_nodes', 'explicit'],
      ['heart_notes', 'explicit'],
    ],
  },
  {
    label: 'Child / household satellites',
    tables: [
      ['child_lunch_requests', 'explicit'],
      ['child_preferences', 'explicit'],
      ['household_allergens', 'explicit'],
      ['household_cultural_identifiers', 'explicit'],
      ['food_preferences', 'explicit'],
      ['dietary_preferences', 'explicit'],
      ['household_rules', 'explicit'],
      ['cultural_priors', 'explicit'],
      ['school_policies', 'explicit'],
      ['onboarding_moment_state', 'explicit'],
      ['extra_library', 'explicit'],
    ],
  },
  {
    label: 'Epic 15 — NOT named in dev-db-reset.ts',
    tables: [
      ['signals', 'cascade'],
      ['child_extra_rules', 'cascade'],
      ['family_language_terms', 'cascade'],
      ['calendar_terms', 'cascade'],
      ['calendar_exceptions', 'cascade'],
    ],
  },
  { label: 'Lunch link', tables: [['lunch_link_sessions', 'explicit']] },
  {
    label: 'Voice',
    tables: [
      ['voice_transcripts', 'explicit'],
      ['voice_sessions', 'explicit'],
      ['voice_usage', 'explicit'],
    ],
  },
  {
    label: 'Consent / audit',
    tables: [
      ['vpc_consents', 'explicit'],
      ['processor_deletion_log', 'explicit'],
      ['audit_log', 'explicit'],
    ],
  },
  {
    label: 'Threads',
    tables: [
      ['thread_turns', 'explicit'],
      ['threads', 'explicit'],
    ],
  },
  {
    label: 'Invites + tokens',
    tables: [
      ['invites', 'explicit'],
      ['refresh_tokens', 'explicit'],
    ],
  },
  {
    label: 'Roots',
    tables: [
      ['children', 'explicit'],
      ['households', 'explicit'],
      ['users', 'explicit'],
    ],
  },
];

// dev-db-reset.ts preserves these. Emptying them is its own kind of failure.
const PRESERVED = [
  'allergen_tags',
  'dietary_tags',
  'cuisine_tags',
  'cultural_tags',
  'cultural_calendar_observances',
  'curated_baseline_items',
];

const MISSING = -1;

/** Row count, or MISSING when the table does not exist (migration not applied). */
async function countRows(supabase: SupabaseClient, table: string): Promise<number> {
  const { count, error } = await supabase.from(table).select('*', { count: 'exact', head: true });
  if (error) {
    if (error.code === 'PGRST205' || error.message.includes('schema cache')) return MISSING;
    throw new Error(`count ${table} failed: ${error.message}`);
  }
  return count ?? 0;
}

function render(table: string, clearedBy: ClearedBy, rows: number): string {
  const shown = rows === MISSING ? 'absent' : String(rows);
  const flag = clearedBy === 'cascade' ? '  <- cascade' : '';
  return `    ${table.padEnd(32)}${shown.padStart(7)}${flag}`;
}

async function main(): Promise<void> {
  const url = process.env['SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) {
    process.stderr.write('[verify-reset] SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required\n');
    process.exit(1);
  }
  const expectEmpty = process.argv.includes('--expect-empty');
  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const leaked: Array<[string, ClearedBy, number]> = [];
  const populated: string[] = [];

  for (const group of HOUSEHOLD_SCOPED) {
    // eslint-disable-next-line no-console
    console.log(`\n  ${group.label}`);
    for (const [table, clearedBy] of group.tables) {
      const rows = await countRows(supabase, table);
      // eslint-disable-next-line no-console
      console.log(render(table, clearedBy, rows));
      if (rows > 0) {
        leaked.push([table, clearedBy, rows]);
        if (clearedBy === 'cascade') populated.push(table);
      }
    }
  }

  // eslint-disable-next-line no-console
  console.log('\n  Preserved vocabulary (must stay non-empty)');
  const wiped: string[] = [];
  for (const table of PRESERVED) {
    const rows = await countRows(supabase, table);
    // eslint-disable-next-line no-console
    console.log(render(table, 'explicit', rows));
    if (rows === 0) wiped.push(table);
  }

  if (!expectEmpty) {
    // eslint-disable-next-line no-console
    console.log(
      populated.length > 0
        ? `\n  ${populated.length} cascade-cleared table(s) hold rows: ${populated.join(', ')}.` +
            '\n  These are now meaningful to re-check after a reset — run with --expect-empty.'
        : '\n  No cascade-cleared table holds rows yet. Complete onboarding first,' +
            '\n  otherwise a post-reset empty result proves nothing.',
    );
    return;
  }

  // ── Gate mode ──
  const cascadeLeaks = leaked.filter(([, by]) => by === 'cascade');
  if (leaked.length === 0 && wiped.length === 0) {
    // eslint-disable-next-line no-console
    console.log('\n  PASS — every household-scoped table is empty, vocabulary intact.');
    return;
  }

  process.stderr.write('\n  FAIL\n');
  for (const [table, by, rows] of leaked) {
    process.stderr.write(`    ${table} still holds ${rows} row(s) [${by}]\n`);
  }
  for (const table of wiped) {
    process.stderr.write(`    ${table} was emptied but should be preserved\n`);
  }
  if (cascadeLeaks.length > 0) {
    process.stderr.write(
      `\n  ${cascadeLeaks.length} leak(s) are in cascade-cleared tables. The FK is missing or is\n` +
        '  not ON DELETE CASCADE. Fix: add the table to dev-db-reset.ts explicitly.\n',
    );
  }
  process.exitCode = 1;
}

main().catch((err: unknown) => {
  process.stderr.write(`[verify-reset] ${String(err)}\n`);
  process.exitCode = 1;
});
