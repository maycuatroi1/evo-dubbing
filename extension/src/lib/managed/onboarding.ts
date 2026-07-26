import type { ManagedAccount } from "./account.ts";

export const MANAGED_PLAN_COPY = "Gói trả phí: 199.000 VND cho khoảng 300 phút nguồn trong 30 ngày.";
export const MANAGED_TRIAL_COPY = "Dùng thử miễn phí 15 phút nguồn, một lần duy nhất cho mỗi tài khoản.";
export const AI_VOICE_DISCLOSURE = "Giọng đọc do AI tạo ra, không phải giọng người thật.";
export const BYOK_CARD_COPY =
  "BYOK miễn phí, không cần đăng nhập. API key của bạn lưu ngay trong trình duyệt và không bao giờ bị bắt buộc tạo tài khoản.";

export const MANAGED_DISCLOSURES: string[] = [
  "Gia hạn thủ công: bạn chủ động tạo link thanh toán PayOS mới mỗi lần, hệ thống không thu phí định kỳ.",
  "Không cộng dồn: phút chưa dùng hết hạn cùng chu kỳ 30 ngày.",
  "Đo theo phút nguồn: quota tính theo thời lượng video gốc, không tính theo độ dài bản dịch, audio hay số lần nghe lại.",
  AI_VOICE_DISCLOSURE
];

export const MANAGED_SIGNED_OUT_NOTE =
  "Đăng nhập chỉ cần thiết cho chế độ managed. BYOK vẫn dùng được ngay mà không cần tài khoản.";

export const MANAGED_ERROR_COPY: Record<number, string> = {
  401: "Phiên đăng nhập managed đã hết hạn.",
  402: "Đã hết quota managed (phút nguồn).",
  503: "Dịch vụ managed tạm thời gián đoạn."
};

export const MANAGED_ACTION_COPY = {
  signInAgain: "Đăng nhập lại",
  checkout: "Tạo link thanh toán PayOS",
  openByok: "Mở cài đặt BYOK"
} as const;

export type ManagedCardState = "disabled" | "trial" | "active" | "queued" | "expired";

export function activePeriods(account: ManagedAccount, nowMs: number) {
  return account.periods.filter((p) => p.status === "active" && new Date(p.endAt).getTime() > nowMs);
}

export function queuedPeriods(account: ManagedAccount) {
  return account.periods.filter((p) => p.status === "queued");
}

export function classifyAccount(account: ManagedAccount, nowMs: number = Date.now()): ManagedCardState {
  if (!account.flags.managedInference) return "disabled";
  if (queuedPeriods(account).length > 0) return "queued";
  if (activePeriods(account, nowMs).length > 0) return "active";
  if (account.trial.remainingMs > 0) return "trial";
  return "expired";
}

export function formatSourceMinutes(ms: number): string {
  return `${Math.max(0, Math.round(ms / 60000))} phút`;
}

export function formatViDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
}

export interface ManagedStateCopy {
  title: string;
  lines: string[];
}

export function managedStateCopy(state: ManagedCardState, account: ManagedAccount, nowMs: number = Date.now()): ManagedStateCopy {
  const active = activePeriods(account, nowMs);
  const queued = queuedPeriods(account);
  switch (state) {
    case "trial":
      return {
        title: "Đang dùng thử miễn phí",
        lines: [
          `Còn ${formatSourceMinutes(account.trial.remainingMs)} nguồn trong tổng 15 phút dùng thử.`,
          "Khi hết phút dùng thử, tạo link PayOS để mua gói hoặc chuyển sang BYOK miễn phí."
        ]
      };
    case "active": {
      const remainingMs = active.reduce((sum, p) => sum + p.remainingMs, 0);
      const endAt = active.reduce((max, p) => (new Date(p.endAt).getTime() > new Date(max).getTime() ? p.endAt : max), active[0].endAt);
      return {
        title: "Gói đang hoạt động",
        lines: [
          `Còn khoảng ${formatSourceMinutes(remainingMs)} nguồn trong chu kỳ hiện tại.`,
          `Chu kỳ kết thúc: ${formatViDate(endAt)} (30 ngày kể từ lúc kích hoạt).`,
          "Gia hạn thủ công: tạo link PayOS mới khi sắp hết phút hoặc sau khi hết hạn."
        ]
      };
    }
    case "queued": {
      const lines: string[] = [];
      if (active.length > 0) {
        const remainingMs = active.reduce((sum, p) => sum + p.remainingMs, 0);
        lines.push(`Chu kỳ hiện tại còn khoảng ${formatSourceMinutes(remainingMs)} nguồn.`);
      }
      lines.push(`Chu kỳ mới đã thanh toán, bắt đầu: ${formatViDate(queued[0].startAt)}.`);
      lines.push("Phút còn lại của chu kỳ hiện tại không cộng dồn sang chu kỳ mới.");
      return { title: "Đã xếp lịch gia hạn", lines };
    }
    case "expired":
      return {
        title: "Đã hết quota managed",
        lines: [
          "Phút dùng thử và gói trả phí đã hết hoặc hết hạn.",
          "Tạo link thanh toán PayOS để kích hoạt chu kỳ mới 30 ngày, hoặc chuyển sang BYOK miễn phí."
        ]
      };
    case "disabled":
      return {
        title: "Managed đang tạm tắt",
        lines: [
          "Dịch vụ managed tạm dừng do ngân sách hoặc nhà cung cấp gián đoạn.",
          "Trong lúc này hãy dùng BYOK miễn phí - cài đặt và API key của bạn không bị ảnh hưởng."
        ]
      };
  }
}

