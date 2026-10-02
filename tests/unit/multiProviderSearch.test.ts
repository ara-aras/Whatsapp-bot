import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { rrfMerge } from "../../services/search/searchService";
import type { SearchResult } from "../../services/search/searchService";
import { searchWithExa, isExaConfigured } from "../../services/search/providers/exa";
import { deepRead } from "../../services/search/providers/reader";

const origFetch = (globalThis as any).fetch;
const origEnv = { ...process.env };

afterEach(() => {
  (globalThis as any).fetch = origFetch;
  process.env = { ...origEnv };
  vi.restoreAllMocks();
});

function r(url: string, content = ""): SearchResult {
  return { title: url, url, content };
}

describe("rrfMerge fusion", () => {
  it("floats a result ranked well by multiple engines to the top", () => {
    const a = [r("https://x.com/a"), r("https://x.com/b"), r("https://x.com/c")];
    const b = [r("https://x.com/b"), r("https://x.com/d"), r("https://x.com/a")];
    const merged = rrfMerge([a, b]);
    // b/a appear in both lists → they should outrank single-list c/d.
    expect(merged[0].url).toMatch(/\/(a|b)$/);
    const keys = merged.map((m) => m.url);
    expect(new Set(keys).size).toBe(keys.length); // deduped
  });

  it("dedups the same URL across www/trailing-slash variants", () => {
    const merged = rrfMerge([
      [r("https://www.x.com/a/")],
      [r("http://x.com/a")],
    ]);
    expect(merged.length).toBe(1);
  });

  it("keeps the richest content variant on merge", () => {
    const merged = rrfMerge([
      [r("https://x.com/a", "short")],
      [r("https://x.com/a", "a much longer body of content")],
    ]);
    expect(merged[0].content).toContain("longer body");
  });
});

describe("Exa provider", () => {
  beforeEach(() => delete process.env.EXA_API_KEY);

  it("is unconfigured without a key and returns null", async () => {
    expect(isExaConfigured()).toBe(false);
    expect(await searchWithExa("anything")).toBeNull();
  });

  it("maps Exa results when configured", async () => {
    process.env.EXA_API_KEY = "k";
    (globalThis as any).fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        results: [
          { title: "One Piece", url: "https://ex.com/op", text: "1122 episodes", score: 0.9, publishedDate: "2026-06-01" },
        ],
      }),
      text: async () => "",
    }));
    const out = await searchWithExa("one piece episode count");
    expect(out?.results[0].url).toBe("https://ex.com/op");
    expect(out?.results[0].content).toContain("1122");
  });
});

describe("Brave provider", () => {
  beforeEach(() => delete process.env.BRAVE_API_KEY);

  it("is unconfigured without a key and returns null", async () => {
    const { isBraveConfigured, searchWithBrave } = await import(
      "../../services/search/providers/brave"
    );
    expect(isBraveConfigured()).toBe(false);
    expect(await searchWithBrave("anything")).toBeNull();
  });

  it("maps Brave results when configured", async () => {
    process.env.BRAVE_API_KEY = "test_brave_token";
    const { searchWithBrave } = await import("../../services/search/providers/brave");

    (globalThis as any).fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        web: {
          results: [
            {
              title: "TypeScript 5.8",
              url: "https://devblogs.microsoft.com/typescript",
              description: "TypeScript 5.8 announcement and features.",
            },
          ],
        },
      }),
      text: async () => "",
    }));

    const out = await searchWithBrave("typescript latest release");
    expect(out?.results[0].url).toBe("https://devblogs.microsoft.com/typescript");
    expect(out?.results[0].content).toContain("TypeScript 5.8");
  });
});

describe("deepRead", () => {
  beforeEach(() => delete process.env.FIRECRAWL_API_KEY);

  it("reads full text via keyless Jina reader when Firecrawl absent", async () => {
    (globalThis as any).fetch = vi.fn(async () => ({
      ok: true,
      text: async () => "Full recipe: mix flour, sugar, bake 20 min.",
    }));
    const out = await deepRead("https://food.com/cake");
    expect(out).toContain("Full recipe");
  });

  it("rejects non-http input", async () => {
    expect(await deepRead("not a url")).toBeNull();
  });
});
