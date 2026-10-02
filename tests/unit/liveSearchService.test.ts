import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  formatSearchContext,
  getLiveSearchContext,
} from "../../services/search/liveSearchService";

describe("liveSearchService", () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...origEnv };
  });

  afterEach(() => {
    process.env = origEnv;
  });

  it("formatSearchContext returns clean XML with sources and snippets", () => {
    const formatted = formatSearchContext("DeepSeek news", [
      {
        title: "DeepSeek Releases V3",
        url: "https://example.com/v3",
        snippet: "DeepSeek has officially launched V3 with massive performance improvements.",
      },
    ]);

    expect(formatted).toContain("<live_web_context>");
    expect(formatted).toContain('TOP RECENT WEB SEARCH RESULTS FOR: "DeepSeek news"');
    expect(formatted).toContain("DeepSeek Releases V3");
    expect(formatted).toContain("Source: https://example.com/v3");
    expect(formatted).toContain("</live_web_context>");
  });

  it("handles empty results in formatSearchContext", () => {
    expect(formatSearchContext("query", [])).toBe("");
  });

  it("fetches via Tavily when TAVILY_API_KEY is configured", async () => {
    process.env.TAVILY_API_KEY = "test_tavily_key";

    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        answer: "OpenAI announced GPT-5 yesterday.",
        results: [
          {
            title: "OpenAI Blog",
            url: "https://openai.com/news",
            content: "We are introducing our newest frontier intelligence model.",
          },
        ],
      }),
    });

    const ctx = await getLiveSearchContext("OpenAI news", fakeFetch as any, true);
    expect(fakeFetch).toHaveBeenCalledWith(
      "https://api.tavily.com/search",
      expect.objectContaining({ method: "POST" }),
    );
    expect(ctx).toContain("Quick Summary");
    expect(ctx).toContain("OpenAI announced GPT-5 yesterday");
    expect(ctx).toContain("OpenAI Blog");
  });

  it("falls back to DuckDuckGo when Tavily fails or is unconfigured", async () => {
    delete process.env.TAVILY_API_KEY;

    const fakeHtml = `
      <h2 class="result__title">
        <a class="result__url" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Freact.dev">React 19</a>
        <a class="result__snippet">React 19 includes Actions, useActionState, and server components.</a>
      </h2>
    `;

    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => fakeHtml,
    });

    const ctx = await getLiveSearchContext("React 19 release", fakeFetch as any, true);
    expect(ctx).toContain("React 19");
    expect(ctx).toContain("https://react.dev");
    expect(ctx).toContain("useActionState");
  });

  it("fetches via Brave Search when BRAVE_API_KEY is configured and Tavily is absent", async () => {
    delete process.env.TAVILY_API_KEY;
    process.env.BRAVE_API_KEY = "test_brave_key";

    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        web: {
          results: [
            {
              title: "SpaceX Starship Launch",
              url: "https://spacex.com/launches",
              description: "Starship Flight 7 completed successful orbital test flight.",
            },
          ],
        },
      }),
    });

    const ctx = await getLiveSearchContext("Starship Flight 7", fakeFetch as any, true);
    expect(fakeFetch).toHaveBeenCalledWith(
      expect.stringContaining("https://api.search.brave.com/res/v1/web/search?q=Starship%20Flight%207"),
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          "X-Subscription-Token": "test_brave_key",
        }),
      }),
    );
    expect(ctx).toContain("SpaceX Starship Launch");
    expect(ctx).toContain("Starship Flight 7 completed");
    expect(ctx).toContain("https://spacex.com/launches");
  });

  it("returns null gracefully if all search fetches fail", async () => {
    delete process.env.TAVILY_API_KEY;
    delete process.env.BRAVE_API_KEY;

    const fakeFetch = vi.fn().mockRejectedValue(new Error("Network timeout"));
    const ctx = await getLiveSearchContext("random query", fakeFetch as any, true);
    expect(ctx).toBeNull();
  });
});
