/**
 * Socket.IO Server Setup
 *
 * Creates and configures the Socket.IO server, wires authentication,
 * camera-room management and connection lifecycle.
 *
 * This is the composition root of the notification module — it assembles
 * the pieces (auth, rooms, dispatcher) without containing business logic.
 */

import { Server as SocketIOServer, type Namespace, type Socket } from "socket.io";
import logger from "@core/utils/logger.js";
import { container } from "@core/di.js";
import { CameraService } from "@cameras/cameraService.js";
import { UserService } from "@users/userService.js";
import { heartbeatAgent } from "@agents/agentService.js";
import { config } from "@core/config.js";
import { socketAuthMiddleware } from "./socketAuth.js";
import { agentSocketAuthMiddleware } from "./agentSocketAuth.js";
import { joinAuthorizedCameras, registerRoomHandlers } from "./cameraRoomManager.js";
import { NotificationDispatcher } from "./notificationDispatcher.js";
import type { Server as HttpServer } from "http";
import type {
  ServerToClientEvents,
  ClientToServerEvents,
  SocketData,
  AgentServerToClientEvents,
  AgentClientToServerEvents,
  AgentSocketData,
} from "./types.js";

type AppServer = SocketIOServer<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type AgentNamespace = Namespace<
  AgentClientToServerEvents,
  AgentServerToClientEvents,
  Record<string, never>,
  AgentSocketData
>;
type AgentSocket = Socket<AgentClientToServerEvents, AgentServerToClientEvents, Record<string, never>, AgentSocketData>;

let dispatcher: NotificationDispatcher | null = null;
let io: AppServer | null = null;

/**
 * Attaches Socket.IO to the HTTP server and returns the dispatcher
 * that the rest of the application uses to send notifications.
 *
 * Call this once during server startup, after `app.listen()`.
 */
export function initializeSocketServer(httpServer: HttpServer): NotificationDispatcher {
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: config.cors.origin,
      methods: [...config.cors.methods],
      credentials: config.cors.credentials,
    },
    // Only use WebSocket — skip long-polling for lower latency
    transports: ["websocket", "polling"],
    pingInterval: 25_000,
    pingTimeout: 20_000,
  });

  // ── Authentication ───────────────────────────────────────────────
  io.use(socketAuthMiddleware);

  // ── Connection lifecycle ─────────────────────────────────────────
  io.on("connection", async (socket) => {
    const { userId, username } = socket.data;
    logger.info("Socket connected", { userId, username, socketId: socket.id });

    const cameraService = container.resolve(CameraService);

    // Auto-join the user to their authorized camera rooms
    await joinAuthorizedCameras(socket, cameraService);

    // Register dynamic subscribe/unsubscribe handlers
    registerRoomHandlers(socket, cameraService);

    socket.on("disconnect", (reason) => {
      logger.info("Socket disconnected", { userId, socketId: socket.id, reason });
    });
  });

  // ── Edge Agent Namespace (/agent) ─────────────────────────────────
  const agentNamespace = io.of("/agent") as unknown as AgentNamespace;
  agentNamespace.use(agentSocketAuthMiddleware as any);

  agentNamespace.on("connection", async (socket: AgentSocket) => {
    const agent = socket.data.agent;
    logger.info("Agent socket connected", {
      agentId: agent.id,
      ownerId: agent.owner_id,
      name: agent.name,
      socketId: socket.id,
    });

    const agentRoom = `agent:${agent.id}`;
    const ownerRoom = `owner:${agent.owner_id}:agents`;
    await socket.join(agentRoom);
    await socket.join(ownerRoom);

    // Initial camera sync on connection
    try {
      const cameraService = container.resolve(CameraService);
      const userService = container.resolve(UserService);
      const owner = await userService.getUserById(agent.owner_id);
      const user = owner ? { id: owner.id, role: owner.role } : { id: agent.owner_id, role: "operator" };
      const cameras = await cameraService.listAccessibleCameras(user);
      socket.emit("cameras:sync", { cameras });
    } catch (err) {
      logger.error("Failed to emit initial cameras:sync to agent", {
        agentId: agent.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Dynamic camera sync request from agent
    socket.on("cameras:request_sync", async () => {
      try {
        const cameraService = container.resolve(CameraService);
        const userService = container.resolve(UserService);
        const owner = await userService.getUserById(agent.owner_id);
        const user = owner ? { id: owner.id, role: owner.role } : { id: agent.owner_id, role: "operator" };
        const cameras = await cameraService.listAccessibleCameras(user);
        socket.emit("cameras:sync", { cameras });
      } catch (err) {
        logger.error("Failed to process cameras:request_sync", {
          agentId: agent.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });

    // Real-time heartbeat from agent
    socket.on("agent:heartbeat", async (payload?: { name?: string; version?: string }) => {
      try {
        await heartbeatAgent(agent, payload ?? {});
        socket.emit("agent:heartbeat:ack", { received_at: new Date().toISOString() });
      } catch (err) {
        logger.error("Failed to process agent heartbeat", {
          agentId: agent.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });

    socket.on("disconnect", (reason) => {
      logger.info("Agent socket disconnected", { agentId: agent.id, socketId: socket.id, reason });
    });
  });

  dispatcher = new NotificationDispatcher(io);

  logger.info("Socket.IO server initialized");
  return dispatcher;
}

/**
 * Returns the global dispatcher.
 * Throws if called before `initializeSocketServer`.
 */
export function getNotificationDispatcher(): NotificationDispatcher {
  if (!dispatcher) {
    throw new Error("NotificationDispatcher not initialized — call initializeSocketServer() first");
  }
  return dispatcher;
}

/** Disconnects every client and stops accepting connections. */
export async function closeSocketServer(): Promise<void> {
  await io?.close();
  io = null;
  dispatcher = null;
}
