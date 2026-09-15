import { Link, useActionData } from "react-router";
import type { Route } from "./+types/admin.assignments";
import { desc, eq, sql } from "drizzle-orm";
import { assignments, submissions } from "~/db/schema";
import { requireAdmin } from "~/lib/session";
import { fmtKST } from "~/lib/time";
import { Badge, Card, ErrorText, SectionTitle, btnDanger, btnPrimary, inputClass, labelClass } from "~/components/ui";

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
    <div className="space-y-6">
      <Card>
        <SectionTitle>과제 만들기</SectionTitle>
        <form method="post" className="space-y-4">
          <input type="hidden" name="intent" value="create" />
          <div>
            <label className={labelClass} htmlFor="a-title">제목</label>
            <input id="a-title" name="title" className={inputClass} placeholder="예: 3주차 시장조사 리포트" required />
          </div>
          <div>
            <label className={labelClass} htmlFor="a-desc">설명</label>
            <textarea id="a-desc" name="description" rows={3} className={inputClass} placeholder="과제 안내 (선택)" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelClass} htmlFor="a-due">마감일시 (한국 시간)</label>
              <input id="a-due" name="dueAt" type="datetime-local" className={inputClass} required />
            </div>
            <div>
              <label className={labelClass} htmlFor="a-unit">제출 단위</label>
              <select id="a-unit" name="unit" className={inputClass} defaultValue="team">
                <option value="team">팀 과제 (조당 1건)</option>
                <option value="individual">개인 과제</option>
              </select>
            </div>
          </div>
          <ErrorText>{actionData?.error}</ErrorText>
          <button type="submit" className={btnPrimary}>
            과제 만들기
          </button>
        </form>
      </Card>

      {loaderData.assignments.length === 0 ? (
        <Card>
          <p className="text-sm text-slate-500">만들어진 과제가 아직 없어요.</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {loaderData.assignments.map((a) => (
            <Card key={a.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link to={`/admin/assignments/${a.id}`} className="font-bold text-slate-900 hover:text-indigo-600">
                      {a.title}
                    </Link>
                    <Badge tone={a.unit === "team" ? "indigo" : "gray"}>
                      {a.unit === "team" ? "팀" : "개인"}
                    </Badge>
                    <Badge tone="gray">제출 {a.submissionCount}건</Badge>
                  </div>
                  <p className="mt-1 text-xs text-slate-400">
                    마감 {fmtKST(new Date(a.dueAt), { year: "numeric", month: "numeric", day: "numeric", weekday: "short", hour: "numeric", minute: "2-digit" })}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <Link
                    to={`/admin/assignments/${a.id}`}
                    className="text-xs font-semibold text-indigo-600 hover:underline"
                  >
                    제출물 보기 →
                  </Link>
                  <form method="post">
                    <input type="hidden" name="intent" value="delete" />
                    <input type="hidden" name="assignmentId" value={a.id} />
                    <button type="submit" className={btnDanger}>
                      삭제
                    </button>
                  </form>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
