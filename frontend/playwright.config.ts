import { defineConfig, devices } from "@playwright/test";

/**
 * Points at a live e2e-fixture instance (real backend, real embedded frontend build - see
 * claudedocs/design-playwright-e2e-suite.md). CI boots that app itself; for local runs, boot
 * `e2e-fixture/target/e2e-fixture.jar` first and leave PLAYWRIGHT_BASE_URL at its default.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["html", { open: "never" }]] : "list",
  use: {
    // Trailing slash matters: baseURL has a path component (the app's mount point), and
    // page.goto("/") resolves against the origin, not this path, unless it ends in "/".
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8080/flow-trace/",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
