import { test, expect } from "@playwright/test";

const needsConfig = !process.env.BASE_URL;

test("sign-in page renders the Google sign-in call to action", async ({ page }) => {
  const response = await page.goto("/sign-in");
  expect(response?.status()).toBe(200);
  await expect(page.locator("h1")).toContainText("Đăng nhập");
  const button = page.getByTestId("sign-in-google");
  const unconfigured = page.getByTestId("sign-in-unconfigured");
  if (needsConfig) {
    await expect(unconfigured).toBeVisible();
  } else {
    await expect(button).toBeVisible();
    await expect(button).toContainText("Google");
  }
});

test("mock supabase session survives reload and signs out cleanly", async ({ page }) => {
  test.skip(needsConfig, "requires NEXT_PUBLIC_SUPABASE_* configured on the target");
  await page.addInitScript(() => {
    const session = {
      access_token: "e2e-mock-access-token",
      token_type: "bearer",
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: "e2e-mock-refresh-token",
      user: {
        id: "e2e-mock-user",
        aud: "authenticated",
        email: "e2e@example.com"
      }
    };
    window.localStorage.setItem("sb-lrypactuodbguwncoomc-auth-token", JSON.stringify(session));
  });

  await page.goto("/");
  await expect(page.getByTestId("nav-account")).toContainText("e2e@example.com");

  await page.reload();
  await expect(page.getByTestId("nav-account")).toContainText("e2e@example.com");

  await page.route("**/auth/v1/logout**", (route) =>
    route.fulfill({ status: 204, body: "" })
  );
  await page.getByTestId("nav-sign-out").click();
  await expect(page.locator(".site-nav a", { hasText: "Đăng nhập" })).toBeVisible();
});
