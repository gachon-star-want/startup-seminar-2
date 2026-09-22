import { Link } from "react-router";
import type { Route } from "./+types/evaluations._index";
import { requireAppContext } from "~/lib/context.server";
import { EvaluationHub } from "~/modules/evaluations/index.server";
import { fmtKST, ymdLabel } from "~/lib/time";
import { Badge, Card, EmptyState, PageHeader, SectionTitle } from "~/components/ui";

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = await requireAppContext(request, context);
  return EvaluationHub.listSessionsForStudent(ctx);
}

const phaseBadge = {
  scheduled: <Badge tone="gray">평가 예정</Badge>,
  open: <Badge tone="green">평가 중</Badge>,
  closed: <Badge tone="indigo">평가 마감</Badge>,
};

export default function EvaluationsRoute({ loaderData }: Route.ComponentProps) {
  const sessions = loaderData.sessions;
  const openCount = sessions.filter((s) => s.phase === "open").length;

  return (
    <div className="stack-xl">
      <PageHeader
        title="발표 평가"
        sub="동기들의 발표를 보고 점수와 코멘트를 남겨주세요"
      />

      {sessions.length === 0 ? (
        <EmptyState>아직 등록된 발표 평가가 없어요.</EmptyState>
      ) : (
        <>
          {openCount > 0 ? (
            <Card>
              <p className="small muted help-text">
                ✍️ 지금 평가할 수 있는 세션이 <strong>{openCount}개</strong> 있어요. 마감 전에 평가를
                완료해 주세요!
              </p>
            </Card>
          ) : null}

          <section>
            <h2 className="section-label">평가 세션</h2>
            <ul className="stack-sm bare-list">
              {sessions.map((s) => {
                const canEvaluate = s.phase === "open" && s.targetCount > 0;
                const progress =
                  s.targetCount > 0 ? `${Math.min(s.myCount, s.targetCount)}/${s.targetCount}` : "0/0";
                const done = s.targetCount > 0 && s.myCount >= s.targetCount;
                return (
                  <li key={s.id}>
                    <Link
                      to={`/evaluations/${s.id}`}
                      prefetch="intent"
                      className="item-link"
                    >
                      <div className="minw-0">
                        <div className="cluster">
                          <span className="item-link__title" title={s.title}>
                            {s.title}
                          </span>
                          {phaseBadge[s.phase]}
                        </div>
                        <p className="item-link__meta num">
                          {ymdLabel(s.sessionDate)}
                          {s.assignmentTitle ? ` · ${s.assignmentTitle}` : ""}
                        </p>
                        <p className="item-link__meta num">
                          평가 기간{" "}
                          {fmtKST(new Date(s.opensAt), { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" })}
                          {" ~ "}
                          {fmtKST(new Date(s.closesAt), { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" })}
                        </p>
                      </div>
                      <div className="cluster flex-shrink-0">
                        <span className={`badge num ${done ? "badge--green" : "badge--gray"}`}>
                          내 평가 {progress}
                        </span>
                        {canEvaluate ? <Badge tone="amber">평가하기</Badge> : null}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      )}

      <Card>
        <SectionTitle>평가 방법</SectionTitle>
        <p className="small muted help-text">
          모든 팀의 발표를 대상으로, 각 팀 발표에 <strong>별점(5개 만점)</strong>과 세부 코멘트(최대
          300바이트)를 남겨요. 우리 팀 발표도 평가 대상이에요. 또 그 팀 안에서 팀원 한 명 한 명에게
          개별 별점과 코멘트를 줄 수 있어요. 평가는 관리자가 설정한 기간 안에만 제출할 수 있고,
          기간 안이라면 몇 번이고 수정할 수 있어요.
        </p>
      </Card>
    </div>
  );
}
