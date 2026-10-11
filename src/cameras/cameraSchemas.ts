import { z } from "zod";
import { isSpecterId } from "@specter/specterHttpClient.js";

export const specterIdSchema = (kind: string) => z.string().refine(isSpecterId, `${kind} ID is not valid`);

const nameSchema = z
  .string()
  .trim()
  .min(1, "Camera name must be at least 1 character")
  .max(100, "Camera name must not exceed 100 characters");

const sourceUrlSchema = z
  .string()
  .trim()
  .min(1, "Source URL must be at least 1 character")
  .max(500, "Source URL must not exceed 500 characters")
  .regex(
    /^(rtsps?|https?):\/\/[^\s]+$|^ffmpeg:[^\s]+$/i,
    "Source URL must be an rtsp, rtsps, http, https or ffmpeg URL",
  );

const credentialsSchema = z.object({
  username: z.string().min(1).max(100),
  password: z.string().min(1).max(200),
});

const locationSchema = z.string().trim().max(200, "Location must not exceed 200 characters");
const watchlistIdsSchema = z.array(specterIdSchema("Watchlist")).max(50);
// COCO class names such as person or car; empty means every class.
const detectionClassesSchema = z.array(z.string().trim().min(1).max(50)).max(80);

const cameraParams = z.object({
  camera_id: specterIdSchema("Camera"),
});

export const getCameraSchema = z.object({
  params: cameraParams,
});

export const createCameraSchema = z.object({
  body: z.object({
    name: nameSchema,
    source_url: sourceUrlSchema,
    credentials: credentialsSchema.optional(),
    location: locationSchema.optional(),
    watchlist_ids: watchlistIdsSchema.default([]),
    detection_classes: detectionClassesSchema.default([]),
  }),
});

export const updateCameraSchema = z.object({
  params: cameraParams,
  body: z
    .object({
      name: nameSchema.optional(),
      source_url: sourceUrlSchema.optional(),
      credentials: credentialsSchema.nullable().optional(),
      location: locationSchema.nullable().optional(),
      watchlist_ids: watchlistIdsSchema.optional(),
      detection_classes: detectionClassesSchema.optional(),
      is_enabled: z.boolean().optional(),
    })
    .refine((data) => Object.keys(data).length > 0, {
      message: "At least one field must be provided for update",
    }),
});

export const assignCameraSchema = z.object({
  params: cameraParams,
  body: z.object({
    user_id: z.string().uuid("User ID must be a valid UUID"),
  }),
});

export const removeCameraAssignmentSchema = z.object({
  params: cameraParams.extend({
    user_id: z.string().uuid("User ID must be a valid UUID"),
  }),
});

export const zoneParamsSchema = z.object({
  params: cameraParams.extend({
    zone_id: specterIdSchema("Zone"),
  }),
});

export const ruleParamsSchema = z.object({
  params: cameraParams.extend({
    rule_id: specterIdSchema("Rule"),
  }),
});

export const cameraIdSchema = getCameraSchema;
export const cameraAssignmentParamsSchema = removeCameraAssignmentSchema;
