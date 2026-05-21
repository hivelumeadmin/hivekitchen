import { describe, it, expect, vi } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import {
  OnboardingService,
  momentToChipConfig,
  renderMomentStateBlock,
  type OnboardingServiceDeps,
} from './onboarding.service.js';
import type { MomentState } from './onboarding-moment.repository.js';

// ===========================================================================
// Slice 2.5-s4 — OnboardingService new-behavior tests
// ===========================================================================
// Focused on the three pieces this slice introduces:
//   - renderMomentStateBlock (exported helper)
//   - submitTextTurn directive stripping (`[NEXT_MOMENT:...]` removed)
//   - submitTextTurn chip_config passthrough (always null in this slice)
// Pre-existing service paths (AC9 gate, R2-P5 greeting, F08 orphan recovery,
// finalize, getState/resetState) are exercised by onboarding.routes.test.ts.

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const THREAD_ID = '33333333-3333-4333-8333-333333333333';
const USER_TURN_ID = '44444444-4444-4444-8444-444444444444';
const LUMI_TURN_ID = '55555555-5555-4555-8555-555555555555';

function makeLogger(): FastifyBaseLogger {
  const fn = vi.fn();
  return {
    info: fn,
    warn: fn,
    error: fn,
    debug: fn,
    fatal: fn,
    trace: fn,
    child: () => makeLogger(),
    level: 'info',
    silent: () => {},
  } as unknown as FastifyBaseLogger;
}

interface BuildOpts {
  agentText: string;
  preTurnMomentState?: MomentState | null;
  countsOverride?: {
    household_name_set?: boolean;
    child_count?: number;
    child_allergen_count?: number;
    favorite_lunch_count?: number;
  };
}

function buildService(opts: BuildOpts) {
  const threads = {
    findActiveThreadByHousehold: vi.fn().mockResolvedValue({
      id: THREAD_ID,
      household_id: HOUSEHOLD_ID,
      type: 'onboarding',
      modality: 'text',
      status: 'active',
      created_at: new Date().toISOString(),
    }),
    createThread: vi.fn(),
    listTurns: vi.fn().mockResolvedValue([]),
    findClosedThreadByHousehold: vi.fn().mockResolvedValue(null),
    appendTurnNext: vi
      .fn()
      .mockResolvedValueOnce({ id: USER_TURN_ID })
      .mockResolvedValueOnce({ id: LUMI_TURN_ID }),
    closeThread: vi.fn(),
  };

  const agent = {
    respond: vi.fn().mockResolvedValue({
      text: opts.agentText,
      complete: false,
      toolCallsSummary: [],
      usage: {
        promptTokens: 100,
        completionTokens: 50,
        cachedPromptTokens: 0,
        iterations: 1,
      },
    }),
    isSummaryConfirmed: vi.fn().mockResolvedValue(false),
    extractSummary: vi.fn(),
    inferCulturalPriors: vi.fn(),
    closingPhrase: vi.fn(),
  };

  const counts = {
    household_name_set: opts.countsOverride?.household_name_set ?? false,
    child_count: opts.countsOverride?.child_count ?? 0,
    child_allergen_count: opts.countsOverride?.child_allergen_count ?? 0,
    favorite_lunch_count: opts.countsOverride?.favorite_lunch_count ?? 0,
  };

  const momentRepository = {
    getState: vi.fn().mockResolvedValue(opts.preTurnMomentState ?? null),
    countRequiredSetSources: vi.fn().mockResolvedValue(counts),
    upsertState: vi.fn().mockResolvedValue(undefined),
  };

  const deps: OnboardingServiceDeps = {
    threads: threads as unknown as OnboardingServiceDeps['threads'],
    agent: agent as unknown as OnboardingServiceDeps['agent'],
    culturalPriorService: {} as OnboardingServiceDeps['culturalPriorService'],
    logger: makeLogger(),
    momentRepository:
      momentRepository as unknown as OnboardingServiceDeps['momentRepository'],
  };

  const service = new OnboardingService(deps);
  return { service, threads, agent, momentRepository };
}

