import { Readable } from "node:stream";
import { Response, Router } from "express";
import multer from "multer";
import { container } from "@core/di.js";
import { authenticateToken, requireRole } from "@core/middlewares/authMiddleware.js";
import { ApiError, catchAsync } from "@core/middlewares/errorHandler.js";
import { v } from "@core/middlewares/validateRequest.js";
import { validate } from "@core/validationService.js";
import { TypedRequest } from "~types/request.js";
import { UploadedPhoto, WatchlistService } from "./watchlistService.js";
import {
  createTargetsBody,
  enrollmentBatchSchema,
  imageSchema,
  targetSchema,
  watchlistSchema,
} from "./watchlistSchemas.js";

// Matches Specter's own limits (api.maximum_image_size_mebibytes), so fa refuses the same files.
const MAXIMUM_PHOTO_SIZE_BYTES = 10 * 1024 * 1024;
const MAXIMUM_PHOTOS_PER_REQUEST = 20;
const PHOTO_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAXIMUM_PHOTO_SIZE_BYTES, files: MAXIMUM_PHOTOS_PER_REQUEST },
  fileFilter: (req, file, accept) => {
    if (PHOTO_CONTENT_TYPES.has(file.mimetype)) accept(null, true);
    else accept(new ApiError(400, `${file.originalname} must be a JPEG, PNG or WebP image`));
  },
});
const uploadPhotos = (req, res, next) =>
  upload.array("images", MAXIMUM_PHOTOS_PER_REQUEST)(req, res, (error) => {
    if (error instanceof multer.MulterError) return next(new ApiError(400, error.message));
    next(error);
  });

const watchlistService = () => container.resolve(WatchlistService);

function readPhotos(req: TypedRequest): UploadedPhoto[] {
  const files = Array.isArray(req.files) ? req.files : [];
  return files.map((file) => ({
    fileName: file.originalname,
    contentType: file.mimetype,
    content: file.buffer,
  }));
}

const router = Router();

router.use(authenticateToken, requireRole(["admin", "operator"]));

router.get(
  "/",
  catchAsync(async (req: TypedRequest, res: Response) => {
    try {
      res.json({ success: true, data: await watchlistService().listWatchlists() });
    } catch {
      res.json({ success: true, data: [] });
    }
  }),
);

router.post(
  "/",
  catchAsync(async (req: TypedRequest, res: Response) => {
    res.status(201).json({ success: true, data: await watchlistService().createWatchlist(req.body) });
  }),
);

router.get(
  "/:watchlist_id",
  v(watchlistSchema),
  catchAsync(async (req: TypedRequest<typeof watchlistSchema>, res: Response) => {
    res.json({ success: true, data: await watchlistService().getWatchlist(req.params.watchlist_id) });
  }),
);

router.patch(
  "/:watchlist_id",
  v(watchlistSchema),
  catchAsync(async (req: TypedRequest<typeof watchlistSchema>, res: Response) => {
    res.json({ success: true, data: await watchlistService().updateWatchlist(req.params.watchlist_id, req.body) });
  }),
);

router.delete(
  "/:watchlist_id",
  v(watchlistSchema),
  catchAsync(async (req: TypedRequest<typeof watchlistSchema>, res: Response) => {
    await watchlistService().deleteWatchlist(req.params.watchlist_id);
    res.json({ success: true, message: "Watchlist deleted successfully" });
  }),
);

router.get(
  "/:watchlist_id/targets",
  v(watchlistSchema),
  catchAsync(async (req: TypedRequest<typeof watchlistSchema>, res: Response) => {
    res.json({ success: true, data: await watchlistService().listTargets(req.params.watchlist_id) });
  }),
);

// multipart/form-data: `targets` is a JSON list of {label, metadata, image_file_names}; `images` the photos.
// Body validation stays inline because multer must parse first.
router.post(
  "/:watchlist_id/targets",
  v(watchlistSchema),
  uploadPhotos,
  catchAsync(async (req: TypedRequest<typeof watchlistSchema>, res: Response) => {
    const { targets } = validate(req.body, createTargetsBody);
    const created = await watchlistService().createTargets(req.params.watchlist_id, targets, readPhotos(req));
    res.status(201).json({ success: true, data: created });
  }),
);

router.get(
  "/:watchlist_id/targets/:target_id",
  v(targetSchema),
  catchAsync(async (req: TypedRequest<typeof targetSchema>, res: Response) => {
    res.json({
      success: true,
      data: await watchlistService().getTarget(req.params.watchlist_id, req.params.target_id),
    });
  }),
);

router.patch(
  "/:watchlist_id/targets/:target_id",
  v(targetSchema),
  catchAsync(async (req: TypedRequest<typeof targetSchema>, res: Response) => {
    res.json({
      success: true,
      data: await watchlistService().updateTarget(req.params.watchlist_id, req.params.target_id, req.body),
    });
  }),
);

router.delete(
  "/:watchlist_id/targets/:target_id",
  v(targetSchema),
  catchAsync(async (req: TypedRequest<typeof targetSchema>, res: Response) => {
    await watchlistService().deleteTarget(req.params.watchlist_id, req.params.target_id);
    res.json({ success: true, message: "Target deleted successfully" });
  }),
);

router.post(
  "/:watchlist_id/targets/:target_id/images",
  v(targetSchema),
  uploadPhotos,
  catchAsync(async (req: TypedRequest<typeof targetSchema>, res: Response) => {
    const photos = readPhotos(req);
    if (photos.length === 0) throw new ApiError(400, "At least one image is required");
    res
      .status(201)
      .json({
        success: true,
        data: await watchlistService().addImages(req.params.watchlist_id, req.params.target_id, photos),
      });
  }),
);

router.get(
  "/:watchlist_id/targets/:target_id/images/:image_id",
  v(imageSchema),
  catchAsync(async (req: TypedRequest<typeof imageSchema>, res: Response) => {
    const image = await watchlistService().readImage(
      req.params.watchlist_id,
      req.params.target_id,
      req.params.image_id,
    );
    res.setHeader("Content-Type", image.contentType);
    // Photos of real people: never kept by shared caches.
    res.setHeader("Cache-Control", "private, max-age=3600");
    Readable.fromWeb(image.body as import("node:stream/web").ReadableStream).pipe(res);
  }),
);

router.delete(
  "/:watchlist_id/targets/:target_id/images/:image_id",
  v(imageSchema),
  catchAsync(async (req: TypedRequest<typeof imageSchema>, res: Response) => {
    await watchlistService().deleteImage(req.params.watchlist_id, req.params.target_id, req.params.image_id);
    res.json({ success: true, message: "Image deleted successfully" });
  }),
);

export const enrollmentBatchRoutes = Router();
enrollmentBatchRoutes.use(authenticateToken, requireRole(["admin", "operator"]));
enrollmentBatchRoutes.get(
  "/:enrollment_batch_id",
  v(enrollmentBatchSchema),
  catchAsync(async (req: TypedRequest<typeof enrollmentBatchSchema>, res: Response) => {
    res.json({ success: true, data: await watchlistService().getEnrollmentBatch(req.params.enrollment_batch_id) });
  }),
);

export default router;
