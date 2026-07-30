"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "../auth-provider";

interface AccountPayload {
  trial: { quotaMs: number; usedMs: number; remainingMs: number; exhausted: boolean };
  periods: {
    id: string;
    startAt: string;
    endAt: string;
    quotaMs: number;
    usedMs: number;
    remainingMs: number;
    status: "active" | "queued";
  }[];
  remainingSourceMs: number;
  renewal:
    | { status: "not_subscribed" }
    | { status: "manual_renewal"; currentPeriodEndAt: string }
    | { status: "renewal_scheduled"; nextPeriodStartAt: string };
  flags: { managedInference: boolean; managedTrial: boolean; managedCheckout: boolean };
}

function minutes(ms: number): string {
  return (Math.round((ms / 60000) * 10) / 10).toLocaleString("vi-VN");
}

function day(iso: string): string {
  return new Date(iso).toLocaleDateString("vi-VN", { day: "numeric", month: "numeric", year: "numeric" });
}

export function AccountDashboard() {
  const { session, ready } = useAuth();
  const searchParams = useSearchParams();
  const [account, setAccount] = useState<AccountPayload | null>(null);
  const [error, setError] = useState("");
  const [checkoutBusy, setCheckoutBusy] = useState(false);

  const load = useCallback(async () => {
    if (!session) return;
    setError("");
    const res = await fetch("/api/v1/account", {
      headers: { authorization: `Bearer ${session.access_token}` }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError((data as { error?: { message?: string } }).error?.message ?? `HTTP ${res.status}`);
      return;
    }
    setAccount(data as AccountPayload);
  }, [session]);

  useEffect(() => {
    void load();
  }, [load]);

  async function renew() {
    if (!session) return;
    setCheckoutBusy(true);
    setError("");
    try {
      const res = await fetch("/api/v1/billing/checkout", {
        method: "POST",
        headers: {
          authorization: `Bearer ${session.access_token}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          planId: "vi_monthly_300",
          returnUrl: `${window.location.origin}/account?checkout=success`,
          cancelUrl: `${window.location.origin}/account?checkout=cancel`
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((data as { error?: { message?: string } }).error?.message ?? `HTTP ${res.status}`);
        return;
      }
      window.location.href = (data as { checkoutUrl: string }).checkoutUrl;
    } finally {
      setCheckoutBusy(false);
    }
  }

  const checkoutState = searchParams.get("checkout");

  if (!ready) {
    return (
      <div className="evo-status">
        <span className="evo-i evo-i-spinner" aria-hidden="true" />
        Đang tải phiên đăng nhập...
      </div>
    );
  }

  if (!session) {
    return (
      <div className="empty" data-testid="account-signed-out">
        Bạn cần <a href="/sign-in">đăng nhập bằng Google</a> để xem quota và gia hạn gói managed.
      </div>
    );
  }

  return (
    <div data-testid="account-dashboard">
      {checkoutState === "success" && (
        <div className="banner banner--success" data-testid="checkout-banner-success">
          Thanh toán thành công. Kỳ mới sẽ hiện ở đây sau khi PayOS xác nhận (thường vài giây) -
          bấm Làm mới nếu chưa thấy.
        </div>
      )}
      {checkoutState === "cancel" && (
        <div className="banner" data-testid="checkout-banner-cancel">
          Bạn đã hủy thanh toán. Không có khoản phí nào được ghi nhận.
        </div>
      )}

      <p className="sub">{session.user.email}</p>

      {error && (
        <p className="evo-status evo-status--error">
          <span className="evo-i evo-i-alert" aria-hidden="true" />
          {error}
        </p>
      )}

      {!account ? (
        <div className="evo-status" data-testid="account-loading">
          <span className="evo-i evo-i-spinner" aria-hidden="true" />
          Đang tải tài khoản...
        </div>
      ) : (
        <>
          <div className="card account-card">
            <h3>Quota còn lại</h3>
            <p className="account-big evo-num" data-testid="account-remaining">
              {minutes(account.remainingSourceMs)} phút nguồn
            </p>
            {!account.trial.exhausted && (
              <p className="card-text" data-testid="account-trial">
                Đang dùng thử miễn phí: còn {minutes(account.trial.remainingMs)}/15 phút.
              </p>
            )}
            {account.periods
              .filter((p) => p.status === "active")
              .map((p) => (
                <p className="card-text" key={p.id} data-testid="account-period-active">
                  Kỳ hiện tại: còn {minutes(p.remainingMs)}/{minutes(p.quotaMs)} phút, hết hạn {day(p.endAt)}.
                </p>
              ))}
            {account.renewal.status === "renewal_scheduled" && (
              <p className="card-text" data-testid="account-period-queued">
                Đã xếp lịch gia hạn: kỳ mới bắt đầu {day(account.renewal.nextPeriodStartAt)}. Quota
                không cộng dồn giữa các kỳ.
              </p>
            )}
            {account.renewal.status === "manual_renewal" && (
              <p className="card-text">
                Gia hạn thủ công: kỳ hiện tại kết thúc {day(account.renewal.currentPeriodEndAt)}. Tạo
                thanh toán mới trước khi hết để không gián đoạn.
              </p>
            )}
            {account.renewal.status === "not_subscribed" && account.trial.exhausted && (
              <p className="card-text" data-testid="account-exhausted">
                Đã hết quota managed. Gia hạn 199.000 VND cho 300 phút / 30 ngày, hoặc dùng BYOK
                miễn phí trong extension.
              </p>
            )}
            <div className="account-actions">
              {account.flags.managedCheckout && (
                <button
                  className="evo-btn evo-btn--solid"
                  onClick={() => void renew()}
                  disabled={checkoutBusy}
                  data-testid="account-renew"
                >
                  {checkoutBusy ? "Đang tạo link PayOS..." : "Gia hạn - 199.000 VND"}
                </button>
              )}
              <button className="evo-btn evo-btn--outline" onClick={() => void load()}>
                Làm mới
              </button>
            </div>
            <p className="evo-note pricing-note">
              199.000 VND / 300 phút nguồn / 30 ngày. Gia hạn thủ công qua PayOS, không cộng dồn.
              Giọng đọc do AI tạo ra.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