describe('renderMomentStateBlock', () => {
  it('returns the pre_start defaults when state is null', () => {
    const block = renderMomentStateBlock(null);
    expect(block).toContain('current_moment: pre_start');
    expect(block).toContain('m1_household_name: false');
    expect(block).toContain('m1_child_declared: false');
    expect(block).toContain('m2_allergen_response: false');
    expect(block).toContain('m5_favorite_count: 0');
    expect(block).toContain('m5_complete: false');
    expect(block).toContain('required_set_complete: false');
  });

  it('renders an in-flight state with required_set_complete=true when all four booleans pass', () => {
    const block = renderMomentStateBlock({
      current_moment: 'summary',
      required_set_status: {
        m1_household_name: true,
        m1_child_declared: true,
        m2_allergen_response: true,
        m5_favorite_count: 10,
        m5_complete: true,
      },
    });
    expect(block).toContain('current_moment: summary');
    expect(block).toContain('m5_favorite_count: 10');
    expect(block).toContain('required_set_complete: true');
  });

  it('renders required_set_complete=false when one required boolean is missing', () => {
    const block = renderMomentStateBlock({
      current_moment: 'm5_starting_line',
      required_set_status: {
        m1_household_name: true,
        m1_child_declared: true,
        m2_allergen_response: true,
        m5_favorite_count: 8,
        m5_complete: false,
      },
    });
    expect(block).toContain('required_set_complete: false');
  });
});

describe('momentToChipConfig', () => {
  it('returns 3 hint chips for m1_table (Slice 2.5-s5)', () => {
    const config = momentToChipConfig('m1_table');
    expect(config).not.toBeNull();
    expect(config?.mode).toBe('hint');
    expect(config?.hints).toHaveLength(3);
  });

  it('returns null for moments not yet populated', () => {
    expect(momentToChipConfig('m3_taste')).toBeNull();
    expect(momentToChipConfig('m4_bag')).toBeNull();
    expect(momentToChipConfig('m5_starting_line')).toBeNull();
    expect(momentToChipConfig('pre_start')).toBeNull();
    expect(momentToChipConfig('summary')).toBeNull();
    expect(momentToChipConfig('finalized')).toBeNull();
  });

  it('returns 10 multi-select chips for m2_safe with "No known allergens" first (Slice 2.5-s6)', () => {
    const config = momentToChipConfig('m2_safe');
    expect(config).not.toBeNull();
    expect(config?.mode).toBe('choice');
    expect(config?.options).toHaveLength(10);
    expect(config?.options?.[0]).toEqual({ key: 'none', label: 'No known allergens' });
    // M2 is the safety wall — NOT skippable and NOT hint-mode.
    expect(config?.skip_label).toBeUndefined();
    expect(config?.hints).toBeUndefined();
  });
});

describe('OnboardingService.submitTextTurn — moment_key in response (Slice 2.5-s5)', () => {
  it('returns moment_key="m1_table" on the first turn when no directive is emitted', async () => {
    const { service } = buildService({
      agentText: 'Hi, who are we planning for?',
      preTurnMomentState: null,
    });
    const result = await service.submitTextTurn({
      userId: USER_ID,
      householdId: HOUSEHOLD_ID,
      message: 'Hi',
    });
    expect(result.moment_key).toBe('m1_table');
  });

  it('returns moment_key="m2_safe" when the agent advances via [NEXT_MOMENT:m2_safe]', async () => {
    const { service } = buildService({
      agentText: 'Got it. [NEXT_MOMENT:m2_safe]',
      preTurnMomentState: {
        current_moment: 'm1_table',
        required_set_status: {
          m1_household_name: true,
          m1_child_declared: true,
          m2_allergen_response: false,
          m5_favorite_count: 0,
          m5_complete: false,
        },
      },
      countsOverride: { household_name_set: true, child_count: 1 },
    });
    const result = await service.submitTextTurn({
      userId: USER_ID,
      householdId: HOUSEHOLD_ID,
      message: 'next',
    });
    expect(result.moment_key).toBe('m2_safe');
  });
});

