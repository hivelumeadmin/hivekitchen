#!/usr/bin/env tsx
/**
 * Dev-only database + Redis reset.
 *
 * Truncates all household/session data so you can start fresh. Preserves:
 *   - users + refresh_tokens (auth identity survives; browser stays logged in)
 *   - Static vocabulary tables: allergen_tags, dietary_tags, cuisine_tags,
 *     cultural_tags, cultural_calendar_observances,
 *     curated_baseline_items
 *
 * Also flushes Redis (removes stale kitchen-map cache + BullMQ job queues).
 *
 * After reset the user lands on the onboarding flow because
 * users.current_household_id is nulled. To also see the login screen, clear
 * the httpOnly refresh-token cookie from browser DevTools → Application →
 * Cookies.
 *
 * Hard gates:
 *   1. NODE_ENV must be 'development'
 *   2. Pass --confirm flag explicitly
 *
 * Invocation:
 *   pnpm db:reset
 *   npx tsx scripts/dev-db-reset.ts --confirm
 *
 * Environment:
 *   SUPABASE_URL              — required
 *   SUPABASE_SERVICE_ROLE_KEY — required
 *   REDIS_URL                 — required
 *   NODE_ENV                  — must be 'development'
 */
import process from 'node:process';
import { createRequire } from 'node:module';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// ioredis lives in apps/api — not hoisted to the workspace root
const _require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const RedisLib = _require('../apps/api/node_modules/ioredis') as any;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
const Redis = RedisLib.default ?? RedisLib;

// ─── Safety gates ────────────────────────────────────────────────────────────

const nodeEnv = process.env['NODE_ENV'] ?? 'development';
if (nodeEnv !== 'development') {
  process.stderr.write(`[dev-db-reset] Refused: NODE_ENV=${nodeEnv}. Only runs in development.\n`);
  process.exit(1);
}

if (!process.argv.includes('--confirm')) {
  process.stderr.write(
    '[dev-db-reset] Refused: pass --confirm to proceed.\n' +
      '  This will delete ALL household/session data. Users are preserved.\n',
  );
  process.exit(1);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.log(`[dev-db-reset] ${msg}`);
}

function die(msg: string): never {
  process.stderr.write(`[dev-db-reset] FATAL: ${msg}\n`);
  throw new Error(msg);
}

async function clearTable(
  supabase: SupabaseClient,
  table: string,
  idColumn = 'id',
): Promise<void> {
  const { error } = await supabase.from(table).delete().not(idColumn, 'is', null);
  if (error) {
    // Table doesn't exist yet (migration not applied) — skip gracefully
    if (error.message.includes('schema cache') || error.message.includes('does not exist')) {
      log(`skipped ${table} (table not found — migration may not be applied yet)`);
      return;
    }
    die(`delete from ${table} failed: ${error.message}`);
  }
  log(`cleared ${table}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function flushRedis(redisUrl: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  const redis = new Redis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  }) as { connect(): Promise<void>; flushdb(): Promise<void>; quit(): Promise<void> };
  await redis.connect();
  await redis.flushdb();
  await redis.quit();
}

async function main(): Promise<void> {
  const url = process.env['SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  const redisUrl = process.env['REDIS_URL'];
  if (!url || !key) die('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  if (!redisUrl) die('REDIS_URL is required');

  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  log('Starting dev reset — users and vocabulary tables will be preserved.');

  // Deepest-leaf tables first (nothing else FKs into them)
  await clearTable(supabase, 'variant_proposals');
  await clearTable(supabase, 'extra_removal_signals');
  await clearTable(supabase, 'plan_day_context');
  await clearTable(supabase, 'guardrail_decisions');
  await clearTable(supabase, 'plan_items');
  await clearTable(supabase, 'plans');
  await clearTable(supabase, 'household_recipe_usage', 'household_id');
  await clearTable(supabase, 'recipe_comments');
  await clearTable(supabase, 'recipes');
  await clearTable(supabase, 'brief_state', 'household_id');
  await clearTable(supabase, 'memory_provenance');
  await clearTable(supabase, 'memory_nodes');
  await clearTable(supabase, 'heart_notes');
  await clearTable(supabase, 'child_allergens');
  await clearTable(supabase, 'food_preferences');
  await clearTable(supabase, 'dietary_preferences');
  await clearTable(supabase, 'household_rules');
  await clearTable(supabase, 'favorite_lunches');
  await clearTable(supabase, 'cultural_priors');
  await clearTable(supabase, 'school_policies');
  await clearTable(supabase, 'onboarding_moment_state', 'household_id');
  await clearTable(supabase, 'extra_library');
  await clearTable(supabase, 'lunch_link_sessions');
  await clearTable(supabase, 'allergy_rules');
  await clearTable(supabase, 'vpc_consents');
  await clearTable(supabase, 'audit_log');
  await clearTable(supabase, 'thread_turns');
  await clearTable(supabase, 'voice_sessions');
  await clearTable(supabase, 'threads');
  await clearTable(supabase, 'invites');
  await clearTable(supabase, 'children');

  // Null users.current_household_id before deleting households to avoid FK violation
  const { error: nullErr } = await supabase
    .from('users')
    .update({ current_household_id: null })
    .not('id', 'is', null);
  if (nullErr) die(`nulling users.current_household_id failed: ${nullErr.message}`);
  log('nulled users.current_household_id');

  await clearTable(supabase, 'households');

  // Flush Redis: removes stale kitchen-map cache entries and BullMQ job queues
  await flushRedis(redisUrl);
  log('flushed Redis (kitchen-map cache + BullMQ queues cleared)');

  log('Done. Vocabulary tables and users untouched.');
  log('Tip: to also see the login screen, clear the refresh-token cookie in browser DevTools → Application → Cookies.');
}

main().catch((err: unknown) => {
  process.stderr.write(`[dev-db-reset] ${String(err)}\n`);
  process.exitCode = 1;
});
