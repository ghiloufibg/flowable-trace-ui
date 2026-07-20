import { test, expect } from "./fixtures";

/**
 * Against e2e-fixture's seed data: 2 unique definition keys (orderApproval with 2 versions,
 * refundWithDeadletter with 1), orderApproval v2 has 10 active + 2 ended instances, v1 has none
 * (only ever defined, never instantiated).
 */
test.describe("Definitions", () => {
  test("list shows the true unique-key count, not truncated", async ({ page }) => {
    await page.goto("definitions");

    // Dogfoods the default-page-size fix: 3 definition rows exist across 2 keys - a regression
    // here would silently undercount.
    await expect(
      page.getByText("2 unique definition keys · click a row to see all versions.", { exact: true }),
    ).toBeVisible();
  });

  test("search filter narrows to matching rows", async ({ page }) => {
    await page.goto("definitions");
    const main = page.locator("main");

    await page.getByPlaceholder("Search name or key…").fill("refund");
    await expect(main.getByText("1 shown", { exact: true })).toBeVisible();
    await expect(main.getByRole("link", { name: /Refund \(deliberately failing\)/ })).toBeVisible();
    await expect(main.getByRole("link", { name: "Order Approval" })).not.toBeVisible();
  });

  test("key detail shows version history and active-instance totals", async ({ page }) => {
    await page.goto("definitions");
    await page.locator("a", { hasText: "Order Approval" }).click();
    await expect(page).toHaveURL(/\/definitions\/orderApproval$/);

    await expect(page.getByText("2 versions", { exact: false })).toBeVisible();
    await expect(page.getByText("10 active instances", { exact: false })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Version history" })).toBeVisible();
    await expect(page.getByText("latest", { exact: true })).toBeVisible();
  });

  test("version detail renders a diagram", async ({ page }) => {
    await page.goto("definitions/orderApproval/2");

    await expect(page.getByRole("heading", { name: "Order Approval" })).toBeVisible();
    await expect(page.getByText("10 active", { exact: true })).toBeVisible();
    // BpmnXmlDiagram renders into an SVG - confirms the diagram actually mounted, not just the
    // surrounding chrome.
    await expect(page.locator("svg").first()).toBeVisible();
  });
});
