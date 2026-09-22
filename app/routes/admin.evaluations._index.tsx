import { Form, Link, useActionData } from "react-router";
import type { Route } from "./+types/admin.evaluations._index";
import { requireAdminAppContext } from "~/lib/context.server";
import { EvaluationHub } from "~/modules/evaluations/index.server";
import { fmtKST, ymdLabel } from "~/lib/time";
import { Badge, Card, EmptyState, ErrorText, Field, SectionTitle } from "~/components/ui";

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = await requireAdminAppContext(request, context);
  const [sessions, assignments] = await Promise.all([
    EvaluationHub.listSessionsForAdmin(ctx),
    EvaluationHub.listAssignmentOptions(ctx),
  ]);
  return { ...sessions, assignments };
}

export async function action({ request, context }: Route.ActionArgs) {
  const ctx = await requireAdminAppContext(request, context);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "create") {
    const result = await EvaluationHub.createSession(ctx, {
      sessionDate: String(form.get("sessionDate") ?? ""),
      title: String(form.get("title") ?? ""),
      description: String(form.get("description") ?? ""),
      assignmentId: String(form.get("assignmentId") ?? ""),
      opensAtRaw: String(form.get("opensAt") ?? ""),
      closesAtRaw: String(form.get("closesAt") ?? ""),
    });
    if (!result.ok) return { error: result.message };
    return { error: undefined };
  }

  if (intent === "delete") {
    await EvaluationHub.deleteSession(ctx, String(form.get("sessionId") ?? ""));
    return { error: undefined };
  }

  return { error: "알 수 없는 요청이에요." };
}

const phaseTone = { scheduled: "gray", open: "green", closed: "indigo" } as const;
const phaseLabel = { scheduled: "평가 예정", open: "평가 중", closed: "평가 마감" } as const;

export default function AdminEvaluationsRoute({ loaderData }: Route.ComponentProps) {
  const actionData = useActionData<typeof action>();

  return (
    <div className="stack-xl">
      <Card>
        <SectionTitle>발표 평가 세션 만들기</SectionTitle>
        <p className="small muted help-text">
          언제 발표가 있는지(날짜·제목), 학생들이 언제부터 언제까지 평가할 수 있는지(평가 창)를
          설정해요. 평가 대상 과제를 연결하면 그 과제의 제출물들이 발표 목록으로 평가 화면에
          나타나요.
        </p>
        <Form method="post">
          <input type="hidden" name="intent" value="create" />
          <div className="grid-2">
            <Field label="발표 날짜" htmlFor="ev-date">
              <input id="ev-date" name="sessionDate" type="date" className="input num" required />
            </Field>
            <Field label="발표 제목 (무슨 내용의 발표인가요?)" htmlFor="ev-title">
              <input
                id="ev-title"
                name="title"
                className="input"
                placeholder="예: 3주차 팀별 발표 — 시장조사 결과"
                required
              />
            </Field>
          </div>
          <Field label="설명 (선택)" htmlFor="ev-desc">
            <textarea
              id="ev-desc"
              name="description"
              rows={2}
              className="input"
              placeholder="발표 안내, 평가 기준 등을 학생들에게 알려주세요"
            />
          </Field>
          <div className="grid-2">
            <Field label="평가 대상 과제 (제출물이 발표가 돼요)" htmlFor="ev-assignment">
              <select id="ev-assignment" name="assignmentId" className="input">
                <option value="">— 대상 없음 (평가만 진행) —</option>
                {loaderData.assignments.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.title} (마감 {fmtKST(new Date(a.dueAt), { month: "numeric", day: "numeric" })})
                  </option>
                ))}
              </select>
            </Field>
            <div className="grid-2">
              <Field label="평가 시작 (KST)" htmlFor="ev-opens">
                <input id="ev-opens" name="opensAt" type="datetime-local" className="input num" required />
              </Field>
              <Field label="평가 마감 (KST)" htmlFor="ev-closes">
                <input id="ev-closes" name="closesAt" type="datetime-local" className="input num" required />
              </Field>
            </div>
          </div>
          <ErrorText>{actionData?.error}</ErrorText>
          <button type="submit" className="btn btn--primary mt-4">
            세션 만들기
          </button>
        </Form>
      </Card>

      {loaderData.sessions.length === 0 ? (
        <EmptyState>만들어진 발표 평가 세션이 아직 없어요.</EmptyState>
      ) : (
        <div className="stack-md">
          <h2 className="section-label">세션 목록</h2>
          {loaderData.sessions.map((s) => (
            <Card key={s.id}>
              <div className="cluster cluster--between">
                <div className="minw-0">
                  <div className="cluster">
                    <Link to={`/admin/evaluations/${s.id}`} prefetch="intent" className="link-title" title={s.title}>
                      {s.title}
                    </Link>
                    <Badge tone={phaseTone[s.phase]}>{phaseLabel[s.phase]}</Badge>
                  </div>
                  <p className="small faint num" style={{ marginTop: "0.25rem" }}>
                    {ymdLabel(s.sessionDate)}
                    {s.assignmentTitle ? ` · 대상 과제: ${s.assignmentTitle}` : " · 대상 과제 없음"}
                  </p>
                  <p className="small faint num">
                    평가 {fmtKST(new Date(s.opensAt), { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" })}
                    {" ~ "}
                    {fmtKST(new Date(s.closesAt), { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" })}
                    {" · 발표 "}
                    {s.targetCount}건 · 평가 {s.evaluationCount}건 ({s.evaluatorCount}명 참여)
                  </p>
                </div>
                <div className="cluster cluster--col">
                  <Link to={`/admin/evaluations/${s.id}`} prefetch="intent" className="card__link">
                    상세·결과 →
                  </Link>
                  <Form
                    method="post"
                    onSubmit={(e) => {
                      if (!confirm("이 평가 세션과 그 안의 모든 평가 기록이 삭제됩니다. 계속할까요?")) {
                        e.preventDefault();
                      }
                    }}
                  >
                    <input type="hidden" name="intent" value="delete" />
                    <input type="hidden" name="sessionId" value={s.id} />
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
