export type SubstitutePhase = "scheduled" | "open" | "closed";
export type SubstituteStatus = "pending" | "approved" | "rejected";

export function substitutePhaseOf(opensAt: Date, closesAt: Date, now: Date): SubstitutePhase {
  if (now < opensAt) return "scheduled";
  if (now > closesAt) return "closed";
  return "open";
}

/**
 * 결석 만회 자격 판정 — 이미 마감된 세션이면서 (기록 없음=가상결석 또는 결석)인 경우만 허용.
 * present/late/substituted 기록이 있으면 대상에서 제외한다.
 */
export function isEligibleForSubstitute(
  session: { closesAt: Date },
  recordStatus: string | null | undefined,
  now: Date
): boolean {
  if (now < session.closesAt) return false; // 아직 진행 중/예정인 수업
  if (recordStatus == null) return true; // 가상 결석 (기록 없음)
  return recordStatus === "absent";
}

export type EligibleSessionItem = {
  sessionId: string;
  sessionDate: string; // 'YYYY-MM-DD'
  dateLabel: string;
};

export type SubstituteFileItem = {
  id: string;
  filename: string;
  size: number;
};

export type MySubstituteItem = {
  id: string;
  sessionId: string;
  dateLabel: string;
  content: string | null;
  link: string | null;
  status: SubstituteStatus;
  reviewNote: string | null;
  submittedAt: string;
  files: SubstituteFileItem[];
};

export type StudentSubstituteItem = {
  id: string;
  title: string;
  description: string | null;
  opensAt: string;
  closesAt: string;
  phase: SubstitutePhase;
  /** 아직 제출하지 않은, 만회 가능한 내 결석 수업 목록 */
  eligibleSessions: EligibleSessionItem[];
  mySubmissions: MySubstituteItem[];
};

export type StudentSubstitutesView = {
  assignments: StudentSubstituteItem[];
};

export type AdminSubstituteListItem = {
  id: string;
  title: string;
  description: string | null;
  opensAt: string;
  closesAt: string;
  phase: SubstitutePhase;
  submissionCount: number;
  approvedCount: number;
};

export type AdminSubstituteSubmissionRow = {
  id: string;
  userName: string;
  dateLabel: string;
  content: string | null;
  link: string | null;
  status: SubstituteStatus;
  reviewNote: string | null;
  submittedAt: string;
  files: SubstituteFileItem[];
};

export type AdminSubstituteDetail = {
  assignment: {
    id: string;
    title: string;
    description: string | null;
    opensAt: string;
    opensAtLocal: string;
    closesAt: string;
    closesAtLocal: string;
    phase: SubstitutePhase;
  };
  submissions: AdminSubstituteSubmissionRow[];
};

export type SubstituteZipSourceRow = {
  userName: string;
  dateLabel: string;
  filename: string;
  r2Key: string;
  size: number;
};
