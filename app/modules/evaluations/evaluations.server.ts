import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
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
  EVAL_CRITERIA,
  criterionField,
  mean,
  weightedTotal,
  SCORE_MAX,
  SCORE_MIN,
  type CriterionScoreMap,
} from "./rubric";
import {
  phaseOf,
  type AdminSessionDetail,
  type AdminSessionListItem,
  type EvaluationResultRow,
  type RubricKind,
  type StudentSessionListItem,
  type StudentSessionView,
  type TeamCommentGroup,
} from "./types";

function toKstDatetimeLocal(d: Date): string {
  const kstMs = d.getTime() + 9 * 60 * 60 * 1000;
  return new Date(kstMs).toISOString().slice(0, 16);
}

const textEncoder = new TextEncoder();

/** 코멘트를 MAX_EVAL_COMMENT_BYTES(2500)바이트로 제한 — 초과분은 잘라내지 않고 거절한다 */
function validateComment(raw: string): { ok: true; value: string | null } | { ok: false } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, value: null };
  if (textEncoder.encode(trimmed).length > MAX_EVAL_COMMENT_BYTES) return { ok: false };
  return { ok: true, value: trimmed };
}

type EvalRow = typeof presentationEvaluations.$inferSelect;
type EvalInsert = typeof presentationEvaluations.$inferInsert;

/** 평가 행 → 항목별 점수 (별점 시절 행은 빈 객체) */
function rowScores(e: Pick<EvalRow, "scoreUsp" | "scoreMatch" | "scoreMedia" | "scoreData" | "scoreDelivery">): CriterionScoreMap {
  return {
    usp: e.scoreUsp ?? undefined,
    match: e.scoreMatch ?? undefined,
    media: e.scoreMedia ?? undefined,
    data: e.scoreData ?? undefined,
    delivery: e.scoreDelivery ?? undefined,
  };
}

