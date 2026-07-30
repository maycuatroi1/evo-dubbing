import type { Metadata } from "next";
import { and, eq, desc, ilike, or } from "drizzle-orm";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Thư viện dub - evo-dubbing",
  description: "Tìm và nghe thử các bản dub tiếng Việt do cộng đồng evo-dubbing chia sẻ."
};

const PAGE_SIZE = 20;

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

async function loadLangs(): Promise<string[]> {
  try {
    const { db } = await import("@/db");
    const { dubs } = await import("@/db/schema");
    const rows = await db
      .selectDistinct({ lang: dubs.targetLang })
      .from(dubs)
      .where(and(eq(dubs.visibility, "public"), eq(dubs.status, "ready")));
    return rows.map((row) => row.lang).sort();
  } catch {
    return [];
  }
}

async function loadDubs(q: string, lang: string, page: number): Promise<{ items: PublicDub[]; hasMore: boolean }> {
  try {
    const { db } = await import("@/db");
    const { dubs } = await import("@/db/schema");
    const conditions = [eq(dubs.visibility, "public"), eq(dubs.status, "ready")];
    if (q) {
      conditions.push(ilike(dubs.title, `%${q}%`));
    }
    if (lang) {
      const langMatch = or(eq(dubs.sourceLang, lang), eq(dubs.targetLang, lang));
      if (langMatch) {
        conditions.push(langMatch);
      }
    }
    const rows = await db
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
      .where(and(...conditions))
      .orderBy(desc(dubs.createdAt), desc(dubs.id))
      .limit(PAGE_SIZE + 1)
      .offset((page - 1) * PAGE_SIZE);
    return { items: rows.slice(0, PAGE_SIZE), hasMore: rows.length > PAGE_SIZE };
  } catch {
    return { items: [], hasMore: false };
  }
}

function pageHref(page: number, q: string, lang: string): string {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (lang) params.set("lang", lang);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `/library?${qs}` : "/library";
}

export default async function LibraryPage({
  searchParams
}: {
  searchParams: { q?: string; lang?: string; page?: string };
}) {
  const q = (searchParams.q ?? "").trim().slice(0, 120);
  const lang = (searchParams.lang ?? "").trim().slice(0, 16);
  const page = Math.max(1, Number.parseInt(searchParams.page ?? "1", 10) || 1);
  const [{ items, hasMore }, langs] = await Promise.all([loadDubs(q, lang, page), loadLangs()]);

  return (
    <main className="wrap">
      <h1>Thư viện dub</h1>
      <p className="sub">
        Các bản dub công khai do cộng đồng chia sẻ. Nghe thử trực tiếp hoặc mở video gốc trên
        YouTube. Giọng đọc do AI tạo ra.
      </p>

      <form className="library-filter" method="get" action="/library">
        <input
          className="evo-input"
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Tìm theo tên video..."
          aria-label="Tìm theo tên video"
        />
        <select className="evo-select" name="lang" defaultValue={lang} aria-label="Lọc theo ngôn ngữ">
          <option value="">Mọi ngôn ngữ</option>
          {langs.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <button className="evo-btn evo-btn--solid" type="submit">
          Tìm
        </button>
      </form>

      {items.length === 0 ? (
        <div className="empty" data-testid="library-empty">
          Không tìm thấy dub nào khớp. Thử từ khóa khác hoặc xóa bộ lọc.
        </div>
      ) : (
        <div className="grid">
          {items.map((d) => (
            <div key={d.id} className="card dub-card">
              <a className="dub-title" href={`/dub/${d.id}`}>
                <h3>{d.title || d.videoId}</h3>
              </a>
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
              <div className="dub-actions">
                <a className="evo-btn evo-btn--outline evo-btn--sm" href={`/dub/${d.id}`}>
                  Nghe thử
                </a>
                <a
                  className="evo-btn evo-btn--ghost evo-btn--sm"
                  href={`https://www.youtube.com/watch?v=${d.videoId}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Video gốc
                </a>
              </div>
            </div>
          ))}
        </div>
      )}

      <nav className="library-pager">
        {page > 1 ? (
          <a className="evo-btn evo-btn--outline evo-btn--sm" href={pageHref(page - 1, q, lang)}>
            Trang trước
          </a>
        ) : (
          <span />
        )}
        <span className="evo-note evo-num">Trang {page}</span>
        {hasMore ? (
          <a className="evo-btn evo-btn--outline evo-btn--sm" href={pageHref(page + 1, q, lang)}>
            Trang sau
          </a>
        ) : (
          <span />
        )}
      </nav>
    </main>
  );
}
