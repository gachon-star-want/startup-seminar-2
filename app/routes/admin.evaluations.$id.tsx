import { useState } from "react";
import { Form, Link, redirect, useActionData } from "react-router";
import type { Route } from "./+types/admin.evaluations.$id";
import { requireAdminAppContext } from "~/lib/context.server";
import { EvaluationHub } from "~/modules/evaluations/index.server";
import { fmtKST, ymdLabel } from "~/lib/time";
import { IconArrowLeft } from "~/components/icons";
import { Badge, Card, EmptyState, ErrorText, Field, SectionTitle } from "~/components/ui";

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const ctx = await requireAdminAppContext(request, context);
  const [detail, assignments] = await Promise.all([
    EvaluationHub.getSessionAdminDetail(ctx, params.id!),
    EvaluationHub.listAssignmentOptions(ctx),
  ]);
  return { detail, assignments };
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const ctx = await requireAdminAppContext(request, context);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "update") {
    const result = await EvaluationHub.updateSession(ctx, params.id!, {
      sessionDate: String(form.get("sessionDate") ?? ""),
      title: String(form.get("title") ?? ""),
      description: String(form.get("description") ?? ""),
      assignmentId: String(form.get("assignmentId") ?? ""),
      opensAtRaw: String(form.get("opensAt") ?? ""),
      closesAtRaw: String(form.get("closesAt") ?? ""),
    });
    if (!result.ok) return { error: result.message, message: undefined as string | undefined };
    return { error: undefined as string | undefined, message: "세션 설정이 수정되었어요." };
  }

  if (intent === "delete") {
    await EvaluationHub.deleteSession(ctx, params.id!);
    return redirect("/admin/evaluations");
  }

  return { error: "알 수 없는 요청이에요.", message: undefined as string | undefined };
}

const phaseTone = { scheduled: "gray", open: "green", closed: "indigo" } as const;
const phaseLabel = { scheduled: "평가 예정", open: "평가 중", closed: "평가 마감" } as const;

