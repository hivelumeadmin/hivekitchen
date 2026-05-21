import { describe, it, expect } from 'vitest';
import { ENFORCEMENT_LEVEL_VALUES, EnforcementLevelSchema } from './enforcement.js';

describe('EnforcementLevelSchema', () => {
  it('accepts every documented value', () => {
    for (const v of ENFORCEMENT_LEVEL_VALUES) {
      expect(EnforcementLevelSchema.safeParse(v).success).toBe(true);
    }
  });

  it('rejects unknown value', () => {
    expect(EnforcementLevelSchema.safeParse('mandatory').success).toBe(false);
  });

  it('rejects non-string', () => {
    expect(EnforcementLevelSchema.safeParse(1).success).toBe(false);
    expect(EnforcementLevelSchema.safeParse(null).success).toBe(false);
  });
});

describe('ENFORCEMENT_LEVEL_VALUES', () => {
  // Order parity matters — the Postgres enum is created with values in this
  // exact order (migration 20260903000000). The DB-side parity test in
  // apps/api asserts `pg_enum` matches this tuple element-for-element.
  it('has exactly five values in the documented order', () => {
    expect(ENFORCEMENT_LEVEL_VALUES).toEqual([
      'non_negotiable',
      'strong',
      'default',
      'soft',
      'just_for_context',
    ]);
  });
});
