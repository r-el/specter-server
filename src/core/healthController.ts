import { Request, Response } from "express";
import { config } from "@core/config.js";
import { container } from "@core/di.js";
import { SPECTER_EVENT_STREAM, SPECTER_HTTP_CLIENT } from "@specter/tokens.js";
import type { SpecterHttpClient } from "@specter/specterHttpClient.js";
import type { SpecterEventStream } from "@specter/specterEventStream.js";

export const healthController = async (req: Request, res: Response) => {
  const specter = container.resolve<SpecterHttpClient>(SPECTER_HTTP_CLIENT);
  const eventStream = container.resolve<SpecterEventStream>(SPECTER_EVENT_STREAM);
  const isSpecterHealthy = await specter.isHealthy();
  const isNatsConnected = eventStream.isConnected;
  const isHealthy = isSpecterHealthy && isNatsConnected;

  res.status(isHealthy ? 200 : 503).json({
    success: isHealthy,
    message: isHealthy ? "Server is healthy" : "Specter is unavailable",
    dependencies: {
      specter: isSpecterHealthy ? "healthy" : "unavailable",
      nats: isNatsConnected ? "connected" : "disconnected",
    },
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: config.server.environment,
  });
};
