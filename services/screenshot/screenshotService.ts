import { spawn } from "child_process";

/**
 * Captures the phone's screen by running SCREENSHOT_CMD, which must write a PNG
 * to stdout. Default works from Termux/proot over wireless debugging:
 *   adb exec-out screencap -p
 * Root: `su -c "screencap -p"`. Shizuku: `rish -c "screencap -p"`.
 * The command comes from the owner's .env, never from chat input.
 */
const DEFAULT_CMD = "adb exec-out screencap -p";
const TIMEOUT_MS = 15_000;
const MAX_BYTES = 20 * 1024 * 1024;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export class ScreenshotError extends Error {}

export function isScreenshotEnabled(): boolean {
  return (process.env.SCREENSHOT_ENABLED ?? "true").toLowerCase() !== "false";
}

export function captureScreenshot(): Promise<Buffer> {
  const cmd = process.env.SCREENSHOT_CMD?.trim() || DEFAULT_CMD;
  return new Promise((resolve, reject) => {
    const child = spawn("sh", ["-c", cmd], { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let size = 0;
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

    child.stdout.on("data", (d: Buffer) => {
      size += d.length;
      if (size > MAX_BYTES) {
        child.kill("SIGKILL");
        finish(() => reject(new ScreenshotError("capture output too large")));
        return;
      }
      chunks.push(d);
    });
    child.stderr.on("data", (d: Buffer) => {
      if (stderr.length < 500) stderr += d.toString();
    });
    child.on("error", (err) => finish(() => reject(new ScreenshotError(err.message))));
    child.on("close", (code) =>
      finish(() => {
        const buf = Buffer.concat(chunks);
        if (code !== 0) {
          return reject(new ScreenshotError(`exit ${code}: ${stderr.trim() || "no output"}`));
        }
        if (buf.length < PNG_MAGIC.length || !buf.subarray(0, 8).equals(PNG_MAGIC)) {
          return reject(new ScreenshotError("capture command did not return a PNG"));
        }
        resolve(buf);
      }),
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
