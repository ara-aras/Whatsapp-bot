import { describe, it, expect, beforeEach } from "vitest";
import { rememberSentId, wasSentByThisProcess, resetSentIds } from "../../core/sentMessages";

describe("sentMessages", () => {
  beforeEach(() => resetSentIds());

  it("recognises an id as soon as it is remembered", () => {
    expect(wasSentByThisProcess("ABC")).toBe(false);
    rememberSentId("ABC");
    expect(wasSentByThisProcess("ABC")).toBe(true);
    expect(wasSentByThisProcess("OTHER")).toBe(false);
  });

  it("ignores empty ids", () => {
    rememberSentId("");
    rememberSentId(null);
    expect(wasSentByThisProcess("")).toBe(false);
    expect(wasSentByThisProcess(undefined)).toBe(false);
  });

  it("expires ids after ten minutes", () => {
    rememberSentId("ABC", 1000);
    expect(wasSentByThisProcess("ABC", 1000 + 9 * 60 * 1000)).toBe(true);
    expect(wasSentByThisProcess("ABC", 1000 + 11 * 60 * 1000)).toBe(false);
  });

  it("stays bounded and keeps the newest ids", () => {
    for (let i = 0; i < 6000; i++) rememberSentId(`id-${i}`, 1000);
    expect(wasSentByThisProcess("id-5999", 1000)).toBe(true);
    expect(wasSentByThisProcess("id-0", 1000)).toBe(false);
  });
});
