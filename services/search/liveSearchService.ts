/**
 * Live Search & News Service
 *
 * Provides real-time web search and news snippets for Level 2 bots.
 * Uses a multi-tier cascade:
 *   1. Redis cache lookup (15 min TTL)
 *   2. Tavily AI Search API (if TAVILY_API_KEY is configured)
 *   3. Brave Web Search API (if BRAVE_API_KEY is configured)
 *   4. DuckDuckGo HTML / instant answer fallback (zero API key)
 *   5. Strict 5-second timeout with graceful fallback
 */

import crypto from "crypto";

export interface SearchResultItem {
  title: string;
  url: string;
  snippet: string;
  publishedDate?: string;
}

const SEARCH_TIMEOUT_MS = Number(process.env.SEARCH_TIMEOUT_MS) || 5000;
const CACHE_TTL_SECONDS = 15 * 60; // 15 minutes

/**
 * Executes Tavily search API.
 */
async function searchTavily(
  query: string,
  apiKey: string,
  fetchFn: typeof fetch,
  isRecencySensitive: boolean = false,
): Promise<SearchResultItem[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);

  try {
    const body: Record<string, any> = {
      api_key: apiKey,
      query,
      search_depth: "advanced",
      max_results: 5,
      include_answer: true,
    };
    if (isRecencySensitive) {
      body.topic = "news";
      body.days = 4;
    }

    const res = await fetchFn("https://api.tavily.com/search", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`Tavily HTTP ${res.status}`);
    }

    const data: any = await res.json();
    const results: SearchResultItem[] = [];

    if (data?.answer) {
      results.push({
        title: "Quick Summary",
        url: "https://tavily.com",
        snippet: String(data.answer).trim(),
      });
    }

    if (Array.isArray(data?.results)) {
      for (const item of data.results.slice(0, 5)) {
        if (item?.title && (item?.content || item?.snippet)) {
          results.push({
            title: String(item.title).trim(),
            url: String(item.url || ""),
            snippet: String(item.content || item.snippet).slice(0, 300).trim(),
            publishedDate: item.published_date || undefined,
          });
        }
      }
    }

    return results;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Executes Brave Search API.
 * Free tier: 2,000 requests/month (https://brave.com/search/api/)
 */
async function searchBrave(
  query: string,
  apiKey: string,
  fetchFn: typeof fetch,
  isRecencySensitive: boolean = false,
): Promise<SearchResultItem[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);

  try {
    const freshnessParam = isRecencySensitive ? "&freshness=pw" : "";
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5${freshnessParam}`;
    const res = await fetchFn(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": apiKey,
      },
    });

    if (!res.ok) {
      throw new Error(`Brave Search HTTP ${res.status}`);
    }

    const data: any = await res.json();
    const results: SearchResultItem[] = [];

    if (Array.isArray(data?.web?.results)) {
      for (const item of data.web.results.slice(0, 5)) {
        if (item?.title && (item?.description || item?.snippet)) {
          results.push({
            title: String(item.title).trim(),
            url: String(item.url || ""),
            snippet: String(item.description || item.snippet || "").slice(0, 300).trim(),
            publishedDate: item.page_age || item.age || undefined,
          });
        }
      }
    }

    return results;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Free DuckDuckGo HTML fallback parser (requires no API key).
 */
async function searchDuckDuckGo(
  query: string,
  fetchFn: typeof fetch,
): Promise<SearchResultItem[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);

  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const res = await fetchFn(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    if (!res.ok) {
      throw new Error(`DuckDuckGo HTTP ${res.status}`);
    }

    const html = await res.text();
    const results: SearchResultItem[] = [];

    // Parse snippet links from DuckDuckGo HTML
    // Snippets are inside <a class="result__snippet" ...> or <div class="result__snippet">
    const resultBlockRegex =
      /<h2 class="result__title">[\s\S]*?<a class="result__url"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

    let match;
    while ((match = resultBlockRegex.exec(html)) !== null && results.length < 3) {
      const rawUrl = match[1] || "";
      const rawTitle = match[2] || "";
      const rawSnippet = match[3] || "";

      // Clean HTML tags and decode basic entities
      const cleanTitle = rawTitle.replace(/<[^>]+>/g, "").trim();
      const cleanSnippet = rawSnippet.replace(/<[^>]+>/g, "").trim();

      // DuckDuckGo redirects URLs through /l/?kh=-1&uddg=...
      let actualUrl = rawUrl;
      const uddgMatch = rawUrl.match(/uddg=([^&]+)/);
      if (uddgMatch && uddgMatch[1]) {
        try {
          actualUrl = decodeURIComponent(uddgMatch[1]);
        } catch {
          actualUrl = rawUrl;
        }
      }

      if (cleanTitle && cleanSnippet) {
        results.push({
          title: cleanTitle,
          url: actualUrl,
          snippet: cleanSnippet.slice(0, 250),
        });
      }
    }

    return results;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Formats structured search results into concise XML context for LLM injection.
 */
export function formatSearchContext(query: string, items: SearchResultItem[]): string {
  if (!items || items.length === 0) return "";

  const lines = [
    "<live_web_context>",
    `TOP RECENT WEB SEARCH RESULTS FOR: "${query}"`,
    `Fetched at: ${new Date().toISOString().split("T")[0]}`,
    "",
  ];

  items.forEach((item, idx) => {
    lines.push(`${idx + 1}. ${item.title}`);
    if (item.publishedDate) {
      lines.push(`   Published: ${item.publishedDate}`);
    }
    if (item.url && item.url.startsWith("http")) {
      lines.push(`   Source: ${item.url}`);
    }
    lines.push(`   Snippet: ${item.snippet}`);
    lines.push("");
  });

  lines.push("</live_web_context>");
  return lines.join("\n").trim();
}

/**
 * Searches the web using the multi-tier cascade and Redis caching.
 * Returns formatted XML context or null if search fails/times out.
 */
export async function getLiveSearchContext(
  query: string,
  fetchFn: typeof fetch = (globalThis as any).fetch,
  skipCache: boolean = false,
): Promise<string | null> {
  const trimmed = (query || "").trim();
  if (!trimmed) return null;

  const queryHash = crypto
    .createHash("sha1")
    .update(trimmed.toLowerCase())
    .digest("hex");
  const cacheKey = `search_cache:${queryHash}`;

  const { RECENCY_SENSITIVE_PATTERNS } = await import("./searchService");
  const isRecencySensitive = RECENCY_SENSITIVE_PATTERNS.some((p) => p.test(trimmed));

  // 1. Try Redis cache (skip for recency-sensitive queries to stay up-to-the-minute fresh)
  if (!skipCache && !isRecencySensitive) {
    try {
      const { redis } = await import("../../storage/redisClient");
      const cached = await redis.get(cacheKey);
      if (cached) {
        return cached;
      }
    } catch {
      /* fail open */
    }
  }

  let items: SearchResultItem[] = [];

  // When running with native fetch, leverage the multi-provider fan-out (Tavily, Brave, Exa, Firecrawl)
  const isDefaultFetch = fetchFn === (globalThis as any).fetch;
  const hasProviderKey = !!(
    process.env.TAVILY_API_KEY ||
    process.env.BRAVE_API_KEY ||
    process.env.EXA_API_KEY ||
    process.env.FIRECRAWL_API_KEY
  );

  if (isDefaultFetch && hasProviderKey) {
    try {
      const { searchWeb: searchWebService } = await import("./searchService");
      const resp = await searchWebService(trimmed);
      if (resp?.results?.length) {
        items = resp.results.slice(0, 5).map((r) => ({
          title: r.title,
          url: r.url,
          snippet: r.content.slice(0, 300),
          publishedDate: r.publishedDate,
        }));
      }
    } catch (err) {
      console.warn(
        `[LiveSearch] Fan-out search failed (${err instanceof Error ? err.message : String(err)}), falling back...`,
      );
    }
  }

  // 2. Try Tavily Search API directly if no results yet and key is present
  if (items.length === 0) {
    const tavilyKey = process.env.TAVILY_API_KEY;
    if (tavilyKey) {
      try {
        items = await searchTavily(trimmed, tavilyKey, fetchFn, isRecencySensitive);
      } catch (err) {
        console.warn(
          `[LiveSearch] Tavily failed (${err instanceof Error ? err.message : String(err)}), falling back...`,
        );
      }
    }
  }

  // 3. Try Brave Search API if no results yet and key is present
  if (items.length === 0) {
    const braveKey = process.env.BRAVE_API_KEY;
    if (braveKey) {
      try {
        items = await searchBrave(trimmed, braveKey, fetchFn, isRecencySensitive);
      } catch (err) {
        console.warn(
          `[LiveSearch] Brave Search failed (${err instanceof Error ? err.message : String(err)}), falling back...`,
        );
      }
    }
  }

  // 4. Fallback to DuckDuckGo if no results yet
  if (items.length === 0) {
    try {
      items = await searchDuckDuckGo(trimmed, fetchFn);
    } catch (err) {
      console.warn(
        `[LiveSearch] DuckDuckGo failed (${err instanceof Error ? err.message : String(err)})`,
      );
    }
  }

  if (items.length === 0) {
    return null;
  }

  const formatted = formatSearchContext(trimmed, items);

  // 5. Cache formatted context in Redis (only for non-recency queries)
  if (!isRecencySensitive) {
    try {
      const { redis } = await import("../../storage/redisClient");
      await redis.setex(cacheKey, CACHE_TTL_SECONDS, formatted);
    } catch {
      /* non-fatal */
    }
  }

  return formatted;
}
