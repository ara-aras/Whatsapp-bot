import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  captureScreenshot,
  cooldownRemaining,
  markUsed,
  resetCooldowns,
} from "../../services/screenshot/screenshotService";

const origEnv = { ...process.env };
afterEach(() => {
  process.env = { ...origEnv };
});

describe("captureScreenshot", () => {
  it("returns stdout when it is a PNG", async () => {
    process.env.SCREENSHOT_CMD = `printf '\\211PNG\\r\\n\\032\\nDATA'`;
    const buf = await captureScreenshot();
    expect(buf.subarray(1, 4).toString()).toBe("PNG");
  });

  it("rejects non-PNG output", async () => {
    process.env.SCREENSHOT_CMD = "echo hello";
    await expect(captureScreenshot()).rejects.toThrow(/PNG/);
  });

  it("rejects non-zero exit with stderr", async () => {
    process.env.SCREENSHOT_CMD = "echo no device >&2; exit 1";
    await expect(captureScreenshot()).rejects.toThrow(/no device/);
  });
});

describe("cooldown", () => {
  beforeEach(() => resetCooldowns());

  it("blocks repeat use until the window passes", () => {
    process.env.SCREENSHOT_COOLDOWN_SEC = "30";
    expect(cooldownRemaining("a", 1000)).toBe(0);
    markUsed("a", 1000);
    expect(cooldownRemaining("a", 11000)).toBe(20);
    expect(cooldownRemaining("a", 31000)).toBe(0);
    expect(cooldownRemaining("b", 11000)).toBe(0);
  });
});

describe("toWhatsAppPayload", () => {
  it("converts a PNG into a real JPEG", async () => {
    const sharp = (await import("sharp")).default;
    const png = await sharp({
      create: { width: 4, height: 4, channels: 3, background: { r: 255, g: 0, b: 0 } },
    }).png().toBuffer();
    const { toWhatsAppPayload } = await import("../../services/screenshot/screenshotService");
    const out = await toWhatsAppPayload(png);
    expect(out.kind).toBe("image");
    expect([...out.data.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
  });

  it("falls back to the PNG as a document when conversion fails", async () => {
    const { toWhatsAppPayload } = await import("../../services/screenshot/screenshotService");
    const junk = Buffer.from("not an image");
    const out = await toWhatsAppPayload(junk);
    expect(out).toEqual({ kind: "document", data: junk });
  });
});
