/**
 * Search Intent Classifier
 *
 * Evaluates whether an inbound user query requires live web search,
 * real-time news retrieval, market pricing, or product recommendations.
 * Inspired by FreshQA and web query intent taxonomy.
 */

export type SearchIntentCategory =
  | "freshness"
  | "news"
  | "pricing"
  | "recommendation"
  | "realtime";

export interface IntentClassificationResult {
  needsSearch: boolean;
  category?: SearchIntentCategory;
  cleanQuery: string;
}

// 1. Temporal & Freshness Patterns
const TEMPORAL_PATTERNS = [
  /\b(?:latest|newest|recent|recently|today|yesterday|now|current|currently|upcoming)\b/i,
  /\b(?:this\s+(?:week|month|year|quarter|weekend))\b/i,
  /\b(?:2025|2026|2027)\b/,
  /\b(?:what(?:'s|\s+is)\s+new)\b/i,
];

// 2. News, Releases & Announcements Patterns
const NEWS_PATTERNS = [
  /\b(?:news|headline|headlines|announcement|announcements|announce|announced)\b/i,
  /\b(?:release|releases|released|launch|launched|unveil|unveiled|reveal|revealed)\b/i,
  /\b(?:changelog|patch\s*notes|release\s*notes|version\s*update)\b/i,
  /\b(?:outage|incident|downtime|is\s+down|status\s+of)\b/i,
];

// 3. Market, Pricing & Financials Patterns
const PRICING_PATTERNS = [
  /\b(?:price\s+of|how\s+much\s+(?:is|does|costs?)|cost\s+of|pricing\s+of)\b/i,
  /\b(?:subscription|tier\s+pricing|plans\s+for|pricing\s+plans)\b/i,
  /\b(?:market\s*cap|valuation\s+of|stock\s+price)\b/i,
];

// 4. Recommendations & Product Comparisons Patterns
const RECOMMENDATION_PATTERNS = [
  /\b(?:recommend|recommendation|recommendations|suggest|suggestion|suggestions)\b/i,
  /\b(?:best\s+[a-z0-9_-]+\s+(?:for|in|to))\b/i,
  /\b(?:top\s+\d+\s+[a-z0-9_-]+)\b/i,
  /\b(?:alternative\s+to|alternatives\s+to)\b/i,
  /\b(?:vs\.?|versus|compared\s+to|which\s+is\s+better)\b/i,
  /\b(?:pros\s+and\s+cons\s+of)\b/i,
];

// 5. Real-Time Lookups Patterns
const REALTIME_PATTERNS = [
  /\b(?:who\s+is\s+currently|who\s+won|winner\s+of|score\s+of)\b/i,
  /\b(?:when\s+is\s+the\s+next|next\s+scheduled)\b/i,
];

// Queries that look like pure syntax / basic coding questions that should NOT search
const STATIC_DEV_PATTERNS = [
  /^how\s+to\s+(?:write|implement|declare|define|loop|parse|convert|sort|map|filter)\b/i,
  /^what\s+is\s+the\s+syntax\s+(?:for|of)\b/i,
  /^explain\s+(?:closure|recursion|polymorphism|interface|pointer|memoization|big\s*o)\b/i,
];

/**
 * Strips command prefixes, WhatsApp markdown symbols, and extra whitespace.
 */
export function cleanSearchQuery(rawQuery: string): string {
  if (!rawQuery) return "";
  return rawQuery
    .replace(/^[!/]/, "") // strip leading ! or /
    .replace(/[*_~`]/g, " ") // strip WhatsApp styling
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Classifies an inbound prompt to decide whether live search is needed.
 */
export function classifySearchIntent(prompt: string): IntentClassificationResult {
  const cleanQuery = cleanSearchQuery(prompt);
  if (!cleanQuery || cleanQuery.length < 4) {
    return { needsSearch: false, cleanQuery };
  }

  // Check static dev patterns: if it's purely generic syntax/coding question without temporal keywords
  const isStaticDev = STATIC_DEV_PATTERNS.some((p) => p.test(cleanQuery));
  const hasTemporal = TEMPORAL_PATTERNS.some((p) => p.test(cleanQuery));

  if (isStaticDev && !hasTemporal) {
    return { needsSearch: false, cleanQuery };
  }

  if (hasTemporal) {
    return { needsSearch: true, category: "freshness", cleanQuery };
  }

  if (NEWS_PATTERNS.some((p) => p.test(cleanQuery))) {
    return { needsSearch: true, category: "news", cleanQuery };
  }

  if (PRICING_PATTERNS.some((p) => p.test(cleanQuery))) {
    return { needsSearch: true, category: "pricing", cleanQuery };
  }

  if (RECOMMENDATION_PATTERNS.some((p) => p.test(cleanQuery))) {
    return { needsSearch: true, category: "recommendation", cleanQuery };
  }

  if (REALTIME_PATTERNS.some((p) => p.test(cleanQuery))) {
    return { needsSearch: true, category: "realtime", cleanQuery };
  }

  return { needsSearch: false, cleanQuery };
}
