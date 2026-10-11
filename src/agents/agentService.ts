import { createHash, randomBytes } from "node:crypto";
import { supabase } from "@core/db/supabase.js";
import { ApiError } from "@core/middlewares/errorHandler.js";
import type { JwtUser } from "~types/request.js";

export interface AgentIdentity {
  id: string;
  owner_id: string;
  name: string;
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function requireDatabase() {
  if (!supabase) throw new Error("Database is not configured");
  return supabase;
}

export async function createAgent(owner: JwtUser, name: string) {
  const token = randomBytes(32).toString("base64url");
  const { data, error } = await requireDatabase()
    .from("agents")
    .insert({
      owner_id: owner.id,
      name,
      token_hash: tokenHash(token),
    })
    .select("id, owner_id, name, created_at, last_seen_at, revoked_at")
    .single();

  if (error) throw new Error(`Database error: ${error.message}`);
  return { agent: data, token };
}

export async function listAgents(owner: JwtUser) {
  let query = requireDatabase()
    .from("agents")
    .select("id, owner_id, name, created_at, last_seen_at, revoked_at")
    .order("created_at", { ascending: false });
  if (owner.role !== "admin") query = query.eq("owner_id", owner.id);

  const { data, error } = await query;
  if (error) throw new Error(`Database error: ${error.message}`);
  const onlineAfter = Date.now() - 90_000;
  return (data ?? []).map((agent) => ({
    ...agent,
    status: agent.last_seen_at && Date.parse(agent.last_seen_at) >= onlineAfter ? "online" : "offline",
  }));
}

export async function revokeAgent(agentId: string, owner: JwtUser): Promise<void> {
  let query = requireDatabase().from("agents").update({ revoked_at: new Date().toISOString() }).eq("id", agentId);
  if (owner.role !== "admin") query = query.eq("owner_id", owner.id);
  const { data, error } = await query.select("id").single();
  if (error) {
    if (error.code === "PGRST116") throw new ApiError(404, "Agent not found");
    throw new Error(`Database error: ${error.message}`);
  }
  if (!data) throw new ApiError(404, "Agent not found");
}

export async function authenticateAgent(token: string): Promise<AgentIdentity> {
  const { data, error } = await requireDatabase()
    .from("agents")
    .select("id, owner_id, name")
    .eq("token_hash", tokenHash(token))
    .is("revoked_at", null)
    .single();

  if (error || !data) throw new ApiError(401, "Invalid or revoked agent token");
  return data;
}

export async function heartbeatAgent(agent: AgentIdentity, update: { name?: string; version?: string }): Promise<void> {
  const changes = {
    last_seen_at: new Date().toISOString(),
    ...(update.name ? { name: update.name } : {}),
    ...(update.version ? { version: update.version } : {}),
  };
  const { error } = await requireDatabase().from("agents").update(changes).eq("id", agent.id);
  if (error) throw new Error(`Database error: ${error.message}`);
}
