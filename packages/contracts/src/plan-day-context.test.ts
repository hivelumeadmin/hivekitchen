import { describe, it, expect } from 'vitest';
import {
  PlanDayContextTypeSchema,
  PlanDayContextSchema,
  SetPlanDayContextInputSchema,
  SetPlanDayContextResponseSchema,
} from './plan-day-context.js';

const UUID = '11111111-1111-4111-8111-111111111111';
const UUID2 = '22222222-2222-4222-8222-222222222222';
const UUID3 = '33333333-3333-4333-8333-333333333333';
const UUID4 = '44444444-4444-4444-8444-444444444444';

describe('PlanDayContextTypeSchema', () => {
  it.each([
    'half_day',
    'field_trip',
    'post_dentist',
    'early_release',
    'sport_practice',
    'test_day',
  ])('accepts %s', (value) => {
    expect(PlanDayContextTypeSchema.safeParse(value).success).toBe(true);
  });

  it('rejects an unknown context type', () => {
    expect(PlanDayContextTypeSchema.safeParse('snow_day').success).toBe(false);
  });

  it('rejects the retired pause-overlapping values', () => {
    expect(PlanDayContextTypeSchema.safeParse('bag_suspended').success).toBe(false);
    expect(PlanDayContextTypeSchema.safeParse('sick_day').success).toBe(false);
  });
});

describe('PlanDayContextSchema', () => {
  const baseRow = {
    id: UUID,
    plan_slot_id: UUID2,
    child_id: UUID3,
    household_id: UUID4,
    override_date: '2026-05-06',
    context_type: 'sport_practice' as const,
    is_lumi_proposed: false,
    confirmed_at: '2026-05-06T08:00:00.000Z',
    reverted_at: null,
    created_at: '2026-05-06T08:00:00.000Z',
    updated_at: '2026-05-06T08:00:00.000Z',
  };

  it('round-trips a confirmed context row', () => {
    expect(PlanDayContextSchema.safeParse(baseRow).success).toBe(true);
  });

  it('accepts a Lumi-proposed unconfirmed row (confirmed_at null)', () => {
    expect(
      PlanDayContextSchema.safeParse({
        ...baseRow,
        is_lumi_proposed: true,
        confirmed_at: null,
      }).success,
    ).toBe(true);
  });

  it('rejects a malformed override_date', () => {
    expect(
      PlanDayContextSchema.safeParse({ ...baseRow, override_date: '05/06/2026' }).success,
    ).toBe(false);
  });
});

describe('SetPlanDayContextInputSchema', () => {
  // Future date so the refine() (override_date must be today-or-later) accepts it.
  const baseInput = {
    context_type: 'field_trip' as const,
    override_date: '2099-01-15',
    child_id: UUID3,
  };

  it('defaults is_lumi_proposed to false when omitted', () => {
    const parsed = SetPlanDayContextInputSchema.parse(baseInput);
    expect(parsed.is_lumi_proposed).toBe(false);
  });

  it('rejects unknown extra keys (.strict)', () => {
    expect(
      SetPlanDayContextInputSchema.safeParse({ ...baseInput, extra: 'x' }).success,
    ).toBe(false);
  });

  it('rejects an invalid date format', () => {
    expect(
      SetPlanDayContextInputSchema.safeParse({ ...baseInput, override_date: 'tomorrow' }).success,
    ).toBe(false);
  });
});

describe('SetPlanDayContextResponseSchema', () => {
  it('accepts a populated success body', () => {
    const body = {
      override: {
        id: UUID,
        plan_slot_id: UUID2,
        child_id: UUID3,
        household_id: UUID4,
        override_date: '2026-05-06',
        context_type: 'field_trip' as const,
        is_lumi_proposed: false,
        confirmed_at: '2026-05-06T08:00:00.000Z',
        reverted_at: null,
        created_at: '2026-05-06T08:00:00.000Z',
        updated_at: '2026-05-06T08:00:00.000Z',
      },
      regen_triggered: false,
    };
    expect(SetPlanDayContextResponseSchema.safeParse(body).success).toBe(true);
  });
});
