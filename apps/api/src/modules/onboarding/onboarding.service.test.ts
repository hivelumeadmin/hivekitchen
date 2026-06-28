import { afterEach, describe, it, expect, vi } from 'vitest';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import {
  OnboardingService,
  momentToChipConfig,
  type OnboardingServiceDeps,
} from './onboarding.service.js';
// Slice 2.7-s7 — renderMomentStateBlock moved to the extracted turn runner.
import { renderMomentStateBlock } from './onboarding-turn-runner.js';
import type { MomentState } from './onboarding-moment.repository.js';
import { ConflictError } from '../../common/errors.js';

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

// Slice 2.6-s6 — relax the test-facing MomentState fixture so existing test
// cases can keep their inline literals (most don't care about the
// cold-start fields). buildService normalises this into the full MomentState
// shape before constructing the service.
type PartialMomentState = Omit<
  MomentState,
  'cold_start_triggered' | 'cold_start_trigger_reason'
> & {
  cold_start_triggered?: boolean;
  cold_start_trigger_reason?: string | null;
};

interface BuildOpts {
  agentText: string;
  preTurnMomentState?: PartialMomentState | null;
  countsOverride?: {
    household_name_set?: boolean;
    child_count?: number;
    child_allergen_count?: number;
    favorite_lunch_count?: number;
  };
  // Slice 2.6-s4 — optional CatalogProjectionService mock. When set, the
  // service's submitTextTurn invokes getM5Chips at m5_starting_line. When
  // undefined (legacy paths), chip_config falls back to whatever
  // momentToChipConfig returned (null for M5 after this slice).
  catalogProjectionGetM5Chips?:
    | ReturnType<typeof vi.fn>
    | (() => Promise<unknown>);
  // Story 3-S38 (Task 2) — wire a mock catalog-seed BullMQ queue so the guard
  // test can assert the Stage 1 seed is enqueued at m2_safe exit (the ordering
  // anchor that keeps seeding ahead of the first plan composition).
  wireCatalogSeedQueue?: boolean;
  // Slice 2.7-s5 — recorded tool-call summaries the agent mock returns. Used by
  // the ratification-via-tool tests to assert the M3 ratification chip renders
  // from a dietary.declare / cuisine.declare RESULT (not a prose sentinel).
  toolCallsSummary?: Array<{ tool: string; error: boolean; args?: unknown; result?: unknown }>;
}

