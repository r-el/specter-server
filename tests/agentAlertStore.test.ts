import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentAlertStore } from "@alerts/infrastructure/agentAlertStore.js";
import { HybridAlertRepository } from "@alerts/infrastructure/hybridAlertRepository.js";
import type { SpecterAlert } from "@specter/specterTypes.js";
import type { SpecterHttpClient } from "@specter/specterHttpClient.js";

function buildAlert(id: string, cameraId: string, kind: "identity_match" | "rule" = "identity_match"): SpecterAlert {
  return {
    id,
    kind,
    owner_id: "test-owner",
    camera_id: cameraId,
    track_id: 1,
    object_class: "person",
    bounding_box: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
    frame_captured_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    has_snapshot: true,
    review: {
      disposition: "unreviewed",
      is_acknowledged: false,
      note: null,
    },
    target_id: kind === "identity_match" ? "target-1" : null,
  };
}

describe("AgentAlertStore", () => {
  let store: AgentAlertStore;

  beforeEach(() => {
    store = new AgentAlertStore();
  });

  it("stores and lists alerts matching filters", () => {
    const alert1 = buildAlert("alert-1", "cam-1", "identity_match");
    const alert2 = buildAlert("alert-2", "cam-2", "rule");
    store.addAlert(alert1);
    store.addAlert(alert2);

    const pageAll = store.list({ limit: 10 });
    expect(pageAll.alerts).toHaveLength(2);

    const pageCam1 = store.list({ camera_ids: ["cam-1"], limit: 10 });
    expect(pageCam1.alerts).toHaveLength(1);
    expect(pageCam1.alerts[0].id).toBe("alert-1");

    const pageRules = store.list({ kind: "rule", limit: 10 });
    expect(pageRules.alerts).toHaveLength(1);
    expect(pageRules.alerts[0].id).toBe("alert-2");
  });

  it("stores snapshot and returns readable stream", async () => {
    const alert = buildAlert("alert-snap", "cam-1");
    const testBytes = Buffer.from("fake-jpeg-data");
    const base64 = testBytes.toString("base64");

    store.addAlert(alert, base64);
    const snap = store.readSnapshot("alert-snap");
    expect(snap.contentType).toBe("image/jpeg");

    const reader = snap.body.getReader();
    const { value } = await reader.read();
    expect(Buffer.from(value!).toString()).toBe("fake-jpeg-data");
  });

  it("acknowledges and resolves alerts", () => {
    const alert = buildAlert("alert-rev", "cam-1");
    store.addAlert(alert);

    const ack = store.acknowledge("alert-rev");
    expect(ack.review.is_acknowledged).toBe(true);

    const res = store.resolve("alert-rev", "true_positive", "confirmed person");
    expect(res.review.disposition).toBe("true_positive");
    expect(res.review.note).toBe("confirmed person");
  });

  it("summarizes alert counts", () => {
    const a1 = buildAlert("a-1", "cam-1");
    const a2 = buildAlert("a-2", "cam-1");
    store.addAlert(a1);
    store.addAlert(a2);

    const summary = store.summarize({ camera_ids: ["cam-1"] });
    expect(summary.total_count).toBe(2);
    expect(summary.unacknowledged_count).toBe(2);
  });
});

describe("HybridAlertRepository", () => {
  let store: AgentAlertStore;
  let mockSpecterClient: Partial<SpecterHttpClient>;

  beforeEach(() => {
    store = new AgentAlertStore();
  });

  it("falls back to AgentAlertStore when local Specter is unhealthy / unavailable", async () => {
    mockSpecterClient = {
      isHealthy: vi.fn().mockResolvedValue(false),
      ownerId: "test-owner",
    };

    const repo = new HybridAlertRepository(mockSpecterClient as SpecterHttpClient, store);
    const alert = buildAlert("alert-hybrid", "cam-1");
    store.addAlert(alert);

    const page = await repo.list({ limit: 10 });
    expect(page.alerts).toHaveLength(1);
    expect(page.alerts[0].id).toBe("alert-hybrid");

    const found = await repo.findById("alert-hybrid");
    expect(found?.id).toBe("alert-hybrid");
  });
});
