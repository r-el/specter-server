/**
 * Notification Dispatcher
 *
 * The single point through which every notification is sent.
 * Consumers (event handlers, API endpoints, background jobs) call
 * `dispatcher.toCamera(...)` or `dispatcher.broadcast(...)` and
 * never touch Socket.IO directly.
 *
 * Single responsibility: routing a Notification to the right audience.
 */

import logger from "@core/utils/logger.js";
import { cameraRoom, roleRoom } from "./cameraRoomManager.js";
import type { Server } from "socket.io";
import type { Notification, ServerToClientEvents, ClientToServerEvents, SocketData } from "./types.js";

type AppServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

export class NotificationDispatcher {
  constructor(private readonly io: AppServer) {}

  /**
   * Sends a notification to every user currently subscribed to a camera.
   * This is the primary entry point for camera-scoped alerts.
   */
  toCamera(cameraId: string, notification: Notification): void {
    const room = cameraRoom(cameraId);
    this.io.to(room).emit("notification", notification);

    logger.debug("Notification dispatched to camera room", {
      room,
      kind: notification.kind,
    });
  }

  /**
   * Sends a notification to every connected user (system-wide alerts).
   */
  broadcast(notification: Notification): void {
    this.io.emit("notification", notification);

    logger.debug("Notification broadcast", { kind: notification.kind });
  }

  /** Sends a notification to every connected user with one of the roles. */
  toRoles(roles: string[], notification: Notification): void {
    this.io.to(roles.map(roleRoom)).emit("notification", notification);
  }

  /** Sends one notification to a camera's room and to roles, once per user in both. */
  toCameraAndRoles(cameraId: string, roles: string[], notification: Notification): void {
    this.io.to([cameraRoom(cameraId), ...roles.map(roleRoom)]).emit("notification", notification);
  }

  /** Adds every connected user with the role to a camera's room, such as admins to a new camera. */
  joinCameraByRole(role: string, cameraId: string): void {
    this.io.in(roleRoom(role)).socketsJoin(cameraRoom(cameraId));
  }

  /** Empties a camera's room, after the camera was deleted. */
  closeCamera(cameraId: string): void {
    this.io.socketsLeave(cameraRoom(cameraId));
  }

  /**
   * Sends a notification to a single user across all their connections.
   * Useful for user-specific messages that are not camera-scoped.
   */
  async toUser(userId: string, notification: Notification): Promise<void> {
    const sockets = await this.io.fetchSockets();
    const userSockets = sockets.filter((s) => s.data.userId === userId);

    for (const socket of userSockets) {
      socket.emit("notification", notification);
    }

    logger.debug("Notification sent to user", {
      userId,
      socketCount: userSockets.length,
      kind: notification.kind,
    });
  }

  /**
   * Sends an event to every connected agent in the /agent namespace.
   */
  toAgents(event: string, data: unknown): void {
    this.io.of("/agent").emit(event as any, data);
    logger.debug("Event dispatched to all agents", { event });
  }

  /**
   * Sends an event to all agents belonging to a specific owner.
   */
  toOwnerAgents(ownerId: string, event: string, data: unknown): void {
    const room = `owner:${ownerId}:agents`;
    this.io
      .of("/agent")
      .to(room)
      .emit(event as any, data);
    logger.debug("Event dispatched to owner agents room", { room, event });
  }

  /**
   * Sends an event to a single specific agent.
   */
  toAgent(agentId: string, event: string, data: unknown): void {
    const room = `agent:${agentId}`;
    this.io
      .of("/agent")
      .to(room)
      .emit(event as any, data);
    logger.debug("Event dispatched to agent room", { room, event });
  }

  /** How many clients are currently connected. */
  get connectedCount(): number {
    return this.io.engine.clientsCount;
  }
}
