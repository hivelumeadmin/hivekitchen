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

export function isDomainError(err: unknown): err is DomainError {
  return err instanceof DomainError;
}
