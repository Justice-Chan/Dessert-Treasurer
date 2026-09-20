import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4173",
    browserName: "chromium",
    headless: true,
    viewport: { width: 1440, height: 1000 }
  },
  webServer: {
    command: "node scripts/test-server.mjs",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false
  }
});
