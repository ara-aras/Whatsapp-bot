import { describe, it, expect, vi } from "vitest";
import { withRetry } from "../../storage/neonAuthStateStore";

describe("auth state withRetry", () => {
  it("returns the first successful result", async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error("blip")).mockResolvedValue("ok");
    await expect(withRetry("op", fn, 3, 1)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("throws the last error instead of swallowing it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fn = vi.fn().mockRejectedValue(new Error("db down"));
    await expect(withRetry("op", fn, 3, 1)).rejects.toThrow("db down");
    expect(fn).toHaveBeenCalledTimes(3);
    warn.mockRestore();
  });
});
