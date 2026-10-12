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
import { AgentCameraStore } from "@cameras/infrastructure/agentCameraStore.js";
import type { ICamera, CameraLiveStatus } from "~types/interfaces.js";
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

    // WebRTC signaling relay between browser and edge agent
    socket.on("webrtc:offer", async (payload: { cameraId: string; sdp: string; correlationId: string }) => {
      try {
        const camera = await cameraService.getAccessibleCamera(payload.cameraId, {
          id: socket.data.userId,
          role: socket.data.role,
        });
        const ownerId = camera.created_by ?? "default";
        const ownerRoom = `owner:${ownerId}:agents`;
        agentNamespace.to(ownerRoom).to("agents").emit("webrtc:offer", {
          cameraId: payload.cameraId,
          sdp: payload.sdp,
          correlationId: payload.correlationId,
          clientSocketId: socket.id,
        });
      } catch (err) {
        logger.error("Failed to relay webrtc:offer to agent", {
          cameraId: payload?.cameraId,
          error: err instanceof Error ? err.message : String(err),
        });
        socket.emit("error", { message: "Failed to reach edge agent for WebRTC stream" });
      }
    });

    socket.on(
      "webrtc:ice_candidate",
      async (payload: { cameraId: string; candidate: unknown; correlationId: string }) => {
        try {
          const camera = await cameraService.getAccessibleCamera(payload.cameraId, {
            id: socket.data.userId,
            role: socket.data.role,
          });
          const ownerId = camera.created_by ?? "default";
          const ownerRoom = `owner:${ownerId}:agents`;
          agentNamespace.to(ownerRoom).to("agents").emit("webrtc:ice_candidate", {
            cameraId: payload.cameraId,
            candidate: payload.candidate,
            correlationId: payload.correlationId,
            clientSocketId: socket.id,
          });
        } catch (err) {
          logger.error("Failed to relay webrtc:ice_candidate to agent", {
            cameraId: payload?.cameraId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    );

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

    // ── Register all event listeners SYNCHRONOUSLY to prevent dropping early events ──

    // Edge agent camera sync (Edge pushes local camera catalog to cloud)
    socket.on("agent:cameras:sync", (payload: { cameras: unknown[] }) => {
      try {
        const agentCameraStore = container.resolve(AgentCameraStore);
        const cameras = (payload?.cameras ?? []) as ICamera[];
        agentCameraStore.setCameras(agent.owner_id, cameras);
        logger.info("Synced cameras from edge agent", {
          agentId: agent.id,
          ownerId: agent.owner_id,
          count: cameras.length,
        });

        // Broadcast configuration_changed to connected dashboard users so UI refreshes
        dispatcher?.broadcast({
          kind: "configuration_changed",
          entityKind: "camera",
          entityId: "",
          changeKind: "updated",
          level: "info",
          timestamp: new Date().toISOString(),
        });
      } catch (err) {
        logger.error("Failed to process agent:cameras:sync", {
          agentId: agent.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });

    // Edge agent camera live status updates
    socket.on(
      "agent:camera:status_changed",
      (payload: {
        cameraId: string;
        cameraName?: string | null;
        status: "starting" | "running" | "reconnecting" | "stopped" | "failed";
        level?: "info" | "warning" | "critical";
        timestamp?: string;
      }) => {
        try {
          const agentCameraStore = container.resolve(AgentCameraStore);
          agentCameraStore.updateCameraStatus(payload.cameraId, payload.status as CameraLiveStatus);

          const statusNotification = {
            kind: "camera_status" as const,
            cameraId: payload.cameraId,
            cameraName: payload.cameraName ?? null,
            status: payload.status,
            level: payload.level ?? "info",
            timestamp: payload.timestamp ?? new Date().toISOString(),
          };

          dispatcher?.toCamera(payload.cameraId, statusNotification);
          dispatcher?.broadcast(statusNotification);
        } catch (err) {
          logger.error("Failed to process agent:camera:status_changed", {
            agentId: agent.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    );

    // Edge agent alert reception (store & forward ingestion)
    socket.on("agent:alert", (payload: unknown) => {
      const raw = payload as Record<string, any>;
      logger.info("Received alert from edge agent", {
        agentId: agent.id,
        alertId: raw?.alert_id,
      });

      if (raw && raw.alert_id && dispatcher) {
        const notif = {
          kind: "alert" as const,
          alertId: raw.alert_id,
          alertKind: (raw.target_id ? "identity_match" : "rule") as "identity_match" | "rule",
          cameraId: raw.camera_id,
          cameraName: raw.camera_name ?? null,
          targetId: raw.target_id ?? null,
          targetLabel: raw.target_label ?? null,
          watchlistName: raw.watchlist_name ?? null,
          watchlistKind: raw.watchlist_kind ?? null,
          similarity: raw.similarity ?? null,
          ruleKind: raw.rule_kind ?? null,
          objectClass: raw.object_class ?? "person",
          level: (raw.severity ?? "warning") as "critical" | "warning" | "info",
          snapshotUrl: raw.snapshot_url ?? null,
          timestamp: raw.created_at ?? new Date().toISOString(),
        };
        dispatcher.toCamera(raw.camera_id, notif);
        dispatcher.broadcast(notif);
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

    // WebRTC answer relay from edge agent back to browser client
    socket.on(
      "webrtc:answer",
      (payload: { cameraId: string; sdp: string; correlationId: string; clientSocketId: string }) => {
        io.to(payload.clientSocketId).emit("webrtc:answer", {
          cameraId: payload.cameraId,
          sdp: payload.sdp,
          correlationId: payload.correlationId,
        });
      },
    );

    // WebRTC ICE candidate from agent back to browser client
    socket.on(
      "webrtc:ice_candidate",
      (payload: { cameraId: string; candidate: unknown; correlationId: string; clientSocketId: string }) => {
        io.to(payload.clientSocketId).emit("webrtc:ice_candidate", {
          cameraId: payload.cameraId,
          candidate: payload.candidate,
          correlationId: payload.correlationId,
        });
      },
    );

    // Dynamic camera sync request from agent
    socket.on("cameras:request_sync", async () => {
      try {
        const cameraService = container.resolve(CameraService);
        const userService = container.resolve(UserService);
        const owner = await userService.getUserById(agent.owner_id);
        const user = owner ? { id: owner.id, role: owner.role } : { id: agent.owner_id, role: "operator" };
        const cameras = await cameraService.listAccessibleCameras(user);
        if (cameras.length > 0) {
          socket.emit("cameras:sync", { cameras });
        }
      } catch (err) {
        logger.error("Failed to process cameras:request_sync", {
          agentId: agent.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });

    // Dynamic watchlist sync request from agent
    socket.on("watchlists:request_sync", async () => {
      try {
        const { WatchlistService } = await import("@watchlists/watchlistService.js");
        const watchlistService = container.resolve(WatchlistService);
        const watchlists = await watchlistService.listWatchlists();
        socket.emit("watchlists:sync", { watchlists });
      } catch (err) {
        logger.error("Failed to process watchlists:request_sync", {
          agentId: agent.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });

    socket.on("disconnect", (reason) => {
      logger.info("Agent socket disconnected", { agentId: agent.id, socketId: socket.id, reason });
    });

    // ── Async joins and initial queries ──
    const agentRoom = `agent:${agent.id}`;
    const ownerRoom = `owner:${agent.owner_id}:agents`;
    await socket.join(agentRoom);
    await socket.join(ownerRoom);
    await socket.join("agents");

    // Initial watchlist sync on connection
    try {
      const { WatchlistService } = await import("@watchlists/watchlistService.js");
      const watchlistService = container.resolve(WatchlistService);
      const watchlists = await watchlistService.listWatchlists();
      socket.emit("watchlists:sync", { watchlists });
    } catch (err) {
      logger.error("Failed to emit initial watchlists:sync to agent", {
        agentId: agent.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
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
