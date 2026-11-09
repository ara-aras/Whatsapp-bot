import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { agreedTimetable, checkTimetable, findDate, masjidMention, parseBoard, to24, type Timetable } from "../../services/salah/timetable";
import { RecentTexts, boardMessage, decide } from "../../services/salah/salahWatcher";

// OCR words (text + position) from a real photo of the Noor Masjid board, 2026-11-04.
const fixture = JSON.parse(readFileSync(join(__dirname, "../fixtures/noor-board-words.json"), "utf8"));

const NOOR: Timetable = {
  date: "2026-11-04",
  adhan: ["05:08", "12:18", "15:38", "18:07", "19:20"],
  iqamah: ["05:28", "13:00", "16:00", "18:12", "19:30"],
  sunrise: "06:25",
};

describe("to24", () => {
  it("reads the board's 12-hour clock by prayer", () => {
    expect(to24(0, 5, 8)).toBe("05:08");
    expect(to24(1, 12, 18)).toBe("12:18");
    expect(to24(1, 1, 0)).toBe("13:00"); // Dhuhr iqamah 01:00
    expect(to24(2, 3, 38)).toBe("15:38");
    expect(to24(4, 7, 30)).toBe("19:30");
    expect(to24(5, 6, 25)).toBe("06:25");
    expect(to24(0, 25, 0)).toBeNull();
  });
});

describe("parseBoard", () => {
  it("reads the real Noor Masjid board", () => {
    expect(parseBoard(fixture.words, fixture.text)).toEqual(NOOR);
  });

  it("ignores the live HH:MM:SS clock and needs at least ten times", () => {
    expect(parseBoard([{ text: "04:11:03", x: 0, y: 0 }])).toBeNull();
    const few = fixture.words.slice(0, 6);
    expect(parseBoard(few)).toBeNull();
  });

  it("finds the printed date", () => {
    expect(findDate("2026-11-04")).toBe("2026-11-04");
    expect(findDate("2026/1/4")).toBe("2026-01-04");
    expect(findDate("no date")).toBeNull();
  });
});

describe("checkTimetable", () => {
  it("accepts the real board", () => {
    expect(checkTimetable(NOOR)).toBeNull();
  });
  it("rejects misreads", () => {
    expect(checkTimetable({ ...NOOR, adhan: ["05:08", "12:18", "03:38", "18:07", "19:20"] })).toMatch(/Asr/);
    expect(checkTimetable({ ...NOOR, iqamah: ["04:28", "13:00", "16:00", "18:12", "19:30"] })).toMatch(/Fajr iqamah/);
    expect(checkTimetable({ ...NOOR, adhan: ["05:08", "12:18", "15:38", "19:21", "19:20"], iqamah: [null, null, null, null, null] })).toMatch(/order/);
  });
});

describe("agreedTimetable", () => {
  it("needs two passes to agree exactly", () => {
    const misread = { ...NOOR, adhan: ["05:08", "12:18", "15:35", "18:07", "19:20"] };
    expect(agreedTimetable([misread, NOOR])).toBeNull();
    expect(agreedTimetable([misread, NOOR, NOOR])).toEqual(NOOR);
    expect(agreedTimetable([null, NOOR, { ...NOOR, date: null }])).toEqual(NOOR);
  });
});

describe("masjid name near the photo", () => {
  it("knows Noor Masjid, another masjid, and no name", () => {
    expect(masjidMention("Noor masjid timings for this week")).toBe("this");
    expect(masjidMention("مسجد نور")).toBe("this");
    expect(masjidMention("Jumma masjid timings")).toBe("other");
    expect(masjidMention("Masjid-e-Bilal timings")).toBe("other");
    expect(masjidMention("today's masjid timings")).toBe("none");
    expect(masjidMention("timings updated")).toBe("none");
  });

  it("decides from the caption first, then the chat", () => {
    expect(decide("Noor masjid", "jumma masjid")).toEqual({ use: true, named: true });
    expect(decide("", "Bilal masjid timings")).toEqual({ use: false, named: false });
    expect(decide("", "updated timings")).toEqual({ use: true, named: false });
  });

  it("only looks at the chat around the photo", () => {
    const r = new RecentTexts();
    r.add(1_000_000, "Bilal masjid timings");
    r.add(1_000_000 + 20 * 60_000, "anything");
    expect(r.around(1_000_000 + 20 * 60_000)).toBe("anything");
    expect(r.around(1_000_000 + 60_000)).toContain("Bilal");
  });
});

describe("message to the laptop", () => {
  it("has the fields Aerie reads", () => {
    const m = boardMessage(NOOR, "ocr", true, 123, "Noor Masjid");
    expect(m).toEqual({ masjid: "Noor Masjid", named: true, date: "2026-11-04", adhan: NOOR.adhan, iqamah: NOOR.iqamah, sunrise: "06:25", source: "ocr", sent_at: 123 });
  });
});