/** 항목별 점수 → 저장 컬럼 (고르지 않은 항목은 null) */
function scoreColumns(scores: CriterionScoreMap): Pick<EvalInsert, "scoreUsp" | "scoreMatch" | "scoreMedia" | "scoreData" | "scoreDelivery"> {
  return {
    scoreUsp: scores.usp ?? null,
    scoreMatch: scores.match ?? null,
    scoreMedia: scores.media ?? null,
    scoreData: scores.data ?? null,
    scoreDelivery: scores.delivery ?? null,
  };
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
  /**
   * 한 팀의 5개 항목 점수를 폼에서 읽는다 — 필드는 crit_{항목}_{팀}.
   * 비어 있는 항목은 건너뛰고(부분 입력), 값이 있으면 1~5 정수여야 한다.
   */
  readCriterionScores(
    form: FormData,
    teamId: string
  ): { ok: true; scores: CriterionScoreMap; picked: number } | { ok: false; message: string } {
    const scores: CriterionScoreMap = {};
    let picked = 0;
    for (const c of EVAL_CRITERIA) {
      const raw = String(form.get(criterionField(c.key, teamId)) ?? "").trim();
      if (!raw) continue;
      const n = Number(raw);
      if (!Number.isInteger(n) || n < SCORE_MIN || n > SCORE_MAX) {
        return { ok: false, message: "점수는 1점부터 5점까지 정수로 줄 수 있어요." };
      }
      scores[c.key] = n;
      picked += 1;
    }
    return { ok: true, scores, picked };
  },

  /**
   * 학생 발표 평가 목록 (세션별 진행상황 집계)
   * targetCount는 전체 팀 수(제출물 없는 팀 포함), myCount는 내가 평가를 끝낸 팀 수.
   * 끝낸 평가 = 5개 항목을 모두 매겨 총점이 계산된 행(star_score > 0). 부분 입력 임시 저장은 세지 않는다.
   */
  async listSessionsForStudent(ctx: AppContext): Promise<{ sessions: StudentSessionListItem[] }> {
    const [rows, myEvalCounts, [teamCount]] = await Promise.all([
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
        .where(
          and(
            eq(presentationEvaluations.evaluatorId, ctx.user.id),
            gt(presentationEvaluations.starScore, 0)
          )
        )
        .groupBy(presentationEvaluations.sessionId),
      ctx.db.select({ count: sql<number>`count(*)` }).from(teams),
    ]);

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
        targetCount: teamCount?.count ?? 0,
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
   * 학생 세션 평가 화면: 모든 팀 발표 목록 + 내 이전 입력.
   * 평가 대상은 제출물이 아니라 "모든 팀" — 발표 자료를 아직 안 올린 새 팀도 포함된다.
   * 우리 팀도 평가 대상에 포함된다.
   * 점수는 관리자만 볼 수 있으므로, 내 입력은 폼을 다시 채우는 데 필요한 '평가 중'일 때만 내려준다.
   */
  async getSessionForStudent(ctx: AppContext, sessionId: string): Promise<StudentSessionView> {
    const [session] = await ctx.db
      .select()
      .from(presentationSessions)
      .where(eq(presentationSessions.id, sessionId))
      .limit(1);
    if (!session) throw new Response("발표 세션을 찾을 수 없어요", { status: 404 });

    const phase = phaseOf(session.opensAt, session.closesAt, ctx.now);
    const isOpen = phase === "open";

    const [teamRows, myEvals] = await Promise.all([
      ctx.db.select({ id: teams.id, name: teams.name }).from(teams),
      ctx.db
        .select({
          teamId: presentationEvaluations.teamId,
          comment: presentationEvaluations.comment,
          scoreUsp: presentationEvaluations.scoreUsp,
          scoreMatch: presentationEvaluations.scoreMatch,
          scoreMedia: presentationEvaluations.scoreMedia,
          scoreData: presentationEvaluations.scoreData,
          scoreDelivery: presentationEvaluations.scoreDelivery,
        })
        .from(presentationEvaluations)
        .where(
          and(
            eq(presentationEvaluations.sessionId, sessionId),
            eq(presentationEvaluations.evaluatorId, ctx.user.id)
          )
        ),
    ]);

    const teamIds = teamRows.map((t) => t.id);

    // 팀원 명단(발표자 표시용) + 팀별 대표 제출물(최신 1건)을 병렬로 일괄 조회
    const [memberRows, submissionRows] = await Promise.all([
      teamIds.length
        ? ctx.db
            .select({
              teamId: teamMembers.teamId,
              name: users.name,
              role: teamMembers.role,
            })
            .from(teamMembers)
            .innerJoin(users, eq(teamMembers.userId, users.id))
            .where(inArray(teamMembers.teamId, teamIds))
        : Promise.resolve([]),
      session.assignmentId
        ? ctx.db
            .select({ submission: submissions })
            .from(submissions)
            .where(eq(submissions.assignmentId, session.assignmentId))
            .orderBy(desc(submissions.createdAt))
        : Promise.resolve([]),
    ]);

    // 팀별 대표 제출물 = 가장 최근 제출물 (orderBy desc라 먼저 온 것이 최신)
    const latestByTeam = new Map<string, typeof submissions.$inferSelect>();
    for (const r of submissionRows) {
      if (r.submission.teamId && !latestByTeam.has(r.submission.teamId)) {
        latestByTeam.set(r.submission.teamId, r.submission);
      }
    }
    const submissionIds = [...latestByTeam.values()].map((s) => s.id);

    const files = await (submissionIds.length
      ? ctx.db.select().from(submissionFiles).where(inArray(submissionFiles.submissionId, submissionIds))
      : []);

    // 발표자 = 팀장 (없으면 가나다순 첫 팀원)
    const presenterByTeam = new Map<string, string>();
    const namesByTeam = new Map<string, string[]>();
    for (const m of memberRows) {
      if (m.role === "leader") presenterByTeam.set(m.teamId, m.name);
      const names = namesByTeam.get(m.teamId) ?? [];
      names.push(m.name);
      namesByTeam.set(m.teamId, names);
    }
    for (const [teamId, names] of namesByTeam) {
      if (!presenterByTeam.has(teamId)) {
        presenterByTeam.set(teamId, names.sort((a, b) => a.localeCompare(b, "ko"))[0]);
      }
    }

    const myByTeam = new Map(myEvals.map((e) => [e.teamId, e]));
    const filesBySubmission = new Map<string, typeof files>();
    for (const f of files) {
      const list = filesBySubmission.get(f.submissionId) ?? [];
      list.push(f);
      filesBySubmission.set(f.submissionId, list);
    }

    const targets = teamRows
      .map((team) => {
        const sub = latestByTeam.get(team.id) ?? null;
        const prev = myByTeam.get(team.id) ?? null;
        const scores: CriterionScoreMap = prev ? rowScores(prev) : {};

        return {
          teamId: team.id,
          submissionId: sub?.id ?? null,
          label: `${team.name} 팀`,
          presenter: presenterByTeam.get(team.id) ?? "—",
          content: sub?.content ?? null,
          link: sub?.link ?? null,
          files: sub
            ? (filesBySubmission.get(sub.id) ?? []).map((f) => ({
                id: f.id,
                filename: f.filename,
                size: f.size,
              }))
            : [],
          evaluated: weightedTotal(scores) !== null,
          mine: isOpen && prev ? { scores, comment: prev.comment } : null,
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label, "ko"));

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
   * 학생 평가 저장 — 페이지의 모든 팀을 한 번에 저장한다.
   * 팀별 필드는 crit_{항목}_{팀} / teamComment_{팀}.
   * intent=draft(임시 저장)는 점수를 조금이라도 고른 팀을 저장한다. 5개 항목이 다 채워지지 않은
   * 부분 입력도 그대로 두되 총점을 0(미완료)으로 적재해 통계에 세지 않는다.
   * intent=submit(제출)은 5개 항목이 다 채워지지 않은 팀이 있으면 어느 팀인지 알려주고 거절한다.
   */
  async saveEvaluation(
    ctx: AppContext,
    sessionId: string,
    form: FormData
  ): Promise<{ ok: true; message: string; saved: number } | { ok: false; message: string }> {
    const [session] = await ctx.db
      .select()
      .from(presentationSessions)
      .where(eq(presentationSessions.id, sessionId))
      .limit(1);
    if (!session) return { ok: false, message: "발표 세션을 찾을 수 없어요." };

    if (ctx.now < session.opensAt || ctx.now > session.closesAt) {
      return { ok: false, message: "지금은 이 세션의 평가 기간이 아니에요." };
    }

    const draft = String(form.get("intent") ?? "submit") === "draft";

    const teamIdList = [...new Set(form.getAll("teamId").map(String))].filter(Boolean);
    if (teamIdList.length === 0) {
      return { ok: false, message: "평가 대상 발표가 없어요." };
    }

    // 평가 대상 팀만 통과 — 대상 밖의 teamId는 조용히 무시
    const targetRows = await ctx.db
      .select({ id: teams.id, name: teams.name })
      .from(teams)
      .where(inArray(teams.id, teamIdList));
    const targetMap = new Map(targetRows.map((r) => [r.id, `${r.name} 팀`]));

    // 팀별 대표 제출물(최신 1건) — 평가 기록이 어떤 발표 자료를 가리키는지 남긴다
    const latestByTeam = new Map<string, string>();
    if (session.assignmentId) {
      const subRows = await ctx.db
        .select({ id: submissions.id, teamId: submissions.teamId })
        .from(submissions)
        .where(eq(submissions.assignmentId, session.assignmentId))
        .orderBy(desc(submissions.createdAt));
      for (const s of subRows) {
        if (s.teamId && !latestByTeam.has(s.teamId)) latestByTeam.set(s.teamId, s.id);
      }
    }

    const plans: {
      teamId: string;
      submissionId: string | null;
      scores: CriterionScoreMap;
      /** 배점 가중 총점(1.0~5.0) — 부분 입력은 0 (미완료 표식) */
      total: number;
      comment: string | null;
    }[] = [];

    for (const teamId of teamIdList) {
      const label = targetMap.get(teamId);
      if (!label) continue;

      let comment = validateComment(String(form.get(`teamComment_${teamId}`) ?? ""));
      if (!comment.ok) {
        if (draft) {
          comment = { ok: true, value: null }; // 임시 저장 중 초과 코멘트는 일단 뺀다 (제출 때 거절)
        } else {
          return { ok: false, message: `코멘트는 최대 ${MAX_EVAL_COMMENT_BYTES}바이트까지 쓸 수 있어요.` };
        }
      }

      const read = EvaluationHub.readCriterionScores(form, teamId);
      if (!read.ok) {
        if (draft) continue;
        return read;
      }
      if (read.picked === 0) {
        if (draft) continue; // 점수 전의 부분 입력(코멘트만 등)은 임시 저장에서 제외
        if (comment.value) {
          return { ok: false, message: `${label}의 점수를 매겨 주세요.` };
        }
        continue; // 아무것도 입력하지 않은 팀은 저장하지 않음
      }

      const total = weightedTotal(read.scores);
      if (total === null && !draft) {
        return {
          ok: false,
          message: `${label}의 점수가 ${read.picked}개 항목에만 선택됐어요. 5개 항목을 모두 골라 주세요.`,
        };
      }

      plans.push({
        teamId,
        submissionId: latestByTeam.get(teamId) ?? null,
        scores: read.scores,
        total: total ?? 0,
        comment: comment.value,
      });
    }

    if (plans.length === 0) {
      if (draft) return { ok: true, message: "임시 저장했어요.", saved: 0 };
      return { ok: false, message: "점수를 하나 이상 골라 저장해 주세요." };
    }

    // 저장 — 팀 평가 upsert. D1 왕복이 많아지면 무료 플랜 CPU 예산을 태우므로
    // 기존 행을 한 번에 읽고 전부 batch 한 번으로 적재한다.
    const existingTeamRows = await ctx.db
      .select({ id: presentationEvaluations.id, teamId: presentationEvaluations.teamId })
      .from(presentationEvaluations)
      .where(
        and(
          eq(presentationEvaluations.sessionId, sessionId),
          eq(presentationEvaluations.evaluatorId, ctx.user.id),
          inArray(presentationEvaluations.teamId, teamIdList)
        )
      );
    const teamEvalId = new Map(existingTeamRows.map((r) => [r.teamId, r.id]));

    const statements: BatchItem<"sqlite">[] = [];
    for (const p of plans) {
      const scores = scoreColumns(p.scores);
      const existingId = teamEvalId.get(p.teamId);
      if (existingId) {
        statements.push(
          ctx.db
            .update(presentationEvaluations)
            .set({
              submissionId: p.submissionId,
              starScore: p.total,
              ...scores,
              comment: p.comment,
              updatedAt: ctx.now,
            })
            .where(eq(presentationEvaluations.id, existingId))
        );
      } else {
        statements.push(
          ctx.db.insert(presentationEvaluations).values({
            sessionId,
            teamId: p.teamId,
            submissionId: p.submissionId,
            evaluatorId: ctx.user.id,
            starScore: p.total,
            ...scores,
            comment: p.comment,
          })
        );
      }
    }
    // plans.length ≥ 1이므로 statements는 항상 비어 있지 않다 (drizzle batch는 non-empty 튜플을 요구)
    await ctx.db.batch(statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);

    return {
      ok: true,
      saved: plans.length,
      message: draft ? "임시 저장했어요." : `${plans.length}개 팀의 평가를 제출했어요!`,
    };
  },

  /**
   * 관리자 세션 목록 + 집계 — 5개 항목을 모두 매긴 평가(총점 > 0)만 센다
   */
  async listSessionsForAdmin(ctx: AppContext): Promise<{ sessions: AdminSessionListItem[] }> {
    const [rows, evalStats, [teamCount]] = await Promise.all([
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
        .where(gt(presentationEvaluations.starScore, 0))
        .groupBy(presentationEvaluations.sessionId),
      ctx.db.select({ count: sql<number>`count(*)` }).from(teams),
    ]);

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
          targetCount: teamCount?.count ?? 0,
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

    const teamRows = await ctx.db.select({ id: teams.id, name: teams.name }).from(teams);
    const membersByTeam = new Map<string, string[]>(); // teamId -> [팀장 이름, ...]
    const memberRoster = await ctx.db
      .select({ teamId: teamMembers.teamId, name: users.name, role: teamMembers.role })
      .from(teamMembers)
      .innerJoin(users, eq(teamMembers.userId, users.id));
    for (const m of memberRoster) {
      const list = membersByTeam.get(m.teamId) ?? [];
      if (m.role === "leader") list.unshift(m.name);
      else list.push(m.name);
      membersByTeam.set(m.teamId, list);
    }

    const [teamEvalRows, memberEvalRows] = await Promise.all([
      ctx.db
        .select({ evaluation: presentationEvaluations, evaluatorName: users.name })
        .from(presentationEvaluations)
        .innerJoin(users, eq(presentationEvaluations.evaluatorId, users.id))
        .where(
          and(
            eq(presentationEvaluations.sessionId, sessionId),
            gt(presentationEvaluations.starScore, 0)
          )
        ), // 5개 항목을 다 매기지 않은 임시 저장(총점 0)은 결과에서 뺀다
      ctx.db
        .select({ evaluation: presentationMemberEvaluations, evaluatorName: users.name })
        .from(presentationMemberEvaluations)
        .innerJoin(users, eq(presentationMemberEvaluations.evaluatorId, users.id))
        .where(eq(presentationMemberEvaluations.sessionId, sessionId)),
    ]);

    // 채점 방식 — 항목 점수가 있는 평가가 하나라도 있으면 루브릭, 전부 없으면 별점 시절 세션.
    // 아직 평가가 없는 세션은 현재 폼(루브릭) 기준으로 보여준다.
    const rubric: RubricKind =
      teamEvalRows.length === 0 || teamEvalRows.some((e) => e.evaluation.scoreUsp != null)
        ? "criteria"
        : "star";

    const targets = teamRows
      .map((team) => {
        const evals = teamEvalRows.filter((e) => e.evaluation.teamId === team.id);
        const n = evals.length;
        const roster = membersByTeam.get(team.id) ?? [];
        const totals = evals.map((e) => e.evaluation.starScore);
        return {
          teamId: team.id,
          label: `${team.name} 팀`,
          presenter: roster[0] ?? "—",
          evaluatorCount: n,
          totalStar: n > 0 ? Math.round(totals.reduce((s, v) => s + v, 0) * 10) / 10 : 0,
          // 팀 최종 점수 = 평가자 총점의 평균
          avgStar: mean(totals),
          criteriaAvg: EVAL_CRITERIA.map((c) => {
            const vals = evals
              .map((e) => rowScores(e.evaluation)[c.key])
              .filter((v): v is number => typeof v === "number");
            return vals.length > 0 ? mean(vals) : null;
          }),
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label, "ko"));

    const targetByTeamId = new Map(targets.map((t) => [t.teamId, t]));

    // 팀원별 집계 — targetUserId의 이름은 users에서 보장되지만 표시용으로 한 번 조회
    const memberUserIds = [...new Set(memberEvalRows.map((e) => e.evaluation.targetUserId))];
    const memberNames = memberUserIds.length
      ? await ctx.db
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(inArray(users.id, memberUserIds))
      : [];
    const memberNameMap = new Map(memberNames.map((m) => [m.id, m.name]));

    const memberStats = [...new Set(memberEvalRows.map((e) => e.evaluation.teamId))]
      .map((teamId) => {
        const target = targetByTeamId.get(teamId);
        const byUser = new Map<string, { stars: number[]; name: string }>();
        for (const e of memberEvalRows.filter((x) => x.evaluation.teamId === teamId)) {
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

    // 팀×평가자 매트릭스 — 관리자 결과 화면용 (행=팀, 열=평가자)
    const evaluatorById = new Map<string, { userId: string; name: string; doneCount: number }>();
    const scores: Record<string, number> = {};
    for (const e of teamEvalRows) {
      const entry = evaluatorById.get(e.evaluation.evaluatorId) ?? {
        userId: e.evaluation.evaluatorId,
        name: e.evaluatorName,
        doneCount: 0,
      };
      entry.doneCount += 1;
      evaluatorById.set(e.evaluation.evaluatorId, entry);
      scores[`${e.evaluation.evaluatorId}:${e.evaluation.teamId}`] = e.evaluation.starScore;
    }

    // 코멘트를 팀별로 묶는다 (코멘트를 남긴 평가만)
    const commentGroups: TeamCommentGroup[] = targets
      .map((t) => ({
        teamId: t.teamId,
        teamLabel: t.label,
        items: teamEvalRows
          .filter((e) => e.evaluation.teamId === t.teamId && e.evaluation.comment)
          .sort((a, b) => a.evaluatorName.localeCompare(b.evaluatorName, "ko"))
          .map((e) => ({
            evaluator: e.evaluatorName,
            comment: e.evaluation.comment!,
            evaluatedAt: e.evaluation.updatedAt.toISOString(),
          })),
      }))
      .filter((g) => g.items.length > 0);

    const rows: EvaluationResultRow[] = [
      ...teamEvalRows.map((e) => ({
        kind: "team" as const,
        presentation: targetByTeamId.get(e.evaluation.teamId)?.label ?? "알 수 없음",
        target: targetByTeamId.get(e.evaluation.teamId)?.label ?? "알 수 없음",
        evaluator: e.evaluatorName,
        star: e.evaluation.starScore,
        scores: EVAL_CRITERIA.map((c) => rowScores(e.evaluation)[c.key] ?? null),
        comment: e.evaluation.comment,
        evaluatedAt: e.evaluation.updatedAt.toISOString(),
      })),
      ...memberEvalRows.map((e) => ({
        kind: "member" as const,
        presentation: targetByTeamId.get(e.evaluation.teamId)?.label ?? "알 수 없음",
        target: memberNameMap.get(e.evaluation.targetUserId) ?? "알 수 없음",
        evaluator: e.evaluatorName,
        star: e.evaluation.starScore,
        scores: EVAL_CRITERIA.map(() => null),
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
      rubric,
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
      matrix: {
        evaluators: [...evaluatorById.values()].sort((a, b) => a.name.localeCompare(b.name, "ko")),
        scores,
      },
      commentGroups,
      rows,
      totalEvaluationCount: teamEvalRows.length + memberEvalRows.length,
    };
  },

  /**
   * 평가 결과를 하나의 XLSX 시트로 만든다 (팀별 요약 + 팀원별 요약(별점 시절) + 원본).
   * 루브릭 세션은 요약·원본 모두 항목별 점수와 최종 점수(5점 만점)를 담는다.
   */
  buildResultsXlsx(detail: AdminSessionDetail): { data: Uint8Array; filename: string } {
    const isRubric = detail.rubric === "criteria";
    const criteriaHeads = EVAL_CRITERIA.map((c) => `${c.label} (${c.weight})`);

    const summaryHeader = isRubric
      ? ["발표", "평가자 수", ...criteriaHeads, "최종 점수 (5점 만점)"]
      : ["발표", "평가자 수", "평균 별점 (5점 만점)"];
    const summary = isRubric
      ? detail.targets.map((t) => [t.label, t.evaluatorCount, ...t.criteriaAvg, t.avgStar])
      : detail.targets.map((t) => [t.label, t.evaluatorCount, t.avgStar]);

    const memberHeader = ["발표", "멤버", "평가자 수", "평균 별점 (5점 만점)"];
    const memberSummary = detail.memberStats.map((m) => [m.teamLabel, m.name, m.evaluatorCount, m.avgStar]);

    const header = isRubric
      ? ["발표", "평가자", ...criteriaHeads, "총점 (5점 만점)", "코멘트", "평가 시각 (KST)"]
      : ["발표", "구분", "대상", "평가자", "별점 (5점 만점)", "코멘트", "평가 시각 (KST)"];
    const body = detail.rows.map((r) =>
      isRubric
        ? [
            r.presentation,
            r.evaluator,
            ...r.scores,
            r.star,
            r.comment ?? "",
            toKstDatetimeLocal(new Date(r.evaluatedAt)).replace("T", " "),
          ]
        : [
            r.presentation,
            r.kind === "team" ? "팀 발표" : "개인(팀원)",
            r.target,
            r.evaluator,
            r.star,
            r.comment ?? "",
            toKstDatetimeLocal(new Date(r.evaluatedAt)).replace("T", " "),
          ]
    );

    const rows: (string | number | null)[][] = [
      [`[${detail.session.sessionDate}] ${detail.session.title} — 발표 평가 결과`],
      [],
      ["📊 팀별 요약"],
      summaryHeader,
      ...summary,
    ];
    if (detail.memberStats.length > 0) {
      rows.push([], ["👤 팀원별 요약"], memberHeader, ...memberSummary);
    }
    rows.push([], ["📝 평가 원본"], header, ...body);

    return {
      data: buildXlsx("발표 평가", rows),
      filename: sanitizeFilename(
        `발표평가_${detail.session.sessionDate}_${detail.session.title}.xlsx`
      ),
    };
  },
};