export function isQuotaInsufficient(neededMs: number, remainingMs: number | null): boolean {
  return remainingMs !== null && neededMs > remainingMs;
}

export function quotaBlockMessage(neededMs: number, remainingMs: number): string {
  return (
    `Ước tính cần khoảng ${formatSourceMinutes(neededMs)} nguồn nhưng tài khoản chỉ còn ${formatSourceMinutes(remainingMs)}. ` +
    "Thanh toán thêm qua PayOS hoặc chuyển sang BYOK trước khi hoàn tất toàn bộ."
  );
}

export interface ManagedCardHandlers {
  onSignIn(): void;
  onSignOut(): void;
  onCheckout(): void;
  onRefresh(): void;
}

export interface ManagedCardView {
  signedIn: boolean;
  account: ManagedAccount | null;
  error?: string | null;
  nowMs?: number;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string | null,
  text: string | null
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== null) node.textContent = text;
  return node;
}

export function renderManagedCard(root: HTMLElement, view: ManagedCardView, handlers: ManagedCardHandlers): void {
  root.innerHTML = "";
  const nowMs = view.nowMs ?? Date.now();

  if (!view.signedIn) {
    root.append(
      el("p", "managed-line", MANAGED_TRIAL_COPY),
      el("p", "managed-line", MANAGED_PLAN_COPY),
      el("p", "managed-line muted", MANAGED_SIGNED_OUT_NOTE)
    );
    const signInBtn = el("button", "managed-btn", "Đăng nhập bằng Google");
    signInBtn.addEventListener("click", () => handlers.onSignIn());
    root.append(signInBtn);
  } else if (!view.account) {
    root.append(el("p", "managed-line error", view.error ?? "Không đọc được thông tin tài khoản managed."));
    const retryBtn = el("button", "managed-btn secondary", "Thử lại");
    retryBtn.addEventListener("click", () => handlers.onRefresh());
    root.append(retryBtn);
  } else {
    const state = classifyAccount(view.account, nowMs);
    const copy = managedStateCopy(state, view.account, nowMs);
    root.append(el("p", "managed-state", copy.title));
    for (const line of copy.lines) {
      root.append(el("p", "managed-line", line));
    }
    root.append(el("p", "managed-line muted", MANAGED_PLAN_COPY));

    const actions = el("div", "managed-actions", null);
    const checkoutBtn = el("button", "managed-btn", `${MANAGED_ACTION_COPY.checkout} - 199.000 VND`);
    checkoutBtn.disabled = !view.account.flags.managedCheckout;
    checkoutBtn.addEventListener("click", () => handlers.onCheckout());
    actions.append(checkoutBtn);
    if (!view.account.flags.managedCheckout) {
      actions.append(el("p", "managed-line muted", "Thanh toán chưa mở, vui lòng quay lại sau."));
    }
    const refreshBtn = el("button", "managed-btn secondary", "Làm mới trạng thái");
    refreshBtn.addEventListener("click", () => handlers.onRefresh());
    const signOutBtn = el("button", "managed-btn secondary", "Đăng xuất");
    signOutBtn.addEventListener("click", () => handlers.onSignOut());
    actions.append(refreshBtn, signOutBtn);
    root.append(actions);
  }

  const list = el("ul", "managed-disclosures", null);
  for (const item of MANAGED_DISCLOSURES) {
    list.append(el("li", null, item));
  }
  root.append(list);
}
