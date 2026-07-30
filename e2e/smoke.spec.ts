import { test, expect } from "@playwright/test";

test("home page returns 200 with a title", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle(/.+/);
});

test("health endpoint returns 200", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);
});
