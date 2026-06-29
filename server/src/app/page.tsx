import { and, eq, desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

interface PublicDub {
  id: string;
  title: string;
  platform: string;
  videoId: string;
  sourceLang: string;
  targetLang: string;
  voice: string;
  provider: string;
  segmentCount: number;
}

async function loadDubs(): Promise<PublicDub[]> {
  try {
    const { db } = await import("@/db");
    const { dubs } = await import("@/db/schema");
    return await db
      .select({
        id: dubs.id,
        title: dubs.title,
        platform: dubs.platform,
        videoId: dubs.videoId,
        sourceLang: dubs.sourceLang,
        targetLang: dubs.targetLang,
        voice: dubs.voice,
        provider: dubs.provider,
        segmentCount: dubs.segmentCount
      })
      .from(dubs)
      .where(and(eq(dubs.visibility, "public"), eq(dubs.status, "ready")))
      .orderBy(desc(dubs.createdAt))
      .limit(60);
  } catch {
    return [];
  }
}

export default async function Home() {
  const items = await loadDubs();
  return (
    <main className="wrap">
      <div className="hero">
        <div className="logo">E</div>
        <div>
          <h1>evo-dubbing</h1>
        </div>
      </div>
      <p className="sub">Shared dubs created with the evo-dubbing extension. Install it to dub and contribute.</p>

      {items.length === 0 ? (
        <div className="empty">No public dubs yet. Be the first to share one from the extension.</div>
      ) : (
        <div className="grid">
          {items.map((d) => (
            <a key={d.id} className="card" href={`https://www.youtube.com/watch?v=${d.videoId}`} target="_blank">
              <h3>{d.title || d.videoId}</h3>
              <div className="tags">
                <span className="tag">{d.platform}</span>
                <span className="tag">{d.sourceLang} to {d.targetLang}</span>
                <span className="tag">{d.provider} / {d.voice}</span>
                <span className="tag">{d.segmentCount} lines</span>
              </div>
            </a>
          ))}
        </div>
      )}
    </main>
  );
}
