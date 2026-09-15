import type { Route } from "./+types/board";
import { eq } from "drizzle-orm";
import { teamMembers, teams, users } from "~/db/schema";
import { requireUser } from "~/lib/session";
import { BUSINESS_STATUS_LABELS, MAIL_ORDER_STATUS_LABELS } from "~/lib/constants";
import { teamScore, MAX_TEAM_SCORE } from "~/lib/score";
import { fmtKST } from "~/lib/time";
import { Badge, EmptyState, MilestoneBadge, PageHeader } from "~/components/ui";

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

const medals = ["🥇", "🥈", "🥉"];

export default function BoardRoute({ loaderData }: Route.ComponentProps) {
  return (
    <div className="stack-xl">
      <PageHeader
        title="리더보드 🏆"
        sub={`아이템 확정 1점 · 판매 채널 확정 1점 · 사업자등록(신청중 1/완료 2점) · 통신판매업신고(신고중 1/완료 2점) = 최대 ${MAX_TEAM_SCORE}점`}
      />

      {loaderData.teams.length === 0 ? (
        <EmptyState>아직 팀이 없어요. 첫 팀을 만들어 보세요!</EmptyState>
      ) : (
        <div className="grid-2 rank-list">
          {loaderData.teams.map((t) => (
            <article key={t.id} className={`rank-card${t.rank === 1 ? " rank-card--top" : ""}`}>
              <div className="rank-card__head">
                <div style={{ minWidth: 0 }}>
                  <div className="cluster">
                    <span
                      className={`rank-badge${t.rank <= 3 ? ` rank-badge--${t.rank}` : ""}`}
                      aria-label={`${t.rank}위`}
                    >
                      {t.rank <= 3 ? medals[t.rank - 1] : t.rank}
                    </span>
                    <h3 className="rank-card__name">{t.name}</h3>
                  </div>
                  <p className="rank-card__members">
                    {t.members.length > 0 ? t.members.join(" · ") : "1인 팀"}
                  </p>
                </div>
                <Badge tone="indigo">
                  {t.score} / {MAX_TEAM_SCORE}점
                </Badge>
              </div>

              <div className="progress mt-3">
                <div
                  className="progress__bar"
                  style={{ width: `${(t.score / MAX_TEAM_SCORE) * 100}%` }}
                />
              </div>

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

              <p className="small faint right num" style={{ marginTop: "0.75rem" }}>
                최근 업데이트 {fmtKST(t.updatedAt, { month: "numeric", day: "numeric" })}
              </p>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
