import type { Request, Response } from "express";
import { catchAsync } from "@core/middlewares/errorHandler.js";
import { ApiError } from "@core/middlewares/errorHandler.js";
import { container } from "@core/di.js";
import { CameraService } from "@cameras/cameraService.js";
import { UserService } from "@users/userService.js";
import { authenticateAgent, createAgent, heartbeatAgent, listAgents, revokeAgent } from "./agentService.js";
import type { JwtUser } from "~types/request.js";

type UserRequest = Request & { user: JwtUser };
type AgentParamsRequest = Request<{ agent_id: string }> & { user: JwtUser };
type AgentRequest = Request & { agent: Awaited<ReturnType<typeof authenticateAgent>> };

function bearerToken(req: Request): string {
  const value = req.headers.authorization;
  if (!value?.startsWith("Bearer ")) throw new ApiError(401, "Agent token required");
  const token = value.slice("Bearer ".length).trim();
  if (!token) throw new ApiError(401, "Agent token required");
  return token;
}

export const AgentController = {
  create: catchAsync<UserRequest>(async (req, res) => {
    const result = await createAgent(req.user, req.body.name);
    res.status(201).json({ success: true, data: result });
  }),

  list: catchAsync<UserRequest>(async (req, res) => {
    res.json({ success: true, data: await listAgents(req.user) });
  }),

  revoke: catchAsync<AgentParamsRequest>(async (req, res) => {
    await revokeAgent(req.params.agent_id, req.user);
    res.status(204).send();
  }),

  authenticate: catchAsync<AgentRequest>(async (req, _res, next) => {
    (req as AgentRequest).agent = await authenticateAgent(bearerToken(req));
    next();
  }),

  heartbeat: catchAsync<AgentRequest>(async (req, res) => {
    await heartbeatAgent(req.agent, req.body);
    res.json({
      success: true,
      data: {
        agent_id: req.agent.id,
        owner_id: req.agent.owner_id,
        status: "online",
        received_at: new Date().toISOString(),
      },
    });
  }),

  listCameras: catchAsync<AgentRequest>(async (req, res) => {
    const cameraService = container.resolve(CameraService);
    const userService = container.resolve(UserService);
    const owner = await userService.getUserById(req.agent.owner_id);
    const user = owner ? { id: owner.id, role: owner.role } : { id: req.agent.owner_id, role: "operator" };
    const cameras = await cameraService.listAccessibleCameras(user);
    res.json({
      success: true,
      data: {
        cameras,
      },
    });
  }),

  listWatchlists: catchAsync<AgentRequest>(async (_req, res) => {
    const { WatchlistService } = await import("@watchlists/watchlistService.js");
    const watchlistService = container.resolve(WatchlistService);
    const watchlists = await watchlistService.listWatchlists();
    res.json({
      success: true,
      data: {
        watchlists,
      },
    });
  }),

  listTargets: catchAsync<AgentRequest>(async (req, res) => {
    const id = String(req.params.id);
    const { WatchlistService } = await import("@watchlists/watchlistService.js");
    const watchlistService = container.resolve(WatchlistService);
    const targets = await watchlistService.listTargets(id);
    res.json({
      success: true,
      data: {
        targets,
      },
    });
  }),

  readTargetImage: catchAsync<AgentRequest>(async (req, res) => {
    const id = String(req.params.id);
    const targetId = String(req.params.target_id);
    const imageId = String(req.params.image_id);
    const { Readable } = await import("node:stream");
    const { WatchlistService } = await import("@watchlists/watchlistService.js");
    const watchlistService = container.resolve(WatchlistService);
    const image = await watchlistService.readImage(id, targetId, imageId);
    res.setHeader("Content-Type", image.contentType);
    res.setHeader("Cache-Control", "private, max-age=3600");
    Readable.fromWeb(image.body as import("node:stream/web").ReadableStream).pipe(res);
  }),
};
