import { test, expect } from "@playwright/test";

const needsConfig = !process.env.BASE_URL;

function mockSession(page: import("@playwright/test").Page) {
  return page.addInitScript(() => {
    const session = {
      access_token: "e2e-mock-access-token",
      token_type: "bearer",
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: "e2e-mock-refresh-token",
      user: { id: "e2e-mock-user", aud: "authenticated", email: "e2e@example.com" }
    };
    window.localStorage.setItem("sb-lrypactuodbguwncoomc-auth-token", JSON.stringify(session));
  });
}

const ACCOUNT_FIXTURE = {
  userId: "e2e-mock-user",
  trial: { quotaMs: 900000, usedMs: 300000, remainingMs: 600000, exhausted: false },
  periods: [
    {
      id: "period-1",
      startAt: "2026-07-01T00:00:00.000Z",
      endAt: "2026-07-31T00:00:00.000Z",
      quotaMs: 18000000,
      usedMs: 3600000,
      remainingMs: 14400000,
      status: "active"
    }
  ],
  remainingSourceMs: 15000000,
  renewal: { status: "manual_renewal", currentPeriodEndAt: "2026-07-31T00:00:00.000Z" },
  flags: { managedInference: true, managedTrial: true, managedCheckout: true }
};

test("account page prompts sign-in when there is no session", async ({ page }) => {
  await page.goto("/account");
  await expect(page.getByTestId("account-signed-out")).toBeVisible();
});

test("account dashboard renders trial, period and renewal from the account payload", async ({ page }) => {
  test.skip(needsConfig, "requires NEXT_PUBLIC_SUPABASE_* configured on the target");
  await mockSession(page);
  await page.route("**/api/v1/account", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(ACCOUNT_FIXTURE) })
  );

  await page.goto("/account");
  await expect(page.getByTestId("account-remaining")).toContainText("250 phút nguồn");
  await expect(page.getByTestId("account-trial")).toContainText("10/15 phút");
  await expect(page.getByTestId("account-period-active")).toContainText("240/300 phút");
  await expect(page.getByTestId("account-period-active")).toContainText("31/7/2026");
  await expect(page.getByTestId("account-renew")).toContainText("199.000");
});

test("renewal button calls checkout and navigates to the PayOS link", async ({ page }) => {
  test.skip(needsConfig, "requires NEXT_PUBLIC_SUPABASE_* configured on the target");
  await mockSession(page);
  await page.route("**/api/v1/account", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(ACCOUNT_FIXTURE) })
  );
  let checkoutBody: { planId?: string; returnUrl?: string; cancelUrl?: string } = {};
  await page.route("**/api/v1/billing/checkout", (route) => {
    checkoutBody = route.request().postDataJSON() as typeof checkoutBody;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ checkoutUrl: "https://pay.payos.vn/web/e2e-order", orderCode: 123 })
    });
  });
  let payosRequested = false;
  await page.route("https://pay.payos.vn/**", (route) => {
    payosRequested = true;
    return route.abort();
  });

  await page.goto("/account");
  await page.getByTestId("account-renew").click();
  await expect.poll(() => payosRequested).toBe(true);
  expect(checkoutBody.planId).toBe("vi_monthly_300");
  expect(checkoutBody.returnUrl).toContain("/account?checkout=success");
  expect(checkoutBody.cancelUrl).toContain("/account?checkout=cancel");
});

test("checkout banners follow the query param", async ({ page }) => {
  test.skip(needsConfig, "requires NEXT_PUBLIC_SUPABASE_* configured on the target");
  await mockSession(page);
  await page.route("**/api/v1/account", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(ACCOUNT_FIXTURE) })
  );

  await page.goto("/account?checkout=success");
  await expect(page.getByTestId("checkout-banner-success")).toBeVisible();

  await page.goto("/account?checkout=cancel");
  await expect(page.getByTestId("checkout-banner-cancel")).toBeVisible();
});

test("renewal button stays hidden when the checkout flag is off", async ({ page }) => {
  test.skip(needsConfig, "requires NEXT_PUBLIC_SUPABASE_* configured on the target");
  await mockSession(page);
  await page.route("**/api/v1/account", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...ACCOUNT_FIXTURE,
        flags: { managedInference: true, managedTrial: true, managedCheckout: false }
      })
    })
  );

  await page.goto("/account");
  await expect(page.getByTestId("account-remaining")).toBeVisible();
  await expect(page.getByTestId("account-renew")).toHaveCount(0);
});
