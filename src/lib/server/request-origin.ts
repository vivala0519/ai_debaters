/**
 * Next.js can build Request.url from the server's listen address (0.0.0.0),
 * even when a browser requests localhost. For wildcard listen addresses only,
 * recover the client-facing origin from the actual Host header. Never use
 * X-Forwarded-Host or Origin as proof of a local request.
 */
export function getRequestOrigin(request: Request): string {
  const internal = new URL(request.url);
  if (internal.hostname !== "0.0.0.0" && internal.hostname !== "[::]") return internal.origin;
  const host = request.headers.get("host");
  if (!host || !/^(?:[A-Za-z0-9.-]+|\[[0-9a-fA-F:]+\])(?::[0-9]{1,5})?$/.test(host)) return internal.origin;
  try {
    const external = new URL(`${internal.protocol}//${host}`);
    // The listen address can differ; the server port cannot silently change.
    if (external.port !== internal.port) return internal.origin;
    return external.origin;
  } catch { return internal.origin; }
}
