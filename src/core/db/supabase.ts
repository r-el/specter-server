import logger from "@core/utils/logger.js";
/**
 * Supabase Connection Module
 * Manages connection to Supabase for users data
 */
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { config } from "../config.js";

let supabase: SupabaseClient | null = null;

// Validate environment variables - Do not exit process in testing environments
if (!config.database.supabase.url || !config.database.supabase.key) {
  logger.error("✘ Missing Supabase configuration. Please check your env variables.");
  if (config.server.environment !== "test") {
    process.exit(1);
  }
} else {
  // Create Supabase client
  supabase = createClient(config.database.supabase.url, config.database.supabase.key);
}

async function testSupabaseConnection() {
  if (!supabase) return false;
  try {
    // Simple query to test connection
    const { data, error } = await supabase.from("users").select("id").limit(1);

    if (error && error.code !== "PGRST116") {
      // PGRST116 means table doesn't exist yet, which is OK
      throw error;
    }

    logger.info("✔ Supabase connection successful");
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("✘ Supabase connection error:", message);
    return false;
  }
}

function getSupabaseClient() {
  return supabase;
}

export { supabase, testSupabaseConnection, getSupabaseClient };
