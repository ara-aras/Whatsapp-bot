import { describe, it, expect } from "vitest";
import net from "net";
import { describeError } from "../../utils/describeError";
import { installPlatformShims } from "../../utils/platformShims";

describe("describeError", () => {
  it("never returns an empty description for an AggregateError", () => {
    const inner = Object.assign(new Error("connect ETIMEDOUT 52.1.58.3:5432"), {
      code: "ETIMEDOUT",
      address: "52.1.58.3",
      port: 5432,
    });
    const agg = Object.assign(new AggregateError([inner], ""), { code: "ETIMEDOUT" });
    expect(describeError(agg)).toBe("AggregateError: ETIMEDOUT [ETIMEDOUT 52.1.58.3:5432]");
  });

  it("keeps plain errors readable", () => {
    expect(describeError(new Error("boom"))).toBe("Error: boom");
    expect(describeError("text")).toBe("text");
  });
});

describe("installPlatformShims", () => {
  it("raises the per-address connect timeout to at least 2s", () => {
    net.setDefaultAutoSelectFamilyAttemptTimeout(250);
    installPlatformShims();
    expect(net.getDefaultAutoSelectFamilyAttemptTimeout()).toBeGreaterThanOrEqual(2000);
  });
});
