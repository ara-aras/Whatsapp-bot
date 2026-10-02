import { describe, it, expect, beforeEach } from "vitest";
import groupConfig from "../../config/groupAllowlist";
import chatConfig from "../../config/chatAllowlist";

describe("allowlistLevel", () => {
  beforeEach(async () => {
    delete process.env.ALLOWED_GROUPS;
    delete process.env.ALLOWED_CHATS;
  });

  it("groupConfig defaults level to 1 if not specified", async () => {
    const testJid = "120363000000000001@g.us";
    await groupConfig.addGroup(testJid, 2);

    const bot = groupConfig.getGroupBot(testJid);
    expect(bot).not.toBeNull();
    expect(bot?.botNumber).toBe(2);
    expect(bot?.level).toBe(1);
  }, 15000);

  it("groupConfig stores and updates level via editGroupBot", async () => {
    const testJid = "120363000000000002@g.us";
    await groupConfig.addGroup(testJid, 2, 2);

    let bot = groupConfig.getGroupBot(testJid);
    expect(bot?.botNumber).toBe(2);
    expect(bot?.level).toBe(2);

    const entry = groupConfig.getGroupEntryByJid(testJid);
    expect(entry).not.toBeNull();

    await groupConfig.editGroupBot(entry!.id, 2, 1);
    bot = groupConfig.getGroupBot(testJid);
    expect(bot?.level).toBe(1);
  });

  it("chatConfig defaults level to 1 and updates via editChatBot", async () => {
    const testJid = "19998887777@s.whatsapp.net";
    await chatConfig.addChat(testJid, 2);

    let bot = chatConfig.getChatBot(testJid);
    expect(bot?.botNumber).toBe(2);
    expect(bot?.level).toBe(1);

    const entry = chatConfig.getChatEntryByJid(testJid);
    expect(entry).not.toBeNull();

    await chatConfig.editChatBot(entry!.id, 2, 2);
    bot = chatConfig.getChatBot(testJid);
    expect(bot?.level).toBe(2);
  });
});
