import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  assignments,
  presentationEvaluations,
  presentationMemberEvaluations,
  presentationSessions,
  submissionFiles,
  submissions,
  teamMembers,
  teams,
  users,
} from "~/db/schema";
import { MAX_EVAL_COMMENT_BYTES } from "~/lib/constants";
import type { AppContext } from "~/lib/context.server";
import { sanitizeFilename } from "~/modules/submissions/storage";
import { buildXlsx } from "~/lib/xlsx";
import {
  phaseOf,
  type AdminSessionDetail,
  type AdminSessionListItem,
  type EvaluationResultRow,
  type StudentSessionListItem,
  type StudentSessionView,
} from "./types";

function toKstDatetimeLocal(d: Date): string {
  const kstMs = d.getTime() + 9 * 60 * 60 * 1000;
  return new Date(kstMs).toISOString().slice(0, 16);
}

const textEncoder = new TextEncoder();

/** 코멘트를 300바이트로 제한 — 초과분은 잘라내지 않고 거절한다 */
function validateComment(raw: string): { ok: true; value: string | null } | { ok: false } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, value: null };
  if (textEncoder.encode(trimmed).length > MAX_EVAL_COMMENT_BYTES) return { ok: false };
  return { ok: true, value: trimmed };
}

export type SessionInput = {
  sessionDate: string;
  title: string;
  description?: string;
  assignmentId?: string;
  opensAtRaw: string;
  closesAtRaw: string;
};

/**
 * EvaluationHub Deep Module
 * 발표 평가 세션 관리, 학생의 팀·팀원 평가 저장/조회, 관리자 통계 및 XLSX 결과 생성을 캡슐화합니다.
 */
