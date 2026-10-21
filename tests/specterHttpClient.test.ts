import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isSpecterId, SpecterApiError, SpecterHttpClient } from "@specter/specterHttpClient.js";
import { loadSpecterConfig, type SpecterConfig } from "@specter/specterConfig.js";

const CAMERA_ID = `camera_${"a".repeat(32)}`;

async function buildConfig(token: string): Promise<SpecterConfig> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "fa-specter-"));
  const apiTokenFile = path.join(directory, "api.token");
  await writeFile(apiTokenFile, `${token}\n`);
  return {
    apiUrl: "http://specter.test",
    apiTokenFile,
    natsUrl: "nats://unused",
    ownerId: "specter",
    requestTimeoutMs: 1_000,
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("Specter ids", () => {
  it("accepts only a lowercase prefix and 32 hex digits", () => {
    expect(isSpecterId(CAMERA_ID)).toBe(true);
    expect(isSpecterId("camera_../../owners")).toBe(false);
    expect(isSpecterId(`CAMERA_${"a".repeat(32)}`)).toBe(false);
    expect(isSpecterId(42)).toBe(false);
  });
});

describe("SpecterHttpClient", () => {
  it("sends the service token and returns the data", async () => {
    const config = await buildConfig("service-token");
    const seenAuthorizations: string[] = [];
    const client = new SpecterHttpClient(config, async (request) => {
      seenAuthorizations.push(request.headers.get("Authorization"));
      return jsonResponse(200, [{ id: CAMERA_ID, name: "Gate" }]);
    });

    const cameras = await client.unwrap(
      client.api.GET("/owners/{owner_id}/cameras", { params: { path: { owner_id: "specter" } } }),
    );

    expect(cameras.map((camera) => camera.name)).toEqual(["Gate"]);
    expect(seenAuthorizations).toEqual(["Bearer service-token"]);
  });

  it("reads the token file again once when Specter rejects the token", async () => {
    const config = await buildConfig("old-token");
    const seenAuthorizations: string[] = [];
    const client = new SpecterHttpClient(config, async (request) => {
      seenAuthorizations.push(request.headers.get("Authorization"));
      if (seenAuthorizations.length === 1) await writeFile(config.apiTokenFile, "new-token");
      return request.headers.get("Authorization") === "Bearer new-token"
        ? jsonResponse(200, [])
        : jsonResponse(401, { detail: "invalid token" });
    });

    await client.unwrap(client.api.GET("/owners/{owner_id}/cameras", { params: { path: { owner_id: "specter" } } }));

    expect(seenAuthorizations).toEqual(["Bearer old-token", "Bearer new-token"]);
  });

  it.each([
    [404, 404, "camera x does not exist"],
    [409, 409, "camera x does not exist"],
    [422, 400, "camera x does not exist"],
    [500, 502, "Specter is unavailable"],
  ])("answers Specter's %i with %i", async (specterStatus, clientStatus, message) => {
    const client = new SpecterHttpClient(await buildConfig("token"), async () =>
      jsonResponse(specterStatus, { detail: "camera x does not exist" }),
    );

    const call = client.unwrap(
      client.api.GET("/owners/{owner_id}/cameras/{camera_id}", {
        params: { path: { owner_id: "specter", camera_id: CAMERA_ID } },
      }),
    );

    await expect(call).rejects.toMatchObject({ statusCode: clientStatus, message });
  });

  it("reports an unreachable Specter as unavailable", async () => {
    const client = new SpecterHttpClient(await buildConfig("token"), async () => {
      throw new TypeError("fetch failed");
    });

    const call = client.fetchOwnerResource(`cameras/${CAMERA_ID}/live/frame.jpeg`);

    await expect(call).rejects.toBeInstanceOf(SpecterApiError);
    await expect(call).rejects.toMatchObject({ statusCode: 503 });
  });

  it("checks health, caches the result, and respects clearHealthCache", async () => {
    let callCount = 0;
    const client = new SpecterHttpClient(await buildConfig("token"), async () => {
      callCount += 1;
      return new Response(null, { status: 200 });
    });

    expect(await client.isHealthy()).toBe(true);
    expect(callCount).toBe(1);

    // Second call should return cached result without calling fetch again
    expect(await client.isHealthy()).toBe(true);
    expect(callCount).toBe(1);

    // After clearing cache, it should query health again
    client.clearHealthCache();
    expect(await client.isHealthy()).toBe(true);
    expect(callCount).toBe(2);
  });

  it("returns false quickly when health check fails and caches failure", async () => {
    let callCount = 0;
    const client = new SpecterHttpClient(await buildConfig("token"), async () => {
      callCount += 1;
      throw new Error("Connection refused");
    });

    expect(await client.isHealthy()).toBe(false);
    expect(callCount).toBe(1);

    // Cached failure
    expect(await client.isHealthy()).toBe(false);
    expect(callCount).toBe(1);
  });

  it("throws 503 if the token file cannot be read", async () => {
    const client = new SpecterHttpClient({
      apiUrl: "http://specter.test",
      apiTokenFile: "/non/existent/path/api.token",
      natsUrl: "nats://unused",
      ownerId: "specter",
      requestTimeoutMs: 1_000,
    });

    await expect(client.authorizationHeader()).rejects.toMatchObject({
      statusCode: 503,
      message: "Specter is unavailable",
    });
  });
});

describe("loadSpecterConfig", () => {
  it("loads config with custom environment overrides", () => {
    const config = loadSpecterConfig({
      SPECTER_API_URL: "http://custom-specter:9000/",
      SPECTER_API_TOKEN_FILE: "/custom/token/path",
      SPECTER_NATS_URL: "nats://custom:4222",
      SPECTER_OWNER_ID: "customowner",
      SPECTER_REQUEST_TIMEOUT_MS: "5000",
    });

    expect(config).toEqual({
      apiUrl: "http://custom-specter:9000",
      apiTokenFile: "/custom/token/path",
      natsUrl: "nats://custom:4222",
      ownerId: "customowner",
      requestTimeoutMs: 5000,
    });
  });

  it("loads defaults when environment is empty", () => {
    const config = loadSpecterConfig({});
    expect(config.apiUrl).toBe("http://127.0.0.1:8000");
    expect(config.ownerId).toBe("facealert");
    expect(config.requestTimeoutMs).toBe(10000);
    expect(config.apiTokenFile).toBeTruthy();
  });
});
