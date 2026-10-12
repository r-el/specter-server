import { singleton } from "tsyringe";
import { CameraLiveStatus, ICamera } from "~types/interfaces.js";
import logger from "@core/utils/logger.js";

/**
 * In-memory store of cameras synced from connected Edge Agents.
 * Maps ownerId -> (cameraId -> ICamera).
 */
@singleton()
export class AgentCameraStore {
  private readonly camerasByOwner = new Map<string, Map<string, ICamera>>();

  /** Replaces or updates the cameras associated with an owner. */
  setCameras(ownerId: string, cameras: ICamera[]): void {
    const ownerMap = new Map<string, ICamera>();
    for (const camera of cameras) {
      ownerMap.set(camera.id, camera);
    }
    this.camerasByOwner.set(ownerId, ownerMap);
    logger.info("AgentCameraStore: updated cameras for owner", {
      ownerId,
      cameraCount: cameras.length,
    });
  }

  /** Returns all cameras across all owners, or for a specific owner. */
  getCameras(ownerId?: string): ICamera[] {
    if (ownerId) {
      const ownerMap = this.camerasByOwner.get(ownerId);
      return ownerMap ? Array.from(ownerMap.values()) : [];
    }
    const all: ICamera[] = [];
    for (const ownerMap of this.camerasByOwner.values()) {
      all.push(...ownerMap.values());
    }
    return all;
  }

  /** Finds a camera by its ID across all owner sets. */
  getCamera(cameraId: string): ICamera | null {
    for (const ownerMap of this.camerasByOwner.values()) {
      const camera = ownerMap.get(cameraId);
      if (camera) return camera;
    }
    return null;
  }

  /** Updates the live status of a camera. Returns true if camera was found. */
  updateCameraStatus(cameraId: string, status: CameraLiveStatus): boolean {
    for (const ownerMap of this.camerasByOwner.values()) {
      const camera = ownerMap.get(cameraId);
      if (camera) {
        camera.live_status = status;
        if (status === "running") {
          camera.desired_state = "running";
        } else if (status === "stopped") {
          camera.desired_state = "stopped";
        }
        return true;
      }
    }
    return false;
  }

  /** Applies partial changes to a camera in the store. */
  updateCamera(cameraId: string, changes: Partial<ICamera>): ICamera | null {
    for (const ownerMap of this.camerasByOwner.values()) {
      const camera = ownerMap.get(cameraId);
      if (camera) {
        Object.assign(camera, changes);
        return camera;
      }
    }
    return null;
  }

  /** Adds or updates an individual camera. */
  upsertCamera(ownerId: string, camera: ICamera): void {
    let ownerMap = this.camerasByOwner.get(ownerId);
    if (!ownerMap) {
      ownerMap = new Map<string, ICamera>();
      this.camerasByOwner.set(ownerId, ownerMap);
    }
    ownerMap.set(camera.id, camera);
  }

  /** Removes a camera from the store. Returns true if removed. */
  removeCamera(cameraId: string): boolean {
    for (const ownerMap of this.camerasByOwner.values()) {
      if (ownerMap.delete(cameraId)) {
        return true;
      }
    }
    return false;
  }

  /** Clears all stored cameras (useful for testing). */
  clear(): void {
    this.camerasByOwner.clear();
  }
}
