import { describe, it, expect } from 'vitest';
import { DeleteHouseholdResponseSchema } from './account-deletion.js';

describe('DeleteHouseholdResponseSchema', () => {
  it('parses a valid scheduled response', () => {
    const result = DeleteHouseholdResponseSchema.safeParse({
      status: 'scheduled',
      scheduled_hard_delete_at: '2026-07-12T04:00:00.000Z',
      message: 'Your account deletion has been scheduled.',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid status literal', () => {
    const result = DeleteHouseholdResponseSchema.safeParse({
      status: 'pending',
      scheduled_hard_delete_at: '2026-07-12T04:00:00.000Z',
      message: 'x',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a missing status', () => {
    const result = DeleteHouseholdResponseSchema.safeParse({
      scheduled_hard_delete_at: '2026-07-12T04:00:00.000Z',
      message: 'x',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-datetime scheduled_hard_delete_at', () => {
    const result = DeleteHouseholdResponseSchema.safeParse({
      status: 'scheduled',
      scheduled_hard_delete_at: 'not-a-date',
      message: 'x',
    });
    expect(result.success).toBe(false);
  });
});
