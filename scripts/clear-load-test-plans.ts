import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env['SUPABASE_URL']!, process.env['SUPABASE_SERVICE_ROLE_KEY']!, { auth: { autoRefreshToken: false, persistSession: false } });
const HH = '11111111-1111-4111-8111-111111111111';

async function main() {
  // Manual delete in dependency order — the migration's cascade chain has a
  // gap (plan_slots.main_assignment_id has no ON DELETE CASCADE), so deleting
  // plans via CASCADE hits the FK from plan_slots → plan_main_assignments.
  const planIds = (await supabase.from('plans').select('id').eq('household_id', HH)).data ?? [];
  if (planIds.length === 0) { console.log('no plans to clear'); return; }
  const ids = (planIds as Array<{ id: string }>).map((r) => r.id);
  console.log(`clearing ${ids.length} plans for load-test household...`);

  // 1. plan_days (cascades to plan_slots, plan_slot_variations)
  const d1 = await supabase.from('plan_days').delete().in('plan_id', ids);
  if (d1.error) { console.error('plan_days delete failed:', d1.error.message); return; }
  console.log('  plan_days deleted');

  // 2. plan_main_assignments (now nothing references them)
  const d2 = await supabase.from('plan_main_assignments').delete().in('plan_id', ids);
  if (d2.error) { console.error('plan_main_assignments delete failed:', d2.error.message); return; }
  console.log('  plan_main_assignments deleted');

  // 3. plans
  const d3 = await supabase.from('plans').delete().in('id', ids);
  if (d3.error) { console.error('plans delete failed:', d3.error.message); return; }
  console.log('  plans deleted');
  console.log('OK');
}
main().catch((e: unknown) => { console.error(e); process.exit(1); });
