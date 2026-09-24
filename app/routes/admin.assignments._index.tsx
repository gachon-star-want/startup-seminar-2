import { Form, Link, useActionData } from "react-router";
import type { Route } from "./+types/admin.assignments._index";
import { requireAdminAppContext } from "~/lib/context.server";
import { SubmissionHub } from "~/modules/submissions/index.server";
import { fmtKST } from "~/lib/time";
import { Badge, Card, ErrorText, Field, SectionTitle } from "~/components/ui";

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = await requireAdminAppContext(request, context);
  const list = await SubmissionHub.getAdminList(ctx);
  return { assignments: list };
}

export async function action({ request, context }: Route.ActionArgs) {
  const ctx = await requireAdminAppContext(request, context);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "create") {
    const result = await SubmissionHub.createAssignment(ctx, {
      title: String(form.get("title") ?? ""),
      description: String(form.get("description") ?? ""),
      dueAtRaw: String(form.get("dueAt") ?? ""),
      unit: String(form.get("unit") ?? "team"),
    });
    if (!result.ok) return { error: result.message, ok: false };
    return { ok: true, error: undefined };
  }

  if (intent === "delete") {
    const id = String(form.get("assignmentId") ?? "");
    await SubmissionHub.deleteAssignment(ctx, id);
    return { ok: true, error: undefined };
  }

  return { error: "알 수 없는 요청이에요.", ok: false };
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
            <Field
              label="과제 제출 단위 (팀 vs 개인)"
              htmlFor="a-unit"
              hint="팀 과제는 팀원 누구나 제출/수정할 수 있고 조당 1건으로 기록됩니다. 개인 과제는 학생별로 각자 제출합니다."
            >
              <select id="a-unit" name="unit" className="input" defaultValue="team">
                <option value="team">👥 팀 과제 (조당 1건 · 팀원 공통 제출)</option>
                <option value="individual">👤 개인 과제 (학생별 1인 1건 개별 제출)</option>
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
                    <Link to={`/admin/assignments/${a.id}`} prefetch="intent" className="link-title" title={a.title}>
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
                  <Link to={`/admin/assignments/${a.id}`} prefetch="intent" className="card__link">
                    제출물 보기 →
                  </Link>
                  <Form
                    method="post"
                    onSubmit={(e) => {
                      if (!confirm(`"${a.title}" 과제를 삭제할까요?\n관련된 모든 제출물과 파일이 함께 삭제되고 되돌릴 수 없어요.`)) {
                        e.preventDefault();
                      }
                    }}
                  >
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
