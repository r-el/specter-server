import fs from "node:fs";
import path from "node:path";

/**
 * Resolves a secret by checking Docker secret files first, then falling back
 * to an environment variable, and finally to a default value.
 *
 * @param secretName - Filename under /run/secrets/
 * @param envVarName - Name of the environment variable fallback
 * @param defaultValue - Default value if neither source provides one
 */
export function resolveSecret(secretName: string, envVarName: string, defaultValue = ""): string {
  // 1. Try Docker secret file
  const secretPath = path.join("/run/secrets", secretName);
  try {
    if (fs.existsSync(secretPath)) {
      return fs.readFileSync(secretPath, "utf-8").trim();
    }
  } catch {
    // File not accessible — fall through to env var
  }

  // 2. Try environment variable
  const envValue = process.env[envVarName];
  if (envValue) {
    return envValue;
  }

  // 3. Fallback to default
  return defaultValue;
}
