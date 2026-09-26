import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../storage/db", () => ({
  getPool: () => null,
  withTransaction: vi.fn(),
}));

import {
  computeStage,
  getEventsForMonth,
  mapApiEvent,
  monthYearOf,
  parseCalendarPayload,
  _resetEventsState,
} from "../../storage/DKB/eventRepository";
import { contentHash, _resetDk24Backoff } from "../../storage/DKB/dk24Api";

function apiEvent(id: string, start: string, end: string, title = id) {
  return {
    id,
    title,
    startDateTime: start,
    endDateTime: end,
    location: "Mangaluru",
    description: "desc",
    registrationLink: "",
    joinLink: "",
    organizationName: "DK24",
    tags: ["Meetup"],
  };
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

// Lets fire-and-forget background refreshes settle.
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("monthYearOf", () => {
  it("buckets by India time, not server time", () => {
    // 2026-10-01 00:30 IST is still Sep 30 in UTC.
    expect(monthYearOf(new Date("2026-09-30T19:00:00Z"))).toBe("oct-2026");
    expect(monthYearOf(new Date("2026-09-22T09:00:00+05:30"))).toBe("sep-2026");
  });

  it("returns null for invalid dates", () => {
    expect(monthYearOf(new Date("nope"))).toBeNull();
  });
});

describe("computeStage", () => {
  const start = new Date("2026-09-22T09:00:00+05:30");
  const end = new Date("2026-09-23T15:00:00+05:30");

  it("tracks the clock", () => {
    expect(computeStage(start, end, new Date("2026-09-01T00:00:00Z"))).toBe("Upcoming");
    expect(computeStage(start, end, new Date("2026-09-22T12:00:00+05:30"))).toBe("Active / Ongoing");
    expect(computeStage(start, end, new Date("2026-09-27T00:00:00Z"))).toBe("Completed / Concluded");
  });
});

describe("parseCalendarPayload", () => {
  it("rejects a single-month response served from the edge cache", () => {
    expect(() => parseCalendarPayload({ month: "sep-2026", events: [] })).toThrow(/single-month/);
  });

  it("rejects a payload without events", () => {
    expect(() => parseCalendarPayload({} as any)).toThrow(/no events array/);
  });

  it("accepts the full list", () => {
    expect(parseCalendarPayload({ events: [] })).toEqual([]);
  });
});

describe("mapApiEvent", () => {
  it("skips events without an id or a valid start", () => {
    expect(mapApiEvent(apiEvent("", "2026-09-22T09:00:00+05:30", "2026-09-23T09:00:00+05:30"))).toBeNull();
    expect(mapApiEvent(apiEvent("x", "not a date", "2026-09-23T09:00:00+05:30"))).toBeNull();
  });

  it("maps fields and formats the date in IST", () => {
    const e = mapApiEvent(apiEvent("a1", "2026-09-22T09:00:00+05:30", "2026-09-23T15:00:00+05:30"))!;
    expect(e.month_year).toBe("sep-2026");
    expect(e.host).toBe("DK24");
    expect(e.date).toBe("Start: Sep 22, 2026 09:00 | End: Sep 23, 2026 15:00");
  });
});

describe("contentHash", () => {
  it("ignores ordering of records and keys", () => {
    const a = [{ id: "1", x: 1, y: 2 }, { id: "2", x: 3 }];
    const b = [{ id: "2", x: 3 }, { y: 2, x: 1, id: "1" }];
    expect(contentHash(a)).toBe(contentHash(b));
    expect(contentHash(a)).not.toBe(contentHash([{ id: "1", x: 1, y: 3 }, { id: "2", x: 3 }]));
  });
});

describe("getEventsForMonth (no database)", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    _resetEventsState();
    _resetDk24Backoff();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const fullCalendar = {
    version: "v1",
    count: 5,
    events: [
      apiEvent("s1", "2026-09-05T10:00:00+05:30", "2026-09-05T12:00:00+05:30"),
      apiEvent("s2", "2026-09-10T10:00:00+05:30", "2026-09-10T12:00:00+05:30"),
      apiEvent("s3", "2026-09-15T10:00:00+05:30", "2026-09-15T12:00:00+05:30"),
      apiEvent("s4", "2026-09-20T10:00:00+05:30", "2026-09-20T12:00:00+05:30"),
      apiEvent("o1", "2026-10-02T10:00:00+05:30", "2026-10-02T12:00:00+05:30"),
    ],
  };

  it("fetches the full calendar once and buckets months locally", async () => {
    fetchMock.mockResolvedValue(jsonResponse(fullCalendar));

    const sep = await getEventsForMonth("sep-2026");
    const oct = await getEventsForMonth("oct-2026");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/api\/v1\/calendar$/);
    expect(sep.map((e) => e.id)).toEqual(["s1", "s2", "s3", "s4"]); // no 3-per-month cap
    expect(oct.map((e) => e.id)).toEqual(["o1"]);
  });

  it("keeps the previous snapshot when a single-month response comes back", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-27T00:00:00Z"));
    fetchMock.mockResolvedValueOnce(jsonResponse(fullCalendar));
    await getEventsForMonth("sep-2026");

    vi.setSystemTime(new Date("2026-09-27T01:00:00Z")); // past the cooldown
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ version: "v1", month: "jan-2026", count: 0, events: [] }),
    );
    const sep = await getEventsForMonth("sep-2026");
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sep).toHaveLength(4);
    expect(await getEventsForMonth("oct-2026", false)).toHaveLength(1);
  });

  it("does not wipe the snapshot when the backend returns zero events", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-27T00:00:00Z"));
    fetchMock.mockResolvedValueOnce(jsonResponse(fullCalendar));
    await getEventsForMonth("sep-2026");

    vi.setSystemTime(new Date("2026-09-27T01:00:00Z"));
    fetchMock.mockResolvedValueOnce(jsonResponse({ version: "v1", count: 0, events: [] }));
    await getEventsForMonth("sep-2026");
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await getEventsForMonth("sep-2026", false)).toHaveLength(4);
  });

  it("recomputes stage on read even when data is unchanged", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-01T00:00:00Z"));
    fetchMock.mockResolvedValue(jsonResponse(fullCalendar));
    const before = await getEventsForMonth("sep-2026");
    expect(before[0].stage).toBe("Upcoming");

    vi.setSystemTime(new Date("2026-09-06T00:00:00Z"));
    const after = await getEventsForMonth("sep-2026", false);
    expect(after[0].stage).toBe("Completed / Concluded");
  });

  it("backs off after a 429 until Retry-After passes", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: "Too many requests" }, 429, { "Retry-After": "30" }),
    );
    expect(await getEventsForMonth("sep-2026")).toEqual([]);

    // Still inside the back-off window: no second network call.
    await getEventsForMonth("sep-2026");
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
