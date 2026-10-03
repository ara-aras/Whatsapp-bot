import { describe, it, expect } from "vitest";
import { DKB_HELP_TEXT } from "../../agents/DKB/intro";
import { PARAG_HELP_TEXT } from "../../agents/PARAG/intro";
import { ECB_HELP_TEXT } from "../../agents/ECB/intro";
import { GENERIC_HELP_TEXT } from "../../agents/Generic/intro";

// Registered with requiresAdmin: true in core/commands/coreController.ts.
// Members who tried them from a bot's help got "Unauthorized".
const OWNER_ONLY = ["!ping", "!getjid", "!whoami"];

const USER_HELP = {
  DKB: DKB_HELP_TEXT,
  MAHORAGA: PARAG_HELP_TEXT,
  ECB: ECB_HELP_TEXT,
  Generic: GENERIC_HELP_TEXT,
};

describe("user-facing help texts", () => {
  for (const [bot, text] of Object.entries(USER_HELP)) {
    it(`${bot} help lists no owner-only commands`, () => {
      for (const cmd of OWNER_ONLY) {
        expect(text).not.toMatch(new RegExp(`${cmd}\\b`));
      }
    });
  }

  it("Generic help does not offer !chat (it belongs to the disabled away auto-responder)", () => {
    expect(GENERIC_HELP_TEXT).not.toContain("!chat");
  });
});
