import { Router } from "express";
import { globalLimiter } from "./core/middlewares/rateLimiter.js";
import { NotFoundError } from "./core/middlewares/errorHandler.js";
import rootRoutes from "./core/rootRoutes.js";
import healthRoutes from "./core/healthRoutes.js";
import authRoutes from "./auth/authRoutes.js";
import userRoutes from "./users/userRoutes.js";
import cameraRoutes from "./cameras/cameraRoutes.js";
import alertRoutes from "./alerts/alertRoutes.js";
import watchlistRoutes, { enrollmentBatchRoutes } from "./watchlists/watchlistRoutes.js";
import dashboardRoutes from "./dashboard/dashboardRoutes.js";
import agentRoutes, { agentHeartbeatRoutes } from "./agents/agentRoutes.js";

const apiRouter = Router();

apiRouter.use(globalLimiter);
apiRouter.use("/", rootRoutes);
apiRouter.use("/", healthRoutes);
apiRouter.use("/auth", authRoutes);
apiRouter.use("/users", userRoutes);
apiRouter.use("/cameras", cameraRoutes);
apiRouter.use("/alerts", alertRoutes);
apiRouter.use("/watchlists", watchlistRoutes);
apiRouter.use("/enrollment-batches", enrollmentBatchRoutes);
apiRouter.use("/dashboard", dashboardRoutes);
apiRouter.use("/agents", agentRoutes);
apiRouter.use("/agent", agentHeartbeatRoutes);

// Catch-all for undefined routes under /api
apiRouter.use((_req, _res, next) => next(new NotFoundError("Not found")));

export default apiRouter;
