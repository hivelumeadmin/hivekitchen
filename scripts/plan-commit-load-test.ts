#!/usr/bin/env tsx
/**
 * Story 3-DM-C1 Phase 9c — load-test gate for AC12.
 *
 * Fans out N concurrent commit_plan() RPC calls against the local or staging
 * Postgres (via Supabase-js) using a minimal but valid tree shape per plan.
 * Captures per-call wall-clock latency, prints p50 / p95 / p99 / max, and
 * asserts p99 < P99_TARGET_MS (default 250) per the story's acceptance
 * criterion.
 *
 * The migration 20261010000000_plan_structure_canonical.sql MUST be applied
 * before running. Without it the RPC signature mismatches and every call
 * errors before exercising the new tree shape.
 *
 * Hard gates:
 *   1. NODE_ENV must NOT be 'production' (the script writes ~N plan rows;
 *      production data should never be the target).
 *   2. SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY must point at the target
 *      database (local stack: SUPABASE_URL=http://127.0.0.1:54321).
 *   3. A households row must exist whose id matches HOUSEHOLD_ID below — pre-
 *      seed it with `pnpm db:reset --confirm` then a manual `INSERT INTO
 *      households (id, name) VALUES ('11111111-1111-4111-8111-111111111111',
 *      'Load Test')` before running, or override HOUSEHOLD_ID via env.
 *   4. The recipes referenced (default RECIPE_ID below) must exist; override
 *      via env if needed. The script does NOT seed recipes — that's the
 *      operator's job.
 *
 * Invocation:
 *   # Default: 100 concurrent commits, p99 < 250ms.
 *   tsx --env-file=apps/api/.env.local scripts/plan-commit-load-test.ts
 *
 *   # Custom shape:
 *   N=200 P99_TARGET_MS=300 tsx --env-file=apps/api/.env.local scripts/plan-commit-load-test.ts
 *
 * Exit codes:
 *   0  — all calls succeeded AND p99 met target
 *   1  — at least one call errored
 *   2  — all calls succeeded BUT p99 exceeded target (gate failure)
 */
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { Agent, setGlobalDispatcher } from 'undici';

// Node's default fetch agent caps at ~6 sockets per origin, which serializes
// the 100-call burst behind a tiny socket pool and inflates per-call wall-
// clock latency to ~5s. Raise the cap to N so the load test actually
// measures server-side throughput rather than client-side queue time.
setGlobalDispatcher(new Agent({ connections: 256, pipelining: 0 }));

// ─── Config ──────────────────────────────────────────────────────────────────

const N = Number(process.env['N'] ?? '100');
const P99_TARGET_MS = Number(process.env['P99_TARGET_MS'] ?? '250');
const HOUSEHOLD_ID = process.env['HOUSEHOLD_ID'] ?? '11111111-1111-4111-8111-111111111111';
const RECIPE_ID = process.env['RECIPE_ID'] ?? '66666666-6666-4666-8666-666666666666';
const CHILD_ID = process.env['CHILD_ID'] ?? '44444444-4444-4444-8444-444444444444';
const PROMPT_VERSION = 'load-test-v1.0.0';
const GUARDRAIL_VERSION = '1.1.0';

// ─── Safety gates ────────────────────────────────────────────────────────────

const nodeEnv = process.env['NODE_ENV'] ?? 'development';
if (nodeEnv === 'production') {
  process.stderr.write(
    `[load-test] Refused: NODE_ENV=production. Run against local or staging only.\n`,
  );
  process.exit(1);
}

const url = process.env['SUPABASE_URL'];
const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
if (!url || !key) {
  process.stderr.write('[load-test] SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.\n');
  process.exit(1);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.log(`[load-test] ${msg}`);
}

function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  // Linear interpolation between the closest ranks.
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = sorted[base + 1] ?? sorted[base]!;
  return sorted[base]! + rest * (next - sorted[base]!);
}

