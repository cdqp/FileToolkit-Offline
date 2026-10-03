import { defineConfig, devices } from "@playwright/test";

// PW_CHROMIUM_EXECUTABLE permet d'utiliser un Chromium déjà installé (environnements hors ligne).
const executablePath = process.env.PW_CHROMIUM_EXECUTABLE || undefined;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    ...devices["Desktop Chrome"],
    acceptDownloads: true,
    colorScheme: "dark",
    launchOptions: { executablePath },
    trace: "retain-on-failure",
  },
});
