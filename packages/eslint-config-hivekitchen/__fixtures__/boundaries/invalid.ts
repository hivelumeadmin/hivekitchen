// @file: apps/api/src/services/plan-service.ts
// Vendor SDK imported outside plugins/ — lint must fail on each patterned group.
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

export async function planService() {
  const client = new OpenAI();
  const db = createClient('', '');
  // audit_log write outside apps/api/src/audit/ — must also fail.
  await db.from('audit_log').insert({});
  return client;
}
