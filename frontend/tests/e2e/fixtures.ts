import { test as base } from "@playwright/test";

/**
 * Every test using this fixture fails on a console error or a failed/4xx/5xx network response -
 * the same bar every manual QA session for this project has already held itself to (see
 * claudedocs/qa-report-*.md), now enforced automatically instead of by hand.
 */
export const test = base.extend<Record<string, never>>({
  page: async ({ page }, use) => {
    const consoleErrors: string[] = [];
    const failedRequests: string[] = [];

    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("requestfailed", (request) => {
      failedRequests.push(
        `${request.method()} ${request.url()} - ${request.failure()?.errorText}`,
      );
    });
    page.on("response", (response) => {
      if (response.status() >= 400) {
        failedRequests.push(`${response.status()} ${response.request().method()} ${response.url()}`);
      }
    });

    await use(page);

    if (consoleErrors.length > 0) {
      throw new Error(`Console errors during test:\n${consoleErrors.join("\n")}`);
    }
    if (failedRequests.length > 0) {
      throw new Error(`Failed network requests during test:\n${failedRequests.join("\n")}`);
    }
  },
});

export { expect } from "@playwright/test";

/**
 * Reads the value rendered immediately after a Kpi tile's exact-text label. Scoped to <main> -
 * the header nav (Instances/Definitions/Deployments/Jobs) sits outside it, so a KPI label that
 * happens to match a nav link name (e.g. "Definitions") doesn't get picked up instead.
 */
export async function kpiValue(page: import("@playwright/test").Page, label: string) {
  const value = page
    .locator("main")
    .getByText(label, { exact: true })
    .first()
    .locator("xpath=following-sibling::div[1]");
  return (await value.innerText()).trim();
}
