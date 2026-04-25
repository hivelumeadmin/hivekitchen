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

export function isDomainError(err: unknown): err is DomainError {
  return err instanceof DomainError;
}
