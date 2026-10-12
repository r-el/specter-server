import { inject, injectable } from "tsyringe";
import { CameraRepository } from "@cameras/domain/cameraRepository.js";
import { SPECTER_HTTP_CLIENT } from "@specter/tokens.js";
import { SpecterHttpClient } from "@specter/specterHttpClient.js";
import { SpecterCameraRepository } from "@cameras/infrastructure/specterCameraRepository.js";
import { AgentCameraStore } from "@cameras/infrastructure/agentCameraStore.js";
import { ICamera, ICameraChanges, ICameraCreate } from "~types/interfaces.js";
import { ApiError } from "@core/middlewares/errorHandler.js";
import logger from "@core/utils/logger.js";

async function getDispatcherSafe() {
  try {
    const { getNotificationDispatcher } = await import("@notifications/socketServer.js");
    return getNotificationDispatcher();
  } catch {
    return null;
  }
}

/**
 * Hybrid camera repository that uses Specter directly when reachable (e.g. local Docker),
 * and transparently falls back to the AgentCameraStore and Edge Agent socket relay in cloud mode.
 */
@injectable()
export class HybridCameraRepository implements CameraRepository {
  private readonly specterRepo: SpecterCameraRepository;

  constructor(
    @inject(AgentCameraStore) private readonly agentStore: AgentCameraStore,
    @inject(SPECTER_HTTP_CLIENT) private readonly specterClient: SpecterHttpClient,
  ) {
    this.specterRepo = new SpecterCameraRepository(specterClient);
  }

  async findAll(): Promise<ICamera[]> {
    try {
      if (await this.specterClient.isHealthy()) {
        return await this.specterRepo.findAll();
      }
    } catch (err) {
      logger.debug("Local Specter unavailable, reading from AgentCameraStore", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return this.agentStore.getCameras();
  }

  async findById(cameraId: string): Promise<ICamera | null> {
    try {
      if (await this.specterClient.isHealthy()) {
        return await this.specterRepo.findById(cameraId);
      }
    } catch (err) {
      logger.debug("Local Specter unavailable, checking AgentCameraStore", { cameraId });
    }
    return this.agentStore.getCamera(cameraId);
  }

  async start(cameraId: string): Promise<ICamera> {
    try {
      if (await this.specterClient.isHealthy()) {
        return await this.specterRepo.start(cameraId);
      }
    } catch (err) {
      logger.debug("Local Specter unavailable for start, relaying to agent", { cameraId });
    }

    const camera = this.agentStore.getCamera(cameraId);
    if (!camera) {
      throw new ApiError(404, `Camera ${cameraId} not found`);
    }

    this.agentStore.updateCameraStatus(cameraId, "starting");
    try {
      const dispatcher = await getDispatcherSafe();
      dispatcher?.toAgents("agent:camera:start", { cameraId });
      dispatcher?.broadcast({
        kind: "camera_status",
        cameraId,
        cameraName: camera.name,
        status: "starting",
        level: "info",
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      logger.warn("Failed to notify agent or broadcast camera start", { error: err });
    }

    return { ...camera, live_status: "starting", desired_state: "running" };
  }

  async stop(cameraId: string): Promise<ICamera> {
    try {
      if (await this.specterClient.isHealthy()) {
        return await this.specterRepo.stop(cameraId);
      }
    } catch (err) {
      logger.debug("Local Specter unavailable for stop, relaying to agent", { cameraId });
    }

    const camera = this.agentStore.getCamera(cameraId);
    if (!camera) {
      throw new ApiError(404, `Camera ${cameraId} not found`);
    }

    this.agentStore.updateCameraStatus(cameraId, "stopped");
    try {
      const dispatcher = await getDispatcherSafe();
      dispatcher?.toAgents("agent:camera:stop", { cameraId });
      dispatcher?.broadcast({
        kind: "camera_status",
        cameraId,
        cameraName: camera.name,
        status: "stopped",
        level: "info",
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      logger.warn("Failed to notify agent or broadcast camera stop", { error: err });
    }

    return { ...camera, live_status: "stopped", desired_state: "stopped" };
  }

  async create(camera: ICameraCreate): Promise<ICamera> {
    try {
      if (await this.specterClient.isHealthy()) {
        return await this.specterRepo.create(camera);
      }
    } catch (err) {
      logger.debug("Local Specter unavailable for create, saving to AgentCameraStore", { name: camera.name });
    }

    const id = `camera_${Math.random().toString(16).slice(2, 10)}${Date.now().toString(16)}`;
    const newCamera: ICamera = {
      id,
      name: camera.name,
      source_url: camera.source_url,
      username: camera.credentials?.username ?? null,
      has_password: Boolean(camera.credentials?.password),
      location: camera.location ?? null,
      created_by: camera.created_by,
      watchlist_ids: camera.watchlist_ids,
      detection_classes: camera.detection_classes,
      is_enabled: true,
      desired_state: "stopped",
      live_status: null,
    };
    this.agentStore.upsertCamera(camera.created_by, newCamera);

    try {
      const dispatcher = await getDispatcherSafe();
      dispatcher?.toOwnerAgents(camera.created_by, "cameras:updated", {
        change_kind: "created",
        camera_id: id,
        camera: newCamera,
      });
      dispatcher?.broadcast({
        kind: "configuration_changed",
        entityKind: "camera",
        entityId: id,
        changeKind: "created",
        level: "info",
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      logger.warn("Failed to notify agents on camera creation", { error: err });
    }

    return newCamera;
  }

  async update(cameraId: string, changes: ICameraChanges): Promise<ICamera> {
    try {
      if (await this.specterClient.isHealthy()) {
        return await this.specterRepo.update(cameraId, changes);
      }
    } catch (err) {
      logger.debug("Local Specter unavailable for update, updating in AgentCameraStore", { cameraId });
    }

    const camera = this.agentStore.getCamera(cameraId);
    if (!camera) {
      throw new ApiError(404, `Camera ${cameraId} not found`);
    }

    const updated =
      this.agentStore.updateCamera(cameraId, {
        ...changes,
        username: changes.credentials?.username ?? camera.username,
        has_password: changes.credentials ? Boolean(changes.credentials.password) : camera.has_password,
      }) ?? camera;

    try {
      const dispatcher = await getDispatcherSafe();
      dispatcher?.toAgents("cameras:updated", {
        change_kind: "updated",
        camera_id: cameraId,
        camera: changes,
      });
      dispatcher?.broadcast({
        kind: "configuration_changed",
        entityKind: "camera",
        entityId: cameraId,
        changeKind: "updated",
        level: "info",
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      logger.warn("Failed to notify agents on camera update", { error: err });
    }

    return updated;
  }

  async delete(cameraId: string): Promise<void> {
    try {
      if (await this.specterClient.isHealthy()) {
        return await this.specterRepo.delete(cameraId);
      }
    } catch (err) {
      logger.debug("Local Specter unavailable for delete, removing from AgentCameraStore", { cameraId });
    }

    this.agentStore.removeCamera(cameraId);
    try {
      const dispatcher = await getDispatcherSafe();
      dispatcher?.toAgents("cameras:updated", {
        change_kind: "deleted",
        camera_id: cameraId,
      });
      dispatcher?.broadcast({
        kind: "configuration_changed",
        entityKind: "camera",
        entityId: cameraId,
        changeKind: "deleted",
        level: "info",
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      logger.warn("Failed to notify agents on camera deletion", { error: err });
    }
  }
}
