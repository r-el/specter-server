import { config } from "@core/config.js";
import { supabaseCache } from "./supabaseAdapter.js";
import { redisCache } from "./redisAdapter.js";
import { ICacheService } from "./cache.interface.js";

export const cache: ICacheService = config.cache?.driver === "redis" ? redisCache : supabaseCache;
