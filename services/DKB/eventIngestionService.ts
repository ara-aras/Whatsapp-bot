import { downloadMediaMessage, proto } from "@whiskeysockets/baileys";
import { createWorker } from "tesseract.js";
import { redis } from "../../storage/redisClient";
import { sendBotReply } from "../../bot";
import { isAdminAction, normalizeJid } from "../../security/rbac";
import { isWorkerAuthorized, userHasPermission } from "../../storage/core/rbacRepository";
import { dk24BaseUrl } from "../../storage/DKB/dk24Api";
import groupConfig from "../../config/groupAllowlist";

export const DK24_CONSORTIUM_GROUP_JID =
  process.env.DK24_CONSORTIUM_GROUP_JID || "120363344916256461@g.us";
export const DK24_CORE_GROUP_JID =
  process.env.DK24_CORE_GROUP_JID || "120363350449932185@g.us";
export const DK24_CLUSTER_GROUP_JID =
  process.env.DK24_CLUSTER_GROUP_JID || "120363388522934413@g.us";

export function getDestinationReviewGroupJid(): string {
  try {
    const groups = groupConfig.listGroups();
    const askGroup = groups.find((g) => g.ask && g.enabled);
    if (askGroup) return askGroup.jid;
  } catch {}
  return normalizeJid(DK24_CORE_GROUP_JID) || DK24_CORE_GROUP_JID;
}

export const EVENT_TAG_OPTIONS = [
  "Conference",
  "Workshop",
  "Meetup",
  "Hackathon",
  "Ideathon",
  "Webinar",
  "Networking",
  "Training",
  "Competition",
  "Panel Discussion",
  "Tech Talk",
  "Career Fair",
  "Startup Event",
] as const;

export interface PendingEventData {
  id: string;
  sourceGroupJid: string;
  sourceMessageId?: string;
  createdAt: number;
  updatedAt: number;
  status: "pending_review" | "awaiting_confirmation" | "submitted";
  eventName: string;
  organizationName: string;
  startDateTime: string;
  endDateTime: string;
  eventLocation: string;
  eventWebsite: string;
  registrationLink: string;
  eventDescription: string;
  eventPosterUrl: string;
  eventTags: string[];
  submittedBy: string;
  submittedEmail: string;
}

// In-memory poster image buffer cache keyed by event id (for forwarding poster to Core)
const posterBufferCache = new Map<string, Buffer>();

// Local in-memory store for pending events as fallback when Redis is absent
const localPendingEvents = new Map<string, PendingEventData>();
let localActiveEventId: string | null = null;
let eventCounter = 1;

/**
 * Checks if a sender has the Core role or Admin privileges.
 */
export async function isCoreOrAdmin(
  senderId: string | undefined,
  msg?: any,
): Promise<boolean> {
  if (isAdminAction(msg, senderId)) return true;
  if (!senderId) return false;
  try {
    if (await isWorkerAuthorized(senderId, "core")) return true;
    if (await isWorkerAuthorized(senderId, "mentor")) return true;
    if (await userHasPermission(senderId, "event.manage")) return true;
    if (await userHasPermission(senderId, "mentor.manage")) return true;
  } catch (err) {
    console.warn("[eventIngestion] Error checking core/admin role:", err);
  }
  return false;
}

/**
 * Extracts raw text from an image buffer using OCR with a non-blocking timeout.
 */
export async function extractTextFromImage(
  buffer: Buffer,
  timeoutMs = 12000,
): Promise<string> {
  const ocrPromise = (async () => {
    let worker: any = null;
    try {
      worker = await createWorker("eng");
      const ret = await worker.recognize(buffer);
      await worker.terminate();
      return ret.data.text || "";
    } catch (err) {
      if (worker) {
        try {
          await worker.terminate();
        } catch (_) {}
      }
      console.warn("[eventIngestion] OCR failed:", err);
      return "";
    }
  })();

  const timeoutPromise = new Promise<string>((resolve) =>
    setTimeout(() => resolve(""), timeoutMs),
  );

  return Promise.race([ocrPromise, timeoutPromise]);
}

