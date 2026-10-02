export type SubstituteStatus = "pending" | "approved" | "rejected";

/**
 * 대체 과제(보고서) 제출 자격 — 이미 마감된 세션이면서
 * 기록 없음(가상결석)·지각·결석인 경우만 허용. present/substituted 기록은 대상에서 제외한다.
 */
export function isEligibleForSubstitute(
  session: { closesAt: Date },
  recordStatus: string | null | undefined,
  now: Date
): boolean {
  if (now < session.closesAt) return false; // 아직 진행 중/예정인 수업
  if (recordStatus == null) return true; // 가상 결석 (기록 없음)
  return recordStatus === "late" || recordStatus === "absent";
}

export type SubstituteFileItem = {
  id: string;
  filename: string;
  size: number;
};

/** 학생의 대체 과제 제출물 (출석 이력 행에 붙는 단위) */
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

/** 관리자 검토함의 제출물 행 */
export type AdminSubstituteRow = {
  id: string;
  userId: string;
  userName: string;
  sessionId: string;
  dateLabel: string;
  /** 현재 출석 상태 (late | absent | substituted | null) */
  attendanceStatus: string | null;
  content: string | null;
  link: string | null;
  status: SubstituteStatus;
  reviewNote: string | null;
  submittedAt: string;
  files: SubstituteFileItem[];
};

export type SubstituteZipSourceRow = {
  /** 개별 파일 서빙 URL 조립용 (/admin/substitute-files/:id) */
  id: string;
  userName: string;
  dateLabel: string;
  filename: string;
  size: number;
};
