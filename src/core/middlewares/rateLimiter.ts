import rateLimit from "express-rate-limit";
import { default as RedisStore } from "rate-limit-redis";
import { Redis } from "ioredis";
import { config } from "@core/config.js";

// Setup Redis Client for rate limiting if configured
const redisClient =
  config.cache?.driver === "redis" && config.cache?.redisUrl ? new Redis(config.cache.redisUrl) : undefined;

const store = redisClient
  ? new RedisStore({
      // @ts-expect-error - Known issue with ioredis types
      sendCommand: (...args: string[]) => redisClient.call(...args),
    })
  : undefined;

/**
 * Global rate limiter to prevent abuse
 */
export const globalLimiter = rateLimit({
  store,
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
  store,
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20, // Limit each IP to 20 login/register requests per hour
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: "Too many authentication attempts from this IP, please try again after an hour",
  },
});
