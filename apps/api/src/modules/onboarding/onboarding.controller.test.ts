import { describe, it, expect } from 'vitest';
import type { ChipConfig } from '@hivekitchen/contracts';
import { OnboardingController, type OnboardingSlots } from './onboarding.controller.js';

// ===========================================================================
// Slice 2.7-s6 — OnboardingController transition tests.
// ===========================================================================
// The headline maintainability win (AC4): these run with NO LLM mock at all.
// We feed slot states and assert the resulting moment + chip config. Each
// safety net the live path carries is mapped to a named predicate here (AC5),
// so s7 can delete the safety net and rely on the controller.
// ===========================================================================

const ALL_EMPTY: OnboardingSlots = {
  m1HouseholdName: false,
  m1ChildDeclared: false,
  m2AllergenResponse: false,
  m3Answered: false,
  m4Answered: false,
  m5Complete: false,
};

function slots(overrides: Partial<OnboardingSlots>): OnboardingSlots {
  return { ...ALL_EMPTY, ...overrides };
}

const controller = new OnboardingController();

describe('OnboardingController.nextMoment — forward-only slot-driven advance (AC2)', () => {
  it('promotes pre_start to m1_table (the pre_start → m1_table fallback, AC5)', () => {
    expect(controller.nextMoment('pre_start', ALL_EMPTY)).toBe('m1_table');
  });

  it('stays at m1_table until household_name AND a child are both present', () => {
    expect(controller.nextMoment('m1_table', slots({ m1ChildDeclared: true }))).toBe('m1_table');
    expect(controller.nextMoment('m1_table', slots({ m1HouseholdName: true }))).toBe('m1_table');
  });

  it('advances m1_table → m2_safe the instant M1 slots are filled', () => {
    expect(
      controller.nextMoment('m1_table', slots({ m1HouseholdName: true, m1ChildDeclared: true })),
    ).toBe('m2_safe');
  });

  it('advances m2_safe → m3_taste when an allergen response is recorded', () => {
    expect(controller.nextMoment('m2_safe', slots({ m2AllergenResponse: true }))).toBe('m3_taste');
    expect(controller.nextMoment('m2_safe', ALL_EMPTY)).toBe('m2_safe');
  });

  it('advances m3_taste → m4_bag when M3 is answered (M3 chip auto-advance net, AC5)', () => {
    expect(controller.nextMoment('m3_taste', slots({ m3Answered: true }))).toBe('m4_bag');
    expect(controller.nextMoment('m3_taste', ALL_EMPTY)).toBe('m3_taste');
  });

  it('advances m4_bag → m5_starting_line when a bag pattern is chosen (M4 chip net, AC5)', () => {
    expect(controller.nextMoment('m4_bag', slots({ m4Answered: true }))).toBe('m5_starting_line');
    expect(controller.nextMoment('m4_bag', ALL_EMPTY)).toBe('m4_bag');
  });

  it('advances m5_starting_line → summary when the starting line is complete', () => {
    expect(controller.nextMoment('m5_starting_line', slots({ m5Complete: true }))).toBe('summary');
    expect(controller.nextMoment('m5_starting_line', ALL_EMPTY)).toBe('m5_starting_line');
  });

  it('is forward-only: never steps backward when an earlier slot is unfilled', () => {
    // In m3_taste with M1 incomplete, the controller does NOT re-enter m1_table.
    expect(controller.nextMoment('m3_taste', ALL_EMPTY)).toBe('m3_taste');
  });

  it('caps at summary and treats summary/finalized as terminal', () => {
    const allFilled = slots({
      m1HouseholdName: true,
      m1ChildDeclared: true,
      m2AllergenResponse: true,
      m3Answered: true,
      m4Answered: true,
      m5Complete: true,
    });
    expect(controller.nextMoment('m1_table', allFilled)).toBe('summary');
    expect(controller.nextMoment('summary', allFilled)).toBe('summary');
    expect(controller.nextMoment('finalized', allFilled)).toBe('finalized');
  });
});

describe('OnboardingController.reconstructMoment — resume/reset from slots (AC6, AC5 re-anchor)', () => {
  it('reconstructs m1_table when M1 is incomplete', () => {
    expect(controller.reconstructMoment(ALL_EMPTY)).toBe('m1_table');
    expect(controller.reconstructMoment(slots({ m1ChildDeclared: true }))).toBe('m1_table');
  });

  it('reconstructs m2_safe when M1 is done but no allergen response yet', () => {
    expect(
      controller.reconstructMoment(slots({ m1HouseholdName: true, m1ChildDeclared: true })),
    ).toBe('m2_safe');
  });

  it('re-anchors to m4_bag when M1 and M2 are done, skipping the optional M3 (AC5)', () => {
    expect(
      controller.reconstructMoment(
        slots({ m1HouseholdName: true, m1ChildDeclared: true, m2AllergenResponse: true }),
      ),
    ).toBe('m4_bag');
  });

  it('reconstructs m5_starting_line when M4 is done but the starting line is not', () => {
    expect(
      controller.reconstructMoment(
        slots({
          m1HouseholdName: true,
          m1ChildDeclared: true,
          m2AllergenResponse: true,
          m4Answered: true,
        }),
      ),
    ).toBe('m5_starting_line');
  });

  it('reconstructs summary when every required slot is filled', () => {
    expect(
      controller.reconstructMoment(
        slots({
          m1HouseholdName: true,
          m1ChildDeclared: true,
          m2AllergenResponse: true,
          m4Answered: true,
          m5Complete: true,
        }),
      ),
    ).toBe('summary');
  });
});

describe('OnboardingController.chipConfig — slot-derived household-name swap (AC3)', () => {
  const BASE: ChipConfig = { mode: 'hint', hints: ['a', 'b', 'c'] };

  it('swaps to household-name hints when a child is declared but no name is set', () => {
    const result = controller.chipConfig(
      'm1_table',
      BASE,
      slots({ m1ChildDeclared: true, m1HouseholdName: false }),
    );
    expect(result?.mode).toBe('hint');
    expect(result?.hints).toEqual(['Menon Kitchen', 'The Khan Family', 'Smith Household']);
  });

  it('passes the base config through once the household name is set', () => {
    const result = controller.chipConfig(
      'm1_table',
      BASE,
      slots({ m1ChildDeclared: true, m1HouseholdName: true }),
    );
    expect(result).toBe(BASE);
  });

  it('passes the base config through when no child is declared yet', () => {
    const result = controller.chipConfig('m1_table', BASE, ALL_EMPTY);
    expect(result).toBe(BASE);
  });

  it('does not swap outside m1_table', () => {
    const m2Base: ChipConfig = { mode: 'choice', options: [] };
    const result = controller.chipConfig(
      'm2_safe',
      m2Base,
      slots({ m1ChildDeclared: true, m1HouseholdName: false }),
    );
    expect(result).toBe(m2Base);
  });

  it('passes a null base config through unchanged when no swap applies', () => {
    expect(controller.chipConfig('m5_starting_line', null, ALL_EMPTY)).toBeNull();
  });
});
