import { describe, it, expect } from 'vitest';
import { getTimeOfDayBand } from './time-of-day.js';

// Boundary cases from AC9 — every band edge plus the wrap-around at midnight.
describe('getTimeOfDayBand — band boundaries (UTC)', () => {
  const cases: Array<[string, ReturnType<typeof getTimeOfDayBand>]> = [
    ['2026-06-07T04:59:00Z', 'night'],
    ['2026-06-07T05:00:00Z', 'morning'],
    ['2026-06-07T11:59:00Z', 'morning'],
    ['2026-06-07T12:00:00Z', 'afternoon'],
    ['2026-06-07T16:59:00Z', 'afternoon'],
    ['2026-06-07T17:00:00Z', 'evening'],
    ['2026-06-07T21:59:00Z', 'evening'],
    ['2026-06-07T22:00:00Z', 'night'],
    ['2026-06-07T23:59:00Z', 'night'],
    ['2026-06-07T00:00:00Z', 'night'],
  ];

  for (const [iso, expected] of cases) {
    it(`${iso} → ${expected}`, () => {
      expect(getTimeOfDayBand(new Date(iso))).toBe(expected);
    });
  }
});
