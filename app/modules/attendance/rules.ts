/**
 * 수업 출석 도메인 정책 및 규칙 (Attendance Domain Rules & Invariants)
 */

export const SESSION_WINDOWS = {
  open: "10:00", // 출석 오픈
  late: "10:10", // 이후 체크는 지각
  close: "11:00", // 체크 마감
} as const;

export type SessionPhase = "scheduled" | "present" | "late" | "closed";

export interface SessionTiming {
  opensAt: Date;
  lateFrom: Date;
  closesAt: Date;
}

/**
 * 주어진 세션 윈도우와 현재 시각을 기준으로 세션 진행 단계(Phase)를 판정합니다.
 */
export function sessionPhase(s: SessionTiming, now: Date = new Date()): SessionPhase {
  if (now < s.opensAt) return "scheduled";
  if (now < s.lateFrom) return "present";
  if (now < s.closesAt) return "late";
  return "closed";
}

/**
 * 생일 4자리(MMDD) 형식 및 일치 여부를 검증합니다.
 */
export function verifyBirth4(
  registeredBirth4: string | null,
  inputBirth4: string
): { ok: true; birth4: string } | { ok: false; code: "INVALID_BIRTH4_FORMAT" | "BIRTH4_MISMATCH"; message: string } {
  const trimmed = inputBirth4.trim();
  if (!/^\d{4}$/.test(trimmed)) {
    return {
      ok: false,
      code: "INVALID_BIRTH4_FORMAT",
      message: "생일 4자리(MMDD)를 숫자 4자리로 입력해 주세요.",
    };
  }

  if (registeredBirth4 && registeredBirth4 !== trimmed) {
    return {
      ok: false,
      code: "BIRTH4_MISMATCH",
      message: "생일 4자리(MMDD)가 일치하지 않아요.",
    };
  }

  return { ok: true, birth4: trimmed };
}

/**
 * 학생의 출석 레코드가 없을 때, 세션 마감 여부에 따라 가상 결석(absent) 상태를 판정합니다.
 */
export function resolveAttendanceStatus(
  session: SessionTiming,
  recordStatus: string | null | undefined,
  now: Date = new Date()
): string | null {
  if (recordStatus) return recordStatus;
  // 세션이 이미 마감되었고 출석 기록이 없으면 결석으로 간주
  if (sessionPhase(session, now) === "closed") {
    return "absent";
  }
  return null;
}
