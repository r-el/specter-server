import http from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import WebSocket, { WebSocketServer } from "ws";
import { config } from "@core/config.js";
import { attachLiveVideoRelay, issueLiveTicket, redeemLiveTicket } from "@live/liveVideoRelay.js";
import { SpecterHttpClient } from "@specter/specterHttpClient.js";

const CAMERA_ID = `camera_${"1".repeat(32)}`;
const OTHER_CAMERA_ID = `camera_${"2".repeat(32)}`;
const closers: Array<() => void> = [];

beforeAll(() => {
  config.auth.jwtSecret = "test-jwt-secret";
});

afterEach(() => {
  for (const close of closers.splice(0)) close();
});

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)));
}

/** A fake Specter that records the Authorization header and echoes every message back. */
async function startRelayWithFakeSpecter() {
  const specterServer = http.createServer();
  const seenAuthorizations: string[] = [];
  const specterSockets = new WebSocketServer({ server: specterServer });
  specterSockets.on("connection", (socket, request) => {
    seenAuthorizations.push(request.headers.authorization);
    socket.on("message", (data, isBinary) => socket.send(data, { binary: isBinary }));
  });
  const specterPort = await listen(specterServer);

  const directory = await mkdtemp(path.join(os.tmpdir(), "fa-live-"));
  const apiTokenFile = path.join(directory, "api.token");
  await writeFile(apiTokenFile, "service-token");
  const config = {
    apiUrl: `http://127.0.0.1:${specterPort}`,
    apiTokenFile,
    natsUrl: "nats://unused",
    ownerId: "specter",
    requestTimeoutMs: 1_000,
  };
  const faServer = http.createServer();
  attachLiveVideoRelay(faServer, new SpecterHttpClient(config), config);
  const faPort = await listen(faServer);
  closers.push(() => {
    specterSockets.close();
    specterServer.close();
    faServer.close();
  });
  return { faPort, seenAuthorizations };
}

describe("live tickets", () => {
  it("open one socket for one camera only", () => {
    const { ticket } = issueLiveTicket("user-1", CAMERA_ID);
    const otherTicket = issueLiveTicket("user-1", CAMERA_ID).ticket;

    expect(redeemLiveTicket(otherTicket, OTHER_CAMERA_ID)).toBeNull();
    expect(redeemLiveTicket(ticket, CAMERA_ID)).toMatchObject({ sub: "user-1", camera_id: CAMERA_ID });
    expect(redeemLiveTicket(ticket, CAMERA_ID)).toBeNull();
  });

  it("refuse an access token used as a ticket", async () => {
    const { default: jwt } = await import("jsonwebtoken");
    const accessToken = jwt.sign({ id: "user-1", role: "admin" }, config.auth.jwtSecret);

    expect(redeemLiveTicket(accessToken, CAMERA_ID)).toBeNull();
  });
});

describe("live video relay", () => {
  it("relays messages to Specter with the service token, including ones sent before it answers", async () => {
    const { faPort, seenAuthorizations } = await startRelayWithFakeSpecter();
    const { ticket } = issueLiveTicket("user-1", CAMERA_ID);
    const viewer = new WebSocket(`ws://127.0.0.1:${faPort}/api/cameras/${CAMERA_ID}/live/mse?ticket=${ticket}`);

    const echoed = await new Promise<string>((resolve, reject) => {
      viewer.on("open", () => viewer.send(JSON.stringify({ type: "mse", value: "avc1" })));
      viewer.on("message", (data) => resolve(data.toString()));
      viewer.on("error", reject);
    });
    viewer.close();

    expect(JSON.parse(echoed)).toEqual({ type: "mse", value: "avc1" });
    expect(seenAuthorizations).toEqual(["Bearer service-token"]);
  });

  it("refuses an upgrade without a valid ticket", async () => {
    const { faPort, seenAuthorizations } = await startRelayWithFakeSpecter();
    const viewer = new WebSocket(`ws://127.0.0.1:${faPort}/api/cameras/${CAMERA_ID}/live/mse?ticket=forged`);

    const statusCode = await new Promise<number>((resolve) => {
      viewer.on("unexpected-response", (request, response) => resolve(response.statusCode));
      viewer.on("error", () => undefined);
    });

    expect(statusCode).toBe(401);
    expect(seenAuthorizations).toEqual([]);
  });
});
