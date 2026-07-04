import { describe, it, expect } from 'vitest';
import {
  HeartNoteStatusSchema,
  CreateHeartNoteBodySchema,
  PatchHeartNoteBodySchema,
  HeartNoteResponseSchema,
  HeartNotePayloadSchema,
  HeartNoteNullablePayloadSchema,
  GetHeartNotesQuerySchema,
  HeartNoteIdParamSchema,
} from './heart-notes.js';
import { ListChildrenResponseSchema } from './children.js';

const SAMPLE_UUID = '11111111-1111-4111-8111-111111111111';
const OTHER_UUID = '22222222-2222-4222-8222-222222222222';
const AUTHOR_UUID = '33333333-3333-4333-8333-333333333333';
const HOUSEHOLD_UUID = '44444444-4444-4444-8444-444444444444';

function validResponse() {
  return {
    id: SAMPLE_UUID,
    household_id: HOUSEHOLD_UUID,
    child_id: OTHER_UUID,
    author_user_id: AUTHOR_UUID,
    content: 'Hope today is a calm one — carrot ribbons and dates.',
    status: 'draft' as const,
    scheduled_for: null,
    delivered_at: null,
    cancelled_at: null,
    created_at: '2026-05-15T12:34:56.000Z',
    updated_at: '2026-05-15T12:35:00.000Z',
  };
}

describe('HeartNoteStatusSchema', () => {
  it.each(['draft', 'scheduled', 'delivered', 'viewed', 'rated', 'cancelled'])(
    'accepts %s',
    (v) => {
      expect(HeartNoteStatusSchema.safeParse(v).success).toBe(true);
    },
  );

  it('rejects unknown status', () => {
    expect(HeartNoteStatusSchema.safeParse('archived').success).toBe(false);
  });
});

describe('CreateHeartNoteBodySchema', () => {
  it('accepts minimal body with only child_id', () => {
    const r = CreateHeartNoteBodySchema.parse({ child_id: SAMPLE_UUID });
    expect(r.content).toBe('');
    expect(r.scheduled_for).toBeUndefined();
  });

  it('accepts body with content', () => {
    const r = CreateHeartNoteBodySchema.parse({
      child_id: SAMPLE_UUID,
      content: 'hello',
    });
    expect(r.content).toBe('hello');
  });

  it('accepts scheduled_for as ISO date string', () => {
    const r = CreateHeartNoteBodySchema.parse({
      child_id: SAMPLE_UUID,
      scheduled_for: '2026-05-20',
    });
    expect(r.scheduled_for).toBe('2026-05-20');
  });

  it('rejects non-UUID child_id', () => {
    expect(
      CreateHeartNoteBodySchema.safeParse({ child_id: 'not-a-uuid' }).success,
    ).toBe(false);
  });

  it('rejects content longer than 280 chars', () => {
    expect(
      CreateHeartNoteBodySchema.safeParse({
        child_id: SAMPLE_UUID,
        content: 'a'.repeat(281),
      }).success,
    ).toBe(false);
  });

  it('rejects missing child_id', () => {
    expect(CreateHeartNoteBodySchema.safeParse({ content: 'hi' }).success).toBe(false);
  });
});

describe('PatchHeartNoteBodySchema', () => {
  it('accepts empty object (all fields optional)', () => {
    expect(PatchHeartNoteBodySchema.safeParse({}).success).toBe(true);
  });

  it('accepts content-only patch', () => {
    expect(
      PatchHeartNoteBodySchema.safeParse({ content: 'updated' }).success,
    ).toBe(true);
  });

  it('accepts scheduled_for: null (cancellation of schedule)', () => {
    expect(
      PatchHeartNoteBodySchema.safeParse({ scheduled_for: null }).success,
    ).toBe(true);
  });

  it('rejects content longer than 280 chars', () => {
    expect(
      PatchHeartNoteBodySchema.safeParse({ content: 'a'.repeat(281) }).success,
    ).toBe(false);
  });
});

