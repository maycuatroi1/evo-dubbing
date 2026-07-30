import test from "node:test";
import assert from "node:assert/strict";
import type { ManagedAccount } from "../src/lib/managed/account.ts";
import {
  AI_VOICE_DISCLOSURE,
  BYOK_CARD_COPY,
  MANAGED_ACTION_COPY,
  MANAGED_DISCLOSURES,
  MANAGED_ERROR_COPY,
  MANAGED_PLAN_COPY,
  MANAGED_SIGNED_OUT_NOTE,
  MANAGED_TRIAL_COPY,
  classifyAccount,
  isQuotaInsufficient,
  managedStateCopy,
  quotaBlockMessage,
  renderManagedCard
} from "../src/lib/managed/onboarding.ts";

const NOW = new Date("2026-07-26T00:00:00Z").getTime();

function activePeriod(overrides: Partial<ManagedAccount["periods"][number]> = {}) {
  return {
    id: "p1",
    startAt: "2026-07-20T00:00:00Z",
    endAt: "2026-08-19T00:00:00Z",
    quotaMs: 18_000_000,
    usedMs: 3_600_000,
    remainingMs: 14_400_000,
    status: "active" as const,
    ...overrides
  };
}

function accountFixture(overrides: Partial<ManagedAccount> = {}): ManagedAccount {
  return {
    userId: "u1",
    trial: { quotaMs: 900_000, usedMs: 0, remainingMs: 900_000, exhausted: false },
    periods: [],
    remainingSourceMs: 900_000,
    renewal: { status: "not_subscribed" },
    flags: { managedInference: true, managedTrial: true, managedCheckout: true },
    ...overrides
  };
}

test("classifyAccount maps account payloads to card states", () => {
  assert.equal(classifyAccount(accountFixture(), NOW), "trial");
  assert.equal(classifyAccount(accountFixture({ periods: [activePeriod()] }), NOW), "active");
  assert.equal(
    classifyAccount(
      accountFixture({
        periods: [
          activePeriod(),
          activePeriod({ id: "p2", status: "queued", startAt: "2026-08-19T00:00:00Z", endAt: "2026-09-18T00:00:00Z", usedMs: 0, remainingMs: 18_000_000 })
        ],
        renewal: { status: "renewal_scheduled", nextPeriodStartAt: "2026-08-19T00:00:00Z" }
      }),
      NOW
    ),
    "queued"
  );
  assert.equal(
    classifyAccount(
      accountFixture({ trial: { quotaMs: 900_000, usedMs: 900_000, remainingMs: 0, exhausted: true }, remainingSourceMs: 0 }),
      NOW
    ),
    "expired"
  );
  assert.equal(
    classifyAccount(
      accountFixture({ flags: { managedInference: false, managedTrial: true, managedCheckout: false } }),
      NOW
    ),
    "disabled"
  );
});

test("managed copy follows the commercial contract and never promises auto-renew", () => {
  const copies: string[] = [
    MANAGED_PLAN_COPY,
    MANAGED_TRIAL_COPY,
    AI_VOICE_DISCLOSURE,
    BYOK_CARD_COPY,
    MANAGED_SIGNED_OUT_NOTE,
    ...MANAGED_DISCLOSURES,
    ...Object.values(MANAGED_ERROR_COPY),
    ...Object.values(MANAGED_ACTION_COPY),
    quotaBlockMessage(3_600_000, 600_000)
  ];
  const fixtureFor = (state: string): ManagedAccount => {
    if (state === "trial") return accountFixture();
    if (state === "disabled")
      return accountFixture({ flags: { managedInference: false, managedTrial: true, managedCheckout: false } });
    if (state === "queued")
      return accountFixture({
        periods: [
          activePeriod(),
          activePeriod({ id: "p2", status: "queued", startAt: "2026-08-19T00:00:00Z", endAt: "2026-09-18T00:00:00Z", usedMs: 0, remainingMs: 18_000_000 })
        ]
      });
    if (state === "expired")
      return accountFixture({ trial: { quotaMs: 900_000, usedMs: 900_000, remainingMs: 0, exhausted: true }, remainingSourceMs: 0 });
    return accountFixture({ periods: [activePeriod()] });
  };
  for (const state of ["trial", "active", "queued", "expired", "disabled"] as const) {
    const copy = managedStateCopy(state, fixtureFor(state), NOW);
    copies.push(copy.title, ...copy.lines);
  }

  assert.ok(MANAGED_PLAN_COPY.includes("199.000 VND"));
  assert.ok(MANAGED_PLAN_COPY.includes("300 phút nguồn"));
  assert.ok(MANAGED_PLAN_COPY.includes("30 ngày"));
  assert.ok(MANAGED_DISCLOSURES.some((d) => d.includes("Gia hạn thủ công")));
  assert.ok(MANAGED_DISCLOSURES.some((d) => d.includes("Không cộng dồn")));
  assert.ok(MANAGED_DISCLOSURES.some((d) => d.includes("phút nguồn")));
  assert.ok(MANAGED_DISCLOSURES.some((d) => d.includes("AI")));

  for (const copy of copies) {
    assert.ok(!/tự động/i.test(copy), `auto-renew wording leaked: ${copy}`);
    assert.ok(!/auto[\s-]?(renew|debit|charge)/i.test(copy), `auto-renew wording leaked: ${copy}`);
  }
});