function normalizeMomentState(
  raw: PartialMomentState | null | undefined,
): MomentState | null {
  if (raw === null || raw === undefined) return null;
  return {
    current_moment: raw.current_moment,
    required_set_status: raw.required_set_status,
    cold_start_triggered: raw.cold_start_triggered ?? false,
    cold_start_trigger_reason: raw.cold_start_trigger_reason ?? null,
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
      toolCallsSummary: opts.toolCallsSummary ?? [],
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
    getState: vi
      .fn()
      .mockResolvedValue(normalizeMomentState(opts.preTurnMomentState)),
    countRequiredSetSources: vi.fn().mockResolvedValue(counts),
    upsertState: vi.fn().mockResolvedValue(undefined),
  };

  const catalogProjection =
    opts.catalogProjectionGetM5Chips !== undefined
      ? {
          getM5Chips: opts.catalogProjectionGetM5Chips,
          // 2.6-s6 cold-start re-check polls Stage 1 before re-projecting; the
          // mock reports it complete so the projection runs.
          isStage1Complete: vi.fn().mockResolvedValue(true),
        }
      : undefined;

  const catalogSeedQueue = opts.wireCatalogSeedQueue
    ? { add: vi.fn().mockResolvedValue(undefined) }
    : undefined;

  const deps: OnboardingServiceDeps = {
    threads: threads as unknown as OnboardingServiceDeps['threads'],
    agent: agent as unknown as OnboardingServiceDeps['agent'],
    culturalPriorService: {} as OnboardingServiceDeps['culturalPriorService'],
    logger: makeLogger(),
    momentRepository:
      momentRepository as unknown as OnboardingServiceDeps['momentRepository'],
    catalogProjection:
      catalogProjection as unknown as OnboardingServiceDeps['catalogProjection'],
    catalogSeedQueue:
      catalogSeedQueue as unknown as OnboardingServiceDeps['catalogSeedQueue'],
  };

  const service = new OnboardingService(deps);
  return { service, threads, agent, momentRepository, catalogProjection, catalogSeedQueue };
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
    // Slice 2.6-s6 — null state defaults cold_start_triggered to false.
    expect(block).toContain('cold_start_triggered: false');
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
      cold_start_triggered: false,
      cold_start_trigger_reason: null,
    });
    expect(block).toContain('current_moment: summary');
    expect(block).toContain('m5_favorite_count: 10');
    expect(block).toContain('required_set_complete: true');
    expect(block).toContain('cold_start_triggered: false');
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
      cold_start_triggered: false,
      cold_start_trigger_reason: null,
    });
    expect(block).toContain('required_set_complete: false');
  });

  // Slice 2.6-s6 — cold-start fields render in the state block when the flag
  // is set, so the agent can branch into the conversational M5 prompt.
  it('renders cold_start_triggered=true with reason line when set (Slice 2.6-s6)', () => {
    const block = renderMomentStateBlock({
      current_moment: 'm5_starting_line',
      required_set_status: {
        m1_household_name: true,
        m1_child_declared: true,
        m2_allergen_response: true,
        m5_favorite_count: 0,
        m5_complete: false,
      },
      cold_start_triggered: true,
      cold_start_trigger_reason: 'per_cuisine_floor',
    });
    expect(block).toContain('cold_start_triggered: true');
    expect(block).toContain('cold_start_trigger_reason: per_cuisine_floor');
  });

  it('omits the reason line when cold_start_triggered=false (Slice 2.6-s6)', () => {
    const block = renderMomentStateBlock({
      current_moment: 'm1_table',
      required_set_status: {
        m1_household_name: false,
        m1_child_declared: false,
        m2_allergen_response: false,
        m5_favorite_count: 0,
        m5_complete: false,
      },
      cold_start_triggered: false,
      cold_start_trigger_reason: null,
    });
    expect(block).toContain('cold_start_triggered: false');
    expect(block).not.toContain('cold_start_trigger_reason:');
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
    expect(momentToChipConfig('pre_start')).toBeNull();
    expect(momentToChipConfig('summary')).toBeNull();
    expect(momentToChipConfig('finalized')).toBeNull();
  });

  it("momentToChipConfig('m5_starting_line') returns null (Slice 2.6-s4)", () => {
    // The static 18-chip catalog was deleted in 2.6-s4. M5 chips are now
    // injected dynamically in submitTextTurn from CatalogProjectionService.
    expect(momentToChipConfig('m5_starting_line')).toBeNull();
  });

  it('returns 4 single-select chips for m4_bag matching BagCompositionPattern (Slice 2.5-s8)', () => {
    const config = momentToChipConfig('m4_bag');
    expect(config).not.toBeNull();
    expect(config?.mode).toBe('action');
    expect(config?.options).toHaveLength(4);
    // Chip keys MUST match BagCompositionPatternSchema exactly so the agent
    // can hand them to child.upsert without translation.
    expect(config?.options?.map((o) => o.key)).toEqual([
      'main_only',
      'main_plus_snack',
      'main_plus_extra',
      'main_plus_snack_plus_extra',
    ]);
    // M4 is a required-response gate — NOT skippable.
    expect(config?.skip_label).toBeUndefined();
    expect(config?.hints).toBeUndefined();
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

  it('returns choice chips with first-class Skip for m3_taste (Slice 2.5-s7)', () => {
    const config = momentToChipConfig('m3_taste');
    expect(config).not.toBeNull();
    expect(config?.mode).toBe('choice');
    expect(config?.options).toBeDefined();
    // M3 is OPTIONAL — skip is first-class.
    expect(config?.skip_label).toBe('Skip this moment');
    // M3 is choice mode, not hint mode.
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

// Story 3-S38 (Task 2) — catalog-seed ordering guard. The Stage 1 catalog seed
// is enqueued (fire-and-forget) when the parent advances OUT of m2_safe during
// onboarding. This is the structural anchor that keeps seeding ahead of the
// first plan composition: the first compose only ever happens post-onboarding
// (on-demand "compose now", 3-S34; the auto-compose Friday cron, 3-S35, requires
// ≥1 prior plan so it never produces a household's first plan). These tests lock
// that enqueue so the cold-start discover storm can't silently return.
describe('OnboardingService.submitTextTurn — catalog-seed enqueue at m2_safe exit (3-S38)', () => {
  it('enqueues the Stage 1 catalog seed when advancing OUT of m2_safe', async () => {
    const { service, catalogSeedQueue } = buildService({
      agentText: 'All noted. [NEXT_MOMENT:m3_taste]',
      preTurnMomentState: {
        current_moment: 'm2_safe',
        required_set_status: {
          m1_household_name: true,
          m1_child_declared: true,
          m2_allergen_response: true,
          m5_favorite_count: 0,
          m5_complete: false,
        },
      },
      countsOverride: { household_name_set: true, child_count: 1 },
      wireCatalogSeedQueue: true,
    });

    await service.submitTextTurn({
      userId: USER_ID,
      householdId: HOUSEHOLD_ID,
      message: 'no known allergens',
    });

    expect(catalogSeedQueue?.add).toHaveBeenCalledTimes(1);
    const [jobName, payload] = catalogSeedQueue!.add.mock.calls[0];
    expect(jobName).toBe('seed-catalog');
    expect(payload).toMatchObject({ household_id: HOUSEHOLD_ID });
  });

  it('does NOT enqueue the seed on a turn that does not leave m2_safe', async () => {
    // Slice 2.7-s7 — the seed fires only on the controller's m2_safe EXIT. A
    // turn still in M1 (household not yet fully declared) never touches that
    // edge, so no Stage-1 seed fires. (The old "in m2 but no directive →
    // no advance" case is gone: under the deterministic controller any parent
    // response while in m2_safe IS the allergen answer and advances.)
    const { service, catalogSeedQueue } = buildService({
      agentText: 'And who else is at the table?',
      preTurnMomentState: {
        current_moment: 'm1_table',
        required_set_status: {
          m1_household_name: false,
          m1_child_declared: false,
          m2_allergen_response: false,
          m5_favorite_count: 0,
          m5_complete: false,
        },
      },
      countsOverride: { household_name_set: false, child_count: 0 },
      wireCatalogSeedQueue: true,
    });

    await service.submitTextTurn({
      userId: USER_ID,
      householdId: HOUSEHOLD_ID,
      message: 'Just me so far',
    });

    expect(catalogSeedQueue?.add).not.toHaveBeenCalled();
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

  it('strips all directives from the prose when duplicates appear (defense-in-depth)', async () => {
    // Slice 2.7-s7 — the directive is no longer PARSED to drive the moment
    // (the controller derives it from slot state); the strip stays purely so a
    // stray sentinel can never leak to the user.
    const { service } = buildService({
      agentText: 'Step one. [NEXT_MOMENT:m2_safe] Step two. [NEXT_MOMENT:m3_taste]',
    });

    const result = await service.submitTextTurn({
      userId: USER_ID,
      householdId: HOUSEHOLD_ID,
      message: 'x',
    });

    expect(result.lumi_response).not.toContain('[NEXT_MOMENT:');
    expect(result.lumi_response).toContain('Step two.');
  });
});

describe('OnboardingService.submitTextTurn — chip_config passthrough', () => {
  it('returns chip_config: null for the system summary moment (no chip set yet)', async () => {
    // Slice 2.5-s5 filled m1_table; 2.5-s6 filled m2_safe; 2.5-s7 filled
    // m3_taste; 2.5-s8 filled m4_bag; 2.5-s9 filled m5_starting_line. The
    // summary moment intentionally has no chip set — the client renders the
    // finalize card from the moment_key alone.
    const { service } = buildService({
      agentText: 'next.',
      preTurnMomentState: {
        current_moment: 'summary',
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
  });

  it('submitTextTurn injects personalized chips at m5_starting_line from CatalogProjectionService (Slice 2.6-s4)', async () => {
    const personalized = [
      { key: 'r-1', label: 'Anjero + suqaar', provenance: 'inferred' as const },
      { key: 'r-2', label: 'Bariis iskukaris', provenance: 'declared' as const },
      { key: 'r-3', label: 'Date bread + halib', provenance: 'parent_added' as const },
    ];
    const getM5Chips = vi
      .fn()
      .mockResolvedValue({ chips: personalized, coldStartReason: null });
    const { service } = buildService({
      agentText: 'pick favorites.',
      preTurnMomentState: {
        current_moment: 'm5_starting_line',
        required_set_status: {
          m1_household_name: true,
          m1_child_declared: true,
          m2_allergen_response: true,
          m5_favorite_count: 0,
          m5_complete: false,
        },
        cold_start_triggered: false,
        cold_start_trigger_reason: null,
      },
      catalogProjectionGetM5Chips: getM5Chips,
    });
    const result = await service.submitTextTurn({
      userId: USER_ID,
      householdId: HOUSEHOLD_ID,
      message: 'x',
    });
    // getM5Chips now takes (householdId, cuisineTags, allergenFilter, requiredDietaryFlags);
    // all three filter arrays default to [] when optional repos are absent (test path).
    expect(getM5Chips).toHaveBeenCalledWith(HOUSEHOLD_ID, [], [], []);
    expect(result.chip_config?.mode).toBe('choice');
    expect(result.chip_config?.options).toEqual(personalized);
    expect(result.cold_start_mode).toBe(false);
  });

  it('submitTextTurn appends override_fewer to personalized chips when favoriteLunchCount >= 4 (Slice 2.6-s4)', async () => {
    const personalized = [
      { key: 'r-1', label: 'Anjero + suqaar', provenance: 'declared' as const },
      { key: 'r-2', label: 'Bariis iskukaris', provenance: 'declared' as const },
    ];
    const getM5Chips = vi
      .fn()
      .mockResolvedValue({ chips: personalized, coldStartReason: null });
    const { service } = buildService({
      agentText: 'a few more?',
      preTurnMomentState: {
        current_moment: 'm5_starting_line',
        required_set_status: {
          m1_household_name: true,
          m1_child_declared: true,
          m2_allergen_response: true,
          m5_favorite_count: 4,
          m5_complete: false,
        },
        cold_start_triggered: false,
        cold_start_trigger_reason: null,
      },
      countsOverride: { favorite_lunch_count: 5 },
      catalogProjectionGetM5Chips: getM5Chips,
    });
    const result = await service.submitTextTurn({
      userId: USER_ID,
      householdId: HOUSEHOLD_ID,
      message: 'x',
    });
    const options = result.chip_config?.options ?? [];
    expect(options).toHaveLength(personalized.length + 1);
    expect(options[options.length - 1]).toEqual({
      key: 'override_fewer',
      label: 'Start with fewer',
    });
  });

  it('submitTextTurn leaves chip_config as null when catalogProjection throws (Slice 2.6-s4)', async () => {
    const getM5Chips = vi.fn().mockRejectedValue(new Error('catalog read failed'));
    const { service } = buildService({
      agentText: 'pick favorites.',
      preTurnMomentState: {
        current_moment: 'm5_starting_line',
        required_set_status: {
          m1_household_name: true,
          m1_child_declared: true,
          m2_allergen_response: true,
          m5_favorite_count: 0,
          m5_complete: false,
        },
      },
      catalogProjectionGetM5Chips: getM5Chips,
    });
    const result = await service.submitTextTurn({
      userId: USER_ID,
      householdId: HOUSEHOLD_ID,
      message: 'x',
    });
    // momentToChipConfig('m5_starting_line') returns null after 2.6-s4; the
    // catch leaves chip_config at that null. Turn still succeeds.
    expect(result.chip_config).toBeNull();
  });

  it('submitTextTurn skips personalization when catalogProjection dep is absent (Slice 2.6-s4)', async () => {
    const { service } = buildService({
      agentText: 'pick favorites.',
      preTurnMomentState: {
        current_moment: 'm5_starting_line',
        required_set_status: {
          m1_household_name: true,
          m1_child_declared: true,
          m2_allergen_response: true,
          m5_favorite_count: 0,
          m5_complete: false,
        },
      },
      // catalogProjectionGetM5Chips intentionally omitted
    });
    const result = await service.submitTextTurn({
      userId: USER_ID,
      householdId: HOUSEHOLD_ID,
      message: 'x',
    });
    // No catalog projection → momentToChipConfig('m5_starting_line') === null.
    expect(result.chip_config).toBeNull();
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

// ===========================================================================
// Slice 2.7-s5 — elevation via structured tool result (replaces the
// [CHIP_PROMPT:elevation:...] prose sentinel of 2.5-s7)
// ===========================================================================

describe('OnboardingService.submitTextTurn — ratification via tool result (Slice 2.7-s5)', () => {
  const m3State: MomentState = {
    current_moment: 'm3_taste',
    required_set_status: {
      m1_household_name: true,
      m1_child_declared: true,
      m2_allergen_response: true,
      m5_favorite_count: 0,
      m5_complete: false,
    },
    cold_start_triggered: false,
    cold_start_trigger_reason: null,
  };

  const ratifyingDietary = {
    tool: 'dietary.declare',
    error: false,
    args: { tag: 'halal', enforcement: 'non_negotiable', request_ratification: true },
    result: { dietary_id: 'd1', was_existing: false, ratification_requested: true },
  };

  it('renders the 3 ratification chips from a dietary.declare result, no sentinel in the prose', async () => {
    const { service, threads } = buildService({
      agentText:
        "Got it — 'strictly Halal.' Should I treat that as a hard rule or more like a preference? [NEXT_MOMENT:m3_taste]",
      preTurnMomentState: m3State,
      toolCallsSummary: [ratifyingDietary],
    });

    const result = await service.submitTextTurn({
      userId: USER_ID,
      householdId: HOUSEHOLD_ID,
      message: "We're strictly Halal.",
    });

    expect(result.chip_config?.mode).toBe('action');
    expect(result.chip_config?.options?.map((o) => o.key)).toEqual([
      'always-respect',
      'prefer',
      'just-context',
    ]);
    expect(result.chip_config?.skip_label).toBeUndefined();

    const lumiAppend = threads.appendTurnNext.mock.calls.find(
      (c) => (c[0] as { role?: string }).role === 'lumi',
    );
    const body = lumiAppend?.[0].body as { type: string; content: string };
    expect(body.content).not.toContain('[NEXT_MOMENT:');
    expect(body.content).toContain("'strictly Halal.'");
  });

  it('renders the ratification chips even when the agent omits [NEXT_MOMENT:] (stays at m3_taste)', async () => {
    const { service, momentRepository } = buildService({
      agentText: 'Should I treat that as a hard rule or a preference?',
      preTurnMomentState: m3State,
      countsOverride: { household_name_set: true, child_count: 1, child_allergen_count: 1 },
      toolCallsSummary: [ratifyingDietary],
    });

    const result = await service.submitTextTurn({
      userId: USER_ID,
      householdId: HOUSEHOLD_ID,
      message: 'x',
    });

    expect(result.chip_config?.mode).toBe('action');
    expect(momentRepository.upsertState).toHaveBeenCalledWith(
      HOUSEHOLD_ID,
      expect.objectContaining({ current_moment: 'm3_taste' }),
    );
  });

  it('does NOT render ratification chips when no tool result asked for it', async () => {
    const { service } = buildService({
      agentText: 'Tell me about your kitchen. [NEXT_MOMENT:m3_taste]',
      preTurnMomentState: m3State,
      toolCallsSummary: [
        { tool: 'dietary.declare', error: false, result: { dietary_id: 'd1', was_existing: false } },
      ],
    });

    const result = await service.submitTextTurn({
      userId: USER_ID,
      householdId: HOUSEHOLD_ID,
      message: 'x',
    });

    expect(result.chip_config?.mode).toBe('choice');
    expect(result.chip_config?.skip_label).toBe('Skip this moment');
  });

  it('defensively strips any stray legacy elevation sentinel from the persisted prose', async () => {
    const { service, threads } = buildService({
      agentText:
        'Got it. [CHIP_PROMPT:elevation:halal:Halal] [NEXT_MOMENT:m3_taste]',
      preTurnMomentState: m3State,
    });

    await service.submitTextTurn({
      userId: USER_ID,
      householdId: HOUSEHOLD_ID,
      message: 'x',
    });

    const lumiAppend = threads.appendTurnNext.mock.calls.find(
      (c) => (c[0] as { role?: string }).role === 'lumi',
    );
    const body = lumiAppend?.[0].body as { type: string; content: string };
    expect(body.content).not.toContain('[CHIP_PROMPT:');
    expect(body.content).not.toContain('[NEXT_MOMENT:');
  });
});

// ===========================================================================
// Slice 2.5-s10 — required-set surface + m5 override-path + finalize gate
// ===========================================================================

describe('OnboardingService.submitTextTurn — required_set_complete surface (Slice 2.5-s10)', () => {
  it('returns required_set_complete=true and missing_required_set=[] when all four conditions met', async () => {
    const { service } = buildService({
      agentText: 'All set.',
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
        favorite_lunch_count: 10,
      },
    });

    const result = await service.submitTextTurn({
      userId: USER_ID,
      householdId: HOUSEHOLD_ID,
      message: 'yes',
    });

    expect(result.required_set_complete).toBe(true);
    expect(result.missing_required_set).toEqual([]);
  });

  it('returns missing_required_set=["m5_starting_line"] when m5_complete is false (count below 10, no override)', async () => {
    const { service } = buildService({
      agentText: 'A few more lunches?',
      preTurnMomentState: {
        current_moment: 'm5_starting_line',
        required_set_status: {
          m1_household_name: true,
          m1_child_declared: true,
          m2_allergen_response: true,
          m5_favorite_count: 4,
          m5_complete: false,
        },
      },
      countsOverride: {
        household_name_set: true,
        child_count: 1,
        child_allergen_count: 1,
        favorite_lunch_count: 5,
      },
    });

    const result = await service.submitTextTurn({
      userId: USER_ID,
      householdId: HOUSEHOLD_ID,
      message: 'x',
    });

    expect(result.required_set_complete).toBe(false);
    expect(result.missing_required_set).toContain('m5_starting_line');
    expect(result.missing_required_set).not.toContain('m1_table');
    expect(result.missing_required_set).not.toContain('m2_safe');
  });
});

describe('OnboardingService.submitTextTurn — m5 override + sticky m5_complete (Slice 2.5-s10)', () => {
  it('override path: m5_complete = true when advancing from m5_starting_line with 6 items', async () => {
    const { service, momentRepository } = buildService({
      agentText: "Got it — I'll start with these. [NEXT_MOMENT:summary]",
      preTurnMomentState: {
        current_moment: 'm5_starting_line',
        required_set_status: {
          m1_household_name: true,
          m1_child_declared: true,
          m2_allergen_response: true,
          m5_favorite_count: 6,
          m5_complete: false,
        },
      },
      countsOverride: {
        household_name_set: true,
        child_count: 1,
        child_allergen_count: 1,
        favorite_lunch_count: 6,
      },
    });

    const result = await service.submitTextTurn({
      userId: USER_ID,
      householdId: HOUSEHOLD_ID,
      message: '[Chips selected: override_fewer]',
    });

    // Persisted state should have m5_complete=true via override-path detection.
    const upsertCall = momentRepository.upsertState.mock.calls[0];
    expect(upsertCall?.[1].current_moment).toBe('summary');
    expect(upsertCall?.[1].required_set_status.m5_complete).toBe(true);
    // Surface to client: required_set_complete true, no missing entries.
    expect(result.required_set_complete).toBe(true);
    expect(result.missing_required_set).toEqual([]);
  });

  it('override path: m5_complete = true at exact boundary count=4 (Slice 2.5-s10)', async () => {
    const { service, momentRepository } = buildService({
      agentText: "Got it — let's go. [NEXT_MOMENT:summary]",
      preTurnMomentState: {
        current_moment: 'm5_starting_line',
        required_set_status: {
          m1_household_name: true,
          m1_child_declared: true,
          m2_allergen_response: true,
          m5_favorite_count: 4,
          m5_complete: false,
        },
      },
      countsOverride: {
        household_name_set: true,
        child_count: 1,
        child_allergen_count: 1,
        favorite_lunch_count: 4,
      },
    });

    const result = await service.submitTextTurn({
      userId: USER_ID,
      householdId: HOUSEHOLD_ID,
      message: '[Chips selected: override_fewer]',
    });

    const upsertCall = momentRepository.upsertState.mock.calls[0];
    expect(upsertCall?.[1].required_set_status.m5_complete).toBe(true);
    expect(result.required_set_complete).toBe(true);
    expect(result.missing_required_set).toEqual([]);
  });

  it('sticky: m5_complete stays true on a second turn in summary even when count drops below 10', async () => {
    const { service, momentRepository } = buildService({
      agentText: 'Anything else to add?',
      preTurnMomentState: {
        current_moment: 'summary',
        required_set_status: {
          m1_household_name: true,
          m1_child_declared: true,
          m2_allergen_response: true,
          m5_favorite_count: 6,
          m5_complete: true,
        },
      },
      countsOverride: {
        household_name_set: true,
        child_count: 1,
        child_allergen_count: 1,
        favorite_lunch_count: 6,
      },
    });

    await service.submitTextTurn({
      userId: USER_ID,
      householdId: HOUSEHOLD_ID,
      message: 'nope, looks good',
    });

    const upsertCall = momentRepository.upsertState.mock.calls[0];
    expect(upsertCall?.[1].required_set_status.m5_complete).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// finalizeTextOnboarding gate + finalized write — Slice 2.5-s10
// ---------------------------------------------------------------------------

interface FinalizeBuildOpts {
  preTurnMomentState?: PartialMomentState | null;
  closedSummary?: boolean;
}

function buildFinalizableService(opts: FinalizeBuildOpts = {}) {
  // Real-message turns so the empty-thread guard doesn't fire and
  // turnsToLlmMessages has content for the LLM call.
  const turns = [
    {
      id: 'u1',
      thread_id: THREAD_ID,
      role: 'user',
      modality: 'text',
      body: { type: 'message', content: 'We are the Menons.' },
      created_at: new Date().toISOString(),
    },
    {
      id: 'l1',
      thread_id: THREAD_ID,
      role: 'lumi',
      modality: 'text',
      body: { type: 'message', content: 'Lovely.' },
      created_at: new Date().toISOString(),
    },
  ];

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
    listTurns: vi.fn().mockResolvedValue(turns),
    findClosedThreadByHousehold: vi.fn().mockResolvedValue(null),
    appendTurnNext: vi.fn().mockResolvedValue({ id: 'summary-turn-1' }),
    closeThread: vi.fn().mockResolvedValue(undefined),
  };

  const agent = {
    respond: vi.fn(),
    isSummaryConfirmed: vi.fn().mockResolvedValue(true),
    extractSummary: vi.fn().mockResolvedValue({
      cultural_templates: ['indian'],
      palate_notes: ['mild'],
      allergens_mentioned: [],
      family_rhythms: ['weekday-mornings'],
    }),
    inferCulturalPriors: vi.fn(),
    closingPhrase: vi.fn(),
  };

  const culturalPriorService = {
    inferFromSummary: vi.fn().mockResolvedValue(undefined),
  };

  const momentRepository = {
    getState: vi
      .fn()
      .mockResolvedValue(normalizeMomentState(opts.preTurnMomentState)),
    countRequiredSetSources: vi.fn(),
    upsertState: vi.fn().mockResolvedValue(undefined),
  };

  const deps: OnboardingServiceDeps = {
    threads: threads as unknown as OnboardingServiceDeps['threads'],
    agent: agent as unknown as OnboardingServiceDeps['agent'],
    culturalPriorService:
      culturalPriorService as unknown as OnboardingServiceDeps['culturalPriorService'],
    logger: makeLogger(),
    momentRepository:
      momentRepository as unknown as OnboardingServiceDeps['momentRepository'],
  };

  const service = new OnboardingService(deps);
  return { service, threads, agent, momentRepository, culturalPriorService };
}

describe('OnboardingService.finalizeTextOnboarding — required-set gate (Slice 2.5-s10)', () => {
  it('rejects with ConflictError when current_moment is not summary', async () => {
    const { service } = buildFinalizableService({
      preTurnMomentState: {
        current_moment: 'm3_taste',
        required_set_status: {
          m1_household_name: true,
          m1_child_declared: true,
          m2_allergen_response: true,
          m5_favorite_count: 10,
          m5_complete: true,
        },
      },
    });

    await expect(
      service.finalizeTextOnboarding({ userId: USER_ID, householdId: HOUSEHOLD_ID }),
    ).rejects.toThrowError(/summary not reached/);
    await expect(
      service.finalizeTextOnboarding({ userId: USER_ID, householdId: HOUSEHOLD_ID }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('rejects with ConflictError when required-set is not complete', async () => {
    const { service } = buildFinalizableService({
      preTurnMomentState: {
        current_moment: 'summary',
        required_set_status: {
          m1_household_name: true,
          m1_child_declared: true,
          m2_allergen_response: true,
          m5_favorite_count: 4,
          m5_complete: false,
        },
      },
    });

    await expect(
      service.finalizeTextOnboarding({ userId: USER_ID, householdId: HOUSEHOLD_ID }),
    ).rejects.toThrowError(/required fields incomplete/);
  });

  it('writes current_moment=finalized to momentRepository on a clean finalize', async () => {
    const { service, momentRepository } = buildFinalizableService({
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
    });

    await service.finalizeTextOnboarding({ userId: USER_ID, householdId: HOUSEHOLD_ID });

    expect(momentRepository.upsertState).toHaveBeenCalledWith(
      HOUSEHOLD_ID,
      expect.objectContaining({ current_moment: 'finalized' }),
    );
  });
});

// ===========================================================================
// Slice 2.6-s6 — Cold-start fallback wiring in submitTextTurn
// ===========================================================================

describe('OnboardingService.submitTextTurn — cold-start fallback (Slice 2.6-s6)', () => {
  it('cold-start result → chip_config=null and cold_start_mode=true', async () => {
    const getM5Chips = vi
      .fn()
      .mockResolvedValue({ chips: [], coldStartReason: 'per_cuisine_floor' });
    const { service, momentRepository } = buildService({
      agentText: 'tell me three dishes…',
      preTurnMomentState: {
        current_moment: 'm5_starting_line',
        required_set_status: {
          m1_household_name: true,
          m1_child_declared: true,
          m2_allergen_response: true,
          m5_favorite_count: 0,
          m5_complete: false,
        },
      },
      catalogProjectionGetM5Chips: getM5Chips,
    });
    const result = await service.submitTextTurn({
      userId: USER_ID,
      householdId: HOUSEHOLD_ID,
      message: 'x',
    });
    expect(result.chip_config).toBeNull();
    expect(result.cold_start_mode).toBe(true);
    const upsertCall = momentRepository.upsertState.mock.calls[0];
    expect(upsertCall?.[1].cold_start_triggered).toBe(true);
    expect(upsertCall?.[1].cold_start_trigger_reason).toBe('per_cuisine_floor');
  });

  it('relaxes m5_complete threshold to 3 when cold_start_triggered=true (Slice 2.6-s6 AC8)', async () => {
    // Cold-start flag carried forward from a prior turn. With the relaxed
    // threshold, exactly 3 declared items satisfies m5_complete.
    const getM5Chips = vi
      .fn()
      .mockResolvedValue({ chips: [], coldStartReason: null });
    const { service, momentRepository } = buildService({
      agentText: 'one more please.',
      preTurnMomentState: {
        current_moment: 'm5_starting_line',
        required_set_status: {
          m1_household_name: true,
          m1_child_declared: true,
          m2_allergen_response: true,
          m5_favorite_count: 2,
          m5_complete: false,
        },
        cold_start_triggered: true,
        cold_start_trigger_reason: 'per_cuisine_floor',
      },
      countsOverride: { favorite_lunch_count: 3 },
      catalogProjectionGetM5Chips: getM5Chips,
    });
    await service.submitTextTurn({
      userId: USER_ID,
      householdId: HOUSEHOLD_ID,
      message: 'one more',
    });
    const upsertCall = momentRepository.upsertState.mock.calls[0];
    expect(upsertCall?.[1].required_set_status.m5_complete).toBe(true);
    // Sticky flag carried forward into the upsert.
    expect(upsertCall?.[1].cold_start_triggered).toBe(true);
  });

  it('keeps m5_complete threshold at 10 when cold_start_triggered=false (Slice 2.6-s6 AC8)', async () => {
    // Same favorite_lunch_count=3, but cold-start is false → threshold is 10
    // → m5_complete stays false (this turn is not at m5_starting_line exit
    // so the m5OverridePath also can't kick in).
    const { service, momentRepository } = buildService({
      agentText: 'a few more.',
      preTurnMomentState: {
        current_moment: 'm5_starting_line',
        required_set_status: {
          m1_household_name: true,
          m1_child_declared: true,
          m2_allergen_response: true,
          m5_favorite_count: 2,
          m5_complete: false,
        },
        cold_start_triggered: false,
        cold_start_trigger_reason: null,
      },
      countsOverride: { favorite_lunch_count: 3 },
    });
    await service.submitTextTurn({
      userId: USER_ID,
      householdId: HOUSEHOLD_ID,
      message: 'three',
    });
    const upsertCall = momentRepository.upsertState.mock.calls[0];
    expect(upsertCall?.[1].required_set_status.m5_complete).toBe(false);
  });

  it('cold_start_triggered is sticky — flag carried forward when this turn is normal', async () => {
    // Pre-turn state has cold_start_triggered=true; this turn fires no fresh
    // cold-start (chips return normally). The upsertState call must still
    // pass cold_start_triggered=true to preserve the sticky flag.
    const getM5Chips = vi
      .fn()
      .mockResolvedValue({ chips: [], coldStartReason: null });
    const { service, momentRepository } = buildService({
      agentText: 'great.',
      preTurnMomentState: {
        current_moment: 'm5_starting_line',
        required_set_status: {
          m1_household_name: true,
          m1_child_declared: true,
          m2_allergen_response: true,
          m5_favorite_count: 1,
          m5_complete: false,
        },
        cold_start_triggered: true,
        cold_start_trigger_reason: 'stage1_timeout',
      },
      countsOverride: { favorite_lunch_count: 1 },
      catalogProjectionGetM5Chips: getM5Chips,
    });
    const result = await service.submitTextTurn({
      userId: USER_ID,
      householdId: HOUSEHOLD_ID,
      message: 'noted',
    });
    expect(result.cold_start_mode).toBe(true);
    const upsertCall = momentRepository.upsertState.mock.calls[0];
    expect(upsertCall?.[1].cold_start_triggered).toBe(true);
    expect(upsertCall?.[1].cold_start_trigger_reason).toBe('stage1_timeout');
  });
});

// Slice 2.7-s3 — ONBOARDING_TRACE_DIR per-turn agentic trace wiring. These
// cover the service-level gating (one artifact per turn when set; none when
// unset) and that the captured artifact reflects this turn's moment-state and
// usage. The OnboardingTracer's own field-by-field coverage lives in
// onboarding-tracer.test.ts.
describe('OnboardingService.submitTextTurn — ONBOARDING_TRACE_DIR (Slice 2.7-s3)', () => {
  const prev = process.env.ONBOARDING_TRACE_DIR;
  let dir: string | null = null;

  afterEach(async () => {
    if (prev === undefined) delete process.env.ONBOARDING_TRACE_DIR;
    else process.env.ONBOARDING_TRACE_DIR = prev;
    if (dir !== null) {
      await rm(dir, { recursive: true, force: true });
      dir = null;
    }
  });

  it('writes exactly one per-turn artifact capturing usage + moment-state when set', async () => {
    dir = await mkdtemp(join(tmpdir(), 'onboarding-trace-svc-'));
    process.env.ONBOARDING_TRACE_DIR = dir;

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

    await service.submitTextTurn({ userId: USER_ID, householdId: HOUSEHOLD_ID, message: 'next' });
    // The trace write is fire-and-forget inside the service — wait for the
    // artifact to land (event-driven, not a fixed sleep).
    const traceDir = dir;
    await vi.waitFor(async () => {
      expect(await readdir(traceDir)).toHaveLength(1);
    });

    const files = await readdir(dir);
    expect(files[0]).toContain(`${HOUSEHOLD_ID}__`);

    const json = JSON.parse(await readFile(join(dir, files[0]!), 'utf8')) as Record<string, unknown>;
    expect(json.household_id).toBe(HOUSEHOLD_ID);
    expect(json.usage).toMatchObject({ promptTokens: 100, completionTokens: 50, iterations: 1 });
    expect(json.moment_before).toMatchObject({ current_moment: 'm1_table' });
    expect(json.moment_after).toMatchObject({ current_moment: 'm2_safe' });
  });

  it('writes no artifact and does no trace work when unset', async () => {
    dir = await mkdtemp(join(tmpdir(), 'onboarding-trace-off-'));
    delete process.env.ONBOARDING_TRACE_DIR;

    const { service } = buildService({ agentText: 'Hello there.', preTurnMomentState: null });
    await service.submitTextTurn({ userId: USER_ID, householdId: HOUSEHOLD_ID, message: 'Hi' });
    await new Promise((r) => setImmediate(r));

    expect(await readdir(dir)).toHaveLength(0);
  });
});