/**
 * Step 1: Lightweight AI Classifier.
 * Checks whether text announces a hackathon/event.
 */
export async function classifyIfEvent(
  text: string,
  groqApiKey: string,
  groqModel: string,
): Promise<{ isEvent: boolean; confidence: number; category: string }> {
  try {
    const fetchFn = globalThis.fetch;
    const systemPrompt =
      "You are an event classifier for DK24 (Developer Kommunity 24). Determine if the input text announces an upcoming tech event, hackathon, workshop, conference, meetup, ideathon, competition, tech talk, or webinar.\n" +
      'Respond ONLY with a JSON object: {"isEvent": boolean, "confidence": number (0 to 1), "category": string}';

    const res = await fetchFn("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${groqApiKey}`,
      },
      body: JSON.stringify({
        model: groqModel,
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: text.slice(0, 3000) },
        ],
      }),
    });

    if (!res.ok) {
      console.warn(`[eventIngestion] Classifier HTTP error ${res.status}`);
      return { isEvent: false, confidence: 0, category: "unknown" };
    }

    const data = await res.json();
    const raw = data?.choices?.[0]?.message?.content?.trim();
    if (!raw) return { isEvent: false, confidence: 0, category: "unknown" };

    const parsed = JSON.parse(raw);
    return {
      isEvent: Boolean(parsed.isEvent),
      confidence: Number(parsed.confidence) || 0,
      category: String(parsed.category || "unknown"),
    };
  } catch (err) {
    console.error("[eventIngestion] Classifier error:", err);
    return { isEvent: false, confidence: 0, category: "error" };
  }
}

/**
 * Step 2: Extract structured event fields adhering to DK24 Showcase Schema.
 */
export async function extractEventSchema(
  text: string,
  groqApiKey: string,
  groqModel: string,
): Promise<Partial<PendingEventData>> {
  try {
    const fetchFn = globalThis.fetch;
    const systemPrompt =
      "You are a structured data extractor for the DK24 community website showcase event form.\n" +
      "Extract event details from the text. Valid tags are ONLY:\n" +
      JSON.stringify(EVENT_TAG_OPTIONS) +
      "\n\nOutput STRICT JSON with these exact keys:\n" +
      '{\n' +
      '  "eventName": "Event title",\n' +
      '  "organizationName": "College, club, or host organization",\n' +
      '  "startDateTime": "Start date/time e.g. YYYY-MM-DDTHH:mm or YYYY-MM-DD HH:mm",\n' +
      '  "endDateTime": "End date/time e.g. YYYY-MM-DDTHH:mm or YYYY-MM-DD HH:mm",\n' +
      '  "eventLocation": "Venue name, city or Online",\n' +
      '  "eventWebsite": "URL or empty string",\n' +
      '  "registrationLink": "URL or empty string",\n' +
      '  "eventDescription": "Comprehensive overview (aim for at least 50 characters)",\n' +
      '  "eventTags": ["One or more tags from Allowed List"]\n' +
      '}';

    const res = await fetchFn("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${groqApiKey}`,
      },
      body: JSON.stringify({
        model: groqModel,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: text.slice(0, 4000) },
        ],
      }),
    });

    if (!res.ok) {
      console.warn(`[eventIngestion] Extractor HTTP error ${res.status}`);
      return {};
    }

    const data = await res.json();
    const raw = data?.choices?.[0]?.message?.content?.trim();
    if (!raw) return {};

    const parsed = JSON.parse(raw);
    const validTags = Array.isArray(parsed.eventTags)
      ? parsed.eventTags.filter((t: string) => (EVENT_TAG_OPTIONS as readonly string[]).includes(t))
      : [];

    return {
      eventName: String(parsed.eventName || "").trim(),
      organizationName: String(parsed.organizationName || "").trim(),
      startDateTime: String(parsed.startDateTime || "").trim(),
      endDateTime: String(parsed.endDateTime || "").trim(),
      eventLocation: String(parsed.eventLocation || "").trim(),
      eventWebsite: String(parsed.eventWebsite || "").trim(),
      registrationLink: String(parsed.registrationLink || "").trim(),
      eventDescription: String(parsed.eventDescription || "").trim(),
      eventTags: validTags.length > 0 ? validTags : ["Hackathon"],
    };
  } catch (err) {
    console.error("[eventIngestion] Extraction error:", err);
    return {};
  }
}

