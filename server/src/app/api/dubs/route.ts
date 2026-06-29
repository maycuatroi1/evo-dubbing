import { and, eq, desc } from "drizzle-orm";
import { db } from "@/db";
import { dubs } from "@/db/schema";
import { json, preflight } from "@/lib/http";

export const runtime = "nodejs";

export function OPTIONS() {
  return preflight();
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 100);
  const platform = url.searchParams.get("platform");

  const where = platform
    ? and(eq(dubs.visibility, "public"), eq(dubs.status, "ready"), eq(dubs.platform, platform))
    : and(eq(dubs.visibility, "public"), eq(dubs.status, "ready"));

  const rows = await db
    .select({
      id: dubs.id,
      platform: dubs.platform,
      videoId: dubs.videoId,
      sourceLang: dubs.sourceLang,
      targetLang: dubs.targetLang,
      voice: dubs.voice,
      provider: dubs.provider,
      title: dubs.title,
      durationMs: dubs.durationMs,
      segmentCount: dubs.segmentCount,
      createdAt: dubs.createdAt
    })
    .from(dubs)
    .where(where)
    .orderBy(desc(dubs.createdAt))
    .limit(limit);

  return json({ dubs: rows });
}
