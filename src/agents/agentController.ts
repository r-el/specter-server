import type { Request, Response } from "express";
import { catchAsync } from "@core/middlewares/errorHandler.js";
import { ApiError } from "@core/middlewares/errorHandler.js";
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
};
