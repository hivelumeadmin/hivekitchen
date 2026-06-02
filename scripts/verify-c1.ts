import { createClient } from '@supabase/supabase-js';
const url = process.env['SUPABASE_URL']!;
const key = process.env['SUPABASE_SERVICE_ROLE_KEY']!;
const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

async function main() {
  // Check the 4 new tables exist (via select with limit 0; an unknown-relation error means it's missing)
  for (const t of ['plan_main_assignments', 'plan_days', 'plan_slots', 'plan_slot_variations']) {
    const { error } = await supabase.from(t).select('*').limit(0);
    console.log(`  ${t}: ${error ? 'MISSING (' + error.message + ')' : 'OK'}`);
  }
  // Check plan_items is gone
  const { error: piErr } = await supabase.from('plan_items').select('*').limit(0);
  console.log(`  plan_items dropped: ${piErr ? 'OK (' + piErr.message.slice(0, 80) + ')' : 'STILL PRESENT'}`);
  // Try a smoke-test commit_plan with the new 10-arg signature
  const planId = crypto.randomUUID();
  const { error: rpcErr } = await supabase.rpc('commit_plan', {
    p_plan_id: planId,
    p_household_id: '00000000-0000-0000-0000-000000000000',
    p_week_of: '2026-06-01',
    p_revision: 1,
    p_generated_at: new Date().toISOString(),
    p_guardrail_cleared_at: new Date().toISOString(),
    p_guardrail_version: '1.1.0',
    p_prompt_version: 'verify-c1',
    p_main_assignments: [],
    p_days: [],
  });
  // We expect this to fail because the household_id doesn't exist (FK violation),
  // NOT with a function-signature mismatch. If we see "function commit_plan(...) does not exist"
  // the new signature didn't land.
  if (!rpcErr) {
    console.log('  commit_plan signature: OK (call succeeded — unexpected but valid)');
  } else if (rpcErr.message.includes('function') && rpcErr.message.includes('does not exist')) {
    console.log(`  commit_plan signature: MISSING (${rpcErr.message})`);
  } else {
    console.log(`  commit_plan signature: OK (call ran, expected FK error: ${rpcErr.message.slice(0, 80)})`);
  }
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
