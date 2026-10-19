import { defineConfig, devices } from "@playwright/test";

const PORT = 8788;

// End-to-end privacy checks against a local Worker in demo mode: canned
// Gemini replies, no network calls, no keys.
export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: `http://localhost:${PORT}`, ...devices["Desktop Chrome"] },
  webServer: {
    command: `npm run build && npx wrangler dev --env e2e --port ${PORT} --inspector-port 0 --persist-to .wrangler/e2e-state`,
    url: `http://localhost:${PORT}/api/config`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { WRANGLER_SEND_METRICS: "false" },
  },
});
