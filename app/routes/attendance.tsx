import { Fragment, useState } from "react";
import type { Route } from "./+types/attendance";
import { Form, useActionData } from "react-router";
import { AttendanceDesk } from "~/modules/attendance/index.server";
import { SubstituteHub } from "~/modules/substitutes/index.server";
import type { MySubstituteItem } from "~/modules/substitutes/types";
import { requireAppContext } from "~/lib/context.server";
import { ATTENDANCE_LABELS } from "~/lib/constants";
import { fmtKST } from "~/lib/time";
import { AttendanceBadge, Badge, Card, EmptyState, ErrorText, Field, PageHeader, Stat, formatBytes } from "~/components/ui";

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = await requireAppContext(request, context);
  const history = await AttendanceDesk.getMyHistory(ctx);
  const mySubmissions =
    ctx.user.role === "professor" ? [] : await SubstituteHub.listMySubmissions(ctx);
  return { ...history, mySubmissions };
}

export async function action({ request, context }: Route.ActionArgs) {
  const ctx = await requireAppContext(request, context);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "substituteSubmit") {
    const res = await SubstituteHub.submit(ctx, form);
    if (!res.ok) return { error: res.message, message: undefined };
    return { error: undefined, message: res.message };
  }

  return { error: "알 수 없는 요청이에요.", message: undefined };
}

const subStatusBadge = {
  pending: <Badge tone="gray">대기중</Badge>,
  approved: <Badge tone="green">승인</Badge>,
  rejected: <Badge tone="red">반려</Badge>,
} as const;

const fmtKstDT = (iso: string) =>
  fmtKST(new Date(iso), { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });

/** 제출물 상세 + (승인 전) 수정 폼 */
function SubmissionDetail({ sub }: { sub: MySubstituteItem }) {
  return (
    <div className="sub-item">
      <div className="cluster cluster--between">
        {subStatusBadge[sub.status]}
        <span className="faint small num">{fmtKstDT(sub.submittedAt)}</span>
      </div>
      {sub.content ? (
        <p className="small muted sub-item__body">{sub.content}</p>
      ) : null}
      {sub.link ? (
        <p className="small">
          🔗{" "}
          <a href={sub.link} target="_blank" rel="noreferrer" className="item-link">
            {sub.link}
          </a>
        </p>
      ) : null}
      {sub.files.length > 0 && (
        <p className="small">
          📎{" "}
          {sub.files.map((f, i) => (
            <span key={f.id}>
              {i > 0 ? ", " : ""}
              <a href={`/substitute-files/${f.id}`} className="item-link">
                {f.filename}
              </a>{" "}
              <span className="faint">({formatBytes(f.size)})</span>
            </span>
          ))}
        </p>
      )}
      {sub.reviewNote ? (
        <p className="notice notice--neutral small">교수 메모: {sub.reviewNote}</p>
      ) : null}

      {sub.status !== "approved" && (
        <details className="sub-edit">
          <summary>수정하기</summary>
          <Form method="post" encType="multipart/form-data" className="stack-sm mt-3">
            <input type="hidden" name="intent" value="substituteSubmit" />
            <input type="hidden" name="sessionId" value={sub.sessionId} />
            <Field label="보고서 내용">
              <textarea name="content" rows={4} className="input" defaultValue={sub.content ?? ""} />
            </Field>
            <Field label="링크 (선택)">
              <input name="link" type="url" className="input" defaultValue={sub.link ?? ""} placeholder="https://..." />
            </Field>
            {sub.files.length > 0 && (
              <div className="field">
                <span className="label">첨부 파일 유지/삭제</span>
                <ul className="bare-list stack-xs">
                  {sub.files.map((f) => (
                    <li key={f.id} className="cluster">
                      <label className="cluster" style={{ gap: "0.375rem" }}>
                        <input type="checkbox" name="deleteFileIds" value={f.id} />
                        <span className="small">{f.filename}</span>
                        <span className="faint small">({formatBytes(f.size)})</span>
                      </label>
                    </li>
                  ))}
                </ul>
                <p className="hint">체크하면 해당 파일을 삭제해요.</p>
              </div>
            )}
            <Field label="새 파일 추가 (선택)">
              <input type="file" name="files" multiple className="input" />
            </Field>
            <button type="submit" className="btn btn--primary btn--sm">
              수정 저장
            </button>
          </Form>
        </details>
      )}
    </div>
  );
}

