import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import { createOnboardingTracer, OnboardingTracer } from './onboarding-tracer.js';
import { TEXT_MODEL_TIER } from './onboarding.agent.js';
import type { MomentState } from '../modules/onboarding/onboarding-moment.repository.js';

function makeLogger(): FastifyBaseLogger {
  const noop = (): undefined => undefined;
  const logger = {
    fatal: noop, error: noop, warn: noop, info: noop, debug: noop, trace: noop,
    silent: noop, level: 'silent',
    child(): FastifyBaseLogger { return logger as unknown as FastifyBaseLogger; },
  };
  return logger as unknown as FastifyBaseLogger;
}

const INIT = { householdId: 'hh-1', threadId: 'thr-1', turnIndex: 2 };

const MOMENT_BEFORE: MomentState = {
  current_moment: 'm1_table',
  required_set_status: {
    m1_household_name: false,
    m1_child_declared: false,
    m2_allergen_response: false,
    m3_answered: false,
    m5_favorite_count: 0,
    m5_complete: false,
  },
  cold_start_triggered: false,
  cold_start_trigger_reason: null,
};

const MOMENT_AFTER: MomentState = {
  current_moment: 'm2_safe',
  required_set_status: {
    m1_household_name: true,
    m1_child_declared: true,
    m2_allergen_response: false,
    m3_answered: false,
    m5_favorite_count: 0,
    m5_complete: false,
  },
  cold_start_triggered: false,
  cold_start_trigger_reason: null,
};

describe('createOnboardingTracer — opt-in gating', () => {
  const prev = process.env.ONBOARDING_TRACE_DIR;
  afterEach(() => {
    if (prev === undefined) delete process.env.ONBOARDING_TRACE_DIR;
    else process.env.ONBOARDING_TRACE_DIR = prev;
  });

  it('returns undefined when ONBOARDING_TRACE_DIR is unset', () => {
    delete process.env.ONBOARDING_TRACE_DIR;
    expect(createOnboardingTracer(INIT, makeLogger())).toBeUndefined();
  });

  it('returns undefined when ONBOARDING_TRACE_DIR is blank', () => {
    process.env.ONBOARDING_TRACE_DIR = '   ';
    expect(createOnboardingTracer(INIT, makeLogger())).toBeUndefined();
  });

  it('returns a tracer when ONBOARDING_TRACE_DIR is set', () => {
    process.env.ONBOARDING_TRACE_DIR = tmpdir();
    expect(createOnboardingTracer(INIT, makeLogger())).toBeInstanceOf(OnboardingTracer);
  });
});

describe('OnboardingTracer — per-turn artifact', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'onboarding-trace-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function readOnlyArtifact(): Promise<{ name: string; json: Record<string, unknown> }> {
    const files = await readdir(dir);
    expect(files).toHaveLength(1);
    const name = files[0]!;
    const json = JSON.parse(await readFile(join(dir, name), 'utf8')) as Record<string, unknown>;
    return { name, json };
  }

  it('writes one artifact containing every AC3 field', async () => {
    const tracer = new OnboardingTracer(dir, INIT, makeLogger());
    await tracer.write({
      kitchenMapBlock: 'KITCHEN_MAP_BLOCK_BODY',
      momentStateBlock: 'MOMENT_STATE_BLOCK_BODY',
      vocabularyBlock: 'VOCABULARY_BLOCK_BODY',
      toolCalls: [
        { tool: 'child.upsert', error: false, args: { name: 'Ada' }, result: { id: 'c1' } },
        { tool: 'cultural.note', error: true, args: { key: null }, result: { error: 'bad' } },
      ],
      usage: { promptTokens: 120, completionTokens: 40, cachedPromptTokens: 90, iterations: 2 },
      momentBefore: MOMENT_BEFORE,
      momentAfter: MOMENT_AFTER,
    });

    const { name, json } = await readOnlyArtifact();
    expect(name).toContain('hh-1__2__');
    expect(name.endsWith('.json')).toBe(true);

    // Model + assembled system prompt + the three dynamic blocks.
    expect(json.model).toBe(TEXT_MODEL_TIER);
    expect(typeof json.system_prompt).toBe('string');
    expect((json.system_prompt as string).length).toBeGreaterThan(0);
    expect(json.dynamic_blocks).toEqual({
      kitchen_map: 'KITCHEN_MAP_BLOCK_BODY',
      moment_state: 'MOMENT_STATE_BLOCK_BODY',
      vocabulary: 'VOCABULARY_BLOCK_BODY',
    });

    // Each tool call with args + result, incl. the error-result.
    expect(json.tool_calls).toEqual([
      { tool: 'child.upsert', error: false, args: { name: 'Ada' }, result: { id: 'c1' } },
      { tool: 'cultural.note', error: true, args: { key: null }, result: { error: 'bad' } },
    ]);

    // Usage incl. cachedPromptTokens.
    expect(json.usage).toEqual({
      promptTokens: 120,
      completionTokens: 40,
      cachedPromptTokens: 90,
      iterations: 2,
    });

    // Moment-state before and after.
    expect(json.moment_before).toEqual(MOMENT_BEFORE);
    expect(json.moment_after).toEqual(MOMENT_AFTER);
  });

  it('records null model/prompt/blocks/usage on a zero-LLM (pure-chip) turn', async () => {
    const tracer = new OnboardingTracer(dir, INIT, makeLogger());
    await tracer.write({
      toolCalls: [],
      usage: undefined,
      momentBefore: null,
      momentAfter: null,
    });

    const { json } = await readOnlyArtifact();
    // No LLM call happened — the artifact must not claim a model or a prompt
    // that was never sent.
    expect(json.model).toBeNull();
    expect(json.system_prompt).toBeNull();
    expect(json.dynamic_blocks).toEqual({ kitchen_map: null, moment_state: null, vocabulary: null });
    expect(json.tool_calls).toEqual([]);
    expect(json.usage).toBeNull();
    expect(json.moment_before).toBeNull();
    expect(json.moment_after).toBeNull();
  });
});
