/**
 * Local Authentication Strategy
 *
 * Verifies username + password against the Supabase users table.
 * This is the original login flow, extracted into the Strategy pattern.
 */

import { injectable, inject, delay } from "tsyringe";
import argon2 from "argon2";
import { UserService } from "@users/userService.js";
import { ApiError } from "@core/middlewares/errorHandler.js";
import { validate } from "@core/validationService.js";
import { loginUserSchema } from "@users/userSchemas.js";
import logger from "@core/utils/logger.js";
import type { IAuthStrategy, AuthResult } from "./IAuthStrategy.js";

export interface LocalCredentials {
  username: string;
  password: string;
}

@injectable()
export class LocalStrategy implements IAuthStrategy {
  readonly strategyName = "local";

  constructor(@inject(delay(() => UserService)) private userService: UserService) {}

  async authenticate(credentials: unknown): Promise<AuthResult> {
    const { username, password } = validate(credentials, loginUserSchema) as LocalCredentials;

    const user = await this.userService.getUserByUsername(username);
    if (!user) {
      throw new ApiError(401, "Invalid username or password");
    }

    const isMatch = await argon2.verify(user.password as string, password);
    if (!isMatch) {
      throw new ApiError(401, "Invalid username or password");
    }

    logger.info("Local authentication successful", { username });

    return {
      id: user.id!,
      username: user.username!,
      name: user.name!,
      email: user.email!,
      role: user.role || "viewer",
      isNewUser: false,
    };
  }
}
