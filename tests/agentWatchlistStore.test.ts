import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentWatchlistStore } from "@watchlists/infrastructure/agentWatchlistStore.js";
import { WatchlistService } from "@watchlists/watchlistService.js";
import type { SpecterHttpClient } from "@specter/specterHttpClient.js";
import type { SpecterWatchlist, SpecterTarget } from "@specter/specterTypes.js";

function buildWatchlist(id: string, name: string, ownerId: string): SpecterWatchlist {
  return {
    id,
    name,
    kind: "custom" as any,
    owner_id: ownerId,
    target_type: "person",
    face_match_threshold_ratio: 0.6,
    appearance_match_threshold_ratio: 0.7,
    metadata: {},
  };
}

function buildTarget(id: string, watchlistId: string, label: string): SpecterTarget {
  return {
    id,
    watchlist_id: watchlistId,
    label,
    target_type: "person",
    is_enabled: true,
    enrollment_status: "enrolled" as any,
    enrollment_batch_id: null,
    metadata: {},
    reference_images: [],
  };
}

describe("AgentWatchlistStore", () => {
  let store: AgentWatchlistStore;

  beforeEach(() => {
    store = new AgentWatchlistStore();
  });

  it("stores and retrieves watchlists and targets by owner", () => {
    const wl1 = buildWatchlist("wl-1", "VIPs", "owner-1");
    const target1 = buildTarget("t-1", "wl-1", "Alice");

    store.setWatchlists("agent-1", "owner-1", [wl1], [target1]);

    expect(store.getWatchlists("owner-1")).toHaveLength(1);
    expect(store.getWatchlist("wl-1")?.name).toBe("VIPs");
    expect(store.getTargets("wl-1")).toHaveLength(1);
    expect(store.getTarget("wl-1", "t-1")?.label).toBe("Alice");
    expect(store.getWatchlist("unknown")).toBeNull();
  });

  it("supports upsert and delete operations", () => {
    const wl1 = buildWatchlist("wl-1", "Staff", "owner-1");
    store.upsertWatchlist("owner-1", wl1);

    expect(store.getWatchlist("wl-1")?.name).toBe("Staff");

    const deleted = store.deleteWatchlist("wl-1");
    expect(deleted).toBe(true);
    expect(store.getWatchlist("wl-1")).toBeNull();
  });
});

describe("WatchlistService (Hybrid Fallback)", () => {
  it("falls back to AgentWatchlistStore when Specter is unreachable", async () => {
    const mockSpecterClient = {
      ownerId: "owner-1",
      isHealthy: vi.fn().mockResolvedValue(false),
      api: {
        GET: vi.fn(),
      },
      unwrap: vi.fn(),
    } as unknown as SpecterHttpClient;

    const store = new AgentWatchlistStore();
    const wl = buildWatchlist("wl-cloud-1", "Cloud Watchlist", "owner-1");
    store.setWatchlists("agent-1", "owner-1", [wl]);

    const service = new WatchlistService(mockSpecterClient, store);

    const result = await service.listWatchlists();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("wl-cloud-1");
    expect(result[0].name).toBe("Cloud Watchlist");
  });

  it("creates watchlists in AgentWatchlistStore when Specter is unreachable", async () => {
    const mockSpecterClient = {
      ownerId: "owner-1",
      isHealthy: vi.fn().mockResolvedValue(false),
      api: {
        POST: vi.fn(),
      },
      unwrap: vi.fn(),
    } as unknown as SpecterHttpClient;

    const store = new AgentWatchlistStore();
    const service = new WatchlistService(mockSpecterClient, store);

    const created = await service.createWatchlist({
      name: "New Fallback Watchlist",
      target_type: "person",
    });

    expect(created.name).toBe("New Fallback Watchlist");
    expect(store.getWatchlists("owner-1")).toHaveLength(1);
  });
});
