/**
 * Specter Event Relay
 *
 * Turns Specter's NATS events into fa notifications and sends each one only to the users allowed
 * to see it: camera events to the camera's room, enrollment and configuration to operators and
 * admins. Nothing is stored; a missed notification is still readable through the API.
 */

import logger from "@core/utils/logger.js";
import type { CatalogSnapshot, SpecterCatalog } from "@specter/specterCatalog.js";
import type { SpecterEvent } from "@specter/specterEventParser.js";
import type { SpecterEventStream } from "@specter/specterEventStream.js";
import * as NotificationFactory from "./notificationFactory.js";
import type { NotificationDispatcher } from "./notificationDispatcher.js";

const MANAGER_ROLES = ["admin", "operator"];

const EMPTY_CATALOG: CatalogSnapshot = {
  cameraNames: new Map(),
  watchlists: new Map(),
  targetLabels: new Map(),
};

export class SpecterEventRelay {
  constructor(
    private readonly eventStream: SpecterEventStream,
    private readonly catalog: SpecterCatalog,
    private readonly dispatcher: NotificationDispatcher,
  ) {}

  /** Starts relaying; returns a function that stops it. */
  start(): () => void {
    return this.eventStream.onEvent((event) => this.relay(event));
  }

  async relay(event: SpecterEvent): Promise<void> {
    switch (event.kind) {
      case "match_confirmed":
        this.dispatcher.toCamera(
          event.message.camera_id,
          NotificationFactory.matchAlert(event.message, await this.readCatalog()),
        );
        return;
      case "rule_triggered":
        this.dispatcher.toCamera(
          event.message.camera_id,
          NotificationFactory.ruleAlert(event.message, await this.readCatalog()),
        );
        return;
      case "camera_status_changed":
        this.dispatcher.toCamera(
          event.message.camera_id,
          NotificationFactory.cameraStatus(event.message, await this.readCatalog()),
        );
        return;
      case "enrollment_status_changed":
        this.dispatcher.toRoles(MANAGER_ROLES, NotificationFactory.enrollment(event.message, await this.readCatalog()));
        return;
      case "configuration_changed":
        this.relayConfigurationChange(event.message);
        return;
    }
  }

  private relayConfigurationChange(message: Extract<SpecterEvent, { kind: "configuration_changed" }>["message"]): void {
    const notification = NotificationFactory.configurationChanged(message);
    if (message.entity_kind !== "camera") {
      this.dispatcher.toRoles(MANAGER_ROLES, notification);
      return;
    }
    if (message.change_kind === "created") this.dispatcher.joinCameraByRole("admin", message.entity_id);
    // Viewers of the camera learn about it too, before its room closes on deletion.
    this.dispatcher.toCameraAndRoles(message.entity_id, MANAGER_ROLES, notification);
    if (message.change_kind === "deleted") this.dispatcher.closeCamera(message.entity_id);

    // Forward camera configuration changes to edge agents
    this.dispatcher.toAgents("cameras:updated", {
      change_kind: message.change_kind,
      camera_id: message.entity_id,
    });
  }

  private async readCatalog(): Promise<CatalogSnapshot> {
    try {
      return await this.catalog.read();
    } catch (error) {
      // Names only decorate notifications; an alert must never be held back for them.
      logger.warn("Cannot read Specter names for a notification", { error: error.message });
      return EMPTY_CATALOG;
    }
  }
}
