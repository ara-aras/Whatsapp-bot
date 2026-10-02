# Specification & Design: Bot Capability Levels & Live Search Engine

## 1. Executive Summary
This design transforms DKB from a domain-locked community FAQ bot into a tiered intelligence assistant with configurable capability levels (`-lvl 1|2`).
- **Level 1 (Standard Community)**: Fast, offline community assistant for DK24 (clubs, events, mentors, projects) with domain guardrails.
- **Level 2 (Live Info & Intelligence)**: Open intelligence assistant equipped with an automated multi-provider live search engine, real-time news retrieval, product/tech recommendations, and domain lock bypass.
- **Level 3**: Explicitly reserved for future deep reasoning / autonomous agent extensions.

---

## 2. Understanding Summary
* **What**: Granular per-group/per-chat capability levels (`-lvl 1|2`) and a live web search/news engine with intent detection.
* **Why**: Users in developer groups frequently require real-time information, latest tech news, and recommendations that static LLMs cannot provide, while community admins still need conservative FAQ bots in formal channels.
* **Who**: WhatsApp group/chat admins configuring bot tiers, and end users interacting with DKB.
* **Constraints**:
  - Running on Android (Termux/Debian): strict timeouts (5s max for search), Redis caching (15m TTL), low memory footprint.
  - Zero-breaking changes: all existing groups without `-lvl` default to Level 1.
  - Resilience: 100% graceful fallback to intrinsic LLM knowledge if external search fails.
* **Non-Goals**: Modifying the admin Self Bot (`!!`) or implementing deep web scraping of entire websites.

---

## 3. Assumptions
1. `level` defaults to `1` across all databases and JSON configurations when not specified.
2. If `TAVILY_API_KEY` is present in `.env`, it acts as the primary high-fidelity search provider; otherwise, DuckDuckGo / Tech RSS acts as a zero-key fallback.
3. Search snippets are bounded to a maximum of 600 tokens in the prompt to prevent context bloat and minimize latency.

---

## 4. Decision Log

| ID | Decision | Alternatives Considered | Rationale |
| :--- | :--- | :--- | :--- |
| **DEC-01** | Modular Capability Pipeline | Tool-calling agent loop, fixed keyword heuristics | Single LLM pass minimizes roundtrip latency on mobile while providing seamless natural UX. |
| **DEC-02** | Capability Level Flag (`-lvl 1\|2`) | Separate bot IDs, global environment flag | Enables per-group granular control without changing existing bot ID conventions. |
| **DEC-03** | Default Level = 1 | Default Level = 2 | Ensures 100% backward compatibility for existing groups without unexpected search overhead. |
| **DEC-04** | Multi-Tier Search Cascade | Single search provider | High-speed Tavily search when configured; zero-config DuckDuckGo/RSS fallback ensures the bot never fails. |
| **DEC-05** | Redis Search Cache (15m TTL) | In-memory cache, no cache | Persists across restarts and prevents rate-limit exhaustion when multiple members discuss trending topics. |
| **DEC-06** | Structured Intent Taxonomy | Minimal 3-word regex | Robust classification across 5 search intents: Temporal Freshness, Tech/Industry News, Recommendations, Comparisons, and Real-Time Lookups. |

---

## 5. Detailed Architecture

### 5.1 Configuration & Storage Schema
- **JSON Files (`allowed-groups.json`, `allowed-chats.json`)**:
  ```json
  [
    { "jid": "12036304...88@g.us", "botNumber": 2, "level": 2 }
  ]
  ```
- **PostgreSQL (`allowed_groups`, `allowed_chats`)**:
  ```sql
  ALTER TABLE allowed_groups ADD COLUMN IF NOT EXISTS level INT NOT NULL DEFAULT 1;
  ALTER TABLE allowed_chats ADD COLUMN IF NOT EXISTS level INT NOT NULL DEFAULT 1;
  ```
- **Allowlist Controller CLI**:
  - `!add -g <jid> -bid 2 -lvl 2`
  - `!add -bid 2 -lvl 2`
  - `!edit -bid 2 -lvl 2`
  - `!edit -gid <id> -lvl 2`
  - Input validation: `1 <= level <= 2`, rejects other integers with friendly usage text.

### 5.2 Search Intent Classifier (`services/search/searchIntentClassifier.ts`)
Evaluates user queries against 5 curated categories:
1. **Temporal Freshness**: "latest", "today", "yesterday", "recent", "current", "upcoming", "2026", "this week"
2. **Tech & Industry News**: "news", "announcement", "release", "patch notes", "changelog", "launched", "incident", "status"
3. **Market & Pricing**: "price of", "cost of", "plans", "pricing", "market cap"
4. **Product Recommendations & Comparisons**: "best ... for", "top ... in", "recommend a", "alternative to", "vs", "which is better"
5. **Real-Time Factual Lookups**: "who is current", "who won", "score of", "is ... down"

### 5.3 Live Search Service (`services/search/liveSearchService.ts`)
- **Key Methods**:
  - `search(query: string): Promise<SearchResult[]>`
  - Checks Redis key `search_cache:<sha1(query)>` (TTL: 900s).
  - Tries `TavilySearchProvider` (timeout: 5000ms).
  - Falls back to `DuckDuckGoSearchProvider` / RSS feeds (timeout: 5000ms).
  - Returns formatted markdown snippets.

### 5.4 DKB Handler Execution
```
User Query
   │
   ▼
Static sub-command? (!clubs, !events, !mentors, etc.)
 ├── YES ──► Execute sub-command directly
 └── NO
      │
      ▼
Check botLevel for this Chat/Group:
 ├── Level 1:
 │     ├── Check Domain Lock (isCommunityQuery)
 │     ├── If not community & locked ──► Return "I support DK24..."
 │     └── If community ──► Direct LLM with DK24 dynamic database context
 │
 └── Level 2:
       ├── Bypass Domain Lock completely
       ├── Run Search Intent Taxonomy Matcher
       ├── If search needed ──► Fetch live web/news results (Tavily/DDG/RSS)
       └── Single LLM generation with Live Context + DK24 DB Context
```

---

## 6. Testing & Validation Strategy
1. **Unit Tests**:
   - `tests/unit/allowlistLevel.test.ts`: `-lvl` parsing, validation, and JSON/DB persistence.
   - `tests/unit/searchIntentClassifier.test.ts`: classification accuracy across the 5 categories and static bypasses.
   - `tests/unit/liveSearchService.test.ts`: provider cascading, Redis caching, timeout handling.
2. **Integration Tests**:
   - `tests/unit/dkbLevelIntegration.test.ts`: Level 1 domain-lock enforcement vs. Level 2 live intelligence.