export const EvaluationHub = {
  /** 별점 0.5~5.0 파싱 (0.5 단위 — form 값은 "0.5"~"5" 문자열) */
  parseStar(form: FormData, field: string): { ok: true; star: number } | { ok: false; message: string } {
    const raw = Number(form.get(field));
    if (!Number.isFinite(raw) || raw < 0.5 || raw > 5 || !Number.isInteger(raw * 2)) {
      return { ok: false, message: "별점을 0.5점 단위로 선택해 주세요." };
    }
    return { ok: true, star: raw };
  },

  /**
   * 학생 발표 평가 목록 (세션별 진행상황 집계)
   * targetCount는 모든 팀(제출물), myCount는 내가 팀 단위 평가를 끝낸 수.
   */
  async listSessionsForStudent(ctx: AppContext): Promise<{ sessions: StudentSessionListItem[] }> {
    const [rows, myEvalCounts] = await Promise.all([
      ctx.db
        .select({
          session: presentationSessions,
          assignmentTitle: assignments.title,
        })
        .from(presentationSessions)
        .leftJoin(assignments, eq(presentationSessions.assignmentId, assignments.id))
        .orderBy(desc(presentationSessions.sessionDate), desc(presentationSessions.createdAt)),
      ctx.db
        .select({ sessionId: presentationEvaluations.sessionId, count: sql<number>`count(*)` })
        .from(presentationEvaluations)
        .where(eq(presentationEvaluations.evaluatorId, ctx.user.id))
        .groupBy(presentationEvaluations.sessionId),
    ]);

    const assignmentIds = [
      ...new Set(rows.map((r) => r.session.assignmentId).filter((id): id is string => Boolean(id))),
    ];
    const targetCounts = assignmentIds.length
      ? await ctx.db
          .select({ assignmentId: submissions.assignmentId, count: sql<number>`count(*)` })
          .from(submissions)
          .where(inArray(submissions.assignmentId, assignmentIds))
          .groupBy(submissions.assignmentId)
      : [];

    const targetMap = new Map(targetCounts.map((t) => [t.assignmentId, t.count]));
    const myMap = new Map(myEvalCounts.map((m) => [m.sessionId, m.count]));

    return {
      sessions: rows.map((r) => ({
        id: r.session.id,
        sessionDate: r.session.sessionDate,
        title: r.session.title,
        description: r.session.description,
        assignmentId: r.session.assignmentId,
        assignmentTitle: r.assignmentTitle,
        opensAt: r.session.opensAt.toISOString(),
        closesAt: r.session.closesAt.toISOString(),
        phase: phaseOf(r.session.opensAt, r.session.closesAt, ctx.now),
        targetCount: r.session.assignmentId ? (targetMap.get(r.session.assignmentId) ?? 0) : 0,
        myCount: myMap.get(r.session.id) ?? 0,
      })),
    };
  },

  /**
   * 세션 생성 폼의 평가 대상 과제 선택지
   */
  async listAssignmentOptions(ctx: AppContext): Promise<{ id: string; title: string; dueAt: string }[]> {
    const rows = await ctx.db
      .select({ id: assignments.id, title: assignments.title, dueAt: assignments.dueAt })
      .from(assignments)
      .orderBy(desc(assignments.dueAt));
    return rows.map((r) => ({ id: r.id, title: r.title, dueAt: r.dueAt.toISOString() }));
  },

  /**
   * 학생 세션 평가 화면: 모든 팀 발표 목록 + 팀원 명단 + 내 이전 평가.
   * 우리 팀도 평가 대상에 포함된다.
   */
  async getSessionForStudent(ctx: AppContext, sessionId: string): Promise<StudentSessionView> {
    const [session] = await ctx.db
      .select()
      .from(presentationSessions)
      .where(eq(presentationSessions.id, sessionId))
      .limit(1);
    if (!session) throw new Response("발표 세션을 찾을 수 없어요", { status: 404 });

    const phase = phaseOf(session.opensAt, session.closesAt, ctx.now);

    const submissionRows = session.assignmentId
      ? await ctx.db
          .select({ submission: submissions, userName: users.name, teamName: teams.name })
          .from(submissions)
          .innerJoin(users, eq(submissions.userId, users.id))
          .leftJoin(teams, eq(submissions.teamId, teams.id))
          .where(eq(submissions.assignmentId, session.assignmentId))
      : [];

    const targets = submissionRows
      .map((r) => ({
        submissionId: r.submission.id,
        label: r.teamName ? `${r.teamName} 팀` : r.userName,
        presenter: r.userName,
        content: r.submission.content,
        link: r.submission.link,
        teamId: r.submission.teamId,
        files: [] as { id: string; filename: string; size: number }[],
        members: [] as { userId: string; name: string; my: { star: number } | null }[],
        my: null as { star: number; comment: string | null; updatedAt: string } | null,
      }))
      .sort((a, b) => a.label.localeCompare(b.label, "ko"));

    const targetIds = targets.map((t) => t.submissionId);

    // 파일 + 팀원 명단 + 내 평가를 병렬로 일괄 조회
    const [files, memberRows, myEvals, myMemberEvals] = await Promise.all([
      targetIds.length
        ? ctx.db.select().from(submissionFiles).where(inArray(submissionFiles.submissionId, targetIds))
        : Promise.resolve([]),
      (async () => {
        const teamIds = [...new Set(targets.map((t) => t.teamId).filter((id): id is string => Boolean(id)))];
        if (teamIds.length === 0) return [] as { teamId: string; userId: string; name: string }[];
        return ctx.db
          .select({ teamId: teamMembers.teamId, userId: teamMembers.userId, name: users.name })
          .from(teamMembers)
          .innerJoin(users, eq(teamMembers.userId, users.id))
          .where(inArray(teamMembers.teamId, teamIds));
      })(),
      targetIds.length
        ? ctx.db
            .select()
            .from(presentationEvaluations)
            .where(
              and(
                eq(presentationEvaluations.sessionId, sessionId),
                eq(presentationEvaluations.evaluatorId, ctx.user.id)
              )
            )
        : Promise.resolve([]),
      targetIds.length
        ? ctx.db
            .select()
            .from(presentationMemberEvaluations)
            .where(
              and(
                eq(presentationMemberEvaluations.sessionId, sessionId),
                eq(presentationMemberEvaluations.evaluatorId, ctx.user.id)
              )
            )
        : Promise.resolve([]),
    ]);

    const myEvalMap = new Map(myEvals.map((e) => [e.submissionId, e]));
    const myMemberMap = new Map(
      myMemberEvals.map((e) => [`${e.submissionId}:${e.targetUserId}`, e])
    );

    for (const t of targets) {
      t.files = files
        .filter((f) => f.submissionId === t.submissionId)
        .map((f) => ({ id: f.id, filename: f.filename, size: f.size }));
      if (t.teamId) {
        t.members = memberRows
          .filter((m) => m.teamId === t.teamId)
          .map((m) => {
            const prev = myMemberMap.get(`${t.submissionId}:${m.userId}`);
            return {
              userId: m.userId,
              name: m.name,
              my: prev ? { star: prev.starScore } : null,
            };
          })
          .sort((a, b) => a.name.localeCompare(b.name, "ko"));
      }
      const prev = myEvalMap.get(t.submissionId);
      t.my = prev
        ? { star: prev.starScore, comment: prev.comment, updatedAt: prev.updatedAt.toISOString() }
        : null;
    }

    return {
      session: {
        id: session.id,
        sessionDate: session.sessionDate,
        title: session.title,
        description: session.description,
        opensAt: session.opensAt.toISOString(),
        closesAt: session.closesAt.toISOString(),
        phase,
      },
      targets,
    };
  },

  /**
   * 학생 평가 저장/수정 — 팀 단위 별점(필수) + 팀원 개별 별점(선택).
   * 모든 팀이 평가 대상이므로 자기 팀 제외는 없다. 평가 창 안에서만 가능.
   */
  async saveEvaluation(
    ctx: AppContext,
    sessionId: string,
    form: FormData
  ): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
    const [session] = await ctx.db
      .select()
      .from(presentationSessions)
      .where(eq(presentationSessions.id, sessionId))
      .limit(1);
    if (!session) return { ok: false, message: "발표 세션을 찾을 수 없어요." };

    if (ctx.now < session.opensAt || ctx.now > session.closesAt) {
      return { ok: false, message: "지금은 이 세션의 평가 기간이 아니에요." };
    }

    const submissionId = String(form.get("submissionId") ?? "");
    const [submission] = await ctx.db
      .select()
      .from(submissions)
      .where(eq(submissions.id, submissionId))
      .limit(1);
    if (!submission || submission.assignmentId !== session.assignmentId) {
      return { ok: false, message: "이 세션의 평가 대상 발표가 아니에요." };
    }

    // 팀 단위 평가 (필수)
    const teamStar = EvaluationHub.parseStar(form, "teamScore");
    if (!teamStar.ok) return teamStar;
    const teamComment = validateComment(String(form.get("teamComment") ?? ""));
    if (!teamComment.ok) {
      return { ok: false, message: `코멘트는 최대 ${MAX_EVAL_COMMENT_BYTES}바이트까지 쓸 수 있어요.` };
    }

    // 팀원 개별 평가 (선택 — 별점을 고른 멤버만 저장, 코멘트는 없음)
    const memberIds = form.getAll("memberIds").map(String);
    const memberInputs: { userId: string; star: number }[] = [];
    if (memberIds.length > 0) {
      if (submission.teamId) {
        const roster = await ctx.db
          .select({ userId: teamMembers.userId })
          .from(teamMembers)
          .where(eq(teamMembers.teamId, submission.teamId));
        const validIds = new Set(roster.map((r) => r.userId));
        for (const memberId of memberIds) {
          if (!validIds.has(memberId)) continue; // 그 팀 소속이 아닌 유저는 무시
          const star = EvaluationHub.parseStar(form, `memberScore_${memberId}`);
          if (!star.ok) continue; // 별점 미선택 멤버는 건너뜀
          memberInputs.push({ userId: memberId, star: star.star });
        }
      }
    }

    // 팀 단위 평가 upsert
    const [existing] = await ctx.db
      .select({ id: presentationEvaluations.id })
      .from(presentationEvaluations)
      .where(
        and(
          eq(presentationEvaluations.sessionId, sessionId),
          eq(presentationEvaluations.submissionId, submissionId),
          eq(presentationEvaluations.evaluatorId, ctx.user.id)
        )
      )
      .limit(1);

    if (existing) {
      await ctx.db
        .update(presentationEvaluations)
        .set({ starScore: teamStar.star, comment: teamComment.value, updatedAt: ctx.now })
        .where(eq(presentationEvaluations.id, existing.id));
    } else {
      await ctx.db.insert(presentationEvaluations).values({
        sessionId,
        submissionId,
        evaluatorId: ctx.user.id,
        starScore: teamStar.star,
        comment: teamComment.value,
      });
    }

    // 팀원 개별 평가 upsert (별점만)
    for (const m of memberInputs) {
      const [prev] = await ctx.db
        .select({ id: presentationMemberEvaluations.id })
        .from(presentationMemberEvaluations)
        .where(
          and(
            eq(presentationMemberEvaluations.sessionId, sessionId),
            eq(presentationMemberEvaluations.submissionId, submissionId),
            eq(presentationMemberEvaluations.evaluatorId, ctx.user.id),
            eq(presentationMemberEvaluations.targetUserId, m.userId)
          )
        )
        .limit(1);

      if (prev) {
        await ctx.db
          .update(presentationMemberEvaluations)
          .set({ starScore: m.star, updatedAt: ctx.now })
          .where(eq(presentationMemberEvaluations.id, prev.id));
      } else {
        await ctx.db.insert(presentationMemberEvaluations).values({
          sessionId,
          submissionId,
          evaluatorId: ctx.user.id,
          targetUserId: m.userId,
          starScore: m.star,
        });
      }
    }

    return { ok: true, message: "평가가 저장되었어요!" };
  },

  /**
   * 관리자 세션 목록 + 집계
   */
  async listSessionsForAdmin(ctx: AppContext): Promise<{ sessions: AdminSessionListItem[] }> {
    const [rows, evalStats] = await Promise.all([
      ctx.db
        .select({ session: presentationSessions, assignmentTitle: assignments.title })
        .from(presentationSessions)
        .leftJoin(assignments, eq(presentationSessions.assignmentId, assignments.id))
        .orderBy(desc(presentationSessions.sessionDate), desc(presentationSessions.createdAt)),
      ctx.db
        .select({
          sessionId: presentationEvaluations.sessionId,
          count: sql<number>`count(*)`,
          evaluators: sql<number>`count(distinct ${presentationEvaluations.evaluatorId})`,
        })
        .from(presentationEvaluations)
        .groupBy(presentationEvaluations.sessionId),
    ]);

    const assignmentIds = [
      ...new Set(rows.map((r) => r.session.assignmentId).filter((id): id is string => Boolean(id))),
    ];
    const targetCounts = assignmentIds.length
      ? await ctx.db
          .select({ assignmentId: submissions.assignmentId, count: sql<number>`count(*)` })
          .from(submissions)
          .where(inArray(submissions.assignmentId, assignmentIds))
          .groupBy(submissions.assignmentId)
      : [];

    const targetMap = new Map(targetCounts.map((t) => [t.assignmentId, t.count]));
    const evalMap = new Map(evalStats.map((e) => [e.sessionId, e]));

    return {
      sessions: rows.map((r) => {
        const stats = evalMap.get(r.session.id);
        return {
          id: r.session.id,
          sessionDate: r.session.sessionDate,
          title: r.session.title,
          description: r.session.description,
          assignmentId: r.session.assignmentId,
          assignmentTitle: r.assignmentTitle,
          opensAt: r.session.opensAt.toISOString(),
          closesAt: r.session.closesAt.toISOString(),
          phase: phaseOf(r.session.opensAt, r.session.closesAt, ctx.now),
          targetCount: r.session.assignmentId ? (targetMap.get(r.session.assignmentId) ?? 0) : 0,
          evaluationCount: stats?.count ?? 0,
          evaluatorCount: stats?.evaluators ?? 0,
        };
      }),
    };
  },

  /** 세션 생성·수정 공통 검증 */
  parseSessionInput(input: SessionInput): { ok: true } | { ok: false; message: string } {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.sessionDate.trim())) {
      return { ok: false, message: "발표 날짜를 입력해 주세요." };
    }
    if (!input.title.trim()) {
      return { ok: false, message: "발표 제목을 입력해 주세요." };
    }
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(input.opensAtRaw.trim())) {
      return { ok: false, message: "평가 시작 시각을 입력해 주세요." };
    }
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(input.closesAtRaw.trim())) {
      return { ok: false, message: "평가 마감 시각을 입력해 주세요." };
    }
    const opensAt = new Date(`${input.opensAtRaw.trim()}:00+09:00`);
    const closesAt = new Date(`${input.closesAtRaw.trim()}:00+09:00`);
    if (Number.isNaN(opensAt.getTime()) || Number.isNaN(closesAt.getTime())) {
      return { ok: false, message: "평가 시간이 올바르지 않아요." };
    }
    if (opensAt >= closesAt) {
      return { ok: false, message: "평가 마감 시각은 시작 시각보다 뒤여야 해요." };
    }
    return { ok: true };
  },

  buildSessionValues(input: SessionInput) {
    return {
      sessionDate: input.sessionDate.trim(),
      title: input.title.trim(),
      description: input.description?.trim() || null,
      assignmentId: input.assignmentId?.trim() || null,
      opensAt: new Date(`${input.opensAtRaw.trim()}:00+09:00`),
      closesAt: new Date(`${input.closesAtRaw.trim()}:00+09:00`),
    };
  },

  async createSession(
    ctx: AppContext,
    input: SessionInput
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    const valid = EvaluationHub.parseSessionInput(input);
    if (!valid.ok) return valid;
    await ctx.db.insert(presentationSessions).values(EvaluationHub.buildSessionValues(input));
    return { ok: true };
  },

  async updateSession(
    ctx: AppContext,
    sessionId: string,
    input: SessionInput
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    const valid = EvaluationHub.parseSessionInput(input);
    if (!valid.ok) return valid;
    await ctx.db
      .update(presentationSessions)
      .set(EvaluationHub.buildSessionValues(input))
      .where(eq(presentationSessions.id, sessionId));
    return { ok: true };
  },

  async deleteSession(ctx: AppContext, sessionId: string): Promise<void> {
    await ctx.db.delete(presentationSessions).where(eq(presentationSessions.id, sessionId));
  },

  /**
   * 관리자 세션 상세: 팀별·팀원별 평균 별점, 평가자별 진행률, XLSX 원본 행
   */
  async getSessionAdminDetail(ctx: AppContext, sessionId: string): Promise<AdminSessionDetail> {
    const [session] = await ctx.db
      .select({ session: presentationSessions, assignmentTitle: assignments.title })
      .from(presentationSessions)
      .leftJoin(assignments, eq(presentationSessions.assignmentId, assignments.id))
      .where(eq(presentationSessions.id, sessionId))
      .limit(1);
    if (!session) throw new Response("발표 세션을 찾을 수 없어요", { status: 404 });

    const submissionRows = session.session.assignmentId
      ? await ctx.db
          .select({ submission: submissions, userName: users.name, teamName: teams.name })
          .from(submissions)
          .innerJoin(users, eq(submissions.userId, users.id))
          .leftJoin(teams, eq(submissions.teamId, teams.id))
          .where(eq(submissions.assignmentId, session.session.assignmentId))
      : [];

    const [teamEvalRows, memberEvalRows] = await Promise.all([
      ctx.db
        .select({ evaluation: presentationEvaluations, evaluatorName: users.name })
        .from(presentationEvaluations)
        .innerJoin(users, eq(presentationEvaluations.evaluatorId, users.id))
        .where(eq(presentationEvaluations.sessionId, sessionId)),
      ctx.db
        .select({ evaluation: presentationMemberEvaluations, evaluatorName: users.name })
        .from(presentationMemberEvaluations)
        .innerJoin(users, eq(presentationMemberEvaluations.evaluatorId, users.id))
        .where(eq(presentationMemberEvaluations.sessionId, sessionId)),
    ]);

    const labelOf = (r: { teamName: string | null; userName: string }) =>
      r.teamName ? `${r.teamName} 팀` : r.userName;

    const targets = submissionRows
      .map((r) => {
        const evals = teamEvalRows.filter((e) => e.evaluation.submissionId === r.submission.id);
        const n = evals.length;
        return {
          submissionId: r.submission.id,
          label: labelOf(r),
          presenter: r.userName,
          evaluatorCount: n,
          avgStar: n > 0 ? Math.round((evals.reduce((s, e) => s + e.evaluation.starScore, 0) / n) * 10) / 10 : 0,
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label, "ko"));

    const targetById = new Map(targets.map((t) => [t.submissionId, t]));

    // 팀원별 집계 — targetUserId의 이름은 users에서 보장되지만 표시용으로 한 번 조회
    const memberUserIds = [...new Set(memberEvalRows.map((e) => e.evaluation.targetUserId))];
    const memberNames = memberUserIds.length
      ? await ctx.db
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(inArray(users.id, memberUserIds))
      : [];
    const memberNameMap = new Map(memberNames.map((m) => [m.id, m.name]));

    const memberStats = [...new Set(memberEvalRows.map((e) => e.evaluation.submissionId))]
      .map((submissionId) => {
        const target = targetById.get(submissionId);
        const byUser = new Map<string, { stars: number[]; name: string }>();
        for (const e of memberEvalRows.filter((x) => x.evaluation.submissionId === submissionId)) {
          const entry = byUser.get(e.evaluation.targetUserId) ?? { stars: [], name: memberNameMap.get(e.evaluation.targetUserId) ?? "알 수 없음" };
          entry.stars.push(e.evaluation.starScore);
          byUser.set(e.evaluation.targetUserId, entry);
        }
        return {
          teamLabel: target?.label ?? "알 수 없음",
          members: [...byUser.entries()].map(([userId, { stars, name }]) => ({
            userId,
            name,
            evaluatorCount: stars.length,
            avgStar: Math.round((stars.reduce((s, n) => s + n, 0) / stars.length) * 10) / 10,
          })),
        };
      })
      .sort((a, b) => a.teamLabel.localeCompare(b.teamLabel, "ko"));

    // 평가자별 완료 수 (팀 단위 기준)
    const evaluatorProgress = new Map<string, number>();
    for (const e of teamEvalRows) {
      evaluatorProgress.set(e.evaluatorName, (evaluatorProgress.get(e.evaluatorName) ?? 0) + 1);
    }

    const rows: EvaluationResultRow[] = [
      ...teamEvalRows.map((e) => ({
        kind: "team" as const,
        presentation: targetById.get(e.evaluation.submissionId)?.label ?? "알 수 없음",
        target: targetById.get(e.evaluation.submissionId)?.label ?? "알 수 없음",
        evaluator: e.evaluatorName,
        star: e.evaluation.starScore,
        comment: e.evaluation.comment,
        evaluatedAt: e.evaluation.updatedAt.toISOString(),
      })),
      ...memberEvalRows.map((e) => ({
        kind: "member" as const,
        presentation: targetById.get(e.evaluation.submissionId)?.label ?? "알 수 없음",
        target: memberNameMap.get(e.evaluation.targetUserId) ?? "알 수 없음",
        evaluator: e.evaluatorName,
        star: e.evaluation.starScore,
        comment: null,
        evaluatedAt: e.evaluation.updatedAt.toISOString(),
      })),
    ].sort(
      (a, b) =>
        a.presentation.localeCompare(b.presentation, "ko") ||
        a.target.localeCompare(b.target, "ko") ||
        a.evaluator.localeCompare(b.evaluator, "ko")
    );

    return {
      session: {
        id: session.session.id,
        sessionDate: session.session.sessionDate,
        title: session.session.title,
        description: session.session.description,
        assignmentId: session.session.assignmentId,
        assignmentTitle: session.assignmentTitle,
        opensAt: session.session.opensAt.toISOString(),
        opensAtLocal: toKstDatetimeLocal(session.session.opensAt),
        closesAt: session.session.closesAt.toISOString(),
        closesAtLocal: toKstDatetimeLocal(session.session.closesAt),
        phase: phaseOf(session.session.opensAt, session.session.closesAt, ctx.now),
      },
      targets,
      memberStats: memberStats.flatMap((m) => m.members.map((mm) => ({ teamLabel: m.teamLabel, ...mm }))),
      evaluators: [...evaluatorProgress.entries()]
        .map(([name, doneCount]) => ({ name, doneCount }))
        .sort((a, b) => a.name.localeCompare(b.name, "ko")),
      rows,
      totalEvaluationCount: teamEvalRows.length + memberEvalRows.length,
    };
  },

  /**
   * 평가 결과를 하나의 XLSX 시트로 만든다 (팀별 요약 + 멤버별 요약 + 원본).
   */
  buildResultsXlsx(detail: AdminSessionDetail): { data: Uint8Array; filename: string } {
    const summaryHeader = ["발표", "평가자 수", "평균 별점 (5점 만점)"];
    const summary = detail.targets.map((t) => [t.label, t.evaluatorCount, t.avgStar]);

    const memberHeader = ["발표", "멤버", "평가자 수", "평균 별점 (5점 만점)"];
    const memberSummary = detail.memberStats.map((m) => [m.teamLabel, m.name, m.evaluatorCount, m.avgStar]);

    const header = ["발표", "구분", "대상", "평가자", "별점 (5점 만점)", "코멘트", "평가 시각 (KST)"];
    const body = detail.rows.map((r) => [
      r.presentation,
      r.kind === "team" ? "팀 발표" : "개인(팀원)",
      r.target,
      r.evaluator,
      r.star,
      r.comment ?? "",
      toKstDatetimeLocal(new Date(r.evaluatedAt)).replace("T", " "),
    ]);

    const rows: (string | number | null)[][] = [
      [`[${detail.session.sessionDate}] ${detail.session.title} — 발표 평가 결과`],
      [],
      ["📊 팀별 요약"],
      summaryHeader,
      ...summary,
      [],
      ["👤 팀원별 요약"],
      memberHeader,
      ...memberSummary,
      [],
      ["📝 평가 원본"],
      header,
      ...body,
    ];

    return {
      data: buildXlsx("발표 평가", rows),
      filename: sanitizeFilename(
        `발표평가_${detail.session.sessionDate}_${detail.session.title}.xlsx`
      ),
    };
  },
};
