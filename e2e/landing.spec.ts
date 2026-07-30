import { test, expect } from "@playwright/test";

test("landing renders hero, three pricing cards and AI disclosure", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".landing-hero h1")).toContainText("giọng Việt");
  await expect(page.locator(".price-card")).toHaveCount(3);
  await expect(page.locator("#pricing")).toContainText("199.000");
  await expect(page.locator("#pricing")).toContainText("300 phút");
  await expect(page.locator("#pricing")).toContainText("15 phút");
  await expect(page.locator("#pricing")).toContainText("Miễn phí");
  await expect(page.locator("body")).toContainText("Giọng đọc do AI tạo ra");
});

test("landing CTA points to the extension install location", async ({ page }) => {
  await page.goto("/");
  const cta = page.locator(".landing-cta a", { hasText: "Cài extension" });
  await expect(cta).toHaveAttribute("href", /github\.com\/maycuatroi1\/evo-dubbing/);
  await expect(page.locator(".landing-cta a", { hasText: "Xem thư viện" })).toHaveAttribute(
    "href",
    "/library"
  );
});

test("landing never mentions auto-renew", async ({ page }) => {
  await page.goto("/");
  const text = await page.locator("body").innerText();
  expect(text).not.toMatch(/auto.?renew/i);
});
