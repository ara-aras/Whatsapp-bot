import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  parseTagInput,
  parseFlexibleDate,
  getMissingRequiredFields,
  parseEditEventFlags,
  formatEventReviewCard,
  savePendingEvent,
  getPendingEvent,
  clearPendingEvent,
  getEventQueue,
  setEventQueue,
  getActiveEventId,
  setActiveEventId,
  EVENT_TAG_OPTIONS,
  type PendingEventData,
} from "../../services/DKB/eventIngestionService";

describe("eventIngestionService", () => {
  beforeEach(async () => {
    await setActiveEventId(null);
    await setEventQueue([]);
  });

  describe("parseFlexibleDate", () => {
    it("parses user specified natural date formats", () => {
      // 1. "21st May, 2026, 21:03"
      const d1 = parseFlexibleDate("21st May, 2026, 21:03");
      expect(d1).not.toBeNull();
      const date1 = new Date(d1!);
      expect(date1.getFullYear()).toBe(2026);
      expect(date1.getMonth()).toBe(4); // May = 4
      expect(date1.getDate()).toBe(21);

      // 2. "07/09/2029 08:45 AM" (DD/MM/YYYY)
      const d2 = parseFlexibleDate("07/09/2029 08:45 AM");
      expect(d2).not.toBeNull();
      const date2 = new Date(d2!);
      expect(date2.getFullYear()).toBe(2029);
      expect(date2.getDate()).toBe(7);
      expect(date2.getMonth()).toBe(8); // Sept = 8

      // 3. "April 2nd 26 12:30"
      const d3 = parseFlexibleDate("April 2nd 26 12:30");
      expect(d3).not.toBeNull();
      const date3 = new Date(d3!);
      expect(date3.getFullYear()).toBe(2026);
      expect(date3.getMonth()).toBe(3); // April = 3
      expect(date3.getDate()).toBe(2);

      // 4. "30/9/2026, 9:00"
      const d4 = parseFlexibleDate("30/9/2026, 9:00");
      expect(d4).not.toBeNull();
      const date4 = new Date(d4!);
      expect(date4.getFullYear()).toBe(2026);
      expect(date4.getMonth()).toBe(8); // Sept = 8
      expect(date4.getDate()).toBe(30);
    });

    it("returns null for empty or completely invalid strings", () => {
      expect(parseFlexibleDate("")).toBeNull();
      expect(parseFlexibleDate("   ")).toBeNull();
      expect(parseFlexibleDate("not a real date at all")).toBeNull();
    });
  });

  describe("parseTagInput", () => {
    it("parses single and multiple numeric tags (1-based)", () => {
      // 4 = Hackathon, 9 = Competition
      expect(parseTagInput("4")).toEqual(["Hackathon"]);
      expect(parseTagInput("4, 9")).toEqual(["Hackathon", "Competition"]);
      expect(parseTagInput("1,2,3")).toEqual(["Conference", "Workshop", "Meetup"]);
    });

    it("parses case-insensitive tag names", () => {
      expect(parseTagInput("hackathon, workshop")).toEqual(["Hackathon", "Workshop"]);
      expect(parseTagInput("TECH TALK, meetup")).toEqual(["Tech Talk", "Meetup"]);
    });

    it("deduplicates tags and ignores invalid numbers or names", () => {
      expect(parseTagInput("4, 4, 99, unknownTag, 4")).toEqual(["Hackathon"]);
    });
  });

  describe("parseEditEventFlags", () => {
    it("parses all event edit flags and aliases properly", () => {
      const args = [
        "-en", "Hack Mangalore 2026",
        "-on", "PA College",
        "-sdt", "21st May, 2026, 21:03",
        "-edt", "22nd May, 2026, 18:00",
        "-loc", "Mangaluru Campus",
        "-web", "https://hackmangalore.org",
        "-reglink", "https://unstop.com/hack-mangalore",
        "-poster", "https://i.imgur.com/sample.png",
        "-tags", "4,9",
        "-description", "A 24-hour state level hackathon for students across Karnataka to innovate.",
        "-submitter", "Rafan Ahamad",
        "-email", "rafan@dk24.org",
      ];

      const flags = parseEditEventFlags(args);

      expect(flags["-en"]).toBe("Hack Mangalore 2026");
      expect(flags["-on"]).toBe("PA College");
      expect(flags["-sdt"]).toBe("21st May, 2026, 21:03");
      expect(flags["-edt"]).toBe("22nd May, 2026, 18:00");
      expect(flags["-eloc"]).toBe("Mangaluru Campus");
      expect(flags["-loc"]).toBe("Mangaluru Campus");
      expect(flags["-eweb"]).toBe("https://hackmangalore.org");
      expect(flags["-web"]).toBe("https://hackmangalore.org");
      expect(flags["-reglink"]).toBe("https://unstop.com/hack-mangalore");
      expect(flags["-rlink"]).toBe("https://unstop.com/hack-mangalore");
      expect(flags["-epos"]).toBe("https://i.imgur.com/sample.png");
      expect(flags["-poster"]).toBe("https://i.imgur.com/sample.png");
      expect(flags["-etag"]).toBe("4,9");
      expect(flags["-tags"]).toBe("4,9");
      expect(flags["-desc"]).toBe("A 24-hour state level hackathon for students across Karnataka to innovate.");
      expect(flags["-name"]).toBe("Rafan Ahamad");
      expect(flags["-submitter"]).toBe("Rafan Ahamad");
      expect(flags["-email"]).toBe("rafan@dk24.org");
    });
  });

  describe("getMissingRequiredFields", () => {
    it("flags all missing required fields for an empty event", () => {
      const emptyEvt: Partial<PendingEventData> = {};
      const missing = getMissingRequiredFields(emptyEvt);

      expect(missing).toContain("Event Name (-en)");
      expect(missing).toContain("Organization Name (-on)");
      expect(missing).toContain("Start Date & Time (-sdt)");
      expect(missing).toContain("End Date & Time (-edt)");
      expect(missing).toContain("Event Location (-eloc)");
      expect(missing).toContain("Event Description (min 50 chars) (-desc)");
      expect(missing).toContain("Event Tags (-etag)");
      expect(missing).toContain("Your Name (-name)");
      expect(missing).toContain("Your Email (-email)");
    });

    it("returns empty array when all required fields are valid", () => {
      const completeEvt: Partial<PendingEventData> = {
        eventName: "DK24 Summit",
        organizationName: "DK24 Consortium",
        startDateTime: "2026-11-08 10:00",
        endDateTime: "2026-11-08 18:00",
        eventLocation: "TMA Pai International Convention Centre",
        eventDescription: "A full day gathering of Mangalore college developer clubs to learn and build in public.",
        eventTags: ["Conference"],
        submittedBy: "Rafan Ahamad",
        submittedEmail: "rafan@dk24.org",
      };

      const missing = getMissingRequiredFields(completeEvt);
      expect(missing).toEqual([]);
    });

    it("rejects invalid email addresses", () => {
      const evt: Partial<PendingEventData> = {
        eventName: "DK24 Summit",
        organizationName: "DK24 Consortium",
        startDateTime: "2026-11-08 10:00",
        endDateTime: "2026-11-08 18:00",
        eventLocation: "TMA Pai International Convention Centre",
        eventDescription: "A full day gathering of Mangalore college developer clubs to learn and build in public.",
        eventTags: ["Conference"],
        submittedBy: "Rafan Ahamad",
        submittedEmail: "not-an-email",
      };

      const missing = getMissingRequiredFields(evt);
      expect(missing).toContain("Your Email (-email)");
    });
  });

  describe("formatEventReviewCard", () => {
    it("is completely free of emojis", () => {
      const incomplete: PendingEventData = {
        id: "1",
        sourceGroupJid: "123@g.us",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        status: "pending_review",
        eventName: "Hands-on Journey into Smart Technology",
        organizationName: "Embed Club",
        startDateTime: "2026-09-30T09:00",
        endDateTime: "",
        eventLocation: "Unix Lab",
        eventWebsite: "",
        registrationLink: "",
        eventDescription: "A hands-on workshop covering Raspberry Pi fundamentals and home automation.",
        eventPosterUrl: "",
        eventTags: ["Workshop"],
        submittedBy: "",
        submittedEmail: "",
      };

      const card = formatEventReviewCard(incomplete);

      // Verify no emojis are present
      const emojiRegex = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
      expect(emojiRegex.test(card)).toBe(false);

      expect(card).toContain("*DK24 Event Review*");
      expect(card).not.toContain("ID: #");
      expect(card).toContain("Missing Required Fields:");
      expect(card).toContain("-reglink <link>");
      expect(card).toContain("> Reply !cancel to discard this event.");

      // When queue exists, it is displayed at the last as a quote
      const cardWithQueue = formatEventReviewCard(incomplete, 2);
      expect(cardWithQueue).toContain("> Queue: 2 other events waiting (reply !queue to switch).");
    });

    it("shows submit instruction when all fields are complete", () => {
      const complete: PendingEventData = {
        id: "2",
        sourceGroupJid: "123@g.us",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        status: "pending_review",
        eventName: "AI Summit 2026",
        organizationName: "Tech Club",
        startDateTime: "2026-11-08 10:00",
        endDateTime: "2026-11-08 18:00",
        eventLocation: "Mangalore Tech Hall",
        eventWebsite: "",
        registrationLink: "",
        eventDescription: "A comprehensive event covering cutting-edge artificial intelligence and agentic workflows.",
        eventPosterUrl: "",
        eventTags: ["Conference", "Workshop"],
        submittedBy: "Organizer",
        submittedEmail: "organizer@example.com",
      };

      const card = formatEventReviewCard(complete);
      expect(card).toContain("All required fields are present.");
      expect(card).toContain("> Reply !submit or !CONFIRM");
      expect(card).toContain("> Reply !cancel to discard.");
    });

    it("shows CONFIRM instruction when awaiting confirmation", () => {
      const awaiting: PendingEventData = {
        id: "3",
        sourceGroupJid: "123@g.us",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        status: "awaiting_confirmation",
        eventName: "AI Summit 2026",
        organizationName: "Tech Club",
        startDateTime: "2026-11-08 10:00",
        endDateTime: "2026-11-08 18:00",
        eventLocation: "Mangalore Tech Hall",
        eventWebsite: "",
        registrationLink: "",
        eventDescription: "A comprehensive event covering cutting-edge artificial intelligence and agentic workflows.",
        eventPosterUrl: "",
        eventTags: ["Conference", "Workshop"],
        submittedBy: "Organizer",
        submittedEmail: "organizer@example.com",
      };

      const card = formatEventReviewCard(awaiting);
      expect(card).toContain("Ready for Submission");
      expect(card).toContain("> Reply !CONFIRM to certify");
      expect(card).toContain("> Reply !cancel to discard.");
    });
  });

  describe("save, get, and clear pending event", () => {
    it("persists and retrieves an event by id and as active event", async () => {
      const evt: PendingEventData = {
        id: "test-99",
        sourceGroupJid: "123@g.us",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        status: "pending_review",
        eventName: "Test Hackathon",
        organizationName: "Test Org",
        startDateTime: "2026-12-01 10:00",
        endDateTime: "2026-12-01 18:00",
        eventLocation: "Test Venue",
        eventWebsite: "",
        registrationLink: "",
        eventDescription: "A test description of sufficient length to validate storage and retrieval in test suite.",
        eventPosterUrl: "",
        eventTags: ["Hackathon"],
        submittedBy: "Tester",
        submittedEmail: "tester@example.com",
      };

      await savePendingEvent(evt);
      const retrieved = await getPendingEvent("test-99");
      expect(retrieved?.eventName).toBe("Test Hackathon");

      // Active event lookup without parameter
      const active = await getPendingEvent();
      expect(active?.id).toBe("test-99");

      await clearPendingEvent("test-99");
      const cleared = await getPendingEvent("test-99");
      expect(cleared).toBeNull();
    });
  });

  describe("event queue management", () => {
    it("manages active event and FIFO queue order", async () => {
      await setActiveEventId("evt-1");
      await setEventQueue(["evt-2", "evt-3"]);

      expect(await getActiveEventId()).toBe("evt-1");
      expect(await getEventQueue()).toEqual(["evt-2", "evt-3"]);

      // simulate cycling queue
      const q = await getEventQueue();
      const next = q.shift();
      q.push("evt-1");
      await setActiveEventId(next!);
      await setEventQueue(q);

      expect(await getActiveEventId()).toBe("evt-2");
      expect(await getEventQueue()).toEqual(["evt-3", "evt-1"]);
    });
  });

  describe("destination review group resolution", () => {
    it("returns configured ask group or defaults to core group jid", async () => {
      const { getDestinationReviewGroupJid } = await import(
        "../../services/DKB/eventIngestionService"
      );
      const jid = getDestinationReviewGroupJid();
      expect(jid).toBeDefined();
      expect(typeof jid).toBe("string");
      expect(jid).toContain("@g.us");
    });
  });
});
