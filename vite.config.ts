import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "vite";
import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";
// @ts-expect-error JS plugin alongside the TS vite config
import { appEnvPlugin } from "./scripts/app-env-plugin.mjs";
import { isMigrationFile } from "./scripts/migration-plan.mjs";

/** The files `src/lib/db.ts` globs — same directory, same non-recursive scope. */
function hasGlobbedMigrations(root: string): boolean {
  try {
    return readdirSync(join(root, "migrations")).some(isMigrationFile);
  } catch {
    return false;
  }
}

/**
 * Finish PGLite bootstrap during dev-server setup (before traffic). Vite awaits
 * async `configureServer` hooks. Production: `src/lib/db` kicks `ensureDbReady`
 * on import.
 *
 * Vite awaiting the hook puts this on time-to-first-render, so an app with no
 * migrations — no schema to apply — skips it entirely rather than paying for a
 * PGLite instance it never queries.
 */
function pgliteBootstrapPlugin(): Plugin {
  return {
    name: "app-builder:pglite-bootstrap",
    apply: "serve",
    async configureServer(server) {
      if (!hasGlobbedMigrations(server.config.root)) return;
      try {
        const mod = (await server.ssrLoadModule("/src/lib/db.ts")) as {
          ensureDbReady?: () => Promise<void>;
        };
        if (typeof mod.ensureDbReady === "function") {
          await mod.ensureDbReady();
        }
      } catch (err) {
        console.error("[app-builder] DB bootstrap failed:", err);
        throw err;
      }
    },
  };
}

/**
 * Live-preview OAuth popup — handled HERE so the agent never has to create a
 * `/auth/popup` route (and cannot break it by scaffolding a React page that
 * paints the full app shell in the popup).
 *
 * `signIn` (client.ts) opens `/auth/popup?providerId=…` in a top-level window.
 * This middleware runs before TanStack Start, calls `handleAuthPopupRequest`,
 * and returns the 302 / completion HTML. Deployed apps do not use the popup
 * (full-page OAuth redirect), so `apply: "serve"` is enough.
 */
function authPopupPlugin(): Plugin {
  return {
    name: "app-builder:auth-popup",
    apply: "serve",
    configureServer(server) {
      // Register immediately (not in a returned post-hook) so we run BEFORE
      // TanStack Start / the SPA HTML fallback. A model-authored
      // `src/routes/auth/popup.tsx` React page must never win this path.
      server.middlewares.use(async (req, res, next) => {
        try {
          const rawUrl = req.url ?? "";
          const pathOnly = rawUrl.split("?", 1)[0] ?? "";
          if (pathOnly !== "/auth/popup") {
            next();
            return;
          }
          if ((req.method ?? "GET").toUpperCase() !== "GET") {
            res.statusCode = 405;
            res.setHeader("content-type", "text/plain; charset=utf-8");
            res.end("Method Not Allowed");
            return;
          }

          const host = String(
            req.headers["x-forwarded-host"] ?? req.headers.host ?? "localhost:8080",
          );
          const proto = String(
            req.headers["x-forwarded-proto"] ??
              ((req.socket as { encrypted?: boolean } | undefined)?.encrypted ? "https" : "http"),
          );
          const requestHeaders = new Headers();
          for (const [key, value] of Object.entries(req.headers)) {
            if (value === undefined) continue;
            if (Array.isArray(value)) {
              for (const v of value) requestHeaders.append(key, v);
            } else {
              requestHeaders.set(key, value);
            }
          }
          // Ensure Host is the public preview host so Better Auth's dynamic
          // baseURL / redirect_uri match the popup origin.
          if (!requestHeaders.has("host")) requestHeaders.set("host", host);

          const request = new Request(`${proto}://${host}${rawUrl}`, {
            method: "GET",
            headers: requestHeaders,
          });

          const mod = (await server.ssrLoadModule("/src/lib/auth/popup.server.ts")) as {
            handleAuthPopupRequest: (req: Request) => Promise<Response>;
          };
          const response = await mod.handleAuthPopupRequest(request);

          res.statusCode = response.status;
          // Preserve multiple Set-Cookie headers (OAuth state + session).
          const setCookies =
            typeof response.headers.getSetCookie === "function"
              ? response.headers.getSetCookie()
              : [];
          response.headers.forEach((value, key) => {
            if (key.toLowerCase() === "set-cookie") return;
            res.setHeader(key, value);
          });
          for (const cookie of setCookies) {
            res.appendHeader("set-cookie", cookie);
          }
          const body = Buffer.from(await response.arrayBuffer());
          res.end(body);
        } catch (err) {
          console.error("[app-builder] /auth/popup handler failed:", err);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader("content-type", "text/plain; charset=utf-8");
            res.end("auth popup failed");
          }
        }
      });
    },
  };
}

