import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";

/** The sidebar rail lists every root instance exactly once, unlike the dashboard's filtered/sliced sections. */
async function openInstance(page: Page, businessKey: string) {
  await page.goto("");
  await page.locator("aside").getByText(businessKey, { exact: true }).click();
  await expect(page).toHaveURL(/\/instances\//);
}

test.describe("Instance detail", () => {
  test("renders the diagram and pinned inspector for a dead-lettered instance", async ({ page }) => {
    await openInstance(page, "REF-2001");

    await expect(page.getByRole("heading", { name: /Refund \(deliberately failing\)/ })).toBeVisible();
    await expect(page.getByText("REF-2001").first()).toBeVisible();
    // A dead-lettered instance auto-pins its failed node and shows the "N failed job(s)" pill.
    await expect(page.getByTitle("Jump to failed job")).toBeVisible();
  });

  test("switches between all four tabs via keyboard shortcuts", async ({ page }) => {
    await openInstance(page, "REF-2001");

    await page.keyboard.press("2");
    await expect(page.getByText("Pending", { exact: false }).first()).toBeVisible();

    await page.keyboard.press("3");
    await expect(page.getByText("Issue Refund").first()).toBeVisible();

    await page.keyboard.press("4");
    await expect(page.getByText("Dead-letter / failed")).toBeVisible();
    await expect(page.getByText("Deliberate failure for E2E fixture data")).toBeVisible();

    await page.keyboard.press("1");
    await expect(page.getByText("orderId", { exact: true })).toBeVisible();
  });

  test("an ended instance shows Ended status", async ({ page }) => {
    await openInstance(page, "ORD-1001");

    await expect(page.getByText("Ended", { exact: true })).toBeVisible();
  });

  test("an active instance with a pending task shows Active status", async ({ page }) => {
    await openInstance(page, "ORD-1003");

    await expect(page.getByText("Active", { exact: true }).first()).toBeVisible();
  });

  test("copy diagnostics button works without throwing", async ({ page }) => {
    await openInstance(page, "ORD-1003");

    await page.getByRole("button", { name: "Copy diagnostics" }).click();
    await expect(page.getByRole("button", { name: "✓ Copied" })).toBeVisible();
  });
});
