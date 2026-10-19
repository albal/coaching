import { describe, expect, it } from "vitest";
import worker, { type Env } from "../../src/worker/index";

describe("Worker entry", () => {
  it("serves non-API paths from static assets", async () => {
    const env = {
      ASSETS: { fetch: async () => new Response("page") },
      GEMINI_API_KEY: "k",
      GEMINI_MODEL: "m",
    } as Env;
    const res = await worker.fetch(new Request("https://coach.test/"), env);
    expect(await res.text()).toBe("page");
  });
});
