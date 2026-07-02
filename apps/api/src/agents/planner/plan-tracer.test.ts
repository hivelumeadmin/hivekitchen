import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import { createPlanTracer, PlanTracer } from './plan-tracer.js';
import type { LLMMessage, LLMResponse } from '../providers/llm-provider.interface.js';

function makeLogger(): FastifyBaseLogger {
  const noop = (): undefined => undefined;
  const logger = {
    fatal: noop, error: noop, warn: noop, info: noop, debug: noop, trace: noop,
    silent: noop, level: 'silent',
    child(): FastifyBaseLogger { return logger as unknown as FastifyBaseLogger; },
  };
  return logger as unknown as FastifyBaseLogger;
}

const INIT = {
  requestId: 'req-1',
  householdId: 'hh-1',
  weekOf: '2026-06-29',
  tier: 'flagship' as const,
  attempt: 'initial' as const,
};

describe('createPlanTracer — opt-in gating', () => {
  const prev = process.env.PLAN_TRACE_DIR;
  afterEach(() => {
    if (prev === undefined) delete process.env.PLAN_TRACE_DIR;
    else process.env.PLAN_TRACE_DIR = prev;
  });

  it('returns undefined when PLAN_TRACE_DIR is unset', () => {
    delete process.env.PLAN_TRACE_DIR;
    expect(createPlanTracer(INIT, makeLogger())).toBeUndefined();
  });

  it('returns undefined when PLAN_TRACE_DIR is blank', () => {
    process.env.PLAN_TRACE_DIR = '   ';
    expect(createPlanTracer(INIT, makeLogger())).toBeUndefined();
  });

  it('returns a tracer when PLAN_TRACE_DIR is set', () => {
    process.env.PLAN_TRACE_DIR = tmpdir();
    expect(createPlanTracer(INIT, makeLogger())).toBeInstanceOf(PlanTracer);
  });
});

describe('PlanTracer — file output', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'plan-trace-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes one file containing every recorded section', async () => {
    const tracer = new PlanTracer(dir, INIT, makeLogger());
    tracer.recordContext({
      kitchenMap: {
        household: { declared_allergens: ['peanut'] },
        children: [{ id: 'c1', declared_allergens: ['egg'] }],
      } as never,
      dayScope: undefined,
      plannedDays: undefined,
      rejectionContext: undefined,
    });
    tracer.recordCoverage({ main: 2, extra: 0 }, { main: 3, extra: 1 });
    const messages: LLMMessage[] = [
      { role: 'system', content: 'SYSTEM_PROMPT_BODY' },
      { role: 'user', content: 'USER_CONTEXT_BODY' },
    ];
    tracer.recordPrompt(messages);
    tracer.recordLlmCall({ tier: 'flagship', temperature: 0.2, maxTokens: 4096 }, messages.length);
    const response: LLMResponse = {
      content: null,
      toolCalls: [{ id: 't1', name: 'plan.compose', arguments: {} }],
      finishReason: 'tool_calls',
      usage: { promptTokens: 100, completionTokens: 50, cachedPromptTokens: 80 },
    };
    tracer.recordLlmResponse(response, 1234);
    tracer.recordToolCall('plan.compose', { plan_id: 'p1', days: [] });
    tracer.recordPostCompose(true);
    tracer.recordResult({ plan_id: 'p1' }, 'p1', 5000);
    await tracer.flush();

    const files = await readdir(dir);
    expect(files).toHaveLength(1);
    expect(files[0]).toContain('2026-06-29__hh-1__initial__');

    const body = await readFile(join(dir, files[0]), 'utf8');
    expect(body).toContain('PLAN COMPOSE TRACE');
    expect(body).toContain('household allergens: [peanut]');
    expect(body).toContain('Before  : 2 mains, 0 extras');
    expect(body).toContain('After   : 3 mains, 1 extras');
    expect(body).toContain('SYSTEM_PROMPT_BODY');
    expect(body).toContain('USER_CONTEXT_BODY');
    expect(body).toContain('100 prompt / 50 completion / 80 cached');
    expect(body).toContain('Latency      : 1234 ms');
    expect(body).toContain('TOOL CALL — plan.compose');
    expect(body).toContain('noConsecutiveMain  : PASS');
    expect(body).toContain('Plan ID  : p1');
  });

  it('records the swap agent: header, per-iteration labels, and tool executions', async () => {
    const tracer = new PlanTracer(dir, { ...INIT, agent: 'swap' }, makeLogger());
    const messages: LLMMessage[] = [
      { role: 'system', content: 'SWAP_PROMPT_BODY' },
      { role: 'user', content: 'BLOCKED_ITEMS_BODY' },
    ];
    tracer.recordPrompt(messages);
    const response: LLMResponse = {
      content: null,
      toolCalls: [{ id: 't1', name: 'recipe.search', arguments: { query: 'x' } }],
      finishReason: 'tool_calls',
      usage: { promptTokens: 10, completionTokens: 5, cachedPromptTokens: 0 },
    };
    tracer.recordLlmCall({ tier: 'mini' }, messages.length, 0);
    tracer.recordLlmResponse(response, 200, 0);
    tracer.recordToolExecution('recipe.search', { query: 'x' }, { results: ['a'] });
    tracer.recordResult({ plan_id: 'sp1' }, 'sp1', 900);
    await tracer.flush();

    const files = await readdir(dir);
    expect(files[0]).toContain('swap__2026-06-29__hh-1__');
    const body = await readFile(join(dir, files[0]), 'utf8');
    expect(body).toContain('PLAN COMPOSE TRACE — swap');
    expect(body).toContain('Agent        : swap');
    expect(body).toContain('LLM CALL — iteration 0');
    expect(body).toContain('LLM RESPONSE — iteration 0');
    expect(body).toContain('TOOL EXECUTION — recipe.search');
    expect(body).toContain('Arguments (model output):');
    expect(body).toContain('Result (tool output):');
  });

  it('records a FAIL post-compose section and error on the failure path', async () => {
    const tracer = new PlanTracer(dir, INIT, makeLogger());
    tracer.recordPostCompose(false);
    tracer.recordError(new Error('adjacent days share Main'));
    await tracer.flush();

    const files = await readdir(dir);
    const body = await readFile(join(dir, files[0]), 'utf8');
    expect(body).toContain('noConsecutiveMain  : FAIL (threw)');
    expect(body).toContain('adjacent days share Main');
  });
});
