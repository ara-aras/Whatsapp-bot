import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "http";
import { startHealthServer } from "../../infrastructure/health/healthServer";
import { configureAdminApi, type AdminDeps } from "../../infrastructure/health/adminApi";
import { markOpen, markClosed, setQr } from "../../infrastructure/health/botStatus";

const PORT = 39321;
const TOKEN = "test-token-123";

function req(
  path: string,
  opts: { method?: string; token?: string } = {},
): Promise<{ status: number; body: string; type: string }> {
  return new Promise((resolve, reject) => {
    const r = http.request(
      {
        host: "127.0.0.1",
        port: PORT,
        path,
        method: opts.method || "GET",
        headers: opts.token ? { Authorization: `Bearer ${opts.token}` } : {},
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () =>
          resolve({ status: res.statusCode || 0, body, type: String(res.headers["content-type"] || "") }),
        );
      },
    );
    r.on("error", reject);
    r.end();
  });
}

const noopList = {
  list: () => [],
  add: async () => true,
  remove: async () => true,
  setBot: async () => true,
  setEnabled: async () => true,
};
let restarted = false;
let relinked = false;
const deps: AdminDeps = {
  restart: () => {
    restarted = true;
  },
  relink: async () => {
    relinked = true;
  },
  groups: noopList,
  chats: noopList,
  discoverGroups: async () => [],
  botLabels: () => ({ 0: "Generic" }),
  normalizeJid: (j) => j,
};

beforeAll(async () => {
  process.env.PORT = String(PORT);
  process.env.ADMIN_TOKEN = TOKEN;
  configureAdminApi(deps);
  startHealthServer();
  // give listen() a tick
  await new Promise((r) => setTimeout(r, 50));
});

afterAll(() => {
  delete process.env.ADMIN_TOKEN;
});

describe("health endpoint", () => {
  it("returns 503 while the socket is not open", async () => {
    markClosed(428, false);
    const res = await req("/health");
    expect(res.status).toBe(503);
    expect(JSON.parse(res.body)).toMatchObject({ status: "degraded", state: "closed" });
  });

  it("returns 200 once the socket is open", async () => {
    markOpen("919999999999@s.whatsapp.net");
    const res = await req("/health");
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ status: "ok", state: "open", service: "mahoraga" });
  });
});

describe("admin dashboard", () => {
  it("serves the page without auth (page itself holds nothing sensitive)", async () => {
    const res = await req("/admin");
    expect(res.status).toBe(200);
    expect(res.type).toMatch(/text\/html/);
    expect(res.body).toContain("MAHORAGA");
  });

  it("rejects API calls without a bearer token", async () => {
    const res = await req("/admin/api/status");
    expect(res.status).toBe(401);
  });

  it("rejects API calls with the wrong token", async () => {
    const res = await req("/admin/api/status", { token: "nope" });
    expect(res.status).toBe(401);
  });

  it("returns status with the right token", async () => {
    markOpen("919999999999@s.whatsapp.net");
    const res = await req("/admin/api/status", { token: TOKEN });
    expect(res.status).toBe(200);
    const j = JSON.parse(res.body);
    expect(j.state).toBe("open");
    expect(j.selfJid).toBe("919999999999@s.whatsapp.net");
    expect(j.qrAvailable).toBe(false);
  });

  it("serves the QR as SVG only when one is pending", async () => {
    const none = await req("/admin/api/qr.svg", { token: TOKEN });
    expect(none.status).toBe(404);

    setQr("2@fakeqrpayload,abc,def");
    const svg = await req("/admin/api/qr.svg", { token: TOKEN });
    expect(svg.status).toBe(200);
    expect(svg.type).toMatch(/image\/svg\+xml/);
    expect(svg.body).toContain("<svg");
    // status flips off "open" once a QR appears
    const st = JSON.parse((await req("/admin/api/status", { token: TOKEN })).body);
    expect(st.qrAvailable).toBe(true);
    expect(st.state).toBe("connecting");
  });

  it("invokes registered actions and replies 202 before running them", async () => {
    const r1 = await req("/admin/api/restart", { method: "POST", token: TOKEN });
    expect(r1.status).toBe(202);
    const r2 = await req("/admin/api/relink", { method: "POST", token: TOKEN });
    expect(r2.status).toBe(202);
    await new Promise((r) => setTimeout(r, 200));
    expect(restarted).toBe(true);
    expect(relinked).toBe(true);
  });

  it("refuses GET on mutating routes", async () => {
    const res = await req("/admin/api/restart", { token: TOKEN });
    expect(res.status).toBe(404);
  });

  it("serves a real asset and survives every malformed asset path", async () => {
    const ok = await req("/admin/asset/mahoraga_wheel.jpg");
    expect(ok.status).toBe(200);
    expect(ok.type).toBe("image/jpeg");

    // "/admin/asset/" used to resolve to the assets directory and crash the
    // process with an uncaught EISDIR.
    for (const p of [
      "/admin/asset/",
      "/admin/asset/.",
      "/admin/asset/..%2f.env",
      "/admin/asset/..",
      "/admin/asset/nope.png",
      "/admin/asset/mahoraga_wheel.jpg/",
      "/admin/asset/.env",
    ]) {
      const res = await req(p);
      expect(res.status, p).not.toBe(500);
      expect(res.type, p).not.toMatch(/image/);
    }
    // Still alive afterwards.
    expect((await req("/health")).status).toBeGreaterThan(0);
  });

  it("locks an IP out after repeated bad tokens", async () => {
    for (let i = 0; i < 10; i++) await req("/admin/api/status", { token: "wrong" + i });
    // Even the right token is refused while blocked.
    const res = await req("/admin/api/status", { token: TOKEN });
    expect(res.status).toBe(401);
  });
});
