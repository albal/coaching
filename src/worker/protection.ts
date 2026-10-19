// Abuse and cost controls. Everything here is content-free: a signed expiry,
// hashed IP counters and a daily count.

export interface RateLimiter {
  limit(opts: { key: string }): Promise<{ success: boolean }>;
}

export type Reservation = "ok" | "rate_limited" | "busy";

export interface Protection {
  // Cloudflare Turnstile check, done once per Session.
  verifyHuman(token: string, ip: string): Promise<boolean>;
  // A short-lived signed pass the browser holds in memory after Turnstile.
  passes: { issue(): Promise<string>; check(pass: string | null): Promise<boolean> };
  // Short bursts, via the Workers rate-limiting binding.
  burst: { analyse: RateLimiter; chat: RateLimiter };
  // Per-IP hourly limit and the global daily cap on Analyses.
  usage: { reserveAnalysis(ip: string): Promise<Reservation> };
}

export const PASS_HEADER = "x-coach-pass";
export const PASS_LIFETIME_MS = 4 * 60 * 60 * 1000;

const encoder = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(data))));
}

export function createPasses(secret: string, now: () => number = Date.now): Protection["passes"] {
  if (!secret) throw new Error("A pass signing secret is required");
  return {
    async issue() {
      const exp = String(now() + PASS_LIFETIME_MS);
      return `${exp}.${await hmac(secret, exp)}`;
    },
    async check(pass) {
      const [exp, sig, extra] = (pass ?? "").split(".");
      if (!exp || !sig || extra !== undefined || !/^\d+$/.test(exp) || Number(exp) < now()) return false;
      const expected = await hmac(secret, exp);
      // Constant-time comparison.
      if (expected.length !== sig.length) return false;
      let diff = 0;
      for (let i = 0; i < sig.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
      return diff === 0;
    },
  };
}

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export function createTurnstileVerifier(secret: string, doFetch: typeof fetch = fetch): Protection["verifyHuman"] {
  return async (token, ip) => {
    if (!token) return false;
    const form = new FormData();
    form.append("secret", secret);
    form.append("response", token);
    if (ip) form.append("remoteip", ip);
    try {
      const res = await doFetch(SITEVERIFY, { method: "POST", body: form });
      return res.ok && ((await res.json()) as { success?: boolean }).success === true;
    } catch {
      return false;
    }
  };
}

// IPs are only ever handled as keyed hashes, so counters can't be traced back.
export async function ipKey(secret: string, ip: string): Promise<string> {
  return (await hmac(secret, `ip:${ip}`)).slice(0, 22);
}
