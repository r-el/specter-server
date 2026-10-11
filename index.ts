/**
 * 1. Connecting to dbs
 * 2. Starts the server, Socket.IO and the Specter event stream
 */
import "reflect-metadata";
import { testSupabaseConnection } from "@core/db/supabase.js";
import { config } from "@core/config.js";
import { container } from "@core/di.js";
import app from "./src/server.js";
import logger from "@core/utils/logger.js";
import { errorMessage } from "@core/utils/errorMessage.js";
import { closeSocketServer, initializeSocketServer } from "@notifications/socketServer.js";
import { SpecterEventRelay } from "@notifications/specterEventRelay.js";
import { attachLiveVideoRelay } from "@live/liveVideoRelay.js";
import { SPECTER_CATALOG, SPECTER_CONFIG, SPECTER_EVENT_STREAM, SPECTER_HTTP_CLIENT } from "@specter/tokens.js";
import type { SpecterConfig } from "@specter/specterConfig.js";
import type { SpecterHttpClient } from "@specter/specterHttpClient.js";
import type { SpecterEventStream } from "@specter/specterEventStream.js";
import type { SpecterCatalog } from "@specter/specterCatalog.js";

const HOST = config.server.host;
const PORT = config.server.port;
const SHUTDOWN_TIMEOUT_MS = 10_000;

const eventStream = container.resolve<SpecterEventStream>(SPECTER_EVENT_STREAM);
let httpServer: ReturnType<typeof app.listen> | null = null;

// Graceful shutdown handler
async function gracefulShutdown(signal: string): Promise<void> {
  logger.info(`${signal} received, shutting down gracefully`);
  setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MS).unref();
  await eventStream.stop().catch((error) => logger.error("Cannot close NATS", { error: errorMessage(error) }));
  await closeSocketServer();
  await new Promise((resolve) => (httpServer ? httpServer.close(resolve) : resolve(undefined)));
  process.exit(0);
}

// Handle shutdown signals
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// Start server after init dbs
async function startServer(): Promise<void> {
  try {
    logger.info("Starting Specter Server");

    // Test Supabase connection
    console.log("Testing Supabase connection...");
    try {
      const isConnected = await testSupabaseConnection();
      if (isConnected) {
        console.log("✔ Supabase connected successfully");
      } else {
        throw new Error("Supabase connection check returned false");
      }
    } catch (error) {
      console.log("⚠ Supabase connection failed");
      logger.error("Supabase connection failed", { error: errorMessage(error) });
    }

    httpServer = app.listen(PORT, HOST, () => {
      logger.info("Specter server started", { host: HOST, port: PORT, environment: config.server.environment });
    });
    const dispatcher = initializeSocketServer(httpServer);
    attachLiveVideoRelay(
      httpServer,
      container.resolve<SpecterHttpClient>(SPECTER_HTTP_CLIENT),
      container.resolve<SpecterConfig>(SPECTER_CONFIG),
    );

    const catalog = container.resolve<SpecterCatalog>(SPECTER_CATALOG);
    eventStream.onEvent((event) => {
      if (event.kind === "configuration_changed") catalog.invalidate();
    });
    new SpecterEventRelay(eventStream, catalog, dispatcher).start();
    eventStream.start();
  } catch (error) {
    logger.error("Failed to start server", { error: errorMessage(error) });
    process.exit(1);
  }
}

startServer();
