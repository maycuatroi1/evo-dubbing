import { json } from "@/lib/http";
import { publicSupabaseConfig } from "@/lib/supabase-public";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  const config = publicSupabaseConfig();
  if (!config) return json({ configured: false });
  return json({ configured: true, url: config.url, key: config.key });
}
