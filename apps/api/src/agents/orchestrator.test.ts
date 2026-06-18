import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import type { Redis } from 'ioredis';
import {
  DomainOrchestrator,
  buildBagCompositionLines,
  buildCulturalContextLines,
  buildExtraProposalLines,
  buildExtraRulesLines,
  renderPlannerChildSignalsBlock,
  renderPlannerKitchenMapBlock,
  renderPlannerPantryBlock,
  renderPlannerRecipeCandidatesBlock,
} from './orchestrator.js';
import type {
  OrchestratorServices,
  PlannerBagComposition,
  PlannerCulturalContext,
  PlannerExtraLibraryItem,
  PlannerExtraProposal,
  PlannerExtraRules,
  PlannerRecipeCandidateSlate,
} from './orchestrator.js';
import type { ChildSignalOutput, KitchenMap } from '@hivekitchen/types';
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
    recall: vi.fn().mockResolvedValue({ nodes: [] }),
  } as unknown as MemoryService & {
    noteFromAgent: ReturnType<typeof vi.fn>;
    recall: ReturnType<typeof vi.fn>;
  };
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
  // Pipeline returns a thenable chain; recordToolLatency awaits .exec().
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

function buildProvider(name: string, overrides: Partial<LLMProvider> = {}): LLMProvider {
  const stoppedResponse: LLMResponse = {
    content: `from-${name}`,
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
  return {
    name,
    complete,
    completeWithMessages,
    stream,
    probe,
  } as LLMProvider;
}

function buildChildPrefsRepo() {
  return {
    getAggregatedSignals: vi.fn().mockResolvedValue([]),
    getVariantEligibleChildIds: vi.fn().mockResolvedValue([]),
  } as unknown as OrchestratorServices['childPrefs'];
}

function buildChildrenRepo() {
  return {
    findByHouseholdId: vi.fn().mockResolvedValue([]),
  } as unknown as OrchestratorServices['children'];
}

function buildOrchestrator(providers: LLMProvider[]) {
  const audit = buildAudit();
  const allergy = buildAllergyService();
  const memory = buildMemoryService();
  const recipe = buildRecipeService();
  const pantry = buildPantryService();
  const plan = buildPlansService();
  const culturalPrior = buildCulturalPriorService();
  const redis = buildRedis();
  const logger = buildLogger();
  const orchestrator = new DomainOrchestrator(
    providers,
    {
      memory,
      allergyGuardrail: allergy,
      recipe,
      pantry,
      plan,
      culturalPrior,
      childPrefs: buildChildPrefsRepo(),
      children: buildChildrenRepo(),
    },
    redis,
    audit,
    logger,
  );
  return { orchestrator, audit, allergy, memory, redis };
}

describe('DomainOrchestrator', () => {
  beforeEach(() => {
    const allergySpec = TOOL_MANIFEST.get('allergy.check');
    const memorySpec = TOOL_MANIFEST.get('memory.note');
    const memoryRecallSpec = TOOL_MANIFEST.get('memory.recall');
    const recipeSearchSpec = TOOL_MANIFEST.get('recipe.search');
    const recipeFetchSpec = TOOL_MANIFEST.get('recipe.fetch');
    const pantryReadSpec = TOOL_MANIFEST.get('pantry.read');
    const planComposeSpec = TOOL_MANIFEST.get('plan.compose');
    const culturalLookupSpec = TOOL_MANIFEST.get('cultural.lookup');
    if (
      !allergySpec || !memorySpec || !memoryRecallSpec ||
      !recipeSearchSpec || !recipeFetchSpec || !pantryReadSpec ||
      !planComposeSpec || !culturalLookupSpec
    ) {
      throw new Error('TOOL_MANIFEST is missing expected entries — check tools.manifest.ts');
    }
    // Reset the manifest to its stub-throwing state so each test can verify
    // that the orchestrator constructor is what wires the real fns in.
    const makeStub = (name: string, spec: ToolSpec, maxLatencyMs: number): ToolSpec => ({
      name,
      description: 'stub',
      inputSchema: spec.inputSchema,
      outputSchema: spec.outputSchema,
      maxLatencyMs,
      fn: async () => { throw new Error(`${name} stub — orchestrator did not wire fn`); },
    });
    TOOL_MANIFEST.set('allergy.check', makeStub('allergy.check', allergySpec, 150));
    TOOL_MANIFEST.set('memory.note', makeStub('memory.note', memorySpec, 200));
    TOOL_MANIFEST.set('memory.recall', makeStub('memory.recall', memoryRecallSpec, 200));
    TOOL_MANIFEST.set('recipe.search', makeStub('recipe.search', recipeSearchSpec, 300));
    TOOL_MANIFEST.set('recipe.fetch', makeStub('recipe.fetch', recipeFetchSpec, 100));
    TOOL_MANIFEST.set('pantry.read', makeStub('pantry.read', pantryReadSpec, 80));
    TOOL_MANIFEST.set('plan.compose', makeStub('plan.compose', planComposeSpec, 2000));
    TOOL_MANIFEST.set('cultural.lookup', makeStub('cultural.lookup', culturalLookupSpec, 80));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('throws when constructed with no providers', () => {
    expect(
      () =>
        new DomainOrchestrator(
          [],
          {
            memory: buildMemoryService(),
            allergyGuardrail: buildAllergyService(),
            recipe: buildRecipeService(),
            pantry: buildPantryService(),
            plan: buildPlansService(),
            culturalPrior: buildCulturalPriorService(),
            childPrefs: buildChildPrefsRepo(),
            children: buildChildrenRepo(),
          },
          buildRedis(),
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
      node_type: 'other',
      facet: 'dislikes-broccoli',
      prose_text: 'No broccoli in lunches.',
      subject_child_id: CHILD_ID,
      confidence: 0.9,
    });

    expect(memory.noteFromAgent).toHaveBeenCalledTimes(1);
    expect(memory.noteFromAgent).toHaveBeenCalledWith({
      householdId: HOUSEHOLD_ID,
      nodeType: 'other',
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
        usage: { promptTokens: 1, completionTokens: 1, cachedPromptTokens: 0 },
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
        usage: { promptTokens: 1, completionTokens: 1, cachedPromptTokens: 0 },
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

  // Story 3.18 — cultural context is rendered into the planner prompt as
  // natural-language lines. The buildCulturalContextLines helper is the
  // single source of truth; planWeek() consumes its output.
  describe('buildCulturalContextLines', () => {
    it('returns empty array for undefined cultural context (silence mode)', () => {
      expect(buildCulturalContextLines(undefined)).toEqual([]);
    });

    it('returns empty array when all fields are empty', () => {
      const ctx: PlannerCulturalContext = {
        observances: [],
        l0Preferences: [],
        l1MethodPriors: [],
        culturalObligations: [],
        culturalTemplates: [],
      };
      expect(buildCulturalContextLines(ctx)).toEqual([]);
    });

    it('renders templates as display names, observances, L0 preferences, cultural obligations, and L1 priors', () => {
      const ctx: PlannerCulturalContext = {
        observances: [
          {
            observance_name: 'Diwali',
            cultural_template: 'hindu_vegetarian',
            start_date: '2026-11-08',
            end_date: '2026-11-08',
            dietary_notes: 'Sweets, fried foods.',
          },
        ],
        l0Preferences: ['Maya refuses bell peppers.'],
        l1MethodPriors: ['Ayaan prefers sandwiches over wraps.'],
        culturalObligations: ['No meat and dairy together.'],
        culturalTemplates: ['hindu_vegetarian'],
      };

      const lines = buildCulturalContextLines(ctx);

      // Template slug rendered as display name
      expect(lines).toContain(
        'Cultural templates ratified by this household: Hindu vegetarian.',
      );
      expect(lines).toContain('Upcoming cultural observances during this plan week:');
      // Observance uses display name, not slug
      expect(lines.some((l) => l.includes('Diwali (Hindu vegetarian)'))).toBe(true);
      expect(lines.some((l) => l.includes('Sweets, fried foods.'))).toBe(true);
      expect(lines).toContain(
        'Household food preferences (apply silently — no confirmation needed):',
      );
      expect(lines).toContain('- Maya refuses bell peppers.');
      expect(lines).toContain('Cultural obligations (required — do not override):');
      expect(lines).toContain('- No meat and dairy together.');
      expect(lines).toContain(
        'Preparation priors (soft signals — prefer but not required):',
      );
      expect(lines).toContain('- Ayaan prefers sandwiches over wraps.');
    });

    it('renders a single-day observance with one date and skips empty dietary notes', () => {
      const ctx: PlannerCulturalContext = {
        observances: [
          {
            observance_name: 'Eid al-Fitr',
            cultural_template: 'halal',
            start_date: '2026-03-20',
            end_date: '2026-03-20',
            dietary_notes: null,
          },
        ],
        l0Preferences: [],
        l1MethodPriors: [],
        culturalObligations: [],
        culturalTemplates: ['halal'],
      };

      const lines = buildCulturalContextLines(ctx);
      const observanceLine = lines.find((l) => l.includes('Eid al-Fitr'));

      expect(observanceLine).toBeDefined();
      expect(observanceLine).toContain('2026-03-20.');
      expect(observanceLine).not.toContain(' – ');
    });

    it('appends "recurs weekly" to the Shabbat observance line', () => {
      const ctx: PlannerCulturalContext = {
        observances: [
          {
            observance_name: 'Shabbat',
            cultural_template: 'kosher',
            start_date: '2026-11-06',
            end_date: '2026-11-06',
            dietary_notes: 'Friday dinner: challah, fish, chicken.',
          },
        ],
        l0Preferences: [],
        l1MethodPriors: [],
        culturalObligations: [],
        culturalTemplates: ['kosher'],
      };

      const lines = buildCulturalContextLines(ctx);
      const shabbatLine = lines.find((l) => l.includes('Shabbat'));

      expect(shabbatLine).toBeDefined();
      expect(shabbatLine).toContain('recurs weekly');
      expect(shabbatLine).toContain('Kosher');
    });
  });

  // Story 3.20 — bag composition lines instruct the planner to skip
  // inactive Snack/Extra slots. Pure helper, single source of truth.
  describe('buildBagCompositionLines', () => {
    it('returns empty array when undefined', () => {
      expect(buildBagCompositionLines(undefined)).toEqual([]);
    });

    it('returns empty array when no children are supplied', () => {
      expect(buildBagCompositionLines([])).toEqual([]);
    });

    it('renders one line per child with ON/OFF flags and an enforcement instruction', () => {
      const compositions: PlannerBagComposition[] = [
        { child_id: CHILD_ID, child_name: 'Asha', snack: true, extra: false },
        {
          child_id: '33333333-3333-4333-8333-333333333333',
          child_name: 'Kai',
          snack: false,
          extra: true,
        },
      ];

      const lines = buildBagCompositionLines(compositions);

      expect(lines[0]).toContain('Per-child bag composition');
      expect(lines[0]).toContain('Main is always active');
      expect(lines.some((l) => l.includes('Asha') && l.includes('Snack ON') && l.includes('Extra OFF'))).toBe(true);
      expect(lines.some((l) => l.includes('Kai') && l.includes('Snack OFF') && l.includes('Extra ON'))).toBe(true);
      expect(lines.at(-1)).toContain('Emit slot rows only for active slots');
    });
  });

  // Story 3.21 — Extra rules pin/ban + library lines feed forward-only
  // signals into the planner user message. Empty inputs collapse silently
  // so the prompt stays neutral when no preferences exist.
  describe('buildExtraRulesLines', () => {
    it('returns empty when no rules and no library', () => {
      expect(buildExtraRulesLines(undefined, undefined)).toEqual([]);
      expect(buildExtraRulesLines([], [])).toEqual([]);
    });

    it('returns empty when every child has zero pins and zero bans', () => {
      const rules: PlannerExtraRules[] = [
        { child_id: CHILD_ID, child_name: 'Asha', pins: [], bans: [] },
      ];
      expect(buildExtraRulesLines(rules, undefined)).toEqual([]);
    });

    it('renders pins and bans per child plus the library summary', () => {
      const rules: PlannerExtraRules[] = [
        { child_id: CHILD_ID, child_name: 'Asha', pins: ['fruit'], bans: ['sweet treat'] },
        {
          child_id: '33333333-3333-4333-8333-333333333333',
          child_name: 'Kai',
          pins: [],
          bans: [],
        },
      ];
      const library: PlannerExtraLibraryItem[] = [
        {
          id: '44444444-4444-4444-8444-444444444444',
          name: 'Homemade oat bar',
          component_type: 'grain',
          is_allergen_free: true,
        },
      ];

      const lines = buildExtraRulesLines(rules, library);

      expect(lines[0]).toContain('Per-child Extra slot pin/ban rules');
      expect(lines.some((l) => l.includes('Asha') && l.includes('always include one of [fruit]'))).toBe(true);
      expect(lines.some((l) => l.includes('Asha') && l.includes('never propose [sweet treat]'))).toBe(true);
      // Kai had no pins or bans — no per-child line for them.
      expect(lines.some((l) => l.includes('Kai'))).toBe(false);
      expect(lines.some((l) => l.includes('Homemade oat bar (grain)'))).toBe(true);
    });

    it('renders the library section even when no pins or bans are set', () => {
      const library: PlannerExtraLibraryItem[] = [
        {
          id: '44444444-4444-4444-8444-444444444444',
          name: 'Fruit cup',
          component_type: 'fruit',
          is_allergen_free: true,
        },
      ];
      const lines = buildExtraRulesLines([], library);
      expect(lines.some((l) => l.includes('Household custom Extra items available'))).toBe(true);
    });
  });

  // Story 3.22 — high-activity Extra proposals (FR119). Lines are emitted
  // only when a proposal exists; empty inputs collapse silently.
  describe('buildExtraProposalLines', () => {
    it('returns empty for undefined or empty input', () => {
      expect(buildExtraProposalLines(undefined)).toEqual([]);
      expect(buildExtraProposalLines([])).toEqual([]);
    });

    it('renders one line per proposal under a clear heading', () => {
      const proposals: PlannerExtraProposal[] = [
        {
          child_id: CHILD_ID,
          child_name: 'Asha',
          override_date: '2026-11-04',
          context_type: 'sport_practice',
        },
        {
          child_id: '33333333-3333-4333-8333-333333333333',
          child_name: 'Kai',
          override_date: '2026-11-06',
          context_type: 'field_trip',
        },
      ];
      const lines = buildExtraProposalLines(proposals);
      expect(lines[0]).toContain('High-activity day Extra proposals');
      expect(lines.some((l) => l.includes('Asha') && l.includes('2026-11-04') && l.includes('sport_practice'))).toBe(true);
      expect(lines.some((l) => l.includes('Kai') && l.includes('2026-11-06') && l.includes('field_trip'))).toBe(true);
    });
  });

  describe('planWeek cultural context injection', () => {
    let savedComposeSpec: ToolSpec;

    beforeEach(() => {
      savedComposeSpec = TOOL_MANIFEST.get('plan.compose')!;
    });

    afterEach(() => {
      TOOL_MANIFEST.set('plan.compose', savedComposeSpec);
    });

    const MINIMAL_PLAN_OUTPUT = {
      plan_id: '99999999-9999-4999-8999-999999999999',
      household_id: HOUSEHOLD_ID,
      week_of: '2026-11-02',
      prompt_version: 'v2.0.0',
      main_assignments: [{ sequence: 1, recipe_id: '33333333-3333-4333-8333-333333333333' }],
      days: [
        {
          day: 'monday',
          slots: [
            {
              slot_kind: 'main',
              main_assignment_sequence: 1,
              variations: [{ child_id: CHILD_ID }],
            },
          ],
        },
      ],
    };

    it('injects cultural context lines into the planner user message', async () => {
      let capturedUserContent: string | undefined;

      const provider = buildProvider('primary', {
        completeWithMessages: vi.fn().mockImplementation(
          (messages: Array<{ role: string; content: unknown }>) => {
            const userMsg = messages.find((m) => m.role === 'user');
            capturedUserContent = userMsg?.content as string | undefined;
            return Promise.resolve({
              content: null,
              toolCalls: [{ id: 'tc1', name: 'plan.compose', arguments: MINIMAL_PLAN_OUTPUT }],
              finishReason: 'tool_calls',
              usage: { promptTokens: 1, completionTokens: 1, cachedPromptTokens: 0 },
            });
          },
        ),
      });

      const { orchestrator } = buildOrchestrator([provider]);
      const composeSpec = TOOL_MANIFEST.get('plan.compose')!;
      TOOL_MANIFEST.set('plan.compose', {
        ...composeSpec,
        fn: vi.fn().mockResolvedValue(MINIMAL_PLAN_OUTPUT),
      });

      const ctx: PlannerCulturalContext = {
        observances: [{
          observance_name: 'Diwali',
          cultural_template: 'hindu_vegetarian',
          start_date: '2026-11-08',
          end_date: '2026-11-08',
          dietary_notes: null,
        }],
        l0Preferences: ['Maya refuses bell peppers.'],
        l1MethodPriors: [],
        culturalObligations: ['No onion or garlic during Navaratri.'],
        culturalTemplates: ['hindu_vegetarian'],
      };

      await orchestrator.planWeek({
        householdId: HOUSEHOLD_ID,
        weekOf: '2026-11-02',
        requestId: 'req-1',
        culturalContext: ctx,
      });

      expect(capturedUserContent).toContain('Hindu vegetarian');
      expect(capturedUserContent).toContain('Diwali');
      expect(capturedUserContent).toContain('Maya refuses bell peppers.');
      expect(capturedUserContent).toContain('Cultural obligations (required — do not override):');
      expect(capturedUserContent).toContain('No onion or garlic during Navaratri.');
    });

    it('injects bag composition lines into the planner user message', async () => {
      let capturedUserContent: string | undefined;

      const provider = buildProvider('primary', {
        completeWithMessages: vi.fn().mockImplementation(
          (messages: Array<{ role: string; content: unknown }>) => {
            const userMsg = messages.find((m) => m.role === 'user');
            capturedUserContent = userMsg?.content as string | undefined;
            return Promise.resolve({
              content: null,
              toolCalls: [{ id: 'tc-bag', name: 'plan.compose', arguments: MINIMAL_PLAN_OUTPUT }],
              finishReason: 'tool_calls',
              usage: { promptTokens: 1, completionTokens: 1, cachedPromptTokens: 0 },
            });
          },
        ),
      });

      const { orchestrator } = buildOrchestrator([provider]);
      const composeSpec = TOOL_MANIFEST.get('plan.compose')!;
      TOOL_MANIFEST.set('plan.compose', {
        ...composeSpec,
        fn: vi.fn().mockResolvedValue(MINIMAL_PLAN_OUTPUT),
      });

      const bagCompositions: PlannerBagComposition[] = [
        { child_id: CHILD_ID, child_name: 'Asha', snack: false, extra: true },
      ];

      await orchestrator.planWeek({
        householdId: HOUSEHOLD_ID,
        weekOf: '2026-11-02',
        requestId: 'req-bag',
        bagCompositions,
      });

      expect(capturedUserContent).toContain('Per-child bag composition');
      expect(capturedUserContent).toContain('Asha');
      expect(capturedUserContent).toContain('Snack OFF');
      expect(capturedUserContent).toContain('Extra ON');
      expect(capturedUserContent).toContain(
        'Emit slot rows only for active slots',
      );
    });

    it('omits all cultural lines from the planner user message when culturalContext is undefined', async () => {
      let capturedUserContent: string | undefined;

      const provider = buildProvider('primary', {
        completeWithMessages: vi.fn().mockImplementation(
          (messages: Array<{ role: string; content: unknown }>) => {
            const userMsg = messages.find((m) => m.role === 'user');
            capturedUserContent = userMsg?.content as string | undefined;
            return Promise.resolve({
              content: null,
              toolCalls: [{ id: 'tc2', name: 'plan.compose', arguments: MINIMAL_PLAN_OUTPUT }],
              finishReason: 'tool_calls',
              usage: { promptTokens: 1, completionTokens: 1, cachedPromptTokens: 0 },
            });
          },
        ),
      });

      const { orchestrator } = buildOrchestrator([provider]);
      const composeSpec = TOOL_MANIFEST.get('plan.compose')!;
      TOOL_MANIFEST.set('plan.compose', {
        ...composeSpec,
        fn: vi.fn().mockResolvedValue(MINIMAL_PLAN_OUTPUT),
      });

      await orchestrator.planWeek({
        householdId: HOUSEHOLD_ID,
        weekOf: '2026-11-02',
        requestId: 'req-2',
      });

      expect(capturedUserContent).not.toContain('Cultural templates');
      expect(capturedUserContent).not.toContain('Upcoming cultural observances');
      expect(capturedUserContent).not.toContain('Household food preferences');
      expect(capturedUserContent).not.toContain('Cultural obligations');
      expect(capturedUserContent).not.toContain('Preparation priors');
    });
  });

  // Story 3-S33 — partial-week (plannedDays) + day-scope adjacentMains injection.
  describe('planWeek partial-week & adjacent-Main injection', () => {
    let savedComposeSpec: ToolSpec;

    beforeEach(() => {
      savedComposeSpec = TOOL_MANIFEST.get('plan.compose')!;
    });

    afterEach(() => {
      TOOL_MANIFEST.set('plan.compose', savedComposeSpec);
    });

    const MINIMAL_PLAN_OUTPUT = {
      plan_id: '99999999-9999-4999-8999-999999999933',
      household_id: HOUSEHOLD_ID,
      week_of: '2026-11-02',
      prompt_version: 'v2.0.0',
      main_assignments: [{ sequence: 1, recipe_id: '33333333-3333-4333-8333-333333333333' }],
      days: [
        {
          day: 'monday',
          slots: [
            {
              slot_kind: 'main',
              main_assignment_sequence: 1,
              variations: [{ child_id: CHILD_ID }],
            },
          ],
        },
      ],
    };

    function buildCapturingOrchestrator(captureRef: { content?: string }) {
      const provider = buildProvider('primary', {
        completeWithMessages: vi.fn().mockImplementation(
          (messages: Array<{ role: string; content: unknown }>) => {
            const userMsg = messages.find((m) => m.role === 'user');
            captureRef.content = userMsg?.content as string | undefined;
            return Promise.resolve({
              content: null,
              toolCalls: [{ id: 'tc-pw', name: 'plan.compose', arguments: MINIMAL_PLAN_OUTPUT }],
              finishReason: 'tool_calls',
              usage: { promptTokens: 1, completionTokens: 1, cachedPromptTokens: 0 },
            });
          },
        ),
      });
      const { orchestrator } = buildOrchestrator([provider]);
      const composeSpec = TOOL_MANIFEST.get('plan.compose')!;
      TOOL_MANIFEST.set('plan.compose', {
        ...composeSpec,
        fn: vi.fn().mockResolvedValue(MINIMAL_PLAN_OUTPUT),
      });
      return orchestrator;
    }

    it('prepends the PARTIAL WEEK line as the first context line when plannedDays is present', async () => {
      const capture: { content?: string } = {};
      const orchestrator = buildCapturingOrchestrator(capture);

      await orchestrator.planWeek({
        householdId: HOUSEHOLD_ID,
        weekOf: '2026-11-02',
        requestId: 'req-pw-1',
        plannedDays: ['wednesday', 'thursday', 'friday'],
      });

      expect(capture.content).toBeDefined();
      expect(capture.content!.startsWith('PARTIAL WEEK:')).toBe(true);
      expect(capture.content).toContain(
        'Compose plan_days entries for ONLY these weekdays: wednesday, thursday, friday.',
      );
      expect(capture.content).toContain('the plan starts mid-week');
    });

    it('renders no PARTIAL WEEK line when plannedDays is absent', async () => {
      const capture: { content?: string } = {};
      const orchestrator = buildCapturingOrchestrator(capture);

      await orchestrator.planWeek({
        householdId: HOUSEHOLD_ID,
        weekOf: '2026-11-02',
        requestId: 'req-pw-2',
      });

      expect(capture.content).toBeDefined();
      expect(capture.content).not.toContain('PARTIAL WEEK:');
    });

    it('renders no PARTIAL WEEK line when plannedDays is empty', async () => {
      const capture: { content?: string } = {};
      const orchestrator = buildCapturingOrchestrator(capture);

      await orchestrator.planWeek({
        householdId: HOUSEHOLD_ID,
        weekOf: '2026-11-02',
        requestId: 'req-pw-3',
        plannedDays: [],
      });

      expect(capture.content).toBeDefined();
      expect(capture.content).not.toContain('PARTIAL WEEK:');
    });

    it('appends adjacent Mains to the day-scope line when adjacentMains is present', async () => {
      const capture: { content?: string } = {};
      const orchestrator = buildCapturingOrchestrator(capture);

      await orchestrator.planWeek({
        householdId: HOUSEHOLD_ID,
        weekOf: '2026-11-02',
        requestId: 'req-pw-4',
        dayScope: 'wednesday',
        adjacentMains: [
          { day: 'tuesday', main_name: 'Chicken Tikka Wrap' },
          { day: 'thursday', main_name: 'Veggie Pasta Bake' },
        ],
      });

      expect(capture.content).toContain('Regeneration scope: DAY ONLY.');
      expect(capture.content).toContain(
        'do NOT assign the same Main to WEDNESDAY: tuesday → Chicken Tikka Wrap, thursday → Veggie Pasta Bake.',
      );
    });

    it('omits the adjacent-Main clause from the day-scope line when adjacentMains is absent', async () => {
      const capture: { content?: string } = {};
      const orchestrator = buildCapturingOrchestrator(capture);

      await orchestrator.planWeek({
        householdId: HOUSEHOLD_ID,
        weekOf: '2026-11-02',
        requestId: 'req-pw-5',
        dayScope: 'wednesday',
      });

      expect(capture.content).toContain('Regeneration scope: DAY ONLY.');
      expect(capture.content).not.toContain('do NOT assign the same Main to');
    });

    it('throws when plannedDays and dayScope are both set', async () => {
      const { orchestrator } = buildOrchestrator([buildProvider('primary')]);

      await expect(
        orchestrator.planWeek({
          householdId: HOUSEHOLD_ID,
          weekOf: '2026-11-02',
          requestId: 'req-pw-6',
          plannedDays: ['wednesday', 'thursday'],
          dayScope: 'wednesday',
        }),
      ).rejects.toThrow('plannedDays and dayScope are mutually exclusive');
    });
  });

  // Story 3.30 — circuit-breaker health status and recovery audit.
  describe('getProviderStatus', () => {
    it('returns active_provider, closed circuit, and provider list when healthy', () => {
      const primary = buildProvider('openai');
      const secondary = buildProvider('anthropic');
      const { orchestrator } = buildOrchestrator([primary, secondary]);

      const status = orchestrator.getProviderStatus();

      expect(status).toEqual({
        active_provider: 'openai',
        circuit_open: false,
        providers: ['openai', 'anthropic'],
      });
    });

    it('reports open circuit and secondary as active after failover', async () => {
      const failingPrimary = buildProvider('openai', {
        complete: vi.fn().mockRejectedValue(new Error('down')),
      });
      const secondary = buildProvider('anthropic');
      const { orchestrator } = buildOrchestrator([failingPrimary, secondary]);

      for (let i = 0; i < 5; i += 1) {
        await expect(orchestrator.complete('hi', [], { model: 'gpt-4o' })).rejects.toThrow('down');
      }

      const status = orchestrator.getProviderStatus();
      expect(status.active_provider).toBe('anthropic');
      expect(status.circuit_open).toBe(true);
      orchestrator.dispose();
    });
  });

  describe('recovery: probe-driven audit + provider restoration', () => {
    // Holds the orchestrator built in each test so the local afterEach can
    // dispose timers even if an earlier expect() throws.
    let recoveryOrchestrator: { dispose: () => void } | null = null;

    afterEach(() => {
      try {
        recoveryOrchestrator?.dispose();
      } finally {
        recoveryOrchestrator = null;
        vi.useRealTimers();
      }
    });

    it('probe succeeds → resets to primary, writes recovered audit, closes circuit, probe was called', async () => {
      vi.useFakeTimers();

      const probe = vi.fn().mockResolvedValue(true);
      const primary = buildProvider('openai', {
        complete: vi.fn().mockRejectedValue(new Error('upstream-down')),
        probe,
      });
      const secondary = buildProvider('anthropic');
      const { orchestrator, audit } = buildOrchestrator([primary, secondary]);
      recoveryOrchestrator = orchestrator;

      for (let i = 0; i < 5; i += 1) {
        await expect(orchestrator.complete('hi', [], { model: 'gpt-4o' })).rejects.toThrow(
          'upstream-down',
        );
      }
      await Promise.resolve();
      await Promise.resolve();
      expect(orchestrator.getActiveProvider().name).toBe('anthropic');

      await vi.advanceTimersByTimeAsync(900_000);
      await Promise.resolve();
      await Promise.resolve();

      expect(probe).toHaveBeenCalled();
      expect(orchestrator.getActiveProvider().name).toBe('openai');

      const status = orchestrator.getProviderStatus();
      expect(status.circuit_open).toBe(false);

      const calls = (audit.write as unknown as ReturnType<typeof vi.fn>).mock.calls;
      const recoveredCall = calls.find(
        (c: Array<{ event_type: string }>) => c[0]?.event_type === 'llm.provider.recovered',
      );
      expect(recoveredCall).toBeDefined();
      expect(recoveredCall?.[0]).toMatchObject({
        event_type: 'llm.provider.recovered',
        household_id: 'system',
        request_id: 'health-check',
        metadata: expect.objectContaining({ from: 'anthropic', to: 'openai' }),
      });
    });

    it('probe returns false → no recovered audit, stays on secondary', async () => {
      vi.useFakeTimers();

      const probe = vi.fn().mockResolvedValue(false);
      const primary = buildProvider('openai', {
        complete: vi.fn().mockRejectedValue(new Error('upstream-down')),
        probe,
      });
      const secondary = buildProvider('anthropic');
      const { orchestrator, audit } = buildOrchestrator([primary, secondary]);
      recoveryOrchestrator = orchestrator;

      for (let i = 0; i < 5; i += 1) {
        await expect(orchestrator.complete('hi', [], { model: 'gpt-4o' })).rejects.toThrow(
          'upstream-down',
        );
      }
      await Promise.resolve();
      await Promise.resolve();
      expect(orchestrator.getActiveProvider().name).toBe('anthropic');

      await vi.advanceTimersByTimeAsync(900_000);
      await Promise.resolve();
      await Promise.resolve();

      expect(probe).toHaveBeenCalled();
      // No swap-back; system stays on secondary.
      expect(orchestrator.getActiveProvider().name).toBe('anthropic');

      const calls = (audit.write as unknown as ReturnType<typeof vi.fn>).mock.calls;
      const recoveredCall = calls.find(
        (c: Array<{ event_type: string }>) => c[0]?.event_type === 'llm.provider.recovered',
      );
      expect(recoveredCall).toBeUndefined();
    });

    it('probe throws → swallowed, no recovered audit, no crash', async () => {
      vi.useFakeTimers();

      const probe = vi.fn().mockRejectedValue(new Error('probe-network-error'));
      const primary = buildProvider('openai', {
        complete: vi.fn().mockRejectedValue(new Error('upstream-down')),
        probe,
      });
      const secondary = buildProvider('anthropic');
      const { orchestrator, audit } = buildOrchestrator([primary, secondary]);
      recoveryOrchestrator = orchestrator;

      for (let i = 0; i < 5; i += 1) {
        await expect(orchestrator.complete('hi', [], { model: 'gpt-4o' })).rejects.toThrow(
          'upstream-down',
        );
      }
      await Promise.resolve();
      await Promise.resolve();

      // Recovery callback fires here; probe throws; handler should swallow.
      await vi.advanceTimersByTimeAsync(900_000);
      await Promise.resolve();
      await Promise.resolve();

      expect(probe).toHaveBeenCalled();
      expect(orchestrator.getActiveProvider().name).toBe('anthropic');

      const calls = (audit.write as unknown as ReturnType<typeof vi.fn>).mock.calls;
      const recoveredCall = calls.find(
        (c: Array<{ event_type: string }>) => c[0]?.event_type === 'llm.provider.recovered',
      );
      expect(recoveredCall).toBeUndefined();
    });
  });

  // Story 3-S32 — KitchenMap renderer + planWeek injection tests
  describe('renderPlannerKitchenMapBlock', () => {
    const CHILD_A_ID = '22222222-2222-4222-8222-222222222222';
    const CHILD_B_ID = '33333333-3333-4333-8333-333333333333';

    function buildMinimalKitchenMap(overrides: Partial<KitchenMap> = {}): KitchenMap {
      return {
        household: {
          id: HOUSEHOLD_ID,
          tier: 'standard',
          tier_variant: 'control',
          timezone: 'America/Toronto',
          display_name: 'The Sharma Family',
          cultural_identifiers: ['south_asian', 'hindu_vegetarian'],
          dietary_preferences: [],
          declared_allergens: ['peanuts'],
        },
        caregivers: [],
        children: [
          {
            id: CHILD_A_ID,
            name: 'Layla',
            age_band: 'child',
            declared_allergens: ['tree_nuts', 'sesame'],
            cultural_identifiers: [],
            dietary_preferences: ['vegetarian'],
            bag_composition: { main: true, snack: true, extra: true },
            bag_composition_pattern: null,
            school_policies: ['no_heating:main'],
            extra_rules: { pinned: ['fruit pouch'], banned: [] },
          },
          {
            id: CHILD_B_ID,
            name: 'Zara',
            age_band: 'toddler',
            declared_allergens: [],
            cultural_identifiers: [],
            dietary_preferences: [],
            bag_composition: { main: true, snack: true, extra: false },
            bag_composition_pattern: null,
            school_policies: [],
            extra_rules: { pinned: [], banned: [] },
          },
        ],
        cultural: {
          active: [
            {
              key: 'hindu_vegetarian',
              label: 'Hindu Vegetarian',
              state: 'active',
              tier: 'L1',
              confidence: 90,
              presence: 85,
              enforcement: 'non_negotiable',
            },
          ],
          suggested: [],
        },
        memory: {
          nodes: [
            {
              node_type: 'rhythm',
              facet: 'vinegar-avoidance',
              prose_text: 'Layla refuses anything with strong vinegar taste (enforcement: strong)',
              subject_child_id: CHILD_A_ID,
            },
          ],
        },
        household_extras: { library: [] },
        recipes: {
          favourites: [
            {
              recipe_id: '44444444-4444-4444-8444-444444444444',
              canonical_name: 'Chana Masala Wraps',
              primary_ingredient_key: 'chickpea',
              cuisine_tags: ['indian'],
              confidence_score: 92,
              is_household_favorite: true,
              catalog_provenance: 'declared',
              use_count: 5,
              last_used_at: '2026-06-10T00:00:00.000Z',
            },
            {
              recipe_id: '55555555-5555-4555-8555-555555555555',
              canonical_name: 'Dosa with Sambar',
              primary_ingredient_key: 'rice',
              cuisine_tags: ['south_indian'],
              confidence_score: 88,
              is_household_favorite: true,
              catalog_provenance: 'declared',
              use_count: 3,
              last_used_at: '2026-05-20T00:00:00.000Z',
            },
          ],
          banned: [],
        },
        allergens: [],
        dietary: [],
        food_preferences: [
          {
            child_id: CHILD_A_ID,
            item: 'paneer',
            valence: 'loves',
            enforcement: 'strong',
            source: 'onboarding_declared',
          },
        ],
        favorite_lunches: [],
        rules: [
          {
            rule_type: 'no_beef',
            custom_label: null,
            enforcement: 'non_negotiable',
            source: 'onboarding_declared',
          },
          {
            rule_type: 'custom',
            custom_label: 'Soft textures only for Zara',
            enforcement: 'strong',
            source: 'onboarding_declared',
          },
        ],
        meta: {
          composed_at: '2026-06-17T00:00:00.000Z',
          map_version: 1,
          schema_version: '1.1.0',
          is_complete: true,
          required_set_complete: true,
        },
        ...overrides,
      };
    }

    it('returns empty string when children array is empty (incomplete onboarding guard)', () => {
      const map = buildMinimalKitchenMap({ children: [] });
      expect(renderPlannerKitchenMapBlock(map)).toBe('');
    });

    it('includes <user_profile> with YAML household, children, cultural, and recipes', () => {
      const map = buildMinimalKitchenMap();
      const block = renderPlannerKitchenMapBlock(map);

      expect(block).toContain('<user_profile>');
      expect(block).toContain('</user_profile>');
      expect(block).toContain('The Sharma Family');
      expect(block).toContain('America/Toronto');
      expect(block).toContain('peanuts');
      expect(block).toContain('Layla');
      expect(block).toContain('Zara');
      expect(block).toContain('hindu_vegetarian');
      expect(block).toContain('Chana Masala Wraps');
      expect(block).toContain('confidence: 92');
    });

    it('includes only non_negotiable and strong rules in the YAML', () => {
      const map = buildMinimalKitchenMap();
      const block = renderPlannerKitchenMapBlock(map);

      // Both rules are non_negotiable/strong, so both appear
      expect(block).toContain('no_beef');
      expect(block).toContain('Soft textures only for Zara');
    });

    it('omits soft rules from the YAML', () => {
      const map = buildMinimalKitchenMap({
        rules: [
          {
            rule_type: 'no_overnight_leftovers',
            custom_label: null,
            enforcement: 'soft',
            source: 'onboarding_declared',
          },
        ],
      });
      const block = renderPlannerKitchenMapBlock(map);
      expect(block).not.toContain('no_overnight_leftovers');
    });

    it('includes <household_memory> with memory nodes grouped by type', () => {
      const map = buildMinimalKitchenMap();
      const block = renderPlannerKitchenMapBlock(map);

      expect(block).toContain('<household_memory>');
      expect(block).toContain('</household_memory>');
      expect(block).toContain('Layla refuses anything with strong vinegar taste');
    });

    it('includes <household_memory> per-child food preferences', () => {
      const map = buildMinimalKitchenMap();
      const block = renderPlannerKitchenMapBlock(map);

      expect(block).toContain('Layla');
      expect(block).toContain('loves paneer');
    });

    it('does not duplicate the PER-CHILD FOOD PREFERENCES header when child_obsession nodes and food_preferences both exist', () => {
      const map = buildMinimalKitchenMap({
        memory: {
          nodes: [
            {
              node_type: 'child_obsession',
              facet: 'pasta-obsession',
              prose_text: 'Layla only wants pasta lately',
              subject_child_id: CHILD_A_ID,
            },
          ],
        },
        // food_preferences (paneer) comes from the base fixture
      });
      const block = renderPlannerKitchenMapBlock(map);

      const headerCount = block.split('PER-CHILD FOOD PREFERENCES:').length - 1;
      expect(headerCount).toBe(1);
      // child_obsession nodes render under their own distinct header
      expect(block).toContain('CHILD OBSESSIONS:');
      expect(block).toContain('Layla only wants pasta lately');
    });

    it('escapes quotes and newlines in free-text scalars so the block stays well-formed', () => {
      const map = buildMinimalKitchenMap({
        household: {
          id: HOUSEHOLD_ID,
          tier: 'standard',
          tier_variant: 'control',
          timezone: 'America/Toronto',
          display_name: 'The "Best" Family',
          cultural_identifiers: [],
          dietary_preferences: [],
          declared_allergens: [],
        },
        children: [
          {
            id: CHILD_A_ID,
            name: 'Mary "Mae"',
            age_band: 'child',
            declared_allergens: [],
            cultural_identifiers: [],
            dietary_preferences: [],
            bag_composition: { main: true, snack: true, extra: false },
            bag_composition_pattern: null,
            school_policies: [],
            extra_rules: { pinned: [], banned: [] },
          },
        ],
        memory: {
          nodes: [
            {
              node_type: 'rhythm',
              facet: 'multiline',
              prose_text: 'Line one\nLine two with "quotes"',
              subject_child_id: null,
            },
          ],
        },
      });
      const block = renderPlannerKitchenMapBlock(map);

      // Quotes are escaped in the YAML scalar (JSON.stringify form)
      expect(block).toContain('name: "Mary \\"Mae\\""');
      expect(block).toContain('display_name: "The \\"Best\\" Family"');
      // The multiline prose is collapsed onto a single markdown-list line
      expect(block).toContain('- Line one Line two with "quotes"');
      // No raw newline split the memory entry into two list items
      expect(block).not.toContain('- Line two with');
    });

    it('includes <memory_policy> with all 5 precedence rules', () => {
      const map = buildMinimalKitchenMap();
      const block = renderPlannerKitchenMapBlock(map);

      expect(block).toContain('<memory_policy>');
      expect(block).toContain('</memory_policy>');
      expect(block).toContain('1. Per-child declared_allergens');
      expect(block).toContain('5. Absence of a signal does NOT mean dislike');
    });

    it('caps favourites at top 10 by confidence_score', () => {
      const manyFavourites = Array.from({ length: 15 }, (_, i) => ({
        recipe_id: `${i}0000000-0000-4000-8000-000000000000`,
        canonical_name: `Recipe ${i}`,
        primary_ingredient_key: null,
        cuisine_tags: [],
        confidence_score: 50 + i,
        is_household_favorite: true,
        catalog_provenance: 'declared' as const,
        use_count: 1,
        last_used_at: '2026-01-01T00:00:00.000Z',
      }));
      const map = buildMinimalKitchenMap({ recipes: { favourites: manyFavourites, banned: [] } });
      const block = renderPlannerKitchenMapBlock(map);

      // Top 10 by confidence = recipes 14,13,12,...5 (confidence 64..55)
      // Recipe 14 should be present, Recipe 4 (confidence 54) should not
      expect(block).toContain('Recipe 14');
      expect(block).toContain('Recipe 5');
      expect(block).not.toContain('Recipe 4');
    });

    it('uses only the date part (YYYY-MM-DD) for last_used_at', () => {
      const map = buildMinimalKitchenMap();
      const block = renderPlannerKitchenMapBlock(map);

      expect(block).toContain('2026-06-10');
      expect(block).not.toContain('T00:00:00');
    });
  });

  describe('planWeek KitchenMap injection (Story 3-S32)', () => {
    let savedComposeSpec: ToolSpec;

    beforeEach(() => {
      savedComposeSpec = TOOL_MANIFEST.get('plan.compose')!;
    });

    afterEach(() => {
      TOOL_MANIFEST.set('plan.compose', savedComposeSpec);
    });

    const MINIMAL_PLAN_OUTPUT_KM = {
      plan_id: '99999999-9999-4999-8999-999999999911',
      household_id: HOUSEHOLD_ID,
      week_of: '2026-11-09',
      prompt_version: 'v2.5.0',
      main_assignments: [{ sequence: 1, recipe_id: '33333333-3333-4333-8333-333333333311' }],
      days: [
        {
          day: 'monday',
          slots: [
            {
              slot_kind: 'main',
              main_assignment_sequence: 1,
              variations: [{ child_id: CHILD_ID }],
            },
          ],
        },
      ],
    };

    function buildKitchenMapFixture(): KitchenMap {
      return {
        household: {
          id: HOUSEHOLD_ID,
          tier: 'standard',
          tier_variant: 'control',
          timezone: 'UTC',
          display_name: 'Test Family',
          cultural_identifiers: [],
          dietary_preferences: [],
          declared_allergens: [],
        },
        caregivers: [],
        children: [
          {
            id: CHILD_ID,
            name: 'Asha',
            age_band: 'child',
            declared_allergens: [],
            cultural_identifiers: [],
            dietary_preferences: [],
            bag_composition: { main: true, snack: true, extra: false },
            bag_composition_pattern: null,
            school_policies: [],
            extra_rules: { pinned: [], banned: [] },
          },
        ],
        cultural: { active: [], suggested: [] },
        memory: { nodes: [] },
        household_extras: { library: [] },
        recipes: { favourites: [], banned: [] },
        allergens: [],
        dietary: [],
        food_preferences: [],
        favorite_lunches: [],
        rules: [],
        meta: {
          composed_at: '2026-06-17T00:00:00.000Z',
          map_version: 1,
          schema_version: '1.1.0',
          is_complete: true,
          required_set_complete: true,
        },
      };
    }

    it('prepends <user_profile> block as the first content in user message when kitchenMap is supplied', async () => {
      let capturedUserContent: string | undefined;

      const provider = buildProvider('primary', {
        completeWithMessages: vi.fn().mockImplementation(
          (messages: Array<{ role: string; content: unknown }>) => {
            const userMsg = messages.find((m) => m.role === 'user');
            capturedUserContent = userMsg?.content as string | undefined;
            return Promise.resolve({
              content: null,
              toolCalls: [{ id: 'tc-km', name: 'plan.compose', arguments: MINIMAL_PLAN_OUTPUT_KM }],
              finishReason: 'tool_calls',
              usage: { promptTokens: 1, completionTokens: 1, cachedPromptTokens: 0 },
            });
          },
        ),
      });

      const { orchestrator } = buildOrchestrator([provider]);
      const composeSpec = TOOL_MANIFEST.get('plan.compose')!;
      TOOL_MANIFEST.set('plan.compose', {
        ...composeSpec,
        fn: vi.fn().mockResolvedValue(MINIMAL_PLAN_OUTPUT_KM),
      });

      await orchestrator.planWeek({
        householdId: HOUSEHOLD_ID,
        weekOf: '2026-11-09',
        requestId: 'req-km',
        kitchenMap: buildKitchenMapFixture(),
      });

      expect(capturedUserContent).toBeDefined();
      expect(capturedUserContent!.trimStart()).toMatch(/^<user_profile>/);
      expect(capturedUserContent).toContain('<household_memory>');
      expect(capturedUserContent).toContain('<memory_policy>');
    });

    it('starts user message with "Household ID:" when kitchenMap is undefined', async () => {
      let capturedUserContent: string | undefined;

      const provider = buildProvider('primary', {
        completeWithMessages: vi.fn().mockImplementation(
          (messages: Array<{ role: string; content: unknown }>) => {
            const userMsg = messages.find((m) => m.role === 'user');
            capturedUserContent = userMsg?.content as string | undefined;
            return Promise.resolve({
              content: null,
              toolCalls: [{ id: 'tc-no-km', name: 'plan.compose', arguments: MINIMAL_PLAN_OUTPUT_KM }],
              finishReason: 'tool_calls',
              usage: { promptTokens: 1, completionTokens: 1, cachedPromptTokens: 0 },
            });
          },
        ),
      });

      const { orchestrator } = buildOrchestrator([provider]);
      const composeSpec = TOOL_MANIFEST.get('plan.compose')!;
      TOOL_MANIFEST.set('plan.compose', {
        ...composeSpec,
        fn: vi.fn().mockResolvedValue(MINIMAL_PLAN_OUTPUT_KM),
      });

      await orchestrator.planWeek({
        householdId: HOUSEHOLD_ID,
        weekOf: '2026-11-09',
        requestId: 'req-no-km',
      });

      expect(capturedUserContent).toBeDefined();
      expect(capturedUserContent!.trimStart()).toMatch(/^Household ID:/);
    });

    it('omits <user_profile> block when kitchenMap.children is empty', async () => {
      let capturedUserContent: string | undefined;

      const provider = buildProvider('primary', {
        completeWithMessages: vi.fn().mockImplementation(
          (messages: Array<{ role: string; content: unknown }>) => {
            const userMsg = messages.find((m) => m.role === 'user');
            capturedUserContent = userMsg?.content as string | undefined;
            return Promise.resolve({
              content: null,
              toolCalls: [{ id: 'tc-empty', name: 'plan.compose', arguments: MINIMAL_PLAN_OUTPUT_KM }],
              finishReason: 'tool_calls',
              usage: { promptTokens: 1, completionTokens: 1, cachedPromptTokens: 0 },
            });
          },
        ),
      });

      const { orchestrator } = buildOrchestrator([provider]);
      const composeSpec = TOOL_MANIFEST.get('plan.compose')!;
      TOOL_MANIFEST.set('plan.compose', {
        ...composeSpec,
        fn: vi.fn().mockResolvedValue(MINIMAL_PLAN_OUTPUT_KM),
      });

      const emptyChildrenMap = { ...buildKitchenMapFixture(), children: [] };
      await orchestrator.planWeek({
        householdId: HOUSEHOLD_ID,
        weekOf: '2026-11-09',
        requestId: 'req-empty',
        kitchenMap: emptyChildrenMap,
      });

      expect(capturedUserContent).toBeDefined();
      expect(capturedUserContent).not.toContain('<user_profile>');
      expect(capturedUserContent!.trimStart()).toMatch(/^Household ID:/);
    });
  });

  // Story 3-DM-C2 — planner.bad_output audit instrumentation. The .safeParse
  // swap at orchestrator.ts:430 (planner) / :593 (swap) must emit exactly one
  // audit row per structurally-invalid plan.compose result and still throw so
  // the BullMQ worker's failure semantics are unchanged.
  describe('planner.bad_output audit emission', () => {
    let savedComposeSpec: ToolSpec;

    beforeEach(() => {
      savedComposeSpec = TOOL_MANIFEST.get('plan.compose')!;
    });

    afterEach(() => {
      TOOL_MANIFEST.set('plan.compose', savedComposeSpec);
    });

    const STRUCTURALLY_INVALID_RESULT = {
      // Missing required tree fields (plan_id, main_assignments, days, etc.)
      // — schema rejects with at least one ZodIssue.
      not_a_plan: true,
    };

    it('planner path: structurally invalid plan.compose result → 1 planner.bad_output audit + throws', async () => {
      const provider = buildProvider('primary', {
        completeWithMessages: vi.fn().mockResolvedValue({
          content: null,
          toolCalls: [
            { id: 'tc-bad', name: 'plan.compose', arguments: STRUCTURALLY_INVALID_RESULT },
          ],
          finishReason: 'tool_calls',
          usage: { promptTokens: 1, completionTokens: 1, cachedPromptTokens: 0 },
        }),
      });

      const { orchestrator, audit } = buildOrchestrator([provider]);
      const composeSpec = TOOL_MANIFEST.get('plan.compose')!;
      TOOL_MANIFEST.set('plan.compose', {
        ...composeSpec,
        fn: vi.fn().mockResolvedValue(STRUCTURALLY_INVALID_RESULT),
      });

      await expect(
        orchestrator.planWeek({
          householdId: HOUSEHOLD_ID,
          weekOf: '2026-11-02',
          requestId: 'req-bad-planner',
        }),
      ).rejects.toThrow();

      const calls = (audit.write as unknown as ReturnType<typeof vi.fn>).mock.calls;
      const badOutputCalls = calls.filter(
        (c: Array<{ event_type: string }>) => c[0]?.event_type === 'planner.bad_output',
      );
      expect(badOutputCalls).toHaveLength(1);
      const auditCall = badOutputCalls[0]?.[0] as {
        event_type: string;
        household_id: string;
        request_id: string;
        metadata: { agent: string; weekOf: string; zodIssues: unknown };
      };
      expect(auditCall).toMatchObject({
        event_type: 'planner.bad_output',
        household_id: HOUSEHOLD_ID,
        request_id: 'req-bad-planner',
        metadata: {
          agent: 'planner',
          weekOf: '2026-11-02',
        },
      });
      expect(Array.isArray(auditCall.metadata.zodIssues)).toBe(true);
      expect((auditCall.metadata.zodIssues as unknown[]).length).toBeGreaterThan(0);
    });

    it('swap path: structurally invalid plan.compose result → 1 planner.bad_output audit (agent=swap) + throws', async () => {
      const provider = buildProvider('primary', {
        completeWithMessages: vi.fn().mockResolvedValue({
          content: null,
          toolCalls: [
            { id: 'tc-bad-swap', name: 'plan.compose', arguments: STRUCTURALLY_INVALID_RESULT },
          ],
          finishReason: 'tool_calls',
          usage: { promptTokens: 1, completionTokens: 1, cachedPromptTokens: 0 },
        }),
      });

      const { orchestrator, audit } = buildOrchestrator([provider]);
      const composeSpec = TOOL_MANIFEST.get('plan.compose')!;
      TOOL_MANIFEST.set('plan.compose', {
        ...composeSpec,
        fn: vi.fn().mockResolvedValue(STRUCTURALLY_INVALID_RESULT),
      });

      await expect(
        orchestrator.swapBlockedItems({
          householdId: HOUSEHOLD_ID,
          weekOf: '2026-11-02',
          requestId: 'req-bad-swap',
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
      ).rejects.toThrow();

      const calls = (audit.write as unknown as ReturnType<typeof vi.fn>).mock.calls;
      const badOutputCalls = calls.filter(
        (c: Array<{ event_type: string }>) => c[0]?.event_type === 'planner.bad_output',
      );
      expect(badOutputCalls).toHaveLength(1);
      const auditCall = badOutputCalls[0]?.[0] as {
        event_type: string;
        household_id: string;
        request_id: string;
        metadata: { agent: string; weekOf: string; zodIssues: unknown };
      };
      expect(auditCall).toMatchObject({
        event_type: 'planner.bad_output',
        household_id: HOUSEHOLD_ID,
        request_id: 'req-bad-swap',
        metadata: {
          agent: 'swap',
          weekOf: '2026-11-02',
        },
      });
      expect(Array.isArray(auditCall.metadata.zodIssues)).toBe(true);
      expect((auditCall.metadata.zodIssues as unknown[]).length).toBeGreaterThan(0);
    });
  });
});

// ===========================================================================
// Story 3-S36 — pre-loaded planner reads (child signals / pantry / slate)
// ===========================================================================

describe('renderPlannerChildSignalsBlock (Story 3-S36)', () => {
  const FULL_SIGNALS: ChildSignalOutput = {
    per_child: [
      {
        child_id: CHILD_ID,
        child_name: 'Layla',
        liked: [
          { recipe_id: 'r1', recipe_name: 'Chana Masala Wraps', slot_kind: 'main', count: 3, last_at: '2026-06-01' },
        ],
        disliked: [
          { recipe_id: 'r2', recipe_name: 'Capsicum Roll', slot_kind: 'main', count: 1, last_at: '2026-06-02' },
        ],
      },
    ],
    family_liked: [
      { recipe_id: 'r3', recipe_name: 'Paneer Wrap', slot_kind: 'main', child_count: 2 },
    ],
  };

  it('returns "" when there are no signals at all', () => {
    expect(renderPlannerChildSignalsBlock({ per_child: [], family_liked: [] })).toBe('');
  });

  it('renders per-child liked/disliked, family_liked, and the FR125 note', () => {
    const block = renderPlannerChildSignalsBlock(FULL_SIGNALS);
    expect(block.startsWith('<child_signals>')).toBe(true);
    expect(block.trimEnd().endsWith('</child_signals>')).toBe(true);
    expect(block).toContain('Layla: liked [Chana Masala Wraps (main)]; disliked [Capsicum Roll (main)]');
    expect(block).toContain('family_liked: Paneer Wrap (main, 2 children)');
    expect(block).toContain('absence of a signal = no data');
  });

  it('renders "(no recent signals)" for a child present with empty liked + disliked', () => {
    const block = renderPlannerChildSignalsBlock({
      per_child: [{ child_id: CHILD_ID, child_name: 'Zara', liked: [], disliked: [] }],
      family_liked: [],
    });
    expect(block).toContain('Zara: (no recent signals)');
  });
});

describe('renderPlannerPantryBlock (Story 3-S36)', () => {
  it('returns "" when on_hand is empty', () => {
    expect(renderPlannerPantryBlock({ on_hand: [] })).toBe('');
  });

  it('renders the on_hand list in a <pantry> block', () => {
    const block = renderPlannerPantryBlock({ on_hand: ['basmati rice', 'chickpeas'] });
    expect(block).toBe('<pantry>\non_hand: [basmati rice, chickpeas]\n</pantry>');
  });
});

describe('renderPlannerRecipeCandidatesBlock (Story 3-S36)', () => {
  const SLATE: PlannerRecipeCandidateSlate = {
    main: [
      {
        name: 'Chana Masala Wraps',
        cuisine_tags: ['indian'],
        allergen_flags: [],
        key_ingredients: ['chickpea', 'wrap'],
        confidence: 92,
      },
    ],
    snack: [],
    extra: [],
  };

  it('returns "" when all three groups are empty', () => {
    expect(renderPlannerRecipeCandidatesBlock({ main: [], snack: [], extra: [] })).toBe('');
  });

  it('renders grouped candidates with inline allergens + key ingredients', () => {
    const block = renderPlannerRecipeCandidatesBlock(SLATE);
    expect(block.startsWith('<recipe_candidates>')).toBe(true);
    expect(block).toContain('main:');
    expect(block).toContain('"Chana Masala Wraps"');
    expect(block).toContain('key_ingredients: ["chickpea","wrap"]');
    expect(block).toContain('confidence: 92');
    // Empty groups render as `kind: []`.
    expect(block).toContain('snack: []');
    expect(block).toContain('extra: []');
  });
});

describe('planWeek pre-loaded reads injection (Story 3-S36)', () => {
  let savedComposeSpec: ToolSpec;

  beforeEach(() => {
    savedComposeSpec = TOOL_MANIFEST.get('plan.compose')!;
  });

  afterEach(() => {
    TOOL_MANIFEST.set('plan.compose', savedComposeSpec);
  });

  const MINIMAL_PLAN_OUTPUT = {
    plan_id: '99999999-9999-4999-8999-999999999933',
    household_id: HOUSEHOLD_ID,
    week_of: '2026-11-09',
    prompt_version: 'v2.7.0',
    main_assignments: [{ sequence: 1, recipe_id: '33333333-3333-4333-8333-333333333333' }],
    days: [
      {
        day: 'monday',
        slots: [
          { slot_kind: 'main', main_assignment_sequence: 1, variations: [{ child_id: CHILD_ID }] },
        ],
      },
    ],
  };

  const SIGNALS: ChildSignalOutput = {
    per_child: [
      {
        child_id: CHILD_ID,
        child_name: 'Layla',
        liked: [{ recipe_id: 'r1', recipe_name: 'Dosa', slot_kind: 'snack', count: 2, last_at: '2026-06-01' }],
        disliked: [],
      },
    ],
    family_liked: [],
  };

  function captureUserContent(): {
    provider: LLMProvider;
    completeWithMessages: ReturnType<typeof vi.fn>;
    getContent: () => string | undefined;
  } {
    let captured: string | undefined;
    const completeWithMessages = vi.fn().mockImplementation(
      (messages: Array<{ role: string; content: unknown }>) => {
        const userMsg = messages.find((m) => m.role === 'user');
        captured = userMsg?.content as string | undefined;
        return Promise.resolve({
          content: null,
          toolCalls: [{ id: 'tc-pre', name: 'plan.compose', arguments: MINIMAL_PLAN_OUTPUT }],
          finishReason: 'tool_calls',
          usage: { promptTokens: 1, completionTokens: 1, cachedPromptTokens: 0 },
        });
      },
    );
    const provider = buildProvider('primary', { completeWithMessages });
    return { provider, completeWithMessages, getContent: () => captured };
  }

  function wireComposeStub(): void {
    const composeSpec = TOOL_MANIFEST.get('plan.compose')!;
    TOOL_MANIFEST.set('plan.compose', {
      ...composeSpec,
      fn: vi.fn().mockResolvedValue(MINIMAL_PLAN_OUTPUT),
    });
  }

  it('injects <child_signals>, <pantry>, and <recipe_candidates> blocks into the user message', async () => {
    const { provider, getContent } = captureUserContent();
    const { orchestrator } = buildOrchestrator([provider]);
    wireComposeStub();

    await orchestrator.planWeek({
      householdId: HOUSEHOLD_ID,
      weekOf: '2026-11-09',
      requestId: 'req-pre',
      childSignals: SIGNALS,
      pantrySnapshot: { on_hand: ['basmati rice'] },
      recipeCandidates: {
        main: [
          { name: 'Chana Masala Wraps', cuisine_tags: ['indian'], allergen_flags: [], key_ingredients: ['chickpea'], confidence: 90 },
        ],
        snack: [],
        extra: [],
      },
    });

    const content = getContent();
    expect(content).toContain('<child_signals>');
    expect(content).toContain('Layla: liked [Dosa (snack)]');
    expect(content).toContain('<pantry>');
    expect(content).toContain('on_hand: [basmati rice]');
    expect(content).toContain('<recipe_candidates>');
    expect(content).toContain('"Chana Masala Wraps"');
  });

  it('omits all three blocks when the pre-loads are absent (empty-safe fallback)', async () => {
    const { provider, getContent } = captureUserContent();
    const { orchestrator } = buildOrchestrator([provider]);
    wireComposeStub();

    await orchestrator.planWeek({
      householdId: HOUSEHOLD_ID,
      weekOf: '2026-11-09',
      requestId: 'req-pre-none',
    });

    const content = getContent();
    expect(content).not.toContain('<child_signals>');
    expect(content).not.toContain('<pantry>');
    expect(content).not.toContain('<recipe_candidates>');
  });

  it('issues plan.compose as the first/only tool call on the warm path (AC8)', async () => {
    const { provider, completeWithMessages } = captureUserContent();
    const { orchestrator } = buildOrchestrator([provider]);
    wireComposeStub();

    await orchestrator.planWeek({
      householdId: HOUSEHOLD_ID,
      weekOf: '2026-11-09',
      requestId: 'req-warm',
      childSignals: SIGNALS,
      pantrySnapshot: { on_hand: ['rice'] },
      recipeCandidates: {
        main: [
          { name: 'Chana Masala Wraps', cuisine_tags: ['indian'], allergen_flags: [], key_ingredients: ['chickpea'], confidence: 90 },
        ],
        snack: [],
        extra: [],
      },
    });

    // The loop exits after the first iteration — plan.compose was the first call.
    expect(completeWithMessages).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// Story 3-S37 — single-pass orchestration loop bound
// ===========================================================================

describe('planWeek loop bound (Story 3-S37)', () => {
  let savedComposeSpec: ToolSpec;

  beforeEach(() => {
    savedComposeSpec = TOOL_MANIFEST.get('plan.compose')!;
  });

  afterEach(() => {
    TOOL_MANIFEST.set('plan.compose', savedComposeSpec);
  });

  const MINIMAL_PLAN_OUTPUT = {
    plan_id: '99999999-9999-4999-8999-999999999937',
    household_id: HOUSEHOLD_ID,
    week_of: '2026-11-09',
    prompt_version: 'v2.7.0',
    main_assignments: [{ sequence: 1, recipe_id: '33333333-3333-4333-8333-333333333333' }],
    days: [
      {
        day: 'monday',
        slots: [
          { slot_kind: 'main', main_assignment_sequence: 1, variations: [{ child_id: CHILD_ID }] },
        ],
      },
    ],
  };

  const composeResponse = (id: string): LLMResponse => ({
    content: null,
    toolCalls: [{ id, name: 'plan.compose', arguments: MINIMAL_PLAN_OUTPUT }],
    finishReason: 'tool_calls',
    usage: { promptTokens: 1, completionTokens: 1, cachedPromptTokens: 0 },
  });

  // A retained fallback read tool (recipe.search). When the slate misses, the
  // planner issues one of these before composing — the loop must service it and
  // continue within the bound.
  const searchResponse = (id: string): LLMResponse => ({
    content: null,
    toolCalls: [{ id, name: 'recipe.search', arguments: { query: 'wrap' } }],
    finishReason: 'tool_calls',
    usage: { promptTokens: 1, completionTokens: 1, cachedPromptTokens: 0 },
  });

  function wireComposeStub(): void {
    const composeSpec = TOOL_MANIFEST.get('plan.compose')!;
    TOOL_MANIFEST.set('plan.compose', {
      ...composeSpec,
      fn: vi.fn().mockResolvedValue(MINIMAL_PLAN_OUTPUT),
    });
  }

  it('completes the happy path in a single plan.compose turn (AC2)', async () => {
    const completeWithMessages = vi.fn().mockResolvedValue(composeResponse('tc-warm'));
    const provider = buildProvider('primary', { completeWithMessages });
    const { orchestrator } = buildOrchestrator([provider]);
    wireComposeStub();

    const result = await orchestrator.planWeek({
      householdId: HOUSEHOLD_ID,
      weekOf: '2026-11-09',
      requestId: 'req-s37-warm',
      recipeCandidates: {
        main: [
          { name: 'Chana Masala Wraps', cuisine_tags: ['indian'], allergen_flags: [], key_ingredients: ['chickpea'], confidence: 90 },
        ],
        snack: [],
        extra: [],
      },
    });

    expect(result.plan_id).toBe(MINIMAL_PLAN_OUTPUT.plan_id);
    // Single LLM call — plan.compose was the first and only tool turn.
    expect(completeWithMessages).toHaveBeenCalledTimes(1);
  });

  it('calls the planner with the lowered compose temperature of 0.2 (3-S38 Opt #3)', async () => {
    const completeWithMessages = vi.fn().mockResolvedValue(composeResponse('tc-temp'));
    const provider = buildProvider('primary', { completeWithMessages });
    const { orchestrator } = buildOrchestrator([provider]);
    wireComposeStub();

    await orchestrator.planWeek({
      householdId: HOUSEHOLD_ID,
      weekOf: '2026-11-09',
      requestId: 'req-s38-temp',
    });

    const options = completeWithMessages.mock.calls[0][2] as { temperature: number; tier: string };
    expect(options.temperature).toBe(0.2);
    expect(options.tier).toBe('flagship');
  });

  it('services one fallback read tool then composes, staying within the bound (AC3)', async () => {
    let call = 0;
    const completeWithMessages = vi.fn().mockImplementation(() => {
      call += 1;
      return Promise.resolve(call === 1 ? searchResponse('tc-search') : composeResponse('tc-after-search'));
    });
    const provider = buildProvider('primary', { completeWithMessages });
    const { orchestrator } = buildOrchestrator([provider]);
    wireComposeStub();

    const result = await orchestrator.planWeek({
      householdId: HOUSEHOLD_ID,
      weekOf: '2026-11-09',
      requestId: 'req-s37-fallback',
    });

    expect(result.plan_id).toBe(MINIMAL_PLAN_OUTPUT.plan_id);
    // recipe.search (1) + plan.compose (1) = 2 turns, well inside the bound of 8.
    expect(completeWithMessages).toHaveBeenCalledTimes(2);
  });

  it('throws the terminal error after exceeding the bound when plan.compose is never called (AC1, AC3)', async () => {
    // The planner keeps issuing fallback read tools and never composes. The
    // loop services each one and stops at the lowered MAX_PLAN_ITERATIONS,
    // throwing the unchanged "did not call plan.compose" terminal error.
    const completeWithMessages = vi.fn().mockResolvedValue(searchResponse('tc-loop'));
    const provider = buildProvider('primary', { completeWithMessages });
    const { orchestrator } = buildOrchestrator([provider]);

    await expect(
      orchestrator.planWeek({
        householdId: HOUSEHOLD_ID,
        weekOf: '2026-11-09',
        requestId: 'req-s37-overbound',
      }),
    ).rejects.toThrow(/did not call plan\.compose within 8 iterations/);

    // Bound is 8 — the loop ran exactly that many LLM turns before giving up.
    expect(completeWithMessages).toHaveBeenCalledTimes(8);
  });
});
