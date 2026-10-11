import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { requestLogger } from "@core/middlewares/requestLogger.js";
import logger from "@core/utils/logger.js";

describe("requestLogger middleware", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("logs standard HTTP requests with method, url, status and duration", () => {
    const httpSpy = vi.spyOn(logger, "http").mockImplementation(() => logger);
    const debugSpy = vi.spyOn(logger, "debug").mockImplementation(() => logger);

    const req = { method: "GET", originalUrl: "/api/cameras" } as any;
    const res = new EventEmitter() as any;
    res.statusCode = 200;
    const next = vi.fn();

    requestLogger(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);

    // Simulate response finish
    res.emit("finish");

    expect(httpSpy).toHaveBeenCalledTimes(1);
    expect(httpSpy).toHaveBeenCalledWith(expect.stringMatching(/^GET \/api\/cameras 200 \d+ms$/));
    expect(debugSpy).not.toHaveBeenCalled();
  });

  it("logs health check requests at debug level to avoid spam", () => {
    const httpSpy = vi.spyOn(logger, "http").mockImplementation(() => logger);
    const debugSpy = vi.spyOn(logger, "debug").mockImplementation(() => logger);

    const req = { method: "GET", originalUrl: "/api/health" } as any;
    const res = new EventEmitter() as any;
    res.statusCode = 200;
    const next = vi.fn();

    requestLogger(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);

    res.emit("finish");

    expect(debugSpy).toHaveBeenCalledTimes(1);
    expect(debugSpy).toHaveBeenCalledWith(expect.stringMatching(/^GET \/api\/health 200 \d+ms$/));
    expect(httpSpy).not.toHaveBeenCalled();
  });
});
