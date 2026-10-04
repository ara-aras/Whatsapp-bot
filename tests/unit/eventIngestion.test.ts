import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  parseTagInput,
  getMissingRequiredFields,
  parseEditEventFlags,
  formatEventReviewCard,
  savePendingEvent,
  getPendingEvent,
  clearPendingEvent,
  EVENT_TAG_OPTIONS,
  type PendingEventData,
} from "../../services/DKB/eventIngestionService";

describe("eventIngestionService", () => {
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
    it("parses all event edit flags properly", () => {
      const args = [
        "-en", "Hack Mangalore 2026",
        "-on", "PA College",
        "-sdt", "2026-11-10 10:00",
        "-edt", "2026-11-11 18:00",
        "-eloc", "Mangaluru Campus",
        "-eweb", "https://hackmangalore.org",
        "-rlink", "https://unstop.com/hack-mangalore",
        "-epos", "https://i.imgur.com/sample.png",
        "-etag", "4,9",
        "-desc", "A 24-hour state level hackathon for students across Karnataka to innovate.",
        "-name", "Rafan Ahamad",
        "-email", "rafan@dk24.org",
      ];

      const flags = parseEditEventFlags(args);

      expect(flags["-en"]).toBe("Hack Mangalore 2026");
      expect(flags["-on"]).toBe("PA College");
      expect(flags["-sdt"]).toBe("2026-11-10 10:00");
      expect(flags["-edt"]).toBe("2026-11-11 18:00");
      expect(flags["-eloc"]).toBe("Mangaluru Campus");
      expect(flags["-eweb"]).toBe("https://hackmangalore.org");
      expect(flags["-rlink"]).toBe("https://unstop.com/hack-mangalore");
      expect(flags["-epos"]).toBe("https://i.imgur.com/sample.png");
      expect(flags["-etag"]).toBe("4,9");
      expect(flags["-desc"]).toBe("A 24-hour state level hackathon for students across Karnataka to innovate.");
      expect(flags["-name"]).toBe("Rafan Ahamad");
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
    it("includes edit instructions when missing fields exist", () => {
      const incomplete: PendingEventData = {
        id: "1",
        sourceGroupJid: "123@g.us",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        status: "pending_review",
        eventName: "AI Summit",
        organizationName: "Tech Club",
        startDateTime: "",
        endDateTime: "",
        eventLocation: "",
        eventWebsite: "",
        registrationLink: "",
        eventDescription: "",
        eventPosterUrl: "",
        eventTags: [],
        submittedBy: "",
        submittedEmail: "",
      };

      const card = formatEventReviewCard(incomplete);
      expect(card).toContain("Missing Required Fields:");
      expect(card).toContain("!edit -en <name>");
      expect(card).toContain("Available Tags");
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
      expect(card).toContain("All required fields are present!");
      expect(card).toContain("!submit");
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
      expect(card).toContain("!CONFIRM");
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

  describe("destination review group resolution", () => {
    it("returns configured ask group or defaults to core group jid", async () => {
      const { getDestinationReviewGroupJid, DK24_CORE_GROUP_JID } = await import(
        "../../services/DKB/eventIngestionService"
      );
      const jid = getDestinationReviewGroupJid();
      expect(jid).toBeDefined();
      expect(typeof jid).toBe("string");
      expect(jid).toContain("@g.us");
    });
  });
});
