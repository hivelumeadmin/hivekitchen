import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import { DomainOrchestrator } from './orchestrator.js';
import { TOOL_MANIFEST } from './tools.manifest.js';
import type { ToolSpec } from './tools.manifest.js';
import type { LLMProvider, LLMResponse } from './providers/llm-provider.interface.js';
import type { AuditService } from '../audit/audit.service.js';
import type { MemoryService } from '../modules/memory/memory.service.js';
import type { AllergyGuardrailService } from '../modules/allergy-guardrail/allergy-guardrail.service.js';
import { ForbiddenToolCallError } from '../common/errors.js';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const CHILD_ID = '22222222-2222-4222-8222-222222222222';

function buildLogger(): FastifyBaseLogger {
  const fn = (): unknown => undefined;
  const noop = vi.fn(fn);
  const logger = {
    fatal: noop,
    error: noop,
    warn: noop,
    info: noop,
    debug: noop,
    trace: noop,
    silent: noop,
    level: 'info',
    child(): FastifyBaseLogger {
      return logger;
    },
  };
  return logger as unknown as FastifyBaseLogger;
}

function buildAudit() {
  return {
    write: vi.fn().mockResolvedValue(undefined),
  } as unknown as AuditService & { write: ReturnType<typeof vi.fn> };
}

function buildAllergyService() {
  return {
    evaluate: vi.fn().mockResolvedValue({ verdict: 'cleared', conflicts: [] }),
    clearOrReject: vi.fn(),
  } as unknown as AllergyGuardrailService & { evaluate: ReturnType<typeof vi.fn> };
}

function buildMemoryService() {
  return {
    noteFromAgent: vi.fn().mockResolvedValue({
      node_id: '33333333-3333-4333-8333-333333333333',
      created_at: '2026-05-01T12:00:00.000Z',
    }),
  } as unknown as MemoryService & { noteFromAgent: ReturnType<typeof vi.fn> };
}

function buildProvider(name: string, overrides: Partial<LLMProvider> = {}): LLMProvider {
  const stoppedResponse: LLMResponse = {
    content: `from-${name}`,
    toolCalls: [],
    finishReason: 'stop',
    usage: { promptTokens: 1, completionTokens: 1 },
  };
  const complete = overrides.complete ?? vi.fn().mockResolvedValue(stoppedResponse);
  const stream =
    overrides.stream ??
    (async function* () {
      yield { type: 'done' as const };
    });
  const probe = overrides.probe ?? vi.fn().mockResolvedValue(true);
  return {
    name,
    complete,
    stream,
    probe,
  } as LLMProvider;
}

function buildOrchestrator(providers: LLMProvider[]) {
  const audit = buildAudit();
  const allergy = buildAllergyService();
  const memory = buildMemoryService();
  const logger = buildLogger();
  const orchestrator = new DomainOrchestrator(
    providers,
    { memory, allergyGuardrail: allergy },
    audit,
    logger,
  );
  return { orchestrator, audit, allergy, memory };
}

