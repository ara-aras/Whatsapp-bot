import { registerCommand } from "../commandRegistry";
import {
  handleEditEventCommand,
  handleSubmitEventCommand,
  handleConfirmEventCommand,
  getPendingEvent,
  formatEventReviewCard,
  clearPendingEvent,
  isCoreOrAdmin,
} from "../../../services/DKB/eventIngestionService";
import { sendBotReply } from "../../../bot";


registerCommand({
  name: "editevent",
  handler: async (ctx) => {
    await handleEditEventCommand(ctx.sock, ctx.from, ctx.senderId, ctx.cmdArgs, ctx.msg);
  },
});

// ── SUBMIT EVENT ──
registerCommand({
  name: "submit",
  handler: async (ctx) => {
    await handleSubmitEventCommand(ctx.sock, ctx.from, ctx.senderId, ctx.cmdArgs, ctx.msg);
  },
});

registerCommand({
  name: "submitevent",
  handler: async (ctx) => {
    await handleSubmitEventCommand(ctx.sock, ctx.from, ctx.senderId, ctx.cmdArgs, ctx.msg);
  },
});

// ── CONFIRM EVENT ──
registerCommand({
  name: "confirm",
  handler: async (ctx) => {
    await handleConfirmEventCommand(ctx.sock, ctx.from, ctx.senderId, ctx.cmdArgs, ctx.msg);
  },
});

registerCommand({
  name: "confirmevent",
  handler: async (ctx) => {
    await handleConfirmEventCommand(ctx.sock, ctx.from, ctx.senderId, ctx.cmdArgs, ctx.msg);
  },
});

// ── EVENT STATUS ──
registerCommand({
  name: "eventstatus",
  handler: async (ctx) => {
    const isAuthorized = await isCoreOrAdmin(ctx.senderId, ctx.msg);
    if (!isAuthorized) {
      await sendBotReply(ctx.sock, ctx.from, "⚠️ Unauthorized: Core role or Admin required.");
      return;
    }
    const evt = await getPendingEvent(ctx.cmdArgs[0]?.replace(/^#/, ""));
    if (!evt) {
      await sendBotReply(ctx.sock, ctx.from, "ℹ️ No pending event review currently active.");
      return;
    }
    const card = formatEventReviewCard(evt);
    await sendBotReply(ctx.sock, ctx.from, card);
  },
});

// ── CANCEL / DISCARD PENDING EVENT ──
registerCommand({
  name: "cancelevent",
  handler: async (ctx) => {
    const isAuthorized = await isCoreOrAdmin(ctx.senderId, ctx.msg);
    if (!isAuthorized) {
      await sendBotReply(ctx.sock, ctx.from, "⚠️ Unauthorized: Core role or Admin required.");
      return;
    }
    const targetId = ctx.cmdArgs[0]?.replace(/^#/, "");
    const evt = await getPendingEvent(targetId);
    if (!evt) {
      await sendBotReply(ctx.sock, ctx.from, "ℹ️ No pending event found to cancel.");
      return;
    }
    await clearPendingEvent(evt.id);
    await sendBotReply(ctx.sock, ctx.from, `🗑️ Event review #${evt.id} has been cancelled.`);
  },
});
