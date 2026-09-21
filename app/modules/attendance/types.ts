import type { SessionPhase } from "./rules";

export type CheckInInput = {
  sessionId: string;
  birth4Input: string;
};

export type CheckInSuccess = {
  status: "present" | "late";
  checkedAt: Date;
};

export type CheckInFailure = {
  code:
    | "SESSION_NOT_FOUND"
    | "ALREADY_CHECKED"
    | "PROFESSOR_EXEMPT"
    | "INVALID_BIRTH4_FORMAT"
    | "BIRTH4_MISMATCH"
    | "PHASE_NOT_ACTIVE";
  message: string;
};

export type CheckInResult =
  | ({ ok: true } & CheckInSuccess)
  | ({ ok: false } & CheckInFailure);

export type StudentAttendanceRow = {
  dateLabel: string;
  sessionDate: string;
  isFuture: boolean;
  status: string | null;
  checkedAt: Date | null;
  source: string | null;
};

export type AttendanceSummary = {
  total: number;
  present: number;
  late: number;
  absent: number;
};

export type AdminSessionItem = {
  id: string;
  sessionDate: string;
  label: string;
  phase: SessionPhase;
};

export type AdminAttendanceBoard = {
  sessions: AdminSessionItem[];
  users: Array<{ id: string; name: string }>;
  recordMap: Record<string, string>;
};
