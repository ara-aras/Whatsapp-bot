import { describe, it, expect, beforeEach, vi } from "vitest";

const redisState = vi.hoisted(() => ({ down: false, store: {} as Record<string, number> }));
vi.mock("../../storage/redisClient", () => ({
  redis: {
    incr: vi.fn(async (key: string) => {
      if (redisState.down) throw new Error("Reached the max retries per request limit");
      redisState.store[key] = (redisState.store[key] || 0) + 1;
      return redisState.store[key];
    }),
    expire: vi.fn(async () => 1),
  },
}));

import {
  checkOutbound,
  checkOutboundMemory,
  resetOutboundMemory,
  OUTGOING_PER_JID_PER_MIN,
} from "../../security/outboundGuard";

const T = 60_000 * 1000; // start of a minute bucket

describe("outboundGuard", () => {
  beforeEach(() => {
    redisState.down = false;
    redisState.store = {};
    resetOutboundMemory();
    delete process.env.OUTGOING_GLOBAL_PER_MIN;
  });

  it("caps sends per recipient", async () => {
    for (let i = 0; i < OUTGOING_PER_JID_PER_MIN; i++) {
      expect((await checkOutbound("a@s.whatsapp.net", T)).denied).toBeNull();
    }
    const v = await checkOutbound("a@s.whatsapp.net", T);
    expect(v.denied).toBe("per_recipient");
    expect(v.source).toBe("redis");
  });

  it("caps sends across the whole account", async () => {
    process.env.OUTGOING_GLOBAL_PER_MIN = "3";
    for (let i = 0; i < 3; i++) expect((await checkOutbound(`u${i}@s.whatsapp.net`, T)).denied).toBeNull();
    expect((await checkOutbound("u9@s.whatsapp.net", T)).denied).toBe("global");
  });

  it("keeps enforcing from memory when Redis is down instead of failing open", async () => {
    redisState.down = true;
    process.env.OUTGOING_GLOBAL_PER_MIN = "4";
    const verdicts = [];
    for (let i = 0; i < 6; i++) verdicts.push(await checkOutbound(`u${i}@s.whatsapp.net`, T));
    expect(verdicts.map((v) => v.source)).toEqual(Array(6).fill("memory"));
    expect(verdicts.slice(0, 4).every((v) => v.denied === null)).toBe(true);
    expect(verdicts[4].denied).toBe("global");
    expect(verdicts[5].denied).toBe("global");
  });

  it("resets the in-memory counters each minute", () => {
    for (let i = 0; i < OUTGOING_PER_JID_PER_MIN; i++) checkOutboundMemory("a", T);
    expect(checkOutboundMemory("a", T).denied).toBe("per_recipient");
    expect(checkOutboundMemory("a", T + 60_000).denied).toBeNull();
  });
});
