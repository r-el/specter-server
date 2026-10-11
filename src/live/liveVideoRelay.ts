/**
 * Live video: short tickets that let a browser open the video WebSocket, and the relay that
 * carries that WebSocket to Specter with the service token.
 *
 * Browsers cannot send an Authorization header on a WebSocket, and Express middleware never runs
 * on an upgrade, so the upgrade handler checks a ticket issued moments before by an authenticated
 * request, and only for a camera the user may see.
 */

import { randomUUID } from "node:crypto";
import type { IncomingMessage, Server as HttpServer } from "node:http";
import type { Duplex } from "node:stream";
import jwt from "jsonwebtoken";
import WebSocket, { WebSocketServer } from "ws";
import { config } from "@core/config.js";
import logger from "@core/utils/logger.js";
import { isSpecterId, SpecterHttpClient } from "@specter/specterHttpClient.js";
import type { SpecterConfig } from "@specter/specterConfig.js";

const TICKET_AUDIENCE = "fa-live";
const TICKET_LIFETIME_SECONDS = 60;
const LIVE_PATH_PATTERN = /^\/api\/cameras\/([^/]+)\/live\/mse$/;
// Close codes a browser can tell apart: the viewer may retry after 1011.
const UPSTREAM_FAILED_CLOSE_CODE = 1011;

interface LiveTicket {
  sub: string;
  camera_id: string;
  jti: string;
}

// Each ticket opens one WebSocket, so a ticket that leaks from a URL cannot be replayed.
const usedTicketIds = new Map<string, number>();

function forgetExpiredTickets(nowSeconds: number): void {
  for (const [ticketId, expiresAt] of usedTicketIds) {
    if (expiresAt < nowSeconds) usedTicketIds.delete(ticketId);
  }
}

export function issueLiveTicket(userId: string, cameraId: string): { ticket: string; expires_in: number } {
  const ticket = jwt.sign({ camera_id: cameraId, jti: randomUUID() }, config.auth.jwtSecret, {
    subject: userId,
    audience: TICKET_AUDIENCE,
    expiresIn: TICKET_LIFETIME_SECONDS,
  });
  return { ticket, expires_in: TICKET_LIFETIME_SECONDS };
}

/** Returns the camera the ticket opens, or null when it is invalid, expired, used or for another camera. */
export function redeemLiveTicket(ticket: string | null, cameraId: string): LiveTicket | null {
  if (!ticket) return null;
  let payload: LiveTicket & { exp: number };
  try {
    payload = jwt.verify(ticket, config.auth.jwtSecret, { audience: TICKET_AUDIENCE }) as LiveTicket & { exp: number };
  } catch {
    return null;
  }
  forgetExpiredTickets(Math.floor(Date.now() / 1000));
  if (payload.camera_id !== cameraId || usedTicketIds.has(payload.jti)) return null;
  usedTicketIds.set(payload.jti, payload.exp);
  return payload;
}

function refuseUpgrade(socket: Duplex, status: string): void {
  socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

function relayMessages(from: WebSocket, to: WebSocket): void {
  // The player asks for the stream as soon as its socket opens, often before Specter's does.
  const pending: Array<[WebSocket.RawData, boolean]> = [];
  to.once("open", () => {
    for (const [data, isBinary] of pending.splice(0)) to.send(data, { binary: isBinary });
  });
  from.on("message", (data, isBinary) => {
    if (to.readyState === WebSocket.OPEN) to.send(data, { binary: isBinary });
    else if (to.readyState === WebSocket.CONNECTING) pending.push([data, isBinary]);
  });
}

function closeCode(code: number): number {
  // 1005 and 1006 are reported locally and may not be sent in a close frame.
  return code === 1005 || code === 1006 ? UPSTREAM_FAILED_CLOSE_CODE : code;
}

/** Relays /api/cameras/{camera_id}/live/mse?ticket=... to Specter's MSE WebSocket. */
export function attachLiveVideoRelay(httpServer: HttpServer, specter: SpecterHttpClient, config: SpecterConfig): void {
  const webSocketServer = new WebSocketServer({ noServer: true });
  const specterWebSocketBase = config.apiUrl.replace(/^http/, "ws");

  httpServer.on("upgrade", async (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(request.url ?? "/", "http://fa.invalid");
    const cameraId = LIVE_PATH_PATTERN.exec(url.pathname)?.[1];
    // Socket.IO handles its own upgrades on the same server.
    if (cameraId === undefined) return;
    if (!isSpecterId(cameraId) || redeemLiveTicket(url.searchParams.get("ticket"), cameraId) === null) {
      refuseUpgrade(socket, "401 Unauthorized");
      return;
    }
    let authorization: string;
    try {
      authorization = await specter.authorizationHeader();
    } catch {
      refuseUpgrade(socket, "503 Service Unavailable");
      return;
    }

    webSocketServer.handleUpgrade(request, socket, head, (viewer) => {
      const upstream = new WebSocket(`${specterWebSocketBase}/owners/${specter.ownerId}/cameras/${cameraId}/live/mse`, {
        headers: { Authorization: authorization },
      });
      relayMessages(viewer, upstream);
      relayMessages(upstream, viewer);
      upstream.on("close", (code, reason) => viewer.close(closeCode(code), reason));
      viewer.on("close", () => upstream.close());
      upstream.on("error", (error) => {
        logger.warn("Live video relay to Specter failed", { cameraId, error: error.message });
        viewer.close(UPSTREAM_FAILED_CLOSE_CODE);
      });
      viewer.on("error", () => upstream.close());
    });
  });
}
