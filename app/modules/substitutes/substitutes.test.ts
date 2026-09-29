import { describe, expect, it } from "vitest";
import { isEligibleForSubstitute } from "./types";

describe("isEligibleForSubstitute", () => {
  const closes = new Date("2026-09-22T11:00:00+09:00");
  const after = new Date("2026-09-22T12:00:00+09:00");
  const before = new Date("2026-09-22T10:30:00+09:00");

  it("should accept closed sessions without a record (virtual absent)", () => {
    expect(isEligibleForSubstitute({ closesAt: closes }, null, after)).toBe(true);
    expect(isEligibleForSubstitute({ closesAt: closes }, undefined, after)).toBe(true);
  });

  it("should accept closed sessions marked absent or late", () => {
    expect(isEligibleForSubstitute({ closesAt: closes }, "absent", after)).toBe(true);
    expect(isEligibleForSubstitute({ closesAt: closes }, "late", after)).toBe(true);
  });

  it("should reject present / substituted records", () => {
    expect(isEligibleForSubstitute({ closesAt: closes }, "present", after)).toBe(false);
    expect(isEligibleForSubstitute({ closesAt: closes }, "substituted", after)).toBe(false);
  });

  it("should reject sessions that are still open or scheduled", () => {
    expect(isEligibleForSubstitute({ closesAt: closes }, "absent", before)).toBe(false);
    expect(isEligibleForSubstitute({ closesAt: closes }, "late", before)).toBe(false);
    expect(isEligibleForSubstitute({ closesAt: closes }, null, before)).toBe(false);
  });
});
