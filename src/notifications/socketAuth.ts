/**
 * Socket Authentication
 *
 * Verifies JWT tokens on Socket.IO handshake so that only
 * authenticated users can open a real-time connection.
 *
 * Single responsibility: token → user identity, nothing else.
 */

import jwt from "jsonwebtoken";
import { config } from "@core/config.js";
import logger from "@core/utils/logger.js";
import type { Socket } from "socket.io";
import type { ServerToClientEvents, ClientToServerEvents, SocketData } from "./types.js";

type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

/**
 * Socket.IO middleware that authenticates the handshake.
 *
 * The client must send the JWT as `auth.token`:
 * ```ts
 * io("http://…", { auth: { token: "Bearer <jwt>" } })
 * ```
 */
export function socketAuthMiddleware(socket: AppSocket, next: (err?: Error) => void): void {
  try {
    const raw = socket.handshake.auth?.token as string | undefined;

    if (!raw) {
      return next(new Error("Authentication token required"));
    }

    // Accept both "Bearer <token>" and a bare token
    const token = raw.startsWith("Bearer ") ? raw.slice(7) : raw;

    const decoded = jwt.verify(token, config.auth.jwtSecret!) as {
      id: string;
      username: string;
      role: string;
    };

    // Attach identity to the socket — available in every handler
    socket.data.userId = decoded.id;
    socket.data.username = decoded.username;
    socket.data.role = decoded.role;

    next();
  } catch (error) {
    logger.warn("Socket auth failed", {
      reason: error instanceof Error ? error.message : "unknown",
      address: socket.handshake.address,
    });
    next(new Error("Invalid or expired token"));
  }
}
