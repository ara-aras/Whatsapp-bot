/**
 * Salah timetable watcher: when someone posts a photo of the masjid's prayer-time board in the
 * timings group, read it and hand the times to the laptop (Aerie) over Redis.
 *
 *  - Only the configured group is watched (SALAH_GROUP_JID).
 *  - Which masjid a photo is for: its caption, if that names a masjid; otherwise the first message
 *    after it (within 3 minutes, and before the next photo) that names one. Text sent before the
 *    photo never counts: it belongs to an earlier photo. A photo of another masjid, or one nobody
 *    names, is skipped.
 *  - The photo is read by OCR first; the Groq vision model only if OCR cannot agree on the times.
 *  - The result is stored under SALAH_KEY (so Aerie gets it when it connects later) and published
 *    on SALAH_CHANNEL (so a running Aerie gets it at once).
 *
 * Env: SALAH_WATCH_ENABLED (default true), SALAH_GROUP_JID, SALAH_MASJID ("Noor Masjid"),
 * SALAH_CHANNEL ("laptop:salah"), SALAH_KEY ("laptop:salah:times"), SALAH_VISION (default true).
 */
import { downloadMediaMessage, normalizeMessageContent } from "@whiskeysockets/baileys";
import { masjidMention, type Timetable } from "./timetable";

export const SALAH_GROUP_JID = process.env.SALAH_GROUP_JID || "120363375381319043@g.us";
export const SALAH_MASJID = process.env.SALAH_MASJID || "Noor Masjid";
export const SALAH_CHANNEL = process.env.SALAH_CHANNEL || "laptop:salah";
export const SALAH_KEY = process.env.SALAH_KEY || "laptop:salah:times";
const KEEP_MS = 30 * 24 * 60 * 60 * 1000;
/** How long after a photo its label may still come ("Noor masjid" sent as the next message). */
const AFTER_MS = 3 * 60 * 1000;

/** What Aerie receives (matches `BoardMessage` in Aerie's src-tauri/src/aerie_salah/mod.rs). */
export interface BoardMessage {
  masjid: string;
  named: boolean;
  date: string | null;
  adhan: string[];
  iqamah: Array<string | null>;
  sunrise: string | null;
  source: "ocr" | "vision";
  sent_at: number;
}

export function boardMessage(t: Timetable, source: "ocr" | "vision", named: boolean, sentAt: number, masjid = SALAH_MASJID): BoardMessage {
  return { masjid, named, date: t.date, adhan: t.adhan, iqamah: t.iqamah, sunrise: t.sunrise, source, sent_at: sentAt };
}

/** One message in the group, in the order they arrived. */
export interface GroupEvent {
  seq: number;
  at: number;
  kind: "text" | "image";
  text: string;
}

/** The group's recent messages, in arrival order (timestamps are only to the second). */
export class GroupLog {
  private seq = 0;
  private items: GroupEvent[] = [];
  add(at: number, kind: "text" | "image", text: string): number {
    const seq = ++this.seq;
    if (kind === "image" || text.trim()) this.items.push({ seq, at, kind, text });
    const cutoff = at - 30 * 60 * 1000;
    this.items = this.items.filter((i) => i.at >= cutoff).slice(-300);
    return seq;
  }
  /** What came after message `seq`, up to `until`. */
  after(seq: number, until: number): GroupEvent[] {
    return this.items.filter((i) => i.seq > seq && i.at <= until);
  }
}

/**
 * Which masjid a photo is for:
 *  [photo + caption]         the caption decides, when it names a masjid;
 *  [photo] then [text]       the first text after it that names a masjid decides, stopping at the
 *                            next photo (that text would be for the newer photo);
 *  nothing names it          skipped (a board from another masjid must never replace Noor's).
 */
export function labelPhoto(caption: string, following: GroupEvent[], ours = SALAH_MASJID.split(/\s+/)[0]): { use: boolean; named: boolean; why: string } {
  const cap = masjidMention(caption, ours);
  if (cap === "this") return { use: true, named: true, why: "caption" };
  if (cap === "other") return { use: false, named: false, why: "caption names another masjid" };
  for (const e of following) {
    if (e.kind === "image") break;
    const m = masjidMention(e.text, ours);
    if (m === "this") return { use: true, named: true, why: "next message" };
    if (m === "other") return { use: false, named: false, why: "next message names another masjid" };
  }
  return { use: false, named: false, why: "no masjid named" };
}

function imageOf(msg: any): any | null {
  const raw = msg?.message;
  const m = normalizeMessageContent(raw);
  return (
    m?.imageMessage ||
    raw?.imageMessage ||
    raw?.ephemeralMessage?.message?.imageMessage ||
    raw?.viewOnceMessage?.message?.imageMessage ||
    raw?.viewOnceMessageV2?.message?.imageMessage ||
    null
  );
}

function textOf(msg: any): string {
  const m = normalizeMessageContent(msg?.message);
  return m?.conversation || m?.extendedTextMessage?.text || m?.imageMessage?.caption || "";
}

const log = new GroupLog();

async function handlePhoto(msg: any, image: any, at: number, seq: number): Promise<void> {
  // Without a named caption, give the group a moment to say which masjid it is.
  if (masjidMention(image.caption || "", SALAH_MASJID.split(/\s+/)[0]) === "none") await new Promise((r) => setTimeout(r, AFTER_MS));
  const { use, named, why } = labelPhoto(image.caption || "", log.after(seq, at + AFTER_MS));
  if (!use) {
    console.log(`[salah] photo skipped: ${why}`);
    return;
  }
  const buffer = (await downloadMediaMessage({ key: msg.key, message: { imageMessage: image } } as any, "buffer", {})) as Buffer;
  const { readBoard } = await import("./readBoard");
  const read = await readBoard(buffer, { allowVision: process.env.SALAH_VISION !== "false" });
  if (!read) {
    console.log("[salah] photo is not a readable timetable; ignored");
    return;
  }
  const payload = JSON.stringify(boardMessage(read.timetable, read.source, named, at));
  const { redis } = await import("../../storage/redisClient");
  await redis.set(SALAH_KEY, payload, "PX", KEEP_MS);
  await redis.publish(SALAH_CHANNEL, payload);
  console.log(`[salah] timetable sent to the laptop (${read.source}, named by ${why}): ${read.timetable.adhan.join(" ")}`);
}

/** Wire the watcher onto the Baileys socket. Off with SALAH_WATCH_ENABLED=false. */
export function registerSalahWatcher(sock: any): void {
  if (process.env.SALAH_WATCH_ENABLED === "false") return;
  sock.ev.on("messages.upsert", ({ messages }: { messages: any[] }) => {
    for (const msg of messages ?? []) {
      if (msg?.key?.remoteJid !== SALAH_GROUP_JID) continue;
      const at = Number(msg.messageTimestamp ?? 0) * 1000 || Date.now();
      const image = imageOf(msg);
      const seq = log.add(at, image ? "image" : "text", textOf(msg));
      // History sync replays old photos on reconnect: only boards from the last day are read.
      if (image && Date.now() - at < 24 * 60 * 60 * 1000) {
        void handlePhoto(msg, image, at, seq).catch((err) => console.warn("[salah] could not read the photo:", err instanceof Error ? err.message : err));
      }
    }
  });
  console.log(`[salah] watching ${SALAH_GROUP_JID} for ${SALAH_MASJID} timetables`);
}
