import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  assignments,
  presentationEvaluations,
  presentationSessions,
  submissionFiles,
  submissions,
  teamMembers,
  teams,
  users,
} from "~/db/schema";
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

const SCORE_FIELDS = ["idea", "feasibility", "delivery"] as const;

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
 * 발표 평가 세션 관리, 학생 평가 저장/조회, 관리자 통계 및 XLSX 결과 생성을 캡슐화합니다.
 */
export const EvaluationHub = {
  /** 평가 점수 1~5 파싱 (form 값은 1,2,3,4,5 문자열) */
  parseScores(
    form: FormData
  ):
    | { ok: true; scores: { idea: number; feasibility: number; delivery: number } }
    | { ok: false; message: string } {
    const scores: Record<string, number> = {};
    for (const key of SCORE_FIELDS) {
      const raw = Number(form.get(`${key}Score`));
      if (!Number.isInteger(raw) || raw < 1 || raw > 5) {
        return { ok: false, message: "각 항목을 1~5점으로 선택해 주세요." };
      }
      scores[key] = raw;
    }
    return {
      ok: true,
      scores: {
        idea: scores.idea,
        feasibility: scores.feasibility,
        delivery: scores.delivery,
      },
    };
  },

  /**
   * 학생 발표 평가 목록 (세션별 진행상황 집계)
   * targetCount/myCount는 내 발표를 제외한 "내가 평가할 수 있는" 발표 기준으로 센다.
   */
  async listSessionsForStudent(ctx: AppContext): Promise<{ sessions: StudentSessionListItem[] }> {
    const [rows, myEvalCounts, [membership]] = await Promise.all([
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
      ctx.db
        .select({ teamId: teamMembers.teamId })
        .from(teamMembers)
        .where(eq(teamMembers.userId, ctx.user.id))
        .limit(1),
    ]);

    const assignmentIds = [
      ...new Set(rows.map((r) => r.session.assignmentId).filter((id): id is string => Boolean(id))),
    ];
    const targetSubmissions = assignmentIds.length
      ? await ctx.db
          .select({
            assignmentId: submissions.assignmentId,
            userId: submissions.userId,
            teamId: submissions.teamId,
          })
          .from(submissions)
          .where(inArray(submissions.assignmentId, assignmentIds))
      : [];

    const myTeamId = membership?.teamId ?? null;
    // 내 발표(userId가 나 or teamId가 내 팀)는 평가 대상에서 제외
    const targetMap = new Map<string, number>();
    for (const s of targetSubmissions) {
      const mine = s.userId === ctx.user.id || (myTeamId !== null && s.teamId === myTeamId);
      if (mine) continue;
      targetMap.set(s.assignmentId, (targetMap.get(s.assignmentId) ?? 0) + 1);
    }

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
   * 학생 세션 평가 화면: 대상 발표 목록 + 내 평가 현황.
   * 내 발표는 mine 표시로 구분해 폼에서 제외한다.
   */
  async getSessionForStudent(ctx: AppContext, sessionId: string): Promise<StudentSessionView> {
    const [session] = await ctx.db
      .select()
      .from(presentationSessions)
      .where(eq(presentationSessions.id, sessionId))
      .limit(1);
    if (!session) throw new Response("발표 세션을 찾을 수 없어요", { status: 404 });

    const phase = phaseOf(session.opensAt, session.closesAt, ctx.now);

    // 대상 과제의 제출물 목록 (내 발표 식별용: 내 팀/내 계정 제출)
    let submissionRows: {
      submission: typeof submissions.$inferSelect;
      userName: string;
      teamName: string | null;
    }[] = [];
    if (session.assignmentId) {
      submissionRows = await ctx.db
        .select({ submission: submissions, userName: users.name, teamName: teams.name })
        .from(submissions)
        .innerJoin(users, eq(submissions.userId, users.id))
        .leftJoin(teams, eq(submissions.teamId, teams.id))
        .where(eq(submissions.assignmentId, session.assignmentId));
    }

    // 내 소속 팀·제출물 식별
    const [[membership], subIds] = await Promise.all([
      ctx.db
        .select({ teamId: teamMembers.teamId })
        .from(teamMembers)
        .where(eq(teamMembers.userId, ctx.user.id))
        .limit(1),
      submissionRows.map((r) => r.submission.id),
    ]);

    const myEvaluations = subIds.length
      ? await ctx.db
          .select()
          .from(presentationEvaluations)
          .where(
            and(
              eq(presentationEvaluations.sessionId, sessionId),
              eq(presentationEvaluations.evaluatorId, ctx.user.id)
            )
          )
      : [];

    const myEvalMap = new Map(myEvaluations.map((e) => [e.submissionId, e]));

    const isTeamUnit = submissionRows.some((r) => r.submission.teamId !== null);
    const myTeamId = membership?.teamId ?? null;

    const targets = submissionRows
      .map((r) => ({
        submissionId: r.submission.id,
        label: r.teamName ? `${r.teamName} 팀` : r.userName,
        presenter: r.userName,
        content: r.submission.content,
        link: r.submission.link,
        mine: isTeamUnit ? r.submission.teamId === myTeamId : r.submission.userId === ctx.user.id,
        files: [] as { id: string; filename: string; size: number }[],
      }))
      .sort((a, b) => a.label.localeCompare(b.label, "ko"));

    if (targets.length > 0) {
      const files = await ctx.db
        .select()
        .from(submissionFiles)
        .where(inArray(submissionFiles.submissionId, targets.map((t) => t.submissionId)));
      for (const f of files) {
        const target = targets.find((t) => t.submissionId === f.submissionId);
        if (target) {
          target.files.push({ id: f.id, filename: f.filename, size: f.size });
        }
      }
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
      myEvaluations: Object.fromEntries(
        [...myEvalMap.entries()].map(([submissionId, e]) => [
          submissionId,
          {
            idea: e.ideaScore,
            feasibility: e.feasibilityScore,
            delivery: e.deliveryScore,
            comment: e.comment,
            updatedAt: e.updatedAt.toISOString(),
          },
        ])
      ),
    };
  },

  /**
   * 학생 평가 저장/수정 (평가 창 내에서만, 내 발표 제외)
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

    // 내 발표(내 계정 제출 or 내 팀 제출)는 평가 불가
    if (submission.userId === ctx.user.id) {
      return { ok: false, message: "내 발표는 평가할 수 없어요." };
    }
    if (submission.teamId) {
      const [m] = await ctx.db
        .select({ id: teamMembers.id })
        .from(teamMembers)
        .where(and(eq(teamMembers.teamId, submission.teamId), eq(teamMembers.userId, ctx.user.id)))
        .limit(1);
      if (m) return { ok: false, message: "우리 팀 발표는 평가할 수 없어요." };
    }

    const parsed = EvaluationHub.parseScores(form);
    if (!parsed.ok) return parsed;

    const comment = String(form.get("comment") ?? "").trim().slice(0, 1000) || null;

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
        .set({
          ideaScore: parsed.scores.idea,
          feasibilityScore: parsed.scores.feasibility,
          deliveryScore: parsed.scores.delivery,
          comment,
          updatedAt: ctx.now,
        })
        .where(eq(presentationEvaluations.id, existing.id));
      return { ok: true, message: "평가가 수정되었어요!" };
    }

    await ctx.db.insert(presentationEvaluations).values({
      sessionId,
      submissionId,
      evaluatorId: ctx.user.id,
      ideaScore: parsed.scores.idea,
      feasibilityScore: parsed.scores.feasibility,
      deliveryScore: parsed.scores.delivery,
      comment,
    });
    return { ok: true, message: "평가가 저장되었어요!" };
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
   * 관리자 세션 상세: 발표별 평균, 평가자별 진행률, XLSX 원본 행
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

    const evalRows = await ctx.db
      .select({
        evaluation: presentationEvaluations,
        evaluatorName: users.name,
      })
      .from(presentationEvaluations)
      .innerJoin(users, eq(presentationEvaluations.evaluatorId, users.id))
      .where(eq(presentationEvaluations.sessionId, sessionId));

    const labelOf = (r: { teamName: string | null; userName: string }) =>
      r.teamName ? `${r.teamName} 팀` : r.userName;

    const targets = submissionRows
      .map((r) => {
        const evals = evalRows.filter((e) => e.evaluation.submissionId === r.submission.id);
        const n = evals.length;
        const avg = (sum: number) => (n > 0 ? Math.round((sum / n) * 10) / 10 : 0);
        const sumIdea = evals.reduce((s, e) => s + e.evaluation.ideaScore, 0);
        const sumFeas = evals.reduce((s, e) => s + e.evaluation.feasibilityScore, 0);
        const sumDeliv = evals.reduce((s, e) => s + e.evaluation.deliveryScore, 0);
        return {
          submissionId: r.submission.id,
          label: labelOf(r),
          presenter: r.userName,
          evaluatorCount: n,
          avgIdea: avg(sumIdea),
          avgFeasibility: avg(sumFeas),
          avgDelivery: avg(sumDeliv),
          avgTotal: n > 0 ? Math.round(((sumIdea + sumFeas + sumDeliv) / n) * 10) / 10 : 0,
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label, "ko"));

    const evaluatorProgress = new Map<string, number>();
    for (const e of evalRows) {
      evaluatorProgress.set(e.evaluatorName, (evaluatorProgress.get(e.evaluatorName) ?? 0) + 1);
    }

    const labelById = new Map(targets.map((t) => [t.submissionId, t.label]));
    const presenterById = new Map(targets.map((t) => [t.submissionId, t.presenter]));

    const rows: EvaluationResultRow[] = evalRows
      .map((e) => ({
        evaluatedAt: e.evaluation.updatedAt.toISOString(),
        presentation: labelById.get(e.evaluation.submissionId) ?? "알 수 없음",
        presenter: presenterById.get(e.evaluation.submissionId) ?? "",
        evaluator: e.evaluatorName,
        idea: e.evaluation.ideaScore,
        feasibility: e.evaluation.feasibilityScore,
        delivery: e.evaluation.deliveryScore,
        total: e.evaluation.ideaScore + e.evaluation.feasibilityScore + e.evaluation.deliveryScore,
        comment: e.evaluation.comment,
      }))
      .sort((a, b) => a.presentation.localeCompare(b.presentation, "ko") || a.evaluator.localeCompare(b.evaluator, "ko"));

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
      evaluators: [...evaluatorProgress.entries()]
        .map(([name, doneCount]) => ({ name, doneCount }))
        .sort((a, b) => a.name.localeCompare(b.name, "ko")),
      rows,
      totalEvaluationCount: evalRows.length,
    };
  },

  /**
   * 평가 결과를 하나의 XLSX 시트로 만든다.
   */
  buildResultsXlsx(detail: AdminSessionDetail): { data: Uint8Array; filename: string } {
    const header = [
      "발표",
      "발표자(제출자)",
      "평가자",
      "아이디어·시장성 (5)",
      "실현가능성 (5)",
      "발표력·완성도 (5)",
      "총점 (15)",
      "코멘트",
      "평가 시각 (KST)",
    ];
    const body = detail.rows.map((r) => [
      r.presentation,
      r.presenter,
      r.evaluator,
      r.idea,
      r.feasibility,
      r.delivery,
      r.total,
      r.comment ?? "",
      toKstDatetimeLocal(new Date(r.evaluatedAt)).replace("T", " "),
    ]);

    // 발표별 요약 블록을 상단에 함께 기록해 한 시트에서 요약+원본을 모두 볼 수 있게 한다
    const summaryHeader = ["발표", "평가자 수", "아이디어 평균", "실현가능성 평균", "발표력 평균", "총점 평균"];
    const summary = detail.targets.map((t) => [
      t.label,
      t.evaluatorCount,
      t.avgIdea,
      t.avgFeasibility,
      t.avgDelivery,
      t.avgTotal,
    ]);

    const rows: (string | number | null)[][] = [
      [`[${detail.session.sessionDate}] ${detail.session.title} — 발표 평가 결과`],
      [],
      ["📊 발표별 요약"],
      summaryHeader,
      ...summary,
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
