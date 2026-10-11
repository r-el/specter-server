import bcrypt from "bcrypt";
import { config } from "@core/config.js";

const BCRYPT_SALT_ROUNDS = config.auth.bcryptSaltRounds;

export async function hashPassword(password: string): Promise<string> {
  if (!password) throw new Error("Password cannot be empty");
  if (typeof password !== "string") throw new Error("Password must be type of string");

  try {
    return await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error("Failed to hash password: " + message);
  }
}
