import { createClient } from '@supabase/supabase-js';
const db = createClient(process.env['SUPABASE_URL']!, process.env['SUPABASE_SERVICE_ROLE_KEY']!, { auth: { autoRefreshToken: false, persistSession: false } });
async function main() {
  const gd = await db.from('guardrail_decisions').delete().not('id', 'is', null);
  if (gd.error) { console.error('guardrail_decisions:', gd.error.message); return; }
  const pl = await db.from('plans').delete().not('id', 'is', null);
  if (pl.error) { console.error('plans:', pl.error.message); return; }
  const bs = await db.from('brief_state').delete().not('household_id', 'is', null);
  if (bs.error) { console.error('brief_state:', bs.error.message); return; }
  console.log('All plan data cleared (guardrail_decisions, plans cascade, brief_state).');
}
main().catch((e: unknown) => { console.error(e); process.exit(1); });
