import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  attendanceRecords,
  attendanceSessions,
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
import { isEligibleForSubstitute } from "./types";
import type {
  AdminSubstituteRow,
  MySubstituteItem,
  SubstituteStatus,
  SubstituteZipSourceRow,
} from "./types";

function buildSubstituteR2Key(sessionId: string, userId: string, filename: string): string {
  const safeName = sanitizeFilename(filename);
  const uuid = crypto.randomUUID();
  return `substitutes/${sessionId}/${userId}/${uuid}-${safeName}`;
}

/** 상태 필터 쿼리 값 — "all"이면 전체 */
export type SubstituteReviewFilter = SubstituteStatus | "all";

async function loadFilesBySubmission(
  ctx: AppContext,
  submissionIds: string[]
): Promise<Map<string, { id: string; filename: string; size: number }[]>> {
  const files =
    submissionIds.length > 0
      ? await ctx.db
          .select()
          .from(substituteFiles)
          .where(inArray(substituteFiles.submissionId, submissionIds))
      : [];

  const map = new Map<string, { id: string; filename: string; size: number }[]>();
  for (const f of files) {
    const list = map.get(f.submissionId) ?? [];
    list.push({ id: f.id, filename: f.filename, size: f.size });
    map.set(f.submissionId, list);
  }
  return map;
}

/**
 * SubstituteHub Deep Module
 * 출석 이력의 지각/결석 날짜에 학생이 직접 제출하는 대체 과제(보고서)와
 * 승인/반려에 따른 출석 기록(substituted) 연동을 캡슐화합니다.
 */
