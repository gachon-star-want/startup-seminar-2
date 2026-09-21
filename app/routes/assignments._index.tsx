import { Link } from "react-router";
import type { Route } from "./+types/assignments._index";
import { desc, eq, and, or, inArray } from "drizzle-orm";
import { assignments as assignmentsTable, submissions, teamMembers } from "~/db/schema";
import { requireAppContext } from "~/lib/context.server";
import { dDay, fmtKST } from "~/lib/time";
import { Badge, Card, EmptyState, PageHeader } from "~/components/ui";

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = await requireAppContext(request, context);
  const { user, db, now } = ctx;

  // 과제 목록과 내 팀 소속을 병렬로 1회 왕복에 조회
  const [list, [membership]] = await Promise.all([
    db.select().from(assignmentsTable).orderBy(desc(assignmentsTable.dueAt)),
    db
      .select({ teamId: teamMembers.teamId })
      .from(teamMembers)
      .where(eq(teamMembers.userId, user.id))
      .limit(1),
  ]);

  const assignmentIds = list.map((a) => a.id);

  // N+1 루프 쿼리를 완전히 제거하고 단 1회의 쿼리로 내(우리 팀) 제출 목록 일괄 조회
  const subConditions = [eq(submissions.userId, user.id)];
  if (membership?.teamId) {
    subConditions.push(eq(submissions.teamId, membership.teamId));
  }

  const mySubmissions =
    assignmentIds.length > 0
      ? await db
          .select({
            assignmentId: submissions.assignmentId,
            userId: submissions.userId,
            teamId: submissions.teamId,
          })
          .from(submissions)
          .where(and(inArray(submissions.assignmentId, assignmentIds), or(...subConditions)))
      : [];

  const teamSubMap = new Set(
    mySubmissions.filter((s) => s.teamId && s.teamId === membership?.teamId).map((s) => s.assignmentId),
  );
  const userSubMap = new Set(
    mySubmissions.filter((s) => s.userId === user.id).map((s) => s.assignmentId),
  );

  const result = list.map((a) => {
    const isSubmitted = a.unit === "team" ? teamSubMap.has(a.id) : userSubMap.has(a.id);
    return {
      id: a.id,
      title: a.title,
      description: a.description,
      dueAt: a.dueAt,
      unit: a.unit,
      closed: a.dueAt < now,
      submitted: isSubmitted,
    };
  });

  return { assignments: result };
}

export default function AssignmentsRoute({ loaderData }: Route.ComponentProps) {
  const open = loaderData.assignments.filter((a) => !a.closed);
  const closed = loaderData.assignments.filter((a) => a.closed);

  const renderItem = (a: (typeof loaderData.assignments)[number]) => {
    const dd = dDay(a.dueAt);
    return (
      <li key={a.id}>
        <Link to={`/assignments/${a.id}`} prefetch="intent" className="item-link">
          <div className="minw-0">
            <div className="cluster">
              <span className="item-link__title" title={a.title}>{a.title}</span>
              <Badge tone={a.unit === "team" ? "indigo" : "gray"}>
                {a.unit === "team" ? "팀 과제" : "개인 과제"}
              </Badge>
            </div>
            {a.description ? (
              <p className="item-link__meta" style={{ whiteSpace: "normal" }}>
                {a.description}
              </p>
            ) : null}
            <p className="item-link__meta num">
              마감{" "}
              {fmtKST(a.dueAt, {
                year: "numeric",
                month: "numeric",
                day: "numeric",
                weekday: "short",
                hour: "numeric",
                minute: "2-digit",
              })}
            </p>
          </div>
          {a.submitted ? (
            <Badge tone="green">제출완료</Badge>
          ) : a.closed ? (
            <Badge tone="red">마감</Badge>
          ) : (
            <Badge tone={dd <= 1 ? "red" : "amber"}>{dd === 0 ? "D-day" : `D-${dd}`}</Badge>
          )}
        </Link>
      </li>
    );
  };

  return (
    <div className="stack-xl">
      <PageHeader title="과제" sub="텍스트 · 링크 · 첨부파일로 제출할 수 있어요" />

      <section>
        <h2 className="section-label">진행 중</h2>
        {open.length === 0 ? (
          <EmptyState>진행 중인 과제가 없어요.</EmptyState>
        ) : (
          <ul className="stack-sm bare-list">
            {open.map(renderItem)}
          </ul>
        )}
      </section>

      {closed.length > 0 ? (
        <section>
          <h2 className="section-label">마감됨</h2>
          <ul className="stack-sm bare-list">
            {closed.map(renderItem)}
          </ul>
        </section>
      ) : null}

      <Card>
        <p className="small muted help-text">
          📎 텍스트·링크·첨부파일(모든 파일 형식 지원, 최대 10개 · 파일당 최대 100MB)로 제출 및 수정할 수 있어요. 팀 과제는 팀원 누구나
          제출/수정 가능하고 조당 1건으로 기록돼요.
        </p>
      </Card>
    </div>
  );
}
