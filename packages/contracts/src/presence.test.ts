import { describe, it, expect } from 'vitest';
import { SurfaceKind, PresenceEvent } from './presence.js';

const UUID1 = '00000000-0000-0000-0000-000000000001';
const UUID2 = '00000000-0000-0000-0000-000000000002';
const DT = '2026-04-23T01:00:00Z';

describe('SurfaceKind', () => {
  it('accepts all valid values', () => {
    const values = ['brief', 'plan_tile', 'lunch_link', 'heart_note_composer', 'thread', 'memory_node'] as const;
    for (const v of values) {
      expect(SurfaceKind.safeParse(v).success).toBe(true);
    }
  });

  it('rejects unknown surface', () => {
    expect(SurfaceKind.safeParse('settings').success).toBe(false);
  });
});

describe('PresenceEvent', () => {
  it('parses valid presence event', () => {
    const r = PresenceEvent.safeParse({
      type: 'presence.partner-active',
      thread_id: UUID1,
      user_id: UUID2,
      surface: 'thread',
      expires_at: DT,
    });
    expect(r.success).toBe(true);
  });

  it('rejects invalid surface value', () => {
    const r = PresenceEvent.safeParse({
      type: 'presence.partner-active',
      thread_id: UUID1,
      user_id: UUID2,
      surface: 'dashboard',
      expires_at: DT,
    });
    expect(r.success).toBe(false);
  });

  it('rejects missing expires_at', () => {
    expect(PresenceEvent.safeParse({
      type: 'presence.partner-active',
      thread_id: UUID1,
      user_id: UUID2,
      surface: 'brief',
    }).success).toBe(false);
  });

  it('rejects invalid thread_id', () => {
    expect(PresenceEvent.safeParse({
      type: 'presence.partner-active',
      thread_id: 'not-a-uuid',
      user_id: UUID2,
      surface: 'brief',
      expires_at: DT,
    }).success).toBe(false);
  });
});
