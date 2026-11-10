export function sanitizeForPrompt(input?: any): string {
  if (input === undefined || input === null) return "";
  return String(input)
    .replace(/ignore\s+all\s+previous\s+instructions/gi, "")
    .replace(/ignore\s+previous\s+instructions/gi, "")
    .replace(/system\s+prompt/gi, "")
    .replace(/ignore\s+instructions/gi, "")
    .replace(/you\s+must\s+now/gi, "")
    .replace(/<\/?[^>]+(>|$)/g, "") // strip html/xml tag boundaries to prevent prompt jailbreaks
    .trim();
}

const PROMPT_GUARD_MODEL = "meta-llama/llama-prompt-guard-2-86m";

/** Zero-width and invisible formatting characters used to split up keywords. */
const INVISIBLE = /[​-‍⁠﻿]/g;

export function stripInvisible(input: string): string {
  return input.replace(INVISIBLE, "");
}

/**
 * Reads a Prompt Guard answer. Returns true (injection), false (benign), or
 * null when the answer is not something we recognise.
 *
 * The model reports a probability that the text is malicious; depending on the
 * serving layer that arrives as a number ("0.9987") or as a label. Both are
 * accepted so a change in output format degrades to "unrecognised" (logged)
 * instead of quietly never matching.
 */
export function parseGuardVerdict(raw: unknown): boolean | null {
  if (raw === undefined || raw === null) return null;
  const text = String(raw).trim();
  if (!text) return null;

  if (/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(text)) {
    const score = Number(text);
    if (!Number.isFinite(score) || score < 0 || score > 1) return null;
    const threshold = Number(process.env.PROMPT_FIREWALL_THRESHOLD) || 0.5;
    return score >= threshold;
  }

  const label = text.toUpperCase().replace(/[^A-Z0-9_]/g, "");
  if (["INJECTION", "MALICIOUS", "JAILBREAK", "UNSAFE", "LABEL_1"].includes(label)) return true;
  if (["SAFE", "BENIGN", "LABEL_0"].includes(label)) return false;
  return null;
}

export async function hasPromptInjection(
  input: string,
  groqApiKey: string | undefined,
  groqModel: string = process.env.GROQ_MODEL || "openai/gpt-oss-120b",
): Promise<boolean> {
  if (!input) return false;

  const trimmed = input.trim();
  const lower = trimmed.toLowerCase();

  // 1. Fast-pass mechanism for common harmless queries to save latency and cost
  const harmlessCommands = [
    "!ping",
    "!help",
    "!reset",
    "!hello",
    "!whoami",
    "!getjid",
  ];
  if (harmlessCommands.includes(lower)) {
    return false;
  }

  // Fast-pass for very short prompts that don't trigger command formats
  if (trimmed.length < 10 && !trimmed.startsWith("!")) {
    return false;
  }

  // NOTE: There is deliberately no "event keyword" fast-pass here. Previously a
  // query containing words like "hackfest"/"mentor" skipped the LLM check
  // entirely unless it also matched a hardcoded injection pattern — which let a
  // novel injection phrasing slip through just by including an event keyword.
  // The local regex below and the LLM classifier (which is explicitly told
  // those event words are safe) handle legitimate event queries without a
  // detection-weakening bypass.

  // Zero-width characters are stripped before matching, not treated as an
  // attack on their own. U+200C/U+200D are ordinary text in Kannada, Hindi,
  // Malayalam and other Indic scripts, and U+200D joins compound emoji, so
  // rejecting them blocked legitimate messages. Stripping still defeats the
  // obfuscation ("ig​nore previous instructions") they were checked for.
  const probe = stripInvisible(trimmed);
  const probeLower = probe.toLowerCase();

  // 2. Local deterministic regex checks for obvious injection patterns
  const injectionPatterns = [
    /ignore\s+(?:all\s+)?(?:previous\s+)?(?:instructions|directives|rules|guidelines|guardrails|prompts)/i,
    /system\s+prompt/i,
    /bypass\s+(?:the\s+)?(?:guardrails|rules|system|security)/i,
    /you\s+must\s+now/i,
    /disregard\s+prior/i,
    /override\s+instructions/i,
    /acting\s+as\s+an?/i,
  ];
  if (injectionPatterns.some((pattern) => pattern.test(probeLower))) {
    return true;
  }

  if (!groqApiKey) return false;

  // 3. Model check. llama-prompt-guard-2 is a CLASSIFIER, not a chat model: it
  // scores the text it is given and does not follow a system prompt. So it
  // gets the user text alone (a system prompt full of "ignore ... instructions"
  // wording would be scored too), and its answer is parsed as a score or label
  // rather than compared with a word we asked it to say.
  const failClosed =
    (process.env.PROMPT_FIREWALL_FAIL_CLOSED || "").toLowerCase() === "true";

  try {
    const fetchFn =
      (globalThis as any).fetch ?? (await import("node-fetch")).default;

    // Create an abort controller to prevent the call from hanging indefinitely
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000); // 3-second timeout

    let res: any;
    try {
      res = await fetchFn("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${groqApiKey}`,
        },
        body: JSON.stringify({
          model: PROMPT_GUARD_MODEL,
          messages: [{ role: "user", content: probe }],
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      console.warn(
        `⚠️ Prompt injection firewall API failed with status ${res.status}. ${failClosed ? "Blocking (PROMPT_FIREWALL_FAIL_CLOSED)." : "Allowing passage."}`,
      );
      return failClosed;
    }
    const data = await res.json();
    const verdict = parseGuardVerdict(data?.choices?.[0]?.message?.content);
    if (verdict === null) {
      // An answer we cannot read is a broken check, not a "safe" result.
      // Say so loudly instead of silently passing everything.
      console.warn(
        `⚠️ Prompt injection firewall returned an unrecognised verdict: ${JSON.stringify(String(data?.choices?.[0]?.message?.content ?? "").slice(0, 80))}`,
      );
      return failClosed;
    }
    return verdict;
  } catch (err) {
    console.error(
      `⚠️ Prompt injection classifier failed (${failClosed ? "blocking" : "allowing passage"}):`,
      err instanceof Error ? err.message : err,
    );
    return failClosed;
  }
}
