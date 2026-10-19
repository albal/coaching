import { readFileSync } from "node:fs";
import { expect, test, type Page, type Request } from "@playwright/test";

const fixture = (name: string) => new URL(`../test/fixtures/${name}`, import.meta.url).pathname;

// Every request body the page sends, as raw bytes.
function recordBodies(page: Page) {
  const bodies: { url: string; body: Buffer }[] = [];
  page.on("request", (req: Request) => {
    const body = req.postDataBuffer();
    if (body) bodies.push({ url: req.url(), body });
  });
  return bodies;
}

async function runAnalysis(page: Page) {
  await page.getByLabel("I understand my text will be sent to Google Gemini for analysis.").check();
  await page.getByRole("button", { name: "Analyse" }).click();
  await expect(page.getByRole("button", { name: "Download Markdown" })).toBeVisible({ timeout: 20_000 });
}

async function browserStorage(page: Page) {
  return page.evaluate(async () => ({
    local: localStorage.length,
    session: sessionStorage.length,
    indexedDB: (await indexedDB.databases()).length,
    cookies: document.cookie,
  }));
}

test("uploaded files never leave the device; only the extracted text is sent", async ({ page }) => {
  const bodies = recordBodies(page);
  await page.goto("/");
  await page.setInputFiles("#resume-file", fixture("resume.pdf"));
  await expect(page.locator("#resume")).toHaveValue(/Ran Helm charts on EKS/);
  await page.setInputFiles("#jd-file", fixture("resume.docx"));
  await expect(page.locator("#job-description")).toHaveValue(/GitLab CI/);
  await runAnalysis(page);

  const pdf = readFileSync(fixture("resume.pdf"));
  const docx = readFileSync(fixture("resume.docx"));
  expect(bodies.length).toBeGreaterThan(0);
  for (const { url, body } of bodies) {
    expect(body.includes(pdf), url).toBe(false);
    expect(body.includes(docx), url).toBe(false);
    expect(body.includes(Buffer.from("%PDF-")), url).toBe(false);
    expect(body.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])), url).toBe(false);
  }
  const analysis = bodies.find((b) => b.url.endsWith("/api/analyse"))!;
  expect(JSON.parse(analysis.body.toString()).resume).toContain("Ran Helm charts on EKS for 40 services.");
});

test("nothing is written to browser storage or cookies, even after a full Session", async ({ page, context }) => {
  await page.goto("/");
  await page.locator("#resume").fill("Jane Doe\nRan Helm charts on EKS for 40 services.");
  await page.locator("#job-description").fill("Senior Platform Engineer. Must have Kubernetes.");
  await runAnalysis(page);
  await page.locator("#chat-input").fill("How do I close the GitHub Actions Gap?");
  await page.getByRole("button", { name: "Ask the coach" }).click();
  await expect(page.locator("#chat-log li")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Ask the coach" })).toBeEnabled();

  expect(await browserStorage(page)).toEqual({ local: 0, session: 0, indexedDB: 0, cookies: "" });
  expect(await context.cookies()).toEqual([]);
});

test("reopening the site shows nothing from the previous Session", async ({ page, context }) => {
  const marker = "E2E-MARKER-4b7f";
  await page.goto("/");
  await page.locator("#resume").fill(`Jane Doe ${marker}\nRan Helm charts on EKS for 40 services.`);
  await page.locator("#job-description").fill("Senior Platform Engineer");
  await runAnalysis(page);
  await page.getByRole("button", { name: "Download Markdown" }).click(); // so leaving doesn't prompt
  await page.close();

  const reopened = await context.newPage();
  await reopened.goto("/");
  await expect(reopened.locator("#resume")).toHaveValue("");
  await expect(reopened.locator("#report")).toBeHidden();
  expect(await reopened.content()).not.toContain(marker);

  await reopened.reload();
  await expect(reopened.locator("#resume")).toHaveValue("");
});

test("the leave-page warning fires while a Report hasn't been downloaded", async ({ page }) => {
  await page.goto("/");
  await page.locator("#resume").fill("Jane Doe\nRan Helm charts on EKS for 40 services.");
  await page.locator("#job-description").fill("Senior Platform Engineer");
  await runAnalysis(page);

  const dialogs: string[] = [];
  page.on("dialog", (d) => {
    dialogs.push(d.type());
    void d.dismiss();
  });
  await page.close({ runBeforeUnload: true });
  await expect.poll(() => dialogs).toEqual(["beforeunload"]);
});

test("no warning once the Report has been downloaded", async ({ page }) => {
  await page.goto("/");
  await page.locator("#resume").fill("Jane Doe\nRan Helm charts on EKS for 40 services.");
  await page.locator("#job-description").fill("Senior Platform Engineer");
  await runAnalysis(page);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download Markdown" }).click();
  await download;

  const dialogs: string[] = [];
  page.on("dialog", (d) => {
    dialogs.push(d.type());
    void d.dismiss();
  });
  await page.close({ runBeforeUnload: true });
  await new Promise((r) => setTimeout(r, 500));
  expect(dialogs).toEqual([]);
});