export default function AdminEvaluationDetailRoute({ loaderData }: Route.ComponentProps) {
  const actionData = useActionData<typeof action>();
  const { session: s, targets, evaluators, totalEvaluationCount } = loaderData.detail;
  const [isEditing, setIsEditing] = useState(false);

  return (
    <div className="stack-xl">
      <div>
        <Link to="/admin/evaluations" className="back-link">
          <IconArrowLeft />
          발표 평가 관리
        </Link>
        <div className="cluster cluster--between">
          <div className="cluster minw-0">
            <h1 className="page-head__title page-head__title--sm ellipsis">{s.title}</h1>
            <Badge tone={phaseTone[s.phase]}>{phaseLabel[s.phase]}</Badge>
          </div>
          <div className="cluster flex-shrink-0">
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => setIsEditing(!isEditing)}
            >
              {isEditing ? "닫기" : "⚙️ 세션 설정 수정"}
            </button>
            <a href={`/admin/evaluations/${s.id}/xlsx`} className="btn btn--primary btn--sm">
              ⬇ 평가 결과 스프레드시트(XLSX)
            </a>
          </div>
        </div>
        <p className="page-head__sub num">
          {ymdLabel(s.sessionDate)}
          {s.assignmentTitle ? ` · 대상 과제: ${s.assignmentTitle}` : " · 대상 과제 없음"} · 평가{" "}
          {fmtKST(new Date(s.opensAt), { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" })}
          {" ~ "}
          {fmtKST(new Date(s.closesAt), { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" })}
        </p>
        {s.description ? (
          <p className="card small muted help-text notice-body mt-2">{s.description}</p>
        ) : null}
      </div>

      {actionData?.message ? (
        <div className="notice notice--success" style={{ padding: "0.75rem 1rem", borderRadius: "8px" }}>
          <p className="small" style={{ color: "var(--success, #10b981)", fontWeight: 600 }}>
            {actionData.message}
          </p>
        </div>
      ) : null}
      <ErrorText>{actionData?.error}</ErrorText>

      {s.phase !== "closed" ? (
        <Card>
          <p className="small muted">
            ⏳ 아직 평가가 진행 중{phaseLabel[s.phase] === "평가 예정" ? "이기 전이에요" : "이에요"}
            . 마감 후에도 언제든 이 페이지에서 결과를 내려받을 수 있어요.
          </p>
        </Card>
      ) : null}

      {/* 세션 설정 수정 */}
      {isEditing ? (
        <Card>
          <SectionTitle>세션 설정 수정</SectionTitle>
          <Form method="post">
            <input type="hidden" name="intent" value="update" />
            <div className="grid-2">
              <Field label="발표 날짜" htmlFor="edit-ev-date">
                <input
                  id="edit-ev-date"
                  name="sessionDate"
                  type="date"
                  className="input num"
                  defaultValue={s.sessionDate}
                  required
                />
              </Field>
              <Field label="발표 제목" htmlFor="edit-ev-title">
                <input id="edit-ev-title" name="title" className="input" defaultValue={s.title} required />
              </Field>
            </div>
            <Field label="설명" htmlFor="edit-ev-desc">
              <textarea
                id="edit-ev-desc"
                name="description"
                rows={2}
                className="input"
                defaultValue={s.description ?? ""}
              />
            </Field>
            <div className="grid-2">
              <Field label="평가 대상 과제" htmlFor="edit-ev-assignment">
                <select
                  id="edit-ev-assignment"
                  name="assignmentId"
                  className="input"
                  defaultValue={s.assignmentId ?? ""}
                >
                  <option value="">— 대상 없음 (평가만 진행) —</option>
                  {loaderData.assignments.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.title}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="grid-2">
                <Field label="평가 시작 (KST)" htmlFor="edit-ev-opens">
                  <input
                    id="edit-ev-opens"
                    name="opensAt"
                    type="datetime-local"
                    className="input num"
                    defaultValue={s.opensAtLocal}
                    required
                  />
                </Field>
                <Field label="평가 마감 (KST)" htmlFor="edit-ev-closes">
                  <input
                    id="edit-ev-closes"
                    name="closesAt"
                    type="datetime-local"
                    className="input num"
                    defaultValue={s.closesAtLocal}
                    required
                  />
                </Field>
              </div>
            </div>
            <div className="cluster mt-4">
              <button type="submit" className="btn btn--primary">
                설정 저장
              </button>
              <button type="button" className="btn btn--ghost" onClick={() => setIsEditing(false)}>
                취소
              </button>
            </div>
          </Form>

          <div style={{ marginTop: "1.5rem", paddingTop: "1rem", borderTop: "1px solid var(--border, #e5e7eb)" }}>
            <div className="cluster cluster--between">
              <span className="small text-danger">⚠️ 세션을 삭제하면 학생들이 남긴 평가도 함께 삭제됩니다.</span>
              <Form
                method="post"
                onSubmit={(e) => {
                  if (!confirm("정말 이 평가 세션을 삭제하시겠습니까? 평가 기록도 모두 사라집니다.")) {
                    e.preventDefault();
                  }
                }}
              >
                <input type="hidden" name="intent" value="delete" />
                <button type="submit" className="btn btn--danger btn--sm">
                  세션 삭제
                </button>
              </Form>
            </div>
          </div>
        </Card>
      ) : null}

      {/* 팀별 평균 */}
      <Card className="card--flush">
        <div className="card__head card__head--flush">
          <h2 className="card__title">📊 팀별 평균 별점 (5점 만점)</h2>
          <p className="small faint num">
            팀 평가 {loaderData.detail.rows.filter((r) => r.kind === "team").length}건 · 개인 평가{" "}
            {loaderData.detail.rows.filter((r) => r.kind === "member").length}건 · 참여 {evaluators.length}명
          </p>
        </div>
        {targets.length === 0 ? (
          <p className="small muted" style={{ padding: "1rem 1rem 1.25rem" }}>
            평가 대상 과제가 연결되지 않았어요.
          </p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>발표</th>
                  <th>발표자</th>
                  <th style={{ textAlign: "center" }}>평가자 수</th>
                  <th style={{ textAlign: "center" }}>평균 별점</th>
                </tr>
              </thead>
              <tbody>
                {targets.map((t) => (
                  <tr key={t.teamId}>
                    <td>{t.label}</td>
                    <td className="small muted">{t.presenter}</td>
                    <td className="num" style={{ textAlign: "center" }}>
                      {t.evaluatorCount}
                    </td>
                    <td className="num" style={{ textAlign: "center", fontWeight: 700 }}>
                      {t.avgStar.toFixed(1)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* 팀원별 평균 */}
      {loaderData.detail.memberStats.length > 0 ? (
        <Card className="card--flush">
          <div className="card__head card__head--flush">
            <h2 className="card__title">👤 팀원별 평균 별점 (5점 만점)</h2>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>발표</th>
                  <th>팀원</th>
                  <th style={{ textAlign: "center" }}>평가자 수</th>
                  <th style={{ textAlign: "center" }}>평균 별점</th>
                </tr>
              </thead>
              <tbody>
                {loaderData.detail.memberStats.map((m) => (
                  <tr key={`${m.teamLabel}-${m.name}`}>
                    <td>{m.teamLabel}</td>
                    <td>{m.name}</td>
                    <td className="num" style={{ textAlign: "center" }}>
                      {m.evaluatorCount}
                    </td>
                    <td className="num" style={{ textAlign: "center", fontWeight: 700 }}>
                      {m.avgStar.toFixed(1)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {/* 평가자별 진행률 */}
      {evaluators.length > 0 ? (
        <Card>
          <SectionTitle>👥 평가자별 완료 수</SectionTitle>
          <p className="small muted">
            {evaluators.map((e) => `${e.name} ${e.doneCount}건`).join(" · ")}
          </p>
        </Card>
      ) : null}

      {totalEvaluationCount === 0 ? (
        <EmptyState>아직 제출된 평가가 없어요.</EmptyState>
      ) : (
        <Card className="card--flush">
          <div className="card__head card__head--flush">
            <h2 className="card__title">📝 평가 원본</h2>
            <p className="small faint">XLSX 다운로드에 포함되는 데이터예요</p>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>발표</th>
                  <th>구분</th>
                  <th>대상</th>
                  <th>평가자</th>
                  <th style={{ textAlign: "center" }}>별점</th>
                  <th>코멘트</th>
                </tr>
              </thead>
              <tbody>
                {loaderData.detail.rows.map((r, i) => (
                  <tr key={`${r.evaluator}-${r.presentation}-${r.target}-${i}`}>
                    <td>{r.presentation}</td>
                    <td className="small muted">{r.kind === "team" ? "팀 발표" : "개인(팀원)"}</td>
                    <td>{r.target}</td>
                    <td>{r.evaluator}</td>
                    <td className="num" style={{ textAlign: "center", fontWeight: 700 }}>
                      ★{r.star}
                    </td>
                    <td className="small muted" style={{ whiteSpace: "pre-wrap" }}>{r.comment ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
