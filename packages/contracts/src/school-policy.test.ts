import { describe, it, expect } from 'vitest';
import {
  GetSchoolPoliciesResponseSchema,
  SchoolPolicyChildIdParamSchema,
  SchoolPolicySchema,
  SlotScopeSchema,
  UpdateSchoolPolicyInputSchema,
  UpdateSchoolPolicyResponseSchema,
} from './school-policy.js';

const UUID = '11111111-1111-4111-8111-111111111111';
const UUID2 = '22222222-2222-4222-8222-222222222222';

describe('SlotScopeSchema', () => {
  it.each(['bag_wide', 'main', 'snack', 'extra'])('accepts %s', (value) => {
    expect(SlotScopeSchema.safeParse(value).success).toBe(true);
  });

  it('rejects unknown scope', () => {
    expect(SlotScopeSchema.safeParse('breakfast').success).toBe(false);
  });
});

describe('SchoolPolicySchema', () => {
  const baseRow = {
    id: UUID,
    child_id: UUID2,
    policy_type: 'nut_free',
    policy_description: null,
    slot_scope: 'bag_wide' as const,
    is_active: true,
    created_at: '2026-05-05T11:00:00.000Z',
    updated_at: '2026-05-05T11:00:00.000Z',
  };

  it('round-trips a minimal active row', () => {
    expect(SchoolPolicySchema.safeParse(baseRow).success).toBe(true);
  });

  it('accepts a description up to 500 chars', () => {
    expect(
      SchoolPolicySchema.safeParse({
        ...baseRow,
        policy_description: 'a'.repeat(500),
      }).success,
    ).toBe(true);
  });

  it('rejects a description over 500 chars', () => {
    expect(
      SchoolPolicySchema.safeParse({
        ...baseRow,
        policy_description: 'a'.repeat(501),
      }).success,
    ).toBe(false);
  });

  it('rejects an unknown slot_scope', () => {
    expect(
      SchoolPolicySchema.safeParse({ ...baseRow, slot_scope: 'whole_bag' }).success,
    ).toBe(false);
  });
});

describe('UpdateSchoolPolicyInputSchema', () => {
  it('parses valid input and defaults slot_scope to bag_wide', () => {
    const parsed = UpdateSchoolPolicyInputSchema.parse({
      policy_type: 'nut_free',
      is_active: true,
    });
    expect(parsed.slot_scope).toBe('bag_wide');
    expect(parsed.is_active).toBe(true);
  });

  it('rejects missing policy_type', () => {
    expect(
      UpdateSchoolPolicyInputSchema.safeParse({ is_active: true }).success,
    ).toBe(false);
  });

  it('rejects empty policy_type', () => {
    expect(
      UpdateSchoolPolicyInputSchema.safeParse({
        policy_type: '',
        is_active: true,
      }).success,
    ).toBe(false);
  });

  it('rejects policy_type over 100 chars', () => {
    expect(
      UpdateSchoolPolicyInputSchema.safeParse({
        policy_type: 'a'.repeat(101),
        is_active: true,
      }).success,
    ).toBe(false);
  });

  it('rejects unknown keys (.strict())', () => {
    const result = UpdateSchoolPolicyInputSchema.safeParse({
      policy_type: 'nut_free',
      is_active: true,
      smuggled: 'value',
    });
    expect(result.success).toBe(false);
  });

  it('accepts an explicit slot_scope', () => {
    const parsed = UpdateSchoolPolicyInputSchema.parse({
      policy_type: 'no_heating',
      slot_scope: 'main',
      is_active: false,
    });
    expect(parsed.slot_scope).toBe('main');
  });
});

describe('UpdateSchoolPolicyResponseSchema', () => {
  it('round-trips a triggered response', () => {
    const result = UpdateSchoolPolicyResponseSchema.safeParse({
      policy: {
        id: UUID,
        child_id: UUID2,
        policy_type: 'nut_free',
        policy_description: null,
        slot_scope: 'bag_wide',
        is_active: true,
        created_at: '2026-05-05T11:00:00.000Z',
        updated_at: '2026-05-05T11:00:00.000Z',
      },
      regeneration_triggered: true,
      affected_plan_ids: [UUID, UUID2],
    });
    expect(result.success).toBe(true);
  });

  it('round-trips a no-op (deactivation) response', () => {
    const result = UpdateSchoolPolicyResponseSchema.safeParse({
      policy: {
        id: UUID,
        child_id: UUID2,
        policy_type: 'nut_free',
        policy_description: null,
        slot_scope: 'bag_wide',
        is_active: false,
        created_at: '2026-05-05T11:00:00.000Z',
        updated_at: '2026-05-05T11:00:00.000Z',
      },
      regeneration_triggered: false,
      affected_plan_ids: [],
    });
    expect(result.success).toBe(true);
  });

  it('rejects non-uuid affected_plan_ids', () => {
    expect(
      UpdateSchoolPolicyResponseSchema.safeParse({
        policy: {
          id: UUID,
          child_id: UUID2,
          policy_type: 'nut_free',
          policy_description: null,
          slot_scope: 'bag_wide',
          is_active: true,
          created_at: '2026-05-05T11:00:00.000Z',
          updated_at: '2026-05-05T11:00:00.000Z',
        },
        regeneration_triggered: true,
        affected_plan_ids: ['not-a-uuid'],
      }).success,
    ).toBe(false);
  });
});

describe('GetSchoolPoliciesResponseSchema', () => {
  it('round-trips an empty list', () => {
    expect(GetSchoolPoliciesResponseSchema.safeParse({ policies: [] }).success).toBe(true);
  });
});

describe('SchoolPolicyChildIdParamSchema', () => {
  it('accepts a valid uuid', () => {
    expect(SchoolPolicyChildIdParamSchema.safeParse({ id: UUID }).success).toBe(true);
  });

  it('rejects a non-uuid id', () => {
    expect(SchoolPolicyChildIdParamSchema.safeParse({ id: 'abc' }).success).toBe(false);
  });
});
