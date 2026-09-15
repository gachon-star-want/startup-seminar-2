import { Form, Link, useActionData } from "react-router";
import type { Route } from "./+types/admin.assignments._index";
import { desc, eq, sql } from "drizzle-orm";
import { assignments, submissions } from "~/db/schema";
import { requireAdmin } from "~/lib/session";
import { fmtKST } from "~/lib/time";
import { Badge, Card, ErrorText, Field, SectionTitle } from "~/components/ui";

export async function loader({ request, context }: Route.LoaderArgs) {
  const { db } = await requireAdmin(request, context);

  const list = await db.select().from(assignments).orderBy(desc(assignments.dueAt));
  const counts = await db
    .select({ assignmentId: submissions.assignmentId, count: sql<number>`count(*)::int` })
    .from(submissions)
    .groupBy(submissions.assignmentId);
  const countMap = new Map(counts.map((c) => [c.assignmentId, c.count]));

  return {
    assignments: list.map((a) => ({
      id: a.id,
      title: a.title,
      description: a.description,
      dueAt: a.dueAt.toISOString(),
      unit: a.unit,
      submissionCount: countMap.get(a.id) ?? 0,
    })),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { db } = await requireAdmin(request, context);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "create") {
    const title = String(form.get("title") ?? "").trim();
    const description = String(form.get("description") ?? "").trim();
    const dueAtRaw = String(form.get("dueAt") ?? "").trim();
    const unit = String(form.get("unit") ?? "team");

    if (!title) return { error: "과제 제목을 입력해 주세요." };
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(dueAtRaw)) {
      return { error: "마감일시를 입력해 주세요." };
    }
    const dueAt = new Date(`${dueAtRaw}:00+09:00`); // 입력은 한국 시간 기준
    if (Number.isNaN(dueAt.getTime())) return { error: "마감일시가 올바르지 않아요." };
    if (!["team", "individual"].includes(unit)) return { error: "제출 단위가 올바르지 않아요." };

    await db.insert(assignments).values({
      title,
      description: description || null,
      dueAt,
      unit,
    });
    return { ok: true };
  }

  if (intent === "delete") {
    const id = String(form.get("assignmentId") ?? "");
    await db.delete(assignments).where(eq(assignments.id, id));
    return { ok: true };
  }

  return { error: "알 수 없는 요청이에요." };
}

export default function AdminAssignmentsRoute({ loaderData }: Route.ComponentProps) {
  const actionData = useActionData<typeof action>();

  return (
    <div className="stack-xl">
      <Card>
        <SectionTitle>과제 만들기</SectionTitle>
        <Form method="post">
          <input type="hidden" name="intent" value="create" />
          <Field label="제목" htmlFor="a-title">
            <input id="a-title" name="title" className="input" placeholder="예: 3주차 시장조사 리포트" required />
          </Field>
          <Field label="설명" htmlFor="a-desc">
            <textarea id="a-desc" name="description" rows={3} className="input" placeholder="과제 안내 (선택)" />
          </Field>
          <div className="grid-2">
            <Field label="마감일시 (한국 시간)" htmlFor="a-due">
              <input id="a-due" name="dueAt" type="datetime-local" className="input num" required />
            </Field>
            <Field label="제출 단위" htmlFor="a-unit">
              <select id="a-unit" name="unit" className="input" defaultValue="team">
                <option value="team">팀 과제 (조당 1건)</option>
                <option value="individual">개인 과제</option>
              </select>
            </Field>
          </div>
          <ErrorText>{actionData?.error}</ErrorText>
          <button type="submit" className="btn btn--primary mt-4">
            과제 만들기
          </button>
        </Form>
      </Card>

      {loaderData.assignments.length === 0 ? (
        <Card>
          <p className="small muted">만들어진 과제가 아직 없어요.</p>
        </Card>
      ) : (
        <div className="stack-md">
          {loaderData.assignments.map((a) => (
            <Card key={a.id}>
              <div className="cluster cluster--between">
                <div className="minw-0">
                  <div className="cluster">
                    <Link to={`/admin/assignments/${a.id}`} className="link-title" title={a.title}>
                      {a.title}
                    </Link>
                    <Badge tone={a.unit === "team" ? "indigo" : "gray"}>
                      {a.unit === "team" ? "팀" : "개인"}
                    </Badge>
                    <Badge tone="gray">제출 {a.submissionCount}건</Badge>
                  </div>
                  <p className="small faint num" style={{ marginTop: "0.25rem" }}>
                    마감{" "}
                    {fmtKST(new Date(a.dueAt), {
                      year: "numeric",
                      month: "numeric",
                      day: "numeric",
                      weekday: "short",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
                <div className="cluster cluster--col">
                  <Link to={`/admin/assignments/${a.id}`} className="card__link">
                    제출물 보기 →
                  </Link>
                  <Form method="post">
                    <input type="hidden" name="intent" value="delete" />
                    <input type="hidden" name="assignmentId" value={a.id} />
                    <button type="submit" className="btn btn--danger btn--sm">
                      삭제
                    </button>
                  </Form>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
