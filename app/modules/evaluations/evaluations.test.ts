import { describe, expect, it } from "vitest";
import { EvaluationHub } from "./evaluations.server";
import { phaseOf } from "./types";
import { MAX_EVAL_COMMENT_BYTES } from "~/lib/constants";

describe("phaseOf", () => {
  const opens = new Date("2026-09-22T09:00:00+09:00");
  const closes = new Date("2026-09-22T23:59:00+09:00");

  it("should classify scheduled / open / closed against now", () => {
    expect(phaseOf(opens, closes, new Date("2026-09-22T08:59:00+09:00"))).toBe("scheduled");
    expect(phaseOf(opens, closes, new Date("2026-09-22T12:00:00+09:00"))).toBe("open");
    expect(phaseOf(opens, closes, new Date("2026-09-23T00:00:00+09:00"))).toBe("closed");
  });
});

describe("EvaluationHub.parseStar", () => {
  it("should accept 0.5-step scores from 0.5 to 5", () => {
    for (const v of [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5]) {
      const form = new FormData();
      form.set("teamScore", String(v));
      const res = EvaluationHub.parseStar(form, "teamScore");
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.star).toBe(v);
    }
  });

  it("should reject out-of-range, non-half-step and missing scores", () => {
    const make = (v: string | null) => {
      const form = new FormData();
      if (v !== null) form.set("teamScore", v);
      return form;
    };
    expect(EvaluationHub.parseStar(make("0"), "teamScore").ok).toBe(false);
    expect(EvaluationHub.parseStar(make("5.5"), "teamScore").ok).toBe(false);
    expect(EvaluationHub.parseStar(make("2.3"), "teamScore").ok).toBe(false);
    expect(EvaluationHub.parseStar(make("abc"), "teamScore").ok).toBe(false);
    expect(EvaluationHub.parseStar(make(null), "teamScore").ok).toBe(false);
  });
});

describe("코멘트 300바이트 제한", () => {
  it("should accept comments at or under the byte budget", () => {
    // 한글 1글자 = 3바이트 → 100글자가 한계
    const korean100 = "가".repeat(100);
    expect(new TextEncoder().encode(korean100).length).toBe(MAX_EVAL_COMMENT_BYTES);

    const ascii300 = "a".repeat(300);
    expect(new TextEncoder().encode(ascii300).length).toBe(MAX_EVAL_COMMENT_BYTES);
  });

  it("should reject comments over the byte budget", () => {
    const korean101 = "가".repeat(101);
    expect(new TextEncoder().encode(korean101).length).toBe(MAX_EVAL_COMMENT_BYTES + 3);
    expect(new TextEncoder().encode("a".repeat(301)).length).toBe(MAX_EVAL_COMMENT_BYTES + 1);
  });
});

describe("EvaluationHub.parseSessionInput", () => {
  const valid = {
    sessionDate: "2026-09-29",
    title: "3주차 팀별 발표",
    description: "시장조사 발표",
    assignmentId: "assign-1",
    opensAtRaw: "2026-09-29T10:00",
    closesAtRaw: "2026-09-29T18:00",
  };

  it("should accept a well-formed session input", () => {
    expect(EvaluationHub.parseSessionInput(valid).ok).toBe(true);
  });

  it("should reject invalid dates, titles and time windows", () => {
    expect(EvaluationHub.parseSessionInput({ ...valid, sessionDate: "9/29" }).ok).toBe(false);
    expect(EvaluationHub.parseSessionInput({ ...valid, title: "   " }).ok).toBe(false);
    expect(
      EvaluationHub.parseSessionInput({ ...valid, opensAtRaw: "2026-09-29 10:00" }).ok
    ).toBe(false);
    expect(
      EvaluationHub.parseSessionInput({ ...valid, closesAtRaw: "bad" }).ok
    ).toBe(false);
    // 마감이 시작보다 앞서면 거절
    expect(
      EvaluationHub.parseSessionInput({ ...valid, opensAtRaw: "2026-09-29T18:00", closesAtRaw: "2026-09-29T10:00" })
        .ok
    ).toBe(false);
  });
});

describe("EvaluationHub.buildSessionValues", () => {
  it("should parse KST datetimes and normalize text fields", () => {
    const values = EvaluationHub.buildSessionValues({
      sessionDate: " 2026-09-29 ",
      title: " 3주차 발표 ",
      description: "  ",
      assignmentId: "",
      opensAtRaw: "2026-09-29T10:00",
      closesAtRaw: "2026-09-29T18:00",
    });
    expect(values.sessionDate).toBe("2026-09-29");
    expect(values.title).toBe("3주차 발표");
    expect(values.description).toBeNull();
    expect(values.assignmentId).toBeNull();
    expect(values.opensAt.toISOString()).toBe("2026-09-29T01:00:00.000Z");
    expect(values.closesAt.toISOString()).toBe("2026-09-29T09:00:00.000Z");
  });
});
