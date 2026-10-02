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
});
