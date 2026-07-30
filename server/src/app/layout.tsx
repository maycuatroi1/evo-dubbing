import type { Metadata } from "next";
import { AuthProvider } from "./auth-provider";
import { AuthNav } from "./auth-nav";
import { publicSupabaseConfig } from "@/lib/supabase-public";
import "./tokens.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "evo-dubbing",
  description: "Nghe video YouTube tiếng Anh bằng giọng Việt"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const supabase = publicSupabaseConfig();
  return (
    <html lang="vi">
      <body>
        <AuthProvider url={supabase?.url ?? ""} publishableKey={supabase?.key ?? ""}>
          <header className="site-header">
            <div className="site-header-inner">
              <a className="brand" href="/">
                <span className="evo-logo" aria-hidden="true" />
                evo-dubbing
              </a>
              <nav className="site-nav">
                <a href="/library">Thư viện</a>
                <a href="/#pricing">Bảng giá</a>
                <AuthNav />
              </nav>
            </div>
          </header>
          <main className="site-main">{children}</main>
          <footer className="site-footer">
            <div className="site-footer-inner">
              <a href="/privacy">Privacy</a>
              <a href="/terms">Terms</a>
              <a href="https://github.com/maycuatroi1/evo-dubbing" target="_blank" rel="noreferrer">
                GitHub
              </a>
              <span className="spacer" />
              <a href="https://github.com/maycuatroi1/evo-dubbing/releases" target="_blank" rel="noreferrer">
                Cài extension
              </a>
            </div>
          </footer>
        </AuthProvider>
      </body>
    </html>
  );
}
