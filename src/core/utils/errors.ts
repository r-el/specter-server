/**
 * Standard HTTP Error Classes
 *
 * Provides typed, self-documenting error classes that map directly to HTTP status codes.
 * Handled automatically by globalErrorHandler middleware via `statusCode`.
 */

export class ApiError extends Error {
  statusCode: number;
  errors?: string[];

  constructor(statusCode: number, message: string, errors?: string[]) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    if (errors) this.errors = errors;

    Error.captureStackTrace(this, this.constructor);
  }
}

export class BadRequestError extends ApiError {
  constructor(message = "Bad request", errors?: string[]) {
    super(400, message, errors);
  }
}

export class ValidationError extends ApiError {
  constructor(message = "Validation failed", errors?: string[]) {
    super(400, message, errors);
  }
}

export class UnauthorizedError extends ApiError {
  constructor(message = "Unauthorized") {
    super(401, message);
  }
}

export class ForbiddenError extends ApiError {
  constructor(message = "Forbidden") {
    super(403, message);
  }
}

export class NotFoundError extends ApiError {
  constructor(message = "Not found") {
    super(404, message);
  }
}

export class ConflictError extends ApiError {
  constructor(message = "Conflict") {
    super(409, message);
  }
}

export class BadGatewayError extends ApiError {
  constructor(message = "Bad gateway — upstream service error") {
    super(502, message);
  }
}
