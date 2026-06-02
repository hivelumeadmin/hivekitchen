#!/usr/bin/env tsx
/**
 * Seeds the minimal load-test fixture (one user, one household, one child).
 * Uses one of the already-curated recipes for the load test (the database
 * already carries 50+ shared recipes from earlier seed data).
 *
 * Idempotent on the stable UUIDs below. Cleanup: pnpm db:reset --confirm.
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env['SUPABASE_URL'];
const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
if (!url || !key) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  process.exit(1);
}
const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

const USER_ID = '22222222-2222-4222-8222-222222222222';
const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const CHILD_ID = '44444444-4444-4444-8444-444444444444';

async function main(): Promise<void> {
  console.log('[seed-load-test] Picking a recipe to use…');
  const rcp = await supabase
    .from('recipes')
    .select('id, canonical_name')
    .eq('visibility', 'shared')
    .limit(1)
    .maybeSingle();
  if (rcp.error || !rcp.data) {
    console.error('no shared recipe available:', rcp.error?.message);
    process.exit(1);
  }
  const recipeId = (rcp.data as { id: string; canonical_name: string }).id;
  console.log(`  recipe: ${recipeId} (${(rcp.data as { canonical_name: string }).canonical_name})`);

  console.log('[seed-load-test] Creating auth user…');
  const authResult = await supabase.auth.admin.createUser({
    id: USER_ID,
    email: 'load-test@hivekitchen.local',
    email_confirm: true,
  });
  if (authResult.error && !authResult.error.message.includes('already')) {
    console.error('auth.admin.createUser failed:', authResult.error.message);
    process.exit(1);
  }
  console.log('  auth user OK');

  // public.users mirrors auth.users for app-level FKs (households,
  // refresh_tokens, etc.). Upsert it explicitly — the trigger that
  // syncs auth → public might not have fired here.
  console.log('[seed-load-test] Upserting public.users row…');
  const pubUser = await supabase.from('users').upsert(
    {
      id: USER_ID,
      email: 'load-test@hivekitchen.local',
      role: 'primary_parent',
    },
    { onConflict: 'id' },
  );
  if (pubUser.error) {
    console.error('public.users failed:', pubUser.error.message);
    process.exit(1);
  }
  console.log('  public.users OK');

  console.log('[seed-load-test] Upserting household…');
  const hh = await supabase.from('households').upsert(
    {
      id: HOUSEHOLD_ID,
      primary_parent_user_id: USER_ID,
      name: 'Load Test',
    },
    { onConflict: 'id' },
  );
  if (hh.error) {
    console.error('households failed:', hh.error.message);
    process.exit(1);
  }
  console.log('  households OK');

  console.log('[seed-load-test] Upserting child…');
  const ch = await supabase.from('children').upsert(
    {
      id: CHILD_ID,
      household_id: HOUSEHOLD_ID,
      name: 'Load Test Child',
      age_band: 'child',
    },
    { onConflict: 'id' },
  );
  if (ch.error) {
    console.error('children failed:', ch.error.message);
    process.exit(1);
  }
  console.log('  children OK');

  console.log('');
  console.log('[seed-load-test] Done. Run the load test:');
  console.log(`  HOUSEHOLD_ID=${HOUSEHOLD_ID} \\`);
  console.log(`  RECIPE_ID=${recipeId} \\`);
  console.log(`  CHILD_ID=${CHILD_ID} \\`);
  console.log(`  pnpm db:plan-commit-load-test`);
}

main().catch((e: unknown) => {
  console.error('FATAL', e);
  process.exit(1);
});
