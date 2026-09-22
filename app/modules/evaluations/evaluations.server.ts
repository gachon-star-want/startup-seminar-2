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
   * targetCount는 전체 팀 수(제출물 없는 팀 포함), myCount는 내가 팀 단위 평가를 끝낸 수.
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
        .where(eq(presentationEvaluations.evaluatorId, ctx.user.id))
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
   * 학생 세션 평가 화면: 모든 팀 발표 목록 + 팀원 명단 + 내 이전 평가.
   * 평가 대상은 제출물이 아니라 "모든 팀" — 발표 자료를 아직 안 올린 새 팀도 포함된다.
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

    const [teamRows, myEvals, myMemberEvals] = await Promise.all([
      ctx.db.select({ id: teams.id, name: teams.name }).from(teams),
      ctx.db
        .select()
        .from(presentationEvaluations)
        .where(
          and(
            eq(presentationEvaluations.sessionId, sessionId),
            eq(presentationEvaluations.evaluatorId, ctx.user.id)
          )
        ),
      ctx.db
        .select()
        .from(presentationMemberEvaluations)
        .where(
          and(
            eq(presentationMemberEvaluations.sessionId, sessionId),
            eq(presentationMemberEvaluations.evaluatorId, ctx.user.id)
          )
        ),
    ]);

    const teamIds = teamRows.map((t) => t.id);

    // 팀원 명단 + 팀별 대표 제출물(최신 1건)을 병렬로 일괄 조회
    const [memberRows, submissionRows] = await Promise.all([
      teamIds.length
        ? ctx.db
            .select({
              teamId: teamMembers.teamId,
              userId: teamMembers.userId,
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

    const files = submissionIds.length
      ? await ctx.db.select().from(submissionFiles).where(inArray(submissionFiles.submissionId, submissionIds))
      : [];

    const myEvalMap = new Map(myEvals.map((e) => [e.teamId, e]));
    const myMemberMap = new Map(myMemberEvals.map((e) => [`${e.teamId}:${e.targetUserId}`, e]));
    const membersByTeam = new Map<string, typeof memberRows>();
    for (const m of memberRows) {
      const list = membersByTeam.get(m.teamId) ?? [];
      list.push(m);
      membersByTeam.set(m.teamId, list);
    }

    const targets = teamRows
      .map((team) => {
        const sub = latestByTeam.get(team.id) ?? null;
        const roster = membersByTeam.get(team.id) ?? [];
        const members = roster
          .map((m) => {
            const prev = myMemberMap.get(`${team.id}:${m.userId}`);
            return {
              userId: m.userId,
              name: m.name,
              my: prev ? { star: prev.starScore } : null,
            };
          })
          .sort((a, b) => a.name.localeCompare(b.name, "ko"));
        // 발표자 = 팀장 (없으면 첫 팀원)
        const leader = roster.find((m) => m.role === "leader");
        const presenter = leader?.name ?? members[0]?.name ?? "—";
        const prev = myEvalMap.get(team.id);

        return {
          teamId: team.id,
          submissionId: sub?.id ?? null,
          label: `${team.name} 팀`,
          presenter,
          content: sub?.content ?? null,
          link: sub?.link ?? null,
          files: sub
            ? files
                .filter((f) => f.submissionId === sub.id)
                .map((f) => ({ id: f.id, filename: f.filename, size: f.size }))
            : [],
          members,
          my: prev
            ? { star: prev.starScore, comment: prev.comment, updatedAt: prev.updatedAt.toISOString() }
            : null,
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
   * 팀별 필드는 teamScore_{팀} / teamComment_{팀} / memberIds_{팀} / memberScore_{팀}_{팀원}.
   * 대상은 제출물이 아니라 팀 기준 — 제출물은 팀의 대표 제출물(최신 1건)로 참조만 한다.
   * intent=draft(임시 저장)는 별점을 고른 팀만 조용히 저장하고 부분 입력은 무시하며,
   * intent=submit(제출)은 입력만 해놓고 별점이 없는 팀이 있으면 어느 팀인지 알려주고 거절한다.
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

    // 팀원 명단 일괄 조회 — 그 팀 소속이 아닌 유저에 대한 평가는 무시
    const rosterRows = await ctx.db
      .select({ teamId: teamMembers.teamId, userId: teamMembers.userId })
      .from(teamMembers)
      .where(inArray(teamMembers.teamId, teamIdList));
    const rosterByTeam = new Map<string, Set<string>>();
    for (const r of rosterRows) {
      const set = rosterByTeam.get(r.teamId) ?? new Set<string>();
      set.add(r.userId);
      rosterByTeam.set(r.teamId, set);
    }

    const plans: {
      teamId: string;
      submissionId: string | null;
      star: number;
      comment: string | null;
      members: { userId: string; star: number }[];
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

      const members: { userId: string; star: number }[] = [];
      const roster = rosterByTeam.get(teamId);
      for (const memberId of form.getAll(`memberIds_${teamId}`).map(String)) {
        if (!roster?.has(memberId)) continue; // 그 팀 소속이 아닌 유저는 무시
        const memberField = `memberScore_${teamId}_${memberId}`;
        if (!String(form.get(memberField) ?? "").trim()) continue; // 별점 미선택 멤버는 건너뜀
        const star = EvaluationHub.parseStar(form, memberField);
        if (!star.ok) {
          if (draft) continue;
          return star;
        }
        members.push({ userId: memberId, star: star.star });
      }

      const starRaw = String(form.get(`teamScore_${teamId}`) ?? "").trim();
      if (!starRaw) {
        if (draft) continue; // 별점 전의 부분 입력(코멘트만 등)은 임시 저장에서 제외
        if (comment.value || members.length > 0) {
          return { ok: false, message: `${label}의 별점을 골라 주세요.` };
        }
        continue; // 아무것도 입력하지 않은 팀은 저장하지 않음
      }
      const teamStar = EvaluationHub.parseStar(form, `teamScore_${teamId}`);
      if (!teamStar.ok) {
        if (draft) continue;
        return teamStar;
      }

      plans.push({ teamId, submissionId: latestByTeam.get(teamId) ?? null, star: teamStar.star, comment: comment.value, members });
    }

    if (plans.length === 0) {
      if (draft) return { ok: true, message: "임시 저장했어요.", saved: 0 };
      return { ok: false, message: "별점을 하나 이상 골라 저장해 주세요." };
    }

    // 저장 — 팀 단위 평가 upsert
    for (const p of plans) {
      const [existing] = await ctx.db
        .select({ id: presentationEvaluations.id })
        .from(presentationEvaluations)
        .where(
          and(
            eq(presentationEvaluations.sessionId, sessionId),
            eq(presentationEvaluations.teamId, p.teamId),
            eq(presentationEvaluations.evaluatorId, ctx.user.id)
          )
        )
        .limit(1);

      if (existing) {
        await ctx.db
          .update(presentationEvaluations)
          .set({ submissionId: p.submissionId, starScore: p.star, comment: p.comment, updatedAt: ctx.now })
          .where(eq(presentationEvaluations.id, existing.id));
      } else {
        await ctx.db.insert(presentationEvaluations).values({
          sessionId,
          teamId: p.teamId,
          submissionId: p.submissionId,
          evaluatorId: ctx.user.id,
          starScore: p.star,
          comment: p.comment,
        });
      }

      // 팀원 개별 평가 upsert (별점만)
      for (const m of p.members) {
        const [prev] = await ctx.db
          .select({ id: presentationMemberEvaluations.id })
          .from(presentationMemberEvaluations)
          .where(
            and(
              eq(presentationMemberEvaluations.sessionId, sessionId),
              eq(presentationMemberEvaluations.teamId, p.teamId),
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
            teamId: p.teamId,
            evaluatorId: ctx.user.id,
            targetUserId: m.userId,
            starScore: m.star,
          });
        }
      }
    }

    return {
      ok: true,
      saved: plans.length,
      message: draft ? "임시 저장했어요." : `${plans.length}개 팀의 평가를 제출했어요!`,
    };
  },

  /**
   * 관리자 세션 목록 + 집계
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
        .where(eq(presentationEvaluations.sessionId, sessionId)),
      ctx.db
        .select({ evaluation: presentationMemberEvaluations, evaluatorName: users.name })
        .from(presentationMemberEvaluations)
        .innerJoin(users, eq(presentationMemberEvaluations.evaluatorId, users.id))
        .where(eq(presentationMemberEvaluations.sessionId, sessionId)),
    ]);

    const targets = teamRows
      .map((team) => {
        const evals = teamEvalRows.filter((e) => e.evaluation.teamId === team.id);
        const n = evals.length;
        const roster = membersByTeam.get(team.id) ?? [];
        return {
          teamId: team.id,
          label: `${team.name} 팀`,
          presenter: roster[0] ?? "—",
          evaluatorCount: n,
          avgStar: n > 0 ? Math.round((evals.reduce((s, e) => s + e.evaluation.starScore, 0) / n) * 10) / 10 : 0,
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

    const rows: EvaluationResultRow[] = [
      ...teamEvalRows.map((e) => ({
        kind: "team" as const,
        presentation: targetByTeamId.get(e.evaluation.teamId)?.label ?? "알 수 없음",
        target: targetByTeamId.get(e.evaluation.teamId)?.label ?? "알 수 없음",
        evaluator: e.evaluatorName,
        star: e.evaluation.starScore,
        comment: e.evaluation.comment,
        evaluatedAt: e.evaluation.updatedAt.toISOString(),
      })),
      ...memberEvalRows.map((e) => ({
        kind: "member" as const,
        presentation: targetByTeamId.get(e.evaluation.teamId)?.label ?? "알 수 없음",
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
