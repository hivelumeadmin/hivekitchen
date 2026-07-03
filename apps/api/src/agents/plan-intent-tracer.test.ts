import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import { createPlanIntentTracer } from './plan-intent-tracer.js';

// Epic 13-s9 / routing-spec §8 — routing trace tags. model:null on the
// dispatch tag; routed tag null on the chip bypass (zero-LLM turns are
// visibly free in the trace).

const logger = {
  debug: vi.fn(),
  warn: vi.fn(),
} as unknown as FastifyBaseLogger;

const INIT = { householdId: 'hh-1', planId: 'plan-1' };
const INTENT = { intent: 'swap_slot', confidence: 0.9, day: 'tue', slotKind: 'main' } as const;
const DISPATCH = {
  tier: 'T0',
  action: 'swap',
  intent: 'swap_slot',
  candidate: { id: 'r1', kind: 'recipe', title: 'Wraps' },
  target: { day: 'tue', slotKind: 'main' },
} as const;

const ORIGINAL_TRACE_DIR = process.env.PLAN_TRACE_DIR;
let tempDir: string | undefined;

afterEach(async () => {
  if (ORIGINAL_TRACE_DIR === undefined) delete process.env.PLAN_TRACE_DIR;
  else process.env.PLAN_TRACE_DIR = ORIGINAL_TRACE_DIR;
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe('createPlanIntentTracer', () => {
  it('returns undefined when PLAN_TRACE_DIR is unset (cheap no-op path)', () => {
    delete process.env.PLAN_TRACE_DIR;
    expect(createPlanIntentTracer(INIT, logger)).toBeUndefined();
  });

  it('writes routed + dispatch tags with model:null on the deterministic side', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'plan-intent-trace-'));
    process.env.PLAN_TRACE_DIR = tempDir;
    const tracer = createPlanIntentTracer(INIT, logger);
    expect(tracer).toBeDefined();

    await tracer!.write({
      utterance: 'swap tuesday',
      intent: INTENT,
      dispatch: DISPATCH,
      outcomeStatus: 'applied',
    });

    const files = await readdir(tempDir);
    expect(files).toHaveLength(1);
    const artifact = JSON.parse(await readFile(join(tempDir, files[0]!), 'utf8'));
    expect(artifact['plan_intent.routed']).toEqual({
      intent: 'swap_slot',
      confidence: 0.9,
      tier: 'T1',
      model: 'mini',
    });
    expect(artifact['plan_intent.dispatch']).toEqual({
      intent: 'swap_slot',
      action: 'swap',
      tier: 'T0',
      escalated: false,
      model: null,
    });
    expect(artifact.outcome_status).toBe('applied');
  });

  it('records a null routed tag on the chip bypass (no classifier ran)', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'plan-intent-trace-'));
    process.env.PLAN_TRACE_DIR = tempDir;
    const tracer = createPlanIntentTracer(INIT, logger);

    await tracer!.write({
      utterance: null,
      intent: { ...INTENT, confidence: 1 },
      dispatch: DISPATCH,
      outcomeStatus: 'applied',
    });

    const files = await readdir(tempDir);
    const artifact = JSON.parse(await readFile(join(tempDir, files[0]!), 'utf8'));
    expect(artifact['plan_intent.routed']).toBeNull();
    expect(artifact.utterance).toBeNull();
  });

  it('marks escalations on the dispatch tag', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'plan-intent-trace-'));
    process.env.PLAN_TRACE_DIR = tempDir;
    const tracer = createPlanIntentTracer(INIT, logger);

    await tracer!.write({
      utterance: 'can we do bibimbap',
      intent: { intent: 'add_dish', confidence: 0.95, dishQuery: 'bibimbap' },
      dispatch: {
        tier: 'T2',
        action: 'escalate',
        intent: 'add_dish',
        reason: 'add_dish',
        dishQuery: 'bibimbap',
      },
      outcomeStatus: 'escalate',
    });

    const files = await readdir(tempDir);
    const artifact = JSON.parse(await readFile(join(tempDir, files[0]!), 'utf8'));
    expect(artifact['plan_intent.dispatch']).toMatchObject({ escalated: true, tier: 'T2' });
  });
});
