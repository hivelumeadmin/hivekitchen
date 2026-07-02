import { describe, it, expect } from 'vitest';
import { AutoComposeStateSchema, UpdateAutoComposeRequestSchema } from './auto-compose.js';

describe('AutoComposeStateSchema', () => {
  it('accepts an enabled state with a plan', () => {
    const parsed = AutoComposeStateSchema.parse({ auto_compose_enabled: true, has_plan: true });
    expect(parsed.auto_compose_enabled).toBe(true);
    expect(parsed.has_plan).toBe(true);
  });

  it('accepts a disabled state without a plan', () => {
    const parsed = AutoComposeStateSchema.parse({ auto_compose_enabled: false, has_plan: false });
    expect(parsed.auto_compose_enabled).toBe(false);
  });

  it('rejects a missing has_plan field', () => {
    expect(() => AutoComposeStateSchema.parse({ auto_compose_enabled: true })).toThrow();
  });

  it('rejects a non-boolean enabled flag', () => {
    expect(() =>
      AutoComposeStateSchema.parse({ auto_compose_enabled: 'yes', has_plan: true }),
    ).toThrow();
  });
});

describe('UpdateAutoComposeRequestSchema', () => {
  it('accepts a boolean toggle', () => {
    expect(UpdateAutoComposeRequestSchema.parse({ auto_compose_enabled: false })).toEqual({
      auto_compose_enabled: false,
    });
  });

  it('rejects a missing field', () => {
    expect(() => UpdateAutoComposeRequestSchema.parse({})).toThrow();
  });
});
