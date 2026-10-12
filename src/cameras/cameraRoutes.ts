import { Router } from "express";
import { CameraController } from "./cameraController.js";
import { LiveController } from "@live/liveController.js";
import { authenticateToken, requireRole } from "@core/middlewares/authMiddleware.js";
import { v } from "@core/middlewares/validateRequest.js";
import {
  assignCameraSchema,
  createCameraSchema,
  getCameraSchema,
  removeCameraAssignmentSchema,
  ruleParamsSchema,
  updateCameraSchema,
  zoneParamsSchema,
} from "./cameraSchemas.js";

const router = Router();

// All camera routes require authentication
router.use(authenticateToken);

// Camera CRUD operations (admin and operator only)
router.post("/", requireRole(["admin", "operator"]), v(createCameraSchema), CameraController.createCamera);
router.get("/", CameraController.getCameras); // All authenticated users can view cameras they have access to
router.get("/:camera_id", v(getCameraSchema), CameraController.getCameraById);
router.put("/:camera_id", requireRole(["admin", "operator"]), v(updateCameraSchema), CameraController.updateCamera);
router.delete("/:camera_id", requireRole("admin"), v(getCameraSchema), CameraController.deleteCamera);
router.post("/:camera_id/start", requireRole(["admin", "operator"]), v(getCameraSchema), CameraController.startCamera);
router.post("/:camera_id/stop", requireRole(["admin", "operator"]), v(getCameraSchema), CameraController.stopCamera);

// Camera assignment operations (admin and operator only)
router.post(
  "/:camera_id/assign",
  requireRole(["admin", "operator"]),
  v(assignCameraSchema),
  CameraController.assignCamera,
);
router.delete(
  "/:camera_id/assign/:user_id",
  requireRole(["admin", "operator"]),
  v(removeCameraAssignmentSchema),
  CameraController.removeAssignment,
);
router.get(
  "/:camera_id/assignments",
  requireRole(["admin", "operator"]),
  v(getCameraSchema),
  CameraController.getCameraAssignments,
);

// Zones and rules: everyone who sees the camera reads them; operators of the camera change them.
const manage = requireRole(["admin", "operator"]);
router.get("/:camera_id/zones", v(getCameraSchema), CameraController.listZones);
router.post("/:camera_id/zones", manage, v(getCameraSchema), CameraController.createZone);
router.patch("/:camera_id/zones/:zone_id", manage, v(zoneParamsSchema), CameraController.updateZone);
router.delete("/:camera_id/zones/:zone_id", manage, v(zoneParamsSchema), CameraController.deleteZone);
router.get("/:camera_id/rules", v(getCameraSchema), CameraController.listRules);
router.post("/:camera_id/rules", manage, v(getCameraSchema), CameraController.createRule);
router.patch("/:camera_id/rules/:rule_id", manage, v(ruleParamsSchema), CameraController.updateRule);
router.delete("/:camera_id/rules/:rule_id", manage, v(ruleParamsSchema), CameraController.deleteRule);

// Live video: a JPEG frame, and a ticket for the MSE WebSocket that the upgrade handler relays.
router.get("/:camera_id/live/frame.jpeg", v(getCameraSchema), LiveController.readFrame);
router.post("/:camera_id/live/ticket", v(getCameraSchema), LiveController.issueTicket);
router.get("/:camera_id/live/ice-servers", v(getCameraSchema), LiveController.getIceServers);

export default router;
