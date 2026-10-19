import { handleApi, type Deps } from "../../src/worker/app";
import { readNdjson } from "../../src/web/api";
import type { AnalysisEvent } from "../../src/shared/report";

export function post(path: string, body: unknown): Request {
  return new Request(`https://coach.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

export async function events(res: Response): Promise<AnalysisEvent[]> {
  const out: AnalysisEvent[] = [];
  await readNdjson<AnalysisEvent>(res, (e) => out.push(e));
  return out;
}

export async function analyse(deps: Deps, body: unknown) {
  const res = await handleApi(post("/api/analyse", body), deps);
  return { res, events: await events(res) };
}
