import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { getWeekStart } from './voice-tier.js';

describe('getWeekStart', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the same Monday when called on a Monday', () => {
    // 2026-10-19 is a Monday UTC
    vi.setSystemTime(new Date('2026-10-19T10:00:00Z'));
    expect(getWeekStart()).toBe('2026-10-19');
  });

  it('returns the previous Monday when called on a Sunday', () => {
    // 2026-10-25 is a Sunday UTC; previous Monday is 2026-10-19
    vi.setSystemTime(new Date('2026-10-25T23:59:59Z'));
    expect(getWeekStart()).toBe('2026-10-19');
  });

  it('returns the correct Monday for a mid-week day (Wednesday)', () => {
    // 2026-10-21 is a Wednesday UTC; Monday of that week is 2026-10-19
    vi.setSystemTime(new Date('2026-10-21T14:30:00Z'));
    expect(getWeekStart()).toBe('2026-10-19');
  });

  it('returns the correct Monday for a Saturday', () => {
    // 2026-10-24 is a Saturday UTC; Monday of that week is 2026-10-19
    vi.setSystemTime(new Date('2026-10-24T00:00:00Z'));
    expect(getWeekStart()).toBe('2026-10-19');
  });

  it('advances to a new Monday on the week boundary (Monday midnight UTC)', () => {
    // One tick before Monday midnight → still old week
    vi.setSystemTime(new Date('2026-10-25T23:59:59.999Z')); // Sunday
    expect(getWeekStart()).toBe('2026-10-19');

    // Exactly Monday midnight UTC → new week
    vi.setSystemTime(new Date('2026-10-26T00:00:00Z'));
    expect(getWeekStart()).toBe('2026-10-26');
  });
});
