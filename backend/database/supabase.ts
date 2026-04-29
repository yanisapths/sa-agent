import { createClient } from "@supabase/supabase-js";
import { requiredEnv } from "../helpers";

export function getSupabase() {
  const url = requiredEnv("SUPABASE_URL");
  const key = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
