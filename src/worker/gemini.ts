// Narrow interface the Worker depends on. The real client calls the Gemini
// API directly (paid tier only, no proxy: ADR-0002); tests use a fake.

export interface Usage {
  tokensIn: number;
  tokensOut: number;
}

export interface Turn {
  role: "user" | "model";
  text: string;
}

export interface GeminiClient {
  generateJson(req: { system: string; prompt: string; schema: object }): Promise<{ text: string; usage: Usage }>;
  streamText(req: { system: string; turns: Turn[] }): AsyncIterable<string>;
}

export class UpstreamError extends Error {
  constructor(
    readonly status: number,
    // True when the prepaid balance has run out (not an ordinary rate limit).
    readonly outOfCredit = false,
  ) {
    super(`Gemini request failed with status ${status}`);
  }
}

// A prepaid key with no balance left fails with 402 Payment Required, or with
// a quota error whose message is about credit or billing. Plain per-minute
// rate limits (429 without that wording) are not treated as out of credit.
export async function upstreamError(res: Response): Promise<UpstreamError> {
  if (res.status === 402) return new UpstreamError(402, true);
  if (res.status !== 429 && res.status !== 403) return new UpstreamError(res.status);
  // Google's error bodies describe the failure, not the prompt; only a
  // yes/no is kept from it and the text is never logged.
  const body = (await res.json().catch(() => null)) as { error?: { status?: string; message?: string } } | null;
  const text = `${body?.error?.status ?? ""} ${body?.error?.message ?? ""}`;
  return new UpstreamError(res.status, /credit|billing|prepa(id|y)|balance|payment/i.test(text));
}

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

function textOf(res: GeminiResponse): string {
  return res.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
}

// Generation config deliberately omits temperature, topK, topP and penalties:
// gemini-3.5-flash-lite ignores the first three and rejects penalties.
export function createGeminiClient(opts: { apiKey: string; model: string; fetch?: typeof fetch }): GeminiClient {
  const doFetch = opts.fetch ?? fetch;

  async function post(path: string, body: object): Promise<Response> {
    const res = await doFetch(`${BASE}/${opts.model}:${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": opts.apiKey },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw await upstreamError(res);
    return res;
  }

  return {
    async generateJson({ system, prompt, schema }) {
      const res = await post("generateContent", {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json", responseJsonSchema: schema },
      });
      const json = (await res.json()) as GeminiResponse;
      return {
        text: textOf(json),
        usage: {
          tokensIn: json.usageMetadata?.promptTokenCount ?? 0,
          tokensOut: json.usageMetadata?.candidatesTokenCount ?? 0,
        },
      };
    },

    async *streamText({ system, turns }) {
      if (turns.at(-1)?.role !== "user") throw new Error("A request must end on a user turn");
      const res = await post("streamGenerateContent?alt=sse", {
        systemInstruction: { parts: [{ text: system }] },
        contents: turns.map((t) => ({ role: t.role, parts: [{ text: t.text }] })),
      });
      const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line.startsWith("data:")) continue;
          const text = textOf(JSON.parse(line.slice(5)) as GeminiResponse);
          if (text) yield text;
        }
      }
    },
  };
}
