import { Request, Response, NextFunction, ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import * as Sentry from "@sentry/node";
import logger from "@core/utils/logger.js";
import { config } from "@core/config.js";
import { ApiError } from "@core/utils/errors.js";

type AsyncHandler<Req = Request> = (req: Req, res: Response, next: NextFunction) => Promise<void | any>;

/**
 * Async error wrapper
 * Catches async errors and passes them to error handler
 */
const catchAsync =
  <Req = Request>(fn: AsyncHandler<Req>) =>
  (req: Request, res: Response, next: NextFunction) =>
    Promise.resolve(fn(req as unknown as Req, res, next)).catch(next);

/**
 * Global error handling middleware
 */
const globalErrorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const isZod = err instanceof ZodError;
  const statusCode = err.statusCode || (isZod ? 400 : 500);
  const isClientError = statusCode < 500;
  const rawMessage = isZod
    ? err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") || "Validation failed"
    : err.message || String(err);

  // Differentiate log severity: client errors (4xx) as warn, server errors (500+) as error with stack
  if (isClientError) {
    if (err.metadata) {
      logger.warn(`${req.method} ${req.originalUrl} - ${statusCode} ${rawMessage}`, { metadata: err.metadata });
    } else {
      logger.warn(`${req.method} ${req.originalUrl} - ${statusCode} ${rawMessage}`);
    }
  } else {
    logger.error(`${new Date().toISOString()} - ERROR:`, {
      message: rawMessage,
      stack: err.stack,
      url: req.originalUrl,
      method: req.method,
      ip: req.ip,
      ...(err.metadata && { metadata: err.metadata }),
    });
  }

  // In production, mask internal server error details to prevent data leakage
  const errorResponse =
    isClientError || !config.server.isProduction
      ? rawMessage || "Internal server error"
      : "An unexpected error occurred";

  res.status(statusCode).json({
    success: false,
    error: errorResponse,
    ...(err.errors && { errors: err.errors }),
    ...(isZod && { errors: err.issues }),
    ...(err.metadata && { metadata: err.metadata }),
    ...(config.server.environment === "development" && { stack: err.stack }),
  });
};

export { ApiError, catchAsync, globalErrorHandler };
export * from "@core/utils/errors.js";
