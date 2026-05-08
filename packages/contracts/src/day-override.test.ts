import { describe, it, expect } from 'vitest';
import {
  DayOverrideTypeSchema,
  DayOverrideSchema,
  SetDayOverrideInputSchema,
  SetDayOverrideResponseSchema,
} from './day-override.js';

const UUID = '11111111-1111-4111-8111-111111111111';
const UUID2 = '22222222-2222-4222-8222-222222222222';
const UUID3 = '33333333-3333-4333-8333-333333333333';
const UUID4 = '44444444-4444-4444-8444-444444444444';

describe('DayOverrideTypeSchema', () => {
  it.each([
    'bag_suspended',
    'half_day',
    'field_trip',
    'sick_day',
    'post_dentist',
    'early_release',
    'sport_practice',
    'test_day',
  ])('accepts %s', (value) => {
    expect(DayOverrideTypeSchema.safeParse(value).success).toBe(true);
  });

  it('rejects an unknown override type', () => {
    expect(DayOverrideTypeSchema.safeParse('snow_day').success).toBe(false);
  });
});

describe('DayOverrideSchema', () => {
  const baseRow = {
    id: UUID,
    plan_item_id: UUID2,
    child_id: UUID3,
    household_id: UUID4,
    override_date: '2026-05-06',
    override_type: 'sport_practice' as const,
    is_lumi_proposed: false,
    confirmed_at: '2026-05-06T08:00:00.000Z',
    reverted_at: null,
    created_at: '2026-05-06T08:00:00.000Z',
    updated_at: '2026-05-06T08:00:00.000Z',
  };

  it('round-trips a confirmed override row', () => {
    expect(DayOverrideSchema.safeParse(baseRow).success).toBe(true);
  });

  it('accepts a Lumi-proposed unconfirmed row (confirmed_at null)', () => {
    expect(
      DayOverrideSchema.safeParse({
        ...baseRow,
        is_lumi_proposed: true,
        confirmed_at: null,
      }).success,
    ).toBe(true);
  });

  it('rejects a malformed override_date', () => {
    expect(
      DayOverrideSchema.safeParse({ ...baseRow, override_date: '05/06/2026' }).success,
    ).toBe(false);
  });
});

describe('SetDayOverrideInputSchema', () => {
  const baseInput = {
    override_type: 'field_trip' as const,
    override_date: '2026-05-06',
    child_id: UUID3,
  };

  it('defaults is_lumi_proposed to false when omitted', () => {
    const parsed = SetDayOverrideInputSchema.parse(baseInput);
    expect(parsed.is_lumi_proposed).toBe(false);
  });

  it('rejects unknown extra keys (.strict)', () => {
    expect(
      SetDayOverrideInputSchema.safeParse({ ...baseInput, extra: 'x' }).success,
    ).toBe(false);
  });

  it('rejects an invalid date format', () => {
    expect(
      SetDayOverrideInputSchema.safeParse({ ...baseInput, override_date: 'tomorrow' }).success,
    ).toBe(false);
  });
});

describe('SetDayOverrideResponseSchema', () => {
  it('accepts a populated success body', () => {
    const body = {
      override: {
        id: UUID,
        plan_item_id: UUID2,
        child_id: UUID3,
        household_id: UUID4,
        override_date: '2026-05-06',
        override_type: 'sick_day' as const,
        is_lumi_proposed: false,
        confirmed_at: '2026-05-06T08:00:00.000Z',
        reverted_at: null,
        created_at: '2026-05-06T08:00:00.000Z',
        updated_at: '2026-05-06T08:00:00.000Z',
      },
      regen_triggered: false,
    };
    expect(SetDayOverrideResponseSchema.safeParse(body).success).toBe(true);
  });
});
