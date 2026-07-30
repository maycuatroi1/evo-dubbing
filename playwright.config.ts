import { defineConfig } from "@playwright/test";

const baseURL = process.env.BASE_URL ?? "http://127.0.0.1:3000";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: 1,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL,
    extraHTTPHeaders: {
      "user-agent": "evo-dubbing-e2e",
    },
  },
});
