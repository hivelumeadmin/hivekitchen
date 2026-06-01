#!/usr/bin/env tsx
/**
 * Story 3-DM-A1 — one-shot backfill from recipes.instructions to recipe_steps.
 *
 * For each recipe with a non-null instructions jsonb value, insert one row
 * per step into recipe_steps with sequence = 1-based ordinal and mode = 'prep'
 * (the conservative default; Lumi re-tags steps with the real mode on next
 * recipe-agent fetch — story 3-31 owns the mode-tagging emission going
 * forward).
 *
 * Idempotent: recipes that already have recipe_steps rows are skipped, so
 * re-running the script is safe.
 *
 * Run BEFORE applying 20261005000100_drop_recipes_instructions.sql — that
 * migration's verification gate aborts if any recipes.instructions row has no
 * corresponding recipe_steps.
 *
 * Invocation:
 *   pnpm --filter @hivekitchen/api exec tsx scripts/backfill-recipe-steps.ts
 *
 * Environment:
 *   SUPABASE_URL                — required
 *   SUPABASE_SERVICE_ROLE_KEY   — required
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface BackfillSummary {
  recipes_scanned: number;
  recipes_skipped_existing_steps: number;
  recipes_skipped_null_instructions: number;
  recipes_migrated: number;
  steps_inserted: number;
  parse_failures: number;
  insert_failures: number;
}

export interface BackfillDeps {
  client: SupabaseClient;
  pageSize?: number;
  logger?: { error: (obj: Record<string, unknown>, msg: string) => void };
}

interface RecipeRow {
  id: string;
  instructions: unknown;
}

/**
 * Normalise an instructions jsonb value into a list of step text strings.
 * Accepts:
 *   - null                          → []
 *   - string                        → [string]   (legacy single-blob shape)
 *   - array of strings              → array
 *   - array of objects with .text   → mapped to .text values
 * Returns [] for anything that doesn't fit (parse_failures incremented by caller).
 */
export function extractStepTexts(raw: unknown): string[] {
  if (raw === null || raw === undefined) return [];
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    return trimmed.length > 0 ? [trimmed] : [];
  }
  if (!Array.isArray(raw)) return [];

  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry === 'string') {
      const trimmed = entry.trim();
      if (trimmed.length > 0) out.push(trimmed);
    } else if (entry !== null && typeof entry === 'object' && 'text' in entry) {
      const textVal = (entry as { text: unknown }).text;
      if (typeof textVal === 'string') {
        const trimmed = textVal.trim();
        if (trimmed.length > 0) out.push(trimmed);
      }
    }
  }
  return out;
}

export async function runBackfill(deps: BackfillDeps): Promise<BackfillSummary> {
  const pageSize = deps.pageSize ?? 200;
  const logger = deps.logger ?? {
    // eslint-disable-next-line no-console
    error: (obj, msg) => console.error('[backfill-recipe-steps]', msg, obj),
  };
  const summary: BackfillSummary = {
    recipes_scanned: 0,
    recipes_skipped_existing_steps: 0,
    recipes_skipped_null_instructions: 0,
    recipes_migrated: 0,
    steps_inserted: 0,
    parse_failures: 0,
    insert_failures: 0,
  };

  let offset = 0;
  for (;;) {
    const { data, error } = await deps.client
      .from('recipes')
      .select('id, instructions')
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    const page = (data ?? []) as RecipeRow[];
    if (page.length === 0) break;

    for (const row of page) {
      summary.recipes_scanned += 1;

      if (row.instructions === null || row.instructions === undefined) {
        summary.recipes_skipped_null_instructions += 1;
        continue;
      }

      // Skip recipes that already have steps — idempotent re-run.
      const existing = await deps.client
        .from('recipe_steps')
        .select('id', { count: 'exact', head: true })
        .eq('recipe_id', row.id)
        .limit(1);
      if (existing.error) throw existing.error;
      if ((existing.count ?? 0) > 0) {
        summary.recipes_skipped_existing_steps += 1;
        continue;
      }

      const texts = extractStepTexts(row.instructions);
      if (texts.length === 0) {
        summary.parse_failures += 1;
        logger.error(
          { module: 'backfill-recipe-steps', recipe_id: row.id, instructions: row.instructions },
          'recipes.instructions present but no steps extractable — manual review required',
        );
        continue;
      }

      // Multi-row insert. mode='prep' is the conservative default — the next
      // recipe-agent fetch (story 3-31) re-emits with the real mode tags.
      // text values exceeding 600 chars are truncated; pre-beta data volume
      // makes this an acceptable lossy convergence.
      const insertRows = texts.map((text, idx) => ({
        recipe_id: row.id,
        sequence: idx + 1,
        mode: 'prep' as const,
        text: text.slice(0, 600),
      }));
      const insertResult = await deps.client.from('recipe_steps').insert(insertRows);
      if (insertResult.error !== null) {
        summary.insert_failures += 1;
        logger.error(
          {
            module: 'backfill-recipe-steps',
            recipe_id: row.id,
            error: insertResult.error.message,
          },
          'recipe_steps INSERT failed — manual review required',
        );
        continue;
      }
      summary.recipes_migrated += 1;
      summary.steps_inserted += insertRows.length;
    }

    if (page.length < pageSize) break;
    offset += pageSize;
  }

  return summary;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url === undefined || serviceKey === undefined) {
    // eslint-disable-next-line no-console
    console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
    process.exit(1);
  }
  const client = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const summary = await runBackfill({ client });
  // eslint-disable-next-line no-console
  console.log('[backfill-recipe-steps] summary:', JSON.stringify(summary, null, 2));

  if (summary.parse_failures > 0 || summary.insert_failures > 0) {
    process.exit(1);
  }
}

// Run when executed directly (tsx scripts/backfill-recipe-steps.ts).
// Skip when imported (tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[backfill-recipe-steps] fatal:', err);
    process.exit(1);
  });
}
