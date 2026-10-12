/**
 * Notification Types
 *
 * Pure data types for the real-time notification system. They are fa's own shapes: the Specter
 * event relay translates Specter's events into them, so clients never see Specter's contract.
 */

// ---------------------------------------------------------------------------
// Notification severity — drives how the client displays the notification
// ---------------------------------------------------------------------------

export type NotificationLevel = "critical" | "warning" | "info";

// ---------------------------------------------------------------------------
// Notification payloads — each notification kind has its own shape
// ---------------------------------------------------------------------------

/** A new alert; `alertId` is the id to read, review or fetch the snapshot of through the API. */
export interface AlertNotification {
  readonly kind: "alert";
  readonly alertId: string;
  readonly alertKind: "identity_match" | "rule";
  readonly cameraId: string;
  readonly cameraName: string | null;
  readonly targetId: string | null;
  readonly targetLabel: string | null;
  readonly watchlistName: string | null;
  readonly watchlistKind: string | null;
  readonly similarity: number | null;
  readonly ruleKind: "zone_occupancy" | "line_crossing" | null;
  readonly objectClass: string;
  readonly level: NotificationLevel;
  // May answer 404 for a moment, until Specter has stored the alert.
  readonly snapshotUrl: string | null;
  readonly timestamp: string; // ISO 8601
}

export interface CameraStatusNotification {
  readonly kind: "camera_status";
  readonly cameraId: string;
  readonly cameraName: string | null;
  readonly status: "starting" | "running" | "reconnecting" | "stopped" | "failed";
  readonly level: NotificationLevel;
  readonly timestamp: string;
}

/** One photo of a target was enrolled or rejected; only for operators and admins. */
export interface EnrollmentNotification {
  readonly kind: "enrollment";
  readonly targetId: string;
  readonly targetLabel: string | null;
  readonly referenceImageId: string;
  readonly modality: "face" | "appearance";
  readonly status: "pending" | "embedded" | "rejected";
  readonly rejectionReason: string | null;
  readonly level: NotificationLevel;
  readonly timestamp: string;
}

/** Something the client may have cached changed; it should read it again. */
export interface ConfigurationChangedNotification {
  readonly kind: "configuration_changed";
  readonly entityKind: "camera" | "zone" | "rule" | "watchlist" | "target";
  readonly entityId: string;
  readonly changeKind: "created" | "updated" | "deleted";
  readonly level: NotificationLevel;
  readonly timestamp: string;
}

export interface SystemNotification {
  readonly kind: "system";
  readonly message: string;
  readonly level: NotificationLevel;
  readonly timestamp: string;
}

/**
 * Union of every notification the server can push.
 * Adding a new notification kind = adding a new member here + a handler.
 */
export type Notification =
  | AlertNotification
  | CameraStatusNotification
  | EnrollmentNotification
  | ConfigurationChangedNotification
  | SystemNotification;

// ---------------------------------------------------------------------------
// Socket.IO event map — typed contract between server and client
// ---------------------------------------------------------------------------

/** Events the server emits to clients. */
export interface ServerToClientEvents {
  notification: (payload: Notification) => void;
  "camera:subscribed": (cameraIds: string[]) => void;
  "webrtc:answer": (payload: { cameraId: string; sdp: string; correlationId: string }) => void;
  "webrtc:ice_candidate": (payload: { cameraId: string; candidate: unknown; correlationId: string }) => void;
  error: (payload: { message: string }) => void;
}

/** Events the client can emit to the server. */
export interface ClientToServerEvents {
  "subscribe:cameras": (cameraIds: string[]) => void;
  "unsubscribe:cameras": (cameraIds: string[]) => void;
  "webrtc:offer": (payload: { cameraId: string; sdp: string; correlationId: string }) => void;
  "webrtc:ice_candidate": (payload: { cameraId: string; candidate: unknown; correlationId: string }) => void;
}

/** Internal server-side socket data attached to each connection. */
export interface SocketData {
  userId: string;
  username: string;
  role: string;
}

// ---------------------------------------------------------------------------
// Agent Socket.IO event map — contract for Edge Agents (/agent namespace)
// ---------------------------------------------------------------------------

export interface AgentServerToClientEvents {
  "cameras:sync": (payload: { cameras: unknown[] }) => void;
  "cameras:updated": (payload: { change_kind: string; camera_id: string; camera?: unknown }) => void;
  "watchlists:sync": (payload: { watchlists: unknown[] }) => void;
  "agent:heartbeat:ack": (payload: { received_at: string }) => void;
  "webrtc:offer": (payload: { cameraId: string; sdp: string; correlationId: string; clientSocketId: string }) => void;
  "webrtc:ice_candidate": (payload: {
    cameraId: string;
    candidate: unknown;
    correlationId: string;
    clientSocketId: string;
  }) => void;
  error: (payload: { message: string }) => void;
}

export interface AgentClientToServerEvents {
  "agent:heartbeat": (payload?: { name?: string; version?: string }) => void;
  "cameras:request_sync": () => void;
  "watchlists:request_sync": () => void;
  "agent:alert": (payload: unknown) => void;
  "webrtc:answer": (payload: { cameraId: string; sdp: string; correlationId: string; clientSocketId: string }) => void;
  "webrtc:ice_candidate": (payload: {
    cameraId: string;
    candidate: unknown;
    correlationId: string;
    clientSocketId: string;
  }) => void;
}

export interface AgentSocketData {
  agent: {
    id: string;
    owner_id: string;
    name: string;
  };
}
