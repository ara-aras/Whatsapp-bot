import { describe, it, expect } from "vitest";
import {
  RingingCalls,
  numberFromJid,
  parseCommand,
  pickName,
  toCallEvent,
  type RawCall,
} from "../../services/calls/callBridge";

const offer: RawCall = {
  id: "ABC123",
  from: "919876543210@s.whatsapp.net",
  status: "offer",
  isVideo: false,
  isGroup: false,
};

describe("numberFromJid", () => {
  it("formats a phone JID as +digits", () => {
    expect(numberFromJid("919876543210@s.whatsapp.net")).toBe("+919876543210");
    expect(numberFromJid("919876543210:12@s.whatsapp.net")).toBe("+919876543210");
  });
  it("returns empty for LIDs, groups and junk", () => {
    expect(numberFromJid("123456789012345@lid")).toBe("");
    expect(numberFromJid("120363@g.us")).toBe("");
    expect(numberFromJid(undefined)).toBe("");
    expect(numberFromJid("12@s.whatsapp.net")).toBe("");
  });
});

describe("pickName", () => {
  it("returns the first non-empty known name in candidate order", () => {
    const names = { a: "", b: "  Mom ", c: "Dad" };
    expect(pickName(["x", "a", "b", "c"], names)).toBe("Mom");
  });
  it("returns empty when nothing is known", () => {
    expect(pickName([null, undefined, "z"], {})).toBe("");
  });
});

describe("toCallEvent", () => {
  it("builds an offer with the saved name and number", () => {
    const e = toCallEvent(offer, "Dad", 1000);
    expect(e).toEqual({
      type: "offer",
      id: "ABC123",
      name: "Dad",
      number: "+919876543210",
      isVideo: false,
      isGroup: false,
      timestamp: 1000,
    });
  });
  it("falls back to the number, then to a placeholder, when the name is unknown", () => {
    expect(toCallEvent(offer, "", 1)).toMatchObject({ name: "+919876543210" });
    expect(toCallEvent({ ...offer, from: "123456789012345@lid" }, "", 1)).toMatchObject({
      name: "Unknown caller",
      number: "",
    });
  });
  it("prefers callerPn over a LID sender for the number", () => {
    const e = toCallEvent({ ...offer, from: "123456789012345@lid", callerPn: "911111111111@s.whatsapp.net" }, "", 1);
    expect(e).toMatchObject({ number: "+911111111111" });
  });
  it("maps every end status and ignores the rest", () => {
    for (const s of ["reject", "accept", "timeout", "terminate"]) {
      expect(toCallEvent({ ...offer, status: s }, "", 5)).toEqual({ type: "end", id: "ABC123", reason: s, timestamp: 5 });
    }
    expect(toCallEvent({ ...offer, status: "ringing" }, "", 5)).toBeNull();
    expect(toCallEvent({ ...offer, status: "relaylatency" }, "", 5)).toBeNull();
  });
});

describe("parseCommand", () => {
  it("accepts only a well-formed reject", () => {
    expect(parseCommand('{"type":"reject","id":"ABC123"}')).toEqual({ type: "reject", id: "ABC123" });
  });
  it("drops everything else", () => {
    expect(parseCommand("not json")).toBeNull();
    expect(parseCommand('{"type":"accept","id":"ABC123"}')).toBeNull();
    expect(parseCommand('{"type":"reject"}')).toBeNull();
    expect(parseCommand('{"type":"reject","id":123}')).toBeNull();
    expect(parseCommand('{"type":"reject","id":""}')).toBeNull();
    expect(parseCommand(`{"type":"reject","id":"${"x".repeat(300)}"}`)).toBeNull();
  });
});

describe("RingingCalls", () => {
  it("returns the caller for a call that is ringing", () => {
    const r = new RingingCalls(1000);
    r.add("a", "caller@s.whatsapp.net", 0);
    expect(r.from("a", 500)).toBe("caller@s.whatsapp.net");
  });
  it("forgets a call after the ttl, and after it ends", () => {
    const r = new RingingCalls(1000);
    r.add("a", "x", 0);
    expect(r.from("a", 1001)).toBeNull();
    r.add("b", "y", 0);
    r.remove("b");
    expect(r.from("b", 1)).toBeNull();
  });
  it("never invents a caller for an unknown id", () => {
    expect(new RingingCalls().from("nope")).toBeNull();
  });
});
