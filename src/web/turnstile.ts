// Cloudflare Turnstile, loaded only when a site key is configured. The token
// is exchanged once for a pass; nothing is stored in the browser.
import { currentTheme } from "./theme";


interface TurnstileApi {
  render(el: HTMLElement, opts: Record<string, unknown>): string;
  reset(id: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export type TurnstileState = "off" | "loading" | "ready" | "failed";

let state: TurnstileState = "off";
let widgetId: string | null = null;
let token = "";
let waiters: ((t: string) => void)[] = [];

function settle(t: string) {
  const pending = waiters;
  waiters = [];
  for (const resolve of pending) resolve(t);
}

export function turnstileState(): TurnstileState {
  return state;
}

export function mountTurnstile(container: HTMLElement, siteKey: string): void {
  if (!siteKey || state !== "off") return;
  state = "loading";
  container.hidden = false;
  const script = document.createElement("script");
  script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
  script.async = true;
  script.addEventListener("load", () => {
    widgetId =
      window.turnstile?.render(container, {
        sitekey: siteKey,
        action: "analyse",
        theme: currentTheme(),
        callback: (t: string) => {
          token = t;
          state = "ready";
          settle(t);
        },
        "expired-callback": () => (token = ""),
        "error-callback": () => {
          token = "";
          state = "failed";
          settle("");
        },
      }) ?? null;
    if (!widgetId) (state = "failed"), settle("");
  });
  // Blocked by an extension or network: say so instead of waiting forever.
  script.addEventListener("error", () => {
    state = "failed";
    settle("");
  });
  document.head.append(script);
}

// Resolves with a fresh token, waiting for the check to finish if needed
// (Turnstile tokens are single-use). Resolves "" if it fails or times out.
export function nextToken(timeoutMs = 30_000): Promise<string> {
  if (token) {
    const t = token;
    token = "";
    if (widgetId) window.turnstile?.reset(widgetId);
    return Promise.resolve(t);
  }
  if (state === "failed" || state === "off") return Promise.resolve("");
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      waiters = waiters.filter((w) => w !== done);
      resolve("");
    }, timeoutMs);
    const done = (t: string) => {
      clearTimeout(timer);
      token = "";
      if (t && widgetId) window.turnstile?.reset(widgetId);
      resolve(t);
    };
    waiters.push(done);
  });
}

// Lets the user try the check again after a failed verification.
export function resetTurnstile(): void {
  token = "";
  if (widgetId) {
    state = "loading";
    window.turnstile?.reset(widgetId);
  }
}
