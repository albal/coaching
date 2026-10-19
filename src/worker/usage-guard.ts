import type { Reservation } from "./protection";

// A single Durable Object holding the content-free counters behind the
// per-IP hourly limit and the global daily cap. It never sees user content:
// only a hashed IP key and the limits to apply.

interface Storage {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<boolean>;
}

export interface ReserveRequest {
  key: string;
  perHour: number;
  perDay: number;
}

const HOUR_MS = 60 * 60 * 1000;

export class UsageGuard {
  // Hourly per-IP timestamps live in memory: losing them on eviction only
  // relaxes the limit, and keeps IP-derived data off disk.
  private hits = new Map<string, number[]>();

  constructor(
    private readonly state: { storage: Storage },
    _env?: unknown,
    private readonly now: () => number = Date.now,
  ) {}

  async fetch(req: Request): Promise<Response> {
    const { key, perHour, perDay } = (await req.json()) as ReserveRequest;
    return Response.json({ result: await this.reserve(key, perHour, perDay) });
  }

  async reserve(key: string, perHour: number, perDay: number): Promise<Reservation> {
    const now = this.now();
    this.prune(now);
    const recent = this.hits.get(key) ?? [];
    if (recent.length >= perHour) return "rate_limited";

    const day = new Date(now).toISOString().slice(0, 10);
    const stored = await this.state.storage.get<{ day: string; count: number }>("daily");
    const count = stored?.day === day ? stored.count : 0;
    if (count >= perDay) return "busy";

    await this.state.storage.put("daily", { day, count: count + 1 });
    this.hits.set(key, [...recent, now]);
    return "ok";
  }

  private prune(now: number) {
    for (const [key, times] of this.hits) {
      const live = times.filter((t) => now - t < HOUR_MS);
      if (live.length) this.hits.set(key, live);
      else this.hits.delete(key);
    }
  }
}

export interface DurableObjectNamespaceLike {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(req: Request): Promise<Response> };
}

export function usageClient(ns: DurableObjectNamespaceLike, limits: { perHour: number; perDay: number }, hashIp: (ip: string) => Promise<string>) {
  const stub = () => ns.get(ns.idFromName("global"));
  return {
    async reserveAnalysis(ip: string): Promise<Reservation> {
      const body: ReserveRequest = { key: await hashIp(ip), ...limits };
      const res = await stub().fetch(new Request("https://usage-guard/reserve", { method: "POST", body: JSON.stringify(body) }));
      return ((await res.json()) as { result: Reservation }).result;
    },
  };
}
