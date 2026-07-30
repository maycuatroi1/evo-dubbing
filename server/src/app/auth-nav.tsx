"use client";

import { useAuth } from "./auth-provider";

export function AuthNav() {
  const { session, ready, signOut } = useAuth();

  if (!ready) {
    return <a href="/sign-in">Đăng nhập</a>;
  }

  if (!session) {
    return <a href="/sign-in">Đăng nhập</a>;
  }

  return (
    <>
      <a href="/account" data-testid="nav-account">
        {session.user.email ?? "Tài khoản"}
      </a>
      <button className="site-nav-button" onClick={() => void signOut()} data-testid="nav-sign-out">
        Đăng xuất
      </button>
    </>
  );
}
