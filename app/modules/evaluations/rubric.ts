/**
 * 발표 평가 루브릭 — 5개 항목을 각 1~5점으로 채점하고, 배점 비율로 가중해 5점 만점 총점을 만든다.
 * 서버·클라이언트 양쪽에서 쓰므로 DB 의존성 없이 순수 함수로만 둔다.
 */
export const EVAL_CRITERIA = [
  {
    key: "usp",
    label: "USP 명확성",
    weight: 20,
    desc: "한 문장으로 뜻이 통하는가, 경쟁사와 구별되는가",
  },
  {
    key: "match",
    label: "광고물과 USP의 일치",
    weight: 20,
    desc: "소재가 USP를 그대로 옮겼는가, A·B안의 차이에 의도가 있는가",
  },
  {
    key: "media",
    label: "매체 선정 근거",
    weight: 20,
    desc: "타깃·예산과 맞는가, 근거가 구체적인가",
  },
  {
    key: "data",
    label: "데이터 진단과 운영 결정",
    weight: 30,
    desc: "숫자에서 문제를 찾았는가, 결정이 구체적이고 실행 가능한가",
  },
  {
    key: "delivery",
    label: "시간 준수와 전달력",
    weight: 10,
    desc: "5분 안에 끝냈는가, 질의에 근거를 들어 답했는가",
  },
] as const;

export type CriterionKey = (typeof EVAL_CRITERIA)[number]["key"];

export const SCORE_MIN = 1;
export const SCORE_MAX = 5;

/** 평가 폼 필드명 — crit_{항목}_{팀} */
export const criterionField = (key: CriterionKey, teamId: string) => `crit_${key}_${teamId}`;

/** 소수 둘째 자리까지 반올림 — 점수 표시용 */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** 5개 항목 점수가 모두 1~5 정수인지 */
export function isCompleteScores(
  scores: Partial<Record<CriterionKey, number | null | undefined>>
): scores is Record<CriterionKey, number> {
  return EVAL_CRITERIA.every((c) => {
    const v = scores[c.key];
    return typeof v === "number" && Number.isInteger(v) && v >= SCORE_MIN && v <= SCORE_MAX;
  });
}

/**
 * 배점 가중 총점 — Σ(점수 × 배점) / Σ배점. 점수는 1~5 점수체계 그대로라 결과도 1.0~5.0.
 * 5개 항목이 전부 유효하지 않으면 부분 점수를 내지 않고 null을 돌려준다.
 */
export function weightedTotal(
  scores: Partial<Record<CriterionKey, number | null | undefined>>
): number | null {
  if (!isCompleteScores(scores)) return null;
  let sum = 0;
  let weight = 0;
  for (const c of EVAL_CRITERIA) {
    sum += scores[c.key] * c.weight;
    weight += c.weight;
  }
  return round2(sum / weight);
}

/** 평가자 총점들의 평균 — 팀 최종 점수. 평가자가 없으면 0 */
export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return round2(values.reduce((s, v) => s + v, 0) / values.length);
}