describe('OnboardingService.submitTextTurn — directive stripping', () => {
  it('strips a trailing [NEXT_MOMENT:m2_safe] from lumi_response', async () => {
    const { service } = buildService({
      agentText: 'Lovely, the Menons it is. [NEXT_MOMENT:m2_safe]',
    });

    const result = await service.submitTextTurn({
      userId: USER_ID,
      householdId: HOUSEHOLD_ID,
      message: 'We are the Menons',
    });

    expect(result.lumi_response).not.toContain('[NEXT_MOMENT:');
    expect(result.lumi_response).toBe('Lovely, the Menons it is.');
  });

  it('handles trailing whitespace after the directive', async () => {
    const { service } = buildService({
      agentText: 'Got it.   [NEXT_MOMENT:m3_taste]   \n',
    });

    const result = await service.submitTextTurn({
      userId: USER_ID,
      householdId: HOUSEHOLD_ID,
      message: 'no known allergens',
    });

    expect(result.lumi_response).toBe('Got it.');
  });

  it('leaves prose unchanged when no directive is present', async () => {
    const { service } = buildService({
      agentText: 'Tell me more about that.',
    });

    const result = await service.submitTextTurn({
      userId: USER_ID,
      householdId: HOUSEHOLD_ID,
      message: 'Hello',
    });

    expect(result.lumi_response).toBe('Tell me more about that.');
  });

  it('strips directives that appear mid-prose (global replace, not end-anchored)', async () => {
    const { service } = buildService({
      agentText: 'I noted [NEXT_MOMENT:m2_safe] in the middle. Carry on.',
    });

    const result = await service.submitTextTurn({
      userId: USER_ID,
      householdId: HOUSEHOLD_ID,
      message: 'X',
    });

    // Global strip removes ALL occurrences regardless of position.
    expect(result.lumi_response).not.toContain('[NEXT_MOMENT:');
    expect(result.lumi_response).toContain('Carry on.');
  });

  it('strips all directives when duplicates appear; last key is used for advance', async () => {
    const { service, momentRepository } = buildService({
      agentText: 'Step one. [NEXT_MOMENT:m2_safe] Step two. [NEXT_MOMENT:m3_taste]',
      preTurnMomentState: {
        current_moment: 'm1_table',
        required_set_status: {
          m1_household_name: true,
          m1_child_declared: true,
          m2_allergen_response: false,
          m5_favorite_count: 0,
          m5_complete: false,
        },
      },
      countsOverride: { household_name_set: true, child_count: 1 },
    });

    const result = await service.submitTextTurn({
      userId: USER_ID,
      householdId: HOUSEHOLD_ID,
      message: 'x',
    });

    // Both directives stripped from prose
    expect(result.lumi_response).not.toContain('[NEXT_MOMENT:');
    // Last directive (m3_taste) wins for the advance key
    expect(momentRepository.upsertState).toHaveBeenCalledWith(
      HOUSEHOLD_ID,
      expect.objectContaining({ current_moment: 'm3_taste' }),
    );
  });
});

describe('OnboardingService.submitTextTurn — chip_config passthrough', () => {
  it('returns chip_config: null for moments that have not yet been populated', async () => {
    // Slice 2.5-s5 filled m1_table; later slices will fill m2–m5. Until then,
    // those moments remain null. Note: pre_start is excluded because the
    // bootstrap logic advances it to m1_table on the first turn (which now
    // surfaces M1 hint chips).
    // Slice 2.5-s6 — m2_safe is now populated (10 choice chips); the moments
    // remaining as null-returning are the three later un-shipped slices plus
    // the system summary moment.
    const moments: Array<MomentState['current_moment']> = [
      'm3_taste',
      'm4_bag',
      'm5_starting_line',
      'summary',
    ];
    for (const moment of moments) {
      const { service } = buildService({
        agentText: 'next.',
        preTurnMomentState: {
          current_moment: moment,
          required_set_status: {
            m1_household_name: false,
            m1_child_declared: false,
            m2_allergen_response: false,
            m5_favorite_count: 0,
            m5_complete: false,
          },
        },
      });
      const result = await service.submitTextTurn({
        userId: USER_ID,
        householdId: HOUSEHOLD_ID,
        message: 'x',
      });
      expect(result.chip_config).toBeNull();
    }
  });

  it('returns the M1 hint chip config when current_moment advances into m1_table', async () => {
    // First turn (preTurnMomentState=null) bootstraps current_moment to m1_table,
    // so the post-turn chip_config should be M1's hint chips.
    const { service } = buildService({
      agentText: 'Hi, who are we planning for?',
      preTurnMomentState: null,
    });
    const result = await service.submitTextTurn({
      userId: USER_ID,
      householdId: HOUSEHOLD_ID,
      message: 'Hello',
    });
    expect(result.chip_config).not.toBeNull();
    expect(result.chip_config?.mode).toBe('hint');
    expect(result.chip_config?.hints).toHaveLength(3);
  });
});

