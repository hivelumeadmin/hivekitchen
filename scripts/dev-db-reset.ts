#!/usr/bin/env tsx
/**
 * Dev-only database + Redis reset.
 *
 * Truncates all household/session data so you can start fresh. Preserves:
 *   - auth.users (Supabase identity — credentials remain valid)
 *   - Static vocabulary tables: allergen_tags, dietary_tags, cuisine_tags,
 *     cultural_tags, cultural_calendar_observances,
 *     curated_baseline_items
 *
 * Also clears Redis: explicitly removes the KitchenMap projection cache
 * entries (`kitchen-map:*`), then flushes the DB to drop the BullMQ job
 * queues that now reference deleted households.
 *
 * After reset: clear the browser's httpOnly sb-* cookie (DevTools → Application
 * → Cookies), then log in normally — the next login recreates public.users and
 * a fresh household, routing you straight through onboarding from scratch.
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
    // Missing TABLE (migration not applied / legacy name already dropped) —
    // skip gracefully. PostgREST reports this as PGRST205 / "schema cache".
    // A missing COLUMN (42703) is NOT skipped — that means the wrong
    // idColumn was passed and the table would go uncleared, so fail loudly.
    if (error.code === 'PGRST205' || error.message.includes('schema cache')) {
      log(`skipped ${table} (table not found — migration may not be applied yet)`);
      return;
    }
    die(`delete from ${table} failed: ${error.message}`);
  }
  log(`cleared ${table}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

interface RedisClient {
  connect(): Promise<void>;
  scan(cursor: string, ...args: string[]): Promise<[string, string[]]>;
  unlink(...keys: string[]): Promise<number>;
  flushdb(): Promise<void>;
  quit(): Promise<void>;
}

async function clearRedis(redisUrl: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  const redis = new Redis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  }) as RedisClient;
  await redis.connect();

  // Explicitly remove the KitchenMap projection cache. Key shape:
  //   `kitchen-map:{householdId}:schema-{v}:v{mapVersion}`
  // (see kitchen-map.service.ts). SCAN + UNLINK so the count is logged and
  // the intent is legible, rather than relying on the blanket flush below.
  let cursor = '0';
  let removed = 0;
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', 'kitchen-map:*', 'COUNT', '200');
    cursor = next;
    if (keys.length > 0) removed += await redis.unlink(...keys);
  } while (cursor !== '0');
  log(`removed ${removed} kitchen-map cache ${removed === 1 ? 'entry' : 'entries'}`);

  // Flush the rest of the DB — BullMQ job queues now reference deleted
  // households, so a fresh slate is the correct dev-reset behavior.
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

  // Deepest-leaf tables first (nothing else FKs into them), root last.
  // Legacy names (dropped/renamed by the canonical data-model migration) are
  // kept in the list so an un-migrated DB still resets cleanly — clearTable
  // skips any table that no longer exists.

  // ── Plan tree (canonical, post 3-DM-C) + legacy names ──
  await clearTable(supabase, 'variant_proposals');
  await clearTable(supabase, 'plan_slot_variations');
  await clearTable(supabase, 'plan_slots');
  await clearTable(supabase, 'plan_days');
  await clearTable(supabase, 'plan_main_assignments');
  await clearTable(supabase, 'extra_removal_signals');
  await clearTable(supabase, 'plan_day_context');
  await clearTable(supabase, 'guardrail_decisions');
  await clearTable(supabase, 'day_assignments', 'household_id'); // composite PK — no id column
  await clearTable(supabase, 'day_overrides'); // legacy — renamed to plan_day_context
  await clearTable(supabase, 'plan_items'); // legacy — replaced by plan_slots tree
  await clearTable(supabase, 'plans');

  // ── Recipe / catalog ──
  await clearTable(supabase, 'recipe_comments');
  await clearTable(supabase, 'recipe_steps');
  await clearTable(supabase, 'household_recipe_usage', 'household_id');
  await clearTable(supabase, 'snack_skus');
  await clearTable(supabase, 'recipes');

  // ── Brief + memory + heart notes ──
  await clearTable(supabase, 'brief_state', 'household_id');
  await clearTable(supabase, 'memory_provenance');
  await clearTable(supabase, 'memory_nodes');
  await clearTable(supabase, 'heart_notes');

  // ── Child / household profile satellites ──
  await clearTable(supabase, 'child_lunch_requests');
  await clearTable(supabase, 'child_preferences');
  await clearTable(supabase, 'household_allergens');
  await clearTable(supabase, 'household_cultural_identifiers', 'household_id'); // composite PK — no id column
  await clearTable(supabase, 'food_preferences');
  await clearTable(supabase, 'dietary_preferences');
  await clearTable(supabase, 'household_rules');
  await clearTable(supabase, 'child_allergens'); // legacy — folded into household_allergens
  await clearTable(supabase, 'favorite_lunches'); // legacy — folded into recipes
  await clearTable(supabase, 'allergy_rules'); // legacy — dropped
  await clearTable(supabase, 'cultural_priors');
  await clearTable(supabase, 'school_policies');
  await clearTable(supabase, 'onboarding_moment_state', 'household_id');
  await clearTable(supabase, 'extra_library');

  // ── Lunch link ──
  await clearTable(supabase, 'lunch_link_sessions');

  // ── Voice ──
  await clearTable(supabase, 'voice_transcripts');
  await clearTable(supabase, 'voice_sessions');
  await clearTable(supabase, 'voice_usage', 'user_id'); // composite PK — no id column

  // ── Consent / compliance / audit ──
  await clearTable(supabase, 'vpc_consents');
  await clearTable(supabase, 'processor_deletion_log');
  await clearTable(supabase, 'audit_log');

  // ── Threads ──
  await clearTable(supabase, 'thread_turns');
  await clearTable(supabase, 'threads');

  // ── Invites + session tokens ──
  await clearTable(supabase, 'invites');
  await clearTable(supabase, 'refresh_tokens');

  // ── Children (child-referencing satellites cleared above) ──
  await clearTable(supabase, 'children');

  // Null current_household_id first to drop the FK before deleting households.
  const { error: nullErr } = await supabase
    .from('users')
    .update({ current_household_id: null })
    .not('id', 'is', null);
  if (nullErr) die(`nulling users.current_household_id failed: ${nullErr.message}`);

  await clearTable(supabase, 'households');

  // Delete public.users so the next login is treated as a first login:
  // auth.users is untouched (credentials still valid), but findUserByAuthId
  // returns null → createHouseholdAndUser runs cleanly → fresh onboarding.
  // Without this step login throws "Session invalid" because the row exists
  // with current_household_id = null but no household to attach to.
  await clearTable(supabase, 'users');

  // Clear Redis: explicit kitchen-map cache removal, then flush BullMQ queues
  await clearRedis(redisUrl);
  log('Redis cleared (kitchen-map cache removed + BullMQ queues flushed)');

  log('Done. Clear the browser sb-* cookie then log in — fresh onboarding will start.');
}

main().catch((err: unknown) => {
  process.stderr.write(`[dev-db-reset] ${String(err)}\n`);
  process.exitCode = 1;
});
