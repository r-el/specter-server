/**
 * Express Application Setup
 *
 * Every API route lives under /api so it can be consumed by the separately deployed web client.
 */
import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import { config } from "./core/config.js";
import { globalErrorHandler, NotFoundError } from "./core/middlewares/errorHandler.js";
import { requestLogger } from "./core/middlewares/requestLogger.js";
import { setupSwagger } from "./core/swagger.js";
import apiRouter from "./apiRouter.js";

const app = express();

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

// Global error handling middleware - must be last
app.use(globalErrorHandler);

export default app;
