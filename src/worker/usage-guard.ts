import type { Reservation } from "./protection";

// A single Durable Object holding content-free counters: the per-IP hourly
// limit, the global daily cap, and daily usage metrics. It never sees user
// content: only a hashed IP key, the limits to apply and metric names.

export const METRICS = ["analysis_completed", "download", "booking_click"] as const;
export type Metric = (typeof METRICS)[number];
export type DailyMetrics = Record<string, Partial<Record<Metric, number>>>;

const METRIC_DAYS = 90;

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
    const { pathname } = new URL(req.url);
    if (pathname === "/count") {
      await this.count(((await req.json()) as { metric: Metric }).metric);
      return Response.json({ ok: true });
    }
    if (pathname === "/metrics") return Response.json(await this.metrics());
    const { key, perHour, perDay } = (await req.json()) as ReserveRequest;
    return Response.json({ result: await this.reserve(key, perHour, perDay) });
  }

  async count(metric: Metric): Promise<void> {
    if (!METRICS.includes(metric)) return;
    const day = new Date(this.now()).toISOString().slice(0, 10);
    const all = (await this.state.storage.get<DailyMetrics>("metrics")) ?? {};
    all[day] = { ...all[day], [metric]: (all[day]?.[metric] ?? 0) + 1 };
    const oldest = new Date(this.now() - METRIC_DAYS * 24 * HOUR_MS).toISOString().slice(0, 10);
    for (const d of Object.keys(all)) if (d < oldest) delete all[d];
    await this.state.storage.put("metrics", all);
  }

  async metrics(): Promise<DailyMetrics> {
    return (await this.state.storage.get<DailyMetrics>("metrics")) ?? {};
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
  const call = (path: string, body?: unknown) =>
    stub().fetch(new Request(`https://usage-guard${path}`, { method: "POST", body: body === undefined ? null : JSON.stringify(body) }));
  return {
    async count(metric: Metric): Promise<void> {
      await call("/count", { metric });
    },
    async metrics(): Promise<DailyMetrics> {
      return (await (await call("/metrics")).json()) as DailyMetrics;
    },
    async reserveAnalysis(ip: string): Promise<Reservation> {
      const body: ReserveRequest = { key: await hashIp(ip), ...limits };
      const res = await call("/reserve", body);
      return ((await res.json()) as { result: Reservation }).result;
    },
  };
}
