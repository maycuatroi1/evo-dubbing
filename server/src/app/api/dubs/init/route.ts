import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { dubs, dubSegments } from "@/db/schema";
import { json, error, preflight, newOwnerToken, hashToken, maxSegments } from "@/lib/http";
import { presignPut, segmentKey, deleteKeys } from "@/lib/r2";

export const runtime = "nodejs";

interface InitSegment {
  idx: number;
  startMs: number;
  endMs: number;
  originalText?: string;
  text: string;
  mime: string;
}

interface InitBody {
  platform: string;
  videoId: string;
  sourceLang: string;
  targetLang: string;
  voice: string;
  provider: string;
  title?: string;
  durationMs?: number;
  visibility?: "public" | "private";
  segments: InitSegment[];
}

export function OPTIONS() {
  return preflight();
}

export async function POST(request: Request) {
  let body: InitBody;
  try {
    body = (await request.json()) as InitBody;
  } catch {
    return error("invalid json");
  }

  const required = [body.platform, body.videoId, body.sourceLang, body.targetLang, body.voice, body.provider];
  if (required.some((v) => !v)) return error("missing required fields");
  if (!Array.isArray(body.segments) || body.segments.length === 0) return error("no segments");
  if (body.segments.length > maxSegments()) return error("too many segments", 413);

  const existing = await db.query.dubs.findFirst({
    where: and(
      eq(dubs.platform, body.platform),
      eq(dubs.videoId, body.videoId),
      eq(dubs.targetLang, body.targetLang),
      eq(dubs.voice, body.voice),
      eq(dubs.provider, body.provider)
    )
  });

  if (existing) {
    const segs = await db.query.dubSegments.findMany({ where: eq(dubSegments.dubId, existing.id) });
    await deleteKeys(segs.map((s) => s.audioKey)).catch(() => undefined);
    await db.delete(dubs).where(eq(dubs.id, existing.id));
  }

  const ownerToken = newOwnerToken();
  const visibility = body.visibility === "private" ? "private" : "public";

  const [row] = await db
    .insert(dubs)
    .values({
      platform: body.platform,
      videoId: body.videoId,
      sourceLang: body.sourceLang,
      targetLang: body.targetLang,
      voice: body.voice,
      provider: body.provider,
      title: body.title ?? "",
      visibility,
      status: "pending",
      ownerTokenHash: hashToken(ownerToken),
      durationMs: body.durationMs ?? 0,
      segmentCount: body.segments.length
    })
    .returning({ id: dubs.id });

  const dubId = row.id;

  await db.insert(dubSegments).values(
    body.segments.map((s) => ({
      dubId,
      idx: s.idx,
      startMs: s.startMs,
      endMs: s.endMs,
      originalText: s.originalText ?? "",
      text: s.text,
      audioKey: segmentKey(dubId, s.idx),
      mime: s.mime
    }))
  );

  const uploads = await Promise.all(
    body.segments.map(async (s) => ({
      idx: s.idx,
      putUrl: await presignPut(segmentKey(dubId, s.idx), s.mime)
    }))
  );

  return json({ id: dubId, ownerToken, uploads });
}