/**
 * Returns missing required fields according to DK24 eventSubmissionSchema.
 */
export function getMissingRequiredFields(evt: Partial<PendingEventData>): string[] {
  const missing: string[] = [];
  if (!evt.eventName || evt.eventName.trim().length < 2) missing.push("Event Name (-en)");
  if (!evt.organizationName || evt.organizationName.trim().length < 2) missing.push("Organization Name (-on)");
  if (!evt.startDateTime || !evt.startDateTime.trim()) missing.push("Start Date & Time (-sdt)");
  if (!evt.endDateTime || !evt.endDateTime.trim()) missing.push("End Date & Time (-edt)");
  if (!evt.eventLocation || evt.eventLocation.trim().length < 5) missing.push("Event Location (-eloc)");
  if (!evt.eventDescription || evt.eventDescription.trim().length < 50) missing.push("Event Description (min 50 chars) (-desc)");
  if (!evt.eventTags || evt.eventTags.length === 0) missing.push("Event Tags (-etag)");
  if (!evt.submittedBy || evt.submittedBy.trim().length < 2) missing.push("Your Name (-name)");
  if (!evt.submittedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(evt.submittedEmail.trim())) missing.push("Your Email (-email)");
  return missing;
}

/**
 * Maps tag numbers (1-13) or case-insensitive names to valid event tags.
 */
export function parseTagInput(raw: string): string[] {
  const items = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const matched: string[] = [];
  for (const item of items) {
    const num = parseInt(item, 10);
    if (!isNaN(num) && num >= 1 && num <= EVENT_TAG_OPTIONS.length) {
      matched.push(EVENT_TAG_OPTIONS[num - 1]);
    } else {
      const found = EVENT_TAG_OPTIONS.find(
        (opt) => opt.toLowerCase() === item.toLowerCase(),
      );
      if (found) matched.push(found);
    }
  }
  return Array.from(new Set(matched));
}

/**
 * Formats tag list with 1-based indexing for convenient user reference.
 */
export function formatTagOptionsList(): string {
  return EVENT_TAG_OPTIONS.map((tag, idx) => `${idx + 1}. ${tag}`).join(" | ");
}

/**
 * Saves a pending event to Redis / memory.
 */
export async function savePendingEvent(evt: PendingEventData): Promise<void> {
  localPendingEvents.set(evt.id, evt);
  localActiveEventId = evt.id;

  try {
    await redis.set(`dk24:pending_event:${evt.id}`, JSON.stringify(evt), "EX", 86400 * 3);
    await redis.set("dk24:active_event_id", evt.id, "EX", 86400 * 3);
  } catch (err) {
    console.warn("[eventIngestion] Redis save failed, using memory:", err);
  }
}

/**
 * Gets a pending event by ID (or the active one if id is omitted).
 */
export async function getPendingEvent(id?: string): Promise<PendingEventData | null> {
  const targetId = id || localActiveEventId;
  if (!targetId) {
    try {
      const activeId = await redis.get("dk24:active_event_id");
      if (activeId) return getPendingEvent(activeId);
    } catch (_) {}
    return null;
  }

  try {
    const raw = await redis.get(`dk24:pending_event:${targetId}`);
    if (raw) return JSON.parse(raw);
  } catch (_) {}

  return localPendingEvents.get(targetId) || null;
}

