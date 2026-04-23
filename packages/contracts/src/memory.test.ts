import { describe, it, expect } from 'vitest';
import { ForgetRequest, ForgetCompletedEvent } from './memory.js';

const UUID1 = '00000000-0000-0000-0000-000000000001';
const DT = '2026-04-23T00:00:00Z';

describe('ForgetRequest', () => {
  it('parses valid soft forget request', () => {
    const r = ForgetRequest.safeParse({ node_id: UUID1, mode: 'soft' });
    expect(r.success).toBe(true);
  });

  it('parses with optional reason', () => {
    const r = ForgetRequest.safeParse({ node_id: UUID1, mode: 'soft', reason: 'parent requested' });
    expect(r.success).toBe(true);
  });

  it('rejects hard mode (Phase 1 gate)', () => {
    const r = ForgetRequest.safeParse({ node_id: UUID1, mode: 'hard' });
    expect(r.success).toBe(false);
  });

  it('rejects missing mode', () => {
    expect(ForgetRequest.safeParse({ node_id: UUID1 }).success).toBe(false);
  });

  it('rejects invalid node_id', () => {
    expect(ForgetRequest.safeParse({ node_id: 'not-uuid', mode: 'soft' }).success).toBe(false);
  });
});

describe('ForgetCompletedEvent', () => {
  it('parses valid event', () => {
    const r = ForgetCompletedEvent.safeParse({
      type: 'memory.forget.completed',
      node_id: UUID1,
      mode: 'soft',
      completed_at: DT,
    });
    expect(r.success).toBe(true);
  });

  it('rejects missing completed_at', () => {
    expect(ForgetCompletedEvent.safeParse({
      type: 'memory.forget.completed',
      node_id: UUID1,
      mode: 'soft',
    }).success).toBe(false);
  });

  it('rejects invalid type literal', () => {
    expect(ForgetCompletedEvent.safeParse({
      type: 'memory.forget.hard',
      node_id: UUID1,
      mode: 'soft',
      completed_at: DT,
    }).success).toBe(false);
  });
});
