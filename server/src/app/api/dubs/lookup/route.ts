import { and, eq, asc } from "drizzle-orm";
import { db } from "@/db";
import { dubs, dubSegments } from "@/db/schema";
import { json, error, preflight } from "@/lib/http";
import { presignGet } from "@/lib/r2";

export const runtime = "nodejs";

export function OPTIONS() {
  return preflight();
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const platform = url.searchParams.get("platform");
  const videoId = url.searchParams.get("videoId");
  const targetLang = url.searchParams.get("targetLang");
  const voice = url.searchParams.get("voice");
  const provider = url.searchParams.get("provider");

  if (!platform || !videoId || !targetLang || !voice || !provider) {
    return error("missing query parameters");
  }

  const dub = await db.query.dubs.findFirst({
    where: and(
      eq(dubs.platform, platform),
      eq(dubs.videoId, videoId),
      eq(dubs.targetLang, targetLang),
      eq(dubs.voice, voice),
      eq(dubs.provider, provider),
      eq(dubs.status, "ready"),
      eq(dubs.visibility, "public")
    )
  });

  if (!dub) return error("not found", 404);

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
