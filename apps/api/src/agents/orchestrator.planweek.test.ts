import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import type { Redis } from 'ioredis';
import { DomainOrchestrator } from './orchestrator.js';
import { TOOL_MANIFEST } from './tools.manifest.js';
import type { ToolSpec } from './tools.manifest.js';
import type { LLMProvider, LLMResponse } from './providers/llm-provider.interface.js';
import type { AuditService } from '../audit/audit.service.js';
import type { MemoryService } from '../modules/memory/memory.service.js';
import type { AllergyGuardrailService } from '../modules/allergy-guardrail/allergy-guardrail.service.js';
import type { RecipeService } from '../modules/recipe/recipe.service.js';
import type { PantryService } from '../modules/pantry/pantry.service.js';
import type { PlansService } from '../modules/plans/plans.service.js';
import type { CulturalPriorService } from '../modules/cultural-priors/cultural-prior.service.js';
import { ForbiddenToolCallError } from '../common/errors.js';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const CHILD_ID = '22222222-2222-4222-8222-222222222222';
const PLAN_ID = '99999999-9999-4999-8999-999999999999';
const REQUEST_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

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
  } as unknown as AllergyGuardrailService;
}

function buildMemoryService() {
  return {
    noteFromAgent: vi.fn(),
    recall: vi.fn().mockResolvedValue({ nodes: [] }),
  } as unknown as MemoryService;
}

function buildRecipeService() {
  return {
    search: vi.fn(),
    fetch: vi.fn(),
  } as unknown as RecipeService;
}

function buildPantryService() {
  return {
    read: vi.fn(),
  } as unknown as PantryService;
}

function buildPlansService() {
  return {
    compose: vi.fn(),
  } as unknown as PlansService;
}

function buildCulturalPriorService() {
  return {
    listByHousehold: vi.fn().mockResolvedValue([]),
  } as unknown as CulturalPriorService;
}

function buildRedis() {
  const pipeline = {
    zadd: vi.fn().mockReturnThis(),
    zremrangebyscore: vi.fn().mockReturnThis(),
    expire: vi.fn().mockReturnThis(),
    exec: vi.fn().mockResolvedValue([]),
  };
  return {
    pipeline: vi.fn().mockReturnValue(pipeline),
  } as unknown as Redis;
}

function buildProvider(overrides: Partial<LLMProvider> = {}): LLMProvider {
  const stoppedResponse: LLMResponse = {
    content: 'idle',
    toolCalls: [],
    finishReason: 'stop',
    usage: { promptTokens: 1, completionTokens: 1, cachedPromptTokens: 0 },
  };
  const complete = overrides.complete ?? vi.fn().mockResolvedValue(stoppedResponse);
  const completeWithMessages =
    overrides.completeWithMessages ?? vi.fn().mockResolvedValue(stoppedResponse);
  const stream =
    overrides.stream ??
    (async function* () {
      yield { type: 'done' as const };
    });
  const probe = overrides.probe ?? vi.fn().mockResolvedValue(true);
  return { name: 'primary', complete, completeWithMessages, stream, probe } as LLMProvider;
}

function buildOrchestrator(provider: LLMProvider) {
  return new DomainOrchestrator(
    [provider],
    {
      memory: buildMemoryService(),
      allergyGuardrail: buildAllergyService(),
      recipe: buildRecipeService(),
      pantry: buildPantryService(),
      plan: buildPlansService(),
      culturalPrior: buildCulturalPriorService(),
    },
    buildRedis(),
    buildAudit(),
    buildLogger(),
  );
}

function makeValidPlanComposeOutput() {
  return {
    plan_id: PLAN_ID,
    household_id: HOUSEHOLD_ID,
    week_of: '2026-05-11',
    days: [
      {
        day: 'monday' as const,
        items: [{ child_id: CHILD_ID, slot: 'main', ingredients: ['rice'] }],
      },
    ],
    prompt_version: 'v1.0.0',
  };
}

