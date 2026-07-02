import { describe, it, expect } from 'vitest';
import { deriveCompositionWindow } from './derive-week-id.js';

// Reference week (UTC): 2026-06-15 Mon, 16 Tue, 17 Wed, 18 Thu, 19 Fri,
// 20 Sat, 21 Sun. Current-week Monday = 2026-06-15; next Monday = 2026-06-22.
describe('deriveCompositionWindow', () => {
  describe('all 7 init days (UTC, midday — local day == UTC day)', () => {
    it('Monday → current week, Tue–Fri', () => {
      const r = deriveCompositionWindow(new Date('2026-06-15T12:00:00Z'), 'UTC');
      expect(r).toEqual({
        weekOf: '2026-06-15',
        plannedDays: ['tuesday', 'wednesday', 'thursday', 'friday'],
        basis: 'current_week_remaining',
      });
    });

    it('Tuesday → current week, Wed–Fri', () => {
      const r = deriveCompositionWindow(new Date('2026-06-16T12:00:00Z'), 'UTC');
      expect(r).toEqual({
        weekOf: '2026-06-15',
        plannedDays: ['wednesday', 'thursday', 'friday'],
        basis: 'current_week_remaining',
      });
    });

    it('Wednesday → current week, Thu–Fri', () => {
      const r = deriveCompositionWindow(new Date('2026-06-17T12:00:00Z'), 'UTC');
      expect(r).toEqual({
        weekOf: '2026-06-15',
        plannedDays: ['thursday', 'friday'],
        basis: 'current_week_remaining',
      });
    });

    it('Thursday → next week, full Mon–Fri', () => {
      const r = deriveCompositionWindow(new Date('2026-06-18T12:00:00Z'), 'UTC');
      expect(r).toEqual({
        weekOf: '2026-06-22',
        plannedDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
        basis: 'next_week_full',
      });
    });

    it('Friday → next week, full Mon–Fri', () => {
      const r = deriveCompositionWindow(new Date('2026-06-19T12:00:00Z'), 'UTC');
      expect(r).toEqual({
        weekOf: '2026-06-22',
        plannedDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
        basis: 'next_week_full',
      });
    });

    it('Saturday → next week, full Mon–Fri', () => {
      const r = deriveCompositionWindow(new Date('2026-06-20T12:00:00Z'), 'UTC');
      expect(r).toEqual({
        weekOf: '2026-06-22',
        plannedDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
        basis: 'next_week_full',
      });
    });

    it('Sunday → next week, full Mon–Fri (Sunday anchors to its own week Monday)', () => {
      const r = deriveCompositionWindow(new Date('2026-06-21T12:00:00Z'), 'UTC');
      expect(r).toEqual({
        weekOf: '2026-06-22',
        plannedDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
        basis: 'next_week_full',
      });
    });
  });

  it('never includes Saturday in plannedDays for any init day', () => {
    for (let d = 15; d <= 21; d++) {
      const r = deriveCompositionWindow(
        new Date(`2026-06-${String(d).padStart(2, '0')}T12:00:00Z`),
        'UTC',
      );
      expect(r.plannedDays).not.toContain('saturday');
    }
  });

  describe('timezone correctness — local day differs from UTC day', () => {
    it('PT evening that has rolled past UTC midnight uses the LOCAL (earlier) day', () => {
      // 2026-06-17T04:00Z == 2026-06-16 21:00 PDT (UTC-7) → local Tuesday.
      // A UTC reading would be Wednesday → [thu, fri]; local Tuesday → [wed, thu, fri].
      const r = deriveCompositionWindow(
        new Date('2026-06-17T04:00:00Z'),
        'America/Los_Angeles',
      );
      expect(r).toEqual({
        weekOf: '2026-06-15',
        plannedDays: ['wednesday', 'thursday', 'friday'],
        basis: 'current_week_remaining',
      });
    });

    it('ET evening that has rolled past UTC midnight uses the LOCAL (earlier) day', () => {
      // 2026-06-18T01:00Z == 2026-06-17 21:00 EDT (UTC-4) → local Wednesday.
      const r = deriveCompositionWindow(
        new Date('2026-06-18T01:00:00Z'),
        'America/New_York',
      );
      expect(r).toEqual({
        weekOf: '2026-06-15',
        plannedDays: ['thursday', 'friday'],
        basis: 'current_week_remaining',
      });
    });

    it('UTC at the same instant reads the later (UTC) day — proves the tz path matters', () => {
      const r = deriveCompositionWindow(new Date('2026-06-17T04:00:00Z'), 'UTC');
      expect(r.plannedDays).toEqual(['thursday', 'friday']); // Wednesday
    });
  });

  describe('DST transition week', () => {
    it('handles the US spring-forward Sunday (2026-03-08) in America/New_York', () => {
      // DST begins 2026-03-08 (Sunday). 16:00Z == 12:00 EDT → local Sunday.
      // Next Monday = 2026-03-09. Whole-day math must not be skewed by the
      // 23-hour DST day.
      const r = deriveCompositionWindow(
        new Date('2026-03-08T16:00:00Z'),
        'America/New_York',
      );
      expect(r).toEqual({
        weekOf: '2026-03-09',
        plannedDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
        basis: 'next_week_full',
      });
    });

    it('handles a Tuesday within the spring-forward week in America/New_York', () => {
      // 2026-03-10 is the Tuesday after spring-forward. Local Tuesday → Wed–Fri,
      // current-week Monday = 2026-03-09.
      const r = deriveCompositionWindow(
        new Date('2026-03-10T17:00:00Z'),
        'America/New_York',
      );
      expect(r).toEqual({
        weekOf: '2026-03-09',
        plannedDays: ['wednesday', 'thursday', 'friday'],
        basis: 'current_week_remaining',
      });
    });
  });
});
