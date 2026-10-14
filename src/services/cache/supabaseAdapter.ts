import { ICacheService } from "./cache.interface.js";
import { supabase } from "@core/db/supabase.js";

export const supabaseCache: ICacheService = {
  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    if (!supabase) throw new Error("Supabase is not initialized");
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    await supabase.from("key_value_store").upsert({ key, value, expires_at: expiresAt });
  },

  async get(key: string): Promise<string | null> {
    if (!supabase) throw new Error("Supabase is not initialized");
    const { data, error } = await supabase
      .from("key_value_store")
      .select("value, expires_at")
      .eq("key", key)
      .maybeSingle();

    if (error || !data) return null;

    if (new Date(data.expires_at) < new Date()) {
      await this.delete(key);
      return null;
    }

    return data.value;
  },

  async delete(key: string): Promise<void> {
    if (!supabase) throw new Error("Supabase is not initialized");
    await supabase.from("key_value_store").delete().eq("key", key);
  },
};
