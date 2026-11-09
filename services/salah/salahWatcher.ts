/**
 * Salah timetable watcher: when someone posts a photo of the masjid's prayer-time board in the
 * timings group, read it and hand the times to the laptop (Aerie) over Redis.
 *
 *  - Only the configured group is watched (SALAH_GROUP_JID).
 *  - The chat around the photo (its caption and the group's messages from 15 minutes before to
 *    90 seconds after) is checked for the masjid's name: a photo tied to a different masjid is
 *    skipped; one with no name is used but marked as assumed.
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
const BEFORE_MS = 15 * 60 * 1000;
const AFTER_MS = 90 * 1000;

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

/** Recent text in the group, to find a masjid name near a photo. */
export class RecentTexts {
  private items: Array<{ at: number; text: string }> = [];
  add(at: number, text: string): void {
    if (!text.trim()) return;
    this.items.push({ at, text });
    const cutoff = at - 2 * BEFORE_MS;
    this.items = this.items.filter((i) => i.at >= cutoff).slice(-200);
  }
  around(at: number): string {
    return this.items.filter((i) => i.at >= at - BEFORE_MS && i.at <= at + AFTER_MS).map((i) => i.text).join("\n");
  }
}

/** Decide from the caption and the chat whether to use the photo, and whether the masjid was named. */
export function decide(caption: string, chat: string, ours = SALAH_MASJID.split(/\s+/)[0]): { use: boolean; named: boolean } {
  const cap = masjidMention(caption, ours);
  if (cap === "this") return { use: true, named: true };
  if (cap === "other") return { use: false, named: false };
  const near = masjidMention(chat, ours);
  if (near === "this") return { use: true, named: true };
  if (near === "other") return { use: false, named: false };
  return { use: true, named: false };
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

const recent = new RecentTexts();

async function handlePhoto(msg: any, image: any, at: number): Promise<void> {
  // Give the group a moment to say which masjid it is ("Noor masjid timings" often follows).
  await new Promise((r) => setTimeout(r, AFTER_MS));
  const { use, named } = decide(image.caption || "", recent.around(at));
  if (!use) {
    console.log("[salah] photo skipped: the chat ties it to another masjid");
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
  console.log(`[salah] timetable sent to the laptop (${read.source}${named ? "" : ", masjid assumed"}): ${read.timetable.adhan.join(" ")}`);
}

/** Wire the watcher onto the Baileys socket. Off with SALAH_WATCH_ENABLED=false. */
export function registerSalahWatcher(sock: any): void {
  if (process.env.SALAH_WATCH_ENABLED === "false") return;
  sock.ev.on("messages.upsert", ({ messages }: { messages: any[] }) => {
    for (const msg of messages ?? []) {
      if (msg?.key?.remoteJid !== SALAH_GROUP_JID) continue;
      const at = Number(msg.messageTimestamp ?? 0) * 1000 || Date.now();
      recent.add(at, textOf(msg));
      const image = imageOf(msg);
      // History sync replays old photos on reconnect: only boards from the last day are read.
      if (image && Date.now() - at < 24 * 60 * 60 * 1000) {
        void handlePhoto(msg, image, at).catch((err) => console.warn("[salah] could not read the photo:", err instanceof Error ? err.message : err));
      }
    }
  });
  console.log(`[salah] watching ${SALAH_GROUP_JID} for ${SALAH_MASJID} timetables`);
}
