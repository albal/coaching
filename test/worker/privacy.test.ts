import { readdirSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../../src/worker/index";
import { createGeminiClient } from "../../src/worker/gemini";
import { PASS_HEADER } from "../../src/worker/protection";
import { fakeEnv } from "../support/env";

const root = new URL("../../", import.meta.url);
const MARKER = "PRIVACY-MARKER-c0ffee";

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`https://coach.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": "192.0.2.10", ...headers },
    body: JSON.stringify(body),
  });
}

afterEach(() => vi.restoreAllMocks());

describe("privacy acceptance", () => {
  it("a marker in the Resume never reaches logs or any storage after a full Analysis and Coaching Chat", async () => {
    const output: string[] = [];
    for (const level of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void output.push(args.map(String).join(" ")));
    }
    const { env, storage } = fakeEnv({ DEMO_GEMINI: "1" });
    const resume = `Jane Doe ${MARKER}\nRan Helm charts on EKS for 40 services.`;
    const jobDescription = `Senior Platform Engineer ${MARKER}`;

    const { pass } = (await (await worker.fetch(post("/api/verify", { token: "" }), env)).json()) as { pass: string };
    const auth = { [PASS_HEADER]: pass };
    expect((await worker.fetch(post("/api/analyse", { resume, jobDescription, consent: true }), env)).status).toBe(401);
    const run = await worker.fetch(post("/api/analyse", { resume, jobDescription, consent: true }, auth), env);
    const lines = (await run.text()).trim().split("\n").map((l) => JSON.parse(l));
    const report = Object.fromEntries(lines.filter((l) => l.type === "section").map((l) => [l.section, l.data]));
    const chat = await worker.fetch(
      post("/api/chat", { resume, jobDescription, report, history: [], message: `What about ${MARKER}?` }, auth),
      env,
    );
    expect((await chat.text()).trim().split("\n").at(-1)).toBe('{"type":"done"}');
    await worker.fetch(post("/api/event", { name: "download" }), env);

    expect(output.length).toBeGreaterThan(0);
    expect(output.join("\n")).not.toContain(MARKER);
    expect(output.join("\n")).not.toContain("192.0.2.10");
    expect(JSON.stringify([...storage.entries()])).not.toContain(MARKER);
    expect([...storage.keys()].sort()).toEqual(["daily", "metrics"]);
  });
});

// wrangler.jsonc with full-line comments removed.
function wranglerConfig(): Record<string, unknown> {
  const text = readFileSync(new URL("wrangler.jsonc", root), "utf8")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");
  return JSON.parse(text);
}

const STORAGE_BINDINGS = ["kv_namespaces", "r2_buckets", "d1_databases", "queues", "vectorize", "hyperdrive", "analytics_engine_datasets", "ai", "browser"];

describe("Worker bindings", () => {
  it("has no storage bindings except the content-free usage counter", () => {
    const config = wranglerConfig();
    for (const scope of [config, ...Object.values((config.env ?? {}) as Record<string, Record<string, unknown>>)]) {
      for (const key of STORAGE_BINDINGS) expect(scope[key], key).toBeUndefined();
      const dos = (scope.durable_objects as { bindings: { name: string; class_name: string }[] } | undefined)?.bindings ?? [];
      expect(dos).toEqual([{ name: "USAGE_GUARD", class_name: "UsageGuard" }]);
    }
  });

  it("never enables demo mode in the deployed configuration", () => {
    const vars = wranglerConfig().vars as Record<string, string>;
    expect(vars.DEMO_GEMINI).toBeUndefined();
  });
});

describe("no prompt-logging proxy", () => {
  it("calls the Gemini API directly", async () => {
    const urls: string[] = [];
    const client = createGeminiClient({
      apiKey: "k",
      model: "gemini-3.5-flash-lite",
      fetch: (async (url: string) => (urls.push(url), Response.json({}))) as unknown as typeof fetch,
    });
    await client.generateJson({ system: "s", prompt: "p", schema: {} });
    expect(new URL(urls[0]!).host).toBe("generativelanguage.googleapis.com");
  });

  it("has no AI Gateway or other proxy anywhere in the Worker source", () => {
    const dir = new URL("src/worker/", root);
    for (const file of readdirSync(dir)) {
      const source = readFileSync(new URL(file, dir), "utf8");
      expect(source, file).not.toMatch(/gateway\.ai\.cloudflare\.com|cf-aig-|aiplatform\.googleapis\.com/);
    }
  });
});
