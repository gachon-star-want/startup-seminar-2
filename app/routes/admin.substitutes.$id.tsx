import { useState } from "react";
import { Form, Link, redirect, useActionData } from "react-router";
import type { Route } from "./+types/admin.substitutes.$id";
import { requireAdminAppContext } from "~/lib/context.server";
import { SubstituteHub } from "~/modules/substitutes/index.server";
import { fmtKST } from "~/lib/time";
import { IconArrowLeft } from "~/components/icons";
import { Badge, Card, EmptyState, ErrorText, Field, SectionTitle, formatBytes } from "~/components/ui";
import type { AdminSubstituteSubmissionRow } from "~/modules/substitutes/types";

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const ctx = await requireAdminAppContext(request, context);
  return { detail: await SubstituteHub.getAdminDetail(ctx, params.id!) };
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const ctx = await requireAdminAppContext(request, context);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "update") {
    const result = await SubstituteHub.updateAssignment(ctx, params.id!, {
      title: String(form.get("title") ?? ""),
      description: String(form.get("description") ?? ""),
      opensAtRaw: String(form.get("opensAt") ?? ""),
      closesAtRaw: String(form.get("closesAt") ?? ""),
    });
    if (!result.ok) return { error: result.message, message: undefined as string | undefined };
    return { error: undefined as string | undefined, message: result.message };
  }

  if (intent === "delete") {
    await SubstituteHub.deleteAssignment(ctx, params.id!);
    return redirect("/admin/substitutes");
  }

  if (intent === "review") {
    const result = await SubstituteHub.review(
      ctx,
      String(form.get("submissionId") ?? ""),
      String(form.get("reviewAction") ?? "") as "approve" | "reject" | "revoke",
      String(form.get("note") ?? "")
    );
    if (!result.ok) return { error: result.message, message: undefined as string | undefined };
    return { error: undefined as string | undefined, message: undefined as string | undefined };
  }

  return { error: "알 수 없는 요청이에요.", message: undefined as string | undefined };
}

const phaseTone = { scheduled: "gray", open: "green", closed: "indigo" } as const;
const phaseLabel = { scheduled: "제출 예정", open: "제출 중", closed: "마감" } as const;

const statusBadge = {
  pending: <Badge tone="gray">대기중</Badge>,
  approved: <Badge tone="green">승인</Badge>,
  rejected: <Badge tone="red">반려</Badge>,
} as const;

const fmtKstDT = (iso: string) =>
  fmtKST(new Date(iso), { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });

function SubmissionCard({ s }: { s: AdminSubstituteSubmissionRow }) {
  return (
    <li className="sub-item">
      <div className="cluster cluster--between">
        <div className="cluster minw-0">
          <span style={{ fontWeight: 700 }}>{s.userName}</span>
          <span className="num small faint">{s.dateLabel} 결석 만회</span>
          {statusBadge[s.status]}
        </div>
        <span className="faint small num">{fmtKstDT(s.submittedAt)}</span>
      </div>
      {s.content ? <p className="small muted sub-item__body">{s.content}</p> : null}
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
              <a href={`/admin/substitute-files/${f.id}`} className="item-link">
                {f.filename}
              </a>{" "}
              <span className="faint">({formatBytes(f.size)})</span>
            </span>
          ))}
        </p>
      )}

      {s.status === "approved" ? (
        <Form
          method="post"
          className="cluster mt-3"
          onSubmit={(e) => {
            if (!confirm("승인을 취소하면 해당 학생의 출석 기록이 다시 결석으로 돌아가요. 계속할까요?")) {
              e.preventDefault();
            }
          }}
        >
          <input type="hidden" name="intent" value="review" />
          <input type="hidden" name="submissionId" value={s.id} />
          <input type="hidden" name="reviewAction" value="revoke" />
          <button type="submit" className="btn btn--ghost btn--sm">
            ↩ 승인 취소
          </button>
        </Form>
      ) : (
        <Form method="post" className="stack-sm mt-3">
          <input type="hidden" name="intent" value="review" />
          <input type="hidden" name="submissionId" value={s.id} />
          <input
            name="note"
            className="input"
            placeholder="메모 (선택) — 반려 사유 등을 학생에게 보여줘요"
            defaultValue={s.reviewNote ?? ""}
          />
          <div className="cluster">
            <button name="reviewAction" value="approve" className="btn btn--primary btn--sm">
              ✓ 승인 (대체출석 처리)
            </button>
            <button name="reviewAction" value="reject" className="btn btn--danger btn--sm">
              ✕ 반려
            </button>
          </div>
        </Form>
      )}
    </li>
  );
}

