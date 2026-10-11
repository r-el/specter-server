import logger from "@core/utils/logger.js";
import { errorMessage } from "@core/utils/errorMessage.js";

export interface ShutdownOptions {
  timeoutMs?: number;
  onShutdown: () => Promise<void>;
}

/**
 * Sets up SIGTERM and SIGINT listeners to perform a graceful shutdown
 * before terminating the process.
 */
export function setupSignalHandlers(options: ShutdownOptions): void {
  const timeoutMs = options.timeoutMs ?? 10_000;
  let isShuttingDown = false;

  const handleSignal = async (signal: string): Promise<void> => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.info(`${signal} received, shutting down gracefully`);
    setTimeout(() => {
      logger.error("Forced exit: graceful shutdown timed out", { timeoutMs });
      process.exit(1);
    }, timeoutMs).unref();

    try {
      await options.onShutdown();
      logger.info("Graceful shutdown completed");
      process.exit(0);
    } catch (error) {
      logger.error("Error during graceful shutdown", { error: errorMessage(error) });
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => void handleSignal("SIGTERM"));
  process.on("SIGINT", () => void handleSignal("SIGINT"));
}
