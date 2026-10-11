import { describe, it, expect } from "vitest";
import {
  ApiError,
  BadRequestError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  BadGatewayError,
} from "../src/core/utils/errors.js";

describe("HTTP Error Classes", () => {
  it("creates ApiError with custom status and message", () => {
    const error = new ApiError(418, "I'm a teapot", ["err1", "err2"]);
    expect(error.statusCode).toBe(418);
    expect(error.message).toBe("I'm a teapot");
    expect(error.errors).toEqual(["err1", "err2"]);
    expect(error.name).toBe("ApiError");
    expect(error).toBeInstanceOf(Error);
  });

  it("creates BadRequestError with status 400", () => {
    const error = new BadRequestError("Invalid payload");
    expect(error.statusCode).toBe(400);
    expect(error.message).toBe("Invalid payload");
    expect(error.name).toBe("BadRequestError");
    expect(error).toBeInstanceOf(ApiError);
  });

  it("creates ValidationError with status 400 and messages", () => {
    const error = new ValidationError("Validation failed", ["Name required"]);
    expect(error.statusCode).toBe(400);
    expect(error.message).toBe("Validation failed");
    expect(error.errors).toEqual(["Name required"]);
    expect(error.name).toBe("ValidationError");
  });

  it("creates UnauthorizedError with status 401", () => {
    const error = new UnauthorizedError();
    expect(error.statusCode).toBe(401);
    expect(error.message).toBe("Unauthorized");
    expect(error.name).toBe("UnauthorizedError");
  });

  it("creates ForbiddenError with status 403", () => {
    const error = new ForbiddenError("Permission denied");
    expect(error.statusCode).toBe(403);
    expect(error.message).toBe("Permission denied");
    expect(error.name).toBe("ForbiddenError");
  });

  it("creates NotFoundError with status 404", () => {
    const error = new NotFoundError("Camera not found");
    expect(error.statusCode).toBe(404);
    expect(error.message).toBe("Camera not found");
    expect(error.name).toBe("NotFoundError");
  });

  it("creates ConflictError with status 409", () => {
    const error = new ConflictError("User already exists");
    expect(error.statusCode).toBe(409);
    expect(error.message).toBe("User already exists");
    expect(error.name).toBe("ConflictError");
  });

  it("creates BadGatewayError with status 502", () => {
    const error = new BadGatewayError();
    expect(error.statusCode).toBe(502);
    expect(error.message).toBe("Bad gateway — upstream service error");
    expect(error.name).toBe("BadGatewayError");
  });
});
