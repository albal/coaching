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

// Posts an Analysis request; consent is given unless the body says otherwise.
export async function analyse(deps: Deps, body: Record<string, unknown>) {
  const res = await handleApi(post("/api/analyse", { consent: true, ...body }), deps);
  return { res, events: await events(res) };
}