describe('HeartNoteResponseSchema', () => {
  it('parses a valid response row', () => {
    expect(HeartNoteResponseSchema.safeParse(validResponse()).success).toBe(true);
  });

  it('accepts scheduled_for as ISO date string', () => {
    expect(
      HeartNoteResponseSchema.safeParse({
        ...validResponse(),
        scheduled_for: '2026-06-01',
      }).success,
    ).toBe(true);
  });

  it('rejects missing id', () => {
    const { id: _unused, ...rest } = validResponse();
    expect(HeartNoteResponseSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects invalid status enum', () => {
    expect(
      HeartNoteResponseSchema.safeParse({ ...validResponse(), status: 'archived' })
        .success,
    ).toBe(false);
  });

  it('rejects non-datetime created_at', () => {
    expect(
      HeartNoteResponseSchema.safeParse({ ...validResponse(), created_at: 'today' })
        .success,
    ).toBe(false);
  });
});

describe('HeartNotePayloadSchema / HeartNoteNullablePayloadSchema', () => {
  it('payload requires non-null note', () => {
    expect(HeartNotePayloadSchema.safeParse({ note: validResponse() }).success).toBe(
      true,
    );
    expect(HeartNotePayloadSchema.safeParse({ note: null }).success).toBe(false);
  });

  it('nullable payload accepts null', () => {
    expect(HeartNoteNullablePayloadSchema.safeParse({ note: null }).success).toBe(true);
  });
});

describe('GetHeartNotesQuerySchema', () => {
  it('accepts child_id only', () => {
    expect(GetHeartNotesQuerySchema.safeParse({ child_id: SAMPLE_UUID }).success).toBe(
      true,
    );
  });

  it('accepts child_id + date', () => {
    expect(
      GetHeartNotesQuerySchema.safeParse({ child_id: SAMPLE_UUID, date: '2026-05-15' })
        .success,
    ).toBe(true);
  });

  it('rejects malformed date', () => {
    expect(
      GetHeartNotesQuerySchema.safeParse({ child_id: SAMPLE_UUID, date: 'today' })
        .success,
    ).toBe(false);
  });

  it('rejects missing child_id', () => {
    expect(GetHeartNotesQuerySchema.safeParse({ date: '2026-05-15' }).success).toBe(
      false,
    );
  });
});

describe('HeartNoteIdParamSchema', () => {
  it('accepts a uuid id', () => {
    expect(HeartNoteIdParamSchema.safeParse({ id: SAMPLE_UUID }).success).toBe(true);
  });

  it('rejects non-uuid id', () => {
    expect(HeartNoteIdParamSchema.safeParse({ id: 'abc' }).success).toBe(false);
  });
});

describe('ListChildrenResponseSchema', () => {
  const baseChild = {
    id: SAMPLE_UUID,
    household_id: HOUSEHOLD_UUID,
    name: 'Layla',
    age_band: 'child' as const,
    school_policy_notes: null,
    declared_allergens: [],
    cultural_identifiers: [],
    dietary_preferences: [],
    // Story 3-DM-B1: ChildResponseSchema dropped allergen_rule_version +
    // bag_composition jsonb; the three variation enums + the bag_composition_pattern
    // enum took their place.
    appetite_level: 'normal' as const,
    texture_needs: 'normal' as const,
    spice_tolerance: 'mild' as const,
    bag_composition_pattern: 'main_plus_snack_plus_extra' as const,
    created_at: '2026-05-15T12:00:00.000Z',
  };

  it('accepts an empty children array', () => {
    expect(ListChildrenResponseSchema.safeParse({ children: [] }).success).toBe(true);
  });

  it('accepts an array of children', () => {
    expect(
      ListChildrenResponseSchema.safeParse({ children: [baseChild] }).success,
    ).toBe(true);
  });

  it('rejects when children is not an array', () => {
    expect(
      ListChildrenResponseSchema.safeParse({ children: baseChild }).success,
    ).toBe(false);
  });
});
