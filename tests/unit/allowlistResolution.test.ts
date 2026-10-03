import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock external services before imports
vi.mock("../../bot", () => ({
  sendBotReply: vi.fn(),
  safeGetGroupName: vi.fn().mockImplementation(async (_sock, jid) => `Group-${jid}`),
  safeGetContactName: vi.fn().mockImplementation(async (jid) => `Contact-${jid}`),
  buildSessionKey: (from: string, senderId: string) => `${from}:${senderId}`,
}));

vi.mock("../../security/rbac", () => ({
  isAdminAction: () => true,
  normalizeJid: (jid: string) => jid,
}));

vi.mock("../../storage/redisClient", () => ({
  redis: {
    get: vi.fn(),
    set: vi.fn(),
    hgetall: vi.fn(),
  },
}));

vi.mock("../../core/state", () => ({
  saveSession: vi.fn(),
}));

// Setup mock groups and chats
const mockGroups = [
  { id: 6, jid: "120363388522934413@g.us", botNumber: 2, level: 1, enabled: true },
  { id: 8, jid: "120363409293397238@g.us", botNumber: 2, level: 2, enabled: true },
];

const mockChats = [
  { id: 1, jid: "919876543210@s.whatsapp.net", botNumber: 1, level: 1, enabled: true },
];

vi.mock("../../config/groupAllowlist", () => ({
  default: {
    listGroups: () => mockGroups,
    getGroupEntryById: (id: number) => mockGroups.find((g) => g.id === id) || null,
    getGroupEntryByJid: (jid: string) => mockGroups.find((g) => g.jid === jid) || null,
    removeGroupById: vi.fn().mockResolvedValue(true),
    editGroupBot: vi.fn().mockResolvedValue(true),
  },
}));

vi.mock("../../config/chatAllowlist", () => ({
  default: {
    listChats: () => mockChats,
    getChatEntryById: (id: number) => mockChats.find((c) => c.id === id) || null,
    getChatEntryByJid: (jid: string) => mockChats.find((c) => c.jid === jid) || null,
    removeChatById: vi.fn().mockResolvedValue(true),
    editChatBot: vi.fn().mockResolvedValue(true),
  },
}));

import { dispatchCommand } from "../../core/commands/commandRegistry";
import "../../core/commands/admin/allowlistController";
import { sendBotReply } from "../../bot";

describe("allowlistController - target resolution & delete command", () => {
  let session: any;
  const mockSock = {} as any;
  const mockMsg = {} as any;

  beforeEach(() => {
    session = {};
    vi.clearAllMocks();
  });

  it("!rm -g 6 targets group 6 specifically even when executed from group 8", async () => {
    const success = await dispatchCommand({
      sock: mockSock,
      msg: mockMsg,
      cmdName: "rm",
      cmdArgs: ["-g", "6"],
      senderId: "admin@s.whatsapp.net",
      from: "120363409293397238@g.us", // inside group 8
      session,
    });

    expect(success).toBe(true);
    expect(session.pendingDeleteGroup).toBeDefined();
    expect(session.pendingDeleteGroup.id).toBe(6);
    expect(session.pendingDeleteGroup.jid).toBe("120363388522934413@g.us");
    expect(sendBotReply).toHaveBeenCalledWith(
      mockSock,
      "120363409293397238@g.us",
      expect.stringContaining("Remove Group ID: 6"),
    );
  });

  it("!delete -g 6 works as an alias for !rm -g 6", async () => {
    const success = await dispatchCommand({
      sock: mockSock,
      msg: mockMsg,
      cmdName: "delete",
      cmdArgs: ["-g", "6"],
      senderId: "admin@s.whatsapp.net",
      from: "120363409293397238@g.us",
      session,
    });

    expect(success).toBe(true);
    expect(session.pendingDeleteGroup).toBeDefined();
    expect(session.pendingDeleteGroup.id).toBe(6);
  });

  it("!rm -g 999 fails with explicit error and NEVER silently falls back to current group", async () => {
    const success = await dispatchCommand({
      sock: mockSock,
      msg: mockMsg,
      cmdName: "rm",
      cmdArgs: ["-g", "999"],
      senderId: "admin@s.whatsapp.net",
      from: "120363409293397238@g.us", // current group 8
      session,
    });

    expect(success).toBe(true);
    expect(session.pendingDeleteGroup).toBeUndefined(); // MUST NOT target group 8!
    expect(sendBotReply).toHaveBeenCalledWith(
      mockSock,
      "120363409293397238@g.us",
      expect.stringContaining('No group found with ID or JID "999"'),
    );
  });

  it("!edit -g 6 -lvl 2 targets group 6, not current group 8", async () => {
    const success = await dispatchCommand({
      sock: mockSock,
      msg: mockMsg,
      cmdName: "edit",
      cmdArgs: ["-g", "6", "-lvl", "2"],
      senderId: "admin@s.whatsapp.net",
      from: "120363409293397238@g.us", // group 8 is already level 2, but group 6 is level 1
      session,
    });

    expect(success).toBe(true);
    expect(session.pendingEditGroup).toBeDefined();
    expect(session.pendingEditGroup.id).toBe(6);
    expect(session.pendingEditGroup.level).toBe(2);
    expect(sendBotReply).toHaveBeenCalledWith(
      mockSock,
      "120363409293397238@g.us",
      expect.stringContaining("Change Group ID: 6"),
    );
  });

  it("!edit -g 6 -lvl 1 says already using Level 1 without changing", async () => {
    const success = await dispatchCommand({
      sock: mockSock,
      msg: mockMsg,
      cmdName: "edit",
      cmdArgs: ["-g", "6", "-lvl", "1"],
      senderId: "admin@s.whatsapp.net",
      from: "120363409293397238@g.us",
      session,
    });

    expect(success).toBe(true);
    expect(session.pendingEditGroup).toBeUndefined();
    expect(sendBotReply).toHaveBeenCalledWith(
      mockSock,
      "120363409293397238@g.us",
      expect.stringContaining("Group is already using Bot 2 (DKB) [Level 1]"),
    );
  });

  it("!rm without flags inside group 8 targets current group 8", async () => {
    const success = await dispatchCommand({
      sock: mockSock,
      msg: mockMsg,
      cmdName: "rm",
      cmdArgs: [],
      senderId: "admin@s.whatsapp.net",
      from: "120363409293397238@g.us",
      session,
    });

    expect(success).toBe(true);
    expect(session.pendingDeleteGroup).toBeDefined();
    expect(session.pendingDeleteGroup.id).toBe(8);
  });
});
