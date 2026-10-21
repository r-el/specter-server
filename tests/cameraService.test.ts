import { describe, expect, it } from "vitest";
import { CameraService, splitSourceCredentials } from "@cameras/cameraService.js";
import type { CameraAssignmentRepository, CameraRepository } from "@cameras/domain/cameraRepository.js";
import type { ICamera, ICameraAssignment } from "~types/interfaces.js";

const cameraId = (letter: string) => `camera_${letter.repeat(32)}`;

function buildCamera(id: string, createdBy: string): ICamera {
  return {
    id,
    name: id,
    source_url: "rtsp://192.168.1.20/stream",
    username: null,
    has_password: false,
    location: null,
    created_by: createdBy,
    watchlist_ids: [],
    detection_classes: [],
    is_enabled: true,
    desired_state: "stopped",
    live_status: null,
  };
}

function buildService(cameras: ICamera[], assignments: ICameraAssignment[] = []) {
  const created: unknown[] = [];
  const cameraRepository = {
    create: async (camera) => {
      created.push(camera);
      return buildCamera(cameraId("f"), camera.created_by);
    },
    findById: async (id) => cameras.find((camera) => camera.id === id) ?? null,
    findAll: async () => cameras,
  } as Partial<CameraRepository> as CameraRepository;
  const assignmentRepository = {
    findCameraIdsAssignedTo: async (userId) =>
      assignments.filter((assignment) => assignment.user_id === userId).map((assignment) => assignment.camera_id),
    isAssigned: async (id, userId) =>
      assignments.some((assignment) => assignment.camera_id === id && assignment.user_id === userId),
    assign: async (assignment) => {
      assignments.push(assignment);
      return assignment;
    },
    remove: async (id, userId) => {
      const idx = assignments.findIndex((a) => a.camera_id === id && a.user_id === userId);
      if (idx >= 0) assignments.splice(idx, 1);
    },
    listForCamera: async (id) => assignments.filter((a) => a.camera_id === id),
  } as Partial<CameraAssignmentRepository> as CameraAssignmentRepository;
  return { service: new CameraService(cameraRepository, assignmentRepository), created };
}

describe("splitSourceCredentials", () => {
  it("moves a password in the URL into credentials", () => {
    expect(splitSourceCredentials("rtsp://admin:p%40ss@192.168.1.20:554/stream1", undefined)).toEqual({
      source_url: "rtsp://192.168.1.20:554/stream1",
      credentials: { username: "admin", password: "p@ss" },
    });
  });

  it("keeps a URL without a password as it is", () => {
    expect(splitSourceCredentials("rtsp://viewer@192.168.1.20/stream", undefined)).toEqual({
      source_url: "rtsp://viewer@192.168.1.20/stream",
      credentials: undefined,
    });
  });
});

describe("CameraService", () => {
  const cameras = [buildCamera(cameraId("a"), "operator-1"), buildCamera(cameraId("b"), "operator-2")];

  it("lists for an operator the cameras they created or were assigned", async () => {
    const { service } = buildService(cameras, [{ camera_id: cameraId("b"), user_id: "operator-1" }]);

    const listed = await service.listAccessibleCameras({ id: "operator-1", role: "operator" });

    expect(listed.map((camera) => camera.id)).toEqual([cameraId("a"), cameraId("b")]);
  });

  it("hides a camera the user may not see as missing", async () => {
    const { service } = buildService(cameras);

    const read = service.getAccessibleCamera(cameraId("a"), { id: "viewer-1", role: "viewer" });

    await expect(read).rejects.toMatchObject({ statusCode: 404 });
  });

  it("records the creator and never sends a password inside the URL", async () => {
    const { service, created } = buildService([]);

    await service.createCamera(
      {
        name: "Gate",
        source_url: "rtsp://admin:secret@192.168.1.21/stream",
        location: "North gate",
        watchlist_ids: [],
        detection_classes: [],
      },
      { id: "operator-1", role: "operator" },
    );

    expect(created).toEqual([
      expect.objectContaining({
        source_url: "rtsp://192.168.1.21/stream",
        credentials: { username: "admin", password: "secret" },
        created_by: "operator-1",
        location: "North gate",
      }),
    ]);
  });

  it("assigns and removes camera from user", async () => {
    const { service } = buildService(cameras, []);

    // Operator-1 created camera 'a', so can assign it
    const assigned = await service.assignCameraToUser(cameraId("a"), "viewer-1", {
      id: "operator-1",
      role: "operator",
    });

    expect(assigned).toMatchObject({
      camera_id: cameraId("a"),
      user_id: "viewer-1",
    });

    // Viewer-1 can now access camera 'a'
    const accessible = await service.getAccessibleCamera(cameraId("a"), {
      id: "viewer-1",
      role: "viewer",
    });
    expect(accessible.id).toBe(cameraId("a"));

    // Remove assignment
    await service.removeCameraAssignment(cameraId("a"), "viewer-1", {
      id: "operator-1",
      role: "operator",
    });

    // Viewer-1 cannot access camera 'a' anymore
    await expect(service.getAccessibleCamera(cameraId("a"), { id: "viewer-1", role: "viewer" })).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});
