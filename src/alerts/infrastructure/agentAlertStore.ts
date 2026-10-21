import { singleton } from "tsyringe";
import type { AlertQuery, AlertSnapshot, AlertSummaryQuery } from "@alerts/domain/alertRepository.js";
import type { SpecterAlert, SpecterAlertPage, SpecterAlertSummary } from "@specter/specterTypes.js";
import { ApiError } from "@core/middlewares/errorHandler.js";
import logger from "@core/utils/logger.js";

const MAX_STORED_ALERTS = 1000;
const MAX_STORED_SNAPSHOTS = 100;

interface StoredSnapshot {
  contentType: string;
  buffer: Buffer;
}

/**
 * In-memory store of alerts and snapshots forwarded by connected Edge Agents.
 */
@singleton()
export class AgentAlertStore {
  private readonly alerts = new Map<string, SpecterAlert>();
  private readonly snapshots = new Map<string, StoredSnapshot>();

  /** Checks if a snapshot exists in memory for this alert ID. */
  hasSnapshot(alertId: string): boolean {
    return this.snapshots.has(alertId);
  }

  /** Saves a snapshot JPEG directly into memory. */
  saveSnapshot(alertId: string, contentType: string, buffer: Buffer): void {
    if (this.snapshots.size >= MAX_STORED_SNAPSHOTS) {
      const oldestSnapKey = this.snapshots.keys().next().value;
      if (oldestSnapKey) this.snapshots.delete(oldestSnapKey);
    }
    this.snapshots.set(alertId, {
      contentType: contentType || "image/jpeg",
      buffer,
    });
  }

  /**
   * Ingests an alert forwarded by an edge agent.
   */
  addAlert(alert: SpecterAlert, snapshotBase64?: string | null): void {
    // If store exceeds max capacity, drop oldest entries
    if (this.alerts.size >= MAX_STORED_ALERTS) {
      const oldestKey = this.alerts.keys().next().value;
      if (oldestKey) {
        this.alerts.delete(oldestKey);
        this.snapshots.delete(oldestKey);
      }
    }

    this.alerts.set(alert.id, alert);

    if (snapshotBase64) {
      try {
        const buffer = Buffer.from(snapshotBase64, "base64");
        if (this.snapshots.size >= MAX_STORED_SNAPSHOTS) {
          const oldestSnapKey = this.snapshots.keys().next().value;
          if (oldestSnapKey) this.snapshots.delete(oldestSnapKey);
        }
        this.snapshots.set(alert.id, {
          contentType: "image/jpeg",
          buffer,
        });
      } catch (err) {
        logger.warn("Failed to decode snapshot base64 for alert", {
          alertId: alert.id,
          error: err,
        });
      }
    }

    logger.info("AgentAlertStore: ingested alert", {
      alertId: alert.id,
      kind: alert.kind,
      cameraId: alert.camera_id,
      hasSnapshot: alert.has_snapshot,
    });
  }

  /**
   * Lists alerts matching filters, newest first.
   */
  list(query: AlertQuery): SpecterAlertPage {
    let all = Array.from(this.alerts.values()).reverse();

    if (query.camera_ids !== undefined) {
      const allowed = new Set(query.camera_ids);
      all = all.filter((a) => allowed.has(a.camera_id));
    }

    if (query.kind) {
      all = all.filter((a) => a.kind === query.kind);
    }

    if (query.disposition) {
      all = all.filter((a) => a.review.disposition === query.disposition);
    }

    if (query.created_since) {
      const since = new Date(query.created_since).getTime();
      all = all.filter((a) => new Date(a.created_at).getTime() >= since);
    }

    if (query.created_until) {
      const until = new Date(query.created_until).getTime();
      all = all.filter((a) => new Date(a.created_at).getTime() <= until);
    }

    let startIndex = 0;
    if (query.cursor) {
      const cursorIdx = all.findIndex((a) => a.id === query.cursor);
      if (cursorIdx !== -1) {
        startIndex = cursorIdx + 1;
      }
    }

    const pageSize = query.limit || 50;
    const pageAlerts = all.slice(startIndex, startIndex + pageSize);
    const nextCursor = startIndex + pageSize < all.length ? (pageAlerts[pageAlerts.length - 1]?.id ?? null) : null;

    return {
      alerts: pageAlerts,
      next_cursor: nextCursor,
    };
  }

