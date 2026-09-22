export type EvaluationPhase = "scheduled" | "open" | "closed";

export type EvaluationScores = {
  idea: number;
  feasibility: number;
  delivery: number;
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
  targetCount: number;
  myCount: number;
};

export type EvaluationTargetItem = {
  submissionId: string;
  label: string;
  presenter: string;
  content: string | null;
  link: string | null;
  mine: boolean;
  files: { id: string; filename: string; size: number }[];
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
  /** submissionId → 내가 남긴 평가 */
  myEvaluations: Record<
    string,
    EvaluationScores & { comment: string | null; updatedAt: string }
  >;
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
  submissionId: string;
  label: string;
  presenter: string;
  evaluatorCount: number;
  avgIdea: number;
  avgFeasibility: number;
  avgDelivery: number;
  avgTotal: number;
};

export type EvaluatorProgressItem = {
  name: string;
  doneCount: number;
};

export type EvaluationResultRow = {
  evaluatedAt: string;
  presentation: string;
  presenter: string;
  evaluator: string;
  idea: number;
  feasibility: number;
  delivery: number;
  total: number;
  comment: string | null;
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
  evaluators: EvaluatorProgressItem[];
  rows: EvaluationResultRow[];
  totalEvaluationCount: number;
};

export function phaseOf(opensAt: Date, closesAt: Date, now: Date): EvaluationPhase {
  if (now < opensAt) return "scheduled";
  if (now > closesAt) return "closed";
  return "open";
}
