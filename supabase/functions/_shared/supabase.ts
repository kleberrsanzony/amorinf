/**
 * Supabase client helper para Edge Functions
 * Usa as variáveis de ambiente built-in do Supabase
 */
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

let _client: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (_client) return _client;

  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !serviceRoleKey) {
    throw new Error("SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não configurados");
  }

  _client = createClient(url, serviceRoleKey, {
    auth: { persistSession: false },
  });

  return _client;
}

// ============================================
// Helpers para tabela de licenças
// ============================================

export interface License {
  key: string;
  active: boolean;
  lifetime: boolean;
  expiry_date: string | null;
  max_uses: number | null;
  uses: number;
  user_name: string;
  activated_device_fingerprint: string | null;
  activated_date: string | null;
  last_access_date: string | null;
  active_session_device: string | null;
  active_session_last_ping: string | null;
  created_at: string;
  updated_at: string;
}

export async function getLicense(key: string): Promise<License | null> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("licenses")
    .select("*")
    .eq("key", key)
    .single();

  if (error || !data) return null;
  return data as License;
}

export async function updateLicense(
  key: string,
  updates: Partial<License>
): Promise<boolean> {
  const client = getSupabaseClient();
  const { error } = await client
    .from("licenses")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("key", key);

  if (error) {
    console.error("[updateLicense] Erro:", error.message);
    return false;
  }
  return true;
}