describe('OnboardingService.submitTextTurn — backward transition rejection', () => {
  it('rejects a backward [NEXT_MOMENT:m1_table] directive when in m3_taste', async () => {
    const { service, momentRepository } = buildService({
      agentText: 'Back to m1. [NEXT_MOMENT:m1_table]',
      preTurnMomentState: {
        current_moment: 'm3_taste',
        required_set_status: {
          m1_household_name: true,
          m1_child_declared: true,
          m2_allergen_response: true,
          m5_favorite_count: 0,
          m5_complete: false,
        },
      },
      countsOverride: { household_name_set: true, child_count: 1, child_allergen_count: 1 },
    });

    await service.submitTextTurn({
      userId: USER_ID,
      householdId: HOUSEHOLD_ID,
      message: 'x',
    });

    // Backward directive is silently rejected; current_moment preserved at m3_taste.
    expect(momentRepository.upsertState).toHaveBeenCalledWith(
      HOUSEHOLD_ID,
      expect.objectContaining({ current_moment: 'm3_taste' }),
    );
  });
});

describe('OnboardingService.submitTextTurn — moment state advance', () => {
  it('advances current_moment to m2_safe when the agent emits [NEXT_MOMENT:m2_safe]', async () => {
    const { service, momentRepository } = buildService({
      agentText: 'Got it. [NEXT_MOMENT:m2_safe]',
      preTurnMomentState: {
        current_moment: 'm1_table',
        required_set_status: {
          m1_household_name: true,
          m1_child_declared: true,
          m2_allergen_response: false,
          m5_favorite_count: 0,
          m5_complete: false,
        },
      },
      countsOverride: { household_name_set: true, child_count: 1 },
    });

    await service.submitTextTurn({
      userId: USER_ID,
      householdId: HOUSEHOLD_ID,
      message: 'next',
    });

    expect(momentRepository.upsertState).toHaveBeenCalledWith(
      HOUSEHOLD_ID,
      expect.objectContaining({ current_moment: 'm2_safe' }),
    );
  });

  it('does not advance past summary even when the agent emits [NEXT_MOMENT:finalized]', async () => {
    const { service, momentRepository } = buildService({
      agentText: 'All set. [NEXT_MOMENT:finalized]',
      preTurnMomentState: {
        current_moment: 'summary',
        required_set_status: {
          m1_household_name: true,
          m1_child_declared: true,
          m2_allergen_response: true,
          m5_favorite_count: 10,
          m5_complete: true,
        },
      },
      countsOverride: {
        household_name_set: true,
        child_count: 1,
        child_allergen_count: 1,
        favorite_lunch_count: 10,
      },
    });

    await service.submitTextTurn({
      userId: USER_ID,
      householdId: HOUSEHOLD_ID,
      message: 'done',
    });

    expect(momentRepository.upsertState).toHaveBeenCalledWith(
      HOUSEHOLD_ID,
      expect.objectContaining({ current_moment: 'summary' }),
    );
  });

  it('flips m2_allergen_response = true when the agent advances out of m2_safe (no-allergen path)', async () => {
    const { service, momentRepository } = buildService({
      agentText: 'No allergens, good. [NEXT_MOMENT:m3_taste]',
      preTurnMomentState: {
        current_moment: 'm2_safe',
        required_set_status: {
          m1_household_name: true,
          m1_child_declared: true,
          m2_allergen_response: false,
          m5_favorite_count: 0,
          m5_complete: false,
        },
      },
      countsOverride: {
        household_name_set: true,
        child_count: 1,
        child_allergen_count: 0, // no allergen rows written
      },
    });

    await service.submitTextTurn({
      userId: USER_ID,
      householdId: HOUSEHOLD_ID,
      message: '[Chips selected: no_known_allergens]',
    });

    const upsertCall = momentRepository.upsertState.mock.calls[0];
    expect(upsertCall?.[1].required_set_status.m2_allergen_response).toBe(true);
  });

  it('first turn (pre_start, no directive) bootstraps current_moment to m1_table', async () => {
    const { service, momentRepository } = buildService({
      agentText: 'Hi, who are we planning for?',
      preTurnMomentState: null,
    });

    await service.submitTextTurn({
      userId: USER_ID,
      householdId: HOUSEHOLD_ID,
      message: 'Hi',
    });

    expect(momentRepository.upsertState).toHaveBeenCalledWith(
      HOUSEHOLD_ID,
      expect.objectContaining({ current_moment: 'm1_table' }),
    );
  });

  it('computes m5_complete = true when favorite_lunch_count >= 10', async () => {
    const { service, momentRepository } = buildService({
      agentText: 'Great list!',
      preTurnMomentState: {
        current_moment: 'm5_starting_line',
        required_set_status: {
          m1_household_name: true,
          m1_child_declared: true,
          m2_allergen_response: true,
          m5_favorite_count: 9,
          m5_complete: false,
        },
      },
      countsOverride: { favorite_lunch_count: 12 },
    });

    await service.submitTextTurn({
      userId: USER_ID,
      householdId: HOUSEHOLD_ID,
      message: 'more lunches',
    });

    const upsertCall = momentRepository.upsertState.mock.calls[0];
    expect(upsertCall?.[1].required_set_status.m5_complete).toBe(true);
    expect(upsertCall?.[1].required_set_status.m5_favorite_count).toBe(12);
  });

  it('required_set_status is all-true when all four conditions are met', async () => {
    const { service, momentRepository } = buildService({
      agentText: 'Everything is set!',
      preTurnMomentState: {
        current_moment: 'summary',
        required_set_status: {
          m1_household_name: true,
          m1_child_declared: true,
          m2_allergen_response: true,
          m5_favorite_count: 10,
          m5_complete: true,
        },
      },
      countsOverride: {
        household_name_set: true,
        child_count: 2,
        child_allergen_count: 1,
        favorite_lunch_count: 11,
      },
    });

    await service.submitTextTurn({
      userId: USER_ID,
      householdId: HOUSEHOLD_ID,
      message: 'great',
    });

    const upsertCall = momentRepository.upsertState.mock.calls[0];
    const rss = upsertCall?.[1].required_set_status;
    expect(rss?.m1_household_name).toBe(true);
    expect(rss?.m1_child_declared).toBe(true);
    expect(rss?.m2_allergen_response).toBe(true);
    expect(rss?.m5_complete).toBe(true);
  });

  it('required_set_status is all-false when nothing has been collected', async () => {
    const { service, momentRepository } = buildService({
      agentText: 'Hi, who are we planning for?',
      preTurnMomentState: null,
      countsOverride: {
        household_name_set: false,
        child_count: 0,
        child_allergen_count: 0,
        favorite_lunch_count: 0,
      },
    });

    await service.submitTextTurn({
      userId: USER_ID,
      householdId: HOUSEHOLD_ID,
      message: 'Hello',
    });

    const upsertCall = momentRepository.upsertState.mock.calls[0];
    const rss = upsertCall?.[1].required_set_status;
    expect(rss?.m1_household_name).toBe(false);
    expect(rss?.m1_child_declared).toBe(false);
    expect(rss?.m2_allergen_response).toBe(false);
    expect(rss?.m5_complete).toBe(false);
  });
});
