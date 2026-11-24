import type { CriterionKey } from "./rubric";

export type EvaluationPhase = "scheduled" | "open" | "closed";

/** 5개 항목 점수 — 임시 저장 중인 부분 입력은 일부 키만 있다 */
export type CriterionScoreMap = Partial<Record<CriterionKey, number>>;

/** 세션의 채점 방식 — 루브릭(5개 항목 1~5점) 도입 전 세션은 별점 */
export type RubricKind = "star" | "criteria";

export type StudentSessionListItem = {
  id: string;
  sessionDate: string;
  title: string;
  description: string | null;
  assignmentId: string | null;
  assignmentTitle: string | null;
  opensAt: string;
  closesAt: string;
  phase: EvaluationPhase;
  /** 평가 대상 팀 수 — 제출물 없는 팀 포함, 전체 팀 대상 */
  targetCount: number;
  /** 내가 평가를 끝낸 팀 수 (5개 항목을 모두 매기고 저장한 팀) */
  myCount: number;
};

export type EvaluationTargetItem = {
  teamId: string;
  /** 팀의 대표 제출물(최신 1건) — 발표 자료를 안 올린 팀은 null */
  submissionId: string | null;
  label: string;
  presenter: string;
  content: string | null;
  link: string | null;
  files: { id: string; filename: string; size: number }[];
  /** 내가 이 팀의 평가를 끝냈는지 (5개 항목 모두 매겨 저장함) */
  evaluated: boolean;
  /** 내가 저장한 입력 — 폼을 다시 채울 때만 쓰며, 평가 중일 때만 내려준다. 점수는 관리자만 열람할 수 있다 */
  mine: { scores: CriterionScoreMap; comment: string | null } | null;
};

export type StudentSessionView = {
  session: {
    id: string;
    sessionDate: string;
    title: string;
    description: string | null;
    opensAt: string;
    closesAt: string;
    phase: EvaluationPhase;
  };
  targets: EvaluationTargetItem[];
};

export type AdminSessionListItem = {
  id: string;
  sessionDate: string;
  title: string;
  description: string | null;
  assignmentId: string | null;
  assignmentTitle: string | null;
  opensAt: string;
  closesAt: string;
  phase: EvaluationPhase;
  targetCount: number;
  evaluationCount: number;
  evaluatorCount: number;
};

export type TargetStatItem = {
  teamId: string;
  label: string;
  presenter: string;
  evaluatorCount: number;
  /** 팀 단위 점수 합계 — 루브릭 세션에서는 평가자 총점의 단순 합(참고용) */
  totalStar: number;
  /** 팀 최종 점수 — 평가자들이 준 총점의 평균 (평가자가 없으면 0) */
  avgStar: number;
  /** 항목별 평균 — EVAL_CRITERIA 순서. 그 항목 점수가 없는(별점 시절) 세션은 null */
  criteriaAvg: (number | null)[];
};

/** 팀×평가자 매트릭스 — 셀 값은 scores에서 `${userId}:${teamId}` 키로 조회 */
export type EvaluationMatrix = {
  /** 평가자별 진행 정보 (가나다순) */
  evaluators: { userId: string; name: string; doneCount: number }[];
  scores: Record<string, number>;
};

export type TeamCommentGroup = {
  teamId: string;
  teamLabel: string;
  items: { evaluator: string; comment: string; evaluatedAt: string }[];
};

export type MemberStatItem = {
  teamLabel: string;
  name: string;
  evaluatorCount: number;
  avgStar: number;
};

export type EvaluationResultRow = {
  kind: "team" | "member";
  presentation: string;
  target: string;
  evaluator: string;
  /** 별점 시절 행은 별점, 루브릭 행은 배점 가중 총점(5점 만점) */
  star: number;
  /** 항목별 점수 — EVAL_CRITERIA 순서. 별점 시절 행과 팀원 평가 행은 null */
  scores: (number | null)[];
  comment: string | null;
  evaluatedAt: string;
};

export type AdminSessionDetail = {
  /** 세션의 채점 방식 — 평가 기록이 없는 세션은 루브릭으로 본다 */
  rubric: RubricKind;
  session: {
    id: string;
    sessionDate: string;
    title: string;
    description: string | null;
    assignmentId: string | null;
    assignmentTitle: string | null;
    opensAt: string;
    opensAtLocal: string;
    closesAt: string;
    closesAtLocal: string;
    phase: EvaluationPhase;
  };
  targets: TargetStatItem[];
  memberStats: MemberStatItem[];
  evaluators: EvaluatorProgressItem[];
  matrix: EvaluationMatrix;
  commentGroups: TeamCommentGroup[];
  rows: EvaluationResultRow[];
  totalEvaluationCount: number;
};

export type EvaluatorProgressItem = {
  name: string;
  doneCount: number;
};

export function phaseOf(opensAt: Date, closesAt: Date, now: Date): EvaluationPhase {
  if (now < opensAt) return "scheduled";
  if (now > closesAt) return "closed";
  return "open";
}
