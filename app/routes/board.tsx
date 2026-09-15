import type { Route } from "./+types/board";
import { eq } from "drizzle-orm";
import { teamMembers, teams, users } from "~/db/schema";
import { requireUser } from "~/lib/session";
import { BUSINESS_STATUS_LABELS, MAIL_ORDER_STATUS_LABELS } from "~/lib/constants";
import { teamScore, MAX_TEAM_SCORE } from "~/lib/score";
import { fmtKST } from "~/lib/time";
import { Badge, Card, EmptyState, MilestoneBadge } from "~/components/ui";

export async function loader({ request, context }: Route.LoaderArgs) {
  const { db } = await requireUser(request, context);

  const allTeams = await db.select().from(teams);
  const memberships = await db
    .select({ teamId: teamMembers.teamId, userName: users.name })
    .from(teamMembers)
    .innerJoin(users, eq(teamMembers.userId, users.id));

  const membersByTeam = new Map<string, string[]>();
  for (const m of memberships) {
    const list = membersByTeam.get(m.teamId) ?? [];
    list.push(m.userName);
    membersByTeam.set(m.teamId, list);
  }

  const ranked = allTeams
    .map((t) => ({
      id: t.id,
      name: t.name,
      itemName: t.itemName,
      salesChannel: t.salesChannel,
      businessStatus: t.businessStatus,
      mailOrderStatus: t.mailOrderStatus,
      memo: t.memo,
      updatedAt: t.updatedAt,
      members: membersByTeam.get(t.id) ?? [],
      score: teamScore(t),
    }))
    .sort((a, b) => b.score - a.score || b.updatedAt.getTime() - a.updatedAt.getTime());

  let lastScore: number | null = null;
  let lastRank = 0;
  const withRank = ranked.map((t, i) => {
    const rank = t.score === lastScore ? lastRank : i + 1;
    lastScore = t.score;
    lastRank = rank;
    return { ...t, rank };
  });

  return { teams: withRank };
}

export default function BoardRoute({ loaderData }: Route.ComponentProps) {
  const medals = ["🥇", "🥈", "🥉"];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">리더보드 🏆</h1>
        <p className="mt-1 text-sm text-slate-500">
          아이템 확정 1점 · 판매 채널 확정 1점 · 사업자등록(신청중 1/완료 2점) · 통신판매업신고(신고중 1/완료 2점) = 최대 {MAX_TEAM_SCORE}점
        </p>
      </div>

      {loaderData.teams.length === 0 ? (
        <EmptyState>아직 팀이 없어요. 첫 팀을 만들어 보세요!</EmptyState>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {loaderData.teams.map((t) => (
            <Card key={t.id}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="w-7 text-center text-lg font-extrabold text-slate-400">
                      {t.rank <= 3 ? medals[t.rank - 1] : t.rank}
                    </span>
                    <h3 className="text-lg font-bold text-slate-900">{t.name}</h3>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {t.members.length > 0 ? t.members.join(" · ") : "1인 팀"}
                  </p>
                </div>
                <Badge tone="indigo">{t.score} / {MAX_TEAM_SCORE}점</Badge>
              </div>

              <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-indigo-400 to-indigo-600"
                  style={{ width: `${(t.score / MAX_TEAM_SCORE) * 100}%` }}
                />
              </div>

              <dl className="mt-4 space-y-2 text-sm">
                <div className="flex gap-2">
                  <dt className="w-24 shrink-0 font-medium text-slate-500">아이템</dt>
                  <dd className="font-medium text-slate-800">
                    {t.itemName?.trim() || <span className="text-slate-400">미정</span>}
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-24 shrink-0 font-medium text-slate-500">판매 채널</dt>
                  <dd className="font-medium text-slate-800">
                    {t.salesChannel?.trim() || <span className="text-slate-400">미정</span>}
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-24 shrink-0 font-medium text-slate-500">사업자등록</dt>
                  <dd><MilestoneBadge status={t.businessStatus} labels={BUSINESS_STATUS_LABELS} /></dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-24 shrink-0 font-medium text-slate-500">통신판매업</dt>
                  <dd><MilestoneBadge status={t.mailOrderStatus} labels={MAIL_ORDER_STATUS_LABELS} /></dd>
                </div>
              </dl>

              {t.memo?.trim() ? (
                <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600">
                  📝 {t.memo}
                </p>
              ) : null}

              <p className="mt-3 text-right text-[11px] text-slate-400">
                최근 업데이트 {fmtKST(t.updatedAt, { month: "numeric", day: "numeric" })}
              </p>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
