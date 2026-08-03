import { describe, it, expect } from 'vitest';
import type { SourceType } from '@hivekitchen/types';
import { ParentalDashboardService } from './parental-dashboard.service.js';
import type { ChildrenRepository, DecryptedChildRow } from '../children/children.repository.js';
import type { MemoryRepository } from '../memory/memory.repository.js';
import type { CulturalPriorRepository, CulturalPriorRow } from '../cultural-priors/cultural-prior.repository.js';
import type { ComplianceRepository, VpcConsentRow } from '../compliance/compliance.repository.js';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const CHILD_A = '22222222-2222-4222-8222-222222222222';
const CHILD_B = '33333333-3333-4333-8333-333333333333';

type ProvenanceSource = { subject_child_id: string | null; source_type: SourceType };

interface MockData {
  children?: DecryptedChildRow[];
  priors?: CulturalPriorRow[];
  provenance?: ProvenanceSource[];
  consents?: VpcConsentRow[];
}

// Typed mock repos — each implements only the method the service calls, with the
// real return type, so a repo signature drift is caught at compile time (7-S7
// IR-9 follow-up). We narrow to the called method then widen back to the repo
// type for the deps struct.
function buildService(data: MockData): ParentalDashboardService {
  const childrenRepository = {
    findByHouseholdId: async (): Promise<DecryptedChildRow[]> => data.children ?? [],
  } as unknown as ChildrenRepository;

  const culturalPriorRepository = {
    findByHousehold: async (): Promise<CulturalPriorRow[]> => data.priors ?? [],
  } as unknown as CulturalPriorRepository;

  const memoryRepository = {
    findActiveProvenanceSourcesByHousehold: async (): Promise<ProvenanceSource[]> =>
      data.provenance ?? [],
  } as unknown as MemoryRepository;

  const complianceRepository = {
    findRecentConsentsByHousehold: async (): Promise<VpcConsentRow[]> => data.consents ?? [],
  } as unknown as ComplianceRepository;

  return new ParentalDashboardService({
    childrenRepository,
    culturalPriorRepository,
    memoryRepository,
    complianceRepository,
  });
}

