import { Queue, Worker, Job } from "bullmq";
import { config } from "@core/config.js";
import logger from "@core/utils/logger.js";
import { EmailService } from "./emailService.js";
import { container } from "tsyringe";

export type EmailJobData =
  | { type: "verification"; toEmail: string; name: string; code: string }
  | { type: "welcome"; toEmail: string; name: string };

import { Redis } from "ioredis";

const redisConnection =
  config.cache?.driver === "redis" && config.cache?.redisUrl
    ? new Redis(config.cache.redisUrl, { maxRetriesPerRequest: null })
    : undefined;

// Create Queue if Redis is configured
export const emailQueue = redisConnection
  ? new Queue<EmailJobData>("email-queue", { connection: redisConnection })
  : null;

// Create Worker if Redis is configured
if (redisConnection) {
  new Worker<EmailJobData>(
    "email-queue",
    async (job: Job<EmailJobData>) => {
      const emailService = container.resolve(EmailService);
      const data = job.data;

      switch (data.type) {
        case "verification":
          await emailService.sendVerificationCodeEmail(data.toEmail, data.name, data.code);
          break;
        case "welcome":
          await emailService.sendWelcomeEmail(data.toEmail, data.name);
          break;
        default:
          logger.warn("Unknown email job type", { job });
      }
    },
    { connection: redisConnection },
  ).on("failed", (job, err) => {
    logger.error(`Email job failed`, { jobId: job?.id, error: err.message });
  });
}

/**
 * Dispatch an email job.
 * If Redis is configured, it adds the job to the BullMQ queue.
 * Otherwise, it executes the email sending immediately.
 */
export async function dispatchEmailJob(data: EmailJobData): Promise<void> {
  if (emailQueue) {
    await emailQueue.add(data.type, data, {
      attempts: 3,
      backoff: { type: "exponential", delay: 1000 },
    });
  } else {
    // Fallback to immediate execution if no Redis
    const emailService = container.resolve(EmailService);
    try {
      if (data.type === "verification") {
        await emailService.sendVerificationCodeEmail(data.toEmail, data.name, data.code);
      } else if (data.type === "welcome") {
        await emailService.sendWelcomeEmail(data.toEmail, data.name);
      }
    } catch (err) {
      logger.error("Failed to send email synchronously", { error: err instanceof Error ? err.message : "unknown" });
    }
  }
}
