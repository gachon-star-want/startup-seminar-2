import type { Route } from "./+types/board";
import { eq } from "drizzle-orm";
import { teamMembers, teams, users } from "~/db/schema";
import { requireUser } from "~/lib/session";
import { BUSINESS_STATUS_LABELS, MAIL_ORDER_STATUS_LABELS } from "~/lib/constants";
import { fmtKST } from "~/lib/time";
import { EmptyState, MilestoneBadge, PageHeader } from "~/components/ui";

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

  const teamsWithMembers = allTeams
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
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));

  return { teams: teamsWithMembers };
}

export default function BoardRoute({ loaderData }: Route.ComponentProps) {
  return (
    <div className="stack-xl">
      <PageHeader title="리더보드 🏆" sub="우리 반 팀 현황을 한눈에 모아 봤어요" />

      {loaderData.teams.length === 0 ? (
        <EmptyState>아직 팀이 없어요. 첫 팀을 만들어 보세요!</EmptyState>
      ) : (
        <div className="grid-2 rank-list">
          {loaderData.teams.map((t) => (
            <article key={t.id} className="rank-card">
              <h3 className="rank-card__name">{t.name}</h3>
              <p className="rank-card__members">
                {t.members.length > 0 ? t.members.join(" · ") : "1인 팀"}
              </p>

              <dl>
                <div className="row">
                  <dt>아이템</dt>
                  <dd>{t.itemName?.trim() || <span className="faint">미정</span>}</dd>
                </div>
                <div className="row">
                  <dt>판매 채널</dt>
                  <dd>{t.salesChannel?.trim() || <span className="faint">미정</span>}</dd>
                </div>
                <div className="row">
                  <dt>사업자등록</dt>
                  <dd>
                    <MilestoneBadge status={t.businessStatus} labels={BUSINESS_STATUS_LABELS} />
                  </dd>
                </div>
                <div className="row">
                  <dt>통신판매업</dt>
                  <dd>
                    <MilestoneBadge status={t.mailOrderStatus} labels={MAIL_ORDER_STATUS_LABELS} />
                  </dd>
                </div>
              </dl>

              {t.memo?.trim() ? <p className="rank-memo">📝 {t.memo}</p> : null}

              <p className="small faint right num mt-3">
                최근 업데이트 {fmtKST(t.updatedAt, { month: "numeric", day: "numeric" })}
              </p>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
