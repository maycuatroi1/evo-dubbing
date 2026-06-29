import { json, preflight } from "@/lib/http";

export const runtime = "nodejs";

export function OPTIONS() {
  return preflight();
}

export function GET() {
  return json({ ok: true, service: "evo-dubbing-server" });
}
