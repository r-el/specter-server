import { singleton } from "tsyringe";
import type { SpecterTarget, SpecterWatchlist } from "@specter/specterTypes.js";
import logger from "@core/utils/logger.js";

/**
 * In-memory store of watchlists and targets synced from connected Edge Agents.
 * Maps agentId -> (watchlistId -> SpecterWatchlist), with targets grouped by watchlist.
 */
@singleton()
export class AgentWatchlistStore {
  private readonly watchlistsByAgent = new Map<string, Map<string, SpecterWatchlist>>();
  private readonly agentToOwner = new Map<string, string>();
  private readonly targetsByWatchlist = new Map<string, Map<string, SpecterTarget>>();

  /**
   * Replaces or updates the watchlists and targets associated with a specific agent.
   */
  setWatchlists(agentId: string, ownerId: string, watchlists: SpecterWatchlist[], targets?: SpecterTarget[]): void {
    const agentMap = new Map<string, SpecterWatchlist>();
    for (const wl of watchlists) {
      if (!wl.owner_id) {
        wl.owner_id = ownerId;
      }
      agentMap.set(wl.id, wl);
    }
    this.watchlistsByAgent.set(agentId, agentMap);
    this.agentToOwner.set(agentId, ownerId);

    if (targets && targets.length > 0) {
      for (const target of targets) {
        if (!this.targetsByWatchlist.has(target.watchlist_id)) {
          this.targetsByWatchlist.set(target.watchlist_id, new Map());
        }
        this.targetsByWatchlist.get(target.watchlist_id)!.set(target.id, target);
      }
    }

    logger.info("AgentWatchlistStore: updated watchlists for agent", {
      agentId,
      ownerId,
      watchlistCount: watchlists.length,
      targetCount: targets?.length ?? 0,
    });
  }

  /** Returns all watchlists across all owners, or for a specific owner. */
  getWatchlists(ownerId?: string): SpecterWatchlist[] {
    const all: SpecterWatchlist[] = [];
    for (const [agentId, agentMap] of this.watchlistsByAgent) {
      if (!ownerId || this.agentToOwner.get(agentId) === ownerId) {
        all.push(...agentMap.values());
      }
    }
    return all;
  }

  /** Finds a watchlist by its ID across all agent sets. */
  getWatchlist(id: string): SpecterWatchlist | null {
    for (const agentMap of this.watchlistsByAgent.values()) {
      const wl = agentMap.get(id);
      if (wl) return wl;
    }
    return null;
  }

  /** Returns targets associated with a watchlist. */
  getTargets(watchlistId: string): SpecterTarget[] {
    const map = this.targetsByWatchlist.get(watchlistId);
    return map ? Array.from(map.values()) : [];
  }

  /** Finds a specific target within a watchlist. */
  getTarget(watchlistId: string, targetId: string): SpecterTarget | null {
    const map = this.targetsByWatchlist.get(watchlistId);
    return map?.get(targetId) ?? null;
  }

  /** Upserts a watchlist locally (e.g. created via cloud API). */
  upsertWatchlist(ownerId: string, watchlist: SpecterWatchlist): void {
    let targetAgentId = `owner:${ownerId}:default`;
    for (const [aId, oId] of this.agentToOwner) {
      if (oId === ownerId) {
        targetAgentId = aId;
        break;
      }
    }
    if (!this.watchlistsByAgent.has(targetAgentId)) {
      this.watchlistsByAgent.set(targetAgentId, new Map());
      this.agentToOwner.set(targetAgentId, ownerId);
    }
    this.watchlistsByAgent.get(targetAgentId)!.set(watchlist.id, watchlist);
  }

  /** Deletes a watchlist by its ID. */
  deleteWatchlist(id: string): boolean {
    let deleted = false;
    for (const agentMap of this.watchlistsByAgent.values()) {
      if (agentMap.delete(id)) {
        deleted = true;
      }
    }
    this.targetsByWatchlist.delete(id);
    return deleted;
  }

  /** Upserts a target into a watchlist. */
  upsertTarget(watchlistId: string, target: SpecterTarget): void {
    if (!this.targetsByWatchlist.has(watchlistId)) {
      this.targetsByWatchlist.set(watchlistId, new Map());
    }
    this.targetsByWatchlist.get(watchlistId)!.set(target.id, target);
  }

  /** Deletes a target from a watchlist. */
  deleteTarget(watchlistId: string, targetId: string): boolean {
    const map = this.targetsByWatchlist.get(watchlistId);
    return map ? map.delete(targetId) : false;
  }

  /** Returns all targets across all watchlists (useful for catalog labeling). */
  getAllTargets(): SpecterTarget[] {
    const all: SpecterTarget[] = [];
    for (const map of this.targetsByWatchlist.values()) {
      all.push(...map.values());
    }
    return all;
  }
}
