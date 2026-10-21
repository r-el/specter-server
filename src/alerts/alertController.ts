import { Readable } from "node:stream";
import { Response } from "express";
import { container } from "@core/di.js";
import { catchAsync, ApiError } from "@core/middlewares/errorHandler.js";
import { TypedRequest } from "~types/request.js";
import { AlertService } from "./alertService.js";
import { listAlertsSchema, alertSummarySchema, getAlertSchema, resolveAlertSchema } from "./alertSchemas.js";

const alertService = () => container.resolve(AlertService);

export class AlertController {
  static listAlerts = catchAsync(async (req: TypedRequest<typeof listAlertsSchema>, res: Response) => {
    const { camera_id, ...query } = req.query;
    const page = await alertService().listAlerts({ ...query, camera_ids: camera_id }, req.user);
    res.json({ success: true, data: page });
  });

  static summarizeAlerts = catchAsync(async (req: TypedRequest<typeof alertSummarySchema>, res: Response) => {
    const { camera_id, ...query } = req.query;
    const summary = await alertService().summarizeAlerts({ ...query, camera_ids: camera_id }, req.user);
    res.json({ success: true, data: summary });
  });

  static getAlert = catchAsync(async (req: TypedRequest<typeof getAlertSchema>, res: Response) => {
    res.json({ success: true, data: await alertService().getAlert(req.params.alert_id, req.user) });
  });

  static acknowledgeAlert = catchAsync(async (req: TypedRequest<typeof getAlertSchema>, res: Response) => {
    res.json({ success: true, data: await alertService().acknowledgeAlert(req.params.alert_id, req.user) });
  });

  static resolveAlert = catchAsync(async (req: TypedRequest<typeof resolveAlertSchema>, res: Response) => {
    const alert = await alertService().resolveAlert(req.params.alert_id, req.body.disposition, req.body.note, req.user);
    res.json({ success: true, data: alert });
  });

  static readSnapshot = catchAsync(async (req: TypedRequest<typeof getAlertSchema>, res: Response) => {
    const snapshot = await alertService().readSnapshot(req.params.alert_id, req.user);
    if (!snapshot || !snapshot.body) {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      throw new ApiError(404, `Snapshot for alert ${req.params.alert_id} not found`);
    }
    res.setHeader("Content-Type", snapshot.contentType || "image/jpeg");
    // Faces of real people: never kept by shared caches.
    res.setHeader("Cache-Control", "private, max-age=3600");
    Readable.fromWeb(snapshot.body as import("node:stream/web").ReadableStream).pipe(res);
  });
}
