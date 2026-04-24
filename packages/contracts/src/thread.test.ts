import { describe, it, expect } from 'vitest';
import { Turn, TurnBody, TurnBodyMessage, TurnBodyPlanDiff, TurnBodyProposal, TurnBodySystemEvent, TurnBodyPresence } from './thread.js';

const UUID1 = '00000000-0000-0000-0000-000000000001';
const UUID2 = '00000000-0000-0000-0000-000000000002';
const UUID3 = '00000000-0000-0000-0000-000000000003';
const DT = '2026-04-23T00:00:00Z';

describe('TurnBodyMessage', () => {
  it('parses valid message body', () => {
    expect(TurnBodyMessage.safeParse({ type: 'message', content: 'Hello' }).success).toBe(true);
  });
  it('rejects missing content', () => {
    expect(TurnBodyMessage.safeParse({ type: 'message' }).success).toBe(false);
  });
});

describe('TurnBodyPlanDiff', () => {
  it('parses valid plan_diff body', () => {
    const r = TurnBodyPlanDiff.safeParse({ type: 'plan_diff', week_id: UUID1, diff: { slot: 'changed' } });
    expect(r.success).toBe(true);
  });
  it('rejects invalid week_id', () => {
    expect(TurnBodyPlanDiff.safeParse({ type: 'plan_diff', week_id: 'not-a-uuid', diff: {} }).success).toBe(false);
  });
});

describe('TurnBodyProposal', () => {
  it('parses valid proposal body', () => {
    const r = TurnBodyProposal.safeParse({ type: 'proposal', proposal_id: UUID1, content: 'Try this' });
    expect(r.success).toBe(true);
  });
});

describe('TurnBodySystemEvent', () => {
  it('parses without optional payload', () => {
    expect(TurnBodySystemEvent.safeParse({ type: 'system_event', event: 'plan.locked' }).success).toBe(true);
  });
  it('parses with optional payload', () => {
    const r = TurnBodySystemEvent.safeParse({ type: 'system_event', event: 'plan.locked', payload: { reason: 'x' } });
    expect(r.success).toBe(true);
  });
});

describe('TurnBodyPresence', () => {
  it('parses valid presence body', () => {
    expect(TurnBodyPresence.safeParse({ type: 'presence', user_id: UUID1 }).success).toBe(true);
  });
  it('rejects missing user_id', () => {
    expect(TurnBodyPresence.safeParse({ type: 'presence' }).success).toBe(false);
  });
});

describe('TurnBody', () => {
  it('discriminates on message type', () => {
    const r = TurnBody.safeParse({ type: 'message', content: 'hi' });
    expect(r.success).toBe(true);
  });
  it('discriminates on presence type', () => {
    const r = TurnBody.safeParse({ type: 'presence', user_id: UUID1 });
    expect(r.success).toBe(true);
  });
  it('rejects unknown discriminant', () => {
    expect(TurnBody.safeParse({ type: 'unknown', content: 'x' }).success).toBe(false);
  });
});

describe('Turn', () => {
  it('parses a valid message turn', () => {
    const result = Turn.safeParse({
      id: UUID1,
      thread_id: UUID2,
      server_seq: '1',
      created_at: DT,
      role: 'user',
      body: { type: 'message', content: 'Hello' },
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.server_seq).toBe(BigInt(1));
  });

  it('coerces server_seq string to bigint', () => {
    const r = Turn.safeParse({
      id: UUID1,
      thread_id: UUID2,
      server_seq: '9007199254740993',
      created_at: DT,
      role: 'lumi',
      body: { type: 'message', content: 'Hi' },
    });
    expect(r.success).toBe(true);
    if (r.success) expect(typeof r.data.server_seq).toBe('bigint');
  });

  it('rejects invalid role', () => {
    const result = Turn.safeParse({
      id: UUID1,
      thread_id: UUID2,
      server_seq: '1',
      created_at: DT,
      role: 'admin',
      body: { type: 'message', content: 'Hello' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid body type', () => {
    const result = Turn.safeParse({
      id: UUID1,
      thread_id: UUID2,
      server_seq: '1',
      created_at: DT,
      role: 'user',
      body: { type: 'invalid_type', content: 'x' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing thread_id', () => {
    expect(Turn.safeParse({
      id: UUID1,
      server_seq: '1',
      created_at: DT,
      role: 'user',
      body: { type: 'message', content: 'x' },
    }).success).toBe(false);
  });

  it('rejects empty-string server_seq (no silent 0n coercion)', () => {
    expect(Turn.safeParse({
      id: UUID1,
      thread_id: UUID2,
      server_seq: '',
      created_at: DT,
      role: 'user',
      body: { type: 'message', content: 'x' },
    }).success).toBe(false);
  });

  it('rejects array server_seq (no silent 0n coercion)', () => {
    expect(Turn.safeParse({
      id: UUID1,
      thread_id: UUID2,
      server_seq: [],
      created_at: DT,
      role: 'user',
      body: { type: 'message', content: 'x' },
    }).success).toBe(false);
  });

  it('rejects non-numeric string server_seq', () => {
    expect(Turn.safeParse({
      id: UUID1,
      thread_id: UUID2,
      server_seq: '1e3',
      created_at: DT,
      role: 'user',
      body: { type: 'message', content: 'x' },
    }).success).toBe(false);
  });
});
