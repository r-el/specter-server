/**
 * Google OAuth Authentication Strategy
 *
 * Verifies a Google ID token (sent from the client after Google Sign-In)
 * and either finds or creates the corresponding user in our database.
 *
 * Flow:
 * 1. Client performs Google Sign-In → gets an ID token
 * 2. Client sends the ID token to `POST /auth/google`
 * 3. This strategy verifies the token with Google's servers
 * 4. If the user exists (by email) → return them
 * 5. If not → create a new user with Google profile data
 */

import { injectable, inject, delay } from "tsyringe";
import { OAuth2Client } from "google-auth-library";
import { UserService } from "@users/userService.js";
import { ApiError } from "@core/middlewares/errorHandler.js";
import { config } from "@core/config.js";
import logger from "@core/utils/logger.js";
import type { IAuthStrategy, AuthResult } from "./IAuthStrategy.js";

export interface GoogleCredentials {
  idToken: string;
}

@injectable()
export class GoogleStrategy implements IAuthStrategy {
  readonly strategyName = "google";
  private readonly client: OAuth2Client;

  constructor(@inject(delay(() => UserService)) private userService: UserService) {
    this.client = new OAuth2Client(config.google.clientId);
  }

  async authenticate(credentials: unknown): Promise<AuthResult> {
    const { idToken } = this.validateCredentials(credentials);

    // Verify the token with Google
    const payload = await this.verifyGoogleToken(idToken);

    // Find or create user by email
    return this.findOrCreateUser(payload);
  }

  // ── Private helpers ──────────────────────────────────────────

  private validateCredentials(credentials: unknown): GoogleCredentials {
    const creds = credentials as Record<string, unknown>;
    if (!creds?.idToken || typeof creds.idToken !== "string") {
      throw new ApiError(400, "Google ID token is required");
    }
    return { idToken: creds.idToken };
  }

  private async verifyGoogleToken(idToken: string) {
    try {
      const ticket = await this.client.verifyIdToken({
        idToken,
        audience: config.google.clientId,
      });

      const payload = ticket.getPayload();
      if (!payload) {
        throw new ApiError(401, "Invalid Google token payload");
      }

      if (!payload.email_verified) {
        throw new ApiError(401, "Google email not verified");
      }

      return {
        email: payload.email!,
        name: payload.name || payload.email!.split("@")[0],
        picture: payload.picture || null,
        googleId: payload.sub,
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;

      logger.warn("Google token verification failed", {
        error: error instanceof Error ? error.message : "unknown",
      });
      throw new ApiError(401, "Invalid or expired Google token");
    }
  }

  private async findOrCreateUser(profile: {
    email: string;
    name: string;
    picture: string | null;
    googleId: string;
  }): Promise<AuthResult> {
    // Check if a user with this email already exists
    const existingUser = await this.userService.getUserByEmail(profile.email);

    if (existingUser) {
      logger.info("Google auth — existing user", { email: profile.email });
      return {
        id: existingUser.id!,
        username: existingUser.username!,
        name: existingUser.name!,
        email: existingUser.email!,
        role: existingUser.role || "viewer",
        isNewUser: false,
      };
    }

    // Create a new user — generate a username from the email prefix
    const username = this.generateUsername(profile.email);

    logger.info("Google auth — creating new user", {
      email: profile.email,
      username,
    });

    const newUser = await this.userService.createGoogleUser({
      username,
      name: profile.name,
      email: profile.email,
      role: "viewer",
      google_id: profile.googleId,
    });

    return {
      id: newUser.id!,
      username: newUser.username!,
      name: newUser.name!,
      email: newUser.email!,
      role: newUser.role || "viewer",
      isNewUser: true,
    };
  }

  /**
   * Derives a unique-ish username from an email address.
   * E.g. "john.doe@gmail.com" → "john.doe"
   */
  private generateUsername(email: string): string {
    const base = email.split("@")[0].replace(/[^a-zA-Z0-9]/g, "");
    const suffix = Math.floor(Math.random() * 1000)
      .toString()
      .padStart(3, "0");
    return `${base}${suffix}`;
  }
}
