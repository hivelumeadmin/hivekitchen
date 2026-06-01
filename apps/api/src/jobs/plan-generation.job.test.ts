import { describe, it, expect } from 'vitest';
import type { PlanComposeOutput } from '@hivekitchen/types';
import {
  buildCommitInput,
  deriveWeekId,
  getLocalSixPmUtcMs,
  getNextMondayFrom,
} from './plan-generation.job.js';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const CHILD_A = '22222222-2222-4222-8222-22222222222a';
const CHILD_B = '22222222-2222-4222-8222-22222222222b';
const PLAN_ID = '99999999-9999-4999-8999-999999999999';
const REQUEST_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('deriveWeekId', () => {
  it('returns a deterministic UUID-shaped string for the same weekOf', () => {
    const a = deriveWeekId('2026-05-11');
    const b = deriveWeekId('2026-05-11');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('returns different ids for different weeks', () => {
    expect(deriveWeekId('2026-05-11')).not.toBe(deriveWeekId('2026-05-18'));
  });
});

describe('getNextMondayFrom', () => {
  it('returns the ISO date 3 days after a Friday', () => {
    expect(getNextMondayFrom(new Date('2026-05-08T10:00:00Z'))).toBe('2026-05-11');
  });

  it('returns the same Monday when called at different Friday hours', () => {
    expect(getNextMondayFrom(new Date('2026-05-08T00:00:00Z'))).toBe('2026-05-11');
    expect(getNextMondayFrom(new Date('2026-05-08T23:59:00Z'))).toBe('2026-05-11');
  });
});

describe('getLocalSixPmUtcMs', () => {
  // EDT is UTC-4 in May. 18:00 EDT = 22:00 UTC same date.
  it('returns 22:00 UTC for 18:00 America/New_York during EDT', () => {
    const ms = getLocalSixPmUtcMs('America/New_York', new Date('2026-05-08T10:00:00Z'));
    expect(new Date(ms).toISOString()).toBe('2026-05-08T22:00:00.000Z');
  });

  // PDT is UTC-7 in May. 18:00 PDT = 01:00 UTC the following day.
  it('returns 01:00 UTC the next day for 18:00 America/Los_Angeles during PDT', () => {
    const ms = getLocalSixPmUtcMs('America/Los_Angeles', new Date('2026-05-08T10:00:00Z'));
    expect(new Date(ms).toISOString()).toBe('2026-05-09T01:00:00.000Z');
  });

  it('returns 18:00 UTC for 18:00 UTC timezone', () => {
    const ms = getLocalSixPmUtcMs('UTC', new Date('2026-05-08T10:00:00Z'));
    expect(new Date(ms).toISOString()).toBe('2026-05-08T18:00:00.000Z');
  });

  it('rolls forward by 24h when 18:00 local has already passed', () => {
    // Reference 23:00 UTC in NY (EDT) is 19:00 local — 18:00 local has passed.
    // The function should return the next day's 18:00 local = 22:00 UTC next day.
    const ms = getLocalSixPmUtcMs('America/New_York', new Date('2026-05-08T23:00:00Z'));
    expect(new Date(ms).toISOString()).toBe('2026-05-09T22:00:00.000Z');
  });
});

describe('buildCommitInput', () => {
  it('flattens multi-day, multi-child items and stamps revision 1 + week_id', () => {
    const compose: PlanComposeOutput = {
      plan_id: PLAN_ID,
      household_id: HOUSEHOLD_ID,
      week_of: '2026-05-11',
      days: [
        {
          day: 'monday',
          items: [
            { child_id: CHILD_A, slot: 'main', ingredients: ['rice', 'lentils'] },
            { child_id: CHILD_B, slot: 'main', ingredients: ['quinoa'] },
          ],
        },
        {
          day: 'tuesday',
          items: [{ child_id: CHILD_A, slot: 'snack', ingredients: ['apple'] }],
        },
      ],
      prompt_version: 'v1.0.0',
    };

    const weekId = deriveWeekId('2026-05-11');
    const result = buildCommitInput(compose, weekId, REQUEST_ID);

    expect(result.plan_id).toBe(PLAN_ID);
    expect(result.household_id).toBe(HOUSEHOLD_ID);
    expect(result.week_id).toBe(weekId);
    expect(result.revision).toBe(1);
    expect(result.prompt_version).toBe('v1.0.0');
    expect(result.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(result.items).toEqual([
      { child_id: CHILD_A, day: 'monday', slot: 'main', ingredients: ['rice', 'lentils'] },
      { child_id: CHILD_B, day: 'monday', slot: 'main', ingredients: ['quinoa'] },
      { child_id: CHILD_A, day: 'tuesday', slot: 'snack', ingredients: ['apple'] },
    ]);
  });

  it('preserves recipe_id and item_id when present', () => {
    const RECIPE_ID = '88888888-8888-4888-8888-888888888888';
    const ITEM_ID = '77777777-7777-4777-8777-777777777777';
    const compose: PlanComposeOutput = {
      plan_id: PLAN_ID,
      household_id: HOUSEHOLD_ID,
      week_of: '2026-05-11',
      days: [
        {
          day: 'monday',
          items: [
            {
              child_id: CHILD_A,
              slot: 'main',
              ingredients: ['rice'],
              recipe_id: RECIPE_ID,
              item_id: ITEM_ID,
            },
          ],
        },
      ],
      prompt_version: 'v1.0.0',
    };

    const result = buildCommitInput(compose, deriveWeekId('2026-05-11'), REQUEST_ID);

    expect(result.items[0]).toMatchObject({
      child_id: CHILD_A,
      day: 'monday',
      slot: 'main',
      ingredients: ['rice'],
      recipe_id: RECIPE_ID,
      item_id: ITEM_ID,
    });
  });

  it('omits recipe_id and item_id when not provided', () => {
    const compose: PlanComposeOutput = {
      plan_id: PLAN_ID,
      household_id: HOUSEHOLD_ID,
      week_of: '2026-05-11',
      days: [
        {
          day: 'monday',
          items: [{ child_id: CHILD_A, slot: 'main', ingredients: ['rice'] }],
        },
      ],
      prompt_version: 'v1.0.0',
    };

    const result = buildCommitInput(compose, deriveWeekId('2026-05-11'), REQUEST_ID);

    expect(result.items[0]).not.toHaveProperty('recipe_id');
    expect(result.items[0]).not.toHaveProperty('item_id');
  });
});
