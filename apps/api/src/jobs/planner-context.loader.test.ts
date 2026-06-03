import { describe, it, expect, vi } from 'vitest';
import { loadHighActivityExtraProposalsForHousehold } from './planner-context.loader.js';
import type { PlanDayContextRepository } from '../modules/plans/plan-day-context.repository.js';
import type { PlannerBagComposition } from '../agents/orchestrator.js';
import type { PlanDayContext } from '@hivekitchen/types';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const CHILD_A = '22222222-2222-4222-8222-222222222222';
const CHILD_B = '33333333-3333-4333-8333-333333333333';

// weekOf = 2026-11-02 (Monday). Expected window: 2026-11-02..2026-11-06 (Fri).
const WEEK_OF = '2026-11-02';

function makeOverride(childId: string, date: string, type: PlanDayContext['context_type']): PlanDayContext {
  return {
    id: '00000000-0000-4000-8000-000000000000',
    plan_slot_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    child_id: childId,
    household_id: HOUSEHOLD_ID,
    override_date: date,
    context_type: type,
    is_lumi_proposed: false,
    confirmed_at: null,
    reverted_at: null,
    created_at: '2026-11-01T10:00:00.000Z',
    updated_at: '2026-11-01T10:00:00.000Z',
  };
}

function makeRepo(overrides: PlanDayContext[]): PlanDayContextRepository {
  return {
    findActiveByHousehold: vi.fn().mockResolvedValue(overrides),
  } as unknown as PlanDayContextRepository;
}

const extraOffCompositions: PlannerBagComposition[] = [
  { child_id: CHILD_A, child_name: 'Asha', snack: true, extra: false },
  { child_id: CHILD_B, child_name: 'Kai', snack: true, extra: false },
];

describe('loadHighActivityExtraProposalsForHousehold', () => {
  it('returns empty when all children have Extra ON', async () => {
    const repo = makeRepo([makeOverride(CHILD_A, '2026-11-04', 'sport_practice')]);
    const comps: PlannerBagComposition[] = [
      { child_id: CHILD_A, child_name: 'Asha', snack: true, extra: true },
    ];
    const result = await loadHighActivityExtraProposalsForHousehold(HOUSEHOLD_ID, WEEK_OF, comps, repo);
    expect(result).toEqual([]);
  });

  it('returns empty when no active overrides for the household', async () => {
    const repo = makeRepo([]);
    const result = await loadHighActivityExtraProposalsForHousehold(HOUSEHOLD_ID, WEEK_OF, extraOffCompositions, repo);
    expect(result).toEqual([]);
  });

  it('includes sport_practice and field_trip overrides within the Mon..Fri window', async () => {
    const repo = makeRepo([
      makeOverride(CHILD_A, '2026-11-04', 'sport_practice'), // Wednesday ✓
      makeOverride(CHILD_B, '2026-11-06', 'field_trip'),     // Friday ✓
    ]);
    const result = await loadHighActivityExtraProposalsForHousehold(HOUSEHOLD_ID, WEEK_OF, extraOffCompositions, repo);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ child_id: CHILD_A, override_date: '2026-11-04', context_type: 'sport_practice' });
    expect(result[1]).toMatchObject({ child_id: CHILD_B, override_date: '2026-11-06', context_type: 'field_trip' });
  });

  it('excludes Saturday overrides — window ends at Friday', async () => {
    const saturday = '2026-11-07';
    const repo = makeRepo([makeOverride(CHILD_A, saturday, 'sport_practice')]);
    const result = await loadHighActivityExtraProposalsForHousehold(HOUSEHOLD_ID, WEEK_OF, extraOffCompositions, repo);
    expect(result).toEqual([]);
  });

  it('excludes overrides before the plan week', async () => {
    const priorSunday = '2026-11-01';
    const repo = makeRepo([makeOverride(CHILD_A, priorSunday, 'field_trip')]);
    const result = await loadHighActivityExtraProposalsForHousehold(HOUSEHOLD_ID, WEEK_OF, extraOffCompositions, repo);
    expect(result).toEqual([]);
  });

  it('excludes overrides after the plan week', async () => {
    const nextMonday = '2026-11-09';
    const repo = makeRepo([makeOverride(CHILD_A, nextMonday, 'sport_practice')]);
    const result = await loadHighActivityExtraProposalsForHousehold(HOUSEHOLD_ID, WEEK_OF, extraOffCompositions, repo);
    expect(result).toEqual([]);
  });

  it('excludes non-high-activity override types', async () => {
    const repo = makeRepo([
      makeOverride(CHILD_A, '2026-11-04', 'half_day'),
      makeOverride(CHILD_A, '2026-11-04', 'post_dentist'),
      makeOverride(CHILD_A, '2026-11-04', 'test_day'),
    ]);
    const result = await loadHighActivityExtraProposalsForHousehold(HOUSEHOLD_ID, WEEK_OF, extraOffCompositions, repo);
    expect(result).toEqual([]);
  });

  it('excludes overrides for children whose Extra is ON', async () => {
    const repo = makeRepo([makeOverride(CHILD_A, '2026-11-04', 'field_trip')]);
    const comps: PlannerBagComposition[] = [
      { child_id: CHILD_A, child_name: 'Asha', snack: true, extra: true }, // Extra ON
    ];
    const result = await loadHighActivityExtraProposalsForHousehold(HOUSEHOLD_ID, WEEK_OF, comps, repo);
    expect(result).toEqual([]);
  });

  it('excludes children with null extra — null is not Extra-OFF', async () => {
    const repo = makeRepo([makeOverride(CHILD_A, '2026-11-04', 'sport_practice')]);
    const comps = [
      { child_id: CHILD_A, child_name: 'Asha', snack: true, extra: null as unknown as boolean },
    ] as PlannerBagComposition[];
    const result = await loadHighActivityExtraProposalsForHousehold(HOUSEHOLD_ID, WEEK_OF, comps, repo);
    expect(result).toEqual([]);
  });

  it('includes Monday and Friday boundary dates', async () => {
    const repo = makeRepo([
      makeOverride(CHILD_A, '2026-11-02', 'sport_practice'), // Monday (weekOf boundary)
      makeOverride(CHILD_B, '2026-11-06', 'field_trip'),     // Friday (+4 boundary)
    ]);
    const result = await loadHighActivityExtraProposalsForHousehold(HOUSEHOLD_ID, WEEK_OF, extraOffCompositions, repo);
    expect(result).toHaveLength(2);
  });

  it('includes child_name from bagCompositions in the proposal', async () => {
    const repo = makeRepo([makeOverride(CHILD_A, '2026-11-04', 'sport_practice')]);
    const result = await loadHighActivityExtraProposalsForHousehold(HOUSEHOLD_ID, WEEK_OF, extraOffCompositions, repo);
    expect(result[0]?.child_name).toBe('Asha');
  });

  it('deduplicates proposals for the same (child_id, override_date) — first match wins', async () => {
    const repo = makeRepo([
      makeOverride(CHILD_A, '2026-11-04', 'sport_practice'),
      makeOverride(CHILD_A, '2026-11-04', 'field_trip'), // same child, same date — duplicate
    ]);
    const result = await loadHighActivityExtraProposalsForHousehold(HOUSEHOLD_ID, WEEK_OF, extraOffCompositions, repo);
    expect(result).toHaveLength(1);
    expect(result[0]?.context_type).toBe('sport_practice');
  });
});
