import rateLimit from "express-rate-limit";
import { config } from "@core/config.js";

/**
 * Global rate limiter to prevent abuse
 */
export const globalLimiter = rateLimit({
  windowMs: config.server.rateLimitWindowMs,
  max: config.server.rateLimitMax,
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  message: {
    success: false,
    error: `Too many requests from this IP, please try again after ${config.server.rateLimitWindowMs / (60 * 1000)} minutes`,
  },
});

/**
 * Stricter rate limiter for authentication endpoints
 */
export const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20, // Limit each IP to 20 login/register requests per hour
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: "Too many authentication attempts from this IP, please try again after an hour",
  },
});
