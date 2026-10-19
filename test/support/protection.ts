import type { Protection, Reservation } from "../../src/worker/protection";

// Protection that lets everything through, recording what it was asked.
export function openProtection(overrides: Partial<Protection> = {}) {
  const reserved: string[] = [];
  const protection: Protection = {
    verifyHuman: async () => true,
    passes: { issue: async () => "test-pass", check: async () => true },
    burst: { analyse: { limit: async () => ({ success: true }) }, chat: { limit: async () => ({ success: true }) } },
    usage: {
      reserveAnalysis: async (ip): Promise<Reservation> => {
        reserved.push(ip);
        return "ok";
      },
    },
    ...overrides,
  };
  return { protection, reserved };
}
