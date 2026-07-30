import type { Metadata } from "next";
import { and, eq, desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "evo-dubbing - Nghe video YouTube tiếng Anh bằng giọng Việt",
  description:
    "Extension Chrome đọc phụ đề video YouTube, dịch sang tiếng Việt và phát giọng đọc AI cùng video đang chạy. Dùng thử 15 phút miễn phí, gói 199.000 VND cho 300 phút trong 30 ngày.",
  openGraph: {
    title: "evo-dubbing - Nghe video YouTube tiếng Anh bằng giọng Việt",
    description:
      "Dịch và lồng tiếng Việt cho video YouTube ngay trong trình duyệt. BYOK miễn phí, managed 199.000 VND / 300 phút / 30 ngày.",
    locale: "vi_VN",
    type: "website"
  }
};

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
      .limit(6);
  } catch {
    return [];
  }
}

export default async function Home() {
  const items = await loadDubs();
  return (
    <main>
      <section className="landing-hero">
        <div className="wrap landing-hero-inner">
          <span className="evo-logo landing-hero-logo" aria-hidden="true" />
          <h1>Nghe video YouTube tiếng Anh bằng giọng Việt</h1>
          <p className="landing-hero-sub">
            evo-dubbing đọc phụ đề video bạn đang xem, dịch sang tiếng Việt và phát giọng đọc cùng
            video - không cần tải về, không chuyển tab.
          </p>
          <div className="landing-cta">
            <a
              className="evo-btn evo-btn--solid"
              href="https://github.com/maycuatroi1/evo-dubbing/releases"
              target="_blank"
              rel="noreferrer"
            >
              Cài extension
            </a>
            <a className="evo-btn evo-btn--outline" href="/library">
              Xem thư viện
            </a>
          </div>
        </div>
      </section>

      <section className="wrap">
        <h2 className="section-title">Cách hoạt động</h2>
        <div className="grid">
          <div className="card">
            <h3>1. Cài extension</h3>
            <p className="card-text">
              Thêm evo-dubbing vào Chrome hoặc Edge, mở một video YouTube tiếng Anh bất kỳ có phụ đề.
            </p>
          </div>
          <div className="card">
            <h3>2. Bấm Dub</h3>
            <p className="card-text">
              Extension đọc phụ đề, dịch từng câu sang tiếng Việt và tạo giọng đọc cho từng câu.
            </p>
          </div>
          <div className="card">
            <h3>3. Nghe cùng video</h3>
            <p className="card-text">
              Giọng Việt phát đồng bộ với video, tự nhỏ tiếng gốc khi đọc. Tua tới đâu nghe tới đó.
            </p>
          </div>
        </div>
      </section>

      <section className="wrap" id="pricing">
        <h2 className="section-title">Bảng giá</h2>
        <div className="grid">
          <div className="card price-card">
            <h3>BYOK</h3>
            <p className="price">Miễn phí</p>
            <p className="card-text">
              Dùng API key của chính bạn (OpenAI hoặc Google Gemini). Không cần tài khoản, không giới
              hạn, extension gọi thẳng tới provider.
            </p>
          </div>
          <div className="card price-card">
            <h3>Dùng thử</h3>
            <p className="price">15 phút miễn phí</p>
            <p className="card-text">
              Đăng nhập Google là có ngay 15 phút nguồn managed. Cấp một lần duy nhất cho mỗi tài
              khoản, không cấp lại.
            </p>
          </div>
          <div className="card price-card">
            <h3>Managed</h3>
            <p className="price">199.000 VND</p>
            <p className="card-text">
              300 phút nguồn trong 30 ngày, không cần API key. Gia hạn thủ công qua PayOS khi hết;
              quota chưa dùng không cộng dồn sang kỳ sau.
            </p>
          </div>
        </div>
        <p className="evo-note pricing-note">
          Giọng đọc do AI tạo ra. Thời lượng tính theo phút nguồn của video, chỉ trừ khi tạo giọng
          thành công; nghe lại và nội dung có sẵn trong thư viện luôn miễn phí.
        </p>
      </section>

      <section className="wrap">
        <div className="section-head">
          <h2 className="section-title">Dub mới nhất từ cộng đồng</h2>
          <a className="evo-btn evo-btn--ghost evo-btn--sm" href="/library">
            Xem tất cả
          </a>
        </div>
        {items.length === 0 ? (
          <div className="empty">Chưa có public dub nào. Hãy là người đầu tiên chia sẻ từ extension.</div>
        ) : (
          <div className="grid">
            {items.map((d) => (
              <a
                key={d.id}
                className="card"
                href={`https://www.youtube.com/watch?v=${d.videoId}`}
                target="_blank"
                rel="noreferrer"
              >
                <h3>{d.title || d.videoId}</h3>
                <div className="tags">
                  <span className="tag">{d.platform}</span>
                  <span className="tag">
                    {d.sourceLang} to {d.targetLang}
                  </span>
                  <span className="tag">
                    {d.provider} / {d.voice}
                  </span>
                  <span className="tag">{d.segmentCount} lines</span>
                </div>
              </a>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
