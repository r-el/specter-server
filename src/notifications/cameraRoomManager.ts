/**
 * Camera Room Manager
 *
 * Manages the mapping between Socket.IO sockets and camera "rooms".
 * A user who is assigned to camera X joins the Socket.IO room `camera:<X>`.
 * When a notification arrives for camera X, it is broadcast to that room,
 * so only the relevant users receive it.
 *
 * Single responsibility: room joins/leaves + authorization checks.
 */

import logger from "@core/utils/logger.js";
import type { CameraService } from "@cameras/cameraService.js";
import type { Server, Socket } from "socket.io";
import type { ServerToClientEvents, ClientToServerEvents, SocketData } from "./types.js";

type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

type AppServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

/** Builds the Socket.IO room name for a camera. */
export function cameraRoom(cameraId: string): string {
  return `camera:${cameraId}`;
}

/** Builds the Socket.IO room name for every user with a role. */
export function roleRoom(role: string): string {
  return `role:${role}`;
}

/** Builds the Socket.IO room name for an individual user. */
export function userRoom(userId: string): string {
  return `user:${userId}`;
}

/** Adds every connected socket for a user to a camera's room. */
export function joinUserToCameraRoom(io: AppServer, userId: string, cameraId: string): void {
  io.in(userRoom(userId)).socketsJoin(cameraRoom(cameraId));
}

/** Removes non-admin sockets for a user from a camera's room. */
export async function leaveUserFromCameraRoom(io: AppServer, userId: string, cameraId: string): Promise<void> {
  const sockets = await io.in(userRoom(userId)).fetchSockets();
  for (const socket of sockets) {
    if (socket.data.role !== "admin") {
      socket.leave(cameraRoom(cameraId));
    }
  }
}

/**
 * Subscribes a newly connected socket to every camera the user is allowed
 * to access, and registers handlers for dynamic subscribe/unsubscribe.
 */
export async function joinAuthorizedCameras(socket: AppSocket, cameraService: CameraService): Promise<void> {
  const { userId, role } = socket.data;

  try {
    await socket.join(roleRoom(role));
    await socket.join(userRoom(userId));
    const cameras = await cameraService.listAccessibleCameras({ id: userId, role });
    const cameraIds = cameras.map((camera) => camera.id);

    for (const id of cameraIds) {
      await socket.join(cameraRoom(id));
    }

    socket.emit("camera:subscribed", cameraIds);

    logger.info("User joined camera rooms", {
      userId,
      cameraCount: cameraIds.length,
    });
  } catch (error) {
    logger.error("Failed to join camera rooms", {
      userId,
      error: error instanceof Error ? error.message : "unknown",
    });
    socket.emit("error", { message: "Failed to load your camera subscriptions" });
  }
}

/**
 * Registers Socket.IO event handlers for dynamic room management.
 * Allows the client to subscribe/unsubscribe from cameras at runtime
 * (e.g. when the dashboard view changes).
 */
export function registerRoomHandlers(socket: AppSocket, cameraService: CameraService): void {
  socket.on("subscribe:cameras", async (requestedIds: string[]) => {
    const { userId, role } = socket.data;

    try {
      // Authorization: only join rooms the user is allowed to access
      const cameras = await cameraService.listAccessibleCameras({ id: userId, role });
      const allowedIds = new Set(cameras.map((camera) => camera.id));

      const authorized = requestedIds.filter((id) => allowedIds.has(id));

      for (const id of authorized) {
        await socket.join(cameraRoom(id));
      }

      socket.emit("camera:subscribed", authorized);
    } catch (error) {
      logger.error("Dynamic subscribe failed", { userId });
      socket.emit("error", { message: "Failed to subscribe to cameras" });
    }
  });

  socket.on("unsubscribe:cameras", async (cameraIds: string[]) => {
    for (const id of cameraIds) {
      await socket.leave(cameraRoom(id));
    }
  });
}
