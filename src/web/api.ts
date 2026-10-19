import type { ChatEvent, ChatTurn } from "../shared/chat";
import type { AnalysisContext, AnalysisEvent, Report } from "../shared/report";

// Reads a newline-delimited JSON stream, calling onEvent for each line.
export async function readNdjson<T>(res: Response, onEvent: (e: T) => void): Promise<void> {
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (line.trim()) onEvent(JSON.parse(line) as T);
    }
  }
}

const PASS_HEADER = "x-coach-pass";

// Exchanges a Turnstile token for a short-lived pass, held only in memory.
export async function verify(token: string): Promise<string | null> {
  try {
    const res = await fetch("/api/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    return res.ok ? (((await res.json()) as { pass?: string }).pass ?? null) : null;
  } catch {
    return null;
  }
}

export async function streamAnalysis(
  body: { resume: string; jobDescription: string; context?: AnalysisContext; consent: true },
  pass: string,
  onEvent: (e: AnalysisEvent) => void,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch("/api/analyse", {
      method: "POST",
      headers: { "content-type": "application/json", [PASS_HEADER]: pass },
      body: JSON.stringify(body),
    });
  } catch {
    onEvent({ type: "error", code: "upstream", message: "Couldn't reach the coach. Check your connection and try again." });
    return;
  }
  if (!res.ok || !res.body) {
    const err = (await res.json().catch(() => null)) as AnalysisEvent | null;
    onEvent(err?.type === "error" ? err : { type: "error", code: "upstream", message: "Something went wrong. Please try again." });
    return;
  }
  await readNdjson(res, onEvent);
}

export async function streamChat(
  body: { resume: string; jobDescription: string; report: Report; history: ChatTurn[]; message: string },
  pass: string,
  onEvent: (e: ChatEvent) => void,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json", [PASS_HEADER]: pass },
      body: JSON.stringify(body),
    });
  } catch {
    onEvent({ type: "error", code: "upstream", message: "Couldn't reach the coach. Check your connection and try again." });
    return;
  }
  if (!res.ok || !res.body) {
    const err = (await res.json().catch(() => null)) as ChatEvent | null;
    onEvent(err?.type === "error" ? err : { type: "error", code: "upstream", message: "Something went wrong. Please try again." });
    return;
  }
  await readNdjson(res, onEvent);
}
