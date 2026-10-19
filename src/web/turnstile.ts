// Cloudflare Turnstile, loaded only when a site key is configured. The token
// is exchanged once for a pass; nothing is stored in the browser.

interface TurnstileApi {
  render(el: HTMLElement, opts: Record<string, unknown>): string;
  reset(id: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let widgetId: string | null = null;
let token = "";

export function mountTurnstile(container: HTMLElement, siteKey: string): void {
  if (!siteKey || widgetId) return;
  const script = document.createElement("script");
  script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
  script.async = true;
  script.addEventListener("load", () => {
    widgetId =
      window.turnstile?.render(container, {
        sitekey: siteKey,
        action: "analyse",
        callback: (t: string) => (token = t),
        "expired-callback": () => (token = ""),
        "error-callback": () => (token = ""),
      }) ?? null;
  });
  container.hidden = false;
  document.head.append(script);
}

// The current token, consumed on use (Turnstile tokens are single-use).
export function takeToken(): string {
  const t = token;
  token = "";
  if (widgetId) window.turnstile?.reset(widgetId);
  return t;
}
