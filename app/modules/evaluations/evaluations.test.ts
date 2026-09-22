import { describe, expect, it } from "vitest";
import { EvaluationHub } from "./evaluations.server";
import { phaseOf } from "./types";

describe("phaseOf", () => {
  const opens = new Date("2026-09-22T09:00:00+09:00");
  const closes = new Date("2026-09-22T23:59:00+09:00");

  it("should classify scheduled / open / closed against now", () => {
    expect(phaseOf(opens, closes, new Date("2026-09-22T08:59:00+09:00"))).toBe("scheduled");
    expect(phaseOf(opens, closes, new Date("2026-09-22T12:00:00+09:00"))).toBe("open");
    expect(phaseOf(opens, closes, new Date("2026-09-23T00:00:00+09:00"))).toBe("closed");
  });
});

describe("EvaluationHub.parseScores", () => {
  it("should accept integers 1..5 for all three items", () => {
    const form = new FormData();
    form.set("ideaScore", "5");
    form.set("feasibilityScore", "3");
    form.set("deliveryScore", "1");
    const res = EvaluationHub.parseScores(form);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.scores).toEqual({ idea: 5, feasibility: 3, delivery: 1 });
  });

  it("should reject out-of-range, non-integer and missing scores", () => {
    const make = (idea: string, feas: string, deliv: string) => {
      const form = new FormData();
      form.set("ideaScore", idea);
      form.set("feasibilityScore", feas);
      form.set("deliveryScore", deliv);
      return form;
    };
    expect(EvaluationHub.parseScores(make("0", "3", "3")).ok).toBe(false);
    expect(EvaluationHub.parseScores(make("6", "3", "3")).ok).toBe(false);
    expect(EvaluationHub.parseScores(make("3.5", "3", "3")).ok).toBe(false);
    expect(EvaluationHub.parseScores(make("abc", "3", "3")).ok).toBe(false);
    expect(EvaluationHub.parseScores(new FormData()).ok).toBe(false);
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
