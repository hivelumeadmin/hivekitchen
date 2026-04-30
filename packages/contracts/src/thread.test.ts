import { describe, it, expect } from 'vitest';
import { Turn, TurnBody, TurnBodyMessage, TurnBodyPlanDiff, TurnBodyProposal, TurnBodySystemEvent, TurnBodyPresence, TurnBodyRatificationPrompt } from './thread.js';

const UUID1 = '00000000-0000-4000-8000-000000000001';
const UUID2 = '00000000-0000-4000-8000-000000000002';
const UUID3 = '00000000-0000-4000-8000-000000000003';
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

  it('accepts modality: voice', () => {
    expect(Turn.safeParse({
      id: UUID1,
      thread_id: UUID2,
      server_seq: '1',
      created_at: DT,
      role: 'lumi',
      body: { type: 'message', content: 'hi' },
      modality: 'voice',
    }).success).toBe(true);
  });

  it('accepts Turn with modality absent', () => {
    expect(Turn.safeParse({
      id: UUID1,
      thread_id: UUID2,
      server_seq: '1',
      created_at: DT,
      role: 'user',
      body: { type: 'message', content: 'hi' },
    }).success).toBe(true);
  });

  it('rejects invalid modality string', () => {
    expect(Turn.safeParse({
      id: UUID1,
      thread_id: UUID2,
      server_seq: '1',
      created_at: DT,
      role: 'user',
      body: { type: 'message', content: 'hi' },
      modality: 'fax',
    }).success).toBe(false);
  });
});

describe('TurnBodyRatificationPrompt', () => {
  const PRIOR_UUID = '33333333-3333-4333-8333-333333333333';

  it('accepts a valid ratification_prompt body', () => {
    expect(
      TurnBodyRatificationPrompt.safeParse({
        type: 'ratification_prompt',
        priors: [{ prior_id: PRIOR_UUID, key: 'halal', label: 'Halal' }],
      }).success,
    ).toBe(true);
  });

  it('rejects an invalid cultural key', () => {
    expect(
      TurnBodyRatificationPrompt.safeParse({
        type: 'ratification_prompt',
        priors: [{ prior_id: PRIOR_UUID, key: 'west_african', label: 'West African' }],
      }).success,
    ).toBe(false);
  });

  it('rejects entry missing prior_id', () => {
    expect(
      TurnBodyRatificationPrompt.safeParse({
        type: 'ratification_prompt',
        priors: [{ key: 'halal', label: 'Halal' }],
      }).success,
    ).toBe(false);
  });
});

describe('TurnBody — ratification_prompt discriminant', () => {
  it('discriminates on ratification_prompt type', () => {
    const PRIOR_UUID = '33333333-3333-4333-8333-333333333333';
    const r = TurnBody.safeParse({
      type: 'ratification_prompt',
      priors: [{ prior_id: PRIOR_UUID, key: 'south_asian', label: 'South Asian' }],
    });
    expect(r.success).toBe(true);
  });
});
