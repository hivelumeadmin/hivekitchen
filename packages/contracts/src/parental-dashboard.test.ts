import { describe, it, expect } from 'vitest';
import {
  MemorySourceCountsSchema,
  ParentalDashboardResponseSchema,
} from './parental-dashboard.js';

const UUID = '00000000-0000-4000-8000-000000000001';
const DT = '2026-06-04T00:00:00Z';

function fullCounts() {
  return { onboarding: 1, turn: 2, tool: 0, user_edit: 3, plan_outcome: 0, import: 0 };
}

function fullPayload() {
  return {
    household: {
      cultural_priors: [{ key: 'bengali', label: 'Bengali', tier: 'L2', state: 'active' }],
      voice_retention_days: 90,
      recent_vpc_events: [
        { mechanism: 'signed_declaration', document_version: 'v1', signed_at: DT },
      ],
      general_memory_node_counts: fullCounts(),
    },
    children: [
      {
        child_id: UUID,
        name: 'Layla',
        age_band: 'child',
        declared_allergens: ['peanut'],
        dietary_preferences: ['halal'],
        memory_node_counts: fullCounts(),
      },
    ],
  };
}

describe('ParentalDashboardResponseSchema', () => {
  it('round-trips a valid full payload', () => {
    const r = ParentalDashboardResponseSchema.safeParse(fullPayload());
    expect(r.success).toBe(true);
  });

  it('rejects a payload missing a source_type key in memory_node_counts', () => {
    const payload = fullPayload();
    delete (payload.children[0].memory_node_counts as Record<string, unknown>).import;
    const r = ParentalDashboardResponseSchema.safeParse(payload);
    expect(r.success).toBe(false);
  });

  it('rejects a non-uuid child_id', () => {
    const payload = fullPayload();
    payload.children[0].child_id = 'not-a-uuid';
    const r = ParentalDashboardResponseSchema.safeParse(payload);
    expect(r.success).toBe(false);
  });
});

describe('MemorySourceCountsSchema', () => {
  it('requires every source_type key to be present', () => {
    const r = MemorySourceCountsSchema.safeParse({ onboarding: 0, turn: 0, tool: 0 });
    expect(r.success).toBe(false);
  });
});
