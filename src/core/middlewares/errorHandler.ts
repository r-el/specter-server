import { Request, Response, NextFunction, ErrorRequestHandler } from "express";
import logger from "@core/utils/logger.js";
import { config } from "@core/config.js";

const ENVIRONMENT = config.server.environment;

/**
 * @param {number} statusCode - HTTP status code
 * @param {string} message - Error message
 */
class ApiError extends Error {
  statusCode: number;
  errors?: string[];

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;

    Error.captureStackTrace(this, this.constructor);
  }
}

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
  const message = err.message || String(err);

  // Log error
  logger.error(`${new Date().toISOString()} - ERROR:`, {
    message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    ip: req.ip,
  });

  res.status(err.statusCode || 500).json({
    success: false,
    error: message || "Internal server error",
    ...(err.errors && { errors: err.errors }),
    ...(ENVIRONMENT === "development" && { stack: err.stack }),
  });
};

export { ApiError, catchAsync, globalErrorHandler };
