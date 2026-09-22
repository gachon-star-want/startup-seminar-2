import { eq } from "drizzle-orm";
import { users } from "~/db/schema";
import type { AppContext } from "~/lib/context.server";
import { invalidateUserCache } from "~/lib/session";

/**
 * UserRoster Deep Module
 * 명단(유저) 상태 관리 — 휴학/복학 전환과 세션 마이크로캐시 무효화를 캡슐화합니다.
 */
export const UserRoster = {
  /**
   * 학생 상태를 재학(active) ↔ 휴학(inactive)으로 전환합니다.
   * 기존 기록(출석·제출물·팀)은 그대로 유지되며, 휴학 상태에서는
   * 로그인·출석·학생 명단에서만 제외됩니다.
   */
  async setStatus(
    ctx: AppContext,
    userId: string,
    status: "active" | "inactive"
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    const [target] = await ctx.db
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!target) return { ok: false, message: "명단에 없는 사용자예요." };
    if (target.role === "professor") {
      return { ok: false, message: "교수는 상태를 바꿀 수 없어요." };
    }

    await ctx.db.update(users).set({ status }).where(eq(users.id, userId));
    invalidateUserCache(userId); // 60초 마이크로캐시 우회 — 즉시 반영
    return { ok: true };
  },
};
