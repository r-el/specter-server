import { readFile } from "node:fs/promises";
import createClient, { type Client } from "openapi-fetch";
import type { paths } from "./generated/openapi.js";
import type { SpecterConfig } from "./specterConfig.js";

// Specter ids are a lowercase prefix and 32 hex digits, such as camera_9c1e...; anything else is
// refused before it reaches a URL.
const SPECTER_ID_PATTERN = /^[a-z_]+_[0-9a-f]{32}$/;
const UNAUTHORIZED_STATUS = 401;
const UNAVAILABLE_STATUS = 503;

export function isSpecterId(value: unknown): value is string {
  return typeof value === "string" && SPECTER_ID_PATTERN.test(value);
}

/** A failed call to Specter, carrying the status fa answers its own client with. */
export class SpecterApiError extends Error {
  readonly statusCode: number;

  constructor(
    readonly specterStatus: number,
    detail: string,
  ) {
    super(specterStatus >= 500 || specterStatus === UNAUTHORIZED_STATUS ? "Specter is unavailable" : detail);
    this.name = "SpecterApiError";
    this.statusCode = SpecterApiError.toClientStatus(specterStatus);
  }

  private static toClientStatus(specterStatus: number): number {
    if (specterStatus === 404 || specterStatus === 409) return specterStatus;
    if (specterStatus === 400 || specterStatus === 422) return 400;
    if (specterStatus === UNAVAILABLE_STATUS) return UNAVAILABLE_STATUS;
    // A rejected service token or a Specter bug is fa's problem, not the client's.
    return 502;
  }
}

type FetchImplementation = (request: Request, init?: RequestInit) => Promise<Response>;

function describeErrorBody(body: unknown): string {
  const detail = (body as { detail?: unknown } | undefined)?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail.map((item) => `${(item?.loc ?? []).slice(1).join(".")}: ${item?.msg ?? "invalid"}`).join("; ");
  }
  return "Specter rejected the request";
}

/**
 * Manages TTL-based health check caching and in-flight deduplication
 * for Specter API health probes.
 */
class SpecterHealthMonitor {
  private static readonly HEALTH_TTL_MS = 20_000;
  private static readonly HEALTH_TIMEOUT_MS = 1_500;

  private cachedHealth: { result: boolean; expiresAt: number } | null = null;
  private inFlightHealthCheck: Promise<boolean> | null = null;

  clear(): void {
    this.cachedHealth = null;
    this.inFlightHealthCheck = null;
  }

  async isHealthy(
    apiUrl: string,
    requestTimeoutMs: number,
    fetchImplementation: FetchImplementation,
  ): Promise<boolean> {
    const now = Date.now();
    if (this.cachedHealth && this.cachedHealth.expiresAt > now) {
      return this.cachedHealth.result;
    }
    if (this.inFlightHealthCheck) {
      return this.inFlightHealthCheck;
    }

    this.inFlightHealthCheck = (async () => {
      try {
        const timeout = Math.min(requestTimeoutMs, SpecterHealthMonitor.HEALTH_TIMEOUT_MS);
        const response = await fetchImplementation(new Request(`${apiUrl}/health`), {
          signal: AbortSignal.timeout(timeout),
        });
        const isOk = response.ok;
        this.cachedHealth = { result: isOk, expiresAt: Date.now() + SpecterHealthMonitor.HEALTH_TTL_MS };
        return isOk;
      } catch {
        this.cachedHealth = { result: false, expiresAt: Date.now() + SpecterHealthMonitor.HEALTH_TTL_MS };
        return false;
      } finally {
        this.inFlightHealthCheck = null;
      }
    })();

    return this.inFlightHealthCheck;
  }
}

export class SpecterHttpClient {
  readonly api: Client<paths>;
  readonly ownerId: string;
  private token: string | null = null;
  private readonly healthMonitor = new SpecterHealthMonitor();

  constructor(
    private readonly config: SpecterConfig,
    private readonly fetchImplementation: FetchImplementation = fetch,
  ) {
    this.ownerId = config.ownerId;
    this.api = createClient<paths>({
      baseUrl: config.apiUrl,
      fetch: (request: Request) => this.send(request),
    });
  }

  /** Returns the data of an openapi-fetch call, or throws its error as a SpecterApiError. */
  async unwrap<T>(call: Promise<{ data?: T; error?: unknown; response: Response }>): Promise<T> {
    const { data, error, response } = await call;
    if (error !== undefined || !response.ok) {
      throw new SpecterApiError(response.status, describeErrorBody(error));
    }
    return data as T;
  }

  /**
   * Sends a request whose response is streamed to fa's client as is, such as an image.
   * The path is relative to the owner, and its ids must already be checked with isSpecterId.
   */
  async fetchOwnerResource(ownerRelativePath: string, init: RequestInit = {}): Promise<Response> {
    const url = `${this.config.apiUrl}/owners/${this.ownerId}/${ownerRelativePath}`;
    const response = await this.send(new Request(url, init));
    if (!response.ok) {
      const body = await response.json().catch(() => undefined);
      throw new SpecterApiError(response.status, describeErrorBody(body));
    }
    return response;
  }

  /** Clears the cached health check result (useful in testing). */
  clearHealthCache(): void {
    this.healthMonitor.clear();
  }

  async isHealthy(): Promise<boolean> {
    return this.healthMonitor.isHealthy(this.config.apiUrl, this.config.requestTimeoutMs, this.fetchImplementation);
  }

  async authorizationHeader(): Promise<string> {
    return `Bearer ${await this.readToken(false)}`;
  }

  private async send(request: Request): Promise<Response> {
    // The token file may be replaced while fa runs, so a rejected token is read again once.
    const retryRequest = request.clone();
    const response = await this.sendWithToken(request, false);
    if (response.status !== UNAUTHORIZED_STATUS) return response;
    await response.body?.cancel();
    return this.sendWithToken(retryRequest, true);
  }

  private async sendWithToken(request: Request, isTokenReloaded: boolean): Promise<Response> {
    request.headers.set("Authorization", `Bearer ${await this.readToken(isTokenReloaded)}`);
    try {
      return await this.fetchImplementation(request, {
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(this.config.requestTimeoutMs)]),
      });
    } catch (error) {
      throw new SpecterApiError(UNAVAILABLE_STATUS, `Specter is unreachable: ${error?.message ?? error}`);
    }
  }

  private async readToken(isReloadRequested: boolean): Promise<string> {
    if (this.token === null || isReloadRequested) {
      try {
        this.token = (await readFile(this.config.apiTokenFile, "utf8")).trim();
      } catch {
        throw new SpecterApiError(UNAVAILABLE_STATUS, "the Specter API token file cannot be read");
      }
    }
    return this.token;
  }
}
