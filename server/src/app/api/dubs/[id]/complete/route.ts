import { eq } from "drizzle-orm";
import { db } from "@/db";
import { dubs } from "@/db/schema";
import { json, error, preflight, hashToken } from "@/lib/http";

export const runtime = "nodejs";

export function OPTIONS() {
  return preflight();
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  let body: { ownerToken?: string };
  try {
    body = (await request.json()) as { ownerToken?: string };
  } catch {
    return error("invalid json");
  }
  if (!body.ownerToken) return error("missing ownerToken", 401);

  const dub = await db.query.dubs.findFirst({ where: eq(dubs.id, params.id) });
  if (!dub) return error("not found", 404);
  if (dub.ownerTokenHash !== hashToken(body.ownerToken)) return error("forbidden", 403);

  await db
    .update(dubs)
    .set({ status: "ready", updatedAt: new Date() })
    .where(eq(dubs.id, params.id));

  return json({ id: dub.id, visibility: dub.visibility });
}
