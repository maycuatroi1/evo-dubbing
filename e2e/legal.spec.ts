import { test, expect } from "@playwright/test";

test("footer links to privacy and terms resolve", async ({ page }) => {
  await page.goto("/");
  await page.locator(".site-footer a", { hasText: "Privacy" }).click();
  await page.waitForURL(/\/privacy/);
  await expect(page.locator(".legal h1").first()).toContainText("quyền riêng tư");

  await page.locator(".site-footer a", { hasText: "Terms" }).click();
  await page.waitForURL(/\/terms/);
  await expect(page.locator(".legal h1").first()).toContainText("Điều khoản");
});

test("terms state the quota contract and takedown path", async ({ page }) => {
  const response = await page.goto("/terms");
  expect(response?.status()).toBe(200);
  await expect(page.locator(".legal")).toContainText("199.000");
  await expect(page.locator(".legal")).toContainText("300 phút");
  await expect(page.locator(".legal")).toContainText("takedown");
});

test("privacy keeps the retention and playback sections", async ({ page }) => {
  const response = await page.goto("/privacy");
  expect(response?.status()).toBe(200);
  await expect(page.locator(".legal")).toContainText("Lưu trong bao lâu");
  await expect(page.locator(".legal")).toContainText("Số liệu lượt phát");
});