/**
 * Clears a pending event when confirmed, submitted, or cancelled.
 */
export async function clearPendingEvent(id: string): Promise<void> {
  localPendingEvents.delete(id);
  posterBufferCache.delete(id);
  if (localActiveEventId === id) localActiveEventId = null;

  try {
    await redis.del(`dk24:pending_event:${id}`);
    const active = await redis.get("dk24:active_event_id");
    if (active === id) await redis.del("dk24:active_event_id");
  } catch (_) {}
}

/**
 * Formats the event review card message for WhatsApp.
 */
export function formatEventReviewCard(evt: PendingEventData): string {
  const missing = getMissingRequiredFields(evt);
  const isComplete = missing.length === 0;

  const lines = [
    `🎯 *DK24 Event Ingestion Review* [ID: #${evt.id}]`,
    "",
    `📌 *Event Name:* ${evt.eventName || "_[Missing]_"}`,
    `🏢 *Organization:* ${evt.organizationName || "_[Missing]_"}`,
    `📅 *Start:* ${evt.startDateTime || "_[Missing]_"}`,
    `🏁 *End:* ${evt.endDateTime || "_[Missing]_"}`,
    `📍 *Location:* ${evt.eventLocation || "_[Missing]_"}`,
    `🏷️ *Tags:* ${evt.eventTags.length > 0 ? evt.eventTags.join(", ") : "_[Missing]_"}`,
    `🌐 *Website:* ${evt.eventWebsite || "_[None]_"}`,
    `🔗 *Registration Link:* ${evt.registrationLink || "_[None]_"}`,
    `🖼️ *Poster URL:* ${evt.eventPosterUrl || "_[None]_"}`,
    `👤 *Submitter:* ${evt.submittedBy || "_[Missing]_"} (${evt.submittedEmail || "_[Missing]_"})`,
    "",
    "📝 *Description:*",
    evt.eventDescription || "_[Missing description]_",
    "",
    "──────────────────────────────",
  ];

  if (isComplete) {
    if (evt.status === "awaiting_confirmation") {
      lines.push(
        "📋 *Ready for Submission*",
        "• Reply *!CONFIRM* to certify all details are correct and push to DK24 Showcase Review.",
        "• Reply *!edit <flags>* to make changes.",
      );
    } else {
      lines.push(
        "✨ *All required fields are present!*",
        "• Reply *!submit* to review and proceed to confirmation.",
        "• Reply *!edit <flags>* to make any adjustments.",
      );
    }
  } else {
    lines.push(
      "⚠️ *Missing Required Fields:*",
      ...missing.map((m) => `  • ${m}`),
      "",
      "Core members can add/edit missing details using:",
      "!edit -en <name> -on <org> -sdt <start> -edt <end> -eloc <loc> -desc <desc> -etag <tags> -name <yourName> -email <yourEmail>",
      "",
      "🏷️ *Available Tags (enter comma-separated numbers or names):*",
      formatTagOptionsList(),
      "",
      "💡 *Tip for Poster URL (-epos):* Upload image to free host (e.g. Postimages.org or Imgur) and paste direct link.",
    );
  }

  return lines.join("\n");
}

/**
 * Main Message Ingestion Pipeline:
 * Analyzes messages from the announcement group (and optionally Core/Cluster).
 */
