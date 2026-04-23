import { z } from 'zod';

export const ErrorCode = z.enum([
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
]);

export const FieldError = z.object({
  path: z.array(z.string()),
  code: ErrorCode,
  message: z.string(),
});

export const ApiError = z.object({
  code: ErrorCode,
  message: z.string(),
  fields: z.array(FieldError).optional(),
  trace_id: z.string(),
});
