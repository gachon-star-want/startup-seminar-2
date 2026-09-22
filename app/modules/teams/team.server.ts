import { and, asc, eq, ne } from "drizzle-orm";
import { teamMembers, teams, users } from "~/db/schema";
import { randomInviteCode } from "~/lib/auth";
import type { AppContext } from "~/lib/context.server";
import { teamScore } from "./score";
import type { LeaderboardTeam, TeamOverview, UpdateTeamInput } from "./types";

/**
 * TeamRoster Deep Module
 * 팀 생성, 합류, 팀장 승계 및 탈퇴, 마일스톤 점수 계산과 불변식을 캡슐화합니다.
 */
export const TeamRoster = {
  /**
   * 사용자의 소속 팀 정보와 팀원 명단, 진행도 점수를 단일 쿼리로 조회합니다.
   */
  async getMyTeam(ctx: AppContext): Promise<TeamOverview | null> {
    const [membership] = await ctx.db
      .select({ team: teams, role: teamMembers.role })
      .from(teamMembers)
      .innerJoin(teams, eq(teamMembers.teamId, teams.id))
      .where(eq(teamMembers.userId, ctx.user.id))
      .limit(1);

    if (!membership) return null;

    const members = await ctx.db
      .select({ userId: users.id, name: users.name, role: teamMembers.role })
      .from(teamMembers)
      .innerJoin(users, eq(teamMembers.userId, users.id))
      .where(eq(teamMembers.teamId, membership.team.id))
      .orderBy(asc(teamMembers.createdAt));

    const score = teamScore(membership.team);

    return {
      id: membership.team.id,
      name: membership.team.name,
      inviteCode: membership.team.inviteCode,
      itemName: membership.team.itemName,
      salesChannel: membership.team.salesChannel,
      salesChannelLink: membership.team.salesChannelLink,
      businessStatus: membership.team.businessStatus,
      mailOrderStatus: membership.team.mailOrderStatus,
      memo: membership.team.memo,
      score,
      myRole: membership.role,
      myUserId: ctx.user.id,
      members,
    };
  },

  /**
   * 팀 생성 (1-Shot 인서트, 생성자를 즉시 팀장으로 등록)
   * 초대코드 충돌 시 최대 2회 내부 재시도
   */
  async create(
    ctx: AppContext,
    name: string
  ): Promise<{ ok: true; teamId: string } | { ok: false; message: string }> {
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      return { ok: false, message: "팀명을 2자 이상 입력해 주세요." };
    }

    const [existing] = await ctx.db
      .select({ teamId: teamMembers.teamId })
      .from(teamMembers)
      .where(eq(teamMembers.userId, ctx.user.id))
      .limit(1);

    if (existing) {
      return { ok: false, message: "이미 팀이 있어요. 먼저 탈퇴한 뒤 만들 수 있어요." };
    }

    let teamId: string | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const code = randomInviteCode();
      try {
        const [team] = await ctx.db
          .insert(teams)
          .values({ name: trimmed, inviteCode: code })
          .returning();
        teamId = team.id;
        break;
      } catch (err: any) {
        if (
          err?.code === "23505" ||
          String(err).includes("unique") ||
          String(err).includes("duplicate")
        ) {
          continue;
        }
        throw err;
      }
    }

    if (!teamId) {
      return { ok: false, message: "초대코드 발급에 실패했습니다. 다시 시도해 주세요." };
    }

    await ctx.db.insert(teamMembers).values({
      teamId,
      userId: ctx.user.id,
      role: "leader",
    });

    return { ok: true, teamId };
  },

  /**
   * 6자리 초대코드로 팀에 합류합니다.
   */
  async joinByCode(
    ctx: AppContext,
    rawCode: string
  ): Promise<{ ok: true; teamId: string } | { ok: false; message: string }> {
    const code = rawCode.trim().toUpperCase();
    if (!code) {
      return { ok: false, message: "초대코드를 입력해 주세요." };
    }

    const [current] = await ctx.db
      .select({ teamId: teamMembers.teamId })
      .from(teamMembers)
      .where(eq(teamMembers.userId, ctx.user.id))
      .limit(1);

    if (current) {
      return { ok: false, message: "이미 팀이 있어요. 먼저 탈퇴한 뒤 참여할 수 있어요." };
    }

    const [team] = await ctx.db
      .select()
      .from(teams)
      .where(eq(teams.inviteCode, code))
      .limit(1);

    if (!team) {
      return { ok: false, message: "초대코드를 찾을 수 없어요. 팀장에게 코드를 확인해 주세요." };
    }

    const inserted = await ctx.db
      .insert(teamMembers)
      .values({ teamId: team.id, userId: ctx.user.id, role: "member" })
      .onConflictDoNothing()
      .returning();

    if (inserted.length === 0) {
      return { ok: false, message: "이미 이 팀에 속해 있어요." };
    }

    return { ok: true, teamId: team.id };
  },

  /**
   * 팀 프로필 및 비즈니스 진행 상태(아이템, 판매채널, 사업자, 통판) 갱신
   */
  async updateProfile(
    ctx: AppContext,
    input: UpdateTeamInput
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    const [current] = await ctx.db
      .select({ teamId: teamMembers.teamId })
      .from(teamMembers)
      .where(eq(teamMembers.userId, ctx.user.id))
      .limit(1);

    if (!current) {
      return { ok: false, message: "팀이 없어요." };
    }

    const name = input.name.trim();
    const itemName = input.itemName?.trim() || null;
    const salesChannel = input.salesChannel?.trim() || null;
    // 온라인 채널이 아니면 링크는 저장하지 않는다
    const salesChannelLink = salesChannel && input.salesChannelLink?.trim() ? input.salesChannelLink.trim() : null;
    const businessStatus = input.businessStatus || "none";
    const mailOrderStatus = input.mailOrderStatus || "none";
    const memo = input.memo?.trim() || null;

    if (name.length < 2) {
      return { ok: false, message: "팀명을 2자 이상 입력해 주세요." };
    }

    if (
      !["none", "applied", "done"].includes(businessStatus) ||
      !["none", "applied", "done"].includes(mailOrderStatus)
    ) {
      return { ok: false, message: "상태 값이 올바르지 않아요." };
    }

    await ctx.db
      .update(teams)
      .set({
        name,
        itemName,
        salesChannel,
        salesChannelLink,
        businessStatus,
        mailOrderStatus,
        memo,
        updatedAt: ctx.now,
      })
      .where(eq(teams.id, current.teamId));

    return { ok: true };
  },

  /**
   * 팀 탈퇴 및 원자적 팀장 자동 승계 / 1인 팀 해체
   * - 일반 팀원 탈퇴: 단순 삭제
   * - 팀장 탈퇴:
   *   1) 차기 리더 후보 조회
   *   2) 잔류 팀원이 있으면: 차기 리더 선(先)승격 -> 본인 멤버십 후(後)삭제
   *   3) 마지막 1인이면: 팀 삭제 (CASCADE로 자식 멤버십 자동 정리)
   */
  async leave(
    ctx: AppContext
  ): Promise<{ ok: true; dissolved: boolean } | { ok: false; message: string }> {
    const [current] = await ctx.db
      .select({ teamId: teamMembers.teamId, role: teamMembers.role })
      .from(teamMembers)
      .where(eq(teamMembers.userId, ctx.user.id))
      .limit(1);

    if (!current) {
      return { ok: false, message: "팀이 없어요." };
    }

    if (current.role === "leader") {
      const remaining = await ctx.db
        .select({ id: teamMembers.id, userId: teamMembers.userId })
        .from(teamMembers)
        .where(
          and(
            eq(teamMembers.teamId, current.teamId),
            ne(teamMembers.userId, ctx.user.id)
          )
        )
        .orderBy(asc(teamMembers.createdAt))
        .limit(1);

      if (remaining.length === 0) {
        // 1인 팀 해체: teams 테이블 삭제 시 CASCADE로 teamMembers도 자동 정리
        await ctx.db.delete(teams).where(eq(teams.id, current.teamId));
        return { ok: true, dissolved: true };
      } else {
        // 차기 팀장 선(先)승격 후 본인 탈퇴 -> 고아 팀 방지 보장
        await ctx.db
          .update(teamMembers)
          .set({ role: "leader" })
          .where(eq(teamMembers.id, remaining[0].id));

        await ctx.db
          .delete(teamMembers)
          .where(
            and(
              eq(teamMembers.teamId, current.teamId),
              eq(teamMembers.userId, ctx.user.id)
            )
          );

        return { ok: true, dissolved: false };
      }
    } else {
      // 일반 팀원 탈퇴
      await ctx.db
        .delete(teamMembers)
        .where(
          and(
            eq(teamMembers.teamId, current.teamId),
            eq(teamMembers.userId, ctx.user.id)
          )
        );

      return { ok: true, dissolved: false };
    }
  },

  /**
   * 전체 팀 리더보드 뷰 (2개 테이블 병렬 1회 왕복 + 점수 계산 및 가나다순 정렬)
   */
  async getLeaderboard(ctx: AppContext): Promise<LeaderboardTeam[]> {
    const [allTeams, memberships] = await Promise.all([
      ctx.db.select().from(teams),
      ctx.db
        .select({ teamId: teamMembers.teamId, userName: users.name })
        .from(teamMembers)
        .innerJoin(users, eq(teamMembers.userId, users.id)),
    ]);

    const membersByTeam = new Map<string, string[]>();
    for (const m of memberships) {
      const list = membersByTeam.get(m.teamId) ?? [];
      list.push(m.userName);
      membersByTeam.set(m.teamId, list);
    }

    return allTeams
      .map((t) => ({
        id: t.id,
        name: t.name,
        itemName: t.itemName,
        salesChannel: t.salesChannel,
        salesChannelLink: t.salesChannelLink,
        businessStatus: t.businessStatus,
        mailOrderStatus: t.mailOrderStatus,
        memo: t.memo,
        updatedAt: t.updatedAt,
        score: teamScore(t),
        members: membersByTeam.get(t.id) ?? [],
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "ko"));
  },
};
