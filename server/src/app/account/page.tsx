import type { Metadata } from "next";
import { Suspense } from "react";
import { AccountDashboard } from "./dashboard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Tài khoản - evo-dubbing"
};

export default function AccountPage() {
  return (
    <main className="wrap wrap--narrow">
      <h1>Tài khoản</h1>
      <Suspense fallback={<p className="sub">Đang tải...</p>}>
        <AccountDashboard />
      </Suspense>
    </main>
  );
}
