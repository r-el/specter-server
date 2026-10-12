import { describe, it, expect, vi, beforeEach } from "vitest";
import { config, getWebrtcIceServers } from "@core/config.js";
import { LiveController } from "@live/liveController.js";
import { CameraService } from "@cameras/cameraService.js";
import { container } from "tsyringe";

vi.mock("@cameras/cameraService.js", () => ({
  CameraService: class {
    getAccessibleCamera = vi.fn();
  },
}));

describe("WebRTC Signaling & Cloudflare TURN", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getWebrtcIceServers", () => {
    it("returns public STUN servers by default when no Cloudflare credentials are set", () => {
      const originalKey = config.webrtc.turnKeyId;
      const originalToken = config.webrtc.turnApiToken;
      try {
        config.webrtc.turnKeyId = undefined;
        config.webrtc.turnApiToken = undefined;

        const servers = getWebrtcIceServers();
        expect(servers).toBeDefined();
        expect(servers.length).toBeGreaterThanOrEqual(1);
        expect(servers[0].urls).toEqual(expect.arrayContaining(["stun:turn.cloudflare.com:3478"]));
      } finally {
        config.webrtc.turnKeyId = originalKey;
        config.webrtc.turnApiToken = originalToken;
      }
    });

    it("returns Cloudflare TURN servers when turnKeyId and turnApiToken are configured", () => {
      const originalKey = config.webrtc.turnKeyId;
      const originalToken = config.webrtc.turnApiToken;
      try {
        config.webrtc.turnKeyId = "test-cf-turn-id";
        config.webrtc.turnApiToken = "test-cf-turn-token";

        const servers = getWebrtcIceServers();
        expect(servers.length).toBe(2);
        expect(servers[0].urls).toEqual(["stun:turn.cloudflare.com:3478", "stun:stun.cloudflare.com:3478"]);
        expect(servers[1].username).toBe("test-cf-turn-id");
        expect(servers[1].credential).toBe("test-cf-turn-token");
        expect(Array.isArray(servers[1].urls)).toBe(true);
        expect((servers[1].urls as string[])[0]).toContain("turn:turn.cloudflare.com");
      } finally {
        config.webrtc.turnKeyId = originalKey;
        config.webrtc.turnApiToken = originalToken;
      }
    });
  });

  describe("LiveController.getIceServers", () => {
    it("returns ice servers for accessible camera", async () => {
      const mockCameraService = {
        getAccessibleCamera: vi.fn().mockResolvedValue({
          id: "cam-123",
          name: "Front Gate",
          created_by: "user-abc",
        }),
      };
      vi.spyOn(container, "resolve").mockReturnValue(mockCameraService as any);

      const req = {
        params: { camera_id: "cam-123" },
        user: { id: "user-abc", role: "operator" },
      } as any;
      const res = {
        json: vi.fn(),
      } as any;

      await LiveController.getIceServers(req, res);

      expect(mockCameraService.getAccessibleCamera).toHaveBeenCalledWith("cam-123", req.user);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            iceServers: expect.any(Array),
          }),
        }),
      );
    });
  });
});
