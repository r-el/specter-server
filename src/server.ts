/**
 * Express Application Setup
 *
 * Every API route lives under /api so it can be consumed by the separately deployed web client.
 */
import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import * as Sentry from "@sentry/node";
import { nodeProfilingIntegration } from "@sentry/profiling-node";
import { config } from "./core/config.js";
import { globalErrorHandler, NotFoundError } from "./core/middlewares/errorHandler.js";
import { requestLogger } from "./core/middlewares/requestLogger.js";
import { setupSwagger } from "./core/swagger.js";
import apiRouter from "./apiRouter.js";

const app = express();

// Initialize Sentry before routes and other middleware
if (config.server.sentryDsn) {
  Sentry.init({
    dsn: config.server.sentryDsn,
    integrations: [nodeProfilingIntegration()],
    tracesSampleRate: 1.0,
    profilesSampleRate: 1.0,
  });
}

// Security
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    contentSecurityPolicy: {
      directives: {
        // Snapshots are shown from blob URLs, and live video plays through MediaSource blobs.
        "img-src": ["'self'", "data:", "blob:"],
        "media-src": ["'self'", "blob:"],
        "connect-src": ["'self'"],
      },
    },
  }),
);
app.disable("x-powered-by");

// Compression
app.use(compression());

// Request logging
app.use(requestLogger);

// CORS
app.use(cors(config.cors));

// Body parser
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// API routes
app.use("/api", apiRouter);

// Setup Swagger UI
setupSwagger(app);

// Catch-all 404 for any route not handled above
app.use((req, res, next) => next(new NotFoundError(`Route ${req.method} ${req.originalUrl} not found`)));

// Sentry Error Handler - must be before our custom global handler
if (config.server.sentryDsn) {
  Sentry.setupExpressErrorHandler(app);
}

// Global error handling middleware - must be last
app.use(globalErrorHandler);

export default app;
