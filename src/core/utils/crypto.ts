import argon2 from "argon2";
import { config } from "@core/config.js";

export async function hashPassword(password: string): Promise<string> {
  if (!password) throw new Error("Password cannot be empty");
  if (typeof password !== "string") throw new Error("Password must be type of string");

  try {
    return await argon2.hash(password);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error("Failed to hash password: " + message);
  }
}
