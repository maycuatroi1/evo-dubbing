import { test, expect } from "@playwright/test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const statePath = join(__dirname, ".seed-state.json");

function seedDubId(): string | null {
  if (!process.env.BASE_URL || !existsSync(statePath)) return null;
  try {
    return (JSON.parse(readFileSync(statePath, "utf8")) as { dubId?: string }).dubId ?? null;
  } catch {
    return null;
  }
}

test("public dub preview plays real audio and reports playback once", async ({ page }) => {
  const dubId = seedDubId();
  test.skip(!dubId, "run npm run e2e:seed with BASE_URL set first");
  await page.addInitScript(() => {
    window.localStorage.setItem("evoWebInstallId", "e2e-prod");
  });

  const eventRequest = page.waitForRequest(
    (req) => req.url().includes("/api/v1/events/playback") && req.method() === "POST"
  );
  const eventResponse = page.waitForResponse(
    (res) => res.url().includes("/api/v1/events/playback") && res.request().method() === "POST"
  );

  await page.goto(`/dub/${dubId}`);
  await expect(page.getByTestId("dub-player")).toBeVisible();
  await page.getByTestId("player-toggle").click();

  await page.waitForFunction(
    () => {
      const audio = document.querySelector("audio");
      return audio !== null && audio.currentTime > 2;
    },
    undefined,
    { timeout: 15_000 }
  );

  const req = await eventRequest;
  const res = await eventResponse;
  expect(res.status()).toBe(200);
  expect(req.postDataJSON()).toMatchObject({
    platform: "youtube",
    videoId: "e2e_fixture_dub",
    installId: "e2e-prod"
  });

  const firstCue = await page.getByTestId("player-cue").innerText();
  await page.locator(".player-cue").nth(1).click();
  await expect(page.getByTestId("player-cue")).not.toHaveText(firstCue);
});

test("unknown dub id renders the not-found state", async ({ page }) => {
  await page.goto("/dub/00000000-0000-0000-0000-000000000000");
  await expect(page.getByTestId("dub-not-found")).toBeVisible();
});
