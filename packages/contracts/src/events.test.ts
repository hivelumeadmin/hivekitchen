import { describe, it, expect } from 'vitest';
import { InvalidationEvent } from './events.js';

const UUID1 = '00000000-0000-0000-0000-000000000001';
const UUID2 = '00000000-0000-0000-0000-000000000002';
const UUID3 = '00000000-0000-0000-0000-000000000003';
const DT = '2026-04-23T00:00:00Z';

describe('InvalidationEvent plan.updated (unified with PlanUpdatedEvent)', () => {
  it('requires guardrail_verdict', () => {
    // Pre-unification this parsed as valid; after D1 unify it must reject.
    expect(InvalidationEvent.safeParse({ type: 'plan.updated', week_id: UUID1 }).success).toBe(false);
  });

  it('parses with cleared guardrail_verdict', () => {
    const r = InvalidationEvent.safeParse({
      type: 'plan.updated',
      week_id: UUID1,
      guardrail_verdict: { verdict: 'cleared' },
    });
    expect(r.success).toBe(true);
  });

  it('parses with blocked guardrail_verdict', () => {
    const r = InvalidationEvent.safeParse({
      type: 'plan.updated',
      week_id: UUID1,
      guardrail_verdict: { verdict: 'blocked', allergens: ['peanut'] },
    });
    expect(r.success).toBe(true);
  });
});

describe('InvalidationEvent presence.partner-active (unified with PresenceEvent)', () => {
  it('requires surface and expires_at', () => {
    expect(
      InvalidationEvent.safeParse({
        type: 'presence.partner-active',
        thread_id: UUID1,
        user_id: UUID2,
      }).success,
    ).toBe(false);
  });

  it('parses with surface and expires_at', () => {
    const r = InvalidationEvent.safeParse({
      type: 'presence.partner-active',
      thread_id: UUID1,
      user_id: UUID2,
      surface: 'brief',
      expires_at: DT,
    });
    expect(r.success).toBe(true);
  });
});

describe('InvalidationEvent memory.forget.completed (transport added)', () => {
  it('parses valid forget-completed event', () => {
    const r = InvalidationEvent.safeParse({
      type: 'memory.forget.completed',
      node_id: UUID1,
      mode: 'soft',
      completed_at: DT,
    });
    expect(r.success).toBe(true);
  });

  it('rejects forget-completed with mode other than soft', () => {
    expect(
      InvalidationEvent.safeParse({
        type: 'memory.forget.completed',
        node_id: UUID1,
        mode: 'hard',
        completed_at: DT,
      }).success,
    ).toBe(false);
  });
});

describe('InvalidationEvent thread.resync sequence id', () => {
  it('coerces numeric string from_seq', () => {
    const r = InvalidationEvent.safeParse({
      type: 'thread.resync',
      thread_id: UUID1,
      from_seq: '42',
    });
    expect(r.success).toBe(true);
    if (r.success && r.data.type === 'thread.resync') {
      expect(r.data.from_seq).toBe(BigInt(42));
    }
  });

  it('rejects empty-string from_seq', () => {
    expect(
      InvalidationEvent.safeParse({ type: 'thread.resync', thread_id: UUID1, from_seq: '' }).success,
    ).toBe(false);
  });
});

describe('InvalidationEvent other members still parse', () => {
  it('parses thread.turn with Turn body', () => {
    const r = InvalidationEvent.safeParse({
      type: 'thread.turn',
      thread_id: UUID1,
      turn: {
        id: UUID2,
        thread_id: UUID1,
        server_seq: '1',
        created_at: DT,
        role: 'user',
        body: { type: 'message', content: 'hi' },
      },
    });
    expect(r.success).toBe(true);
  });

  it('parses packer.assigned', () => {
    const r = InvalidationEvent.safeParse({
      type: 'packer.assigned',
      date: '2026-04-23',
      packer_id: UUID3,
    });
    expect(r.success).toBe(true);
  });

  it('parses allergy.verdict', () => {
    const r = InvalidationEvent.safeParse({
      type: 'allergy.verdict',
      plan_id: UUID1,
      verdict: { verdict: 'pending' },
    });
    expect(r.success).toBe(true);
  });

  it('parses pantry.delta with items_added', () => {
    const r = InvalidationEvent.safeParse({
      type: 'pantry.delta',
      delta: { items_added: [UUID2] },
    });
    expect(r.success).toBe(true);
  });

  it('parses memory.updated', () => {
    const r = InvalidationEvent.safeParse({ type: 'memory.updated', node_id: UUID1 });
    expect(r.success).toBe(true);
  });

  it('rejects unknown discriminant', () => {
    expect(InvalidationEvent.safeParse({ type: 'unknown.event' }).success).toBe(false);
  });
});
