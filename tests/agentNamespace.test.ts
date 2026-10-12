import { container } from "tsyringe";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { agentSocketAuthMiddleware } from "@notifications/agentSocketAuth.js";
import { AgentController } from "@agents/agentController.js";
import { CameraService } from "@cameras/cameraService.js";
import { UserService } from "@users/userService.js";
import * as agentService from "@agents/agentService.js";
import { NotificationDispatcher } from "@notifications/notificationDispatcher.js";

vi.mock("@agents/agentService.js", () => ({
  authenticateAgent: vi.fn(),
  heartbeatAgent: vi.fn(),
  createAgent: vi.fn(),
  listAgents: vi.fn(),
  revokeAgent: vi.fn(),
}));

vi.mock("@cameras/cameraService.js", () => ({
  CameraService: class {
    listAccessibleCameras = vi.fn();
  },
}));

vi.mock("@users/userService.js", () => ({
  UserService: class {
    getUserById = vi.fn();
  },
}));

describe("Agent Socket & API Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("agentSocketAuthMiddleware", () => {
    it("rejects handshake when no token is present", async () => {
      const socket = {
        handshake: { auth: {}, headers: {}, address: "127.0.0.1" },
        data: {},
      } as any;
      const next = vi.fn();

      await agentSocketAuthMiddleware(socket, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
      expect(next.mock.calls[0][0].message).toContain("Agent authentication token required");
    });

    it("rejects handshake when token is invalid or revoked", async () => {
      const socket = {
        handshake: { auth: { token: "bad_token" }, headers: {}, address: "127.0.0.1" },
        data: {},
      } as any;
      const next = vi.fn();

      vi.mocked(agentService.authenticateAgent).mockRejectedValue(new Error("Invalid token"));

      await agentSocketAuthMiddleware(socket, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
      expect(next.mock.calls[0][0].message).toContain("Invalid or revoked agent token");
    });

    it("authenticates agent and attaches identity to socket.data", async () => {
      const socket = {
        handshake: { auth: { token: "Bearer valid_token" }, headers: {}, address: "127.0.0.1" },
        data: {},
      } as any;
      const next = vi.fn();

      const mockAgent = { id: "agent-1", owner_id: "owner-1", name: "Site A" };
      vi.mocked(agentService.authenticateAgent).mockResolvedValue(mockAgent);

      await agentSocketAuthMiddleware(socket, next);

      expect(next).toHaveBeenCalledWith();
      expect(socket.data.agent).toEqual(mockAgent);
      expect(agentService.authenticateAgent).toHaveBeenCalledWith("valid_token");
    });
  });

  describe("AgentController.listCameras", () => {
    it("returns accessible cameras for agent owner", async () => {
      const req = {
        agent: { id: "agent-1", owner_id: "user-123", name: "Site A" },
      } as any;
      const res = { json: vi.fn(), status: vi.fn().mockReturnThis() } as any;

      const mockUser = { id: "user-123", role: "operator" };
      const mockCameras = [
        { id: "cam-1", name: "Gate 1", source_url: "rtsp://cam1" },
        { id: "cam-2", name: "Gate 2", source_url: "rtsp://cam2" },
      ];

      vi.mocked(container.resolve(UserService).getUserById as any).mockResolvedValue(mockUser);
      vi.mocked(container.resolve(CameraService).listAccessibleCameras as any).mockResolvedValue(mockCameras);

      await AgentController.listCameras(req, res, vi.fn());

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: {
          cameras: mockCameras,
        },
      });
    });
  });

  describe("NotificationDispatcher agent methods", () => {
    it("dispatches events to agent namespace", () => {
      const emit = vi.fn();
      const to = vi.fn().mockReturnValue({ emit });
      const of = vi.fn().mockReturnValue({ emit, to });
      const io = { of } as any;

      const dispatcher = new NotificationDispatcher(io);

      dispatcher.toAgents("cameras:updated", { change_kind: "created", camera_id: "c1" });
      expect(of).toHaveBeenCalledWith("/agent");
      expect(emit).toHaveBeenCalledWith("cameras:updated", { change_kind: "created", camera_id: "c1" });

      dispatcher.toOwnerAgents("owner-123", "cameras:sync_needed", { reason: "config_changed" });
      expect(to).toHaveBeenCalledWith("owner:owner-123:agents");
      expect(emit).toHaveBeenCalledWith("cameras:sync_needed", { reason: "config_changed" });

      dispatcher.toAgent("agent-456", "ping", {});
      expect(to).toHaveBeenCalledWith("agent:agent-456");
      expect(emit).toHaveBeenCalledWith("ping", {});
    });
  });
});