function makeChild(overrides: Partial<DecryptedChildRow> = {}): DecryptedChildRow {
  return {
    id: CHILD_A,
    household_id: HOUSEHOLD_ID,
    name: 'Layla',
    age_band: 'child',
    declared_allergens: [],
    cultural_identifiers: [],
    dietary_preferences: [],
    appetite_level: 'normal',
    texture_needs: 'normal',
    spice_tolerance: 'mild',
    bag_composition_pattern: 'main_only',
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makePrior(overrides: Partial<CulturalPriorRow> = {}): CulturalPriorRow {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    household_id: HOUSEHOLD_ID,
    key: 'bengali',
    label: 'Bengali',
    tier: 'L2',
    state: 'active',
    enforcement: 'default',
    presence: 1,
    confidence: 0.9,
    opted_in_at: null,
    opted_out_at: null,
    last_signal_at: '2026-01-01T00:00:00.000Z',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeConsent(overrides: Partial<VpcConsentRow> = {}): VpcConsentRow {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    household_id: HOUSEHOLD_ID,
    mechanism: 'signed_declaration',
    signed_at: '2026-06-01T00:00:00.000Z',
    signed_by_user_id: '66666666-6666-4666-8666-666666666666',
    document_version: 'v1',
    created_at: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('ParentalDashboardService.getDashboard', () => {
  it('buckets per-child provenance by source_type and attributes null subject to general counts (AC#4)', async () => {
    const service = buildService({
      children: [makeChild({ id: CHILD_A, name: 'Layla' })],
      provenance: [
        { subject_child_id: CHILD_A, source_type: 'onboarding' },
        { subject_child_id: CHILD_A, source_type: 'user_edit' },
        { subject_child_id: CHILD_A, source_type: 'user_edit' },
        { subject_child_id: null, source_type: 'turn' },
        { subject_child_id: null, source_type: 'turn' },
        { subject_child_id: null, source_type: 'turn' },
      ],
    });

    const result = await service.getDashboard(HOUSEHOLD_ID);

    expect(result.children[0]?.memory_node_counts).toEqual({
      onboarding: 1,
      turn: 0,
      tool: 0,
      user_edit: 2,
      plan_outcome: 0,
      import: 0,
    });
    expect(result.household.general_memory_node_counts).toEqual({
      onboarding: 0,
      turn: 3,
      tool: 0,
      user_edit: 0,
      plan_outcome: 0,
      import: 0,
    });
  });

  it('a child with no memory yields all-zero memory_node_counts (every key present)', async () => {
    const service = buildService({
      children: [makeChild({ id: CHILD_A }), makeChild({ id: CHILD_B, name: 'Ravi' })],
      provenance: [{ subject_child_id: CHILD_A, source_type: 'tool' }],
    });

    const result = await service.getDashboard(HOUSEHOLD_ID);

    const ravi = result.children.find((c) => c.child_id === CHILD_B);
    expect(ravi?.memory_node_counts).toEqual({
      onboarding: 0,
      turn: 0,
      tool: 0,
      user_edit: 0,
      plan_outcome: 0,
      import: 0,
    });
  });

  it('passes the repo output through faithfully — counts only what the repo returns', async () => {
    // The repo already excludes inactive nodes; the service must not add or drop.
    const service = buildService({
      children: [makeChild({ id: CHILD_A })],
      provenance: [{ subject_child_id: CHILD_A, source_type: 'plan_outcome' }],
    });

    const result = await service.getDashboard(HOUSEHOLD_ID);

    expect(result.children[0]?.memory_node_counts.plan_outcome).toBe(1);
  });

  it("filters out 'forgotten' cultural priors and projects { key, label, tier, state } (AC#3)", async () => {
    const service = buildService({
      priors: [
        makePrior({ key: 'bengali', label: 'Bengali', tier: 'L2', state: 'active' }),
        makePrior({ key: 'lapsed', label: 'Lapsed', state: 'forgotten' }),
      ],
    });

    const result = await service.getDashboard(HOUSEHOLD_ID);

    expect(result.household.cultural_priors).toEqual([
      { key: 'bengali', label: 'Bengali', tier: 'L2', state: 'active' },
    ]);
  });

  it('maps recent VPC consents to { mechanism, document_version, signed_at } (AC#3)', async () => {
    const service = buildService({
      consents: [makeConsent({ mechanism: 'signed_declaration', document_version: 'v2', signed_at: '2026-06-02T00:00:00.000Z' })],
    });

    const result = await service.getDashboard(HOUSEHOLD_ID);

    expect(result.household.recent_vpc_events).toEqual([
      { mechanism: 'signed_declaration', document_version: 'v2', signed_at: '2026-06-02T00:00:00.000Z' },
    ]);
  });

  it('reports voice_retention_days === 90 (AC#3)', async () => {
    const service = buildService({});

    const result = await service.getDashboard(HOUSEHOLD_ID);

    expect(result.household.voice_retention_days).toBe(90);
  });

  it('returns a valid response with children: [] for an empty household (AC#7)', async () => {
    const service = buildService({});

    const result = await service.getDashboard(HOUSEHOLD_ID);

    expect(result.children).toEqual([]);
    expect(result.household.cultural_priors).toEqual([]);
    expect(result.household.recent_vpc_events).toEqual([]);
    expect(result.household.general_memory_node_counts).toEqual({
      onboarding: 0,
      turn: 0,
      tool: 0,
      user_edit: 0,
      plan_outcome: 0,
      import: 0,
    });
  });

  it('carries through per-child name, age band, allergens and dietary preferences', async () => {
    const service = buildService({
      children: [
        makeChild({
          id: CHILD_A,
          name: 'Layla',
          age_band: 'preteen',
          declared_allergens: ['peanut'],
          dietary_preferences: ['halal'],
        }),
      ],
    });

    const result = await service.getDashboard(HOUSEHOLD_ID);

    expect(result.children[0]).toMatchObject({
      child_id: CHILD_A,
      name: 'Layla',
      age_band: 'preteen',
      declared_allergens: ['peanut'],
      dietary_preferences: ['halal'],
    });
  });
});