  /**
   * Summarizes alert counts for matching cameras.
   */
  summarize(query: AlertSummaryQuery): SpecterAlertSummary {
    let filtered = Array.from(this.alerts.values());

    if (query.camera_ids !== undefined) {
      const allowed = new Set(query.camera_ids);
      filtered = filtered.filter((a) => allowed.has(a.camera_id));
    }

    if (query.created_since) {
      const since = new Date(query.created_since).getTime();
      filtered = filtered.filter((a) => new Date(a.created_at).getTime() >= since);
    }

    if (query.created_until) {
      const until = new Date(query.created_until).getTime();
      filtered = filtered.filter((a) => new Date(a.created_at).getTime() <= until);
    }

    const totalCount = filtered.length;
    const unacknowledgedCount = filtered.filter((a) => !a.review.is_acknowledged).length;

    // Counts grouped by (kind, disposition, is_acknowledged)
    const countMap = new Map<string, { kind: any; disposition: any; is_acknowledged: boolean; count: number }>();
    const dailyMap = new Map<string, { day: string; kind: any; count: number }>();

    for (const a of filtered) {
      const key = `${a.kind}_${a.review.disposition}_${a.review.is_acknowledged}`;
      const existing = countMap.get(key);
      if (existing) {
        existing.count++;
      } else {
        countMap.set(key, {
          kind: a.kind,
          disposition: a.review.disposition,
          is_acknowledged: a.review.is_acknowledged,
          count: 1,
        });
      }

      const dayStr = a.created_at.slice(0, 10);
      const dayKey = `${dayStr}_${a.kind}`;
      const dailyExisting = dailyMap.get(dayKey);
      if (dailyExisting) {
        dailyExisting.count++;
      } else {
        dailyMap.set(dayKey, {
          day: dayStr,
          kind: a.kind,
          count: 1,
        });
      }
    }

    return {
      total_count: totalCount,
      unacknowledged_count: unacknowledgedCount,
      counts: Array.from(countMap.values()) as any,
      daily_counts: Array.from(dailyMap.values()) as any,
    };
  }

  /**
   * Finds an alert by id.
   */
  findById(alertId: string): SpecterAlert | null {
    return this.alerts.get(alertId) ?? null;
  }

  /**
   * Acknowledges an alert.
   */
  acknowledge(alertId: string): SpecterAlert {
    const alert = this.alerts.get(alertId);
    if (!alert) {
      throw new ApiError(404, `Alert ${alertId} not found`);
    }
    alert.review.is_acknowledged = true;
    return alert;
  }

  /**
   * Resolves an alert with verdict and note.
   */
  resolve(alertId: string, disposition: "true_positive" | "false_positive", note?: string): SpecterAlert {
    const alert = this.alerts.get(alertId);
    if (!alert) {
      throw new ApiError(404, `Alert ${alertId} not found`);
    }
    alert.review.disposition = disposition;
    if (note !== undefined) {
      alert.review.note = note;
    }
    return alert;
  }

  /**
   * Reads the stored snapshot JPEG for an alert.
   */
  readSnapshot(alertId: string): AlertSnapshot {
    const snap = this.snapshots.get(alertId);
    if (!snap) {
      throw new ApiError(404, `Snapshot for alert ${alertId} not found`);
    }

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(snap.buffer));
        controller.close();
      },
    });

    return {
      contentType: snap.contentType,
      body: stream,
    };
  }

  /**
   * Clears all stored alerts and snapshots.
   */
  clear(): void {
    this.alerts.clear();
    this.snapshots.clear();
  }
}
