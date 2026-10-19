import { describe, expect, it } from "vitest";
import { createGeminiClient, UpstreamError } from "../../src/worker/gemini";

function recordingFetch(response: () => Response) {
  const requests: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    requests.push({ url, init });
    return response();
  }) as unknown as typeof fetch;
  return { fn, requests };
}

const BANNED = ["temperature", "topK", "topP", "frequencyPenalty", "presencePenalty"];

describe("real Gemini client", () => {
  it("uses the configured model, sends the key in a header and never sends banned parameters", async () => {
    const f = recordingFetch(
      () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"a":1}' }] } }], usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 3 } })),
    );
    const client = createGeminiClient({ apiKey: "secret-key", model: "gemini-test-model", fetch: f.fn });
    const out = await client.generateJson({ system: "sys", prompt: "hi", schema: { type: "object" } });
    expect(out).toEqual({ text: '{"a":1}', usage: { tokensIn: 7, tokensOut: 3 } });
    const req = f.requests[0]!;
    expect(req.url).toContain("/models/gemini-test-model:generateContent");
    expect(req.url).not.toContain("secret-key");
    expect((req.init.headers as Record<string, string>)["x-goog-api-key"]).toBe("secret-key");
    const body = req.init.body as string;
    for (const p of BANNED) expect(body).not.toContain(p);
    expect(JSON.parse(body).generationConfig).toEqual({ responseMimeType: "application/json", responseJsonSchema: { type: "object" } });
  });

  it("streams text from server-sent events and refuses to end on a model turn", async () => {
    const sse = ['data: {"candidates":[{"content":{"parts":[{"text":"Hel"}]}}]}', 'data: {"candidates":[{"content":{"parts":[{"text":"lo"}]}}]}', ""].join("\n\n");
    const f = recordingFetch(() => new Response(sse));
    const client = createGeminiClient({ apiKey: "k", model: "m", fetch: f.fn });
    let text = "";
    for await (const chunk of client.streamText({ system: "s", turns: [{ role: "user", text: "q" }] })) text += chunk;
    expect(text).toBe("Hello");
    for (const p of BANNED) expect(f.requests[0]!.init.body as string).not.toContain(p);

    const consume = async () => {
      for await (const _ of client.streamText({ system: "s", turns: [{ role: "user", text: "q" }, { role: "model", text: "a" }] }));
    };
    await expect(consume()).rejects.toThrow(/user turn/);
  });

  it("throws UpstreamError with the status on failure", async () => {
    const f = recordingFetch(() => new Response("nope", { status: 429 }));
    const client = createGeminiClient({ apiKey: "k", model: "m", fetch: f.fn });
    await expect(client.generateJson({ system: "s", prompt: "p", schema: {} })).rejects.toEqual(new UpstreamError(429));
  });
});
