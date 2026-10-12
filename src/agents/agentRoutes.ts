import { Router } from "express";
import { authenticateToken, requireRole } from "@core/middlewares/authMiddleware.js";
import { v } from "@core/middlewares/validateRequest.js";
import { AgentController } from "./agentController.js";
import { agentHeartbeatSchema, agentParamsSchema, createAgentSchema } from "./agentSchemas.js";

const router = Router();
router.use(authenticateToken);
router.post("/", requireRole(["admin", "operator"]), v({ body: createAgentSchema }), AgentController.create);
router.get("/", AgentController.list);
router.delete(
  "/:agent_id",
  requireRole(["admin", "operator"]),
  v({ params: agentParamsSchema }),
  AgentController.revoke,
);

export const agentHeartbeatRoutes = Router();
agentHeartbeatRoutes.post(
  "/heartbeat",
  v({ body: agentHeartbeatSchema }),
  AgentController.authenticate,
  AgentController.heartbeat,
);
agentHeartbeatRoutes.get("/cameras", AgentController.authenticate, AgentController.listCameras);

export default router;
