import { describe, it, expect } from 'vitest';
import { DataExportResponseSchema } from './data-export.js';

function validPayload() {
  return {
    status: 'queued',
    message: "We're preparing your export. You'll receive an email within 72 hours.",
  };
}

describe('DataExportResponseSchema', () => {
  it('round-trips a valid queued payload', () => {
    const r = DataExportResponseSchema.safeParse(validPayload());
    expect(r.success).toBe(true);
  });

  it('rejects a payload missing status', () => {
    const payload = validPayload();
    delete (payload as Record<string, unknown>).status;
    const r = DataExportResponseSchema.safeParse(payload);
    expect(r.success).toBe(false);
  });

  it('rejects a wrong status literal', () => {
    const r = DataExportResponseSchema.safeParse({ ...validPayload(), status: 'pending' });
    expect(r.success).toBe(false);
  });

  it('rejects a payload missing message', () => {
    const payload = validPayload();
    delete (payload as Record<string, unknown>).message;
    const r = DataExportResponseSchema.safeParse(payload);
    expect(r.success).toBe(false);
  });
});
