/**
 * Standard HTTP Error Classes
 *
 * Provides typed, self-documenting error classes that map directly to HTTP status codes.
 * Handled automatically by globalErrorHandler middleware via `statusCode`.
 */

export class ApiError extends Error {
  statusCode: number;
  errors?: string[];
  metadata?: Record<string, unknown>;

  constructor(statusCode: number, message: string, errors?: string[], metadata?: Record<string, unknown>) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    if (errors) this.errors = errors;
    if (metadata) this.metadata = metadata;

    Error.captureStackTrace(this, this.constructor);
  }
}

export class BadRequestError extends ApiError {
  constructor(message = "Bad request", errors?: string[], metadata?: Record<string, unknown>) {
    super(400, message, errors, metadata);
  }
}

export class ValidationError extends ApiError {
  constructor(message = "Validation failed", errors?: string[], metadata?: Record<string, unknown>) {
    super(400, message, errors, metadata);
  }
}

export class UnauthorizedError extends ApiError {
  constructor(message = "Unauthorized", metadata?: Record<string, unknown>) {
    super(401, message, undefined, metadata);
  }
}

export class ForbiddenError extends ApiError {
  constructor(message = "Forbidden", metadata?: Record<string, unknown>) {
    super(403, message, undefined, metadata);
  }
}

export class NotFoundError extends ApiError {
  constructor(message = "Not found", metadata?: Record<string, unknown>) {
    super(404, message, undefined, metadata);
  }
}

export class ConflictError extends ApiError {
  constructor(message = "Conflict", metadata?: Record<string, unknown>) {
    super(409, message, undefined, metadata);
  }
}

export class BadGatewayError extends ApiError {
  constructor(message = "Bad gateway — upstream service error", metadata?: Record<string, unknown>) {
    super(502, message, undefined, metadata);
  }
}
