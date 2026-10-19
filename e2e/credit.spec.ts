import { expect, test, type APIRequestContext } from "@playwright/test";

const unlock = (request: APIRequestContext) =>
  request.post("/api/admin/unlock", { headers: { authorization: "Bearer e2e-operator-token" } });

test.afterEach(async ({ request }) => {
  await unlock(request);
});

test("when the prepaid credit runs out, the app locks for everyone until it's cleared", async ({ page, browser, request }) => {
  await page.goto("/");
  await page.locator("#resume").fill("Jane Doe [demo:out-of-credit]\nRan Helm charts on EKS for 40 services.");
  await page.locator("#job-description").fill("Senior Platform Engineer");
  await page.getByLabel("I understand my text will be sent to Google Gemini for analysis.").check();
  await page.getByRole("button", { name: "Analyse" }).click();

  const banner = page.getByRole("alert").filter({ hasText: "The coach is paused" });
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("run out of credit");
  await expect(page.getByRole("button", { name: /Analyse/ })).toBeDisabled();
  await expect(page.locator("#retry")).toBeHidden();

  // A different visitor sees the lock as soon as the page loads.
  const other = await (await browser.newContext()).newPage();
  await other.goto("/");
  await expect(other.getByRole("alert").filter({ hasText: "The coach is paused" })).toBeVisible();
  await expect(other.getByRole("button", { name: "Analyse" })).toBeDisabled();
  expect((await (await request.get("/api/config")).json()).available).toBe(false);

  // After topping up, Al clears the lock.
  expect((await unlock(request)).ok()).toBe(true);
  await other.reload();
  await expect(other.locator("#locked")).toBeHidden();
  await expect(other.getByRole("button", { name: "Analyse" })).toBeEnabled();
});
