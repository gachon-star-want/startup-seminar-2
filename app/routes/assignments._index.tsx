import { Link } from "react-router";
import type { Route } from "./+types/assignments._index";
import { desc, eq, and } from "drizzle-orm";
import { assignments as assignmentsTable, submissions, teamMembers } from "~/db/schema";
import { requireUser } from "~/lib/session";
import { dDay, fmtKST } from "~/lib/time";
import { Badge, Card, EmptyState, PageHeader } from "~/components/ui";

export async function loader({ request, context }: Route.LoaderArgs) {
  const { user, db } = await requireUser(request, context);
  const now = new Date();

  const list = await db.select().from(assignmentsTable).orderBy(desc(assignmentsTable.dueAt));

  const [membership] = await db
    .select({ teamId: teamMembers.teamId })
    .from(teamMembers)
    .where(eq(teamMembers.userId, user.id))
    .limit(1);

  const result = [];
  for (const a of list) {
    const conditions = [eq(submissions.assignmentId, a.id)];
    if (a.unit === "team") {
      if (membership) conditions.push(eq(submissions.teamId, membership.teamId));
    } else {
      conditions.push(eq(submissions.userId, user.id));
    }
    const [sub] = await db
      .select({ id: submissions.id })
      .from(submissions)
      .where(and(...conditions))
      .limit(1);
    result.push({
      id: a.id,
      title: a.title,
      description: a.description,
      dueAt: a.dueAt,
      unit: a.unit,
      closed: a.dueAt < now,
      submitted: Boolean(sub),
    });
  }

  return { assignments: result };
}

export default function AssignmentsRoute({ loaderData }: Route.ComponentProps) {
  const open = loaderData.assignments.filter((a) => !a.closed);
  const closed = loaderData.assignments.filter((a) => a.closed);

  const renderItem = (a: (typeof loaderData.assignments)[number]) => {
    const dd = dDay(a.dueAt);
    return (
      <li key={a.id}>
        <Link to={`/assignments/${a.id}`} className="item-link">
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
      <PageHeader title="과제" sub="텍스트 · 링크 · 파일로 제출할 수 있어요" />

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
