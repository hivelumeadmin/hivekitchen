import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { VariantProposalRepository } from './variant-proposal.repository.js';
import type { VariantProposal } from '@hivekitchen/types';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const PLAN_ITEM_ID = '22222222-2222-4222-8222-222222222222';
const CHILD_ID = '33333333-3333-4333-8333-333333333333';
const PROPOSAL_ID = '44444444-4444-4444-8444-444444444444';
const PLAN_ID = '55555555-5555-4555-8555-555555555555';

interface Step {
  op: string;
  args: unknown[];
}

const SAMPLE_PROPOSAL: VariantProposal = {
  id: PROPOSAL_ID,
  household_id: HOUSEHOLD_ID,
  child_id: CHILD_ID,
  plan_item_id: PLAN_ITEM_ID,
  plan_id: PLAN_ID,
  base_recipe_name: 'chicken, rice, peas',
  base_method: 'pan-fried',
  variant_description: 'oven-baked instead of pan-fried',
  variant_method: 'oven-baked',
  proposed_at: '2026-05-25T12:00:00.000Z',
  confirmed_at: null,
  rejected_at: null,
};

// Supabase query builders are thenable — awaiting the chain itself resolves.
// Our helper mirrors that: every chainable op returns the same builder, and
// `.then` makes the builder awaitable so callers don't need to know which
// terminal method (`.single`, `.maybeSingle`, or direct await) is used.
function buildChainClient(
  terminalResult: unknown,
): { client: SupabaseClient; steps: Step[] } {
  const steps: Step[] = [];
  const builder: Record<string, unknown> = {};
  const passthrough = (op: string) => (...args: unknown[]) => {
    steps.push({ op, args });
    return builder;
  };
  const ops = ['insert', 'update', 'eq', 'select', 'is'];
  for (const op of ops) {
    builder[op] = passthrough(op);
  }
  builder.single = vi.fn().mockResolvedValue(terminalResult);
  builder.maybeSingle = vi.fn().mockResolvedValue(terminalResult);
  builder.then = (resolve: (v: unknown) => unknown) => resolve(terminalResult);
  const fromMock = vi.fn().mockImplementation((table: string) => {
    steps.push({ op: 'from', args: [table] });
    return builder;
  });
  return {
    client: { from: fromMock } as unknown as SupabaseClient,
    steps,
  };
}

describe('VariantProposalRepository.create', () => {
  it('inserts a row and returns the created proposal', async () => {
    const { client, steps } = buildChainClient({ data: SAMPLE_PROPOSAL, error: null });
    const repo = new VariantProposalRepository(client);

    const result = await repo.create({
      householdId: HOUSEHOLD_ID,
      childId: CHILD_ID,
      planItemId: PLAN_ITEM_ID,
      planId: PLAN_ID,
      baseRecipeName: 'chicken, rice, peas',
      baseMethod: 'pan-fried',
      variantDescription: 'oven-baked instead of pan-fried',
      variantMethod: 'oven-baked',
    });

    expect(result).toEqual(SAMPLE_PROPOSAL);
    const insertStep = steps.find((s) => s.op === 'insert');
    expect(insertStep).toBeDefined();
    const payload = insertStep!.args[0] as Record<string, unknown>;
    expect(payload.household_id).toBe(HOUSEHOLD_ID);
    expect(payload.plan_item_id).toBe(PLAN_ITEM_ID);
    expect(payload.base_method).toBe('pan-fried');
    expect(payload.variant_method).toBe('oven-baked');
    expect(payload.base_rating).toBeNull();
  });

  it('throws when the underlying client returns an error', async () => {
    const { client } = buildChainClient({ data: null, error: new Error('db-down') });
    const repo = new VariantProposalRepository(client);

    await expect(
      repo.create({
        householdId: HOUSEHOLD_ID,
        childId: CHILD_ID,
        planItemId: PLAN_ITEM_ID,
        planId: PLAN_ID,
        baseRecipeName: 'chicken',
        baseMethod: 'pan-fried',
        variantDescription: 'baked',
        variantMethod: 'oven-baked',
      }),
    ).rejects.toThrow('db-down');
  });
});

describe('VariantProposalRepository.findActiveByPlan', () => {
  it('queries by plan_id with confirmed_at IS NULL AND rejected_at IS NULL', async () => {
    const { client, steps } = buildChainClient({ data: [SAMPLE_PROPOSAL], error: null });
    const repo = new VariantProposalRepository(client);

    const rows = await repo.findActiveByPlan(PLAN_ID);

    expect(rows).toEqual([SAMPLE_PROPOSAL]);
    // Two .is() calls expected — confirmed_at + rejected_at.
    const isSteps = steps.filter((s) => s.op === 'is');
    expect(isSteps.length).toBeGreaterThanOrEqual(2);
    const isKeys = isSteps.map((s) => s.args[0]);
    expect(isKeys).toContain('confirmed_at');
    expect(isKeys).toContain('rejected_at');
  });

  it('returns [] when no active proposals exist', async () => {
    const { client } = buildChainClient({ data: null, error: null });
    const repo = new VariantProposalRepository(client);

    const rows = await repo.findActiveByPlan(PLAN_ID);

    expect(rows).toEqual([]);
  });
});

describe('VariantProposalRepository.confirm', () => {
  it('updates confirmed_at scoped by household + active filters', async () => {
    const { client, steps } = buildChainClient({ data: [{ id: PROPOSAL_ID }], error: null });
    const repo = new VariantProposalRepository(client);

    await repo.confirm(PROPOSAL_ID, HOUSEHOLD_ID);

    const updateStep = steps.find((s) => s.op === 'update');
    expect(updateStep).toBeDefined();
    const payload = updateStep!.args[0] as { confirmed_at: string };
    expect(typeof payload.confirmed_at).toBe('string');
  });

  it('throws when the proposal is not found or already resolved (zero rows updated)', async () => {
    const { client } = buildChainClient({ data: [], error: null });
    const repo = new VariantProposalRepository(client);

    await expect(repo.confirm(PROPOSAL_ID, HOUSEHOLD_ID)).rejects.toThrow('not found or already resolved');
  });
});

describe('VariantProposalRepository.reject', () => {
  it('updates rejected_at scoped by household + active filters', async () => {
    const { client, steps } = buildChainClient({ data: [{ id: PROPOSAL_ID }], error: null });
    const repo = new VariantProposalRepository(client);

    await repo.reject(PROPOSAL_ID, HOUSEHOLD_ID);

    const updateStep = steps.find((s) => s.op === 'update');
    expect(updateStep).toBeDefined();
    const payload = updateStep!.args[0] as { rejected_at: string };
    expect(typeof payload.rejected_at).toBe('string');
  });

  it('throws when the proposal is not found or already resolved (zero rows updated)', async () => {
    const { client } = buildChainClient({ data: [], error: null });
    const repo = new VariantProposalRepository(client);

    await expect(repo.reject(PROPOSAL_ID, HOUSEHOLD_ID)).rejects.toThrow('not found or already resolved');
  });
});
