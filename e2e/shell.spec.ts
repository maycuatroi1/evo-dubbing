import { test, expect } from "@playwright/test";

test("home renders header and footer shell on a white background", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".site-header .brand")).toContainText("evo-dubbing");
  await expect(page.locator(".site-nav a", { hasText: "Thư viện" })).toBeVisible();
  await expect(page.locator(".site-nav a", { hasText: "Bảng giá" })).toBeVisible();
  await expect(page.locator(".site-nav a", { hasText: "Đăng nhập" })).toBeVisible();
  await expect(page.locator(".site-footer a", { hasText: "Privacy" })).toBeVisible();
  await expect(page.locator(".site-footer a", { hasText: "Terms" })).toBeVisible();
  await expect(page.locator(".site-footer a", { hasText: "GitHub" })).toBeVisible();
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe("rgb(255, 255, 255)");
});

test("admin page loads with the new token primitives", async ({ page }) => {
  const response = await page.goto("/admin");
  expect(response?.status()).toBe(200);
  await expect(page.locator("h1")).toContainText("Creator outreach");
  await expect(page.locator("input.evo-input[type=password]")).toBeVisible();
  await expect(page.locator("button.evo-btn--solid")).toBeVisible();
});
