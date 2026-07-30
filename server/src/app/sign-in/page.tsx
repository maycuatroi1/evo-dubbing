"use client";

import { useState } from "react";
import { useAuth } from "../auth-provider";

export default function SignInPage() {
  const { client, session, ready } = useAuth();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function signInWithGoogle() {
    if (!client) return;
    setBusy(true);
    setError("");
    const { error: oauthError } = await client.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        scopes: "openid email profile"
      }
    });
    if (oauthError) {
      setError(oauthError.message);
      setBusy(false);
    }
  }

  return (
    <main className="wrap wrap--narrow">
      <h1>Đăng nhập</h1>
      <p className="sub">
        Đăng nhập bằng Google để dùng managed dubbing: 15 phút dùng thử, theo dõi quota và gia hạn
        gói 199.000 VND. Chế độ BYOK của extension không cần tài khoản.
      </p>
      {!client ? (
        <div className="empty" data-testid="sign-in-unconfigured">
          Đăng nhập chưa được cấu hình trên môi trường này.
        </div>
      ) : ready && session ? (
        <div className="card">
          <p className="card-text">
            Bạn đã đăng nhập với {session.user.email}.{" "}
            <a href="/account">Mở trang tài khoản</a>.
          </p>
        </div>
      ) : (
        <button
          className="evo-btn evo-btn--solid"
          onClick={() => void signInWithGoogle()}
          disabled={busy}
          data-testid="sign-in-google"
        >
          <span className="evo-i evo-i-google" aria-hidden="true" />
          {busy ? "Đang chuyển tới Google..." : "Đăng nhập bằng Google"}
        </button>
      )}
      {error && (
        <p className="evo-status evo-status--error" style={{ marginTop: 12 }}>
          <span className="evo-i evo-i-alert" aria-hidden="true" />
          {error}
        </p>
      )}
    </main>
  );
}
