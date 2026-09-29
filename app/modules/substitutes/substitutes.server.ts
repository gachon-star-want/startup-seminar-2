import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  attendanceRecords,
  attendanceSessions,
  substituteAssignments,
  substituteFiles,
  substituteSubmissions,
  users,
} from "~/db/schema";
import { MAX_FILE_MB, MAX_FILES_PER_SUBMISSION } from "~/lib/constants";
import type { AppContext } from "~/lib/context.server";
import { inferMimeType } from "~/lib/mime";
import {
  buildFileStreamResponse,
  sanitizeFilename,
  uploadStreamToR2,
} from "~/modules/submissions/storage";
import { ymdLabel } from "~/lib/time";
import { isEligibleForSubstitute, substitutePhaseOf } from "./types";
import type {
  AdminSubstituteDetail,
  AdminSubstituteListItem,
  StudentSubstituteItem,
  StudentSubstitutesView,
  SubstituteStatus,
  SubstituteZipSourceRow,
} from "./types";

function toKstDatetimeLocal(d: Date): string {
  const kstMs = d.getTime() + 9 * 60 * 60 * 1000;
  return new Date(kstMs).toISOString().slice(0, 16);
}

function buildSubstituteR2Key(assignmentId: string, userId: string, filename: string): string {
  const safeName = sanitizeFilename(filename);
  const uuid = crypto.randomUUID();
  return `substitutes/${assignmentId}/${userId}/${uuid}-${safeName}`;
}

export type SubstituteAssignmentInput = {
  title: string;
  description?: string;
  opensAtRaw: string;
  closesAtRaw: string;
};

/**
 * SubstituteHub Deep Module
 * 출석 대체 과제 생성/관리, 결석 학생의 보고서 제출(R2 스트리밍), 승인/반려에 따른
 * 출석 기록(substituted) 연동을 캡슐화합니다.
 */
