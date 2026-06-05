import { describe, it, expect } from 'vitest';
import { ConsentHistoryResponseSchema } from './consent-history.js';

const UUID = '00000000-0000-4000-8000-000000000001';
const DT = '2026-06-04T00:00:00Z';

function fullPayload() {
  return {
    events: [
      {
        id: UUID,
        event_type: 'vpc.consented',
        metadata: { mechanism: 'signed_declaration', document_version: 'v1.0' },
        created_at: DT,
      },
      {
        id: '00000000-0000-4000-8000-000000000002',
        event_type: 'account.created',
        metadata: {},
        created_at: '2026-06-03T00:00:00Z',
      },
    ],
  };
}

describe('ConsentHistoryResponseSchema', () => {
  it('round-trips a valid payload with 2 events', () => {
    const r = ConsentHistoryResponseSchema.safeParse(fullPayload());
    expect(r.success).toBe(true);
  });

  it('rejects an event missing event_type', () => {
    const payload = fullPayload();
    delete (payload.events[0] as Record<string, unknown>).event_type;
    const r = ConsentHistoryResponseSchema.safeParse(payload);
    expect(r.success).toBe(false);
  });

  it('rejects an event whose id is not a uuid', () => {
    const payload = fullPayload();
    payload.events[0].id = 'not-a-uuid';
    const r = ConsentHistoryResponseSchema.safeParse(payload);
    expect(r.success).toBe(false);
  });

  it('rejects an event whose created_at is not an ISO datetime', () => {
    const payload = fullPayload();
    payload.events[0].created_at = 'June 4th';
    const r = ConsentHistoryResponseSchema.safeParse(payload);
    expect(r.success).toBe(false);
  });
});
