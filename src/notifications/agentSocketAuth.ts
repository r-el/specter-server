/**
 * Agent Socket Authentication
 *
 * Verifies Agent bearer tokens on Socket.IO handshake for the /agent namespace.
 * Authenticated agent identity is attached to socket.data.agent.
 */

import logger from "@core/utils/logger.js";
import { authenticateAgent } from "@agents/agentService.js";
import type { Socket } from "socket.io";
import type { AgentClientToServerEvents, AgentServerToClientEvents, AgentSocketData } from "./types.js";

type AgentSocket = Socket<AgentClientToServerEvents, AgentServerToClientEvents, Record<string, never>, AgentSocketData>;

/**
 * Socket.IO middleware that authenticates the handshake for edge agents.
 * Accepts the token in auth.token or Authorization header.
 */
export async function agentSocketAuthMiddleware(socket: AgentSocket, next: (err?: Error) => void): Promise<void> {
  try {
    const raw =
      (socket.handshake.auth?.token as string | undefined) ??
      (socket.handshake.headers.authorization as string | undefined);

    if (!raw) {
      return next(new Error("Agent authentication token required"));
    }

    const token = raw.startsWith("Bearer ") ? raw.slice(7).trim() : raw.trim();
    if (!token) {
      return next(new Error("Agent authentication token required"));
    }

    const agent = await authenticateAgent(token);
    socket.data.agent = agent;
    next();
  } catch (error) {
    logger.warn("Agent socket auth failed", {
      reason: error instanceof Error ? error.message : "unknown",
      address: socket.handshake.address,
    });
    next(new Error("Invalid or revoked agent token"));
  }
}
