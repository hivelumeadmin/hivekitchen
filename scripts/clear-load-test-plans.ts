import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env['SUPABASE_URL']!, process.env['SUPABASE_SERVICE_ROLE_KEY']!, { auth: { autoRefreshToken: false, persistSession: false } });
const HH = '11111111-1111-4111-8111-111111111111';

async function main() {
  // 3-DM-E1 fixed plan_slots.main_assignment_id → ON DELETE CASCADE, closing
  // the last gap in the plans deletion chain. The full cascade from plans is:
  //   → plan_main_assignments (via plan_main_assignments.plan_id)
  //       → plan_slots (via plan_slots.main_assignment_id — E1 adds CASCADE)
  //           → plan_slot_variations, plan_day_context
  //   → plan_days (via plan_days.plan_id)
  //       → plan_slots (via plan_slots.plan_day_id)
  //           → plan_slot_variations, plan_day_context
  // so a single DELETE FROM plans tears the whole tree down.
  const { error } = await supabase.from('plans').delete().eq('household_id', HH);
  if (error) { console.error('plans delete failed:', error.message); return; }
  console.log('OK');
}
main().catch((e: unknown) => { console.error(e); process.exit(1); });
