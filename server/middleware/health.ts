/**
 * Mounts `GET /api/health` for the deployed/preview (Nitro) runtime — same
 * mechanism as stripe-webhook.ts. See src/lib/health.server.ts.
 */
import { handleHealth } from "../../src/lib/health.server";

interface HealthEvent {
  url: URL;
  req: Request;
}

export default async function healthMiddleware(
  event: HealthEvent,
  next: () => unknown | Promise<unknown>,
): Promise<unknown> {
  if (event.url.pathname !== "/api/health") return next();
  if (event.req.method !== "GET" && event.req.method !== "HEAD") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  return handleHealth();
}
