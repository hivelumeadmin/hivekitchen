import { describe, it, expect } from 'vitest';
import { ErrorCode, FieldError, ApiError } from './errors.js';

describe('ErrorCode', () => {
  it('accepts all valid error codes', () => {
    const codes = [
      'VALIDATION_FAILED',
      'UNAUTHORIZED',
      'FORBIDDEN',
      'NOT_FOUND',
      'CONFLICT',
      'RATE_LIMITED',
      'AGENT_UNAVAILABLE',
      'GUARDRAIL_BLOCKED',
      'CULTURAL_INTERSECTION_EMPTY',
      'SCOPE_FORBIDDEN',
    ] as const;
    for (const code of codes) {
      expect(ErrorCode.safeParse(code).success).toBe(true);
    }
  });

  it('rejects unknown code', () => {
    expect(ErrorCode.safeParse('INVALID_CODE').success).toBe(false);
  });

  it('rejects lowercase code', () => {
    expect(ErrorCode.safeParse('unauthorized').success).toBe(false);
  });
});

describe('FieldError', () => {
  it('parses valid field error', () => {
    const r = FieldError.safeParse({
      path: ['body', 'email'],
      code: 'VALIDATION_FAILED',
      message: 'Invalid email format',
    });
    expect(r.success).toBe(true);
  });

  it('parses with empty path (top-level error)', () => {
    const r = FieldError.safeParse({ path: [], code: 'FORBIDDEN', message: 'Access denied' });
    expect(r.success).toBe(true);
  });

  it('rejects invalid code', () => {
    expect(FieldError.safeParse({ path: ['name'], code: 'MADE_UP', message: 'x' }).success).toBe(false);
  });
});

describe('ApiError', () => {
  it('parses valid error without fields', () => {
    const r = ApiError.safeParse({
      code: 'NOT_FOUND',
      message: 'Resource not found',
      trace_id: 'trace-123',
    });
    expect(r.success).toBe(true);
  });

  it('parses valid error with fields', () => {
    const r = ApiError.safeParse({
      code: 'VALIDATION_FAILED',
      message: 'Request validation failed',
      fields: [{ path: ['body', 'name'], code: 'VALIDATION_FAILED', message: 'Required' }],
      trace_id: 'trace-456',
    });
    expect(r.success).toBe(true);
  });

  it('rejects missing trace_id', () => {
    expect(ApiError.safeParse({ code: 'UNAUTHORIZED', message: 'Auth required' }).success).toBe(false);
  });

  it('rejects invalid code', () => {
    expect(ApiError.safeParse({ code: 'OOPS', message: 'x', trace_id: 'y' }).success).toBe(false);
  });
});
