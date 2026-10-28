import { spawn } from "child_process";
import { promises as fs } from "fs";
import os from "os";
import path from "path";

/**
 * Captures the phone's screen by running SCREENSHOT_CMD, which must write a PNG
 * to stdout. Default works from Termux/proot over wireless debugging:
 *   adb exec-out screencap -p
 * Root: `su -c "screencap -p"`. Shizuku: `rish -c "screencap -p"`.
 * The command comes from the owner's .env, never from chat input.
 *
 * Stdout is redirected to a temp file by the shell rather than read through a
 * Node pipe: Shizuku's rish corrupts binary output written into a pipe (the
 * PNG header arrives mangled), while a plain file comes through intact.
 */
const DEFAULT_CMD = "adb exec-out screencap -p";
const TIMEOUT_MS = 15_000;
const MAX_BYTES = 20 * 1024 * 1024;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export class ScreenshotError extends Error {}

export function isScreenshotEnabled(): boolean {
  return (process.env.SCREENSHOT_ENABLED ?? "true").toLowerCase() !== "false";
}

/** Signature, IHDR as the first chunk, and IEND as the last: a whole PNG. */
export function isCompletePng(buf: Buffer): boolean {
  return (
    buf.length >= 33 &&
    buf.subarray(0, 8).equals(PNG_MAGIC) &&
    buf.toString("latin1", 12, 16) === "IHDR" &&
    buf.toString("latin1", buf.length - 8, buf.length - 4) === "IEND"
  );
}

export async function captureScreenshot(): Promise<Buffer> {
  const cmd = process.env.SCREENSHOT_CMD?.trim() || DEFAULT_CMD;
  const out = path.join(os.tmpdir(), `screenshot-${process.pid}-${Date.now()}.png`);
  try {
    await runToFile(cmd, out);
    const { size } = await fs.stat(out);
    if (size > MAX_BYTES) throw new ScreenshotError("capture output too large");
    const buf = await fs.readFile(out);
    if (buf.length < PNG_MAGIC.length || !buf.subarray(0, 8).equals(PNG_MAGIC)) {
      throw new ScreenshotError("capture command did not return a PNG");
    }
    if (!isCompletePng(buf)) {
      throw new ScreenshotError("capture came back corrupt or incomplete");
    }
    return buf;
  } finally {
    await fs.unlink(out).catch(() => {});
  }
}

function runToFile(cmd: string, out: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("sh", ["-c", `{ ${cmd}\n} > "$SCREENSHOT_OUT"`], {
      env: { ...process.env, SCREENSHOT_OUT: out },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(() => reject(new ScreenshotError("capture command timed out")));
    }, TIMEOUT_MS);

    child.stderr.on("data", (d: Buffer) => {
      if (stderr.length < 500) stderr += d.toString();
    });
    child.on("error", (err) => finish(() => reject(new ScreenshotError(err.message))));
    child.on("close", (code) =>
      finish(() =>
        code === 0
          ? resolve()
          : reject(new ScreenshotError(`exit ${code}: ${stderr.trim() || "no output"}`)),
      ),
    );
  });
}

const lastUse = new Map<string, number>();

/** Seconds the user must still wait, or 0 if they may capture now. */
export function cooldownRemaining(userId: string, now = Date.now()): number {
  const secs = Number(process.env.SCREENSHOT_COOLDOWN_SEC ?? 30);
  const last = lastUse.get(userId);
  if (!last || !(secs > 0)) return 0;
  return Math.max(0, Math.ceil((last + secs * 1000 - now) / 1000));
}

export function markUsed(userId: string, now = Date.now()): void {
  lastUse.set(userId, now);
}

export function resetCooldowns(): void {
  lastUse.clear();
}

export type ScreenshotPayload =
  | { kind: "image"; data: Buffer }
  | { kind: "document"; data: Buffer };

/**
 * Baileys labels every `image:` buffer as image/jpeg, so a raw PNG arrives
 * as an undisplayable "JPEG". Convert to a real JPEG; if sharp can't load
 * (it is a native module), fall back to sending the PNG as a document.
 */
export async function toWhatsAppPayload(png: Buffer): Promise<ScreenshotPayload> {
  try {
    const sharp = (await import("sharp")).default;
    const jpeg = await sharp(png).jpeg({ quality: 85 }).toBuffer();
    return { kind: "image", data: jpeg };
  } catch (err) {
    console.warn("[screenshot] JPEG conversion failed, sending as document:", err);
    return { kind: "document", data: png };
  }
}
