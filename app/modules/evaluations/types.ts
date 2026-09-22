export type EvaluationPhase = "scheduled" | "open" | "closed";

/** 팀 단위 평가 점수 — 팀원 개별 평가는 별점뿐이므로 이 타입은 팀 전용 */
export type EvaluationScores = {
  star: number;
  comment: string | null;
};

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
  /** 내가 팀 단위 평가를 끝낸 수 */
  myCount: number;
};

export type MemberEvalTarget = {
  userId: string;
  name: string;
  /** 내가 이전에 남긴 개인 평가 (별점만) */
  my: { star: number } | null;
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
  /** 팀원 목록 — 개별 평가 대상 */
  members: MemberEvalTarget[];
  /** 내가 이전에 남긴 팀 단위 평가 */
  my: (EvaluationScores & { updatedAt: string }) | null;
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
  avgStar: number;
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
  star: number;
  comment: string | null;
  evaluatedAt: string;
};

export type AdminSessionDetail = {
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
