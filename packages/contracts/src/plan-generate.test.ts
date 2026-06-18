import { describe, it, expect } from 'vitest';
import { GeneratePlanResponseSchema } from './plan-generate.js';

describe('GeneratePlanResponseSchema', () => {
  it('accepts a current-week-remaining response', () => {
    const parsed = GeneratePlanResponseSchema.parse({
      job_id: 'plan-gen-ondemand-abc',
      week_of: '2026-06-15',
      planned_days: ['wednesday', 'thursday', 'friday'],
      basis: 'current_week_remaining',
    });
    expect(parsed.basis).toBe('current_week_remaining');
    expect(parsed.planned_days).toEqual(['wednesday', 'thursday', 'friday']);
  });

  it('accepts a next-week-full response', () => {
    const parsed = GeneratePlanResponseSchema.parse({
      job_id: 'job-1',
      week_of: '2026-06-22',
      planned_days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
      basis: 'next_week_full',
    });
    expect(parsed.planned_days).toHaveLength(5);
  });

  it('rejects an unknown basis value', () => {
    expect(() =>
      GeneratePlanResponseSchema.parse({
        job_id: 'job-1',
        week_of: '2026-06-22',
        planned_days: ['monday'],
        basis: 'whenever',
      }),
    ).toThrow();
  });

  it('rejects a non-date week_of', () => {
    expect(() =>
      GeneratePlanResponseSchema.parse({
        job_id: 'job-1',
        week_of: 'next monday',
        planned_days: ['monday'],
        basis: 'next_week_full',
      }),
    ).toThrow();
  });

  it('rejects an empty job_id', () => {
    expect(() =>
      GeneratePlanResponseSchema.parse({
        job_id: '',
        week_of: '2026-06-22',
        planned_days: ['monday'],
        basis: 'next_week_full',
      }),
    ).toThrow();
  });

  it('rejects an invalid weekday in planned_days', () => {
    expect(() =>
      GeneratePlanResponseSchema.parse({
        job_id: 'job-1',
        week_of: '2026-06-22',
        planned_days: ['someday'],
        basis: 'next_week_full',
      }),
    ).toThrow();
  });
});
