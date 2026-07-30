"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../auth-provider";

export default function AuthCallbackPage() {
  const { client } = useAuth();
  const router = useRouter();
  const [error, setError] = useState("");

  useEffect(() => {
    if (!client) return;
    let cancelled = false;

    async function finish() {
      const url = new URL(window.location.href);
      const code = url.searchParams.get("code");
      if (code) {
        const { error: exchangeError } = await client!.auth.exchangeCodeForSession(code);
        if (exchangeError) {
          if (!cancelled) setError(exchangeError.message);
          return;
        }
      }
      const { data } = await client!.auth.getSession();
      if (cancelled) return;
      if (data.session) {
        router.replace("/account");
      } else {
        setError("Không hoàn tất được đăng nhập. Thử lại từ trang đăng nhập.");
      }
    }

    void finish();
    return () => {
      cancelled = true;
    };
  }, [client, router]);

  return (
    <main className="wrap wrap--narrow">
      {error ? (
        <div className="empty" data-testid="auth-callback-error">
          <h1>Đăng nhập thất bại</h1>
          <p>{error}</p>
          <p>
            <a href="/sign-in">Quay lại trang đăng nhập</a>
          </p>
        </div>
      ) : (
        <div className="evo-status" data-testid="auth-callback-pending">
          <span className="evo-i evo-i-spinner" aria-hidden="true" />
          Đang hoàn tất đăng nhập...
        </div>
      )}
    </main>
  );
}