export default function AdminSubstituteDetailRoute({ loaderData }: Route.ComponentProps) {
  const actionData = useActionData<typeof action>();
  const a = loaderData.detail.assignment;
  const submissions = loaderData.detail.submissions;
  const [isEditing, setIsEditing] = useState(false);
  const approvedCount = submissions.filter((s) => s.status === "approved").length;

  return (
    <div className="stack-xl">
      <div>
        <Link to="/admin/substitutes" className="back-link">
          <IconArrowLeft />
          대체 과제 관리
        </Link>
        <div className="cluster cluster--between">
          <div className="cluster minw-0">
            <h1 className="page-head__title page-head__title--sm ellipsis">{a.title}</h1>
            <Badge tone={phaseTone[a.phase]}>{phaseLabel[a.phase]}</Badge>
          </div>
          <div className="cluster flex-shrink-0">
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => setIsEditing(!isEditing)}
            >
              {isEditing ? "닫기" : "⚙️ 과제 설정 수정"}
            </button>
            <a href={`/admin/substitutes/${a.id}/zip`} className="btn btn--primary btn--sm">
              ⬇ 보고서 파일 ZIP
            </a>
          </div>
        </div>
        <p className="page-head__sub num">
          제출 {fmtKstDT(a.opensAt)} ~ {fmtKstDT(a.closesAt)} · 보고서 {submissions.length}건 (승인{" "}
          {approvedCount}건)
        </p>
        {a.description ? (
          <p className="card small muted help-text notice-body mt-2">{a.description}</p>
        ) : null}
      </div>

      {actionData?.message ? (
        <p className="notice notice--success">{actionData.message}</p>
      ) : null}
      <ErrorText>{actionData?.error}</ErrorText>

      {isEditing ? (
        <Card>
          <SectionTitle>과제 설정 수정</SectionTitle>
          <Form method="post">
            <input type="hidden" name="intent" value="update" />
            <Field label="과제 제목" htmlFor="edit-sub-title">
              <input id="edit-sub-title" name="title" className="input" defaultValue={a.title} required />
            </Field>
            <Field label="안내" htmlFor="edit-sub-desc">
              <textarea
                id="edit-sub-desc"
                name="description"
                rows={2}
                className="input"
                defaultValue={a.description ?? ""}
              />
            </Field>
            <div className="grid-2">
              <Field label="제출 시작 (KST)" htmlFor="edit-sub-opens">
                <input
                  id="edit-sub-opens"
                  name="opensAt"
                  type="datetime-local"
                  className="input num"
                  defaultValue={a.opensAtLocal}
                  required
                />
              </Field>
              <Field label="제출 마감 (KST)" htmlFor="edit-sub-closes">
                <input
                  id="edit-sub-closes"
                  name="closesAt"
                  type="datetime-local"
                  className="input num"
                  defaultValue={a.closesAtLocal}
                  required
                />
              </Field>
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
              <span className="small text-danger">⚠️ 과제를 삭제하면 학생들이 제출한 보고서도 함께 삭제됩니다.</span>
              <Form
                method="post"
                onSubmit={(e) => {
                  if (!confirm("정말 이 대체 과제를 삭제하시겠습니까? 제출된 보고서도 모두 사라집니다.")) {
                    e.preventDefault();
                  }
                }}
              >
                <input type="hidden" name="intent" value="delete" />
                <button type="submit" className="btn btn--danger btn--sm">
                  과제 삭제
                </button>
              </Form>
            </div>
          </div>
        </Card>
      ) : null}

      <p className="small muted">
        승인하면 해당 학생의 출석 기록이 <strong>결석 → 대체출석</strong>으로 바뀌어요. 승인 취소하면 다시
        결석으로 돌아가요.
      </p>

      {submissions.length === 0 ? (
        <EmptyState>아직 제출된 보고서가 없어요.</EmptyState>
      ) : (
        <Card className="card--flush">
          <div className="card__head card__head--flush">
            <h2 className="card__title">📝 보고서 목록</h2>
            <p className="small faint">학생 이름순</p>
          </div>
          <ul className="bare-list" style={{ padding: "0 1rem 1.25rem" }}>
            {submissions.map((s) => (
              <SubmissionCard key={s.id} s={s} />
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
