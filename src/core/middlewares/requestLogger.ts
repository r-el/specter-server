import { Request, Response, NextFunction } from "express";
import logger from "@core/utils/logger.js";

/**
 * Request logger middleware.
 * Records HTTP method, URL, status code, and response duration.
 */
export const requestLogger = (req: Request, res: Response, next: NextFunction): void => {
  const start = Date.now();

  res.on("finish", () => {
    const duration = Date.now() - start;
    const message = `${req.method} ${req.originalUrl || req.url} ${res.statusCode} ${duration}ms`;

    if (req.originalUrl?.includes("/health")) {
      logger.debug(message);
    } else {
      logger.http(message);
    }
  });

  next();
};
