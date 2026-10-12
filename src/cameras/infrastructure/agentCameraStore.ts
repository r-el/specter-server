import { singleton } from "tsyringe";
import { CameraLiveStatus, ICamera } from "~types/interfaces.js";
import logger from "@core/utils/logger.js";

/**
 * In-memory store of cameras synced from connected Edge Agents.
 * Maps agentId -> (cameraId -> ICamera), with an agent→owner mapping
 * so cameras can be aggregated per owner across multiple agents.
 */
@singleton()
export class AgentCameraStore {
  private readonly camerasByAgent = new Map<string, Map<string, ICamera>>();
  private readonly agentToOwner = new Map<string, string>();

  /**
   * Replaces or updates the cameras associated with a specific agent.
   * Supports both 3-arg (agentId, ownerId, cameras) and 2-arg (ownerId, cameras) calls.
   */
  setCameras(ownerId: string, cameras: ICamera[]): void;
  setCameras(agentId: string, ownerId: string, cameras: ICamera[]): void;
  setCameras(agentIdOrOwner: string, ownerOrCameras: string | ICamera[], maybeCameras?: ICamera[]): void {
    let agentId: string;
    let ownerId: string;
    let cameras: ICamera[];

    if (Array.isArray(ownerOrCameras)) {
      ownerId = agentIdOrOwner;
      agentId = `agent:${agentIdOrOwner}`;
      cameras = ownerOrCameras;
    } else {
      agentId = agentIdOrOwner;
      ownerId = ownerOrCameras;
      cameras = maybeCameras ?? [];
    }

    const agentMap = new Map<string, ICamera>();
    for (const camera of cameras) {
      if (!camera.created_by) {
        camera.created_by = ownerId;
      }
      agentMap.set(camera.id, camera);
    }
    this.camerasByAgent.set(agentId, agentMap);
    this.agentToOwner.set(agentId, ownerId);
    logger.info("AgentCameraStore: updated cameras for agent", {
      agentId,
      ownerId,
      cameraCount: cameras.length,
    });
  }

  /** Finds which agent owns a given camera ID. */
  getAgentIdForCamera(cameraId: string): string | null {
    for (const [agentId, agentMap] of this.camerasByAgent) {
      if (agentMap.has(cameraId)) return agentId;
    }
    return null;
  }

  /** Returns the owner ID associated with an agent. */
  getOwnerForAgent(agentId: string): string | null {
    return this.agentToOwner.get(agentId) ?? null;
  }

  /** Returns all cameras across all owners, or for a specific owner (aggregated across all that owner's agents). */
  getCameras(ownerId?: string): ICamera[] {
    if (ownerId) {
      const all: ICamera[] = [];
      for (const [agentId, agentMap] of this.camerasByAgent) {
        if (this.agentToOwner.get(agentId) === ownerId) {
          all.push(...agentMap.values());
        }
      }
      return all;
    }
    const all: ICamera[] = [];
    for (const agentMap of this.camerasByAgent.values()) {
      all.push(...agentMap.values());
    }
    return all;
  }

  /** Returns cameras for a specific agent only. */
  getCamerasForAgent(agentId: string): ICamera[] {
    const agentMap = this.camerasByAgent.get(agentId);
    return agentMap ? Array.from(agentMap.values()) : [];
  }

  /** Finds a camera by its ID across all agent sets. */
  getCamera(cameraId: string): ICamera | null {
    for (const agentMap of this.camerasByAgent.values()) {
      const camera = agentMap.get(cameraId);
      if (camera) return camera;
    }
    return null;
  }

  /** Updates the live status of a camera. Returns true if camera was found. */
  updateCameraStatus(cameraId: string, status: CameraLiveStatus): boolean {
    for (const agentMap of this.camerasByAgent.values()) {
      const camera = agentMap.get(cameraId);
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
    for (const agentMap of this.camerasByAgent.values()) {
      const camera = agentMap.get(cameraId);
      if (camera) {
        Object.assign(camera, changes);
        return camera;
      }
    }
    return null;
  }

  /** Adds or updates an individual camera. */
  upsertCamera(ownerId: string, camera: ICamera): void {
    // Find the first agent belonging to this owner, or create a virtual 'cloud' agent entry
    let targetAgentId: string | null = null;
    for (const [agentId, owner] of this.agentToOwner) {
      if (owner === ownerId) {
        targetAgentId = agentId;
        break;
      }
    }
    if (!targetAgentId) {
      targetAgentId = `cloud:${ownerId}`;
      this.agentToOwner.set(targetAgentId, ownerId);
    }
    let agentMap = this.camerasByAgent.get(targetAgentId);
    if (!agentMap) {
      agentMap = new Map<string, ICamera>();
      this.camerasByAgent.set(targetAgentId, agentMap);
    }
    agentMap.set(camera.id, camera);
  }

  /** Removes a camera from the store. Returns true if removed. */
  removeCamera(cameraId: string): boolean {
    for (const agentMap of this.camerasByAgent.values()) {
      if (agentMap.delete(cameraId)) {
        return true;
      }
    }
    return false;
  }

  /** Marks all cameras for a specific agent as stopped without removing them. */
  markAgentCamerasOffline(agentId: string): void {
    const agentMap = this.camerasByAgent.get(agentId);
    if (agentMap) {
      for (const camera of agentMap.values()) {
        camera.live_status = "stopped";
        camera.desired_state = "stopped";
      }
      logger.info("AgentCameraStore: marked cameras offline for agent", { agentId });
    }
  }

  /** Removes all cameras for a specific agent and cleans up the agent→owner mapping. */
  removeAgent(agentId: string): void {
    const had = this.camerasByAgent.delete(agentId);
    this.agentToOwner.delete(agentId);
    if (had) {
      logger.info("AgentCameraStore: removed cameras for agent", { agentId });
    }
  }

  /** Clears all stored cameras (useful for testing). */
  clear(): void {
    this.camerasByAgent.clear();
    this.agentToOwner.clear();
  }
}
