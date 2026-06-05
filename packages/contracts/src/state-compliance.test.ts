import { describe, it, expect } from 'vitest';
import { StateComplianceOverrideSchema } from './state-compliance.js';

const VALID_OVERRIDE = {
  id: '11111111-1111-4111-8111-111111111111',
  state: 'CT',
  override_type: 'disclosure',
  value: { text: 'CT disclosure' },
  effective_from: '2026-01-01',
  created_at: '2026-06-13T00:00:00.000Z',
};

describe('StateComplianceOverrideSchema', () => {
  it('parses a valid override row', () => {
    const result = StateComplianceOverrideSchema.safeParse(VALID_OVERRIDE);
    expect(result.success).toBe(true);
  });

  it('rejects a missing state field', () => {
    const { state: _state, ...rest } = VALID_OVERRIDE;
    const result = StateComplianceOverrideSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects state longer than 2 characters', () => {
    const result = StateComplianceOverrideSchema.safeParse({ ...VALID_OVERRIDE, state: 'CTX' });
    expect(result.success).toBe(false);
  });

  it('rejects override_type as empty string', () => {
    const result = StateComplianceOverrideSchema.safeParse({ ...VALID_OVERRIDE, override_type: '' });
    expect(result.success).toBe(false);
  });
});
