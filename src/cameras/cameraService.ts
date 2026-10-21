// BLL for camera operations: cameras live in Specter, access rules and assignments in fa.

import { container, inject, injectable } from "tsyringe";
import {
  canManageAssignments,
  canManageCamera,
  canViewCamera,
  CameraAccessSubject,
  CameraRole,
} from "@cameras/domain/cameraAccess.js";
import { CameraAssignmentRepository, CameraRepository } from "@cameras/domain/cameraRepository.js";
import { CAMERA_ASSIGNMENT_REPOSITORY, CAMERA_REPOSITORY } from "@cameras/infrastructure/tokens.js";
import { ApiError } from "@core/middlewares/errorHandler.js";
import logger from "@core/utils/logger.js";
import { ICamera, ICameraAssignment, ICameraChanges, ICameraCredentials } from "~types/interfaces.js";
import { NotificationDispatcher } from "@notifications/notificationDispatcher.js";

function getDispatcherSafe(): NotificationDispatcher | null {
  try {
    if (container.isRegistered(NotificationDispatcher)) {
      return container.resolve(NotificationDispatcher);
    }
  } catch {
    return null;
  }
  return null;
}

export interface CameraUser {
  id: string;
  role: string;
}

export interface CameraCreateRequest {
  name: string;
  source_url: string;
  credentials?: ICameraCredentials;
  location?: string;
  watchlist_ids: string[];
  detection_classes: string[];
}

export type CameraUpdateRequest = ICameraChanges;

/** Every camera, or only the listed ones. */
export type AccessibleCameraIds = "all" | Set<string>;

function toSubject(user: CameraUser): CameraAccessSubject {
  return { id: user.id, role: user.role as CameraRole };
}

/**
 * Moves a password written into the URL into credentials, since Specter refuses URLs with a
 * password; credentials given separately win.
 */
export function splitSourceCredentials(
  sourceUrl: string,
  credentials: ICameraCredentials | null | undefined,
): { source_url: string; credentials: ICameraCredentials | null | undefined } {
  let url: URL;
  try {
    url = new URL(sourceUrl);
  } catch {
    throw new ApiError(400, "Source URL is not a valid URL");
  }
  if (!url.password) return { source_url: sourceUrl, credentials };
  const embedded = {
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  };
  url.username = "";
  url.password = "";
  return { source_url: url.toString(), credentials: credentials ?? embedded };
}

@injectable()
export class CameraService {
  constructor(
    @inject(CAMERA_REPOSITORY) private readonly cameraRepository: CameraRepository,
    @inject(CAMERA_ASSIGNMENT_REPOSITORY)
    private readonly assignmentRepository: CameraAssignmentRepository,
  ) {}

  async createCamera(request: CameraCreateRequest, user: CameraUser): Promise<ICamera> {
    if (!["operator", "admin"].includes(user.role)) {
      throw new ApiError(403, "Insufficient permissions to create camera");
    }
    const { source_url, credentials } = splitSourceCredentials(request.source_url, request.credentials);
    return this.cameraRepository.create({
      name: request.name,
      source_url,
      credentials: credentials ?? null,
      location: request.location ?? null,
      created_by: user.id,
      watchlist_ids: request.watchlist_ids,
      detection_classes: request.detection_classes,
    });
  }

  async listAccessibleCameras(user: CameraUser): Promise<ICamera[]> {
    const cameras = await this.cameraRepository.findAll();
    if (user.role === "admin") return cameras;
    const assignedIds = new Set(await this.assignmentRepository.findCameraIdsAssignedTo(user.id));
    return cameras.filter((camera) => canViewCamera(camera, toSubject(user), assignedIds.has(camera.id)));
  }

  /** The ids of the cameras the user may see, to filter alerts and live notifications. */
  async accessibleCameraIds(user: CameraUser): Promise<AccessibleCameraIds> {
    if (user.role === "admin") return "all";
    return new Set((await this.listAccessibleCameras(user)).map((camera) => camera.id));
  }

  /** Returns the camera, answering 404 for one the user may not see so it does not leak. */
  async getAccessibleCamera(cameraId: string, user: CameraUser): Promise<ICamera> {
    const camera = await this.cameraRepository.findById(cameraId);
    if (camera === null || !canViewCamera(camera, toSubject(user), await this.isAssigned(camera, user))) {
      throw new ApiError(404, "Camera not found");
    }
    return camera;
  }

