// Security headers for every API response. Static assets get the same set
// from public/_headers.
export const SECURITY_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...SECURITY_HEADERS, "Content-Type": "application/json" },
  });
}

export function ndjsonStream(run: (emit: (line: unknown) => void) => Promise<void>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      await run((line) => controller.enqueue(encoder.encode(JSON.stringify(line) + "\n")));
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { ...SECURITY_HEADERS, "Content-Type": "application/x-ndjson" },
  });
}
