import { describe, expect, it } from 'vitest';

import {
  CalendarExceptionSchema,
  CalendarTermSchema,
  CreateCalendarExceptionInputSchema,
  CreateCalendarTermInputSchema,
  FamilyCalendarResponseSchema,
} from './family-calendar.js';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const CHILD_ID = '22222222-2222-4222-8222-222222222222';
const TERM_ID = '33333333-3333-4333-8333-333333333333';

const baseTerm = {
  id: TERM_ID,
  household_id: HOUSEHOLD_ID,
  child_id: null,
  label: 'Autumn Term',
  start_date: '2026-09-01',
  end_date: '2026-12-18',
  weekdays: [1, 2, 3, 4, 5],
  source: 'manual',
  created_at: '2026-08-02T10:00:00.000Z',
};

const baseException = {
  id: TERM_ID,
  household_id: HOUSEHOLD_ID,
  child_id: null,
  on_date: '2026-10-26',
  kind: 'no_lunch',
  note: 'Half term',
  source: 'manual',
  created_at: '2026-08-02T10:00:00.000Z',
};

describe('CalendarTermSchema', () => {
  it('accepts a household-wide term row', () => {
    expect(CalendarTermSchema.safeParse(baseTerm).success).toBe(true);
  });

  it('accepts a child-scoped term row', () => {
    expect(CalendarTermSchema.safeParse({ ...baseTerm, child_id: CHILD_ID }).success).toBe(true);
  });

  it('rejects an empty weekday set', () => {
    expect(CalendarTermSchema.safeParse({ ...baseTerm, weekdays: [] }).success).toBe(false);
  });

  it.each([0, 7, -1, 1.5])('rejects weekday %s', (day) => {
    expect(CalendarTermSchema.safeParse({ ...baseTerm, weekdays: [day] }).success).toBe(false);
  });

  it('rejects a non-date start_date', () => {
    expect(CalendarTermSchema.safeParse({ ...baseTerm, start_date: '01/09/2026' }).success).toBe(
      false,
    );
  });
});

describe('CalendarExceptionSchema', () => {
  it('accepts an exception row', () => {
    expect(CalendarExceptionSchema.safeParse(baseException).success).toBe(true);
  });

  it.each(['no_lunch', 'early_release', 'school_meal', 'trip', 'other'])(
    'accepts kind %s',
    (kind) => {
      expect(CalendarExceptionSchema.safeParse({ ...baseException, kind }).success).toBe(true);
    },
  );

  it('rejects an unknown kind', () => {
    expect(CalendarExceptionSchema.safeParse({ ...baseException, kind: 'snow_day' }).success).toBe(
      false,
    );
  });

  it('accepts a null note', () => {
    expect(CalendarExceptionSchema.safeParse({ ...baseException, note: null }).success).toBe(true);
  });
});

describe('CreateCalendarTermInputSchema', () => {
  it('defaults child_id, weekdays and source', () => {
    const parsed = CreateCalendarTermInputSchema.parse({
      label: 'Autumn Term',
      start_date: '2026-09-01',
      end_date: '2026-12-18',
    });

    expect(parsed.child_id).toBeNull();
    expect(parsed.weekdays).toEqual([1, 2, 3, 4, 5]);
    expect(parsed.source).toBe('manual');
  });

  it('rejects end_date before start_date', () => {
    const result = CreateCalendarTermInputSchema.safeParse({
      label: 'Backwards',
      start_date: '2026-12-18',
      end_date: '2026-09-01',
    });

    expect(result.success).toBe(false);
  });

  it('accepts end_date equal to start_date', () => {
    const result = CreateCalendarTermInputSchema.safeParse({
      label: 'One day',
      start_date: '2026-09-01',
      end_date: '2026-09-01',
    });

    expect(result.success).toBe(true);
  });

  it('rejects unknown keys', () => {
    const result = CreateCalendarTermInputSchema.safeParse({
      label: 'Autumn Term',
      start_date: '2026-09-01',
      end_date: '2026-12-18',
      household_id: HOUSEHOLD_ID,
    });

    expect(result.success).toBe(false);
  });

  it('accepts a saturday-inclusive weekday set', () => {
    const parsed = CreateCalendarTermInputSchema.parse({
      label: 'Saturday school',
      start_date: '2026-09-01',
      end_date: '2026-12-18',
      weekdays: [1, 2, 3, 4, 5, 6],
    });

    expect(parsed.weekdays).toContain(6);
  });
});

describe('CreateCalendarExceptionInputSchema', () => {
  it('defaults child_id, note and source', () => {
    const parsed = CreateCalendarExceptionInputSchema.parse({
      on_date: '2026-10-26',
      kind: 'no_lunch',
    });

    expect(parsed.child_id).toBeNull();
    expect(parsed.note).toBeNull();
    expect(parsed.source).toBe('manual');
  });

  it('rejects a note over 200 characters', () => {
    const result = CreateCalendarExceptionInputSchema.safeParse({
      on_date: '2026-10-26',
      kind: 'other',
      note: 'x'.repeat(201),
    });

    expect(result.success).toBe(false);
  });
});

describe('FamilyCalendarResponseSchema', () => {
  it('round-trips terms and exceptions', () => {
    const payload = { terms: [baseTerm], exceptions: [baseException] };

    expect(FamilyCalendarResponseSchema.parse(payload)).toEqual(payload);
  });

  it('accepts an empty calendar', () => {
    expect(FamilyCalendarResponseSchema.parse({ terms: [], exceptions: [] })).toEqual({
      terms: [],
      exceptions: [],
    });
  });
});
