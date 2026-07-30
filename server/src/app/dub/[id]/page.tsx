import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { DubPlayer } from "./player";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Nghe thử dub - evo-dubbing"
};

interface DubMeta {
  id: string;
  title: string;
  platform: string;
  videoId: string;
  sourceLang: string;
  targetLang: string;
  voice: string;
  provider: string;
  segmentCount: number;
  visibility: string;
  status: string;
}

async function loadDub(id: string): Promise<DubMeta | null> {
  try {
    const { db } = await import("@/db");
    const { dubs } = await import("@/db/schema");
    const dub = await db.query.dubs.findFirst({ where: eq(dubs.id, id) });
    if (!dub) return null;
    return {
      id: dub.id,
      title: dub.title,
      platform: dub.platform,
      videoId: dub.videoId,
      sourceLang: dub.sourceLang,
      targetLang: dub.targetLang,
      voice: dub.voice,
      provider: dub.provider,
      segmentCount: dub.segmentCount,
      visibility: dub.visibility,
      status: dub.status
    };
  } catch {
    return null;
  }
}

export default async function DubPage({ params }: { params: { id: string } }) {
  const dub = await loadDub(params.id);

  if (!dub || dub.status !== "ready") {
    return (
      <main className="wrap wrap--narrow">
        <div className="empty" data-testid="dub-not-found">
          <h1>Không tìm thấy dub</h1>
          <p>Dub này không tồn tại hoặc đã bị gỡ. Quay lại <a href="/library">thư viện</a>.</p>
        </div>
      </main>
    );
  }

  if (dub.visibility !== "public") {
    return (
      <main className="wrap wrap--narrow">
        <div className="empty" data-testid="dub-private">
          <h1>Dub này là private</h1>
          <p>Chỉ chủ sở hữu mới nghe được. Quay lại <a href="/library">thư viện</a>.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="wrap wrap--narrow">
      <h1 className="dub-page-title">{dub.title || dub.videoId}</h1>
      <div className="tags">
        <span className="tag">{dub.platform}</span>
        <span className="tag">
          {dub.sourceLang} to {dub.targetLang}
        </span>
        <span className="tag">
          {dub.provider} / {dub.voice}
        </span>
        <span className="tag">{dub.segmentCount} lines</span>
      </div>
      <p className="evo-note" style={{ margin: "12px 0 20px" }}>
        Giọng đọc do AI tạo ra.{" "}
        <a href={`https://www.youtube.com/watch?v=${dub.videoId}`} target="_blank" rel="noreferrer">
          Mở video gốc trên YouTube
        </a>
      </p>
      <DubPlayer dubId={dub.id} platform={dub.platform} videoId={dub.videoId} />
    </main>
  );
}
