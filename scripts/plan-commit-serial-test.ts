#!/usr/bin/env tsx
/**
 * Serial-latency probe for commit_plan(). Useful when the concurrent gate's
 * apparent p99 is inflated by client- or server-side connection-pool
 * serialization (PostgREST's connection pool + remote network RTT can make
 * concurrent measurements unreliable on a small Supabase instance).
 *
 * Sends N commit_plan() calls one at a time, captures per-call latency,
 * prints p50/p95/p99/max. AC12's gate is server-side per-call cost — if the
 * concurrent gate's median already meets target, this number is the real
 * one.
 */
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

const N = Number(process.env['N'] ?? '20');
const HOUSEHOLD_ID = process.env['HOUSEHOLD_ID']!;
const RECIPE_ID = process.env['RECIPE_ID']!;
const CHILD_ID = process.env['CHILD_ID']!;

const url = process.env['SUPABASE_URL']!;
const key = process.env['SUPABASE_SERVICE_ROLE_KEY']!;
const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = sorted[base + 1] ?? sorted[base]!;
  return sorted[base]! + rest * (next - sorted[base]!);
}

async function main(): Promise<void> {
  console.log(`[serial-test] Serial probe: ${N} commit_plan() calls, one at a time.`);
  const baseWeekOf = new Date('2027-01-01T00:00:00.000Z');
  const latencies: number[] = [];
  let failures = 0;

  for (let i = 0; i < N; i++) {
    const wkOf = new Date(baseWeekOf);
    wkOf.setUTCDate(wkOf.getUTCDate() + i);
    const planId = randomUUID();
    const args = {
      p_plan_id: planId,
      p_household_id: HOUSEHOLD_ID,
      p_week_of: wkOf.toISOString().slice(0, 10),
      p_revision: 1,
      p_generated_at: new Date().toISOString(),
      p_guardrail_cleared_at: new Date().toISOString(),
      p_guardrail_version: '1.1.0',
      p_prompt_version: 'serial-probe-v1',
      p_main_assignments: [{ sequence: 1, recipe_id: RECIPE_ID }],
      p_days: [
        {
          day: 'monday',
          slots: [
            {
              slot_kind: 'main',
              main_assignment_sequence: 1,
              variations: [
                {
                  child_id: CHILD_ID,
                  portion_size: 'regular',
                  texture: 'normal',
                  spice_level: 'mild',
                  add_ons: [],
                  removals: [],
                },
              ],
            },
            {
              slot_kind: 'snack',
              recipe_id: RECIPE_ID,
              variations: [
                {
                  child_id: CHILD_ID,
                  portion_size: 'small',
                  texture: 'normal',
                  spice_level: 'mild',
                  add_ons: [],
                  removals: [],
                },
              ],
            },
            {
              slot_kind: 'extra',
              recipe_id: RECIPE_ID,
              extra_kind: 'sweet',
              variations: [
                {
                  child_id: CHILD_ID,
                  portion_size: 'small',
                  texture: 'normal',
                  spice_level: 'mild',
                  add_ons: [],
                  removals: [],
                },
              ],
            },
          ],
        },
      ],
    };
    const t0 = performance.now();
    const { error } = await supabase.rpc('commit_plan', args);
    const ms = performance.now() - t0;
    if (error) {
      failures++;
      if (failures <= 3) console.log(`  [${i}] FAIL ${ms.toFixed(1)}ms: ${error.message}`);
    } else {
      latencies.push(ms);
    }
  }

  if (latencies.length === 0) {
    console.log('[serial-test] All calls failed.');
    process.exit(1);
  }

  const p50 = quantile(latencies, 0.5);
  const p95 = quantile(latencies, 0.95);
  const p99 = quantile(latencies, 0.99);
  const max = Math.max(...latencies);
  const min = Math.min(...latencies);
  console.log(`[serial-test] ${latencies.length}/${N} successes, ${failures} failures.`);
  console.log(`[serial-test] min=${min.toFixed(1)}ms · p50=${p50.toFixed(1)}ms · p95=${p95.toFixed(1)}ms · p99=${p99.toFixed(1)}ms · max=${max.toFixed(1)}ms`);
}

main().catch((e: unknown) => {
  console.error('FATAL', e);
  process.exit(1);
});