describe('DomainOrchestrator', () => {
  beforeEach(() => {
    const allergySpec = TOOL_MANIFEST.get('allergy.check');
    const memorySpec = TOOL_MANIFEST.get('memory.note');
    if (!allergySpec || !memorySpec) {
      throw new Error('TOOL_MANIFEST is missing expected entries — check tools.manifest.ts');
    }
    // Reset the manifest to its stub-throwing state so each test can verify
    // that the orchestrator constructor is what wires the real fns in.
    TOOL_MANIFEST.set('allergy.check', {
      name: 'allergy.check',
      description: 'stub',
      inputSchema: allergySpec.inputSchema,
      outputSchema: allergySpec.outputSchema,
      maxLatencyMs: 150,
      fn: async () => {
        throw new Error('allergy.check stub — orchestrator did not wire fn');
      },
    });
    TOOL_MANIFEST.set('memory.note', {
      name: 'memory.note',
      description: 'stub',
      inputSchema: memorySpec.inputSchema,
      outputSchema: memorySpec.outputSchema,
      maxLatencyMs: 200,
      fn: async () => {
        throw new Error('memory.note stub — orchestrator did not wire fn');
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('throws when constructed with no providers', () => {
    expect(
      () =>
        new DomainOrchestrator(
          [],
          { memory: buildMemoryService(), allergyGuardrail: buildAllergyService() },
          buildAudit(),
          buildLogger(),
        ),
    ).toThrow(/at least one LLMProvider/);
  });

  it('wires the real allergy.check fn into TOOL_MANIFEST on construction', async () => {
    const { allergy } = buildOrchestrator([buildProvider('primary')]);

    const wired = TOOL_MANIFEST.get('allergy.check');
    expect(wired).toBeDefined();
    const result = await wired!.fn({
      household_id: HOUSEHOLD_ID,
      plan_items: [
        { child_id: CHILD_ID, day: 'monday', slot: 'main', ingredients: ['rice'] },
      ],
    });

    expect(allergy.evaluate).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ verdict: 'cleared', conflicts: [] });
  });

  it('wires the real memory.note fn into TOOL_MANIFEST on construction', async () => {
    const { memory } = buildOrchestrator([buildProvider('primary')]);

    const wired = TOOL_MANIFEST.get('memory.note');
    expect(wired).toBeDefined();
    await wired!.fn({
      household_id: HOUSEHOLD_ID,
      node_type: 'preference',
      facet: 'dislikes-broccoli',
      prose_text: 'No broccoli in lunches.',
      subject_child_id: CHILD_ID,
      confidence: 0.9,
    });

    expect(memory.noteFromAgent).toHaveBeenCalledTimes(1);
    expect(memory.noteFromAgent).toHaveBeenCalledWith({
      householdId: HOUSEHOLD_ID,
      nodeType: 'preference',
      facet: 'dislikes-broccoli',
      proseText: 'No broccoli in lunches.',
      subjectChildId: CHILD_ID,
      confidence: 0.9,
    });
  });

  it('delegates complete() to the primary provider and returns its result', async () => {
    const primary = buildProvider('primary');
    const secondary = buildProvider('secondary');
    const { orchestrator } = buildOrchestrator([primary, secondary]);

    const result = await orchestrator.complete('hi', [], { model: 'gpt-4o' });

    expect(primary.complete).toHaveBeenCalledTimes(1);
    expect(secondary.complete).not.toHaveBeenCalled();
    expect(result.content).toBe('from-primary');
    expect(orchestrator.getActiveProvider().name).toBe('primary');
  });

  it('swaps to the secondary provider after 5 consecutive failures and writes an audit event', async () => {
    const failingPrimary = buildProvider('primary', {
      complete: vi.fn().mockRejectedValue(new Error('upstream-down')),
    });
    const secondary = buildProvider('secondary');
    const { orchestrator, audit } = buildOrchestrator([failingPrimary, secondary]);

    for (let i = 0; i < 5; i += 1) {
      await expect(orchestrator.complete('hi', [], { model: 'gpt-4o' })).rejects.toThrow(
        'upstream-down',
      );
    }

    // Audit + log writes happen synchronously in handleBreakerOpen but the
    // audit.write() returns a promise; allow the microtask queue to drain
    // before asserting.
    await Promise.resolve();
    await Promise.resolve();

    expect(audit.write).toHaveBeenCalledTimes(1);
    const auditCall = (audit.write as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(auditCall).toMatchObject({
      event_type: 'llm.provider.failover',
      metadata: expect.objectContaining({ from: 'primary', to: 'secondary' }),
    });
    expect(orchestrator.getActiveProvider().name).toBe('secondary');
  });

  it('routes complete() to the secondary provider after a failover', async () => {
    const failingPrimary = buildProvider('primary', {
      complete: vi.fn().mockRejectedValue(new Error('upstream-down')),
    });
    const secondary = buildProvider('secondary');
    const { orchestrator } = buildOrchestrator([failingPrimary, secondary]);

    for (let i = 0; i < 5; i += 1) {
      await expect(orchestrator.complete('hi', [], { model: 'gpt-4o' })).rejects.toThrow(
        'upstream-down',
      );
    }

    const result = await orchestrator.complete('hi-again', [], { model: 'gpt-4o' });

    expect(secondary.complete).toHaveBeenCalledTimes(1);
    expect(result.content).toBe('from-secondary');
  });

  describe('allowed-tool filtering', () => {
    function makeToolStub(name: string): ToolSpec {
      return { name } as unknown as ToolSpec;
    }

    it('forwards only tools in the allowed set to the provider', async () => {
      const primary = buildProvider('primary');
      const { orchestrator } = buildOrchestrator([primary]);

      const tools = [
        makeToolStub('recipe.search'),
        makeToolStub('memory.note'),
        makeToolStub('allergy.check'),
      ];
      await orchestrator.complete('hi', tools, { model: 'gpt-4o' }, [
        'recipe.search',
        'allergy.check',
      ]);

      const completeMock = primary.complete as unknown as ReturnType<typeof vi.fn>;
      const forwardedTools = completeMock.mock.calls[0]?.[1] as ToolSpec[];
      expect(forwardedTools.map((t) => t.name)).toEqual(['recipe.search', 'allergy.check']);
    });

    it('forwards every tool when allowedTools is omitted (backward compatible)', async () => {
      const primary = buildProvider('primary');
      const { orchestrator } = buildOrchestrator([primary]);

      const tools = [
        makeToolStub('recipe.search'),
        makeToolStub('memory.note'),
        makeToolStub('allergy.check'),
      ];
      await orchestrator.complete('hi', tools, { model: 'gpt-4o' });

      const completeMock = primary.complete as unknown as ReturnType<typeof vi.fn>;
      const forwardedTools = completeMock.mock.calls[0]?.[1] as ToolSpec[];
      expect(forwardedTools.map((t) => t.name)).toEqual([
        'recipe.search',
        'memory.note',
        'allergy.check',
      ]);
    });

    it('throws ForbiddenToolCallError when provider returns a tool call outside the allowed set', async () => {
      const responseWithForbiddenCall: LLMResponse = {
        content: null,
        toolCalls: [{ id: 'call_1', name: 'memory.note', arguments: {} }],
        finishReason: 'tool_calls',
        usage: { promptTokens: 1, completionTokens: 1 },
      };
      const primary = buildProvider('primary', {
        complete: vi.fn().mockResolvedValue(responseWithForbiddenCall),
      });
      const { orchestrator } = buildOrchestrator([primary]);

      await expect(
        orchestrator.complete(
          'hi',
          [makeToolStub('memory.note')],
          { model: 'gpt-4o' },
          ['recipe.search', 'allergy.check'],
        ),
      ).rejects.toBeInstanceOf(ForbiddenToolCallError);
    });

    it('does not trip the circuit breaker when ForbiddenToolCallError is thrown', async () => {
      const responseWithForbiddenCall: LLMResponse = {
        content: null,
        toolCalls: [{ id: 'call_1', name: 'memory.note', arguments: {} }],
        finishReason: 'tool_calls',
        usage: { promptTokens: 1, completionTokens: 1 },
      };
      const primary = buildProvider('primary', {
        complete: vi.fn().mockResolvedValue(responseWithForbiddenCall),
      });
      const secondary = buildProvider('secondary');
      const { orchestrator, audit } = buildOrchestrator([primary, secondary]);

      // 6 attempts — well past the 5-failure threshold that would trip the breaker
      // if forbidden-tool errors were counted as provider failures.
      for (let i = 0; i < 6; i += 1) {
        await expect(
          orchestrator.complete(
            'hi',
            [makeToolStub('memory.note')],
            { model: 'gpt-4o' },
            ['recipe.search', 'allergy.check'],
          ),
        ).rejects.toBeInstanceOf(ForbiddenToolCallError);
      }

      await Promise.resolve();
      await Promise.resolve();

      expect(orchestrator.getActiveProvider().name).toBe('primary');
      expect(audit.write).not.toHaveBeenCalled();
      expect(secondary.complete).not.toHaveBeenCalled();
    });
  });
});
