import { injectable, inject, delay, container } from "tsyringe";
import crypto from "crypto";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import dayjs from "dayjs";
import { config } from "@core/config.js";
import { ApiError } from "@core/middlewares/errorHandler.js";
import { validate } from "@core/validationService.js";
import { createUserSchema, loginUserSchema } from "@users/userSchemas.js";
import { UserService } from "@users/userService.js";
import User from "@users/userModel.js";
import logger from "@core/utils/logger.js";
import { EmailService } from "../services/email/emailService.js";

// Strategies
import type { IAuthStrategy, AuthResult } from "./strategies/IAuthStrategy.js";
import { LocalStrategy } from "./strategies/localStrategy.js";
import { GoogleStrategy } from "./strategies/googleStrategy.js";

const BCRYPT_SALT_ROUNDS = config.auth.bcryptSaltRounds;
const DEFAULT_TOKEN_EXPIRATION = config.auth.jwtExpiresIn;
const JWT_SECRET = config.auth.jwtSecret;

interface PendingVerification {
  code: string;
  expiresAt: number;
  user: User;
  token: string;
}

const verificationStore = new Map<string, PendingVerification>();

@injectable()
export class AuthService {
  private strategies: Map<string, IAuthStrategy> = new Map();

  constructor(
    @inject(delay(() => UserService)) private userService: UserService,
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
    if (authResult.isNewUser && this.emailService) {
      this.emailService.sendWelcomeEmail(authResult.email, authResult.name).catch((err) => {
        logger.error("Failed to send welcome email in background", { error: err });
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

    // Generate real 6-digit verification code
    const code = crypto.randomInt(100000, 1000000).toString();
    verificationStore.set(email.toLowerCase(), {
      code,
      expiresAt: dayjs().add(config.auth.verificationCodeExpiresInMs, "ms").valueOf(),
      user,
      token,
    });

    // Send the verification code before confirming registration.
    const emailSent = await this.emailService.sendVerificationCodeEmail(user.email!, user.name!, code);
    if (!emailSent) {
      verificationStore.delete(email.toLowerCase());
      await this.userService.deleteUser(user.id);
      throw new ApiError(503, "Verification email could not be sent. Please try again later.");
    }

    return { user, token, verificationRequired: true };
  }

  /**
   * Verify the 6-digit email code
   */
  verifyCode(email: string, code: string) {
    const pending = verificationStore.get(email.toLowerCase());
    if (!pending) {
      throw new ApiError(400, "No pending verification found for this email. Please request a new code.");
    }

    if (Date.now() > pending.expiresAt) {
      verificationStore.delete(email.toLowerCase());
      throw new ApiError(400, "Verification code has expired. Please request a new code.");
    }

    if (pending.code !== code.trim()) {
      throw new ApiError(400, "Invalid verification code. Please check your email and try again.");
    }

    // Code verified successfully!
    verificationStore.delete(email.toLowerCase());

    // Send welcome confirmation email in background
    this.emailService.sendWelcomeEmail(email, pending.user.name || "Operator").catch(() => {});

    return {
      user: pending.user,
      token: pending.token,
    };
  }

  /**
   * Resend a fresh 6-digit verification code
   */
  async resendVerificationCode(email: string) {
    const pending = verificationStore.get(email.toLowerCase());
    if (!pending) {
      throw new ApiError(404, "No registration session found for this email");
    }

    const code = crypto.randomInt(100000, 1000000).toString();
    pending.code = code;
    pending.expiresAt = dayjs().add(config.auth.verificationCodeExpiresInMs, "ms").valueOf();

    await this.emailService.sendVerificationCodeEmail(email, pending.user.name || "Operator", code);
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
      return await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
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
      return await bcrypt.compare(password, hash);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("Password verification error: " + message);
      return false;
    }
  }
}
