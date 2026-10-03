import { describe, it, expect } from "vitest";
import { botLabel, BOT_LABELS } from "../../agents/core/botLabels";

describe("botLabel", () => {
  it("maps the canonical numbering", () => {
    expect(botLabel(0)).toBe("Generic");
    expect(botLabel(1)).toBe("ECB");
    expect(botLabel(2)).toBe("DKB");
    expect(botLabel(3)).toBe("MAHORAGA");
  });

  it("falls back for unknown ids", () => {
    expect(botLabel(9)).toBe("Bot 9");
  });

  it("Generic occupies the default slot 0 and MAHORAGA occupies slot 3", () => {
    expect(BOT_LABELS[0]).toBe("Generic");
    expect(BOT_LABELS[3]).toBe("MAHORAGA");
  });
});
