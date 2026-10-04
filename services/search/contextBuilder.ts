import type { SearchResponse } from "./searchService";

export function buildSearchContext(response: SearchResponse, maxResults = 5): string {
  const lines: string[] = [];
  lines.push(`[Search Provider]\n${response.provider.charAt(0).toUpperCase() + response.provider.slice(1)}`);

  if (response.answer) {
    lines.push(`\n[Direct Answer]\n${response.answer}`);
  }

  const limited = response.results.slice(0, maxResults);
  limited.forEach((r, i) => {
    lines.push(`\n[Result ${i + 1}]`);
    lines.push(`Title: ${r.title}`);
    lines.push(`URL: ${r.url}`);
    if (r.publishedDate) lines.push(`Published: ${r.publishedDate}`);
    lines.push(`Content: ${r.content.slice(0, 600)}`);
  });

  return lines.join("\n");
}

export const WEB_RAG_INSTRUCTIONS = [
  "You are answering from the web search results below. Follow these rules:",
  "- Lead with the direct answer/key fact in the first sentence.",
  "- Judge recency against the current date above; prefer the newest sources (see each result's Published date).",
  "- If the answer has a date/time (a match result, a release, an event), state it explicitly.",
  "- If the data isn't truly up-to-the-second (e.g. a live score), say what time/date the info is from instead of claiming it's live — do NOT invent a live figure.",
  "- Be concise. At most one short caveat; no long disclaimers or lists of other sites to check.",
  "- If the results genuinely don't answer the question, say so plainly.",
  "- Avoid unnecessary bolding or asterisks (*word* or **word**). Keep text natural, clean, and simple.",
].join("\n");

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export function nowIST(): Date {
  return new Date(Date.now() + IST_OFFSET_MS);
}

export function formatISTDate(d: Date = nowIST()): string {
  const ist = new Date(d.getTime() + IST_OFFSET_MS);
  return ist.toISOString().replace("T", " ").slice(0, 16) + " IST";
}
