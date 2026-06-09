import { describe, it, expect } from "vitest";
import { creditEstimate, planLimits, planLimitViolations } from "./credits";

describe("creditEstimate", () => {
  it("multiplies minutes by the coefficient before flooring (per mvsep.com/credits)", () => {
    // 6:20 = 380s. standard ×1 → floor(6.33) = 6; ensemble ×4 → floor(25.33) = 25.
    expect(creditEstimate(380, 1)).toBe(6);
    expect(creditEstimate(380, 4)).toBe(25);
  });

  it("charges at least 1 credit", () => {
    expect(creditEstimate(5, 1)).toBe(1);
    expect(creditEstimate(0, 4)).toBe(1);
  });
});

describe("planLimits", () => {
  it("returns the free vs premium caps", () => {
    expect(planLimits(false)).toEqual({ maxSeconds: 600, maxBytes: 100 * 1024 * 1024 });
    expect(planLimits(true)).toEqual({ maxSeconds: 6000, maxBytes: 1000 * 1024 * 1024 });
  });
});

describe("planLimitViolations", () => {
  it("flags audio over the free length cap and names the limit", () => {
    const v = planLimitViolations({ seconds: 14 * 60, premium: false });
    expect(v).toHaveLength(1);
    expect(v[0]).toMatch(/10 min limit/);
  });

  it("allows the same audio for premium", () => {
    expect(planLimitViolations({ seconds: 14 * 60, premium: true })).toEqual([]);
  });

  it("flags oversize files", () => {
    const v = planLimitViolations({ bytes: 240 * 1024 * 1024, premium: false });
    expect(v).toHaveLength(1);
    expect(v[0]).toMatch(/100 MB limit/);
  });

  it("returns nothing within limits or when the measurement is unknown", () => {
    expect(planLimitViolations({ seconds: 60, bytes: 1024, premium: false })).toEqual([]);
    expect(planLimitViolations({ premium: false })).toEqual([]);
  });
});
