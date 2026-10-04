import { downloadMediaMessage, normalizeMessageContent, proto } from "@whiskeysockets/baileys";
import { createWorker } from "tesseract.js";
import * as chrono from "chrono-node";
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
  expiresAt?: number;
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
let localEventQueue: string[] = [];
let eventCounter = 1;
export const TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

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

    const rawStart = String(parsed.startDateTime || "").trim();
    const rawEnd = String(parsed.endDateTime || "").trim();

    return {
      eventName: String(parsed.eventName || "").trim(),
      organizationName: String(parsed.organizationName || "").trim(),
      startDateTime: parseFlexibleDate(rawStart) || rawStart,
      endDateTime: parseFlexibleDate(rawEnd) || rawEnd,
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
 * Flexible date parser using chrono-node (supports ordinals, UK/India DMY, 12/24hr times, 2-digit years).
 */
export function parseFlexibleDate(raw: string): string | null {
  if (!raw || !raw.trim()) return null;
  const trimmed = raw.trim();
  try {
    const parsed =
      chrono.en.GB.parseDate(trimmed) ||
      chrono.parseDate(trimmed) ||
      new Date(trimmed);
    if (parsed && !isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  } catch {}
  return null;
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

export async function getActiveEventId(): Promise<string | null> {
  try {
    const r = await redis.get("dk24:active_event_id");
    if (r) return r;
  } catch {}
  return localActiveEventId;
}

export async function setActiveEventId(id: string | null): Promise<void> {
  localActiveEventId = id;
  try {
    if (id) {
      await redis.set("dk24:active_event_id", id, "EX", 86400 * 3);
    } else {
      await redis.del("dk24:active_event_id");
    }
  } catch {}
}

export async function getEventQueue(): Promise<string[]> {
  try {
    const raw = await redis.get("dk24:event_queue");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return [...localEventQueue];
}

export async function setEventQueue(queue: string[]): Promise<void> {
  localEventQueue = [...queue];
  try {
    await redis.set("dk24:event_queue", JSON.stringify(queue), "EX", 86400 * 3);
  } catch {}
}

/**
 * Saves a pending event to Redis / memory.
 */
export async function savePendingEvent(evt: PendingEventData): Promise<void> {
  localPendingEvents.set(evt.id, evt);

  const currentActive = await getActiveEventId();
  if (!currentActive) {
    await setActiveEventId(evt.id);
  }

  try {
    await redis.set(`dk24:pending_event:${evt.id}`, JSON.stringify(evt), "EX", 86400 * 3);
  } catch (err) {
    console.warn("[eventIngestion] Redis save failed, using memory:", err);
  }
}

/**
 * Gets a pending event by ID (or the active one if id is omitted).
 */
export async function getPendingEvent(id?: string): Promise<PendingEventData | null> {
  const targetId = id || (await getActiveEventId());
  if (!targetId) return null;

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
  const activeId = await getActiveEventId();
  if (activeId === id) {
    await setActiveEventId(null);
  }
  const queue = await getEventQueue();
  const filtered = queue.filter((item) => item !== id);
  if (filtered.length !== queue.length) {
    await setEventQueue(filtered);
  }

  try {
    await redis.del(`dk24:pending_event:${id}`);
  } catch (_) {}
}

/**
 * Sends a single consolidated message: poster image with review card as caption,
 * or plain text card if no image exists.
 */
export async function sendEventReviewCard(
  sock: any,
  targetJid: string,
  evt: PendingEventData,
  noticePrefix?: string,
): Promise<void> {
  const queue = await getEventQueue();
  const card = formatEventReviewCard(evt, queue.length);
  const fullText = noticePrefix ? `> ${noticePrefix}\n\n${card}` : card;
  const imageBuffer = posterBufferCache.get(evt.id);

  if (imageBuffer) {
    await sock.sendMessage(targetJid, {
      image: imageBuffer,
      caption: fullText,
    });
  } else {
    await sendBotReply(sock, targetJid, fullText);
  }
}

/**
 * Promotes the next queued event to active and posts its review card.
 */
export async function promoteNextQueuedEvent(
  sock: any,
  reviewJid: string,
  noticePrefix?: string,
): Promise<boolean> {
  const queue = await getEventQueue();
  if (queue.length === 0) {
    await setActiveEventId(null);
    return false;
  }

  const nextId = queue.shift()!;
  await setEventQueue(queue);
  await setActiveEventId(nextId);

  const nextEvt = await getPendingEvent(nextId);
  if (!nextEvt) {
    return promoteNextQueuedEvent(sock, reviewJid, noticePrefix);
  }

  nextEvt.expiresAt = Date.now() + TIMEOUT_MS;
  await savePendingEvent(nextEvt);

  const prefix = noticePrefix
    ? `${noticePrefix}\n> Now reviewing "${nextEvt.eventName || "Untitled"}":`
    : `Now reviewing "${nextEvt.eventName || "Untitled"}":`;

  await sendEventReviewCard(sock, reviewJid, nextEvt, prefix);
  return true;
}

let timeoutWatcherStarted = false;
export function ensureTimeoutWatcher(sock: any): void {
  if (timeoutWatcherStarted) return;
  timeoutWatcherStarted = true;
  setInterval(async () => {
    try {
      await checkActiveEventTimeout(sock);
    } catch (err) {
      console.warn("[eventIngestion] Timeout check error:", err);
    }
  }, 30000);
}

export async function checkActiveEventTimeout(sock: any): Promise<void> {
  const activeId = await getActiveEventId();
  if (!activeId) return;

  const evt = await getPendingEvent(activeId);
  if (!evt) return;

  if (evt.expiresAt && Date.now() > evt.expiresAt) {
    console.log(`[eventIngestion] Event timed out after 30 minutes.`);
    const reviewJid = getDestinationReviewGroupJid();
    await clearPendingEvent(evt.id);

    const nextPromoted = await promoteNextQueuedEvent(
      sock,
      reviewJid,
      `Event "${evt.eventName || "Untitled"}" timed out after 30 minutes of inactivity and was removed.`,
    );

    if (!nextPromoted) {
      await sendBotReply(
        sock,
        reviewJid,
        `> Event "${evt.eventName || "Untitled"}" timed out after 30 minutes of inactivity. Queue is now empty.`,
      );
    }
  }
}

/**
 * Formats the event review card message for WhatsApp with clean, emoji-free markdown.
 */
export function formatEventReviewCard(evt: PendingEventData, queueCount: number = 0): string {
  const missing = getMissingRequiredFields(evt);
  const isComplete = missing.length === 0;

  const lines = [
    "*DK24 Event Review*",
    "",
    `*Event Name:* ${evt.eventName || "[Missing]"}`,
    `*Organization:* ${evt.organizationName || "[Missing]"}`,
    `*Start:* ${evt.startDateTime || "[Missing]"}`,
    `*End:* ${evt.endDateTime || "[Missing]"}`,
    `*Location:* ${evt.eventLocation || "[Missing]"}`,
    `*Tags:* ${evt.eventTags && evt.eventTags.length > 0 ? evt.eventTags.join(", ") : "[Missing]"}`,
    `*Website:* ${evt.eventWebsite || "[None]"}`,
    `*Registration Link:* ${evt.registrationLink || "[None]"}`,
    `*Poster URL:* ${evt.eventPosterUrl || "[None]"}`,
    `*Submitter:* ${evt.submittedBy || "[Missing]"} (${evt.submittedEmail || "[Missing]"})`,
    "",
    "*Description:*",
    evt.eventDescription || "[Missing description]",
    "",
    "──────────────────────────────",
  ];

  if (isComplete) {
    if (evt.status === "awaiting_confirmation") {
      lines.push(
        "*Ready for Submission*",
        "",
        "> Reply *!CONFIRM* to certify details and push to DK24 calendar.",
        "> Reply *!edit <flags>* to make changes.",
        "> Reply *!cancel* to discard.",
      );
    } else {
      lines.push(
        "*All required fields are present.*",
        "",
        "> Reply *!submit* or *!CONFIRM* to review and proceed.",
        "> Reply *!edit <flags>* to make any adjustments.",
        "> Reply *!cancel* to discard.",
      );
    }
  } else {
    lines.push(
      "*Missing Required Fields:*",
      ...missing.map((m) => `• ${m}`),
      "",
      "!edit -en <name> -on <org> -sdt <start> -edt <end> -eloc <loc> -desc <desc> -etag <tags> -reglink <link> -eweb <site> -epos <url> -name <yourName> -email <yourEmail>",
      "",
      "*Available Tags:*",
      formatTagOptionsList(),
      "",
      "> Tip: For poster URL (-epos), upload image to a free host and paste direct link.",
      "> Reply *!cancel* to discard this event.",
    );
  }

  if (queueCount > 0) {
    lines.push(
      `> Queue: ${queueCount} other event${queueCount === 1 ? "" : "s"} waiting (reply *!queue* to switch).`,
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

  console.log(`[eventIngestion] 📥 Detected message in announcement/read group: ${from}`);

  const groqApiKey = process.env.GROQ_API_KEY;
  const groqModel = process.env.GROQ_MODEL || "openai/gpt-oss-120b";
  if (!groqApiKey) {
    console.warn("[eventIngestion] ⚠️ GROQ_API_KEY not configured, cannot classify event.");
    return false;
  }

  // 1. Extract image & caption
  const rawMsg = msg.message;
  const msgObj = normalizeMessageContent(rawMsg);
  const imageInfo =
    msgObj?.imageMessage ||
    (rawMsg as any)?.imageMessage ||
    (rawMsg as any)?.ephemeralMessage?.message?.imageMessage ||
    (rawMsg as any)?.viewOnceMessage?.message?.imageMessage ||
    (rawMsg as any)?.viewOnceMessageV2?.message?.imageMessage;

  let textContent =
    imageInfo?.caption ||
    msgObj?.conversation ||
    msgObj?.extendedTextMessage?.text ||
    "";
  textContent = textContent.trim();

  let imageBuffer: Buffer | null = null;
  if (imageInfo) {
    try {
      console.log(`[eventIngestion] 🖼️ Downloading image from message ${msg.key?.id}...`);
      imageBuffer = (await downloadMediaMessage(
        { key: msg.key, message: { imageMessage: imageInfo } } as any,
        "buffer",
        {},
      )) as Buffer;
      if (imageBuffer) {
        console.log(`[eventIngestion] 🔍 Image downloaded (${imageBuffer.length} bytes). Running OCR via Tesseract...`);
        const ocrText = await extractTextFromImage(imageBuffer);
        if (ocrText.trim()) {
          console.log(`[eventIngestion] ✅ OCR extracted text (${ocrText.trim().length} chars):\n${ocrText.trim().slice(0, 150)}...`);
          textContent = `${textContent}\n\n${ocrText}`.trim();
        } else {
          console.log("[eventIngestion] ℹ️ OCR finished but found no readable text.");
        }
      }
    } catch (err) {
      console.warn("[eventIngestion] ⚠️ Failed downloading media message:", err);
    }
  }

  // If text is too short and no image, ignore
  if (textContent.length < 15 && !imageBuffer) {
    console.log(`[eventIngestion] ℹ️ Content too short (${textContent.length} chars) with no image, skipping.`);
    return false;
  }

  // 2. Classification
  console.log(`[eventIngestion] 🤖 Classifying content (${textContent.length} chars) with Groq...`);
  const classification = await classifyIfEvent(textContent, groqApiKey, groqModel);
  console.log(
    `[eventIngestion] 📊 Result: isEvent=${classification.isEvent}, confidence=${classification.confidence}, category="${classification.category}"`,
  );
  if (!classification.isEvent || classification.confidence < 0.6) {
    console.log("[eventIngestion] ⏭️ Message classified as NOT an event. Skipping relay.");
    return false;
  }

  // 3. Schema Extraction
  console.log("[eventIngestion] Event confirmed! Extracting structured DK24 showcase schema...");
  const extracted = await extractEventSchema(textContent, groqApiKey, groqModel);
  const eventId = String(eventCounter++);
  console.log(`[eventIngestion] Event #${eventId} extracted: "${extracted.eventName}" by "${extracted.organizationName}"`);

  const pendingEvent: PendingEventData = {
    id: eventId,
    sourceGroupJid: normFrom,
    sourceMessageId: msg.key?.id || undefined,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    expiresAt: Date.now() + TIMEOUT_MS,
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

  // 4. Multi-Event Queueing & Relay to Review Group
  ensureTimeoutWatcher(sock);
  const activeId = await getActiveEventId();
  const queue = await getEventQueue();
  const reviewJid = getDestinationReviewGroupJid();

  if (activeId) {
    // Another event is actively being reviewed — quietly place this in the queue
    queue.push(eventId);
    await setEventQueue(queue);
    console.log(`[eventIngestion] Active event #${activeId} exists. Queued event #${eventId} silently (Queue size: ${queue.length}).`);
    return true;
  }

  // No active event — make this event active and post consolidated card (poster + review text)
  await setActiveEventId(eventId);
  console.log(`[eventIngestion] Relaying event #${eventId} to review group: ${reviewJid}`);
  await sendEventReviewCard(sock, reviewJid, pendingEvent);
  return true;
}

/**
 * Parses user input flags for !edit supporting aliases and full flag set.
 */
export function parseEditEventFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  let currentFlag: string | null = null;
  let rawFlag: string | null = null;
  const currentTokens: string[] = [];

  const flagAliases: Record<string, string> = {
    "-en": "-en",
    "-eventname": "-en",
    "-on": "-on",
    "-org": "-on",
    "-organization": "-on",
    "-sdt": "-sdt",
    "-start": "-sdt",
    "-edt": "-edt",
    "-end": "-edt",
    "-eloc": "-eloc",
    "-el": "-eloc",
    "-loc": "-eloc",
    "-location": "-eloc",
    "-eweb": "-eweb",
    "-web": "-eweb",
    "-website": "-eweb",
    "-rlink": "-reglink",
    "-reglink": "-reglink",
    "-register": "-reglink",
    "-epos": "-epos",
    "-poster": "-epos",
    "-etag": "-etag",
    "-tags": "-etag",
    "-tag": "-etag",
    "-desc": "-desc",
    "-description": "-desc",
    "-name": "-name",
    "-submitter": "-name",
    "-email": "-email",
  };

  const reverseAliases: Record<string, string[]> = {
    "-en": ["-en", "-eventname"],
    "-on": ["-on", "-org", "-organization"],
    "-sdt": ["-sdt", "-start"],
    "-edt": ["-edt", "-end"],
    "-eloc": ["-eloc", "-el", "-loc", "-location"],
    "-eweb": ["-eweb", "-web", "-website"],
    "-reglink": ["-reglink", "-rlink", "-register"],
    "-epos": ["-epos", "-poster"],
    "-etag": ["-etag", "-tags", "-tag"],
    "-desc": ["-desc", "-description"],
    "-name": ["-name", "-submitter"],
    "-email": ["-email"],
  };

  const assignFlag = (canonical: string, raw: string | null, val: string) => {
    flags[canonical] = val;
    if (raw) flags[raw] = val;
    const aliases = reverseAliases[canonical] || [];
    for (const a of aliases) {
      flags[a] = val;
    }
  };

  const knownFlags = new Set(Object.keys(flagAliases));

  for (const token of args) {
    const lower = token.toLowerCase();
    if (knownFlags.has(lower)) {
      if (currentFlag) {
        assignFlag(currentFlag, rawFlag, currentTokens.join(" ").trim());
        currentTokens.length = 0;
      }
      currentFlag = flagAliases[lower];
      rawFlag = lower;
    } else {
      currentTokens.push(token);
    }
  }

  if (currentFlag) {
    assignFlag(currentFlag, rawFlag, currentTokens.join(" ").trim());
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
      "Unauthorized: Only DK24 Core members or the admin can edit events.",
    );
    return;
  }

  ensureTimeoutWatcher(sock);

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
      "No pending event found to edit. A new event will be loaded when announced.",
    );
    return;
  }

  const flags = parseEditEventFlags(flagArgs);
  if (Object.keys(flags).length === 0) {
    await sendBotReply(
      sock,
      from,
      "Usage:\n!edit -en <name> -on <org> -sdt <start> -edt <end> -eloc <loc> -desc <desc> -etag <tags> -reglink <link> -eweb <site> -epos <url> -name <yourName> -email <yourEmail>",
    );
    return;
  }

  if (flags["-en"]) evt.eventName = flags["-en"];
  if (flags["-on"]) evt.organizationName = flags["-on"];

  if (flags["-sdt"]) {
    const parsed = parseFlexibleDate(flags["-sdt"]);
    if (parsed) {
      evt.startDateTime = parsed;
    } else {
      await sendBotReply(
        sock,
        from,
        "Invalid start date. You can use formats like '21st May, 2026, 9:00 PM', '07/09/2029 08:45 AM', or 'April 2nd 26 12:30'.",
      );
      return;
    }
  }

  if (flags["-edt"]) {
    const parsed = parseFlexibleDate(flags["-edt"]);
    if (parsed) {
      evt.endDateTime = parsed;
    } else {
      await sendBotReply(
        sock,
        from,
        "Invalid end date. You can use formats like '21st May, 2026, 9:00 PM', '07/09/2029 08:45 AM', or 'April 2nd 26 12:30'.",
      );
      return;
    }
  }

  if (flags["-eloc"]) evt.eventLocation = flags["-eloc"];
  if (flags["-eweb"]) evt.eventWebsite = flags["-eweb"];
  if (flags["-reglink"]) evt.registrationLink = flags["-reglink"];
  if (flags["-epos"]) evt.eventPosterUrl = flags["-epos"];
  if (flags["-desc"]) evt.eventDescription = flags["-desc"];
  if (flags["-name"]) evt.submittedBy = flags["-name"];
  if (flags["-email"]) evt.submittedEmail = flags["-email"];
  if (flags["-etag"]) {
    const parsedTags = parseTagInput(flags["-etag"]);
    if (parsedTags.length > 0) evt.eventTags = parsedTags;
  }

  evt.updatedAt = Date.now();
  evt.expiresAt = Date.now() + TIMEOUT_MS;
  evt.status = "pending_review";
  await savePendingEvent(evt);

  await sendEventReviewCard(sock, from, evt, "Event details updated.");
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
      "Unauthorized: Only DK24 Core members or the admin can submit events.",
    );
    return;
  }

  const targetId = cmdArgs[0]?.replace(/^#/, "");
  const evt = await getPendingEvent(targetId);
  if (!evt) {
    await sendBotReply(sock, from, "No pending event found to submit.");
    return;
  }

  const missing = getMissingRequiredFields(evt);
  if (missing.length > 0) {
    await sendBotReply(
      sock,
      from,
      `Cannot submit yet. The following required fields are missing:\n${missing.map((m) => `• ${m}`).join("\n")}\n\nUse !edit <flags> to complete them.`,
    );
    return;
  }

  evt.status = "awaiting_confirmation";
  evt.updatedAt = Date.now();
  evt.expiresAt = Date.now() + TIMEOUT_MS;
  await savePendingEvent(evt);

  await sendEventReviewCard(sock, from, evt);
}

/**
 * Handles !queue / !q command to cycle/switch events in the queue
 */
export async function handleQueueEventCommand(
  sock: any,
  from: string,
  senderId: string | undefined,
  msg?: any,
): Promise<void> {
  const isAuthorized = await isCoreOrAdmin(senderId, msg);
  if (!isAuthorized) {
    await sendBotReply(sock, from, "Unauthorized: Core role or Admin required.");
    return;
  }

  const activeId = await getActiveEventId();
  const queue = await getEventQueue();

  if (queue.length === 0) {
    if (activeId) {
      const activeEvt = await getPendingEvent(activeId);
      await sendBotReply(
        sock,
        from,
        `> The queue is empty. Currently reviewing "${activeEvt?.eventName || "Untitled"}".`,
      );
    } else {
      await sendBotReply(sock, from, "> No active event and the queue is empty.");
    }
    return;
  }

  // Defer current active event to back of queue
  if (activeId) {
    queue.push(activeId);
  }

  const nextId = queue.shift()!;
  await setEventQueue(queue);
  await setActiveEventId(nextId);

  const nextEvt = await getPendingEvent(nextId);
  if (!nextEvt) {
    await sendBotReply(sock, from, "> Failed to load next event from queue.");
    return;
  }

  nextEvt.expiresAt = Date.now() + TIMEOUT_MS;
  await savePendingEvent(nextEvt);

  const reviewJid = getDestinationReviewGroupJid();
  const notice = activeId
    ? `Switched active event to "${nextEvt.eventName || "Untitled"}". Previous event was moved to the queue.`
    : `Now reviewing "${nextEvt.eventName || "Untitled"}":`;

  await sendEventReviewCard(sock, reviewJid, nextEvt, notice);
}

/**
 * Handles !cancel command to discard the active event and promote the next queued event
 */
export async function handleCancelEventCommand(
  sock: any,
  from: string,
  senderId: string | undefined,
  cmdArgs: string[] = [],
  msg?: any,
): Promise<void> {
  const isAuthorized = await isCoreOrAdmin(senderId, msg);
  if (!isAuthorized) {
    await sendBotReply(sock, from, "> Unauthorized: Core role or Admin required.");
    return;
  }

  const targetId = cmdArgs[0]?.replace(/^#/, "");
  const activeId = await getActiveEventId();
  const queue = await getEventQueue();

  // If specific queued event target was provided
  if (targetId && targetId !== activeId) {
    const idx = queue.indexOf(targetId);
    if (idx !== -1) {
      queue.splice(idx, 1);
      await setEventQueue(queue);
      await clearPendingEvent(targetId);
      await sendBotReply(sock, from, "> Event cancelled and removed from queue.");
      return;
    }
  }

  const cancelId = targetId || activeId;
  if (!cancelId) {
    await sendBotReply(sock, from, "> No active event found to cancel.");
    return;
  }

  const evt = await getPendingEvent(cancelId);
  await clearPendingEvent(cancelId);

  const reviewJid = getDestinationReviewGroupJid();
  const nextPromoted = await promoteNextQueuedEvent(
    sock,
    reviewJid,
    `Event "${evt?.eventName || "Untitled"}" has been cancelled.`,
  );

  if (!nextPromoted) {
    await sendBotReply(sock, from, `> Event "${evt?.eventName || "Untitled"}" has been cancelled. No remaining events in queue.`);
  }
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
      "Unauthorized: Only DK24 Core members or the admin can confirm events.",
    );
    return;
  }

  const targetId = cmdArgs[0]?.replace(/^#/, "");
  const evt = await getPendingEvent(targetId);
  if (!evt) {
    await sendBotReply(sock, from, "No pending event found to confirm.");
    return;
  }

  const missing = getMissingRequiredFields(evt);
  if (missing.length > 0) {
    await sendBotReply(
      sock,
      from,
      `Cannot confirm yet. Required fields are missing:\n${missing.map((m) => `• ${m}`).join("\n")}\n\nUse !edit <flags> first.`,
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
  console.log(`Pushing event to DK24 website: ${url}`);

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
        `Website submission returned error (${res.status}). Please verify API status or retry with !CONFIRM.`,
      );
      return;
    }

    await clearPendingEvent(evt.id);

    const reviewJid = getDestinationReviewGroupJid();
    const successMsg =
      `*Event Successfully Submitted to DK24 Showcase Review*\n\n` +
      `*Event:* ${evt.eventName}\n` +
      `*Organization:* ${evt.organizationName}\n` +
      `*Dates:* ${evt.startDateTime} → ${evt.endDateTime}\n\n` +
      `The website moderators will review and publish it on the calendar.`;

    await sendBotReply(sock, from, successMsg);

    // Promote next queued event if available
    await promoteNextQueuedEvent(sock, reviewJid, "Next queued event is ready for review:");
  } catch (error) {
    console.error("[eventIngestion] Network error submitting to website:", error);
    await sendBotReply(
      sock,
      from,
      `Network error reaching DK24 website (${error instanceof Error ? error.message : String(error)}).`,
    );
  }
}

