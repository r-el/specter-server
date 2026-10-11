import { z } from "zod";

export const createAgentSchema = z.object({
  name: z.string().trim().min(1).max(100),
});

export const agentParamsSchema = z.object({
  agent_id: z.string().uuid("Agent ID must be a valid UUID"),
});

export const agentHeartbeatSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  version: z.string().trim().max(50).optional(),
  cameras: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(100),
        status: z.enum(["running", "stopped", "reconnecting", "error", "unknown"]),
      }),
    )
    .max(100)
    .default([]),
});