export default function AttendanceRoute({ loaderData }: Route.ComponentProps) {
  const { rows, summary, isProfessor, mySubmissions } = loaderData;
  const actionData = useActionData<typeof action>();
  const [openSessionId, setOpenSessionId] = useState<string | null>(null);

  const subBySession = new Map(mySubmissions.map((s) => [s.sessionId, s]));

  const toggle = (sessionId: string) =>
    setOpenSessionId((cur) => (cur === sessionId ? null : sessionId));

  return (
    <div className="stack-xl">
      <PageHeader title="내 출석 이력" sub="매주 화요일 오전 10:00 수업 · 출석체크는 10:10까지" />

      {isProfessor ? (
        <EmptyState>교수 계정은 출석체크 대상이 아니에요. 학생들의 출석은 관리자 페이지에서 확인해 주세요.</EmptyState>
      ) : (
        <>
          <div className="stat-row">
            <Stat value={summary.present} label="출석" tone="success" />
            <Stat value={summary.late} label="지각" tone="warning" />
            <Stat value={summary.substituted} label="대체출석" tone="primary" />
            <Stat value={summary.absent} label="결석" tone="danger" />
            <Stat value={`${summary.total}회`} label="진행" />
          </div>

          <p className="small muted">
            지각하거나 결석한 수업은 날짜 옆에서 대체 과제(보고서)를 제출할 수 있어요. 교수 확인 후 승인되면{" "}
            <strong>대체출석</strong>으로 바뀌고, 대체출석은 출석과 동일하게 인정돼요.
          </p>

          {rows.length === 0 ? (
            <EmptyState>등록된 수업 일정이 아직 없어요.</EmptyState>
          ) : (
            <Card className="card--flush">
              <div className="table-wrap">
                <table className="table table--stack">
                  <thead>
                    <tr>
                      <th>수업 날짜</th>
                      <th>상태</th>
                      <th>체크 시각</th>
                      <th>대체 과제</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const sub = subBySession.get(r.sessionId);
                      const canSubmit =
                        !r.isFuture && (r.status === "late" || r.status === "absent");
                      const expanded = openSessionId === r.sessionId;

                      return (
                        <Fragment key={r.sessionId}>
                          <tr>
                            <td data-label="날짜" className="num" style={{ fontWeight: 700 }}>
                              {r.dateLabel}
                            </td>
                            <td data-label="상태">
                              {r.status ? (
                                <AttendanceBadge status={r.status} labels={ATTENDANCE_LABELS} />
                              ) : r.isFuture ? (
                                <span className="badge badge--gray">예정</span>
                              ) : (
                                <span className="badge badge--gray">진행 중</span>
                              )}
                            </td>
                            <td data-label="체크 시각" className="muted num">
                              {r.checkedAt ? fmtKST(r.checkedAt, { hour: "numeric", minute: "2-digit" }) : "—"}
                            </td>
                            <td data-label="대체 과제">
                              {sub ? (
                                <button
                                  type="button"
                                  className="btn btn--ghost btn--sm"
                                  onClick={() => toggle(r.sessionId)}
                                >
                                  {subStatusBadge[sub.status]}
                                  {expanded ? "숨기기" : "보기"}
                                </button>
                              ) : canSubmit ? (
                                <button
                                  type="button"
                                  className="btn btn--primary btn--sm"
                                  onClick={() => toggle(r.sessionId)}
                                >
                                  {expanded ? "닫기" : "제출하기"}
                                </button>
                              ) : (
                                <span className="faint">—</span>
                              )}
                            </td>
                          </tr>
                          {expanded && (
                            <tr className="sub-expand">
                              <td colSpan={4}>
                                {sub ? (
                                  <SubmissionDetail sub={sub} />
                                ) : (
                                  <Form method="post" encType="multipart/form-data" className="stack-sm">
                                    <input type="hidden" name="intent" value="substituteSubmit" />
                                    <input type="hidden" name="sessionId" value={r.sessionId} />
                                    <Field label="보고서 내용">
                                      <textarea
                                        name="content"
                                        rows={4}
                                        className="input"
                                        placeholder="수업 내용 요약, 배운 점 등을 적어주세요"
                                      />
                                    </Field>
                                    <Field label="링크 (선택)">
                                      <input name="link" type="url" className="input" placeholder="https://..." />
                                    </Field>
                                    <Field label="파일 첨부 (선택)" hint="최대 100MB, 10개까지">
                                      <input type="file" name="files" multiple className="input" />
                                    </Field>
                                    <button type="submit" className="btn btn--primary">
                                      제출하기
                                    </button>
                                  </Form>
                                )}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {actionData?.message ? (
            <p className="notice notice--success">{actionData.message}</p>
          ) : null}
          {actionData?.error ? <ErrorText>{actionData.error}</ErrorText> : null}

          <Card>
            <p className="small muted help-text">
              🕙 출석체크는 수업일 <strong>오전 10:00</strong>에 자동으로 열리고,{" "}
              <strong>10:10까지 출석</strong>, 그 이후 <strong>11:00까지는 지각</strong>으로 기록돼요.
              체크할 때마다 본인의 생일 4자리를 입력해야 해요.
            </p>
          </Card>
        </>
      )}
    </div>
  );
}
