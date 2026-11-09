/**
 * Reading a masjid's prayer-time board from a photo.
 *
 * The board (see the Noor Masjid one) has an Arabic label column in the middle, the adhan times in
 * the right-hand column and the iqamah (jamaat) times in the left-hand one, Fajr..Isha top to
 * bottom, then the sunrise/duha row. Times are on a 12-hour clock without AM/PM. The digits are
 * Latin, so plain OCR (tesseract, English) reads them; the Arabic labels are not needed because
 * the rows are always in the same order.
 *
 * Everything here is pure (word boxes in, timetable out) so it is unit-tested; the OCR and the
 * vision-model fallback live in `readBoard.ts`.
 */

export interface OcrWord {
  text: string;
  /** Left / top of the word's box, in image pixels. */
  x: number;
  y: number;
}

export const PRAYERS = ["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"] as const;

export interface Timetable {
  /** "YYYY-MM-DD" printed on the board, if read. */
  date: string | null;
  /** 24-hour "HH:MM", Fajr..Isha. */
  adhan: string[];
  iqamah: Array<string | null>;
  sunrise: string | null;
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * 12-hour board time -> 24-hour "HH:MM" for prayer `i` (0 Fajr .. 4 Isha, 5 = sunrise).
 * Fajr and sunrise are morning; Dhuhr is 11:xx/12:xx or 1:xx/2:xx afternoon; the rest afternoon.
 */
export function to24(i: number, h: number, m: number): string | null {
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  let hh = h;
  if (i === 1) hh = h >= 11 ? h : h + 12;
  else if (i >= 2 && i <= 4) hh = h < 12 ? h + 12 : h;
  else if (h === 12) hh = 0;
  return `${pad(hh)}:${pad(m)}`;
}

const TIME = /(\d{1,2})[:.](\d{2})(?![:.]?\d)/;
const CLOCK = /\d{1,2}:\d{2}:\d{2}/;

/** The H:MM tokens on the board with their positions (the live HH:MM:SS clock is left out). */
export function timeTokens(words: OcrWord[]): Array<{ h: number; m: number; x: number; y: number }> {
  const out: Array<{ h: number; m: number; x: number; y: number }> = [];
  for (const w of words) {
    if (CLOCK.test(w.text)) continue;
    const t = TIME.exec(w.text);
    if (!t) continue;
    out.push({ h: Number(t[1]), m: Number(t[2]), x: w.x, y: w.y });
  }
  return out;
}

/** The board's printed date ("2026-11-04", also with / or .), if any. */
export function findDate(text: string): string | null {
  const d = /(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(text);
  if (!d) return null;
  const [y, mo, da] = [Number(d[1]), Number(d[2]), Number(d[3])];
  if (mo < 1 || mo > 12 || da < 1 || da > 31) return null;
  return `${y}-${pad(mo)}-${pad(da)}`;
}

/**
 * Word boxes -> timetable. The time tokens are split into a left and a right column by x (the
 * photo may be slanted, so rows are not matched by y; each column is read top to bottom).
 * Right = adhan, left = iqamah; the sixth right-hand time is sunrise.
 */
export function parseBoard(words: OcrWord[], fullText = ""): Timetable | null {
  const toks = timeTokens(words);
  if (toks.length < 10) return null;
  const xs = toks.map((t) => t.x);
  const mid = (Math.min(...xs) + Math.max(...xs)) / 2;
  const left = toks.filter((t) => t.x < mid).sort((a, b) => a.y - b.y);
  const right = toks.filter((t) => t.x >= mid).sort((a, b) => a.y - b.y);
  if (left.length < 5 || right.length < 5) return null;
  const adhan: string[] = [];
  const iqamah: Array<string | null> = [];
  for (let i = 0; i < 5; i++) {
    const a = to24(i, right[i].h, right[i].m);
    const q = to24(i, left[i].h, left[i].m);
    if (!a || !q) return null;
    adhan.push(a);
    iqamah.push(q);
  }
  const sunrise = right[5] ? to24(5, right[5].h, right[5].m) : null;
  return { date: findDate(fullText), adhan, iqamah, sunrise };
}

const mins = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));

/** Plausible ranges (24 h, minutes) for each adhan anywhere in India, all year, with margin. */
const RANGES: Array<[number, number]> = [
  [3 * 60 + 30, 6 * 60 + 30], // Fajr
  [11 * 60 + 30, 13 * 60 + 45], // Dhuhr
  [14 * 60 + 30, 17 * 60 + 15], // Asr
  [17 * 60 + 15, 19 * 60 + 45], // Maghrib
  [18 * 60 + 30, 21 * 60 + 15], // Isha
];

/** Why a timetable cannot be right, or null when it looks sane. */
export function checkTimetable(t: Timetable): string | null {
  if (t.adhan.length !== 5 || t.iqamah.length !== 5) return "needs five prayers";
  for (let i = 0; i < 5; i++) {
    const a = mins(t.adhan[i]);
    const [lo, hi] = RANGES[i];
    if (a < lo || a > hi) return `${PRAYERS[i]} adhan ${t.adhan[i]} is not plausible`;
    if (i > 0 && a <= mins(t.adhan[i - 1])) return "adhan times are out of order";
    const q = t.iqamah[i];
    if (q !== null && (mins(q) < a || mins(q) > a + 90)) return `${PRAYERS[i]} iqamah ${q} does not follow its adhan`;
  }
  return null;
}

const same = (a: Timetable, b: Timetable) =>
  a.adhan.join() === b.adhan.join() && a.iqamah.join() === b.iqamah.join();

/**
 * Several OCR passes over differently prepared images: accept a timetable only when at least two
 * passes read exactly the same times and they pass `checkTimetable` (one misread digit, like 03:38
 * read as 03:35, then cannot slip through). Returns null when they do not agree.
 */
export function agreedTimetable(reads: Array<Timetable | null>): Timetable | null {
  const ok = reads.filter((r): r is Timetable => !!r && checkTimetable(r) === null);
  for (let i = 0; i < ok.length; i++) {
    for (let j = i + 1; j < ok.length; j++) {
      if (same(ok[i], ok[j])) return { ...ok[i], date: ok[i].date ?? ok[j].date, sunrise: ok[i].sunrise ?? ok[j].sunrise };
    }
  }
  return null;
}

/**
 * Does the chat around a photo say which masjid it is for?
 *  "this"  - it names ours (e.g. "Noor Masjid", "نور");
 *  "other" - it names a different masjid ("Jumma masjid timings");
 *  "none"  - no masjid is named.
 */
export function masjidMention(text: string, ours = "noor"): "this" | "other" | "none" {
  const t = text.toLowerCase();
  if (t.includes(ours.toLowerCase()) || t.includes("نور")) return "this";
  const generic = new Set(["the", "our", "this", "a", "in", "at", "for", "of", "to", "my", "today's", "todays", "new", "updated"]);
  const re = /([a-zÀ-ɏ']+)\s+(?:masjid|masjeed|masjed|mosque|juma\s+masjid)\b/g;
  for (let m = re.exec(t); m; m = re.exec(t)) {
    if (!generic.has(m[1])) return "other";
  }
  if (/(?:masjid|mosque)[\s-]+(?:e[\s-]+)?([a-z]{3,})/.test(t)) {
    const name = /(?:masjid|mosque)[\s-]+(?:e[\s-]+)?([a-z]{3,})/.exec(t)![1];
    if (!["timings", "timing", "times", "time", "prayer", "salah", "namaz"].includes(name)) return "other";
  }
  return "none";
}
