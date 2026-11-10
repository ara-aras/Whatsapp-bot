import http from "http";
import crypto from "crypto";
import fs from "fs";
import * as nodePath from "path";
import { getBotStatus, isHealthy } from "./botStatus";
import { renderAdminPage } from "./adminPage";
import { handleAdminApi } from "./adminApi";
import { handlePublicApi } from "../api/publicApi";
import { clientIp, isBlocked, recordAuthFailure, recordAuthSuccess } from "./authThrottle";

let isHealthServerStarted = false;

/**
 * Admin auth: single shared token from ADMIN_TOKEN, sent as
 * `Authorization: Bearer <token>`. Constant-time compare, and a failure
 * counter per client address (authThrottle.ts, shared with /api/v1) so the
 * token can't be brute-forced through a public URL.
 */
function isAuthorized(req: http.IncomingMessage): boolean {
  const expected = process.env.ADMIN_TOKEN || "";
  if (!expected) return false;
  const ip = clientIp(req);
  if (isBlocked(ip)) return false;

  const header = req.headers.authorization || "";
  const presented = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);

  if (ok) {
    recordAuthSuccess(ip);
    return true;
  }
  recordAuthFailure(ip);
  return false;
}

// Only these image types live in assets/, and only a flat file name is
// accepted: no separators, no dot-segments, no empty name.
const ASSET_NAME = /^[a-zA-Z0-9_-]+\.(png|webp|jpe?g)$/i;
const ASSET_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

function notFound(res: http.ServerResponse): void {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
}

function serveAsset(res: http.ServerResponse, name: string): void {
  if (!ASSET_NAME.test(name)) return notFound(res);
  const assetPath = nodePath.join(process.cwd(), "assets", name);
  fs.stat(assetPath, (err, st) => {
    // isFile() matters: a directory passes existsSync, then the read stream
    // fails with EISDIR, which used to be an uncaught error that killed the
    // process on an unauthenticated request.
    if (err || !st.isFile()) return notFound(res);
    const stream = fs.createReadStream(assetPath);
    stream.on("error", () => notFound(res));
    stream.once("open", () => {
      res.writeHead(200, {
        "Content-Type": ASSET_TYPES[nodePath.extname(name).toLowerCase()] || "application/octet-stream",
        "Cache-Control": "public, max-age=86400",
      });
      stream.pipe(res);
    });
  });
}

function json(res: http.ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

export function startHealthServer(): void {
  if (isHealthServerStarted) {
    return;
  }

  isHealthServerStarted = true;
  const port = Number(process.env.PORT || 3000);
  const adminEnabled = !!process.env.ADMIN_TOKEN;

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://localhost");
    const path = url.pathname;

    if (path === "/health") {
      // 503 when the socket isn't open so Render's health check (and any
      // uptime monitor) sees "down" instead of a green process with a dead WA link.
      const s = getBotStatus();
      const healthy = isHealthy();
      json(res, healthy ? 200 : 503, {
        status: healthy ? "ok" : "degraded",
        service: "mahoraga",
        state: s.state,
        lastOpenAt: s.lastOpenAt,
      });
      return;
    }

    if (path.startsWith("/api/v1/")) {
      const route = path.slice("/api/v1/".length);
      handlePublicApi(req, res, route).catch((err) => {
        console.error("[api] handler error:", err);
        if (!res.headersSent) json(res, 500, { error: "internal" });
      });
      return;
    }

    if (adminEnabled && path === "/admin") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end(renderAdminPage());
      return;
    }

    if (adminEnabled && path.startsWith("/admin/asset/")) {
      serveAsset(res, path.slice("/admin/asset/".length));
      return;
    }

    if (adminEnabled && path.startsWith("/admin/api/")) {
      if (!isAuthorized(req)) {
        json(res, 401, { error: "unauthorized" });
        return;
      }
      const route = path.slice("/admin/api/".length);
      handleAdminApi(req, res, route).catch((err) => {
        console.error("[admin] handler error:", err);
        if (!res.headersSent) json(res, 500, { error: "internal" });
      });
      return;
    }

    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("MAHORAGA is running");
  });

  server.listen(port, () => {
    console.log(`Health server listening on port ${port}${adminEnabled ? " (admin dashboard at /admin)" : ""}`);
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err && err.code === "EADDRINUSE") {
      console.warn(
        `Health server port ${port} already in use. Continuing without health endpoint.`,
      );
      return;
    }
    console.error("Health server error:", err);
    throw err;
  });
}