  async getManageableCamera(cameraId: string, user: CameraUser): Promise<ICamera> {
    const camera = await this.getAccessibleCamera(cameraId, user);
    if (!canManageCamera(camera, toSubject(user), await this.isAssigned(camera, user))) {
      throw new ApiError(403, "Insufficient permissions to change this camera");
    }
    return camera;
  }

  async updateCamera(cameraId: string, request: CameraUpdateRequest, user: CameraUser): Promise<ICamera> {
    await this.getManageableCamera(cameraId, user);
    const changes = { ...request };
    if (request.source_url !== undefined) {
      Object.assign(changes, splitSourceCredentials(request.source_url, request.credentials));
      if (changes.credentials === undefined) delete changes.credentials;
    }
    return this.cameraRepository.update(cameraId, changes);
  }

  async deleteCamera(cameraId: string, user: CameraUser): Promise<void> {
    await this.getManageableCamera(cameraId, user);
    await this.cameraRepository.delete(cameraId);
    try {
      await this.assignmentRepository.removeAllForCamera(cameraId);
    } catch (error) {
      // Assignments of a deleted camera match no camera Specter lists, so they are harmless.
      logger.warn("Cannot remove the assignments of a deleted camera", { cameraId, error: error.message });
    }
  }

  async startCamera(cameraId: string, user: CameraUser): Promise<ICamera> {
    await this.getManageableCamera(cameraId, user);
    return this.cameraRepository.start(cameraId);
  }

  async stopCamera(cameraId: string, user: CameraUser): Promise<ICamera> {
    await this.getManageableCamera(cameraId, user);
    return this.cameraRepository.stop(cameraId);
  }

  async assignCameraToUser(cameraId: string, targetUserId: string, user: CameraUser): Promise<ICameraAssignment> {
    await this.requireAssignmentManager(cameraId, user);
    try {
      const assignment = await this.assignmentRepository.assign({
        camera_id: cameraId,
        user_id: targetUserId,
        assigned_by: user.id,
      });

      try {
        const dispatcher = getDispatcherSafe();
        dispatcher?.joinCameraByUser(targetUserId, cameraId);
        dispatcher?.toUser(targetUserId, {
          kind: "configuration_changed",
          entityKind: "camera",
          entityId: cameraId,
          changeKind: "updated",
          level: "info",
          timestamp: new Date().toISOString(),
        });
      } catch (err) {
        logger.warn("Failed to notify user on camera assignment", { error: err });
      }

      return assignment;
    } catch (error) {
      if (error.message.includes("duplicate key")) {
        throw new ApiError(409, "Camera is already assigned to this user");
      }
      throw error;
    }
  }

  async removeCameraAssignment(cameraId: string, targetUserId: string, user: CameraUser): Promise<void> {
    const camera = await this.getAccessibleCamera(cameraId, user);
    if (!canManageAssignments(camera, toSubject(user))) {
      throw new ApiError(403, "Only the camera's creator or an admin can manage its assignments");
    }
    await this.assignmentRepository.remove(cameraId, targetUserId);

    try {
      const dispatcher = getDispatcherSafe();
      if (camera.created_by !== targetUserId) {
        await dispatcher?.leaveCameraByUser(targetUserId, cameraId);
      }
      dispatcher?.toUser(targetUserId, {
        kind: "configuration_changed",
        entityKind: "camera",
        entityId: cameraId,
        changeKind: "updated",
        level: "info",
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      logger.warn("Failed to notify user on camera assignment removal", { error: err });
    }
  }

  async getCameraAssignments(cameraId: string, user: CameraUser): Promise<ICameraAssignment[]> {
    await this.requireAssignmentManager(cameraId, user);
    return this.assignmentRepository.listForCamera(cameraId);
  }

  private async requireAssignmentManager(cameraId: string, user: CameraUser): Promise<void> {
    const camera = await this.getAccessibleCamera(cameraId, user);
    if (!canManageAssignments(camera, toSubject(user))) {
      throw new ApiError(403, "Only the camera's creator or an admin can manage its assignments");
    }
  }

  private async isAssigned(camera: ICamera, user: CameraUser): Promise<boolean> {
    if (user.role === "admin" || camera.created_by === user.id) return false;
    return this.assignmentRepository.isAssigned(camera.id, user.id);
  }
}
