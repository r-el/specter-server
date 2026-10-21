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
import { container } from "tsyringe";
import logger from "@core/utils/logger.js";
import { CameraService } from "@cameras/cameraService.js";
import { AgentCameraStore } from "@cameras/infrastructure/agentCameraStore.js";
import { AgentAlertStore } from "@alerts/infrastructure/agentAlertStore.js";
import { AgentWatchlistStore } from "@watchlists/infrastructure/agentWatchlistStore.js";
import type { SpecterAlert, SpecterWatchlist, SpecterTarget } from "@specter/specterTypes.js";
import { SPECTER_HTTP_CLIENT } from "@specter/tokens.js";
import type { SpecterHttpClient } from "@specter/specterHttpClient.js";
import type { ICamera, CameraLiveStatus } from "~types/interfaces.js";
import { UserService } from "@users/userService.js";
import { heartbeatAgent } from "@agents/agentService.js";
import { config } from "@core/config.js";
import { socketAuthMiddleware } from "./socketAuth.js";
import { agentSocketAuthMiddleware } from "./agentSocketAuth.js";
import { joinAuthorizedCameras, registerRoomHandlers } from "./cameraRoomManager.js";
import { NotificationDispatcher } from "./notificationDispatcher.js";
import { setupRedisAdapter } from "./redisAdapter.js";
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

const pendingTargetImageRequests = new Map<
  string,
  (res: { buffer?: Buffer; contentType?: string; error?: string }) => void
>();

const pendingAlertSnapshotRequests = new Map<
  string,
  (res: { buffer?: Buffer; contentType?: string; error?: string }) => void
>();

export async function requestTargetImageFromAgent(
  watchlistId: string,
  targetId: string,
  imageId: string,
  timeoutMs: number = 8000,
): Promise<{ buffer: Buffer; contentType: string } | null> {
  if (!dispatcher) return null;
  const requestId = `img_req_${Math.random().toString(16).slice(2)}_${Date.now()}`;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingTargetImageRequests.delete(requestId);
      resolve(null);
    }, timeoutMs);

    pendingTargetImageRequests.set(requestId, (res) => {
      clearTimeout(timer);
      if (res.buffer && res.contentType) {
        resolve({ buffer: res.buffer, contentType: res.contentType });
      } else {
        resolve(null);
      }
    });

    try {
      dispatcher.toAgents("agent:target_image:request", {
        request_id: requestId,
        watchlist_id: watchlistId,
        target_id: targetId,
        image_id: imageId,
      });
    } catch {
      clearTimeout(timer);
      pendingTargetImageRequests.delete(requestId);
      resolve(null);
    }
  });
}

