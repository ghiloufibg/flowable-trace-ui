import { test, expect, kpiValue } from "./fixtures";

/**
 * Against e2e-fixture's seed data: exactly 2 jobs total, both dead-letter (async executor already
 * moved them out of the pending queue after exhausting retries).
 */
test.describe("Jobs", () => {
  test("list count matches the dead-letter KPI - no self-contradicting screen", async ({ page }) => {
    await page.goto("jobs");

    await expect(page.getByText("2 jobs total.", { exact: false })).toBeVisible();
    expect(await kpiValue(page, "Dead-letter")).toBe("2");
    await expect(page.getByText("2 shown", { exact: true })).toBeVisible();
  });

  test("type filter narrows to dead-letter jobs", async ({ page }) => {
    await page.goto("jobs");

    await page.getByLabel("Type").selectOption("deadletter");
    await expect(page.getByText("2 shown", { exact: true })).toBeVisible();
  });

  test("job detail shows the exception and retry controls", async ({ page }) => {
    await page.goto("jobs");
    await page.locator("a", { hasText: "Issue Refund" }).first().click();
    await expect(page).toHaveURL(/\/jobs\//);

    await expect(page.getByText("Deliberate failure for E2E fixture data").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry now" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Delete" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open instance" })).toBeVisible();
  });
});
