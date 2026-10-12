import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentCameraStore } from "@cameras/infrastructure/agentCameraStore.js";
import { HybridCameraRepository } from "@cameras/infrastructure/hybridCameraRepository.js";
import type { ICamera } from "~types/interfaces.js";
import type { SpecterHttpClient } from "@specter/specterHttpClient.js";

function buildCamera(id: string, name: string, ownerId: string): ICamera {
  return {
    id,
    name,
    source_url: "rtsp://127.0.0.1:8554/live",
    username: null,
    has_password: false,
    location: "Main Gate",
    created_by: ownerId,
    watchlist_ids: [],
    detection_classes: ["person"],
    is_enabled: true,
    desired_state: "stopped",
    live_status: null,
  };
}

describe("AgentCameraStore", () => {
  let store: AgentCameraStore;

  beforeEach(() => {
    store = new AgentCameraStore();
  });

  it("stores and retrieves cameras by owner", () => {
    const cam1 = buildCamera("cam-1", "Entrance", "owner-1");
    const cam2 = buildCamera("cam-2", "Exit", "owner-1");
    store.setCameras("owner-1", [cam1, cam2]);

    expect(store.getCameras("owner-1")).toHaveLength(2);
    expect(store.getCamera("cam-1")?.name).toBe("Entrance");
    expect(store.getCamera("non-existent")).toBeNull();
  });

  it("updates camera status dynamically", () => {
    const cam = buildCamera("cam-1", "Entrance", "owner-1");
    store.setCameras("owner-1", [cam]);

    const updated = store.updateCameraStatus("cam-1", "running");
    expect(updated).toBe(true);
    expect(store.getCamera("cam-1")?.live_status).toBe("running");
    expect(store.getCamera("cam-1")?.desired_state).toBe("running");

    store.updateCameraStatus("cam-1", "stopped");
    expect(store.getCamera("cam-1")?.live_status).toBe("stopped");
    expect(store.getCamera("cam-1")?.desired_state).toBe("stopped");
  });

  it("removes a camera", () => {
    const cam = buildCamera("cam-1", "Entrance", "owner-1");
    store.setCameras("owner-1", [cam]);

    expect(store.removeCamera("cam-1")).toBe(true);
    expect(store.getCamera("cam-1")).toBeNull();
    expect(store.getCameras("owner-1")).toHaveLength(0);
  });
});

describe("HybridCameraRepository", () => {
  let store: AgentCameraStore;
  let mockSpecterClient: Partial<SpecterHttpClient>;

  beforeEach(() => {
    store = new AgentCameraStore();
  });

  it("falls back to AgentCameraStore when local Specter is unhealthy / unavailable", async () => {
    mockSpecterClient = {
      isHealthy: vi.fn().mockResolvedValue(false),
    };

    const repo = new HybridCameraRepository(store, mockSpecterClient as SpecterHttpClient);
    const cam = buildCamera("cam-99", "Edge Cam", "owner-1");
    store.setCameras("owner-1", [cam]);

    const all = await repo.findAll();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe("Edge Cam");

    const single = await repo.findById("cam-99");
    expect(single?.id).toBe("cam-99");
  });
});
