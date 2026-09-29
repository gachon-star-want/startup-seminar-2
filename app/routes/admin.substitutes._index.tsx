import { Form, Link, useActionData } from "react-router";
import type { Route } from "./+types/admin.substitutes._index";
import { requireAdminAppContext } from "~/lib/context.server";
import { SubstituteHub } from "~/modules/substitutes/index.server";
import { fmtKST } from "~/lib/time";
import { Badge, Card, EmptyState, ErrorText, Field, SectionTitle } from "~/components/ui";

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = await requireAdminAppContext(request, context);
  return { assignments: await SubstituteHub.listForAdmin(ctx) };
}

export async function action({ request, context }: Route.ActionArgs) {
  const ctx = await requireAdminAppContext(request, context);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "create") {
    const result = await SubstituteHub.createAssignment(ctx, {
      title: String(form.get("title") ?? ""),
      description: String(form.get("description") ?? ""),
      opensAtRaw: String(form.get("opensAt") ?? ""),
      closesAtRaw: String(form.get("closesAt") ?? ""),
    });
    if (!result.ok) return { error: result.message };
    return { error: undefined };
  }

  if (intent === "delete") {
    await SubstituteHub.deleteAssignment(ctx, String(form.get("assignmentId") ?? ""));
    return { error: undefined };
  }

  return { error: "알 수 없는 요청이에요." };
}

const phaseTone = { scheduled: "gray", open: "green", closed: "indigo" } as const;
const phaseLabel = { scheduled: "제출 예정", open: "제출 중", closed: "마감" } as const;

export default function AdminSubstitutesRoute({ loaderData }: Route.ComponentProps) {
  const actionData = useActionData<typeof action>();

  return (
    <div className="stack-xl">
      <Card>
        <SectionTitle>출석 대체 과제 만들기</SectionTitle>
        <p className="small muted help-text">
          결석한 학생이 보고서를 제출해 <strong>대체출석</strong>으로 만회할 수 있는 과제를 만들어요.
          학생은 본인의 결석 수업을 선택해 제출하고, 승인하면 그 수업의 출석 기록이 결석 → 대체출석으로
          바뀌어요.
        </p>
        <Form method="post">
          <input type="hidden" name="intent" value="create" />
          <div className="grid-2">
            <Field label="과제 제목" htmlFor="sub-title">
              <input
                id="sub-title"
                name="title"
                className="input"
                placeholder="예: 중간 결석 대체 보고서"
                required
              />
            </Field>
            <div className="grid-2">
              <Field label="제출 시작 (KST)" htmlFor="sub-opens">
                <input id="sub-opens" name="opensAt" type="datetime-local" className="input num" required />
              </Field>
              <Field label="제출 마감 (KST)" htmlFor="sub-closes">
                <input id="sub-closes" name="closesAt" type="datetime-local" className="input num" required />
              </Field>
            </div>
          </div>
          <Field label="안내 (보고서 주제·분량 등)" htmlFor="sub-desc">
            <textarea
              id="sub-desc"
              name="description"
              rows={2}
              className="input"
              placeholder="예: 결석한 수업의 주요 내용을 요약하고 배운 점을 2페이지 분량으로 작성해 주세요."
            />
          </Field>
          <ErrorText>{actionData?.error}</ErrorText>
          <button type="submit" className="btn btn--primary mt-4">
            과제 만들기
          </button>
        </Form>
      </Card>

      {loaderData.assignments.length === 0 ? (
        <EmptyState>만들어진 출석 대체 과제가 아직 없어요.</EmptyState>
      ) : (
        <div className="stack-md">
          <h2 className="section-label">과제 목록</h2>
          {loaderData.assignments.map((a) => (
            <Card key={a.id}>
              <div className="cluster cluster--between">
                <div className="minw-0">
                  <div className="cluster">
                    <Link to={`/admin/substitutes/${a.id}`} prefetch="intent" className="link-title" title={a.title}>
                      {a.title}
                    </Link>
                    <Badge tone={phaseTone[a.phase]}>{phaseLabel[a.phase]}</Badge>
                  </div>
                  <p className="small faint num" style={{ marginTop: "0.25rem" }}>
                    제출 {fmtKST(new Date(a.opensAt), { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" })}
                    {" ~ "}
                    {fmtKST(new Date(a.closesAt), { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" })}
                    {" · 보고서 "}
                    {a.submissionCount}건 (승인 {a.approvedCount}건)
                  </p>
                </div>
                <div className="cluster cluster--col">
                  <Link to={`/admin/substitutes/${a.id}`} prefetch="intent" className="card__link">
                    제출물 확인 →
                  </Link>
                  <Form
                    method="post"
                    onSubmit={(e) => {
                      if (!confirm("이 대체 과제와 그 안의 모든 보고서가 삭제됩니다. 계속할까요?")) {
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
