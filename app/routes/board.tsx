import type { Route } from "./+types/board";
import { TeamRoster } from "~/modules/teams/index.server";
import { requireAppContext } from "~/lib/context.server";
import { BUSINESS_STATUS_LABELS, MAIL_ORDER_STATUS_LABELS } from "~/lib/constants";
import { fmtKST } from "~/lib/time";
import { EmptyState, MilestoneBadge, PageHeader } from "~/components/ui";

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = await requireAppContext(request, context);
  const teams = await TeamRoster.getLeaderboard(ctx);
  return { teams };
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
