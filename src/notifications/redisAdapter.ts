import { Server as SocketIOServer } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { Redis } from "ioredis";
import { config } from "@core/config.js";
import logger from "@core/utils/logger.js";

/**
 * Attaches the Redis adapter to the Socket.IO server if Redis is configured.
 * This allows horizontal scaling of WebSocket connections across multiple server instances.
 */
export function setupRedisAdapter(io: SocketIOServer) {
  if (config.cache?.driver === "redis" && config.cache?.redisUrl) {
    const pubClient = new Redis(config.cache.redisUrl);
    const subClient = pubClient.duplicate();

    io.adapter(createAdapter(pubClient, subClient));
    logger.info("Socket.IO Redis adapter enabled");
  } else {
    logger.debug("Socket.IO Redis adapter skipped (Redis not configured)");
  }
}