// Build a minimal but valid tree-shape commit payload. One M-assignment, one
// day, three slots (main, snack, extra), one variation per slot. Each call
// uses a fresh plan_id so the ON CONFLICT (id) path stays uncontended.
function buildCommitArgs(): Record<string, unknown> {
  const planId = randomUUID();
  const weekOf = '2026-06-01';
  return {
    p_plan_id: planId,
    p_household_id: HOUSEHOLD_ID,
    p_week_of: weekOf,
    p_revision: 1,
    p_generated_at: new Date().toISOString(),
    p_guardrail_cleared_at: new Date().toISOString(),
    p_guardrail_version: GUARDRAIL_VERSION,
    p_prompt_version: PROMPT_VERSION,
    p_main_assignments: [
      { sequence: 1, recipe_id: RECIPE_ID },
    ],
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
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const supabase = createClient(url!, key!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  log(`Target: ${N} concurrent commit_plan() calls, p99 < ${P99_TARGET_MS}ms.`);
  log(`Household: ${HOUSEHOLD_ID}`);
  log(`Recipe:    ${RECIPE_ID}`);
  log(`Child:     ${CHILD_ID}`);
  log('Note: every call gets a fresh plan_id (UNIQUE(household, week_of) caveat — see below).');

  // The commit_plan RPC enforces UNIQUE(household_id, week_of). Concurrent
  // calls with the SAME (household, week_of) would conflict; we use a unique
  // week_of per call so the load test exercises raw INSERT throughput without
  // serializing on the unique index.
  //
  // The base week_of '2026-06-01' is fixed for the first call; subsequent
  // calls shift by i days so each gets a unique slot. 100 calls span 100
  // days — comfortably inside the date range Postgres tolerates.
  const baseWeekOf = new Date('2026-06-01T00:00:00.000Z');

  const results: Array<{ ok: boolean; ms: number; error?: string }> = new Array(N);
  const tasks: Array<Promise<void>> = [];

  const t0 = performance.now();
  for (let i = 0; i < N; i++) {
    const args = buildCommitArgs();
    const wkOf = new Date(baseWeekOf);
    wkOf.setUTCDate(wkOf.getUTCDate() + i);
    args['p_week_of'] = wkOf.toISOString().slice(0, 10);

    tasks.push(
      (async () => {
        const start = performance.now();
        const { error } = await supabase.rpc('commit_plan', args);
        const ms = performance.now() - start;
        results[i] = error
          ? { ok: false, ms, error: error.message }
          : { ok: true, ms };
      })(),
    );
  }

  await Promise.all(tasks);
  const wallClock = performance.now() - t0;

  // ─── Report ────────────────────────────────────────────────────────────────

  const successes = results.filter((r) => r.ok);
  const failures = results.filter((r) => !r.ok);
  const latencies = successes.map((r) => r.ms);

  log(`Wall-clock: ${wallClock.toFixed(0)}ms (all calls fanned out + awaited)`);
  log(`Successes:  ${successes.length} / ${N}`);
  log(`Failures:   ${failures.length} / ${N}`);

  if (failures.length > 0) {
    log('First 3 failure messages:');
    for (const f of failures.slice(0, 3)) {
      log(`  - ${f.error ?? '(no message)'}`);
    }
  }

  if (latencies.length > 0) {
    const p50 = quantile(latencies, 0.5);
    const p95 = quantile(latencies, 0.95);
    const p99 = quantile(latencies, 0.99);
    const max = Math.max(...latencies);
    log(`Latency:    p50=${p50.toFixed(1)}ms · p95=${p95.toFixed(1)}ms · p99=${p99.toFixed(1)}ms · max=${max.toFixed(1)}ms`);

    if (failures.length > 0) {
      log(`GATE: FAIL — ${failures.length} call(s) errored.`);
      process.exit(1);
    }
    if (p99 > P99_TARGET_MS) {
      log(`GATE: FAIL — p99 ${p99.toFixed(1)}ms exceeds ${P99_TARGET_MS}ms target.`);
      process.exit(2);
    }
    log(`GATE: PASS — p99 ${p99.toFixed(1)}ms within ${P99_TARGET_MS}ms target.`);
  } else {
    log('GATE: FAIL — every call errored; no latency data captured.');
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`[load-test] ${String(err)}\n`);
  process.exitCode = 1;
});
