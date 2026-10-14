import { injectable } from "tsyringe";
import crypto from "crypto";
import { cache } from "../services/cache/index.js";
import { config } from "@core/config.js";
import { msToSeconds } from "@core/utils/time.js";
import { ApiError } from "@core/middlewares/errorHandler.js";
import { dispatchEmailJob } from "../services/email/emailQueue.js";
import User from "@users/userModel.js";

export interface PendingVerification {
  code: string;
  user: User;
  token: string;
}

@injectable()
export class OtpService {
  /**
   * Generates, caches, and dispatches a verification code for the user.
   */
  async createAndSendOtp(user: User, token: string): Promise<string> {
    const code = crypto.randomInt(100000, 1000000).toString();
    const pendingVerification: PendingVerification = {
      code,
      user,
      token,
    };

    const ttlSeconds = msToSeconds(config.auth.verificationCodeExpiresInMs);
    const cacheKey = this.getCacheKey(user.email!);
    await cache.set(cacheKey, JSON.stringify(pendingVerification), ttlSeconds);

    try {
      await dispatchEmailJob({ type: "verification", toEmail: user.email!, name: user.name!, code });
    } catch (error) {
      await cache.delete(cacheKey);
      throw error;
    }

    return code;
  }

  /**
   * Validates a provided verification code against the cached one.
   */
  async validateOtp(email: string, code: string): Promise<PendingVerification> {
    const cacheKey = this.getCacheKey(email);
    const pendingStr = await cache.get(cacheKey);

    if (!pendingStr) {
      throw new ApiError(400, "No pending verification found or code has expired. Please request a new code.");
    }

    const pending = JSON.parse(pendingStr) as PendingVerification;

    if (pending.code !== code.trim()) {
      throw new ApiError(400, "Invalid verification code. Please check your email and try again.");
    }

    await cache.delete(cacheKey);
    return pending;
  }

  /**
   * Resends a fresh verification code for a pending registration.
   */
  async resendOtp(email: string): Promise<void> {
    const cacheKey = this.getCacheKey(email);
    const pendingStr = await cache.get(cacheKey);

    if (!pendingStr) {
      throw new ApiError(404, "No registration session found or code has expired for this email");
    }

    const pending = JSON.parse(pendingStr) as PendingVerification;
    const code = crypto.randomInt(100000, 1000000).toString();
    pending.code = code;

    const ttlSeconds = msToSeconds(config.auth.verificationCodeExpiresInMs);
    await cache.set(cacheKey, JSON.stringify(pending), ttlSeconds);

    await dispatchEmailJob({ type: "verification", toEmail: email, name: pending.user.name || "Operator", code });
  }

  private getCacheKey(email: string): string {
    return `verification:${email.toLowerCase()}`;
  }
}
