import { describe, expect, it } from "vitest";
import { EvaluationHub } from "./evaluations.server";
import { EVAL_CRITERIA, criterionField, mean, weightedTotal } from "./rubric";
import type { CriterionKey } from "./rubric";
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

describe("루브릭 — 배점 가중 총점 (5점 만점)", () => {
  it("5개 항목은 배점 20·20·20·30·10으로 합이 100이다", () => {
    expect(EVAL_CRITERIA).toHaveLength(5);
    expect(EVAL_CRITERIA.reduce((s, c) => s + c.weight, 0)).toBe(100);
  });

  it("배점 비율대로 가중해 1.0~5.0 총점을 낸다", () => {
    // (5×20 + 4×20 + 3×20 + 2×30 + 5×10) / 100 = 3.5
    expect(weightedTotal({ usp: 5, match: 4, media: 3, data: 2, delivery: 5 })).toBe(3.5);
    expect(weightedTotal({ usp: 1, match: 1, media: 1, data: 1, delivery: 1 })).toBe(1);
    expect(weightedTotal({ usp: 5, match: 5, media: 5, data: 5, delivery: 5 })).toBe(5);
  });

  it("배점이 큰 항목(데이터 진단 30)이 총점에 더 크게 반영된다", () => {
    // 데이터만 5점 → (1×20 + 1×20 + 1×20 + 5×30 + 1×10) / 100 = 2.2
    expect(weightedTotal({ usp: 1, match: 1, media: 1, data: 5, delivery: 1 })).toBe(2.2);
    // 시간 준수(10)만 5점 → 1.4
    expect(weightedTotal({ usp: 1, match: 1, media: 1, data: 1, delivery: 5 })).toBe(1.4);
  });

  it("5개 항목이 다 채워지지 않으면 총점을 내지 않는다", () => {
    expect(weightedTotal({ usp: 5, match: 5, media: 5, data: 5 })).toBeNull();
    expect(weightedTotal({ usp: 5, match: 5, media: 5, data: 5, delivery: null })).toBeNull();
    expect(weightedTotal({ usp: 5, match: 5, media: 5, data: 5, delivery: 6 })).toBeNull();
    expect(weightedTotal({ usp: 5, match: 5, media: 5, data: 5, delivery: 4.5 })).toBeNull();
    expect(weightedTotal({})).toBeNull();
  });
});

describe("팀 최종 점수 — 평가자 총점의 평균", () => {
  it("평가자 10명이 준 총점의 평균이 팀 최종 점수다", () => {
    const totals = [4.2, 3.5, 5, 2.8, 3.9, 4.4, 3.1, 4.7, 2.5, 4.9]; // 합 39.0
    expect(mean(totals)).toBe(3.9);
    expect(mean([3.5, 4.2])).toBe(3.85);
    expect(mean([3.333, 3.334])).toBe(3.33);
    expect(mean([])).toBe(0);
  });
});

describe("EvaluationHub.readCriterionScores", () => {
  const make = (values: Partial<Record<CriterionKey, string>>) => {
    const form = new FormData();
    for (const [key, v] of Object.entries(values)) form.set(criterionField(key as CriterionKey, "t1"), v);
    return form;
  };
  const full = { usp: "1", match: "2", media: "3", data: "4", delivery: "5" };

  it("팀별 5개 항목 점수를 1~5 정수로 읽는다", () => {
    const res = EvaluationHub.readCriterionScores(make(full), "t1");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.scores).toEqual({ usp: 1, match: 2, media: 3, data: 4, delivery: 5 });
      expect(res.picked).toBe(5);
    }
  });

  it("비어 있는 항목은 건너뛴다 (부분 입력)", () => {
    const res = EvaluationHub.readCriterionScores(make({ usp: "3", data: "5" }), "t1");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.scores).toEqual({ usp: 3, data: 5 });
      expect(res.picked).toBe(2);
    }
    const none = EvaluationHub.readCriterionScores(new FormData(), "t1");
    expect(none.ok).toBe(true);
    if (none.ok) expect(none.picked).toBe(0);
  });

  it("범위 밖·정수가 아닌 값은 거절한다", () => {
    for (const bad of ["0", "6", "2.5", "abc", "-1"]) {
      expect(EvaluationHub.readCriterionScores(make({ ...full, data: bad }), "t1").ok).toBe(false);
    }
  });

  it("다른 팀의 필드는 읽지 않는다", () => {
    const res = EvaluationHub.readCriterionScores(make(full), "t2");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.picked).toBe(0);
  });
});

describe("코멘트 바이트 제한", () => {
  const encoder = new TextEncoder();

  it("should accept comments at or under the byte budget", () => {
    const asciiAtLimit = "a".repeat(MAX_EVAL_COMMENT_BYTES);
    expect(encoder.encode(asciiAtLimit).length).toBe(MAX_EVAL_COMMENT_BYTES);

    // 한글 1글자 = 3바이트 → floor(MAX/3) 글자는 예산 안
    const koreanAtLimit = "가".repeat(Math.floor(MAX_EVAL_COMMENT_BYTES / 3));
    expect(encoder.encode(koreanAtLimit).length).toBeLessThanOrEqual(MAX_EVAL_COMMENT_BYTES);
  });

  it("should reject comments over the byte budget", () => {
    const asciiOver = "a".repeat(MAX_EVAL_COMMENT_BYTES + 1);
    expect(encoder.encode(asciiOver).length).toBe(MAX_EVAL_COMMENT_BYTES + 1);

    const koreanOver = "가".repeat(Math.floor(MAX_EVAL_COMMENT_BYTES / 3) + 1);
    expect(encoder.encode(koreanOver).length).toBeGreaterThan(MAX_EVAL_COMMENT_BYTES);
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