/**
 * Mounts this app's own Better Auth at `/api/auth/*` during `npm run dev`
 * (plain `vite dev` — Nitro, and hence `server/middleware/auth-api.ts`, only
 * runs for build/preview). Mirrors `authPopupPlugin` above: construct a real
 * `Request` from the raw Node request (headers AND body this time — sign-up/
 * sign-in are POSTs with a JSON body, unlike the popup's GET-only flow) and
 * hand it to Better Auth's framework-agnostic `auth.handler`.
 */
function authApiPlugin(): Plugin {
  return {
    name: "app-builder:auth-api",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        try {
          const rawUrl = req.url ?? "";
          const pathOnly = rawUrl.split("?", 1)[0] ?? "";
          if (!pathOnly.startsWith("/api/auth/")) {
            next();
            return;
          }

          const host = String(
            req.headers["x-forwarded-host"] ?? req.headers.host ?? "localhost:8080",
          );
          const proto = String(
            req.headers["x-forwarded-proto"] ??
              ((req.socket as { encrypted?: boolean } | undefined)?.encrypted ? "https" : "http"),
          );
          const requestHeaders = new Headers();
          for (const [key, value] of Object.entries(req.headers)) {
            if (value === undefined) continue;
            if (Array.isArray(value)) {
              for (const v of value) requestHeaders.append(key, v);
            } else {
              requestHeaders.set(key, value);
            }
          }
          if (!requestHeaders.has("host")) requestHeaders.set("host", host);

          const method = (req.method ?? "GET").toUpperCase();
          let body: Buffer | undefined;
          if (method !== "GET" && method !== "HEAD") {
            const chunks: Buffer[] = [];
            for await (const chunk of req) chunks.push(chunk as Buffer);
            if (chunks.length) body = Buffer.concat(chunks);
          }

          const request = new Request(`${proto}://${host}${rawUrl}`, {
            method,
            headers: requestHeaders,
            body,
          });

          const mod = (await server.ssrLoadModule("/src/lib/auth/server.ts")) as {
            auth: { handler: (req: Request) => Promise<Response> };
          };
          const response = await mod.auth.handler(request);

          res.statusCode = response.status;
          const setCookies =
            typeof response.headers.getSetCookie === "function"
              ? response.headers.getSetCookie()
              : [];
          response.headers.forEach((value, key) => {
            if (key.toLowerCase() === "set-cookie") return;
            res.setHeader(key, value);
          });
          for (const cookie of setCookies) {
            res.appendHeader("set-cookie", cookie);
          }
          const buf = Buffer.from(await response.arrayBuffer());
          res.end(buf);
        } catch (err) {
          console.error("[app-builder] /api/auth handler failed:", err);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader("content-type", "text/plain; charset=utf-8");
            res.end("auth api failed");
          }
        }
      });
    },
  };
}

/**
 * Mounts the Stripe webhook at `/api/stripe/webhook` during `npm run dev`.
 * Reads the raw body as text (Stripe's signature check needs the exact bytes
 * Stripe sent, before any JSON parsing) and hands it to the same handler the
 * Nitro middleware uses.
 */
function stripeWebhookPlugin(): Plugin {
  return {
    name: "app-builder:stripe-webhook",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        try {
          const pathOnly = (req.url ?? "").split("?", 1)[0] ?? "";
          if (pathOnly !== "/api/stripe/webhook") {
            next();
            return;
          }
          if ((req.method ?? "GET").toUpperCase() !== "POST") {
            res.statusCode = 405;
            res.setHeader("content-type", "text/plain; charset=utf-8");
            res.end("Method Not Allowed");
            return;
          }
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          const rawBody = Buffer.concat(chunks).toString("utf8");
          const signature = req.headers["stripe-signature"];

          const mod = (await server.ssrLoadModule("/src/lib/game/stripe-webhook.server.ts")) as {
            handleStripeWebhook: (body: string, sig: string | undefined) => Promise<Response>;
          };
          const response = await mod.handleStripeWebhook(
            rawBody,
            typeof signature === "string" ? signature : undefined,
          );

          res.statusCode = response.status;
          response.headers.forEach((value, key) => res.setHeader(key, value));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (err) {
          console.error("[app-builder] /api/stripe/webhook handler failed:", err);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader("content-type", "text/plain; charset=utf-8");
            res.end("stripe webhook failed");
          }
        }
      });
    },
  };
}