test("quota gate blocks only when the estimate exceeds the remaining quota", () => {
  assert.equal(isQuotaInsufficient(3_600_000, 600_000), true);
  assert.equal(isQuotaInsufficient(600_000, 3_600_000), false);
  assert.equal(isQuotaInsufficient(3_600_000, null), false);
  const message = quotaBlockMessage(3_600_000, 600_000);
  assert.ok(message.includes("60 phút"));
  assert.ok(message.includes("10 phút"));
  assert.ok(message.includes("PayOS"));
  assert.ok(message.includes("BYOK"));
});

class FakeEl {
  tag = "";
  className = "";
  textContent = "";
  disabled = false;
  children: FakeEl[] = [];
  listeners: Record<string, (() => void)[]> = {};
  append(...nodes: FakeEl[]): void {
    this.children.push(...nodes);
  }
  addEventListener(type: string, fn: () => void): void {
    (this.listeners[type] ??= []).push(fn);
  }
  set innerHTML(value: string) {
    if (value === "") this.children = [];
  }
}

function installDocumentStub() {
  (globalThis as { document?: unknown }).document = {
    createElement: (tag: string) => Object.assign(new FakeEl(), { tag })
  };
}

function textOf(node: FakeEl): string {
  return [node.textContent, ...node.children.map(textOf)].join(" ");
}

function renderWith(account: ManagedAccount | null, signedIn = true) {
  installDocumentStub();
  const root = new FakeEl();
  const calls: string[] = [];
  renderManagedCard(root as unknown as HTMLElement, { signedIn, account, nowMs: NOW }, {
    onSignIn: () => calls.push("signIn"),
    onSignOut: () => calls.push("signOut"),
    onCheckout: () => calls.push("checkout"),
    onRefresh: () => calls.push("refresh")
  });
  return { root, text: textOf(root), calls };
}

test("options managed card renders trial, active, queued and expired states", () => {
  const trial = renderWith(accountFixture());
  assert.ok(trial.text.includes("Đang dùng thử miễn phí"));
  assert.ok(trial.text.includes("15 phút"));
  assert.ok(trial.text.includes("199.000 VND"));

  const active = renderWith(accountFixture({ periods: [activePeriod()] }));
  assert.ok(active.text.includes("Gói đang hoạt động"));
  assert.ok(active.text.includes("240 phút"));
  assert.ok(active.text.includes("19/8/2026"));
  assert.ok(active.text.includes("Gia hạn thủ công"));

  const queued = renderWith(
    accountFixture({
      periods: [
        activePeriod(),
        activePeriod({ id: "p2", status: "queued", startAt: "2026-08-19T00:00:00Z", endAt: "2026-09-18T00:00:00Z", usedMs: 0, remainingMs: 18_000_000 })
      ]
    })
  );
  assert.ok(queued.text.includes("Đã xếp lịch gia hạn"));
  assert.ok(queued.text.includes("19/8/2026"));
  assert.ok(queued.text.includes("không cộng dồn"));

  const expired = renderWith(
    accountFixture({ trial: { quotaMs: 900_000, usedMs: 900_000, remainingMs: 0, exhausted: true }, remainingSourceMs: 0 })
  );
  assert.ok(expired.text.includes("Đã hết quota managed"));
  assert.ok(expired.text.includes("BYOK miễn phí"));

  for (const rendered of [trial, active, queued, expired]) {
    assert.ok(!/tự động/i.test(rendered.text), rendered.text);
  }
});

test("options managed card signed-out view never forces BYOK users into an account", () => {
  const { text } = renderWith(null, false);
  assert.ok(text.includes("Đăng nhập bằng Google"));
  assert.ok(text.includes("không cần tài khoản"));
  assert.ok(text.includes("BYOK"));
});

test("options managed card disables checkout when the checkout flag is off", () => {
  installDocumentStub();
  const root = new FakeEl();
  renderManagedCard(
    root as unknown as HTMLElement,
    { signedIn: true, account: accountFixture({ flags: { managedInference: true, managedTrial: true, managedCheckout: false } }), nowMs: NOW },
    { onSignIn() {}, onSignOut() {}, onCheckout() {}, onRefresh() {} }
  );
  const buttons = root.children.filter((c) => c.tag === "div").flatMap((c) => c.children.filter((b) => b.tag === "button"));
  const checkout = buttons.find((b) => b.textContent.includes("PayOS"));
  assert.ok(checkout);
  assert.equal(checkout!.disabled, true);
  assert.ok(textOf(root).includes("Thanh toán chưa mở"));
});
