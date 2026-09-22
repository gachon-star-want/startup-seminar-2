import { and, asc, desc, eq } from "drizzle-orm";
import { attendanceRecords, attendanceSessions, users } from "~/db/schema";
import type { AdminAppContext, AppContext } from "~/lib/context.server";
import { kstInstant, kstYMD, ymdLabel } from "~/lib/time";
import {
  SESSION_WINDOWS,
  resolveAttendanceStatus,
  sessionPhase,
  verifyBirth4,
} from "./rules";
import type {
  AdminAttendanceBoard,
  AttendanceSummary,
  CheckInInput,
  CheckInResult,
  StudentAttendanceRow,
} from "./types";

/**
 * AttendanceDesk Deep Module
 * 학생 출석체크, 출석 이력, 관리자 출석 관리 기능과 도메인 불변식을 캡슐화합니다.
 */
export const AttendanceDesk = {
  /**
   * 학생 출석체크 액션 (1-Shot 원자적 체크인)
   * - 교수 면제 판정
   * - 생일 4자리 검증 및 최초 출석 시 자동 등록
   * - 세션 시간(10:00~10:10 출석, 10:10~11:00 지각) 판정
   * - DB 복합 Unique 제약을 통한 멱등적 중복 방지
   */
  async checkIn(ctx: AppContext, input: CheckInInput): Promise<CheckInResult> {
    if (ctx.user.role === "professor") {
      return {
        ok: false,
        code: "PROFESSOR_EXEMPT",
        message: "교수 계정은 출석 대상이 아니에요.",
      };
    }

    // 캐시된 birth4가 있으면 그 값으로 확정 판정(birth4는 최초 1회만 등록되는
    // write-once 값이라 캐시 지연 영향 없음). 캐시가 null이면 다른 기기/격리에서
    // 방금 등록했을 수 있으니 DB 최신값으로 재검증한다.
    const birth4Check = verifyBirth4(ctx.user.birth4, input.birth4Input);
    if (!birth4Check.ok) {
      return {
        ok: false,
        code: birth4Check.code,
        message: birth4Check.message,
      };
    }
    let registeredBirth4 = ctx.user.birth4;
    if (registeredBirth4 === null) {
      const [freshUser] = await ctx.db
        .select({ birth4: users.birth4 })
        .from(users)
        .where(eq(users.id, ctx.user.id))
        .limit(1);
      if (freshUser?.birth4) {
        registeredBirth4 = freshUser.birth4;
        const recheck = verifyBirth4(registeredBirth4, input.birth4Input);
        if (!recheck.ok) {
          return { ok: false, code: recheck.code, message: recheck.message };
        }
      }
    }

    // 출석 세션 조회
    const [session] = await ctx.db
      .select()
      .from(attendanceSessions)
      .where(eq(attendanceSessions.id, input.sessionId))
      .limit(1);

    if (!session) {
      return {
        ok: false,
        code: "SESSION_NOT_FOUND",
        message: "출석 세션을 찾을 수 없어요.",
      };
    }

    const phase = sessionPhase(session, ctx.now);
    if (phase !== "present" && phase !== "late") {
      return {
        ok: false,
        code: "PHASE_NOT_ACTIVE",
        message: "지금은 체크 가능한 시간이 아니에요 (10:00~11:00).",
      };
    }

    // 첫 출석체크 시 생일 4자리 등록
    if (!registeredBirth4) {
      await ctx.db
        .update(users)
        .set({ birth4: birth4Check.birth4 })
        .where(eq(users.id, ctx.user.id));
      ctx.user.birth4 = birth4Check.birth4;
    }

    const status = phase === "present" ? "present" : "late";

    // ON CONFLICT DO NOTHING을 활용한 단일 쿼리 멱등 삽입
    const inserted = await ctx.db
      .insert(attendanceRecords)
      .values({
        sessionId: input.sessionId,
        userId: ctx.user.id,
        status,
        source: "self",
        checkedAt: ctx.now,
      })
      .onConflictDoNothing()
      .returning();

    if (inserted.length === 0) {
      return {
        ok: false,
        code: "ALREADY_CHECKED",
        message: "이미 출석체크 했어요!",
      };
    }

    return {
      ok: true,
      status,
      checkedAt: ctx.now,
    };
  },

  /**
   * 학생 개인의 전체 출석 이력과 통계 요약을 단일 1 RTT로 조회합니다.
   * 세션 종료 후 미체크에 대한 가상 결석(Virtual Absent) 상태를 인메모리로 계산합니다.
   */
  async getMyHistory(ctx: AppContext): Promise<{
    rows: StudentAttendanceRow[];
    summary: AttendanceSummary;
    isProfessor: boolean;
  }> {
    const isProfessor = ctx.user.role === "professor";
    const today = kstYMD(ctx.now);

    const [sessions, records] = await Promise.all([
      ctx.db
        .select()
        .from(attendanceSessions)
        .orderBy(desc(attendanceSessions.sessionDate)),
      isProfessor
        ? Promise.resolve([])
        : ctx.db
            .select()
            .from(attendanceRecords)
            .where(eq(attendanceRecords.userId, ctx.user.id)),
    ]);

    const recordBySession = new Map(records.map((r) => [r.sessionId, r]));

    const rows: StudentAttendanceRow[] = sessions.map((s) => {
      const record = recordBySession.get(s.id);
      const status = resolveAttendanceStatus(s, record?.status, ctx.now);

      return {
        dateLabel: ymdLabel(s.sessionDate),
        sessionDate: s.sessionDate,
        isFuture: s.sessionDate > today,
        status,
        checkedAt: record?.checkedAt ?? null,
        source: record?.source ?? null,
      };
    });

    const counted = isProfessor ? [] : rows.filter((r) => !r.isFuture && r.status);
    const summary: AttendanceSummary = {
      total: counted.length,
      present: counted.filter((r) => r.status === "present").length,
      late: counted.filter((r) => r.status === "late").length,
      absent: counted.filter((r) => r.status === "absent").length,
    };

    return { rows, summary, isProfessor };
  },

  /**
   * 관리자 출석 관리 매트릭스 그리드 뷰 (학생 20인 x 주차별 세션)
   * 3개 테이블 병렬 1회 왕복 후 인메모리 프로젝션으로 O(1) 맵을 조립합니다.
   */
  async getAdminBoard(ctx: AdminAppContext | AppContext): Promise<AdminAttendanceBoard> {
    const [sessions, rawUsers, records] = await Promise.all([
      ctx.db
        .select()
        .from(attendanceSessions)
        .orderBy(asc(attendanceSessions.sessionDate)),
      ctx.db.select().from(users),
      ctx.db
        .select({
          sessionId: attendanceRecords.sessionId,
          userId: attendanceRecords.userId,
          status: attendanceRecords.status,
        })
        .from(attendanceRecords),
    ]);

    const allStudents = rawUsers
      .filter((u) => u.role !== "professor")
      .sort((a, b) => a.name.localeCompare(b.name, "ko"));

    const recordMap = new Map(records.map((r) => [`${r.sessionId}:${r.userId}`, r.status]));

    return {
      sessions: sessions.map((s) => ({
        id: s.id,
        sessionDate: s.sessionDate,
        label: ymdLabel(s.sessionDate),
        phase: sessionPhase(s, ctx.now),
      })),
      users: allStudents.map((u) => ({ id: u.id, name: u.name })),
      recordMap: Object.fromEntries(recordMap),
    };
  },

  /**
   * 관리자 수업 세션 일정 추가
   */
  async addSession(
    ctx: AdminAppContext | AppContext,
    input: { date: string; note?: string }
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    const trimmedDate = input.date.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmedDate)) {
      return { ok: false, message: "날짜 형식이 올바르지 않아요." };
    }

    const inserted = await ctx.db
      .insert(attendanceSessions)
      .values({
        sessionDate: trimmedDate,
        opensAt: kstInstant(trimmedDate, SESSION_WINDOWS.open),
        lateFrom: kstInstant(trimmedDate, SESSION_WINDOWS.late),
        closesAt: kstInstant(trimmedDate, SESSION_WINDOWS.close),
        note: input.note?.trim() || null,
      })
      .onConflictDoNothing({ target: attendanceSessions.sessionDate })
      .returning();

    if (inserted.length === 0) {
      return { ok: false, message: `${ymdLabel(trimmedDate)} 는 이미 등록된 날짜예요.` };
    }

    return { ok: true };
  },

  /**
   * 관리자 수업 세션 일정 삭제
   */
  async deleteSession(
    ctx: AdminAppContext | AppContext,
    sessionId: string
  ): Promise<{ ok: true }> {
    await ctx.db
      .delete(attendanceSessions)
      .where(eq(attendanceSessions.id, sessionId));
    return { ok: true };
  },

  /**
   * 관리자 개별 학생 출석 셀 상태 수동 조정 (none | present | late | absent)
   */
  async setCellStatus(
    ctx: AdminAppContext | AppContext,
    input: { sessionId: string; userId: string; nextStatus: string }
  ): Promise<{ ok: true }> {
    const { sessionId, userId, nextStatus } = input;

    if (nextStatus === "none") {
      await ctx.db
        .delete(attendanceRecords)
        .where(
          and(
            eq(attendanceRecords.sessionId, sessionId),
            eq(attendanceRecords.userId, userId)
          )
        );
    } else if (["present", "late", "absent"].includes(nextStatus)) {
      await ctx.db
        .insert(attendanceRecords)
        .values({ sessionId, userId, status: nextStatus, source: "admin", checkedAt: ctx.now })
        .onConflictDoUpdate({
          target: [attendanceRecords.sessionId, attendanceRecords.userId],
          set: { status: nextStatus, source: "admin", checkedAt: ctx.now },
        });
    }

    return { ok: true };
  },

  /**
   * 관리자 특정 세션 전원 출석 처리
   */
  async markAllPresent(
    ctx: AdminAppContext | AppContext,
    sessionId: string
  ): Promise<{ ok: true; count: number } | { ok: false; message: string }> {
    const [session] = await ctx.db
      .select()
      .from(attendanceSessions)
      .where(eq(attendanceSessions.id, sessionId))
      .limit(1);

    if (!session) {
      return { ok: false, message: "수업 날짜를 찾을 수 없어요." };
    }

    if (sessionPhase(session, ctx.now) === "scheduled") {
      return { ok: false, message: `${ymdLabel(session.sessionDate)} 은 아직 예정된 수업이에요.` };
    }

    const students = await ctx.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.role, "student"));

    if (students.length === 0) {
      return { ok: false, message: "학생 명단이 비어 있어요." };
    }

    if (students.length > 0) {
      await ctx.db
        .insert(attendanceRecords)
        .values(
          students.map((s) => ({
            sessionId,
            userId: s.id,
            status: "present",
            source: "admin",
            checkedAt: ctx.now,
          }))
        )
        .onConflictDoUpdate({
          target: [attendanceRecords.sessionId, attendanceRecords.userId],
          set: { status: "present", source: "admin", checkedAt: ctx.now },
        });
    }

    return { ok: true, count: students.length };
  },
};