/**
 * Mounts `GET /api/health` during `npm run dev` — the dev twin of
 * server/middleware/health.ts; both call src/lib/health.server.ts.
 */
function healthPlugin(): Plugin {
  return {
    name: "app-builder:health",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        try {
          const pathOnly = (req.url ?? "").split("?", 1)[0] ?? "";
          if (pathOnly !== "/api/health") {
            next();
            return;
          }
          const method = (req.method ?? "GET").toUpperCase();
          if (method !== "GET" && method !== "HEAD") {
            res.statusCode = 405;
            res.setHeader("content-type", "text/plain; charset=utf-8");
            res.end("Method Not Allowed");
            return;
          }
          const mod = (await server.ssrLoadModule("/src/lib/health.server.ts")) as {
            handleHealth: () => Promise<Response>;
          };
          const response = await mod.handleHealth();
          res.statusCode = response.status;
          response.headers.forEach((value, key) => res.setHeader(key, value));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (err) {
          console.error("[app-builder] /api/health handler failed:", err);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader("content-type", "text/plain; charset=utf-8");
            res.end("health check failed");
          }
        }
      });
    },
  };
}

// Portal builds (Poki/CrazyGames/itch.io) need a self-contained static zip —
// no server function, since those platforms only host static files. Default
// `build`/`preview` (Vercel SSR) are completely untouched; this only kicks in
// for the explicit `build:portal` script, keyed off npm's own lifecycle env
// var so no new CLI flags/deps are needed.
const isPortalBuild = process.env.npm_lifecycle_event === "build:portal";

// `0.0.0.0:8080` is the dev server address — don't change host/port.
export default defineConfig(({ command, isPreview }) => ({
  server: {
    host: "0.0.0.0",
    port: 8080,
    strictPort: true,
  },
  preview: {
    host: "127.0.0.1",
    port: 8081,
    strictPort: true,
  },
  resolve: { tsconfigPaths: true },
  // Lets client code strip Vercel-platform-only features from the portal
  // bundle — see `src/env.d.ts`.
  define: { __PORTAL_BUILD__: JSON.stringify(isPortalBuild) },
  plugins: [
    pgliteBootstrapPlugin(),
    // Before tanstackStart so /auth/popup never falls through to the SPA.
    authPopupPlugin(),
    // Same reasoning for /api/auth/* — the Better Auth API mount.
    authApiPlugin(),
    // Same reasoning for /api/stripe/webhook.
    stripeWebhookPlugin(),
    // Same reasoning for /api/health.
    healthPlugin(),
    // Dev-only /__app-env, read by scripts/check-auth-invariant.mjs.
    appEnvPlugin(),
    tailwindcss(),
    // Portal builds ship as a plain client SPA (a static shell + client JS,
    // no server round-trip) — the default (non-portal) build keeps full SSR.
    tanstackStart(isPortalBuild ? { spa: { enabled: true } } : {}),
    ...(command === "build" || isPreview
      ? [
          nitro(
            isPortalBuild
              ? // Prerenders every route to plain HTML/CSS/JS — no server
                // function (not needed inside a portal's own iframe/site).
                { preset: "static" }
              : {
                  preset: "vercel",
                  // Auto-registers server/middleware/* (auth, Stripe webhook,
                  // health).
                  serverDir: "./server",
                  vercel: {
                    config: {
                      // Daily DB keep-alive: the Supabase free tier pauses a
                      // project after ~7 idle days, which takes sign-in, cloud
                      // save and the leaderboard down. Daily is also the most
                      // frequent schedule Vercel's Hobby plan allows.
                      crons: [{ path: "/api/health", schedule: "17 9 * * *" }],
                    },
                  },
                },
          ),
        ]
      : []),
    viteReact(),
  ],
}));
