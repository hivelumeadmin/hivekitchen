import type { CalendarException, CalendarTerm } from '@hivekitchen/types';
import { describe, expect, it } from 'vitest';

import {
  addDaysIso,
  intersectDaySets,
  resolveLunchDays,
  weekDates,
} from './family-calendar.resolver.js';

// 2026-09-07 is a Monday.
const WEEK_OF = '2026-09-07';
const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const CHILD_ID = '22222222-2222-4222-8222-222222222222';

function term(overrides: Partial<CalendarTerm> = {}): CalendarTerm {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    household_id: HOUSEHOLD_ID,
    child_id: null,
    label: 'Autumn Term',
    start_date: '2026-09-01',
    end_date: '2026-12-18',
    weekdays: [1, 2, 3, 4, 5],
    source: 'manual',
    created_at: '2026-08-02T10:00:00.000Z',
    ...overrides,
  };
}

function exception(overrides: Partial<CalendarException> = {}): CalendarException {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    household_id: HOUSEHOLD_ID,
    child_id: null,
    on_date: '2026-09-09',
    kind: 'no_lunch',
    note: null,
    source: 'manual',
    created_at: '2026-08-02T10:00:00.000Z',
    ...overrides,
  };
}

describe('weekDates', () => {
  it('returns Monday through Saturday', () => {
    expect(weekDates(WEEK_OF)).toEqual([
      '2026-09-07',
      '2026-09-08',
      '2026-09-09',
      '2026-09-10',
      '2026-09-11',
      '2026-09-12',
    ]);
  });

  it('crosses a month boundary', () => {
    expect(weekDates('2026-08-31')).toEqual([
      '2026-08-31',
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
      '2026-09-04',
      '2026-09-05',
    ]);
  });
});