// Wires plan.compose's tool fn to a deterministic stub. Must be called AFTER
// constructing the DomainOrchestrator — the constructor overwrites the
// manifest entry with the real plansService-backed spec.
function wirePlanComposeStub(impl: (input: unknown) => Promise<unknown>): void {
  const existing = TOOL_MANIFEST.get('plan.compose');
  if (!existing) throw new Error('plan.compose not in manifest');
  TOOL_MANIFEST.set('plan.compose', {
    ...existing,
    fn: impl,
  });
}

describe('DomainOrchestrator.planWeek', () => {
  beforeEach(() => {
    // Reset is implicit per test — each test instantiates its own orchestrator
    // and re-stubs plan.compose afterwards. No global state to clear here.
  });

  it('runs the agentic loop and returns the parsed PlanComposeOutput', async () => {
    const planComposeCallId = 'call_compose_1';
    const responses: LLMResponse[] = [
      {
        content: null,
        toolCalls: [
          { id: planComposeCallId, name: 'plan.compose', arguments: { stub: true } },
        ],
        finishReason: 'tool_calls',
        usage: { promptTokens: 10, completionTokens: 5, cachedPromptTokens: 0 },
      },
      // Second turn returns 'stop' after the tool result is fed back in.
      {
        content: 'done',
        toolCalls: [],
        finishReason: 'stop',
        usage: { promptTokens: 20, completionTokens: 5, cachedPromptTokens: 0 },
      },
    ];
    const completeWithMessages = vi.fn().mockImplementation(() => {
      const next = responses.shift();
      if (!next) throw new Error('completeWithMessages called too many times');
      return Promise.resolve(next);
    });
    const orchestrator = buildOrchestrator(buildProvider({ completeWithMessages }));
    wirePlanComposeStub(async () => makeValidPlanComposeOutput());

    const result = await orchestrator.planWeek({
      householdId: HOUSEHOLD_ID,
      weekOf: '2026-05-11',
      requestId: REQUEST_ID,
    });

    expect(result.plan_id).toBe(PLAN_ID);
    expect(result.household_id).toBe(HOUSEHOLD_ID);
    expect(result.week_of).toBe('2026-05-11');
    expect(completeWithMessages).toHaveBeenCalled();
  });

  it('throws when the planner agent never calls plan.compose within MAX_PLAN_ITERATIONS', async () => {
    // Always return a non-plan.compose tool call so the loop keeps iterating.
    // recipe.search is in PLANNER_PROMPT.toolsAllowed so the orchestrator's
    // forbidden-tool guard does not interfere; the manifest fn throws —
    // planWeek catches non-plan.compose errors and returns them as JSON, so
    // the loop continues until MAX_PLAN_ITERATIONS exhausts.
    const completeWithMessages = vi.fn().mockResolvedValue({
      content: null,
      toolCalls: [{ id: 'call_search', name: 'recipe.search', arguments: { q: 'rice' } }],
      finishReason: 'tool_calls',
      usage: { promptTokens: 1, completionTokens: 1, cachedPromptTokens: 0 },
    });
    const orchestrator = buildOrchestrator(buildProvider({ completeWithMessages }));

    await expect(
      orchestrator.planWeek({
        householdId: HOUSEHOLD_ID,
        weekOf: '2026-05-11',
        requestId: REQUEST_ID,
      }),
    ).rejects.toThrow(/did not call plan\.compose/);
  });

  it('feeds rejectionContext into the system prompt when provided', async () => {
    const completeWithMessages = vi.fn().mockResolvedValue({
      content: null,
      toolCalls: [{ id: 'call_compose_1', name: 'plan.compose', arguments: {} }],
      finishReason: 'tool_calls',
      usage: { promptTokens: 1, completionTokens: 1, cachedPromptTokens: 0 },
    });
    const orchestrator = buildOrchestrator(buildProvider({ completeWithMessages }));
    wirePlanComposeStub(async () => makeValidPlanComposeOutput());

    await orchestrator.planWeek({
      householdId: HOUSEHOLD_ID,
      weekOf: '2026-05-11',
      requestId: REQUEST_ID,
      rejectionContext: 'allergen: peanut, ingredient: peanut butter',
    });

    const messages = completeWithMessages.mock.calls[0]?.[0] as Array<{
      role: string;
      content: string;
    }>;
    expect(messages).toBeDefined();
    const userTurn = messages.find((m) => m.role === 'user');
    expect(userTurn?.content).toContain('Previous attempt was blocked by the allergy guardrail');
    expect(userTurn?.content).toContain('peanut butter');
  });

  it('does not include the rejection-context preamble when omitted', async () => {
    const completeWithMessages = vi.fn().mockResolvedValue({
      content: null,
      toolCalls: [{ id: 'call_compose_1', name: 'plan.compose', arguments: {} }],
      finishReason: 'tool_calls',
      usage: { promptTokens: 1, completionTokens: 1, cachedPromptTokens: 0 },
    });
    const orchestrator = buildOrchestrator(buildProvider({ completeWithMessages }));
    wirePlanComposeStub(async () => makeValidPlanComposeOutput());

    await orchestrator.planWeek({
      householdId: HOUSEHOLD_ID,
      weekOf: '2026-05-11',
      requestId: REQUEST_ID,
    });

    const messages = completeWithMessages.mock.calls[0]?.[0] as Array<{
      role: string;
      content: string;
    }>;
    const userTurn = messages.find((m) => m.role === 'user');
    expect(userTurn?.content).toContain('first generation attempt');
    expect(userTurn?.content).not.toContain('Previous attempt was blocked');
  });

  it('stops iterating after plan.compose result captured even if more iterations remain', async () => {
    const completeWithMessages = vi.fn().mockResolvedValue({
      content: null,
      toolCalls: [{ id: 'call_compose_1', name: 'plan.compose', arguments: {} }],
      finishReason: 'tool_calls',
      usage: { promptTokens: 1, completionTokens: 1, cachedPromptTokens: 0 },
    });
    const orchestrator = buildOrchestrator(buildProvider({ completeWithMessages }));
    wirePlanComposeStub(async () => makeValidPlanComposeOutput());

    await orchestrator.planWeek({
      householdId: HOUSEHOLD_ID,
      weekOf: '2026-05-11',
      requestId: REQUEST_ID,
    });

    // The loop exits after the first iteration once plan.compose returns.
    // completeWithMessages is called exactly once (the first turn); there is
    // no second turn to feed the tool result back in.
    expect(completeWithMessages).toHaveBeenCalledTimes(1);
  });

  it('propagates ForbiddenToolCallError when the agent calls a disallowed tool', async () => {
    // memory.note is NOT in PLANNER_PROMPT.toolsAllowed.
    const completeWithMessages = vi.fn().mockResolvedValue({
      content: null,
      toolCalls: [{ id: 'call_note', name: 'memory.note', arguments: {} }],
      finishReason: 'tool_calls',
      usage: { promptTokens: 1, completionTokens: 1, cachedPromptTokens: 0 },
    });
    const orchestrator = buildOrchestrator(buildProvider({ completeWithMessages }));

    await expect(
      orchestrator.planWeek({
        householdId: HOUSEHOLD_ID,
        weekOf: '2026-05-11',
        requestId: REQUEST_ID,
      }),
    ).rejects.toBeInstanceOf(ForbiddenToolCallError);
  });

  it('rethrows plan.compose tool errors as fatal (no JSON-error fallback)', async () => {
    const completeWithMessages = vi.fn().mockResolvedValue({
      content: null,
      toolCalls: [{ id: 'call_compose_1', name: 'plan.compose', arguments: {} }],
      finishReason: 'tool_calls',
      usage: { promptTokens: 1, completionTokens: 1, cachedPromptTokens: 0 },
    });
    const orchestrator = buildOrchestrator(buildProvider({ completeWithMessages }));
    wirePlanComposeStub(async () => {
      throw new Error('plan.compose fatal');
    });

    await expect(
      orchestrator.planWeek({
        householdId: HOUSEHOLD_ID,
        weekOf: '2026-05-11',
        requestId: REQUEST_ID,
      }),
    ).rejects.toThrow(/plan\.compose fatal/);
  });
});

