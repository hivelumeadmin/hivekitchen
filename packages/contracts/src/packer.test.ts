import { describe, it, expect } from 'vitest';
import {
  DayAssignmentSchema,
  AssignPackerRequestSchema,
} from './packer.js';

const UUID = '11111111-1111-4111-8111-111111111111';

describe('DayAssignmentSchema', () => {
  it('accepts a fully populated assignment', () => {
    const result = DayAssignmentSchema.safeParse({
      date: '2026-06-16',
      packer_user_id: UUID,
      packer_display_name: 'Devon',
    });
    expect(result.success).toBe(true);
  });

  it('accepts null packer_user_id and null packer_display_name', () => {
    const result = DayAssignmentSchema.safeParse({
      date: '2026-06-16',
      packer_user_id: null,
      packer_display_name: null,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a missing date', () => {
    const result = DayAssignmentSchema.safeParse({
      packer_user_id: UUID,
      packer_display_name: 'Devon',
    });
    expect(result.success).toBe(false);
  });
});

describe('AssignPackerRequestSchema', () => {
  it('accepts a valid uuid', () => {
    expect(AssignPackerRequestSchema.safeParse({ packer_user_id: UUID }).success).toBe(true);
  });

  it('accepts null (unassign)', () => {
    expect(AssignPackerRequestSchema.safeParse({ packer_user_id: null }).success).toBe(true);
  });

  it('rejects a non-uuid string', () => {
    expect(AssignPackerRequestSchema.safeParse({ packer_user_id: 'not-a-uuid' }).success).toBe(
      false,
    );
  });
});
