import { describe, expect, it } from "vitest";
import { SpecterEventRelay } from "@notifications/specterEventRelay.js";
import type { NotificationDispatcher } from "@notifications/notificationDispatcher.js";
import type { SpecterCatalog } from "@specter/specterCatalog.js";
import type { SpecterEventStream } from "@specter/specterEventStream.js";

const CAMERA_ID = `camera_${"e".repeat(32)}`;
const WATCHLIST_ID = `watchlist_${"e".repeat(32)}`;
const TARGET_ID = `target_${"e".repeat(32)}`;

function buildRelay() {
  const calls: Array<[string, ...unknown[]]> = [];
  const dispatcher = {
    toCamera: (...args) => calls.push(["toCamera", ...args]),
    toRoles: (...args) => calls.push(["toRoles", ...args]),
    toCameraAndRoles: (...args) => calls.push(["toCameraAndRoles", ...args]),
    joinCameraByRole: (...args) => calls.push(["joinCameraByRole", ...args]),
    closeCamera: (...args) => calls.push(["closeCamera", ...args]),
    toAgents: (...args) => calls.push(["toAgents", ...args]),
  } as Partial<NotificationDispatcher> as NotificationDispatcher;
  const catalog = {
    read: async () => ({
      cameraNames: new Map([[CAMERA_ID, "Gate"]]),
      watchlists: new Map([[WATCHLIST_ID, { name: "Banned", kind: "blacklist" as const }]]),
      targetLabels: new Map([[TARGET_ID, "Jane"]]),
    }),
  } as Partial<SpecterCatalog> as SpecterCatalog;
  const relay = new SpecterEventRelay({} as SpecterEventStream, catalog, dispatcher);
  return { relay, calls };
}

describe("SpecterEventRelay", () => {
  it("sends a blacklist match to the camera's room as critical, with names", async () => {
    const { relay, calls } = buildRelay();

    await relay.relay({
      kind: "match_confirmed",
      message: {
        message_id: "message_1",
        occurred_at: "2026-09-24T10:00:00Z",
        owner_id: "specter",
        camera_id: CAMERA_ID,
        track_id: 3,
        watchlist_id: WATCHLIST_ID,
        target_id: TARGET_ID,
        modality: "face",
        similarity_ratio: 0.7,
        margin_ratio: 0.2,
        threshold_ratio: 0.45,
        object_class: "person",
        bounding_box: { x: 0.1, y: 0.1, width: 0.2, height: 0.4 },
        first_seen_at: "2026-09-24T09:59:58Z",
        frame_captured_at: "2026-09-24T10:00:00Z",
        snapshot_path: "evidence/specter/2026/09/24/message_1.jpg",
      },
    });

    expect(calls).toEqual([
      [
        "toCamera",
        CAMERA_ID,
        expect.objectContaining({
          kind: "alert",
          alertId: "message_1",
          cameraName: "Gate",
          targetLabel: "Jane",
          level: "critical",
          snapshotUrl: "/api/alerts/message_1/snapshot",
        }),
      ],
    ]);
  });

  it("lets admins follow a new camera and tells its viewers once", async () => {
    const { relay, calls } = buildRelay();

    await relay.relay({
      kind: "configuration_changed",
      message: {
        occurred_at: "2026-09-24T10:00:00Z",
        owner_id: "specter",
        entity_kind: "camera",
        entity_id: CAMERA_ID,
        change_kind: "created",
      },
    });

    expect(calls.map(([method]) => method)).toEqual(["joinCameraByRole", "toCameraAndRoles", "toAgents"]);
  });
});
