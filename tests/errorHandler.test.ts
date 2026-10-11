import { describe, it, expect, vi, beforeEach } from "vitest";
import { ZodError } from "zod";
import { ApiError, globalErrorHandler } from "@core/middlewares/errorHandler.js";
import logger from "@core/utils/logger.js";
import { config } from "@core/config.js";

describe("Error Handler Middleware", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("should format ApiError correctly and log client errors as warn", () => {
    const err = new ApiError(404, "Resource not found");
    const req = { originalUrl: "/api/test", method: "GET", ip: "127.0.0.1" } as any;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const next = vi.fn();

    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => logger);
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => logger);

    globalErrorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: "Resource not found",
      }),
    );
    expect(warnSpy).toHaveBeenCalledWith("GET /api/test - 404 Resource not found");
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("should fallback to 500 and log as error with stack for standard errors", () => {
    const err = new Error("Something blew up!");
    const req = { originalUrl: "/api/test", method: "GET", ip: "127.0.0.1" } as any;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const next = vi.fn();

    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => logger);
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => logger);

    globalErrorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: "Something blew up!",
      }),
    );
    expect(errorSpy).toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("should format ZodError with status 400 and log as warn", () => {
    const zodErr = new ZodError([
      {
        code: "invalid_type",
        expected: "string",
        received: "number",
        path: ["email"],
        message: "Expected string, received number",
      },
    ]);
    const req = { originalUrl: "/api/users", method: "POST", ip: "127.0.0.1" } as any;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const next = vi.fn();

    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => logger);

    globalErrorHandler(zodErr, req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: "email: Expected string, received number",
        errors: zodErr.issues,
      }),
    );
    expect(warnSpy).toHaveBeenCalledWith("POST /api/users - 400 email: Expected string, received number");
  });

  it("should mask internal error messages in production for 500 errors", () => {
    const originalIsProduction = config.server.isProduction;
    (config.server as any).isProduction = true;

    try {
      const err = new Error("DB connection pool exhausted password=secret");
      const req = { originalUrl: "/api/test", method: "GET", ip: "127.0.0.1" } as any;
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
      const next = vi.fn();

      vi.spyOn(logger, "error").mockImplementation(() => logger);

      globalErrorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: "An unexpected error occurred",
        }),
      );
    } finally {
      (config.server as any).isProduction = originalIsProduction;
    }
  });

  it("should include metadata in response and log when provided", () => {
    const err = new ApiError(400, "Validation failed", undefined, { field: "username", reason: "taken" });
    const req = { originalUrl: "/api/register", method: "POST", ip: "127.0.0.1" } as any;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const next = vi.fn();

    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => logger);

    globalErrorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: "Validation failed",
        metadata: { field: "username", reason: "taken" },
      }),
    );
    expect(warnSpy).toHaveBeenCalledWith("POST /api/register - 400 Validation failed", {
      metadata: { field: "username", reason: "taken" },
    });
  });
});
