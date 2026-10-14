import { Redis } from "ioredis";
import { config } from "@core/config.js";
import { ICacheService } from "./cache.interface.js";

const redis = config.cache?.driver === "redis" && config.cache?.redisUrl ? new Redis(config.cache.redisUrl) : null;

export const redisCache: ICacheService = {
  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    if (!redis) throw new Error("Redis is not initialized");
    await redis.set(key, value, "EX", ttlSeconds);
  },

  async get(key: string): Promise<string | null> {
    if (!redis) throw new Error("Redis is not initialized");
    return await redis.get(key);
  },

  async delete(key: string): Promise<void> {
    if (!redis) throw new Error("Redis is not initialized");
    await redis.del(key);
  },
};
