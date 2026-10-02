import { describe, it, expect } from "vitest";
import {
  classifySearchIntent,
  cleanSearchQuery,
} from "../../services/search/searchIntentClassifier";

describe("searchIntentClassifier", () => {
  it("cleans command prefixes and WhatsApp formatting characters", () => {
    expect(cleanSearchQuery("!*What is the latest* _news_?")).toBe("What is the latest news ?");
    expect(cleanSearchQuery("!recommend a good phone")).toBe("recommend a good phone");
    expect(cleanSearchQuery("/news today")).toBe("news today");
  });

  it("detects temporal & freshness queries", () => {
    const res1 = classifySearchIntent("What is the latest update on DeepSeek?");
    expect(res1.needsSearch).toBe(true);
    expect(res1.category).toBe("freshness");

    const res2 = classifySearchIntent("What happened today in tech?");
    expect(res2.needsSearch).toBe(true);
    expect(res2.category).toBe("freshness");

    const res3 = classifySearchIntent("Best AI tools in 2026");
    expect(res3.needsSearch).toBe(true);
    expect(res3.category).toBe("freshness");
  });

  it("detects news and release queries", () => {
    const res1 = classifySearchIntent("Did OpenAI announce a new model?");
    expect(res1.needsSearch).toBe(true);
    expect(res1.category).toBe("news");

    const res2 = classifySearchIntent("Is GitHub down right now? Check status");
    expect(res2.needsSearch).toBe(true);
    expect(res2.category).toBe("freshness"); // 'now' matches freshness first or news
  });

  it("detects pricing and market queries", () => {
    const res = classifySearchIntent("What is the price of Claude Pro subscription?");
    expect(res.needsSearch).toBe(true);
    expect(res.category).toBe("pricing");
  });

  it("detects product recommendations and comparisons", () => {
    const res1 = classifySearchIntent("Can you recommend a good mechanical keyboard for coding?");
    expect(res1.needsSearch).toBe(true);
    expect(res1.category).toBe("recommendation");

    const res2 = classifySearchIntent("Next.js vs Remix which is better for a new project?");
    expect(res2.needsSearch).toBe(true);
    expect(res2.category).toBe("recommendation");
  });

  it("bypasses static developer questions without freshness keywords", () => {
    const res1 = classifySearchIntent("How to sort an array in javascript");
    expect(res1.needsSearch).toBe(false);

    const res2 = classifySearchIntent("What is the syntax for a Rust closure");
    expect(res2.needsSearch).toBe(false);

    const res3 = classifySearchIntent("Explain recursion in Python");
    expect(res3.needsSearch).toBe(false);
  });

  it("handles very short or empty prompts", () => {
    expect(classifySearchIntent("hi").needsSearch).toBe(false);
    expect(classifySearchIntent("").needsSearch).toBe(false);
  });
});
