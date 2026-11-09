/**
 * Photo of a masjid board -> timetable. OCR first (tesseract, no AI): three passes over the image
 * prepared three ways must agree. Only if they do not, the Groq vision model reads it, and its
 * answer goes through the same sanity check.
 */
import sharp from "sharp";
import { createWorker } from "tesseract.js";
import { agreedTimetable, checkTimetable, parseBoard, type OcrWord, type Timetable } from "./timetable";

export interface BoardRead {
  timetable: Timetable;
  source: "ocr" | "vision";
}

async function ocrPass(worker: any, image: Buffer): Promise<Timetable | null> {
  const { data } = await worker.recognize(image, {}, { blocks: true });
  const words: OcrWord[] = [];
  for (const b of data.blocks ?? []) for (const p of b.paragraphs) for (const l of p.lines) for (const w of l.words) {
    words.push({ text: w.text, x: w.bbox.x0, y: w.bbox.y0 });
  }
  return parseBoard(words, data.text ?? "");
}

export async function ocrBoard(image: Buffer): Promise<Timetable | null> {
  const prepared = [
    await sharp(image).rotate().grayscale().normalize().resize({ width: 2000 }).toBuffer(),
    await sharp(image).rotate().grayscale().normalize().resize({ width: 2000 }).threshold(150).toBuffer(),
    await sharp(image).rotate().resize({ width: 1600 }).toBuffer(),
  ];
  const worker = await createWorker("eng");
  try {
    const reads: Array<Timetable | null> = [];
    for (const img of prepared) {
      reads.push(await ocrPass(worker, img).catch(() => null));
      const agreed = agreedTimetable(reads);
      if (agreed) return agreed;
    }
    return null;
  } finally {
    await worker.terminate().catch(() => {});
  }
}

const VISION_MODEL = process.env.GROQ_VISION_MODEL || process.env.GROQ_MODEL_SCOUT || "meta-llama/llama-4-scout-17b-16e-instruct";

const VISION_PROMPT = `This is a photo of a mosque's prayer-time board. Read it and answer with JSON only:
{"date":"YYYY-MM-DD or null","adhan":["Fajr","Dhuhr","Asr","Maghrib","Isha"],"iqamah":[5 values or null],"sunrise":"HH:MM or null"}
Use 24-hour "HH:MM" times (the board uses a 12-hour clock: Dhuhr is around midday, Asr/Maghrib/Isha are afternoon/evening).
The adhan (الأذان) column and the iqamah (الإقامة) column are labelled at the top. If this is not a prayer-time board, answer {"not_a_board":true}.`;

export async function visionBoard(image: Buffer): Promise<Timetable | null> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;
  const { default: Groq } = await import("groq-sdk");
  const client = new Groq({ apiKey });
  const jpeg = await sharp(image).rotate().resize({ width: 1400, withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
  const res: any = await (client.chat.completions.create as any)({
    model: VISION_MODEL,
    temperature: 0,
    max_tokens: 300,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: VISION_PROMPT },
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${jpeg.toString("base64")}` } },
        ],
      },
    ],
  });
  const text: string = res?.choices?.[0]?.message?.content ?? "";
  let v: any;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (!v || v.not_a_board || !Array.isArray(v.adhan) || v.adhan.length !== 5) return null;
  const hhmm = (s: unknown) => (typeof s === "string" && /^\d{1,2}:\d{2}$/.test(s.trim()) ? s.trim().padStart(5, "0") : null);
  const adhan = v.adhan.map(hhmm);
  if (adhan.some((a: string | null) => !a)) return null;
  const iq = Array.isArray(v.iqamah) && v.iqamah.length === 5 ? v.iqamah.map(hhmm) : [null, null, null, null, null];
  const t: Timetable = {
    date: typeof v.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.date) ? v.date : null,
    adhan,
    iqamah: iq,
    sunrise: hhmm(v.sunrise),
  };
  return checkTimetable(t) === null ? t : null;
}

/** OCR, then the vision model if OCR could not get an agreed, sane reading. */
export async function readBoard(image: Buffer, opts: { allowVision?: boolean } = {}): Promise<BoardRead | null> {
  const ocr = await ocrBoard(image).catch((e) => {
    console.warn("[salah] OCR failed:", e instanceof Error ? e.message : e);
    return null;
  });
  if (ocr) return { timetable: ocr, source: "ocr" };
  if (opts.allowVision === false) return null;
  const vision = await visionBoard(image).catch((e) => {
    console.warn("[salah] vision read failed:", e instanceof Error ? e.message : e);
    return null;
  });
  return vision ? { timetable: vision, source: "vision" } : null;
}
