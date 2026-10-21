import { inject, injectable } from "tsyringe";
import type { AlertQuery, AlertRepository, AlertSnapshot, AlertSummaryQuery } from "@alerts/domain/alertRepository.js";
import { SpecterAlertRepository } from "./specterAlertRepository.js";
import { AgentAlertStore } from "./agentAlertStore.js";
import { SpecterHttpClient } from "@specter/specterHttpClient.js";
import { SPECTER_HTTP_CLIENT } from "@specter/tokens.js";
import type { SpecterAlert, SpecterAlertPage, SpecterAlertSummary } from "@specter/specterTypes.js";
import logger from "@core/utils/logger.js";

/**
 * Hybrid Alert Repository:
 * Routes to SpecterAlertRepository when local engine is healthy,
 * otherwise routes to in-memory AgentAlertStore fed by Edge Agents.
 */
@injectable()
export class HybridAlertRepository implements AlertRepository {
  private readonly specterRepo: SpecterAlertRepository;

  constructor(
    @inject(SPECTER_HTTP_CLIENT) private readonly specterClient: SpecterHttpClient,
    @inject(AgentAlertStore) private readonly agentAlertStore: AgentAlertStore,
  ) {
    this.specterRepo = new SpecterAlertRepository(this.specterClient);
  }

  async list(query: AlertQuery): Promise<SpecterAlertPage> {
    try {
      if (await this.specterClient.isHealthy()) {
        return await this.specterRepo.list(query);
      }
    } catch (err) {
      logger.debug("Specter API unavailable for list alerts, falling back to AgentAlertStore", { error: err });
    }
    return this.agentAlertStore.list(query);
  }

  async summarize(query: AlertSummaryQuery): Promise<SpecterAlertSummary> {
    try {
      if (await this.specterClient.isHealthy()) {
        return await this.specterRepo.summarize(query);
      }
    } catch (err) {
      logger.debug("Specter API unavailable for alert summary, falling back to AgentAlertStore", { error: err });
    }
    return this.agentAlertStore.summarize(query);
  }

  async findById(alertId: string): Promise<SpecterAlert | null> {
    try {
      if (await this.specterClient.isHealthy()) {
        return await this.specterRepo.findById(alertId);
      }
    } catch (err) {
      logger.debug("Specter API unavailable for findById alert, falling back to AgentAlertStore", { alertId });
    }
    return this.agentAlertStore.findById(alertId);
  }

  async acknowledge(alertId: string): Promise<SpecterAlert> {
    try {
      if (await this.specterClient.isHealthy()) {
        return await this.specterRepo.acknowledge(alertId);
      }
    } catch (err) {
      logger.debug("Specter API unavailable for acknowledge, falling back to AgentAlertStore", { alertId });
    }
    return this.agentAlertStore.acknowledge(alertId);
  }

  async resolve(
    alertId: string,
    disposition: "true_positive" | "false_positive",
    note?: string,
  ): Promise<SpecterAlert> {
    try {
      if (await this.specterClient.isHealthy()) {
        return await this.specterRepo.resolve(alertId, disposition, note);
      }
    } catch (err) {
      logger.debug("Specter API unavailable for resolve, falling back to AgentAlertStore", { alertId });
    }
    return this.agentAlertStore.resolve(alertId, disposition, note);
  }

  async readSnapshot(alertId: string): Promise<AlertSnapshot> {
    try {
      if (await this.specterClient.isHealthy()) {
        return await this.specterRepo.readSnapshot(alertId);
      }
    } catch (err) {
      logger.debug("Specter API unavailable for readSnapshot, falling back to AgentAlertStore", { alertId });
    }

    if (this.agentAlertStore.hasSnapshot(alertId)) {
      return this.agentAlertStore.readSnapshot(alertId);
    }

    try {
      const { requestAlertSnapshotFromAgent } = await import("@notifications/socketServer.js");
      const fromAgent = await requestAlertSnapshotFromAgent(alertId);
      if (fromAgent) {
        this.agentAlertStore.saveSnapshot(alertId, fromAgent.contentType, fromAgent.buffer);
        return this.agentAlertStore.readSnapshot(alertId);
      }
    } catch (err) {
      logger.warn("Failed to request snapshot on-demand from agent", { alertId, err });
    }

    return this.agentAlertStore.readSnapshot(alertId);
  }
}
