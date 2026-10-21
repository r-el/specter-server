// Watchlists, their targets and reference photos, kept by Specter. Only operators and admins use them.

import { container, inject, injectable } from "tsyringe";
import { SpecterHttpClient } from "@specter/specterHttpClient.js";
import { SPECTER_HTTP_CLIENT } from "@specter/tokens.js";
import { AgentWatchlistStore } from "./infrastructure/agentWatchlistStore.js";
import type { SpecterTarget, SpecterWatchlist } from "@specter/specterTypes.js";
import { ApiError } from "@core/middlewares/errorHandler.js";
import logger from "@core/utils/logger.js";
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

// Bodies go to Specter unchanged: it validates them and refuses unknown fields.
type SpecterBody = any;

export interface UploadedPhoto {
  fileName: string;
  contentType: string;
  content: Buffer;
}

export interface ReferenceImageFile {
  contentType: string;
  body: ReadableStream<Uint8Array> | null;
}

function buildPhotoForm(photos: UploadedPhoto[], targetsJson?: string): FormData {
  const form = new FormData();
  if (targetsJson !== undefined) form.append("targets", targetsJson);
  for (const photo of photos) {
    form.append("images", new Blob([new Uint8Array(photo.content)], { type: photo.contentType }), photo.fileName);
  }
  return form;
}

@injectable()
export class WatchlistService {
  constructor(
    @inject(SPECTER_HTTP_CLIENT) private readonly specter: SpecterHttpClient,
    @inject(AgentWatchlistStore) private readonly agentStore: AgentWatchlistStore,
  ) {}

  private get owner() {
    return { owner_id: this.specter.ownerId };
  }

  private watchlistPath(watchlistId: string) {
    return { ...this.owner, watchlist_id: watchlistId };
  }

  private targetPath(watchlistId: string, targetId: string) {
    return { ...this.watchlistPath(watchlistId), target_id: targetId };
  }

