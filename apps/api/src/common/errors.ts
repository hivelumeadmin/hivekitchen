// RFC 7807 Problem+JSON serialization is performed in app.ts setErrorHandler.
// Each class carries the wire fields directly; the handler maps `instance` from request.id.

export interface ProblemDetailFields {
  type: string;
  status: number;
  title: string;
  detail?: string;
}

export abstract class DomainError extends Error implements ProblemDetailFields {
  abstract readonly type: string;
  abstract readonly status: number;
  abstract readonly title: string;

  constructor(public override readonly message: string) {
    super(message);
    this.name = new.target.name;
  }

  get detail(): string {
    return this.message;
  }
}

export class UnauthorizedError extends DomainError {
  readonly type = '/errors/unauthorized';
  readonly status = 401;
  readonly title = 'Unauthorized';
}

export class ForbiddenError extends DomainError {
  readonly type = '/errors/forbidden';
  readonly status = 403;
  readonly title = 'Forbidden';
}

export class ConflictError extends DomainError {
  readonly type = '/errors/conflict';
  readonly status = 409;
  readonly title = 'Conflict';
}

export class ValidationError extends DomainError {
  readonly type = '/errors/validation';
  readonly status = 400;
  readonly title = 'Validation failed';
}

export class LinkExpiredError extends DomainError {
  readonly type = '/errors/link-expired';
  readonly status = 410;
  readonly title = 'Link expired or already used';
}

export class NotFoundError extends DomainError {
  readonly type = '/errors/not-found';
  readonly status = 404;
  readonly title = 'Not Found';
}

export class UpstreamError extends DomainError {
  readonly type = '/errors/upstream';
  readonly status = 502;
  readonly title = 'Upstream Service Unavailable';
}

export class NotImplementedError extends DomainError {
  readonly type = '/errors/not-implemented';
  readonly status = 501;
  readonly title = 'Not Implemented';
}

export class GuardrailRejectionError extends DomainError {
  readonly type = '/errors/guardrail-rejection';
  readonly status = 422;
  readonly title = 'Plan blocked by allergy guardrail';
  constructor(planId: string, attemptCount: number) {
    super(
      `Plan ${planId} blocked by allergy guardrail after ${String(attemptCount)} attempt(s). Regeneration required with rejection context.`,
    );
  }
}

export class SwapGuardrailBlockedError extends DomainError {
  readonly type = '/errors/swap-guardrail-blocked';
  readonly status = 422;
  readonly title = 'Swap blocked by allergy guardrail';
  constructor(itemId: string, allergens: string[]) {
    super(
      allergens.length > 0
        ? `Item ${itemId} swap blocked: would introduce ${allergens.join(', ')}`
        : `Item ${itemId} swap blocked: guardrail evaluation inconclusive`,
    );
  }
}

// Story 3.13 — Returned when a household exceeds the regeneration rate limit
// (5 requests per plan-week per household). Carries retryAfterSeconds so the
// global error handler can emit the matching Retry-After response header.
export class TooManyRequestsError extends DomainError {
  readonly type = '/errors/too-many-requests';
  readonly status = 429;
  readonly title = 'Too Many Requests';
  readonly retryAfterSeconds: number;
  constructor(retryAfterSeconds: number) {
    super(
      `Rate limit exceeded. Try again in ${String(retryAfterSeconds)} seconds.`,
    );
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

// Same readonly literal-type constraint as ParentalNoticeRequiredError below:
// extends DomainError directly with status 403 instead of subclassing ForbiddenError.
// instanceof ForbiddenError is false for this error; callers must use isDomainError()
// or check error.type / error.status instead.
export class ForbiddenToolCallError extends DomainError {
  readonly type = '/errors/forbidden-tool-call';
  readonly status = 403;
  readonly title = 'Forbidden Tool Call';
  constructor(toolName: string) {
    super(`Tool '${toolName}' is not in this agent's allowed tool set.`);
  }
}

// TypeScript prevents overriding `readonly` literal properties (type, title) declared
// in a subclass (ForbiddenError). Extends DomainError directly with status = 403 to
// achieve the same HTTP semantics. instanceof ForbiddenError is false for this error;
// callers must use isDomainError() or check error.type / error.status instead.
export class ParentalNoticeRequiredError extends DomainError {
  readonly type = '/errors/parental-notice-required';
  readonly status = 403;
  readonly title = 'Parental notice acknowledgment required';
  constructor() {
    super(
      'Primary parent must acknowledge the parental notice before adding a child profile.',
    );
  }
}

// Thrown by HouseholdsRepository when an encrypted household column cannot be
// decrypted — indicates DEK mismatch or data corruption. Callers must surface
// this as a 500 rather than silently treating the field as empty, because an
// empty allergen list is semantically different from "data unreadable."
export class HouseholdDecryptError extends DomainError {
  readonly type = '/errors/household-decrypt';
  readonly status = 500;
  readonly title = 'Household data decryption failed';
  constructor() {
    super(
      'Failed to decrypt household profile data — possible DEK mismatch or data corruption',
    );
  }
}

export function isDomainError(err: unknown): err is DomainError {
  return err instanceof DomainError;
}