export async function requestAlertSnapshotFromAgent(
  alertId: string,
  timeoutMs: number = 8000,
): Promise<{ buffer: Buffer; contentType: string } | null> {
  if (!dispatcher) return null;
  const requestId = `snap_req_${Math.random().toString(16).slice(2)}_${Date.now()}`;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingAlertSnapshotRequests.delete(requestId);
      resolve(null);
    }, timeoutMs);

    pendingAlertSnapshotRequests.set(requestId, (res) => {
      clearTimeout(timer);
      if (res.buffer && res.contentType) {
        resolve({ buffer: res.buffer, contentType: res.contentType });
      } else {
        resolve(null);
      }
    });

    try {
      dispatcher.toAgents("agent:alert_snapshot:request", {
        request_id: requestId,
        alert_id: alertId,
      });
    } catch {
      clearTimeout(timer);
      pendingAlertSnapshotRequests.delete(requestId);
      resolve(null);
    }
  });
}

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

  setupRedisAdapter(io);

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
        const agentCameraStore = container.resolve(AgentCameraStore);
        const targetAgentId = agentCameraStore.getAgentIdForCamera(payload.cameraId);
        const ownerId =
          camera.created_by || (targetAgentId ? agentCameraStore.getOwnerForAgent(targetAgentId) : null) || "default";
        const target = targetAgentId
          ? agentNamespace.to(`agent:${targetAgentId}`)
          : agentNamespace.to(`owner:${ownerId}:agents`);

        target.emit("webrtc:offer", {
          cameraId: payload.cameraId,
          sdp: payload.sdp,
          correlationId: payload.correlationId,
          clientSocketId: socket.id,
        });
        logger.info("Relayed webrtc:offer to agent", {
          cameraId: payload.cameraId,
          targetAgentId,
          ownerId,
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
          const agentCameraStore = container.resolve(AgentCameraStore);
          const targetAgentId = agentCameraStore.getAgentIdForCamera(payload.cameraId);
          const ownerId =
            camera.created_by || (targetAgentId ? agentCameraStore.getOwnerForAgent(targetAgentId) : null) || "default";
          const target = targetAgentId
            ? agentNamespace.to(`agent:${targetAgentId}`)
            : agentNamespace.to(`owner:${ownerId}:agents`);

          target.emit("webrtc:ice_candidate", {
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
        agentCameraStore.setCameras(agent.id, agent.owner_id, cameras);
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

    // Edge agent watchlist and target sync (Edge pushes local watchlists to cloud)
    socket.on("agent:watchlists:sync", (payload: { watchlists: unknown[]; targets?: unknown[] }) => {
      try {
        const agentWatchlistStore = container.resolve(AgentWatchlistStore);
        const watchlists = (payload?.watchlists ?? []) as SpecterWatchlist[];
        const targets = (payload?.targets ?? []) as SpecterTarget[];
        agentWatchlistStore.setWatchlists(agent.id, agent.owner_id, watchlists, targets);
        logger.info("Synced watchlists from edge agent", {
          agentId: agent.id,
          ownerId: agent.owner_id,
          count: watchlists.length,
          targetCount: targets.length,
        });

        dispatcher?.broadcast({
          kind: "configuration_changed",
          entityKind: "watchlist",
          entityId: "",
          changeKind: "updated",
          level: "info",
          timestamp: new Date().toISOString(),
        });
      } catch (err) {
        logger.error("Failed to process agent:watchlists:sync", {
          agentId: agent.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });

    // Edge agent alerts initial backfill sync
    socket.on("agent:alerts:sync", (payload: { alerts: unknown[] }) => {
      try {
        const agentAlertStore = container.resolve(AgentAlertStore);
        const alerts = (payload?.alerts ?? []) as Array<Record<string, any>>;
        for (const raw of alerts) {
          const inner = (raw.payload as Record<string, any>) ?? raw;
          const alertId = (raw.alert_id || inner.id || inner.message_id || `alert_${Date.now()}`) as string;
          const cameraId = (inner.camera_id || raw.camera_id || "") as string;
          const isMatch = raw.kind === "match_confirmed" || !!inner.target_id;
          const alertRecord: SpecterAlert = {
            id: alertId,
            kind: isMatch ? "identity_match" : "rule",
            owner_id: agent.owner_id || inner.owner_id || "facealert",
            camera_id: cameraId,
            track_id: inner.track_id ?? 0,
            object_class: inner.object_class ?? "person",
            bounding_box: inner.bounding_box ?? { x: 0, y: 0, width: 0, height: 0 },
            frame_captured_at: inner.frame_captured_at ?? new Date().toISOString(),
            created_at: raw.created_at ?? inner.created_at ?? inner.occurred_at ?? new Date().toISOString(),
            has_snapshot: Boolean(raw.snapshot_base64 || inner.has_snapshot),
            review: {
              disposition: (inner.review?.disposition as any) ?? "unreviewed",
              is_acknowledged: Boolean(inner.review?.is_acknowledged),
              note: inner.review?.note ?? null,
            },
            watchlist_id: inner.watchlist_id ?? null,
            target_id: inner.target_id ?? null,
            modality: inner.modality ?? null,
            similarity_ratio: inner.similarity_ratio ?? null,
            margin_ratio: inner.margin_ratio ?? null,
            rule_id: inner.rule_id ?? null,
            rule_kind: inner.rule_kind ?? null,
            zone_id: inner.zone_id ?? null,
            dwell_seconds: inner.dwell_seconds ?? null,
            crossing_direction: inner.crossing_direction ?? null,
          };
          agentAlertStore.addAlert(alertRecord, raw.snapshot_base64);
          if (raw.snapshot_base64) {
            try {
              const buf = Buffer.from(raw.snapshot_base64, "base64");
              if (inner.id && inner.id !== alertId) {
                agentAlertStore.saveSnapshot(inner.id, "image/jpeg", buf);
              }
              if (inner.message_id && inner.message_id !== alertId) {
                agentAlertStore.saveSnapshot(inner.message_id, "image/jpeg", buf);
              }
            } catch (err) {
              logger.warn("Failed to index snapshot alias for alert", { alertId, err });
            }
          }
        }
        logger.info("Synced alerts backfill from edge agent", {
          agentId: agent.id,
          count: alerts.length,
        });
      } catch (err) {
        logger.error("Failed to process agent:alerts:sync", {
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
      try {
        const raw = (payload as Record<string, any>) ?? {};
        const inner = (raw.payload as Record<string, any>) ?? raw;
        const alertId = (raw.alert_id || inner.message_id || `alert_${Date.now()}`) as string;
        const cameraId = (inner.camera_id || raw.camera_id || "") as string;

        logger.info("Received alert from edge agent", {
          agentId: agent.id,
          alertId,
          cameraId,
        });

        const isMatch = raw.kind === "match_confirmed" || !!inner.target_id;
        const alertRecord: SpecterAlert = {
          id: alertId,
          kind: isMatch ? "identity_match" : "rule",
          owner_id: agent.owner_id || inner.owner_id || "facealert",
          camera_id: cameraId,
          track_id: inner.track_id ?? 0,
          object_class: inner.object_class ?? "person",
          bounding_box: inner.bounding_box ?? { x: 0, y: 0, width: 0, height: 0 },
          frame_captured_at: inner.frame_captured_at ?? new Date().toISOString(),
          created_at: raw.created_at ?? inner.occurred_at ?? new Date().toISOString(),
          has_snapshot: !!raw.snapshot_base64,
          review: {
            disposition: "unreviewed",
            is_acknowledged: false,
            note: null,
          },
          watchlist_id: inner.watchlist_id ?? null,
          target_id: inner.target_id ?? null,
          modality: inner.modality ?? null,
          similarity_ratio: inner.similarity_ratio ?? null,
          margin_ratio: inner.margin_ratio ?? null,
          rule_id: inner.rule_id ?? null,
          rule_kind: inner.rule_kind ?? null,
          zone_id: inner.zone_id ?? null,
          dwell_seconds: inner.dwell_seconds ?? null,
          crossing_direction: inner.crossing_direction ?? null,
        };

        const agentAlertStore = container.resolve(AgentAlertStore);
        agentAlertStore.addAlert(alertRecord, raw.snapshot_base64);

        if (dispatcher) {
          const notif = {
            kind: "alert" as const,
            alertId,
            alertKind: (isMatch ? "identity_match" : "rule") as "identity_match" | "rule",
            cameraId,
            cameraName: inner.camera_name ?? raw.camera_name ?? null,
            targetId: inner.target_id ?? raw.target_id ?? null,
            targetLabel: inner.target_label ?? raw.target_label ?? null,
            watchlistName: inner.watchlist_name ?? raw.watchlist_name ?? null,
            watchlistKind: inner.watchlist_kind ?? raw.watchlist_kind ?? null,
            similarity: inner.similarity_ratio ?? raw.similarity ?? null,
            ruleKind: inner.rule_kind ?? raw.rule_kind ?? null,
            objectClass: inner.object_class ?? raw.object_class ?? "person",
            level: (raw.severity ?? "warning") as "critical" | "warning" | "info",
            snapshotUrl: `/api/alerts/${alertId}/snapshot`,
            timestamp: alertRecord.created_at,
          };
          if (cameraId) {
            dispatcher.toCamera(cameraId, notif);
          }
          dispatcher.broadcast(notif);
        }
      } catch (err) {
        logger.error("Failed to process agent:alert", {
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

    // WebRTC error relay from edge agent back to browser client
    socket.on(
      "webrtc:error",
      (payload: {
        cameraId: string;
        correlationId: string;
        clientSocketId: string;
        error: string;
        retryable?: boolean;
      }) => {
        io.to(payload.clientSocketId).emit("webrtc:error", {
          cameraId: payload.cameraId,
          correlationId: payload.correlationId,
          error: payload.error,
          retryable: payload.retryable ?? false,
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

    // On-demand target reference image response from edge agent
    socket.on("agent:target_image:response", (payload) => {
      const handler = pendingTargetImageRequests.get(payload.request_id);
      if (handler) {
        pendingTargetImageRequests.delete(payload.request_id);
        if (payload.image_base64) {
          handler({
            buffer: Buffer.from(payload.image_base64, "base64"),
            contentType: payload.content_type || "image/jpeg",
          });
        } else {
          handler({ error: payload.error || "Not found" });
        }
      }
    });

    // On-demand alert snapshot response from edge agent
    socket.on("agent:alert_snapshot:response", (payload) => {
      const handler = pendingAlertSnapshotRequests.get(payload.request_id);
      if (handler) {
        pendingAlertSnapshotRequests.delete(payload.request_id);
        if (payload.snapshot_base64) {
          handler({
            buffer: Buffer.from(payload.snapshot_base64, "base64"),
            contentType: payload.content_type || "image/jpeg",
          });
        } else {
          handler({ error: payload.error || "Not found" });
        }
      }
    });

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
        // TODO: listWatchlists() is scoped to the SpecterHttpClient's configured ownerId,
        // not the connecting agent's owner_id. In a multi-tenant deployment this may return
        // watchlists belonging to a different owner. Needs owner-scoped filtering.
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
      const agentCameraStore = container.resolve(AgentCameraStore);
      agentCameraStore.markAgentCamerasOffline(agent.id);
    });

    // ── Async joins and initial queries ──
    const agentRoom = `agent:${agent.id}`;
    const ownerRoom = `owner:${agent.owner_id}:agents`;
    await socket.join(agentRoom);
    await socket.join(ownerRoom);
    await socket.join("agents");

    // Request camera catalog from agent immediately upon connection
    socket.emit("agent:cameras:request_sync");

    // Check if cloud has local Specter or should request watchlists and alerts from agent
    const specterClient = container.resolve<SpecterHttpClient>(SPECTER_HTTP_CLIENT);
    const isSpecterHealthy = await specterClient.isHealthy().catch(() => false);

    if (isSpecterHealthy) {
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
    } else {
      // In cloud mode: request agent to push its watchlists and recent alerts to the cloud
      socket.emit("agent:watchlists:request_sync");
      socket.emit("agent:alerts:request_sync");
    }
  });

  dispatcher = new NotificationDispatcher(io);
  container.registerInstance(NotificationDispatcher, dispatcher);

  logger.info("Socket.IO server initialized");
  return dispatcher;
}

/**
 * Returns the global dispatcher, or null if not yet initialized.
 */
export function getNotificationDispatcherSafe(): NotificationDispatcher | null {
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
