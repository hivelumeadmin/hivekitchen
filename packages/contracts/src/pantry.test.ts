import { describe, it, expect } from 'vitest';
import { PantryReadInputSchema, PantryReadOutputSchema } from './pantry.js';

const UUID1 = '00000000-0000-4000-8000-000000000001';
const UUID2 = '00000000-0000-4000-8000-000000000002';
const DT = '2026-05-08T12:00:00.000Z';

describe('PantryReadInputSchema', () => {
  it('round-trips a valid input', () => {
    expect(PantryReadInputSchema.safeParse({ household_id: UUID1 }).success).toBe(true);
  });

  it('rejects non-uuid household_id', () => {
    expect(PantryReadInputSchema.safeParse({ household_id: 'nope' }).success).toBe(false);
  });

  it('rejects missing household_id', () => {
    expect(PantryReadInputSchema.safeParse({}).success).toBe(false);
  });
});

describe('PantryReadOutputSchema', () => {
  it('round-trips with a fully-specified item', () => {
    const r = PantryReadOutputSchema.safeParse({
      items: [
        {
          id: UUID2,
          name: 'rice',
          quantity: '2 cups',
          unit: 'cup',
          expires_at: DT,
          tags: ['grain'],
        },
      ],
    });
    expect(r.success).toBe(true);
  });

  it('round-trips with an item that omits optional fields', () => {
    const r = PantryReadOutputSchema.safeParse({
      items: [
        { id: UUID2, name: 'rice', quantity: '2 cups', tags: [] },
      ],
    });
    expect(r.success).toBe(true);
  });

  it('rejects an item with non-uuid id', () => {
    const r = PantryReadOutputSchema.safeParse({
      items: [{ id: 'nope', name: 'rice', quantity: '1', tags: [] }],
    });
    expect(r.success).toBe(false);
  });
});
