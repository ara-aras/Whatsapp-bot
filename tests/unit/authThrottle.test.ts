import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  clientIp,
  isBlocked,
  recordAuthFailure,
  recordAuthSuccess,
  resetAuthThrottle,
  trackedAddressCount,
} from "../../infrastructure/health/authThrottle";

function fakeReq(remote: string, xff?: string): any {
  return { socket: { remoteAddress: remote }, headers: xff ? { "x-forwarded-for": xff } : {} };
}

describe("authThrottle", () => {
  beforeEach(() => {
    resetAuthThrottle();
    delete process.env.TRUST_PROXY_HOPS;
  });
  afterEach(() => {
    delete process.env.TRUST_PROXY_HOPS;
  });

  it("ignores X-Forwarded-For unless a proxy is trusted", () => {
    expect(clientIp(fakeReq("10.0.0.9", "1.2.3.4"))).toBe("10.0.0.9");
  });

  it("takes the address written by the trusted proxy, not the client-supplied one", () => {
    process.env.TRUST_PROXY_HOPS = "1";
    // The client forged the first entry; the proxy appended the real one.
    expect(clientIp(fakeReq("10.0.0.9", "6.6.6.6, 203.0.113.7"))).toBe("203.0.113.7");
    process.env.TRUST_PROXY_HOPS = "2";
    expect(clientIp(fakeReq("10.0.0.9", "6.6.6.6, 203.0.113.7, 10.0.0.1"))).toBe("203.0.113.7");
  });

  it("falls back to the socket address when the header is missing or too short", () => {
    process.env.TRUST_PROXY_HOPS = "2";
    expect(clientIp(fakeReq("10.0.0.9", "203.0.113.7"))).toBe("10.0.0.9");
    expect(clientIp(fakeReq("10.0.0.9"))).toBe("10.0.0.9");
    expect(clientIp({ headers: {} } as any)).toBe("unknown");
  });

  it("blocks after 10 failures and unblocks after the block window", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 9; i++) recordAuthFailure("a", t0 + i);
    expect(isBlocked("a", t0 + 10)).toBe(false);
    recordAuthFailure("a", t0 + 10);
    expect(isBlocked("a", t0 + 11)).toBe(true);
    expect(isBlocked("b", t0 + 11)).toBe(false);
    expect(isBlocked("a", t0 + 10 + 15 * 60 * 1000 + 1)).toBe(false);
  });

  it("forgets a stale failure streak and clears on success", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 9; i++) recordAuthFailure("a", t0);
    recordAuthFailure("a", t0 + 16 * 60 * 1000); // streak expired: counts as the first
    expect(isBlocked("a", t0 + 16 * 60 * 1000 + 1)).toBe(false);

    for (let i = 0; i < 9; i++) recordAuthFailure("c", t0);
    recordAuthSuccess("c");
    recordAuthFailure("c", t0 + 1);
    expect(isBlocked("c", t0 + 2)).toBe(false);
  });

  it("stays bounded under a flood of distinct addresses", () => {
    for (let i = 0; i < 6000; i++) recordAuthFailure(`ip-${i}`, 1_000_000 + i);
    expect(trackedAddressCount()).toBeLessThanOrEqual(5000);
  });
});