  async listWatchlists(): Promise<SpecterWatchlist[]> {
    try {
      if (await this.specter.isHealthy()) {
        return await this.specter.unwrap(
          this.specter.api.GET("/owners/{owner_id}/watchlists", { params: { path: this.owner } }),
        );
      }
    } catch (err) {
      logger.debug("Local Specter unavailable for watchlists, reading from AgentWatchlistStore", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return this.agentStore.getWatchlists(this.specter.ownerId);
  }

  async createWatchlist(body: SpecterBody): Promise<SpecterWatchlist> {
    try {
      if (await this.specter.isHealthy()) {
        return await this.specter.unwrap(
          this.specter.api.POST("/owners/{owner_id}/watchlists", { params: { path: this.owner }, body }),
        );
      }
    } catch (err) {
      logger.debug("Local Specter unavailable for createWatchlist, saving to AgentWatchlistStore");
    }

    const id = `watchlist_${Math.random().toString(16).slice(2, 10)}${Date.now().toString(16)}`;
    const newWl: SpecterWatchlist = {
      id,
      name: body.name ?? "New Watchlist",
      kind: body.kind ?? "custom",
      owner_id: this.specter.ownerId,
      target_type: body.target_type ?? "person",
      face_match_threshold_ratio: body.face_match_threshold_ratio ?? 0.6,
      appearance_match_threshold_ratio: body.appearance_match_threshold_ratio ?? 0.7,
      metadata: body.metadata ?? {},
    };
    this.agentStore.upsertWatchlist(this.specter.ownerId, newWl);

    try {
      const dispatcher = getDispatcherSafe();
      dispatcher?.toOwnerAgents(this.specter.ownerId, "agent:watchlist:create", { watchlist: newWl });
      dispatcher?.broadcast({
        kind: "configuration_changed",
        entityKind: "watchlist",
        entityId: id,
        changeKind: "created",
        level: "info",
        timestamp: new Date().toISOString(),
      });
    } catch {
      // non-fatal
    }

    return newWl;
  }

  async getWatchlist(watchlistId: string): Promise<SpecterWatchlist> {
    try {
      if (await this.specter.isHealthy()) {
        return await this.specter.unwrap(
          this.specter.api.GET("/owners/{owner_id}/watchlists/{watchlist_id}", {
            params: { path: this.watchlistPath(watchlistId) },
          }),
        );
      }
    } catch {
      // fallback
    }
    const wl = this.agentStore.getWatchlist(watchlistId);
    if (!wl) throw new ApiError(404, "Watchlist not found");
    return wl;
  }

  async updateWatchlist(watchlistId: string, body: SpecterBody): Promise<SpecterWatchlist> {
    try {
      if (await this.specter.isHealthy()) {
        return await this.specter.unwrap(
          this.specter.api.PATCH("/owners/{owner_id}/watchlists/{watchlist_id}", {
            params: { path: this.watchlistPath(watchlistId) },
            body,
          }),
        );
      }
    } catch {
      // fallback
    }
    const wl = this.agentStore.getWatchlist(watchlistId);
    if (!wl) throw new ApiError(404, "Watchlist not found");
    const updated: SpecterWatchlist = {
      ...wl,
      ...body,
      id: wl.id,
      owner_id: wl.owner_id,
    };
    this.agentStore.upsertWatchlist(wl.owner_id, updated);
    try {
      const dispatcher = getDispatcherSafe();
      dispatcher?.toOwnerAgents(wl.owner_id, "agent:watchlist:update", { watchlistId, changes: body });
      dispatcher?.broadcast({
        kind: "configuration_changed",
        entityKind: "watchlist",
        entityId: watchlistId,
        changeKind: "updated",
        level: "info",
        timestamp: new Date().toISOString(),
      });
    } catch {
      // non-fatal
    }
    return updated;
  }

  async deleteWatchlist(watchlistId: string): Promise<void> {
    try {
      if (await this.specter.isHealthy()) {
        await this.specter.unwrap(
          this.specter.api.DELETE("/owners/{owner_id}/watchlists/{watchlist_id}", {
            params: { path: this.watchlistPath(watchlistId) },
          }),
        );
        return;
      }
    } catch {
      // fallback
    }
    this.agentStore.deleteWatchlist(watchlistId);
    try {
      const dispatcher = getDispatcherSafe();
      dispatcher?.toOwnerAgents(this.specter.ownerId, "agent:watchlist:delete", { watchlistId });
      dispatcher?.broadcast({
        kind: "configuration_changed",
        entityKind: "watchlist",
        entityId: watchlistId,
        changeKind: "deleted",
        level: "info",
        timestamp: new Date().toISOString(),
      });
    } catch {
      // non-fatal
    }
  }

  async listTargets(watchlistId: string): Promise<SpecterTarget[]> {
    try {
      if (await this.specter.isHealthy()) {
        return await this.specter.unwrap(
          this.specter.api.GET("/owners/{owner_id}/watchlists/{watchlist_id}/targets", {
            params: { path: this.watchlistPath(watchlistId) },
          }),
        );
      }
    } catch {
      // fallback
    }
    return this.agentStore.getTargets(watchlistId);
  }

  async createTargets(watchlistId: string, targetsJson: string, photos: UploadedPhoto[]): Promise<SpecterTarget[]> {
    try {
      if (await this.specter.isHealthy()) {
        const response = await this.specter.fetchOwnerResource(`watchlists/${watchlistId}/targets`, {
          method: "POST",
          body: buildPhotoForm(photos, targetsJson),
        });
        return await response.json();
      }
    } catch {
      // fallback
    }
    const specs = JSON.parse(targetsJson || "[]") as Array<{ label: string }>;
    const created: SpecterTarget[] = specs.map((spec) => ({
      id: `target_${Math.random().toString(16).slice(2, 10)}${Date.now().toString(16)}`,
      label: spec.label,
      watchlist_id: watchlistId,
      target_type: "person",
      is_enabled: true,
      enrollment_status: "ready",
      enrollment_batch_id: "",
      metadata: {},
      reference_images: [],
    }));
    for (const t of created) {
      this.agentStore.upsertTarget(watchlistId, t);
    }
    return created;
  }

  async getTarget(watchlistId: string, targetId: string): Promise<SpecterTarget> {
    try {
      if (await this.specter.isHealthy()) {
        return await this.specter.unwrap(
          this.specter.api.GET("/owners/{owner_id}/watchlists/{watchlist_id}/targets/{target_id}", {
            params: { path: this.targetPath(watchlistId, targetId) },
          }),
        );
      }
    } catch {
      // fallback
    }
    const target = this.agentStore.getTarget(watchlistId, targetId);
    if (!target) throw new ApiError(404, "Target not found");
    return target;
  }

  async updateTarget(watchlistId: string, targetId: string, body: SpecterBody): Promise<SpecterTarget> {
    try {
      if (await this.specter.isHealthy()) {
        return await this.specter.unwrap(
          this.specter.api.PATCH("/owners/{owner_id}/watchlists/{watchlist_id}/targets/{target_id}", {
            params: { path: this.targetPath(watchlistId, targetId) },
            body,
          }),
        );
      }
    } catch {
      // fallback
    }
    const target = this.agentStore.getTarget(watchlistId, targetId);
    if (!target) throw new ApiError(404, "Target not found");
    const updated: SpecterTarget = { ...target, ...body, id: target.id, watchlist_id: watchlistId };
    this.agentStore.upsertTarget(watchlistId, updated);
    return updated;
  }

  async deleteTarget(watchlistId: string, targetId: string): Promise<void> {
    try {
      if (await this.specter.isHealthy()) {
        await this.specter.unwrap(
          this.specter.api.DELETE("/owners/{owner_id}/watchlists/{watchlist_id}/targets/{target_id}", {
            params: { path: this.targetPath(watchlistId, targetId) },
          }),
        );
        return;
      }
    } catch {
      // fallback
    }
    this.agentStore.deleteTarget(watchlistId, targetId);
  }

  async addImages(watchlistId: string, targetId: string, photos: UploadedPhoto[]): Promise<SpecterTarget> {
    try {
      if (await this.specter.isHealthy()) {
        const response = await this.specter.fetchOwnerResource(`watchlists/${watchlistId}/targets/${targetId}/images`, {
          method: "POST",
          body: buildPhotoForm(photos),
        });
        return await response.json();
      }
    } catch {
      // fallback
    }
    const target = await this.getTarget(watchlistId, targetId);
    return target;
  }

  async readImage(watchlistId: string, targetId: string, imageId: string): Promise<ReferenceImageFile> {
    try {
      if (await this.specter.isHealthy()) {
        const response = await this.specter.fetchOwnerResource(
          `watchlists/${watchlistId}/targets/${targetId}/images/${imageId}`,
        );
        return { contentType: response.headers.get("Content-Type") ?? "image/jpeg", body: response.body };
      }
    } catch {
      // fallback
    }
    return { contentType: "image/jpeg", body: null };
  }

  async deleteImage(watchlistId: string, targetId: string, imageId: string): Promise<void> {
    try {
      if (await this.specter.isHealthy()) {
        await this.specter.unwrap(
          this.specter.api.DELETE(
            "/owners/{owner_id}/watchlists/{watchlist_id}/targets/{target_id}/images/{image_id}",
            { params: { path: { ...this.targetPath(watchlistId, targetId), image_id: imageId } } },
          ),
        );
        return;
      }
    } catch {
      // fallback
    }
  }

  async getEnrollmentBatch(batchId: string): Promise<SpecterTarget[]> {
    try {
      if (await this.specter.isHealthy()) {
        return await this.specter.unwrap(
          this.specter.api.GET("/owners/{owner_id}/enrollment-batches/{enrollment_batch_id}", {
            params: { path: { ...this.owner, enrollment_batch_id: batchId } },
          }),
        );
      }
    } catch {
      // fallback
    }
    return [];
  }
}