describe('addDaysIso', () => {
  it('crosses a leap-year February boundary', () => {
    expect(addDaysIso('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDaysIso('2028-02-28', 2)).toBe('2028-03-01');
  });

  it('crosses a DST transition without shifting the date', () => {
    // Europe/London springs forward on 2026-03-29.
    expect(addDaysIso('2026-03-28', 1)).toBe('2026-03-29');
    expect(addDaysIso('2026-03-29', 1)).toBe('2026-03-30');
  });
});

describe('resolveLunchDays', () => {
  it('returns undefined when the household has no terms at all', () => {
    expect(resolveLunchDays({ terms: [], exceptions: [], weekOf: WEEK_OF })).toBeUndefined();
  });

  it('returns undefined when no term reaches into this week', () => {
    const future = term({ start_date: '2027-01-04', end_date: '2027-03-26' });

    expect(
      resolveLunchDays({ terms: [future], exceptions: [], weekOf: WEEK_OF }),
    ).toBeUndefined();
  });

  it('returns Monday through Friday for a standard term', () => {
    expect(resolveLunchDays({ terms: [term()], exceptions: [], weekOf: WEEK_OF })).toEqual([
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
    ]);
  });

  it('includes saturday when the term declares ISO weekday 6', () => {
    const saturdaySchool = term({ weekdays: [1, 2, 3, 4, 5, 6] });

    expect(
      resolveLunchDays({ terms: [saturdaySchool], exceptions: [], weekOf: WEEK_OF }),
    ).toContain('saturday');
  });

  it('honours a weekday subset', () => {
    const partTime = term({ weekdays: [1, 3, 5] });

    expect(resolveLunchDays({ terms: [partTime], exceptions: [], weekOf: WEEK_OF })).toEqual([
      'monday',
      'wednesday',
      'friday',
    ]);
  });

  it('treats term start and end dates as inclusive', () => {
    const midWeekStart = term({ start_date: '2026-09-09', end_date: '2026-09-10' });

    expect(
      resolveLunchDays({ terms: [midWeekStart], exceptions: [], weekOf: WEEK_OF }),
    ).toEqual(['wednesday', 'thursday']);
  });

  it('unions overlapping terms', () => {
    const monTue = term({ id: 'a', weekdays: [1, 2] });
    const friSat = term({ id: 'b', weekdays: [5, 6] });

    expect(resolveLunchDays({ terms: [monTue, friSat], exceptions: [], weekOf: WEEK_OF })).toEqual(
      ['monday', 'tuesday', 'friday', 'saturday'],
    );
  });

  it('unions a child-scoped term with a household-wide one', () => {
    const household = term({ id: 'a', weekdays: [1, 2, 3] });
    const childSaturday = term({ id: 'b', child_id: CHILD_ID, weekdays: [6] });

    expect(
      resolveLunchDays({ terms: [household, childSaturday], exceptions: [], weekOf: WEEK_OF }),
    ).toEqual(['monday', 'tuesday', 'wednesday', 'saturday']);
  });

  it.each(['no_lunch', 'school_meal', 'trip'] as const)('removes a day for kind %s', (kind) => {
    const result = resolveLunchDays({
      terms: [term()],
      exceptions: [exception({ kind, on_date: '2026-09-09' })],
      weekOf: WEEK_OF,
    });

    expect(result).toEqual(['monday', 'tuesday', 'thursday', 'friday']);
  });

  it.each(['early_release', 'other'] as const)('keeps the day for kind %s', (kind) => {
    const result = resolveLunchDays({
      terms: [term()],
      exceptions: [exception({ kind, on_date: '2026-09-09' })],
      weekOf: WEEK_OF,
    });

    expect(result).toContain('wednesday');
  });

  it('ignores a child-scoped exception', () => {
    const result = resolveLunchDays({
      terms: [term()],
      exceptions: [exception({ child_id: CHILD_ID, on_date: '2026-09-09' })],
      weekOf: WEEK_OF,
    });

    expect(result).toContain('wednesday');
  });

  it('ignores an exception outside the week', () => {
    const result = resolveLunchDays({
      terms: [term()],
      exceptions: [exception({ on_date: '2026-09-21' })],
      weekOf: WEEK_OF,
    });

    expect(result).toHaveLength(5);
  });

  it('returns an empty array when every covered day is excepted', () => {
    const halfTerm = ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11'].map(
      (on_date, i) => exception({ id: `e${String(i)}`, on_date }),
    );

    expect(resolveLunchDays({ terms: [term()], exceptions: halfTerm, weekOf: WEEK_OF })).toEqual(
      [],
    );
  });

  it('always returns weekdays in calendar order', () => {
    const scrambled = term({ weekdays: [5, 1, 3] });

    expect(resolveLunchDays({ terms: [scrambled], exceptions: [], weekOf: WEEK_OF })).toEqual([
      'monday',
      'wednesday',
      'friday',
    ]);
  });

  it('does not duplicate a day covered by two terms', () => {
    const a = term({ id: 'a', weekdays: [1, 2] });
    const b = term({ id: 'b', weekdays: [2, 3] });

    expect(resolveLunchDays({ terms: [a, b], exceptions: [], weekOf: WEEK_OF })).toEqual([
      'monday',
      'tuesday',
      'wednesday',
    ]);
  });
});

describe('intersectDaySets', () => {
  it('returns undefined when neither side has an opinion', () => {
    expect(intersectDaySets(undefined, undefined)).toBeUndefined();
  });

  it('returns the defined side when the other is undefined', () => {
    expect(intersectDaySets(['monday'], undefined)).toEqual(['monday']);
    expect(intersectDaySets(undefined, ['friday'])).toEqual(['friday']);
  });

  it('intersects two day sets', () => {
    expect(
      intersectDaySets(['monday', 'tuesday', 'wednesday'], ['wednesday', 'thursday']),
    ).toEqual(['wednesday']);
  });

  it('returns an empty array when the sets are disjoint', () => {
    expect(intersectDaySets(['monday'], ['friday'])).toEqual([]);
  });

  it('preserves the order of the first set', () => {
    expect(intersectDaySets(['monday', 'friday'], ['friday', 'monday'])).toEqual([
      'monday',
      'friday',
    ]);
  });
});
