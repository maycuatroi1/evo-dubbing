import { eq, asc } from "drizzle-orm";
import { db } from "@/db";
import { dubs, dubSegments } from "@/db/schema";
import { json, error, preflight, hashToken } from "@/lib/http";
import { presignGet, deleteKeys } from "@/lib/r2";

export const runtime = "nodejs";

export function OPTIONS() {
  return preflight();
}

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const dub = await db.query.dubs.findFirst({ where: eq(dubs.id, params.id) });
  if (!dub || dub.status !== "ready") return error("not found", 404);

  const segs = await db.query.dubSegments.findMany({
    where: eq(dubSegments.dubId, dub.id),
    orderBy: [asc(dubSegments.idx)]
  });

  const segments = await Promise.all(
    segs.map(async (s) => ({
      idx: s.idx,
      startMs: s.startMs,
      endMs: s.endMs,
      originalText: s.originalText,
      text: s.text,
      mime: s.mime,
      audioUrl: await presignGet(s.audioKey)
    }))
  );

  return json({
    id: dub.id,
    platform: dub.platform,
    videoId: dub.videoId,
    sourceLang: dub.sourceLang,
    targetLang: dub.targetLang,
    voice: dub.voice,
    provider: dub.provider,
    title: dub.title,
    durationMs: dub.durationMs,
    visibility: dub.visibility,
    segments
  });
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  let body: { ownerToken?: string; visibility?: "public" | "private" };
  try {
    body = (await request.json()) as { ownerToken?: string; visibility?: "public" | "private" };
  } catch {
    return error("invalid json");
  }
  if (!body.ownerToken) return error("missing ownerToken", 401);
  if (body.visibility !== "public" && body.visibility !== "private") return error("invalid visibility");

  const dub = await db.query.dubs.findFirst({ where: eq(dubs.id, params.id) });
  if (!dub) return error("not found", 404);
  if (dub.ownerTokenHash !== hashToken(body.ownerToken)) return error("forbidden", 403);

  await db
    .update(dubs)
    .set({ visibility: body.visibility, updatedAt: new Date() })
    .where(eq(dubs.id, params.id));

  return json({ id: dub.id, visibility: body.visibility });
}

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
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

  const segs = await db.query.dubSegments.findMany({ where: eq(dubSegments.dubId, dub.id) });
  await deleteKeys(segs.map((s) => s.audioKey)).catch(() => undefined);
  await db.delete(dubs).where(eq(dubs.id, params.id));

  return json({ ok: true });
}
