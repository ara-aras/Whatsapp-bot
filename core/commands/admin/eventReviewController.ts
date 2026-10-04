import { registerCommand } from "../commandRegistry";
import {
  handleEditEventCommand,
  handleSubmitEventCommand,
  handleConfirmEventCommand,
  handleQueueEventCommand,
  handleCancelEventCommand,
  getPendingEvent,
  formatEventReviewCard,
  clearPendingEvent,
  isCoreOrAdmin,
} from "../../../services/DKB/eventIngestionService";
import { sendBotReply } from "../../../bot";

// ── EDIT EVENT ──
registerCommand({
  name: "editevent",
  handler: async (ctx) => {
    await handleEditEventCommand(ctx.sock, ctx.from, ctx.senderId, ctx.cmdArgs, ctx.msg);
  },
});

// ── QUEUE / SWITCH ACTIVE EVENT (!queue, !q, !queued) ──
registerCommand({
  name: "queue",
  handler: async (ctx) => {
    await handleQueueEventCommand(ctx.sock, ctx.from, ctx.senderId, ctx.msg);
  },
});

registerCommand({
  name: "q",
  handler: async (ctx) => {
    await handleQueueEventCommand(ctx.sock, ctx.from, ctx.senderId, ctx.msg);
  },
});

registerCommand({
  name: "queued",
  handler: async (ctx) => {
    await handleQueueEventCommand(ctx.sock, ctx.from, ctx.senderId, ctx.msg);
  },
});

// ── CANCEL / DISCARD ACTIVE OR QUEUED EVENT (!cancel, !cancelevent) ──
registerCommand({
  name: "cancel",
  handler: async (ctx) => {
    await handleCancelEventCommand(ctx.sock, ctx.from, ctx.senderId, ctx.cmdArgs, ctx.msg);
  },
});

registerCommand({
  name: "cancelevent",
  handler: async (ctx) => {
    await handleCancelEventCommand(ctx.sock, ctx.from, ctx.senderId, ctx.cmdArgs, ctx.msg);
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
      await sendBotReply(ctx.sock, ctx.from, "Unauthorized: Core role or Admin required.");
      return;
    }
    const evt = await getPendingEvent(ctx.cmdArgs[0]?.replace(/^#/, ""));
    if (!evt) {
      await sendBotReply(ctx.sock, ctx.from, "No pending event review currently active.");
      return;
    }
    const card = formatEventReviewCard(evt);
    await sendBotReply(ctx.sock, ctx.from, card);
  },
});
