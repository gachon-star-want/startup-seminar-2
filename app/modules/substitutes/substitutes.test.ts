import { describe, expect, it } from "vitest";
import { SubstituteHub } from "./substitutes.server";
import { isEligibleForSubstitute, substitutePhaseOf } from "./types";

describe("substitutePhaseOf", () => {
  const opens = new Date("2026-09-29T09:00:00+09:00");
  const closes = new Date("2026-09-29T23:59:00+09:00");

  it("should classify scheduled / open / closed against now", () => {
    expect(substitutePhaseOf(opens, closes, new Date("2026-09-29T08:59:00+09:00"))).toBe("scheduled");
    expect(substitutePhaseOf(opens, closes, new Date("2026-09-29T12:00:00+09:00"))).toBe("open");
    expect(substitutePhaseOf(opens, closes, new Date("2026-09-30T00:00:00+09:00"))).toBe("closed");
  });
});

describe("isEligibleForSubstitute", () => {
  const closes = new Date("2026-09-22T11:00:00+09:00");
  const after = new Date("2026-09-22T12:00:00+09:00");
  const before = new Date("2026-09-22T10:30:00+09:00");

  it("should accept closed sessions without a record (virtual absent)", () => {
    expect(isEligibleForSubstitute({ closesAt: closes }, null, after)).toBe(true);
    expect(isEligibleForSubstitute({ closesAt: closes }, undefined, after)).toBe(true);
  });

  it("should accept closed sessions explicitly marked absent", () => {
    expect(isEligibleForSubstitute({ closesAt: closes }, "absent", after)).toBe(true);
  });

  it("should reject present / late / substituted records", () => {
    expect(isEligibleForSubstitute({ closesAt: closes }, "present", after)).toBe(false);
    expect(isEligibleForSubstitute({ closesAt: closes }, "late", after)).toBe(false);
    expect(isEligibleForSubstitute({ closesAt: closes }, "substituted", after)).toBe(false);
  });

  it("should reject sessions that are still open or scheduled", () => {
    expect(isEligibleForSubstitute({ closesAt: closes }, "absent", before)).toBe(false);
    expect(isEligibleForSubstitute({ closesAt: closes }, null, before)).toBe(false);
  });
});

describe("SubstituteHub.parseAssignmentInput", () => {
  const valid = {
    title: "중간 결석 대체 보고서",
    description: "수업 내용 요약 보고서를 작성해 주세요",
    opensAtRaw: "2026-09-29T10:00",
    closesAtRaw: "2026-10-10T23:59",
  };

  it("should accept a well-formed assignment input", () => {
    const res = SubstituteHub.parseAssignmentInput(valid);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.values.title).toBe("중간 결석 대체 보고서");
      expect(res.values.opensAt.toISOString()).toBe("2026-09-29T01:00:00.000Z");
      expect(res.values.closesAt.toISOString()).toBe("2026-10-10T14:59:00.000Z");
    }
  });

  it("should trim description to null", () => {
    const res = SubstituteHub.parseAssignmentInput({ ...valid, description: "   " });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.values.description).toBeNull();
  });

  it("should reject blank titles and malformed datetimes", () => {
    expect(SubstituteHub.parseAssignmentInput({ ...valid, title: "   " }).ok).toBe(false);
    expect(SubstituteHub.parseAssignmentInput({ ...valid, opensAtRaw: "2026-09-29 10:00" }).ok).toBe(false);
    expect(SubstituteHub.parseAssignmentInput({ ...valid, closesAtRaw: "bad" }).ok).toBe(false);
  });

  it("should reject a deadline earlier than the opening", () => {
    expect(
      SubstituteHub.parseAssignmentInput({
        ...valid,
        opensAtRaw: "2026-10-10T10:00",
        closesAtRaw: "2026-10-01T10:00",
      }).ok
    ).toBe(false);
  });
});
