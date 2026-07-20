import { test, expect } from "./fixtures";

/** Against e2e-fixture's seed data: 2 deployments (SpringBootAutoDeployment, order-approval-v2). */
test.describe("Deployments", () => {
  test("list shows both deployments", async ({ page }) => {
    await page.goto("deployments");

    await expect(page.getByText("2 total.", { exact: false })).toBeVisible();
    await expect(page.getByText("order-approval-v2")).toBeVisible();
    await expect(page.getByText("SpringBootAutoDeployment")).toBeVisible();
  });

  test("detail shows definitions, resources and activity tabs", async ({ page }) => {
    await page.goto("deployments");
    await page.locator("a", { hasText: "order-approval-v2" }).click();
    await expect(page).toHaveURL(/\/deployments\//);

    // Definitions tab (default): active-instance count matches the header's own figure - dogfoods
    // the deployment "Instances" column / header mismatch fix.
    await expect(page.getByText("10 active instances", { exact: false })).toBeVisible();
    await expect(page.getByText("orderApproval")).toBeVisible();

    await page.getByRole("button", { name: "resources", exact: true }).click();
    await expect(page.getByText("order-approval.bpmn20.xml").first()).toBeVisible();

    await page.getByRole("button", { name: "activity", exact: true }).click();
    await expect(page.getByText("created", { exact: true })).toBeVisible();
  });
});
