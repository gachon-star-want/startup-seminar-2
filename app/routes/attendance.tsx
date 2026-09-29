import type { Route } from "./+types/attendance";
import { Form, useActionData } from "react-router";
import { AttendanceDesk } from "~/modules/attendance/index.server";
import { SubstituteHub } from "~/modules/substitutes/index.server";
import type { StudentSubstituteItem } from "~/modules/substitutes/types";
import { requireAppContext } from "~/lib/context.server";
import { ATTENDANCE_LABELS } from "~/lib/constants";
import { fmtKST } from "~/lib/time";
import { AttendanceBadge, Badge, Card, EmptyState, ErrorText, Field, PageHeader, SectionTitle, Stat, formatBytes } from "~/components/ui";

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = await requireAppContext(request, context);
  const history = await AttendanceDesk.getMyHistory(ctx);
  const substitutes = ctx.user.role === "professor"
    ? { assignments: [] }
    : await SubstituteHub.listForStudent(ctx);
  return { ...history, substitutes };
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

/** 대체 과제 카드 — 새 제출 폼 + 내 제출 목록(마감 전 수정 가능) */
function SubstituteCard({ a }: { a: StudentSubstituteItem }) {
  const canSubmit = a.phase === "open" && a.eligibleSessions.length > 0;
  const canEdit = a.phase === "open";

  return (
    <Card>
      <SectionTitle
        right={
          a.phase === "open" ? (
            <Badge tone="green">제출 중</Badge>
          ) : a.phase === "scheduled" ? (
            <Badge tone="gray">예정</Badge>
          ) : (
            <Badge tone="indigo">마감</Badge>
          )
        }
      >
        {a.title}
      </SectionTitle>
      {a.description ? <p className="small muted" style={{ whiteSpace: "pre-wrap" }}>{a.description}</p> : null}
      <p className="small faint num">
        제출 {fmtKstDT(a.opensAt)} ~ {fmtKstDT(a.closesAt)}
      </p>

      {a.mySubmissions.length > 0 && (
        <ul className="bare-list stack-sm mt-3">
          {a.mySubmissions.map((s) => (
            <li key={s.id} className="sub-item">
              <div className="cluster cluster--between">
                <div className="cluster minw-0">
                  <span className="num" style={{ fontWeight: 700 }}>{s.dateLabel}</span>
                  {subStatusBadge[s.status]}
                </div>
                <span className="faint small num">{fmtKstDT(s.submittedAt)}</span>
              </div>
              {s.content ? (
                <p className="small muted sub-item__body">{s.content}</p>
              ) : null}
              {s.link ? (
                <p className="small">
                  🔗{" "}
                  <a href={s.link} target="_blank" rel="noreferrer" className="item-link">
                    {s.link}
                  </a>
                </p>
              ) : null}
              {s.files.length > 0 && (
                <p className="small">
                  📎{" "}
                  {s.files.map((f, i) => (
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
              {s.reviewNote ? (
                <p className="notice notice--neutral small">교수 메모: {s.reviewNote}</p>
              ) : null}

              {canEdit && s.status !== "approved" && (
                <details className="sub-edit">
                  <summary>수정하기</summary>
                  <Form method="post" encType="multipart/form-data" className="stack-sm mt-3">
                    <input type="hidden" name="intent" value="substituteSubmit" />
                    <input type="hidden" name="assignmentId" value={a.id} />
                    <input type="hidden" name="sessionId" value={s.sessionId} />
                    <Field label="보고서 내용">
                      <textarea name="content" rows={4} className="input" defaultValue={s.content ?? ""} />
                    </Field>
                    <Field label="링크 (선택)">
                      <input name="link" type="url" className="input" defaultValue={s.link ?? ""} placeholder="https://..." />
                    </Field>
                    {s.files.length > 0 && (
                      <div className="field">
                        <span className="label">첨부 파일 유지/삭제</span>
                        <ul className="bare-list stack-xs">
                          {s.files.map((f) => (
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
            </li>
          ))}
        </ul>
      )}

      {canSubmit && (
        <details className="sub-new mt-3" open={a.mySubmissions.length === 0}>
          <summary>보고서 제출하기</summary>
          <Form method="post" encType="multipart/form-data" className="stack-sm mt-3">
            <input type="hidden" name="intent" value="substituteSubmit" />
            <input type="hidden" name="assignmentId" value={a.id} />
            <Field label="대상 수업 (결석한 수업)" htmlFor={`sub-session-${a.id}`}>
              <select id={`sub-session-${a.id}`} name="sessionId" className="input" required>
                {a.eligibleSessions.map((s) => (
                  <option key={s.sessionId} value={s.sessionId}>
                    {s.dateLabel} 결석
                  </option>
                ))}
              </select>
            </Field>
            <Field label="보고서 내용">
              <textarea name="content" rows={4} className="input" placeholder="수업 내용 요약, 배운 점 등을 적어주세요" />
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
        </details>
      )}
    </Card>
  );
}

export default function AttendanceRoute({ loaderData }: Route.ComponentProps) {
  const { rows, summary, isProfessor, substitutes } = loaderData;
  const actionData = useActionData<typeof action>();

  const visibleAssignments = isProfessor
    ? []
    : substitutes.assignments.filter((a) => a.eligibleSessions.length > 0 || a.mySubmissions.length > 0);

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
                      <th>비고</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.dateLabel}>
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
                        <td data-label="비고" className="faint small">
                          {r.source === "admin" ? "관리자 조정" : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {actionData?.message ? (
            <p className="notice notice--success">{actionData.message}</p>
          ) : null}
          {actionData?.error ? <ErrorText>{actionData.error}</ErrorText> : null}

          {visibleAssignments.length > 0 && (
            <section className="stack-md">
              <h2 className="section-label">출석 대체 과제</h2>
              <p className="small muted">
                결석한 수업은 대체 과제(보고서)를 제출해 <strong>대체출석</strong>으로 만회할 수 있어요.
                제출한 보고서는 교수 확인 후 승인되며, 승인되면 해당 수업이 결석에서 대체출석으로 바뀌어요.
              </p>
              {visibleAssignments.map((a) => (
                <SubstituteCard key={a.id} a={a} />
              ))}
            </section>
          )}

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