export const SubstituteHub = {
  /**
   * 학생 뷰 — 내 제출물 목록 (출석 이력 행과 sessionId로 매칭)
   */
  async listMySubmissions(ctx: AppContext): Promise<MySubstituteItem[]> {
    const rows = await ctx.db
      .select({
        sub: substituteSubmissions,
        sessionDate: attendanceSessions.sessionDate,
      })
      .from(substituteSubmissions)
      .innerJoin(attendanceSessions, eq(substituteSubmissions.sessionId, attendanceSessions.id))
      .where(eq(substituteSubmissions.userId, ctx.user.id));

    const filesBySub = await loadFilesBySubmission(
      ctx,
      rows.map((r) => r.sub.id)
    );

    return rows
      .map((r) => ({
        id: r.sub.id,
        sessionId: r.sub.sessionId,
        dateLabel: ymdLabel(r.sessionDate),
        content: r.sub.content,
        link: r.sub.link,
        status: r.sub.status as SubstituteStatus,
        reviewNote: r.sub.reviewNote,
        submittedAt: r.sub.submittedAt.toISOString(),
        files: filesBySub.get(r.sub.id) ?? [],
      }))
      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
  },

  /**
   * 보고서 제출/수정 — 지각/결석 날짜 자격 검증 후 파일 Zero-Heap R2 스트리밍.
   * (학생, 출석 날짜)당 1건, 재제출 시 심사 상태를 대기중(pending)으로 되돌린다.
   */
  async submit(
    ctx: AppContext,
    form: FormData
  ): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
    const sessionId = String(form.get("sessionId") ?? "");

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
      return { ok: false, message: "지각하거나 결석한 수업만 대체 과제로 만회할 수 있어요." };
    }

    const [existing] = await ctx.db
      .select({ id: substituteSubmissions.id, status: substituteSubmissions.status })
      .from(substituteSubmissions)
      .where(
        and(
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
      const key = buildSubstituteR2Key(sessionId, ctx.user.id, file.name);

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
   * 관리자 검토함 — 전체 제출물 최신순 (학생, 대상 수업, 현재 출석 상태, 파일 포함)
   */
  async listForAdminReview(
    ctx: AppContext,
    filter: SubstituteReviewFilter
  ): Promise<AdminSubstituteRow[]> {
    const base = ctx.db
      .select({
        sub: substituteSubmissions,
        userName: users.name,
        sessionDate: attendanceSessions.sessionDate,
        attendanceStatus: attendanceRecords.status,
      })
      .from(substituteSubmissions)
      .innerJoin(users, eq(substituteSubmissions.userId, users.id))
      .innerJoin(attendanceSessions, eq(substituteSubmissions.sessionId, attendanceSessions.id))
      .leftJoin(
        attendanceRecords,
        and(
          eq(attendanceRecords.sessionId, substituteSubmissions.sessionId),
          eq(attendanceRecords.userId, substituteSubmissions.userId)
        )
      )
      .$dynamic();

    const rows = await (filter === "all" ? base : base.where(eq(substituteSubmissions.status, filter)))
      .orderBy(desc(substituteSubmissions.submittedAt));

    const filesBySub = await loadFilesBySubmission(ctx, rows.map((r) => r.sub.id));

    return rows.map((r) => ({
      id: r.sub.id,
      userId: r.sub.userId,
      userName: r.userName,
      sessionId: r.sub.sessionId,
      dateLabel: ymdLabel(r.sessionDate),
      attendanceStatus: r.attendanceStatus,
      content: r.sub.content,
      link: r.sub.link,
      status: r.sub.status as SubstituteStatus,
      reviewNote: r.sub.reviewNote,
      submittedAt: r.sub.submittedAt.toISOString(),
      files: filesBySub.get(r.sub.id) ?? [],
    }));
  },

  /** 검토함 상태별 건수 (필터 탭 표시용) */
  async countByStatus(ctx: AppContext): Promise<Record<SubstituteStatus | "all", number>> {
    const rows = await ctx.db
      .select({ status: substituteSubmissions.status, count: sql<number>`count(*)` })
      .from(substituteSubmissions)
      .groupBy(substituteSubmissions.status);

    const counts: Record<SubstituteStatus | "all", number> = {
      all: 0,
      pending: 0,
      approved: 0,
      rejected: 0,
    };
    for (const r of rows) {
      const n = Number(r.count);
      counts[r.status as SubstituteStatus] = n;
      counts.all += n;
    }
    return counts;
  },

  /**
   * 심사 — 승인 시 출석 기록을 substituted로 바꾸고 직전 상태를 approvedFrom에 스냅샷.
   * 반려/취소 시 approvedFrom 기준으로 출석 기록을 원상복구한다 (지각이었으면 late로).
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

    const restoreAttendance = async () => {
      const restoreStatus = sub.approvedFrom ?? "absent";
      await ctx.db
        .insert(attendanceRecords)
        .values({
          sessionId: sub.sessionId,
          userId: sub.userId,
          status: restoreStatus,
          source: "admin",
          checkedAt: ctx.now,
        })
        .onConflictDoUpdate({
          target: [attendanceRecords.sessionId, attendanceRecords.userId],
          set: { status: restoreStatus, source: "admin", checkedAt: ctx.now },
        });
    };

    if (action === "approve") {
      const [current] = await ctx.db
        .select({ status: attendanceRecords.status })
        .from(attendanceRecords)
        .where(
          and(
            eq(attendanceRecords.sessionId, sub.sessionId),
            eq(attendanceRecords.userId, sub.userId)
          )
        )
        .limit(1);
      const approvedFrom =
        current?.status === "late" || current?.status === "present" ? current.status : "absent";

      await ctx.db
        .update(substituteSubmissions)
        .set({
          status: "approved",
          approvedFrom,
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
      // 이미 승인됐던 제출물을 반려하면 출석 기록도 원상복구한다
      if (sub.status === "approved") {
        await restoreAttendance();
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
    await restoreAttendance();
    return { ok: true };
  },

  /**
   * ZIP 다운로드용 제출 파일 소스 (학생별/수업별 폴더 조립은 라우트에서)
   */
  async getZipSources(
    ctx: AppContext,
    filter: SubstituteReviewFilter
  ): Promise<SubstituteZipSourceRow[]> {
    const base = ctx.db
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
      .$dynamic();

    const rows = await (filter === "all"
      ? base
      : base.where(eq(substituteSubmissions.status, filter)));

    return rows.map((r) => ({
      userName: r.userName,
      dateLabel: ymdLabel(r.sessionDate),
      filename: r.filename,
      r2Key: r.r2Key,
      size: r.size,
    }));
  },
};
