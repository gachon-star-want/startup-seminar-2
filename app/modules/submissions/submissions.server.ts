import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  assignments,
  submissionFiles,
  submissions,
  teamMembers,
  teams,
  users,
} from "~/db/schema";
import { MAX_FILE_MB, MAX_FILES_PER_SUBMISSION } from "~/lib/constants";
import type { AppContext } from "~/lib/context.server";
import { inferMimeType } from "~/lib/mime";
import {
  buildFileStreamResponse,
  buildSubmissionR2Key,
  uploadStreamToR2,
} from "./storage";
import type {
  AdminAssignmentListItem,
  AdminAssignmentOverview,
  AdminPresentOverview,
  PresentSubmissionItem,
  StudentAssignmentView,
} from "./types";

function toKstDatetimeLocal(d: Date): string {
  const kstMs = d.getTime() + 9 * 60 * 60 * 1000;
  return new Date(kstMs).toISOString().slice(0, 16);
}

/**
 * SubmissionHub Deep Module
 * 과제 생성/수정/삭제, 학생 제출 및 R2 스트리밍, 권한 검증, 관리자 발표 뷰를 캡슐화합니다.
 */
export const SubmissionHub = {
  /**
   * 학생의 과제 상세 및 제출 상태를 조회합니다.
   */
  async getStudentAssignment(
    ctx: AppContext,
    assignmentId: string
  ): Promise<StudentAssignmentView> {
    const [[assignment], [membership]] = await Promise.all([
      ctx.db
        .select()
        .from(assignments)
        .where(eq(assignments.id, assignmentId))
        .limit(1),
      ctx.db
        .select({ teamId: teamMembers.teamId, teamName: teams.name })
        .from(teamMembers)
        .innerJoin(teams, eq(teamMembers.teamId, teams.id))
        .where(eq(teamMembers.userId, ctx.user.id))
        .limit(1),
    ]);

    if (!assignment) {
      throw new Response("과제를 찾을 수 없어요", { status: 404 });
    }

    const closed = assignment.dueAt < ctx.now;
    const isTeam = assignment.unit === "team";

    if (isTeam && !membership) {
      return {
        assignment: { ...assignment, dueAt: assignment.dueAt.toISOString() },
        closed,
        myTeam: null,
        submission: null,
      };
    }

    const conditions = [eq(submissions.assignmentId, assignment.id)];
    if (isTeam && membership) conditions.push(eq(submissions.teamId, membership.teamId));
    else conditions.push(eq(submissions.userId, ctx.user.id));

    const [submission] = await ctx.db
      .select()
      .from(submissions)
      .where(and(...conditions))
      .limit(1);

    const files = submission
      ? await ctx.db
          .select()
          .from(submissionFiles)
          .where(eq(submissionFiles.submissionId, submission.id))
      : [];

    return {
      assignment: { ...assignment, dueAt: assignment.dueAt.toISOString() },
      closed,
      myTeam: isTeam ? membership : null,
      submission: submission
        ? {
            id: submission.id,
            content: submission.content,
            link: submission.link,
            updatedAt: submission.updatedAt.toISOString(),
            files: files.map((f) => ({
              id: f.id,
              filename: f.filename,
              size: f.size,
            })),
          }
        : null,
    };
  },

  /**
   * 과제 제출 및 수정 (다중 파일 Zero-Heap R2 스트리밍 및 동시 삭제/추가 지원)
   */
  async saveSubmission(
    ctx: AppContext,
    assignmentId: string,
    form: FormData
  ): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
    const [assignment] = await ctx.db
      .select()
      .from(assignments)
      .where(eq(assignments.id, assignmentId))
      .limit(1);

    if (!assignment) {
      throw new Response("과제를 찾을 수 없어요", { status: 404 });
    }

    const [membership] = await ctx.db
      .select({ teamId: teamMembers.teamId })
      .from(teamMembers)
      .where(eq(teamMembers.userId, ctx.user.id))
      .limit(1);

    const isTeam = assignment.unit === "team";
    if (isTeam && !membership) {
      return { ok: false, message: "팀 과제예요. 먼저 팀에 합류해 주세요." };
    }

    const findConditions = [eq(submissions.assignmentId, assignment.id)];
    if (isTeam && membership) findConditions.push(eq(submissions.teamId, membership.teamId));
    else findConditions.push(eq(submissions.userId, ctx.user.id));

    const [existing] = await ctx.db
      .select()
      .from(submissions)
      .where(and(...findConditions))
      .limit(1);

    if (assignment.dueAt < ctx.now) {
      return { ok: false, message: "마감된 과제예요. 수정할 수 없어요." };
    }

    const content = String(form.get("content") ?? "").trim();
    const link = String(form.get("link") ?? "").trim();
    const deleteFileIds = form.getAll("deleteFileIds").map(String);
    const newFiles = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);

    const existingFiles = existing
      ? await ctx.db.select().from(submissionFiles).where(eq(submissionFiles.submissionId, existing.id))
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
    if (deleteFileIds.length > 0 && existing) {
      for (const f of existingFiles) {
        if (deleteSet.has(f.id)) {
          await ctx.db.delete(submissionFiles).where(eq(submissionFiles.id, f.id));
          if (ctx.executionCtx) {
            ctx.executionCtx.waitUntil(ctx.env.FILES.delete(f.r2Key));
          } else {
            try {
              await ctx.env.FILES.delete(f.r2Key);
            } catch {}
          }
        }
      }
    }

    // 2. 제출 레코드 생성 또는 수정
    let submissionId: string;
    if (existing) {
      await ctx.db
        .update(submissions)
        .set({ content: content || null, link: link || null, updatedAt: ctx.now })
        .where(eq(submissions.id, existing.id));
      submissionId = existing.id;
    } else {
      const [created] = await ctx.db
        .insert(submissions)
        .values({
          assignmentId: assignment.id,
          userId: ctx.user.id,
          teamId: isTeam && membership ? membership.teamId : null,
          content: content || null,
          link: link || null,
        })
        .returning();
      submissionId = created.id;
    }

    // 3. 새 파일 R2 Zero-Heap 스트리밍 업로드 및 DB 등록
    const ownerKey = isTeam && membership ? membership.teamId : ctx.user.id;
    for (const file of newFiles) {
      const mime = inferMimeType(file.name, file.type);
      const key = buildSubmissionR2Key(assignment.id, ownerKey, file.name);

      await uploadStreamToR2(ctx.env.FILES, key, file, mime);

      await ctx.db.insert(submissionFiles).values({
        submissionId,
        filename: file.name,
        r2Key: key,
        size: file.size,
        mime,
      });
    }

    return {
      ok: true,
      message: existing ? "과제가 성공적으로 수정되었어요!" : "과제가 성공적으로 제출되었어요!",
    };
  },

  /**
   * 개별 파일 즉시 삭제
   */
  async deleteSubmissionFile(
    ctx: AppContext,
    assignmentId: string,
    fileId: string
  ): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
    const [assignment] = await ctx.db
      .select()
      .from(assignments)
      .where(eq(assignments.id, assignmentId))
      .limit(1);
    if (!assignment) throw new Response("과제를 찾을 수 없어요", { status: 404 });

    if (assignment.dueAt < ctx.now) {
      return { ok: false, message: "마감된 과제예요. 수정할 수 없어요." };
    }

    const [file] = await ctx.db
      .select({
        id: submissionFiles.id,
        submissionId: submissionFiles.submissionId,
        r2Key: submissionFiles.r2Key,
        userId: submissions.userId,
        teamId: submissions.teamId,
      })
      .from(submissionFiles)
      .innerJoin(submissions, eq(submissionFiles.submissionId, submissions.id))
      .where(eq(submissionFiles.id, fileId))
      .limit(1);

    if (!file) {
      return { ok: false, message: "파일을 찾을 수 없어요." };
    }

    // 권한 검증: 본인 제출이거나 같은 팀 멤버인 경우 허용
    const isAuthor = file.userId === ctx.user.id;
    let isTeamMember = false;
    if (!isAuthor && file.teamId) {
      const [m] = await ctx.db
        .select({ id: teamMembers.id })
        .from(teamMembers)
        .where(and(eq(teamMembers.teamId, file.teamId), eq(teamMembers.userId, ctx.user.id)))
        .limit(1);
      isTeamMember = Boolean(m);
    }

    if (!isAuthor && !isTeamMember && ctx.user.role !== "professor") {
      return { ok: false, message: "파일을 삭제할 권한이 없어요." };
    }

    await ctx.db.delete(submissionFiles).where(eq(submissionFiles.id, fileId));

    if (ctx.executionCtx) {
      ctx.executionCtx.waitUntil(ctx.env.FILES.delete(file.r2Key));
    } else {
      try {
        await ctx.env.FILES.delete(file.r2Key);
      } catch {}
    }

    return { ok: true, message: "파일이 삭제되었어요." };
  },

  /**
   * 단일 파일 스트리밍 서빙 (권한 검증, RFC 5987 헤더 인코딩 캡슐화)
   */
  async serveFile(
    ctx: AppContext,
    fileId: string,
    options: { inline?: boolean } = {}
  ): Promise<Response> {
    const [file] = await ctx.db
      .select({
        id: submissionFiles.id,
        submissionId: submissionFiles.submissionId,
        filename: submissionFiles.filename,
        r2Key: submissionFiles.r2Key,
        mime: submissionFiles.mime,
        userId: submissions.userId,
        teamId: submissions.teamId,
      })
      .from(submissionFiles)
      .innerJoin(submissions, eq(submissionFiles.submissionId, submissions.id))
      .where(eq(submissionFiles.id, fileId))
      .limit(1);

    if (!file) throw new Response("파일을 찾을 수 없어요", { status: 404 });

    const isAdmin = ctx.user.role === "professor";
    const isAuthor = file.userId === ctx.user.id;

    let isTeamMember = false;
    if (!isAdmin && !isAuthor && file.teamId) {
      const [membership] = await ctx.db
        .select({ id: teamMembers.id })
        .from(teamMembers)
        .where(and(eq(teamMembers.teamId, file.teamId), eq(teamMembers.userId, ctx.user.id)))
        .limit(1);
      isTeamMember = Boolean(membership);
    }

    if (!isAdmin && !isAuthor && !isTeamMember) {
      throw new Response("파일에 접근할 권한이 없어요", { status: 403 });
    }

    const object = await ctx.env.FILES.get(file.r2Key);
    if (!object) {
      throw new Response("저장된 파일이 없어요 (스토리지에서 삭제되었을 수 있어요)", { status: 404 });
    }

    return buildFileStreamResponse(file.filename, file.mime, object.body, options.inline);
  },

  /**
   * 관리자 과제 상세 뷰 (제출 목록과 미제출 대상 집계)
   */
  async getAdminOverview(
    ctx: AppContext,
    assignmentId: string
  ): Promise<AdminAssignmentOverview> {
    const [assignment] = await ctx.db
      .select()
      .from(assignments)
      .where(eq(assignments.id, assignmentId))
      .limit(1);

    if (!assignment) throw new Response("과제를 찾을 수 없어요", { status: 404 });

    const [rows, targetList] = await Promise.all([
      ctx.db
        .select({
          submission: submissions,
          userName: users.name,
          teamName: teams.name,
        })
        .from(submissions)
        .innerJoin(users, eq(submissions.userId, users.id))
        .leftJoin(teams, eq(submissions.teamId, teams.id))
        .where(eq(submissions.assignmentId, assignment.id)),
      assignment.unit === "team"
        ? ctx.db.select({ id: teams.id, name: teams.name }).from(teams)
        : ctx.db.select({ id: users.id, name: users.name }).from(users),
    ]);

    const subIds = rows.map((r) => r.submission.id);
    const files =
      subIds.length > 0
        ? await ctx.db.select().from(submissionFiles).where(inArray(submissionFiles.submissionId, subIds))
        : [];

    const filesBySubmission = new Map<string, typeof files>();
    for (const f of files) {
      const list = filesBySubmission.get(f.submissionId) ?? [];
      list.push(f);
      filesBySubmission.set(f.submissionId, list);
    }

    let missing: { label: string }[] = [];
    if (assignment.unit === "team") {
      const submittedTeamIds = new Set(rows.map((r) => r.submission.teamId).filter(Boolean));
      missing = (targetList as { id: string; name: string }[])
        .filter((t) => !submittedTeamIds.has(t.id))
        .map((t) => ({ label: `${t.name} 팀` }));
    } else {
      const submittedUserIds = new Set(rows.map((r) => r.submission.userId));
      missing = (targetList as { id: string; name: string }[])
        .filter((u) => !submittedUserIds.has(u.id))
        .map((u) => ({ label: u.name }));
    }

    return {
      assignment: {
        id: assignment.id,
        title: assignment.title,
        description: assignment.description,
        unit: assignment.unit,
        dueAt: assignment.dueAt.toISOString(),
        dueAtLocal: toKstDatetimeLocal(assignment.dueAt),
      },
      submissions: rows
        .map((r) => ({
          id: r.submission.id,
          content: r.submission.content,
          link: r.submission.link,
          userName: r.userName,
          teamName: r.teamName,
          updatedAt: r.submission.updatedAt.toISOString(),
          files: (filesBySubmission.get(r.submission.id) ?? []).map((f) => ({
            id: f.id,
            filename: f.filename,
            size: f.size,
          })),
        }))
        .sort((a, b) => (a.teamName ?? a.userName).localeCompare(b.teamName ?? b.userName, "ko")),
      missing,
    };
  },

  /**
   * 관리자 발표 모드 뷰 (PDF/PPTX 프리뷰 전용 프로젝션)
   */
  async getAdminPresentOverview(
    ctx: AppContext,
    assignmentId: string
  ): Promise<AdminPresentOverview> {
    const [assignment] = await ctx.db
      .select()
      .from(assignments)
      .where(eq(assignments.id, assignmentId))
      .limit(1);

    if (!assignment) throw new Response("과제를 찾을 수 없어요", { status: 404 });

    const rows = await ctx.db
      .select({ submission: submissions, userName: users.name, teamName: teams.name })
      .from(submissions)
      .innerJoin(users, eq(submissions.userId, users.id))
      .leftJoin(teams, eq(submissions.teamId, teams.id))
      .where(eq(submissions.assignmentId, assignment.id));

    const subIds = rows.map((r) => r.submission.id);
    const files =
      subIds.length > 0
        ? await ctx.db.select().from(submissionFiles).where(inArray(submissionFiles.submissionId, subIds))
        : [];

    const filesBySub = new Map<string, typeof files>();
    for (const f of files) {
      const list = filesBySub.get(f.submissionId) ?? [];
      list.push(f);
      filesBySub.set(f.submissionId, list);
    }

    const submissionsList: PresentSubmissionItem[] = rows
      .map((r) => ({
        id: r.submission.id,
        sortKey: (assignment.unit === "team" ? r.teamName : r.userName) ?? r.userName,
        label: assignment.unit === "team" ? `${r.teamName ?? "팀명없음"} 팀` : r.userName,
        presenter: r.userName,
        content: r.submission.content,
        link: r.submission.link,
        updatedAt: r.submission.updatedAt.toISOString(),
        files: (filesBySub.get(r.submission.id) ?? []).map((f) => ({
          id: f.id,
          filename: f.filename,
          mime: f.mime,
          size: f.size,
        })),
      }))
      .sort((a, b) => a.sortKey.localeCompare(b.sortKey, "ko"));

    let missing: string[] = [];
    if (assignment.unit === "team") {
      const allTeams = await ctx.db.select({ id: teams.id, name: teams.name }).from(teams);
      const submittedTeamIds = new Set(rows.map((r) => r.submission.teamId).filter(Boolean));
      missing = allTeams.filter((t) => !submittedTeamIds.has(t.id)).map((t) => `${t.name} 팀`);
    } else {
      const allUsers = await ctx.db.select({ id: users.id, name: users.name, role: users.role }).from(users);
      const submittedUserIds = new Set(rows.map((r) => r.submission.userId));
      missing = allUsers
        .filter((u) => u.role !== "professor" && !submittedUserIds.has(u.id))
        .map((u) => u.name);
    }
    missing.sort((a, b) => a.localeCompare(b, "ko"));

    return {
      assignment: {
        id: assignment.id,
        title: assignment.title,
        description: assignment.description,
        unit: assignment.unit,
        dueAt: assignment.dueAt.toISOString(),
      },
      submissions: submissionsList,
      missing,
    };
  },

  /**
   * 관리자 과제 목록 및 각 과제별 제출 수 조회
   */
  async getAdminList(ctx: AppContext): Promise<AdminAssignmentListItem[]> {
    const [list, counts] = await Promise.all([
      ctx.db.select().from(assignments).orderBy(desc(assignments.dueAt)),
      ctx.db
        .select({ assignmentId: submissions.assignmentId, count: sql<number>`count(*)` })
        .from(submissions)
        .groupBy(submissions.assignmentId),
    ]);

    const countMap = new Map(counts.map((c) => [c.assignmentId, c.count]));

    return list.map((a) => ({
      id: a.id,
      title: a.title,
      description: a.description,
      dueAt: a.dueAt.toISOString(),
      unit: a.unit,
      submissionCount: countMap.get(a.id) ?? 0,
    }));
  },

  /**
   * 관리자 새 과제 생성
   */
  async createAssignment(
    ctx: AppContext,
    input: { title: string; description?: string; dueAtRaw: string; unit: string }
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    const title = input.title.trim();
    const description = input.description?.trim() || null;
    const dueAtRaw = input.dueAtRaw.trim();
    const unit = input.unit;

    if (!title) return { ok: false, message: "과제 제목을 입력해 주세요." };
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(dueAtRaw)) {
      return { ok: false, message: "마감일시를 입력해 주세요." };
    }
    const dueAt = new Date(`${dueAtRaw}:00+09:00`);
    if (Number.isNaN(dueAt.getTime())) return { ok: false, message: "마감일시가 올바르지 않아요." };
    if (!["team", "individual"].includes(unit)) return { ok: false, message: "제출 단위가 올바르지 않아요." };

    await ctx.db.insert(assignments).values({
      title,
      description,
      dueAt,
      unit,
    });

    return { ok: true };
  },

  /**
   * 관리자 과제 설정 수정
   */
  async updateAssignment(
    ctx: AppContext,
    assignmentId: string,
    input: { title: string; description?: string; dueAtRaw: string; unit: string }
  ): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
    const title = input.title.trim();
    const description = input.description?.trim() || null;
    const dueAtRaw = input.dueAtRaw.trim();
    const unit = input.unit;

    if (!title) return { ok: false, message: "과제 제목을 입력해 주세요." };
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(dueAtRaw)) {
      return { ok: false, message: "마감일시를 입력해 주세요." };
    }
    const dueAt = new Date(`${dueAtRaw}:00+09:00`);
    if (Number.isNaN(dueAt.getTime())) return { ok: false, message: "마감일시가 올바르지 않아요." };
    if (!["team", "individual"].includes(unit)) return { ok: false, message: "제출 단위가 올바르지 않아요." };

    await ctx.db
      .update(assignments)
      .set({
        title,
        description,
        dueAt,
        unit,
      })
      .where(eq(assignments.id, assignmentId));

    return { ok: true, message: "과제 설정이 성공적으로 수정되었어요." };
  },

  /**
   * 관리자 과제 삭제
   */
  async deleteAssignment(ctx: AppContext, assignmentId: string): Promise<{ ok: true }> {
    await ctx.db.delete(assignments).where(eq(assignments.id, assignmentId));
    return { ok: true };
  },
};
