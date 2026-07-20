import { test, expect, kpiValue } from "./fixtures";

/**
 * Against e2e-fixture's seed data: 12 active orderApproval instances (10 pending, 2 counted
 * elsewhere as ended), 2 ended, 0 abnormally-failed, 2 unique definition keys, 2 dead-lettered
 * refundWithDeadletter instances surfaced under "Needs attention".
 */
test.describe("Dashboard", () => {
  test("shows KPI tiles matching the seeded engine state", async ({ page }) => {
    await page.goto("");

    await expect(page.getByRole("heading", { name: "Engine overview" })).toBeVisible();

    expect(await kpiValue(page, "Active")).toBe("12");
    expect(await kpiValue(page, "Failed")).toBe("0");
    expect(await kpiValue(page, "Ended")).toBe("2");
    expect(await kpiValue(page, "Definitions")).toBe("2");
  });

  test("lists dead-lettered instances under Needs attention", async ({ page }) => {
    await page.goto("");

    const attention = page.locator("section", { has: page.getByText("Needs attention") });
    const ref1Row = attention.locator("a", { hasText: "REF-2001" });
    await expect(ref1Row).toBeVisible();
    await expect(attention.locator("a", { hasText: "REF-2002" })).toBeVisible();
    await expect(ref1Row.getByText("1 failed job", { exact: true })).toBeVisible();
  });

  test("navigates to an instance from Needs attention", async ({ page }) => {
    await page.goto("");

    const attention = page.locator("section", { has: page.getByText("Needs attention") });
    await attention.locator("a", { hasText: "REF-2001" }).click();
    await expect(page).toHaveURL(/\/instances\//);
    await expect(page.getByText("REF-2001").first()).toBeVisible();
  });

  test("sidebar shows the un-truncated root instance count", async ({ page }) => {
    await page.goto("");

    // Dogfoods the default-page-size fix directly: 14 root instances exist, past Flowable's
    // hardcoded default of 10 - a regression here would silently cap this at 10.
    await expect(page.getByText("Instances · 14")).toBeVisible();
  });

  test("theme toggle switches without errors", async ({ page }) => {
    await page.goto("");

    const toggle = page.getByTitle("Toggle theme");
    await expect(toggle).toBeVisible();
    await toggle.click();
    await toggle.click();
  });
});
