import type { SearchResponse, SearchResult } from "../searchService";

/**
 * Brave Search API (https://brave.com/search/api/), env BRAVE_API_KEY.
 *
 * Provides privacy-preserving search over an independent web index.
 * Free tier offers 2,000 queries per month.
 */
export interface BraveOptions {
  count?: number;
  days?: number;
}

export function isBraveConfigured(): boolean {
  return !!process.env.BRAVE_API_KEY;
}

export async function searchWithBrave(
  query: string,
  opts: BraveOptions = {},
): Promise<SearchResponse | null> {
  const apiKey = process.env.BRAVE_API_KEY;
  if (!apiKey) return null;

  try {
    const count = opts.count ?? 5;
    let freshnessParam = "";
    if (opts.days && opts.days > 0) {
      const freshness = opts.days <= 1 ? "pd" : opts.days <= 7 ? "pw" : "pm";
      freshnessParam = `&freshness=${freshness}`;
    }
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}${freshnessParam}`;
    const fetchFn = (globalThis as any).fetch ?? (await import("node-fetch")).default;

    const res = await fetchFn(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": apiKey,
      },
    });

    if (!res.ok) {
      console.warn("[Brave] HTTP", res.status, (await res.text()).slice(0, 160));
      return null;
    }

    const data = await res.json();
    const results: SearchResult[] = [];

    if (Array.isArray(data?.web?.results)) {
      for (const item of data.web.results) {
        if (item?.title && (item?.description || item?.snippet)) {
          results.push({
            title: String(item.title).trim(),
            url: String(item.url || ""),
            content: String(item.description || item.snippet || "").trim(),
            publishedDate: item.page_age || item.age || undefined,
          });
        }
      }
    }

    return { provider: "tavily", results };
  } catch (err) {
    console.warn("[Brave] Search failed:", err);
    return null;
  }
}
