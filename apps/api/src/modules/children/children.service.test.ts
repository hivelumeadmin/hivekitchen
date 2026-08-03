import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChildrenService } from './children.service.js';
import type { ChildrenRepository, DecryptedChildRow } from './children.repository.js';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const CHILD_ID = '22222222-2222-4222-8222-222222222222';

function makeExistingRow(overrides: Partial<DecryptedChildRow> = {}): DecryptedChildRow {
  return {
    id: CHILD_ID,
    household_id: HOUSEHOLD_ID,
    name: 'Layla',
    age_band: 'child',
    declared_allergens: ['peanut'],
    cultural_identifiers: [],
    dietary_preferences: [],
    appetite_level: 'normal',
    texture_needs: 'normal',
    spice_tolerance: 'mild',
    bag_composition_pattern: 'main_plus_snack_plus_extra',
    created_at: '2026-05-21T00:00:00.000Z',
    ...overrides,
  };
}

function makeRepository(existing: DecryptedChildRow[] = []): ChildrenRepository {
  return {
    findByHouseholdId: vi.fn().mockResolvedValue(existing),
    updateProfile: vi.fn().mockImplementation(async (params) => ({
      ...makeExistingRow({ id: params.id, name: params.name }),
    })),
    insert: vi.fn().mockImplementation(async (params) => makeExistingRow({ name: params.name })),
    findById: vi.fn(),
    findBagCompositionsByHousehold: vi.fn(),
    updateBagComposition: vi.fn(),
    getHouseholdDek: vi.fn(),
    getOrCreateHouseholdDek: vi.fn(),
  } as unknown as ChildrenRepository;
}

// Slice 2.5-s8 — Moment 4 wire-through. The service is the integration layer
// between the agent's child.upsert tool and the persistence layer; these
// tests pin the forwarding contract for `bag_composition_pattern`.

describe('ChildrenService.upsertByName — bag_composition_pattern (Slice 2.5-s8)', () => {
  let repo: ChildrenRepository;
  let service: ChildrenService;

  beforeEach(() => {
    repo = makeRepository([makeExistingRow()]);
    service = new ChildrenService(repo);
  });

  it('forwards bag_composition_pattern to repository.updateProfile on the UPDATE path', async () => {
    await service.upsertByName({
      householdId: HOUSEHOLD_ID,
      body: {
        name: 'Layla',
        age_band: 'child',
        bag_composition_pattern: 'main_plus_snack',
      },
    });

    expect(repo.updateProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        id: CHILD_ID,
        household_id: HOUSEHOLD_ID,
        bag_composition_pattern: 'main_plus_snack',
      }),
    );
  });

  it('passes undefined when bag_composition_pattern is omitted so PATCH preserves the existing column value', async () => {
    await service.upsertByName({
      householdId: HOUSEHOLD_ID,
      body: { name: 'Layla', age_band: 'child' },
    });

    expect(repo.updateProfile).toHaveBeenCalledWith(
      expect.objectContaining({ bag_composition_pattern: undefined }),
    );
  });
});