export async function handleInboundEventIngestion(
  sock: any,
  msg: proto.IWebMessageInfo,
  from: string,
  senderId?: string,
): Promise<boolean> {
  const normFrom = normalizeJid(from) || from;
  const groupEntry = groupConfig.getGroupEntryByJid(normFrom) || groupConfig.getGroupEntryByJid(from);
  const isReadGroup = Boolean(groupEntry?.read);
  const isConsortium = normFrom === normalizeJid(DK24_CONSORTIUM_GROUP_JID);
  const isCluster = normFrom === normalizeJid(DK24_CLUSTER_GROUP_JID);
  const isCore = normFrom === normalizeJid(DK24_CORE_GROUP_JID);

  // Ingest from configured read (announcement) groups or default Consortium/Cluster/Core groups
  if (!isReadGroup && !isConsortium && !isCluster && !isCore) {
    return false;
  }

  const groqApiKey = process.env.GROQ_API_KEY;
  const groqModel = process.env.GROQ_MODEL || "openai/gpt-oss-120b";
  if (!groqApiKey) return false;

  // 1. Extract image & caption
  const msgObj = msg.message;
  const imageInfo =
    msgObj?.imageMessage ||
    msgObj?.ephemeralMessage?.message?.imageMessage ||
    msgObj?.viewOnceMessage?.message?.imageMessage ||
    msgObj?.viewOnceMessageV2?.message?.imageMessage;

  let textContent =
    imageInfo?.caption ||
    msgObj?.conversation ||
    msgObj?.extendedTextMessage?.text ||
    "";
  textContent = textContent.trim();

  let imageBuffer: Buffer | null = null;
  if (imageInfo) {
    try {
      imageBuffer = (await downloadMediaMessage(msg as any, "buffer", {})) as Buffer;
      if (imageBuffer) {
        const ocrText = await extractTextFromImage(imageBuffer);
        if (ocrText.trim()) {
          textContent = `${textContent}\n\n${ocrText}`.trim();
        }
      }
    } catch (err) {
      console.warn("[eventIngestion] Failed downloading media message:", err);
    }
  }

  // If text is too short and no image, ignore
  if (textContent.length < 25 && !imageBuffer) {
    return false;
  }

  // 2. Classification
  const classification = await classifyIfEvent(textContent, groqApiKey, groqModel);
  if (!classification.isEvent || classification.confidence < 0.6) {
    return false;
  }

  // 3. Schema Extraction
  const extracted = await extractEventSchema(textContent, groqApiKey, groqModel);
  const eventId = String(eventCounter++);

  const pendingEvent: PendingEventData = {
    id: eventId,
    sourceGroupJid: normFrom,
    sourceMessageId: msg.key?.id || undefined,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: "pending_review",
    eventName: extracted.eventName || "",
    organizationName: extracted.organizationName || "",
    startDateTime: extracted.startDateTime || "",
    endDateTime: extracted.endDateTime || "",
    eventLocation: extracted.eventLocation || "",
    eventWebsite: extracted.eventWebsite || "",
    registrationLink: extracted.registrationLink || "",
    eventDescription: extracted.eventDescription || "",
    eventPosterUrl: extracted.eventPosterUrl || "",
    eventTags: extracted.eventTags || ["Hackathon"],
    submittedBy: "",
    submittedEmail: "",
  };

  if (imageBuffer) {
    posterBufferCache.set(eventId, imageBuffer);
  }

  await savePendingEvent(pendingEvent);

  // 4. Relay to Core / Review Group for Verification
  const reviewJid = getDestinationReviewGroupJid();
  try {
    if (imageBuffer) {
      await sock.sendMessage(reviewJid, {
        image: imageBuffer,
        caption: `📢 *New Event Detected in Announcements*\nEvent: *${pendingEvent.eventName || "New Event"}*`,
      });
    }

    const reviewCard = formatEventReviewCard(pendingEvent);
    await sendBotReply(sock, reviewJid, reviewCard);
    return true;
  } catch (err) {
    console.error(`[eventIngestion] Failed to relay to review group (${reviewJid}):`, err);
    return false;
  }
}

/**
 * Parses user input flags for !edit
 */
