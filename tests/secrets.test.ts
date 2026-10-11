import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolveSecret } from "../src/core/utils/secrets.js";

describe("resolveSecret", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("returns secret from environment variable when file does not exist", () => {
    process.env.TEST_SECRET_ENV = "my-env-secret-val";
    const result = resolveSecret("non_existent_secret", "TEST_SECRET_ENV", "fallback");
    expect(result).toBe("my-env-secret-val");
  });

  it("returns default value when neither file nor environment variable exists", () => {
    delete process.env.TEST_SECRET_ENV;
    const result = resolveSecret("non_existent_secret", "TEST_SECRET_ENV", "my-default-value");
    expect(result).toBe("my-default-value");
  });

  it("returns secret from Docker secret file when it exists", () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fs, "readFileSync").mockReturnValue("docker-secret-content\n" as unknown as Buffer);

    const result = resolveSecret("jwt_secret", "JWT_SECRET", "fallback");
    expect(result).toBe("docker-secret-content");
  });
});
