import { test, expect } from "@playwright/test";

const needsData = !process.env.BASE_URL;

test("library lists public dubs with links to preview and source video", async ({ page }) => {
  test.skip(needsData, "requires a database with public dubs");
  await page.goto("/library");
  const firstCard = page.locator(".dub-card").first();
  await expect(firstCard).toBeVisible();
  await expect(firstCard.locator("a.dub-title")).toHaveAttribute("href", /\/dub\/.+/);
  await expect(firstCard.locator("a", { hasText: "Video gốc" })).toHaveAttribute(
    "href",
    /youtube\.com\/watch/
  );
});

test("library search narrows results and shows empty state for nonsense", async ({ page }) => {
  test.skip(needsData, "requires a database with public dubs");
  await page.goto("/library");
  const firstTitle = (await page.locator(".dub-card a.dub-title h3").first().innerText()).trim();
  const word = firstTitle.split(/\s+/).find((part) => part.length >= 4) ?? firstTitle;

  await page.goto(`/library?q=${encodeURIComponent(word)}`);
  const titles = page.locator(".dub-card a.dub-title h3");
  await expect(titles.first()).toBeVisible();
  const count = await titles.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i += 1) {
    expect((await titles.nth(i).innerText()).toLowerCase()).toContain(word.toLowerCase());
  }

  await page.goto("/library?q=zzzz-khong-ton-tai-12345");
  await expect(page.getByTestId("library-empty")).toBeVisible();
  await expect(page.locator(".dub-card")).toHaveCount(0);
});

test("library filter form submits via GET", async ({ page }) => {
  await page.goto("/library");
  await page.locator("input[name=q]").fill("the");
  await page.locator("button[type=submit]", { hasText: "Tìm" }).click();
  await page.waitForURL(/\/library\?(.+)?q=the/);
});