// ===========================================================================
// Slice E — DomainOrchestrator.swapBlockedItems
// ===========================================================================

describe('DomainOrchestrator.swapBlockedItems', () => {
  it('runs the swap loop and returns the parsed PlanComposeOutput from plan.compose', async () => {
    const composeCallId = 'call_swap_1';
    const responses: LLMResponse[] = [
      {
        content: null,
        toolCalls: [
          { id: composeCallId, name: 'plan.compose', arguments: { stub: true } },
        ],
        finishReason: 'tool_calls',
        usage: { promptTokens: 200, completionTokens: 80, cachedPromptTokens: 0 },
      },
      // Second turn after tool result, returns stop without further tool calls.
      {
        content: 'done',
        toolCalls: [],
        finishReason: 'stop',
        usage: { promptTokens: 220, completionTokens: 10, cachedPromptTokens: 200 },
      },
    ];
    let idx = 0;
    const completeWithMessages = vi.fn().mockImplementation(async () => {
      const r = responses[Math.min(idx, responses.length - 1)];
      idx += 1;
      return r;
    });
    const provider = buildProvider({ completeWithMessages });
    const orchestrator = buildOrchestrator(provider);

    const swapOutput = {
      plan_id: PLAN_ID,
      household_id: HOUSEHOLD_ID,
      week_of: '2026-05-18',
      days: [
        {
          day: 'monday' as const,
          items: [
            {
              child_id: CHILD_ID,
              slot: 'main',
              ingredients: ['sunflower seed butter', 'bread'],
            },
          ],
        },
      ],
      prompt_version: 'v1.0.0',
    };
    wirePlanComposeStub(async () => swapOutput);

    const result = await orchestrator.swapBlockedItems({
      householdId: HOUSEHOLD_ID,
      weekOf: '2026-05-18',
      requestId: REQUEST_ID,
      blockedItems: [
        {
          child_id: CHILD_ID,
          day: 'monday',
          slot: 'main',
          original_ingredients: ['peanut butter', 'bread'],
          blocked_by: [{ allergen: 'peanut', ingredient: 'peanut butter' }],
        },
      ],
    });

    expect(result).toEqual(swapOutput);
  });

  it('invokes the LLM with the mini tier (cost target for surgical retry)', async () => {
    const completeWithMessages = vi.fn().mockResolvedValue({
      content: null,
      toolCalls: [
        { id: 'call_swap_2', name: 'plan.compose', arguments: { stub: true } },
      ],
      finishReason: 'tool_calls',
      usage: { promptTokens: 100, completionTokens: 30, cachedPromptTokens: 0 },
    } satisfies LLMResponse);
    const provider = buildProvider({ completeWithMessages });
    const orchestrator = buildOrchestrator(provider);

    wirePlanComposeStub(async () => makeValidPlanComposeOutput());

    await orchestrator.swapBlockedItems({
      householdId: HOUSEHOLD_ID,
      weekOf: '2026-05-18',
      requestId: REQUEST_ID,
      blockedItems: [
        {
          child_id: CHILD_ID,
          day: 'monday',
          slot: 'main',
          original_ingredients: ['peanut butter'],
          blocked_by: [{ allergen: 'peanut', ingredient: 'peanut butter' }],
        },
      ],
    });

    expect(completeWithMessages).toHaveBeenCalled();
    const callArgs = completeWithMessages.mock.calls[0] as [unknown, unknown, { tier: string }];
    expect(callArgs[2]?.tier).toBe('mini');
  });

  it('injects blocked item context (allergen + original ingredients) into the user message', async () => {
    const completeWithMessages = vi.fn().mockResolvedValue({
      content: null,
      toolCalls: [
        { id: 'call_swap_3', name: 'plan.compose', arguments: { stub: true } },
      ],
      finishReason: 'tool_calls',
      usage: { promptTokens: 100, completionTokens: 30, cachedPromptTokens: 0 },
    } satisfies LLMResponse);
    const provider = buildProvider({ completeWithMessages });
    const orchestrator = buildOrchestrator(provider);

    wirePlanComposeStub(async () => makeValidPlanComposeOutput());

    await orchestrator.swapBlockedItems({
      householdId: HOUSEHOLD_ID,
      weekOf: '2026-05-18',
      requestId: REQUEST_ID,
      blockedItems: [
        {
          child_id: CHILD_ID,
          day: 'monday',
          slot: 'main',
          original_ingredients: ['peanut butter', 'banana bread'],
          blocked_by: [{ allergen: 'peanut', ingredient: 'peanut butter' }],
        },
      ],
    });

    const messages = completeWithMessages.mock.calls[0]?.[0] as Array<{ role: string; content: string }>;
    const userMessage = messages.find((m) => m.role === 'user');
    expect(userMessage?.content).toContain('Blocked items to swap (1)');
    expect(userMessage?.content).toContain('peanut butter, banana bread');
    expect(userMessage?.content).toContain('peanut via peanut butter');
  });

  it('throws when blockedItems is empty (caller bug, fail fast)', async () => {
    const orchestrator = buildOrchestrator(buildProvider());
    await expect(
      orchestrator.swapBlockedItems({
        householdId: HOUSEHOLD_ID,
        weekOf: '2026-05-18',
        requestId: REQUEST_ID,
        blockedItems: [],
      }),
    ).rejects.toThrow(/blockedItems must not be empty/);
  });

  it('throws when the swap agent never calls plan.compose within the iteration cap', async () => {
    // Provider keeps returning stop with no tool call — agent never composed.
    const completeWithMessages = vi.fn().mockResolvedValue({
      content: 'unable to swap',
      toolCalls: [],
      finishReason: 'stop',
      usage: { promptTokens: 100, completionTokens: 5, cachedPromptTokens: 0 },
    } satisfies LLMResponse);
    const provider = buildProvider({ completeWithMessages });
    const orchestrator = buildOrchestrator(provider);

    await expect(
      orchestrator.swapBlockedItems({
        householdId: HOUSEHOLD_ID,
        weekOf: '2026-05-18',
        requestId: REQUEST_ID,
        blockedItems: [
          {
            child_id: CHILD_ID,
            day: 'monday',
            slot: 'main',
            original_ingredients: ['peanut butter'],
            blocked_by: [{ allergen: 'peanut', ingredient: 'peanut butter' }],
          },
        ],
      }),
    ).rejects.toThrow(/did not call plan\.compose/);
  });

  it('rejects forbidden tool calls outside the SWAP_PROMPT allowlist', async () => {
    // The swap agent's allowlist excludes memory.note + pantry.read + cultural.lookup.
    // If the model tries to call one of those, ForbiddenToolCallError should fire.
    const completeWithMessages = vi.fn().mockResolvedValue({
      content: null,
      toolCalls: [
        { id: 'call_bad', name: 'memory.note', arguments: { stub: true } },
      ],
      finishReason: 'tool_calls',
      usage: { promptTokens: 100, completionTokens: 5, cachedPromptTokens: 0 },
    } satisfies LLMResponse);
    const provider = buildProvider({ completeWithMessages });
    const orchestrator = buildOrchestrator(provider);

    await expect(
      orchestrator.swapBlockedItems({
        householdId: HOUSEHOLD_ID,
        weekOf: '2026-05-18',
        requestId: REQUEST_ID,
        blockedItems: [
          {
            child_id: CHILD_ID,
            day: 'monday',
            slot: 'main',
            original_ingredients: ['peanut butter'],
            blocked_by: [{ allergen: 'peanut', ingredient: 'peanut butter' }],
          },
        ],
      }),
    ).rejects.toBeInstanceOf(ForbiddenToolCallError);
  });
});
