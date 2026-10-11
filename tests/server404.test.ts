import { describe, it, expect, vi } from "vitest";
import { NotFoundError, globalErrorHandler } from "@core/middlewares/errorHandler.js";

describe("Catch-all 404 behavior", () => {
  it("formats unhandled route errors as 404 JSON", () => {
    const error = new NotFoundError("Route GET /nonexistent not found");
    const req = { originalUrl: "/nonexistent", method: "GET", ip: "127.0.0.1" } as any;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const next = vi.fn();

    globalErrorHandler(error, req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: "Route GET /nonexistent not found",
      }),
    );
  });
});
