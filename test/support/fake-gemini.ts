import type { SectionName } from "../../src/shared/report";
import type { GeminiClient, Turn } from "../../src/worker/gemini";
import { UpstreamError } from "../../src/worker/gemini";
import { jsonSchemaFor } from "../../src/worker/pipeline";
import type { LogEvent, Logger } from "../../src/worker/log";

type Reply = unknown | { raw: string } | { fail: number };

// A scripted Gemini fake. Each section has a queue of replies; the last one
// repeats. Objects are returned as JSON, { raw } as literal text.
export function fakeGemini(script: Partial<Record<SectionName, Reply | Reply[]>>, chat: string[] = ["Hello"]) {
  const calls: { section: SectionName; system: string; prompt: string }[] = [];
  const chatCalls: { system: string; turns: Turn[] }[] = [];
  const sectionOf = (schema: object): SectionName => {
    const match = (Object.keys(script) as SectionName[]).find(
      (s) => JSON.stringify(jsonSchemaFor(s)) === JSON.stringify(schema),
    );
    if (!match) throw new Error("No scripted reply for this schema");
    return match;
  };
  const client: GeminiClient = {
    async generateJson({ system, prompt, schema }) {
      const section = sectionOf(schema);
      calls.push({ section, system, prompt });
      const entry = script[section];
      const queue = Array.isArray(entry) ? entry : [entry];
      const n = calls.filter((c) => c.section === section).length;
      const reply = queue[Math.min(n, queue.length) - 1];
      if (reply && typeof reply === "object" && "fail" in reply) throw new UpstreamError((reply as { fail: number }).fail);
      const text = reply && typeof reply === "object" && "raw" in reply ? (reply as { raw: string }).raw : JSON.stringify(reply);
      return { text, usage: { tokensIn: 10, tokensOut: 5 } };
    },
    async *streamText(req) {
      chatCalls.push(req);
      for (const chunk of chat) yield chunk;
    },
  };
  return { client, calls, chatCalls };
}

export function captureLogger() {
  const events: LogEvent[] = [];
  const logger: Logger = { event: (e) => events.push(e) };
  return { logger, events };
}
