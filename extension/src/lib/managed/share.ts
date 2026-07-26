import type { BillingMode, Dub } from "../types.ts";
import { AI_VOICE_DISCLOSURE, formatSourceMinutes, isQuotaInsufficient } from "./onboarding.ts";
import { MANAGED_GENERATION_PROFILE, getManagedVoiceProfile } from "./profiles.ts";

export const RIGHTS_ASSERTION_COPY =
  "Tôi xác nhận mình có quyền chia sẻ công khai bản lồng tiếng này.";
export const RIGHTS_ASSERTION_ERROR = "rights_assertion_required";
export const SHARE_CONFIRM_TITLE = "Chia sẻ công khai bản dub này?";

export type ShareVisibility = "public" | "private";

export interface ShareGateInput {
  visibility: ShareVisibility;
  billingMode: BillingMode;
  rightsAssertion: boolean;
}

export function requiresRightsAssertion(input: { visibility: ShareVisibility; billingMode: BillingMode }): boolean {
  return input.visibility === "public" && input.billingMode === "managed";
}

export function assertShareAllowed(input: ShareGateInput): void {
  if (requiresRightsAssertion(input) && !input.rightsAssertion) {
    const err = new Error(
      "Chia sẻ công khai ở chế độ managed cần tick xác nhận quyền chia sẻ trước."
    ) as Error & { code: string };
    err.code = RIGHTS_ASSERTION_ERROR;
    throw err;
  }
}

export interface ShareUploadMeta {
  generationProfile?: string;
  voiceProfile?: string;
  rightsAssertion?: boolean;
}

export function managedShareUploadMeta(voiceProfileId: string, rightsAssertion: boolean): ShareUploadMeta {
  return {
    generationProfile: MANAGED_GENERATION_PROFILE,
    voiceProfile: getManagedVoiceProfile(voiceProfileId).version,
    rightsAssertion
  };
}

export interface ShareConfirmationView {
  estimateMs: number;
  remainingMs: number | null;
}

export function shareConfirmationLines(view: ShareConfirmationView): string[] {
  const lines = [`Ước tính bản dub này cần khoảng ${formatSourceMinutes(view.estimateMs)} nguồn.`];
  if (view.remainingMs !== null) {
    const afterMs = Math.max(0, view.remainingMs - view.estimateMs);
    lines.push(`Sau khi hoàn tất, tài khoản còn khoảng ${formatSourceMinutes(afterMs)} nguồn.`);
    if (isQuotaInsufficient(view.estimateMs, view.remainingMs)) {
      lines.push("Quota hiện tại không đủ cho bản dub này; hãy thanh toán thêm hoặc chuyển BYOK trước khi chia sẻ.");
    }
  } else {
    lines.push("Không đọc được quota còn lại; hệ thống sẽ kiểm tra lại trước khi hoàn tất.");
  }
  return lines;
}

export interface ShareConfirmationHandlers {
  onConfirm(): void;
  onCancel(): void;
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

export function renderShareConfirmation(
  root: HTMLElement,
  view: ShareConfirmationView,
  handlers: ShareConfirmationHandlers
): void {
  root.innerHTML = "";
  root.append(el("p", "share-confirm-title", SHARE_CONFIRM_TITLE));
  for (const line of shareConfirmationLines(view)) {
    root.append(el("p", "share-confirm-line", line));
  }
  root.append(el("p", "share-confirm-line muted", AI_VOICE_DISCLOSURE));

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = false;
  const confirmBtn = el("button", "managed-btn", "Xác nhận chia sẻ công khai");
  confirmBtn.disabled = true;
  checkbox.addEventListener("change", () => {
    confirmBtn.disabled = !checkbox.checked;
  });
  confirmBtn.addEventListener("click", () => {
    if (!checkbox.checked) return;
    handlers.onConfirm();
  });
  const cancelBtn = el("button", "managed-btn secondary", "Hủy");
  cancelBtn.addEventListener("click", () => handlers.onCancel());

  const assertion = el("label", "share-confirm-assertion", null);
  assertion.append(checkbox, el("span", null, RIGHTS_ASSERTION_COPY));
  const actions = el("div", "share-confirm-actions", null);
  actions.append(confirmBtn, cancelBtn);
  root.append(assertion, actions);
}

export interface PerformShareOptions<R> {
  visibility: ShareVisibility;
  billingMode: BillingMode;
  rightsAssertion: boolean;
  voiceProfileId?: string;
  completeAll: () => Promise<Dub>;
  upload: (dub: Dub, meta: ShareUploadMeta) => Promise<R>;
}

export async function performShare<R>(opts: PerformShareOptions<R>): Promise<R> {
  assertShareAllowed(opts);
  const dub = await opts.completeAll();
  const meta =
    opts.billingMode === "managed"
      ? managedShareUploadMeta(opts.voiceProfileId ?? "", opts.rightsAssertion)
      : {};
  return opts.upload(dub, meta);
}