export const SubstituteHub = {
  /**
   * 과제 입력 검증 (순수) — 제목, KST datetime-local 형식, 마감 > 시작
   */
  parseAssignmentInput(
    input: SubstituteAssignmentInput
  ): { ok: true; values: { title: string; description: string | null; opensAt: Date; closesAt: Date } } | { ok: false; message: string } {
    const title = input.title.trim();
    const description = input.description?.trim() || null;
    const opensAtRaw = input.opensAtRaw.trim();
    const closesAtRaw = input.closesAtRaw.trim();

    if (!title) return { ok: false, message: "과제 제목을 입력해 주세요." };
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(opensAtRaw)) {
      return { ok: false, message: "제출 시작 시각을 입력해 주세요." };
    }
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(closesAtRaw)) {
      return { ok: false, message: "제출 마감 시각을 입력해 주세요." };
    }
    const opensAt = new Date(`${opensAtRaw}:00+09:00`);
    const closesAt = new Date(`${closesAtRaw}:00+09:00`);
    if (Number.isNaN(opensAt.getTime()) || Number.isNaN(closesAt.getTime())) {
      return { ok: false, message: "시각 형식이 올바르지 않아요." };
    }
    if (closesAt <= opensAt) {
      return { ok: false, message: "마감 시각이 시작 시각보다 앞서면 안 돼요." };
    }

    return { ok: true, values: { title, description, opensAt, closesAt } };
  },

  /**
   * 학생 뷰 — 열려 있는 대체 과제와, 만회 가능한 내 결석 수업, 내 제출물을 한 번에 조회
   */
  async listForStudent(ctx: AppContext): Promise<StudentSubstitutesView> {
    const [assignments, sessions, records, submissions] = await Promise.all([
      ctx.db.select().from(substituteAssignments).orderBy(asc(substituteAssignments.closesAt)),
      ctx.db.select().from(attendanceSessions),
      ctx.db
        .select({ sessionId: attendanceRecords.sessionId, status: attendanceRecords.status })
        .from(attendanceRecords)
        .where(eq(attendanceRecords.userId, ctx.user.id)),
      ctx.db
        .select()
        .from(substituteSubmissions)
        .where(eq(substituteSubmissions.userId, ctx.user.id)),
    ]);

    const subIds = submissions.map((s) => s.id);
    const files =
      subIds.length > 0
        ? await ctx.db
            .select()
            .from(substituteFiles)
            .where(inArray(substituteFiles.submissionId, subIds))
        : [];

    const filesBySub = new Map<string, typeof files>();
    for (const f of files) {
      const list = filesBySub.get(f.submissionId) ?? [];
      list.push(f);
      filesBySub.set(f.submissionId, list);
    }

    const statusBySession = new Map(records.map((r) => [r.sessionId, r.status]));
    const sessionById = new Map(sessions.map((s) => [s.id, s]));
    const submittedKey = new Set(submissions.map((s) => `${s.assignmentId}:${s.sessionId}`));
    const subsByAssignment = new Map<string, typeof submissions>();
    for (const s of submissions) {
      const list = subsByAssignment.get(s.assignmentId) ?? [];
      list.push(s);
      subsByAssignment.set(s.assignmentId, list);
    }

    const items: StudentSubstituteItem[] = assignments.map((a) => {
      const eligibleSessions = sessions
        .filter((s) => isEligibleForSubstitute(s, statusBySession.get(s.id) ?? null, ctx.now))
        .filter((s) => !submittedKey.has(`${a.id}:${s.id}`))
        .sort((x, y) => y.sessionDate.localeCompare(x.sessionDate))
        .map((s) => ({
          sessionId: s.id,
          sessionDate: s.sessionDate,
          dateLabel: ymdLabel(s.sessionDate),
        }));

      const mySubmissions = (subsByAssignment.get(a.id) ?? [])
        .map((s) => {
          const session = sessionById.get(s.sessionId);
          return {
            id: s.id,
            sessionId: s.sessionId,
            dateLabel: session ? ymdLabel(session.sessionDate) : "삭제된 수업",
            content: s.content,
            link: s.link,
            status: s.status as SubstituteStatus,
            reviewNote: s.reviewNote,
            submittedAt: s.submittedAt.toISOString(),
            files: (filesBySub.get(s.id) ?? []).map((f) => ({
              id: f.id,
              filename: f.filename,
              size: f.size,
            })),
          };
        })
        .sort((x, y) => y.submittedAt.localeCompare(x.submittedAt));

      return {
        id: a.id,
        title: a.title,
        description: a.description,
        opensAt: a.opensAt.toISOString(),
        closesAt: a.closesAt.toISOString(),
        phase: substitutePhaseOf(a.opensAt, a.closesAt, ctx.now),
        eligibleSessions,
        mySubmissions,
      };
    });

    return { assignments: items };
  },

  /**
   * 보고서 제출/수정 — 결석자 자격 검증 후 파일 Zero-Heap R2 스트리밍.
   * 재제출 시 심사 상태를 대기중(pending)으로 되돌린다.
   */
  async submit(
    ctx: AppContext,
    form: FormData
  ): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
    const assignmentId = String(form.get("assignmentId") ?? "");
    const sessionId = String(form.get("sessionId") ?? "");

    const [assignment] = await ctx.db
      .select()
      .from(substituteAssignments)
      .where(eq(substituteAssignments.id, assignmentId))
      .limit(1);
    if (!assignment) {
      throw new Response("대체 과제를 찾을 수 없어요", { status: 404 });
    }

    const phase = substitutePhaseOf(assignment.opensAt, assignment.closesAt, ctx.now);
    if (phase === "scheduled") {
      return { ok: false, message: "아직 제출 시작 전이에요." };
    }
    if (phase === "closed") {
      return { ok: false, message: "마감된 과제예요. 제출할 수 없어요." };
    }

    const [session] = await ctx.db
      .select()
      .from(attendanceSessions)
      .where(eq(attendanceSessions.id, sessionId))
      .limit(1);
    if (!session) {
      return { ok: false, message: "대상 수업을 찾을 수 없어요." };
    }

    const [record] = await ctx.db
      .select({ status: attendanceRecords.status })
      .from(attendanceRecords)
      .where(
        and(
          eq(attendanceRecords.sessionId, sessionId),
          eq(attendanceRecords.userId, ctx.user.id)
        )
      )
      .limit(1);

    if (!isEligibleForSubstitute(session, record?.status ?? null, ctx.now)) {
      return { ok: false, message: "결석한 수업만 대체 과제로 만회할 수 있어요." };
    }

    const [existing] = await ctx.db
      .select({ id: substituteSubmissions.id, status: substituteSubmissions.status })
      .from(substituteSubmissions)
      .where(
        and(
          eq(substituteSubmissions.assignmentId, assignmentId),
          eq(substituteSubmissions.userId, ctx.user.id),
          eq(substituteSubmissions.sessionId, sessionId)
        )
      )
      .limit(1);

    if (existing?.status === "approved") {
      return { ok: false, message: "이미 승인된 보고서예요. 수정할 수 없어요." };
    }

    const content = String(form.get("content") ?? "").trim();
    const link = String(form.get("link") ?? "").trim();
    const deleteFileIds = form.getAll("deleteFileIds").map(String);
    const newFiles = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);

    const existingFiles = existing
      ? await ctx.db
          .select()
          .from(substituteFiles)
          .where(eq(substituteFiles.submissionId, existing.id))
      : [];

    const deleteSet = new Set(deleteFileIds);
    const remainingFiles = existingFiles.filter((f) => !deleteSet.has(f.id));

    if (!content && !link && remainingFiles.length === 0 && newFiles.length === 0) {
      return { ok: false, message: "내용, 링크, 파일 중 하나는 등록해 주세요." };
    }

    for (const f of newFiles) {
      if (f.size > MAX_FILE_MB * 1024 * 1024) {
        return { ok: false, message: `'${f.name}' 파일이 ${MAX_FILE_MB}MB를 초과해요.` };
      }
    }

    if (remainingFiles.length + newFiles.length > MAX_FILES_PER_SUBMISSION) {
      return {
        ok: false,
        message: `파일은 최대 ${MAX_FILES_PER_SUBMISSION}개까지 첨부할 수 있어요. (유지할 파일 ${remainingFiles.length}개 + 새 파일 ${newFiles.length}개)`,
      };
    }

    // 1. 삭제 선택된 파일 정리
    for (const f of existingFiles) {
      if (!deleteSet.has(f.id)) continue;
      await ctx.db.delete(substituteFiles).where(eq(substituteFiles.id, f.id));
      if (ctx.executionCtx) {
        ctx.executionCtx.waitUntil(ctx.env.FILES.delete(f.r2Key));
      } else {
        try {
          await ctx.env.FILES.delete(f.r2Key);
        } catch {}
      }
    }

    // 2. 제출 레코드 upsert (복합 Unique로 멱등) — 재제출 시 심사 초기화
    const [row] = await ctx.db
      .insert(substituteSubmissions)
      .values({
        assignmentId,
        userId: ctx.user.id,
        sessionId,
        content: content || null,
        link: link || null,
        status: "pending",
        submittedAt: ctx.now,
        updatedAt: ctx.now,
      })
      .onConflictDoUpdate({
        target: [
          substituteSubmissions.assignmentId,
          substituteSubmissions.userId,
          substituteSubmissions.sessionId,
        ],
        set: {
          content: content || null,
          link: link || null,
          status: "pending",
          submittedAt: ctx.now,
          updatedAt: ctx.now,
          reviewedAt: null,
        },
      })
      .returning();

    // 3. 새 파일 R2 Zero-Heap 스트리밍 업로드 및 DB 등록
    for (const file of newFiles) {
      const mime = inferMimeType(file.name, file.type);
      const key = buildSubstituteR2Key(assignmentId, ctx.user.id, file.name);

      await uploadStreamToR2(ctx.env.FILES, key, file, mime);

      await ctx.db.insert(substituteFiles).values({
        submissionId: row.id,
        filename: file.name,
        r2Key: key,
        size: file.size,
        mime,
      });
    }

    return {
      ok: true,
      message: existing ? "보고서가 성공적으로 수정되었어요!" : "보고서가 성공적으로 제출되었어요!",
    };
  },

  /**
   * 단일 파일 스트리밍 서빙 (작성자 또는 교수만)
   */
  async serveFile(
    ctx: AppContext,
    fileId: string,
    options: { inline?: boolean } = {}
  ): Promise<Response> {
    const [file] = await ctx.db
      .select({
        id: substituteFiles.id,
        filename: substituteFiles.filename,
        r2Key: substituteFiles.r2Key,
        mime: substituteFiles.mime,
        userId: substituteSubmissions.userId,
      })
      .from(substituteFiles)
      .innerJoin(substituteSubmissions, eq(substituteFiles.submissionId, substituteSubmissions.id))
      .where(eq(substituteFiles.id, fileId))
      .limit(1);

    if (!file) throw new Response("파일을 찾을 수 없어요", { status: 404 });

    const isAdmin = ctx.user.role === "professor";
    const isAuthor = file.userId === ctx.user.id;
    if (!isAdmin && !isAuthor) {
      throw new Response("파일에 접근할 권한이 없어요", { status: 403 });
    }

    const object = await ctx.env.FILES.get(file.r2Key);
    if (!object) {
      throw new Response("저장된 파일이 없어요 (스토리지에서 삭제되었을 수 있어요)", { status: 404 });
    }

    return buildFileStreamResponse(file.filename, file.mime, object.body, options.inline);
  },

  /**
   * 관리자 대체 과제 목록 및 제출/승인 수
   */
  async listForAdmin(ctx: AppContext): Promise<AdminSubstituteListItem[]> {
    const [list, counts, approved] = await Promise.all([
      ctx.db.select().from(substituteAssignments).orderBy(asc(substituteAssignments.closesAt)),
      ctx.db
        .select({
          assignmentId: substituteSubmissions.assignmentId,
          count: sql<number>`count(*)`,
        })
        .from(substituteSubmissions)
        .groupBy(substituteSubmissions.assignmentId),
      ctx.db
        .select({
          assignmentId: substituteSubmissions.assignmentId,
          count: sql<number>`count(*)`,
        })
        .from(substituteSubmissions)
        .where(eq(substituteSubmissions.status, "approved"))
        .groupBy(substituteSubmissions.assignmentId),
    ]);

    const countMap = new Map(counts.map((c) => [c.assignmentId, c.count]));
    const approvedMap = new Map(approved.map((c) => [c.assignmentId, c.count]));

    return list.map((a) => ({
      id: a.id,
      title: a.title,
      description: a.description,
      opensAt: a.opensAt.toISOString(),
      closesAt: a.closesAt.toISOString(),
      phase: substitutePhaseOf(a.opensAt, a.closesAt, ctx.now),
      submissionCount: countMap.get(a.id) ?? 0,
      approvedCount: approvedMap.get(a.id) ?? 0,
    }));
  },

  /**
   * 관리자 과제 상세 — 제출물 목록 (학생, 대상 수업, 파일 포함)
   */
  async getAdminDetail(ctx: AppContext, assignmentId: string): Promise<AdminSubstituteDetail> {
    const [assignment] = await ctx.db
      .select()
      .from(substituteAssignments)
      .where(eq(substituteAssignments.id, assignmentId))
      .limit(1);
    if (!assignment) {
      throw new Response("대체 과제를 찾을 수 없어요", { status: 404 });
    }

    const rows = await ctx.db
      .select({
        submission: substituteSubmissions,
        userName: users.name,
        sessionDate: attendanceSessions.sessionDate,
      })
      .from(substituteSubmissions)
      .innerJoin(users, eq(substituteSubmissions.userId, users.id))
      .innerJoin(attendanceSessions, eq(substituteSubmissions.sessionId, attendanceSessions.id))
      .where(eq(substituteSubmissions.assignmentId, assignmentId));

    const subIds = rows.map((r) => r.submission.id);
    const files =
      subIds.length > 0
        ? await ctx.db
            .select()
            .from(substituteFiles)
            .where(inArray(substituteFiles.submissionId, subIds))
        : [];

    const filesBySub = new Map<string, typeof files>();
    for (const f of files) {
      const list = filesBySub.get(f.submissionId) ?? [];
      list.push(f);
      filesBySub.set(f.submissionId, list);
    }

    return {
      assignment: {
        id: assignment.id,
        title: assignment.title,
        description: assignment.description,
        opensAt: assignment.opensAt.toISOString(),
        opensAtLocal: toKstDatetimeLocal(assignment.opensAt),
        closesAt: assignment.closesAt.toISOString(),
        closesAtLocal: toKstDatetimeLocal(assignment.closesAt),
        phase: substitutePhaseOf(assignment.opensAt, assignment.closesAt, ctx.now),
      },
      submissions: rows
        .map((r) => ({
          id: r.submission.id,
          userName: r.userName,
          dateLabel: ymdLabel(r.sessionDate),
          content: r.submission.content,
          link: r.submission.link,
          status: r.submission.status as SubstituteStatus,
          reviewNote: r.submission.reviewNote,
          submittedAt: r.submission.submittedAt.toISOString(),
          files: (filesBySub.get(r.submission.id) ?? []).map((f) => ({
            id: f.id,
            filename: f.filename,
            size: f.size,
          })),
        }))
        .sort((a, b) => a.userName.localeCompare(b.userName, "ko")),
    };
  },

  /**
   * 관리자 새 대체 과제 생성
   */
  async createAssignment(
    ctx: AppContext,
    input: SubstituteAssignmentInput
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    const parsed = SubstituteHub.parseAssignmentInput(input);
    if (!parsed.ok) return parsed;

    await ctx.db.insert(substituteAssignments).values(parsed.values);
    return { ok: true };
  },

  /**
   * 관리자 대체 과제 설정 수정
   */
  async updateAssignment(
    ctx: AppContext,
    assignmentId: string,
    input: SubstituteAssignmentInput
  ): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
    const parsed = SubstituteHub.parseAssignmentInput(input);
    if (!parsed.ok) return parsed;

    await ctx.db
      .update(substituteAssignments)
      .set(parsed.values)
      .where(eq(substituteAssignments.id, assignmentId));

    return { ok: true, message: "대체 과제 설정이 성공적으로 수정되었어요." };
  },

  /**
   * 관리자 대체 과제 삭제 — 연결된 제출물/파일 행은 cascade, R2 객체는 best-effort 정리
   */
  async deleteAssignment(ctx: AppContext, assignmentId: string): Promise<{ ok: true }> {
    const files = await ctx.db
      .select({ r2Key: substituteFiles.r2Key })
      .from(substituteFiles)
      .innerJoin(substituteSubmissions, eq(substituteFiles.submissionId, substituteSubmissions.id))
      .where(eq(substituteSubmissions.assignmentId, assignmentId));

    await ctx.db.delete(substituteAssignments).where(eq(substituteAssignments.id, assignmentId));

    for (const f of files) {
      if (ctx.executionCtx) {
        ctx.executionCtx.waitUntil(ctx.env.FILES.delete(f.r2Key));
      } else {
        try {
          await ctx.env.FILES.delete(f.r2Key);
        } catch {}
      }
    }

    return { ok: true };
  },

  /**
   * 심사 — 승인 시 출석 기록을 substituted로, 승인 취소 시 absent으로 되돌린다.
   * 반려는 제출물 상태만 변경하고 출석 기록은 건드리지 않는다.
   */
  async review(
    ctx: AppContext,
    submissionId: string,
    action: "approve" | "reject" | "revoke",
    note?: string
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    const [sub] = await ctx.db
      .select()
      .from(substituteSubmissions)
      .where(eq(substituteSubmissions.id, submissionId))
      .limit(1);
    if (!sub) {
      return { ok: false, message: "제출물을 찾을 수 없어요." };
    }

    if (action === "approve") {
      await ctx.db
        .update(substituteSubmissions)
        .set({
          status: "approved",
          reviewedAt: ctx.now,
          reviewNote: note?.trim() || null,
        })
        .where(eq(substituteSubmissions.id, submissionId));
      await ctx.db
        .insert(attendanceRecords)
        .values({
          sessionId: sub.sessionId,
          userId: sub.userId,
          status: "substituted",
          source: "admin",
          checkedAt: ctx.now,
        })
        .onConflictDoUpdate({
          target: [attendanceRecords.sessionId, attendanceRecords.userId],
          set: { status: "substituted", source: "admin", checkedAt: ctx.now },
        });
      return { ok: true };
    }

    if (action === "reject") {
      // 이미 승인됐던 제출물을 반려하면 출석 기록도 결석으로 되돌린다
      if (sub.status === "approved") {
        await ctx.db
          .insert(attendanceRecords)
          .values({
            sessionId: sub.sessionId,
            userId: sub.userId,
            status: "absent",
            source: "admin",
            checkedAt: ctx.now,
          })
          .onConflictDoUpdate({
            target: [attendanceRecords.sessionId, attendanceRecords.userId],
            set: { status: "absent", source: "admin", checkedAt: ctx.now },
          });
      }
      await ctx.db
        .update(substituteSubmissions)
        .set({
          status: "rejected",
          reviewedAt: ctx.now,
          reviewNote: note?.trim() || null,
        })
        .where(eq(substituteSubmissions.id, submissionId));
      return { ok: true };
    }

    // revoke — 승인 취소
    if (sub.status !== "approved") {
      return { ok: false, message: "승인 상태가 아니라 취소할 수 없어요." };
    }
    await ctx.db
      .update(substituteSubmissions)
      .set({ status: "pending", reviewedAt: null, reviewNote: null })
      .where(eq(substituteSubmissions.id, submissionId));
    await ctx.db
      .insert(attendanceRecords)
      .values({
        sessionId: sub.sessionId,
        userId: sub.userId,
        status: "absent",
        source: "admin",
        checkedAt: ctx.now,
      })
      .onConflictDoUpdate({
        target: [attendanceRecords.sessionId, attendanceRecords.userId],
        set: { status: "absent", source: "admin", checkedAt: ctx.now },
      });
    return { ok: true };
  },

  /**
   * ZIP 다운로드용 제출 파일 소스 (학생별/수업별 폴더 조립은 라우트에서)
   */
  async getZipSources(ctx: AppContext, assignmentId: string): Promise<SubstituteZipSourceRow[]> {
    const rows = await ctx.db
      .select({
        userName: users.name,
        sessionDate: attendanceSessions.sessionDate,
        filename: substituteFiles.filename,
        r2Key: substituteFiles.r2Key,
        size: substituteFiles.size,
      })
      .from(substituteSubmissions)
      .innerJoin(users, eq(substituteSubmissions.userId, users.id))
      .innerJoin(attendanceSessions, eq(substituteSubmissions.sessionId, attendanceSessions.id))
      .innerJoin(substituteFiles, eq(substituteFiles.submissionId, substituteSubmissions.id))
      .where(eq(substituteSubmissions.assignmentId, assignmentId));

    return rows.map((r) => ({
      userName: r.userName,
      dateLabel: ymdLabel(r.sessionDate),
      filename: r.filename,
      r2Key: r.r2Key,
      size: r.size,
    }));
  },
};
