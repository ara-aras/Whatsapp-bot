import { describe, it, expect, vi } from "vitest";
import { handleMessage } from "../../agents/DKB/handler";

// Mock groqClient
vi.mock("../../ai/groqClient", () => ({
  getGroqReply: vi.fn().mockResolvedValue("Mocked AI response with live intelligence"),
}));

// Mock promptBuilder
vi.mock("../../ai/promptBuilder", () => ({
  buildDynamicContextPrompt: vi.fn().mockResolvedValue("<mock_community_db/>"),
}));

// Mock liveSearchService
vi.mock("../../services/search/liveSearchService", () => ({
  getLiveSearchContext: vi.fn().mockResolvedValue("<mock_live_web_context/>"),
}));

describe("dkbLevelIntegration", () => {
  const mockSession: any = {
    domainUnlocked: false,
    lastActiveAt: Date.now(),
    messages: [],
  };

  it("Level 1 DKB enforces domain lock on non-community queries", async () => {
    const session = { ...mockSession, domainUnlocked: false };
    const result = await handleMessage(
      session,
      "What is the best mechanical keyboard in 2026?",
      "mock_key",
      "mock_model",
      false, // isAdmin
      "user@s.whatsapp.net",
      1, // Level 1
    );

    expect(result.domainLocked).toBe(true);
    expect(result.usedAI).toBe(false);
    expect(result.reply).toContain("I support DK24 (Developer Kommunity 24)!");
  });

  it("Level 2 DKB bypasses domain lock on non-community queries and uses AI", async () => {
    const session = { ...mockSession, domainUnlocked: false };
    const result = await handleMessage(
      session,
      "What is the best mechanical keyboard in 2026?",
      "mock_key",
      "mock_model",
      false, // isAdmin
      "user@s.whatsapp.net",
      2, // Level 2
    );

    expect(result.domainLocked).toBeUndefined();
    expect(result.usedAI).toBe(true);
    expect(result.reply).toContain("Mocked AI response with live intelligence");
  });

  it("Level 2 DKB invokes agenticAnswer when agentic search is available", async () => {
    const session = { ...mockSession, domainUnlocked: false };
    const agenticModule = await import("../../services/search/agenticSearch");
    const isAvailSpy = vi.spyOn(agenticModule, "isAgenticAvailable").mockReturnValue(true);
    const answerSpy = vi.spyOn(agenticModule, "agenticAnswer").mockResolvedValue({
      answer: "Gemini 4 Argon announced 30 Sept 2026",
      usedTools: ["web_search"],
      citations: ["https://reuters.com"],
    });

    const result = await handleMessage(
      session,
      "What is the latest AI model from Google 2026?",
      "mock_key",
      "mock_model",
      false,
      "user@s.whatsapp.net",
      2,
    );

    expect(answerSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "What is the latest AI model from Google 2026?",
        baseSystemPrompt: expect.stringContaining("Current Date & Time (IST):"),
      }),
    );
    expect(result.reply).toContain("Gemini 4 Argon announced 30 Sept 2026");
    expect(result.usedAI).toBe(true);

    isAvailSpy.mockRestore();
    answerSpy.mockRestore();
  });
});
