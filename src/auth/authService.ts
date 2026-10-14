import { injectable, inject, delay, container } from "tsyringe";
import crypto from "crypto";
import argon2 from "argon2";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { config } from "@core/config.js";
import { msToSeconds } from "@core/utils/time.js";
import { ApiError } from "@core/middlewares/errorHandler.js";
import { validate } from "@core/validationService.js";
import { createUserSchema, loginUserSchema } from "@users/userSchemas.js";
import { UserService } from "@users/userService.js";
import User from "@users/userModel.js";
import logger from "@core/utils/logger.js";
import { EmailService } from "../services/email/emailService.js";
import { dispatchEmailJob } from "../services/email/emailQueue.js";
import { OtpService } from "./otpService.js";

// Strategies
import type { IAuthStrategy, AuthResult } from "./strategies/IAuthStrategy.js";
import { LocalStrategy } from "./strategies/localStrategy.js";
import { GoogleStrategy } from "./strategies/googleStrategy.js";

const DEFAULT_TOKEN_EXPIRATION = config.auth.jwtExpiresIn;
const JWT_SECRET = config.auth.jwtSecret;

@injectable()
export class AuthService {
  private strategies: Map<string, IAuthStrategy> = new Map();

  constructor(
    @inject(delay(() => UserService)) private userService: UserService,
    @inject(delay(() => OtpService)) private otpService: OtpService,
    @inject(delay(() => LocalStrategy)) private localStrategy?: LocalStrategy,
    @inject(delay(() => GoogleStrategy)) private googleStrategy?: GoogleStrategy,
    private emailService?: EmailService,
  ) {
    if (this.localStrategy?.strategyName) {
      this.strategies.set(this.localStrategy.strategyName, this.localStrategy);
    }
    if (this.googleStrategy?.strategyName) {
      this.strategies.set(this.googleStrategy.strategyName, this.googleStrategy);
    }
    if (!this.emailService) {
      this.emailService = container.resolve(EmailService);
    }
  }

  private getStrategy(name: string): IAuthStrategy {
    let strategy = this.strategies.get(name);
    if (!strategy) {
      if (name === "local") strategy = container.resolve(LocalStrategy);
      if (name === "google") strategy = container.resolve(GoogleStrategy);
      if (strategy) this.strategies.set(name, strategy);
    }
    if (!strategy) {
      throw new ApiError(400, `Authentication strategy '${name}' is not supported`);
    }
    return strategy;
  }

  /**
   * Main entry point for Strategy-based authentication
   */
  async authenticateViaStrategy(strategyName: string, credentials: unknown) {
    const strategy = this.getStrategy(strategyName);

    const authResult = await strategy.authenticate(credentials);

    // Send welcome email if this is a newly created user (e.g. first time Google login)
    if (authResult.isNewUser) {
      dispatchEmailJob({ type: "welcome", toEmail: authResult.email, name: authResult.name }).catch((err) => {
        logger.error("Failed to dispatch welcome email", { error: err });
      });
    }

    const token = this.generateToken(authResult);

    return {
      user: {
        id: authResult.id,
        username: authResult.username,
        name: authResult.name,
        email: authResult.email,
        role: authResult.role,
      },
      token,
    };
  }

  /**
   * Generate JWT token for a user
   */
  generateToken(user: { id: string; username: string; name: string; email: string; role: string }): string {
    const payload = {
      id: user.id,
      username: user.username,
      name: user.name,
      email: user.email,
      role: user.role,
    };

    const expiresIn = DEFAULT_TOKEN_EXPIRATION as jwt.SignOptions["expiresIn"];
    return jwt.sign(payload, JWT_SECRET, { expiresIn });
  }

  /**
   * Register a new user (Local Registration) and send a 6-digit verification email.
   */
  async registerUser(username: string, password: string, name: string, email: string, role: string = "viewer") {
    const validatedData = validate({ username, password, name, email, role }, createUserSchema);

    // Check if user exists
    const existingUser = await this.userService.getUserByUsername(validatedData.username);
    if (existingUser) {
      throw new ApiError(409, "Username already exists");
    }

    // Create user
    const user = await this.userService.createUser(validatedData);

    // Generate token
    const token = this.generateToken({
      id: user.id || "",
      username: user.username || "",
      name: user.name || "",
      email: user.email || "",
      role: user.role || "viewer",
    });

    try {
      await this.otpService.createAndSendOtp(user, token);
    } catch (error) {
      await this.userService.deleteUser(user.id);
      throw new ApiError(503, "Verification email could not be queued. Please try again later.");
    }

    return { user, token, verificationRequired: true };
  }

  /**
   * Verify the 6-digit email code
   */
  async verifyCode(email: string, code: string) {
    const pending = await this.otpService.validateOtp(email, code);

    // Send welcome confirmation email in background
    dispatchEmailJob({ type: "welcome", toEmail: email, name: pending.user.name || "Operator" }).catch(() => {});

    return {
      user: pending.user,
      token: pending.token,
    };
  }

  /**
   * Resend a fresh 6-digit verification code
   */
  async resendVerificationCode(email: string) {
    await this.otpService.resendOtp(email);
    return { success: true, message: "New verification code sent to your email" };
  }

  /**
   * Login user (Legacy Local Login, routes to LocalStrategy)
   */
  async loginUser(username: string, password: string) {
    return this.authenticateViaStrategy("local", { username, password });
  }

  /**
   * Utility for hashing passwords
   */
  static async hashPassword(password: string): Promise<string> {
    if (!password) throw new Error("Password cannot be empty");
    if (typeof password !== "string") throw new Error("Password must be type of string");

    try {
      return await argon2.hash(password);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error("Failed to hash password: " + message);
    }
  }

  /**
   * Utility for verifying a password against a hash
   */
  async verifyPassword(password: string, hash: string): Promise<boolean> {
    if (!password || !hash) return false;
    try {
      if (hash.startsWith("$2a$") || hash.startsWith("$2b$")) {
        return await bcrypt.compare(password, hash);
      }
      return await argon2.verify(hash, password);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("Password verification error: " + message);
      return false;
    }
  }
}
