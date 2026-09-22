import { asc, eq } from "drizzle-orm";
import { submissionFiles, submissions, teamMembers, teams, users } from "~/db/schema";
import type { AppContext } from "~/lib/context.server";
import { invalidateUserCache } from "~/lib/session";

/**
 * UserRoster Deep Module
 * 명단(유저) 삭제 — 학생 제적과 팀 정리(빈 팀 해체·팀장 승계), 제출 파일 정리를 캡슐화합니다.
 */
export const UserRoster = {
  /**
   * 학생을 명단에서 완전히 삭제합니다.
   * 출석 기록·제출물(및 R2 파일)·작성한 평가·받은 팀원 평가가 CASCADE로 함께 삭제되고,
   * 삭제로 팀이 비면 팀을 해체하며, 팀장이 사라진 팀에 팀원이 남아 있으면
   * 가장 오래된 팀원을 차기 팀장으로 승계해 리더 없는 고아 팀을 막는다.
   */
  async remove(
    ctx: AppContext,
    userId: string
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    const [target] = await ctx.db
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!target) return { ok: false, message: "명단에 없는 사용자예요." };
    if (target.role === "professor") {
      return { ok: false, message: "교수는 삭제할 수 없어요." };
    }

    const memberships = await ctx.db
      .select({ teamId: teamMembers.teamId, role: teamMembers.role })
      .from(teamMembers)
      .where(eq(teamMembers.userId, userId));

    // 제출 파일은 행이 CASCADE로 사라지므로 R2 키를 미리 수집
    const fileRows = await ctx.db
      .select({ r2Key: submissionFiles.r2Key })
      .from(submissionFiles)
      .innerJoin(submissions, eq(submissionFiles.submissionId, submissions.id))
      .where(eq(submissions.userId, userId));

    await ctx.db.delete(users).where(eq(users.id, userId));
    invalidateUserCache(userId); // 60초 유저캐시 우회 — 남은 세션 즉시 무력화

    for (const m of memberships) {
      const remaining = await ctx.db
        .select({ id: teamMembers.id })
        .from(teamMembers)
        .where(eq(teamMembers.teamId, m.teamId))
        .orderBy(asc(teamMembers.createdAt));

      if (remaining.length === 0) {
        // 마지막 팀원이었다면 팀 해체 (멤버십·팀 평가는 CASCADE)
        await ctx.db.delete(teams).where(eq(teams.id, m.teamId));
      } else if (m.role === "leader") {
        await ctx.db
          .update(teamMembers)
          .set({ role: "leader" })
          .where(eq(teamMembers.id, remaining[0].id));
      }
    }

    for (const f of fileRows) {
      ctx.executionCtx?.waitUntil(ctx.env.FILES.delete(f.r2Key));
    }

    return { ok: true };
  },
};