export function parseEditEventFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  let currentFlag: string | null = null;
  const currentTokens: string[] = [];

  const knownFlags = new Set([
    "-en",
    "-on",
    "-sdt",
    "-edt",
    "-eloc",
    "-el",
    "-eweb",
    "-rlink",
    "-reglink",
    "-epos",
    "-etag",
    "-desc",
    "-name",
    "-email",
  ]);

  for (const token of args) {
    const lower = token.toLowerCase();
    if (knownFlags.has(lower)) {
      if (currentFlag) {
        flags[currentFlag] = currentTokens.join(" ").trim();
        currentTokens.length = 0;
      }
      currentFlag = lower;
    } else {
      currentTokens.push(token);
    }
  }

  if (currentFlag) {
    flags[currentFlag] = currentTokens.join(" ").trim();
  }

  return flags;
}

/**
 * Handles !edit command in Core group
 */
export async function handleEditEventCommand(
  sock: any,
  from: string,
  senderId: string | undefined,
  cmdArgs: string[],
  msg?: any,
): Promise<void> {
  const isAuthorized = await isCoreOrAdmin(senderId, msg);
  if (!isAuthorized) {
    await sendBotReply(
      sock,
      from,
      "⚠️ Unauthorized: Only DK24 Core members or the admin can edit events.",
    );
    return;
  }

  // Check if first arg is an event ID (e.g. #1 or 1)
  let targetId: string | undefined = undefined;
  let flagArgs = cmdArgs;

  if (cmdArgs[0] && /^#?\d+$/.test(cmdArgs[0])) {
    targetId = cmdArgs[0].replace(/^#/, "");
    flagArgs = cmdArgs.slice(1);
  }

  const evt = await getPendingEvent(targetId);
  if (!evt) {
    await sendBotReply(
      sock,
      from,
      "⚠️ No pending event found to edit. A new event will be loaded when announced.",
    );
    return;
  }

  const flags = parseEditEventFlags(flagArgs);
  if (Object.keys(flags).length === 0) {
    await sendBotReply(
      sock,
      from,
      "Usage:\n!edit -en <name> -on <org> -sdt <start> -edt <end> -eloc <loc> -desc <desc> -etag <tags> -name <yourName> -email <yourEmail>",
    );
    return;
  }

  if (flags["-en"]) evt.eventName = flags["-en"];
  if (flags["-on"]) evt.organizationName = flags["-on"];
  if (flags["-sdt"]) evt.startDateTime = flags["-sdt"];
  if (flags["-edt"]) evt.endDateTime = flags["-edt"];
  if (flags["-eloc"] || flags["-el"]) evt.eventLocation = flags["-eloc"] || flags["-el"];
  if (flags["-eweb"]) evt.eventWebsite = flags["-eweb"];
  if (flags["-rlink"] || flags["-reglink"]) evt.registrationLink = flags["-rlink"] || flags["-reglink"];
  if (flags["-epos"]) evt.eventPosterUrl = flags["-epos"];
  if (flags["-desc"]) evt.eventDescription = flags["-desc"];
  if (flags["-name"]) evt.submittedBy = flags["-name"];
  if (flags["-email"]) evt.submittedEmail = flags["-email"];
  if (flags["-etag"]) {
    const parsedTags = parseTagInput(flags["-etag"]);
    if (parsedTags.length > 0) evt.eventTags = parsedTags;
  }

  evt.updatedAt = Date.now();
  evt.status = "pending_review";
  await savePendingEvent(evt);

  const reviewCard = formatEventReviewCard(evt);
  await sendBotReply(sock, from, `✅ Event #${evt.id} updated!\n\n${reviewCard}`);
}

/**
 * Handles !submit command in Core group
 */
export async function handleSubmitEventCommand(
  sock: any,
  from: string,
  senderId: string | undefined,
  cmdArgs: string[],
  msg?: any,
): Promise<void> {
  const isAuthorized = await isCoreOrAdmin(senderId, msg);
  if (!isAuthorized) {
    await sendBotReply(
      sock,
      from,
      "⚠️ Unauthorized: Only DK24 Core members or the admin can submit events.",
    );
    return;
  }

  const targetId = cmdArgs[0]?.replace(/^#/, "");
  const evt = await getPendingEvent(targetId);
  if (!evt) {
    await sendBotReply(sock, from, "⚠️ No pending event found to submit.");
    return;
  }

  const missing = getMissingRequiredFields(evt);
  if (missing.length > 0) {
    await sendBotReply(
      sock,
      from,
      `⚠️ Cannot submit yet. The following required fields are missing:\n${missing.map((m) => `• ${m}`).join("\n")}\n\nUse !edit <flags> to complete them.`,
    );
    return;
  }

  evt.status = "awaiting_confirmation";
  await savePendingEvent(evt);

  const reviewCard = formatEventReviewCard(evt);
  await sendBotReply(sock, from, reviewCard);
}

/**
 * Handles !CONFIRM command in Core group (pushes to community-website)
 */
export async function handleConfirmEventCommand(
  sock: any,
  from: string,
  senderId: string | undefined,
  cmdArgs: string[],
  msg?: any,
): Promise<void> {
  const isAuthorized = await isCoreOrAdmin(senderId, msg);
  if (!isAuthorized) {
    await sendBotReply(
      sock,
      from,
      "⚠️ Unauthorized: Only DK24 Core members or the admin can confirm events.",
    );
    return;
  }

  const targetId = cmdArgs[0]?.replace(/^#/, "");
  const evt = await getPendingEvent(targetId);
  if (!evt) {
    await sendBotReply(sock, from, "⚠️ No pending event found to confirm.");
    return;
  }

  const missing = getMissingRequiredFields(evt);
  if (missing.length > 0) {
    await sendBotReply(
      sock,
      from,
      `⚠️ Cannot confirm yet. Required fields are missing:\n${missing.map((m) => `• ${m}`).join("\n")}\n\nUse !edit <flags> first.`,
    );
    return;
  }

  const secretKey =
    process.env.COMMUNITY_API_SECRET ||
    process.env.BACKEND_SECRET_KEY ||
    "replace-me";

  const payload = {
    eventName: evt.eventName,
    organizationName: evt.organizationName,
    startDateTime: evt.startDateTime,
    endDateTime: evt.endDateTime,
    eventLocation: evt.eventLocation,
    eventWebsite: evt.eventWebsite || "",
    registrationLink: evt.registrationLink || "",
    eventDescription: evt.eventDescription,
    eventPosterUrl: evt.eventPosterUrl || "",
    eventTags: evt.eventTags,
    submittedBy: evt.submittedBy,
    submittedEmail: evt.submittedEmail,
    emailConsentChecked: true,
    isEmailVerified: false,
  };

  const url = `${dk24BaseUrl()}/api/v1/events/submit`;
  console.log(`📡 Pushing event to DK24 website: ${url}`);

  try {
    const fetchFn = globalThis.fetch;
    const res = await fetchFn(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Secret-Key": secretKey,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[eventIngestion] Submit to website failed (${res.status}):`, errText);
      await sendBotReply(
        sock,
        from,
        `❌ Website submission returned error (${res.status}). Please verify API status or retry with !CONFIRM.`,
      );
      return;
    }

    const data = await res.json();
    await clearPendingEvent(evt.id);

    await sendBotReply(
      sock,
      from,
      `🎉 *Event Successfully Submitted to DK24 Showcase Review!*\n\n` +
      `📌 *Event:* ${evt.eventName}\n` +
      `🏢 *Organization:* ${evt.organizationName}\n` +
      `📅 *Dates:* ${evt.startDateTime} → ${evt.endDateTime}\n\n` +
      `The website moderators will review and publish it on dk24.org. Thank you for building in public! 🚀`,
    );
  } catch (error) {
    console.error("[eventIngestion] Network error submitting to website:", error);
    await sendBotReply(
      sock,
      from,
      `❌ Network error reaching DK24 website (${error instanceof Error ? error.message : String(error)}).`,
    );
  }
}
