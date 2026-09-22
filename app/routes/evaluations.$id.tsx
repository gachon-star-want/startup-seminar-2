import { useState } from "react";
import { Link, useActionData, useNavigation } from "react-router";
import type { Route } from "./+types/evaluations.$id";
import { Form } from "react-router";
import { requireAppContext } from "~/lib/context.server";
import { EvaluationHub } from "~/modules/evaluations/index.server";
import { MAX_EVAL_COMMENT_BYTES } from "~/lib/constants";
import { fmtKST, ymdLabel } from "~/lib/time";
import { IconArrowLeft } from "~/components/icons";
import { Badge, Card, EmptyState, ErrorText, formatBytes } from "~/components/ui";

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const ctx = await requireAppContext(request, context);
  return EvaluationHub.getSessionForStudent(ctx, params.id!);
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const ctx = await requireAppContext(request, context);
  const form = await request.formData();
  const result = await EvaluationHub.saveEvaluation(ctx, params.id!, form);
  if (!result.ok) {
    return { error: result.message, message: undefined as string | undefined };
  }
  return { error: undefined as string | undefined, message: result.message };
}

const encoder = new TextEncoder();
const byteLen = (s: string) => encoder.encode(s).length;

/** 별 5개 라디오 (required로 필수/선택 제어) */
function StarPicker({
  name,
  label,
  defaultValue,
  required,
}: {
  name: string;
  label: string;
  defaultValue?: number;
  required?: boolean;
}) {
  return (
    <div className="score-row">
      <span className="score-row__label">{label}</span>
      <div className="score-row__opts" role="radiogroup" aria-label={label}>
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} className="score-row__opt" title={`${n}점`}>
            <input
              type="radio"
              name={name}
              value={n}
              defaultChecked={defaultValue === n}
              required={required}
            />
            <span aria-hidden>★</span>
            <span className="score-row__num">{n}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

/** 300바이트 카운터가 붙은 코멘트 박스 */
function CommentBox({
  id,
  name,
  defaultValue,
  placeholder,
  compact,
}: {
  id: string;
  name: string;
  defaultValue?: string | null;
  placeholder: string;
  compact?: boolean;
}) {
  const [bytes, setBytes] = useState(() => byteLen(defaultValue ?? ""));
  const over = bytes > MAX_EVAL_COMMENT_BYTES;
  return (
    <div className="field" style={compact ? { marginTop: "0.375rem" } : undefined}>
      <textarea
        id={id}
        name={name}
        rows={compact ? 1 : 2}
        className="input"
        placeholder={placeholder}
        defaultValue={defaultValue ?? ""}
        onInput={(e) => setBytes(byteLen((e.target as HTMLTextAreaElement).value))}
        style={over ? { borderColor: "var(--danger)" } : undefined}
      />
      <p className={`hint num${over ? " text-danger" : ""}`} style={compact ? { marginTop: "0.125rem" } : undefined}>
        {bytes}/{MAX_EVAL_COMMENT_BYTES}바이트{over ? " — 초과했어요" : ""}
      </p>
    </div>
  );
}

export default function EvaluationSessionRoute({ loaderData }: Route.ComponentProps) {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const s = loaderData.session;
  const targets = loaderData.targets;
  const doneCount = targets.filter((t) => t.my).length;
  const submitting = navigation.state === "submitting";

  return (
    <div className="stack-xl">
      <div>
        <Link to="/evaluations" className="back-link">
          <IconArrowLeft />
          발표 평가
        </Link>
        <div className="cluster">
          <h1 className="page-head__title page-head__title--sm ellipsis">{s.title}</h1>
          {s.phase === "open" ? <Badge tone="green">평가 중</Badge> : null}
          {s.phase === "scheduled" ? <Badge tone="gray">평가 예정</Badge> : null}
          {s.phase === "closed" ? <Badge tone="indigo">평가 마감</Badge> : null}
        </div>
        <p className="page-head__sub num">
          {ymdLabel(s.sessionDate)} · 평가{" "}
          {fmtKST(new Date(s.opensAt), { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" })}
          {" ~ "}
          {fmtKST(new Date(s.closesAt), { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" })}
          {" · 팀 평가 "}
          {doneCount}/{targets.length}
        </p>
        {s.description ? (
          <p className="card small muted help-text notice-body mt-3">{s.description}</p>
        ) : null}
      </div>

      <ErrorText>{actionData?.error}</ErrorText>
      {actionData?.message ? (
        <div className="notice notice--success" style={{ padding: "0.75rem 1rem", borderRadius: "8px" }}>
          <p className="small" style={{ color: "var(--success, #10b981)", fontWeight: 600 }}>
            {actionData.message}
          </p>
        </div>
      ) : null}

      {targets.length === 0 ? (
        <EmptyState>이 세션에 연결된 발표 제출물이 아직 없어요.</EmptyState>
      ) : (
        <div className="stack-md">
          {targets.map((t, i) => {
            const canEvaluate = s.phase === "open";
            return (
              <Card key={t.submissionId}>
                <div className="cluster cluster--between">
                  <div className="cluster minw-0">
                    <strong className="card__title">
                      {i + 1}. {t.label}
                    </strong>
                    {t.my ? <Badge tone="green">평가 완료 ★{t.my.star}</Badge> : null}
                  </div>
                  <span className="small faint">발표자: {t.presenter}</span>
                </div>

                {t.content ? (
                  <p className="notice notice--neutral notice-body" style={{ whiteSpace: "pre-wrap" }}>
                    {t.content}
                  </p>
                ) : null}
                {t.link ? (
                  <p className="small mt-2">
                    🔗{" "}
                    <a href={t.link} target="_blank" rel="noreferrer" className="link-url card__link">
                      {t.link}
                    </a>
                  </p>
                ) : null}
                {t.files.length > 0 ? (
                  <ul className="stack-sm mt-2 bare-list">
                    {t.files.map((f) => (
                      <li key={f.id} className="item-link">
                        <span className="small ellipsis minw-0">
                          📄{" "}
                          <a
                            href={`/files/${f.id}?inline=1`}
                            target="_blank"
                            rel="noreferrer"
                            className="card__link"
                            title="새 탭에서 보기"
                          >
                            {f.filename}
                          </a>{" "}
                          <span className="faint">({formatBytes(f.size)})</span>
                        </span>
                        <a href={`/files/${f.id}`} download={f.filename} className="btn btn--ghost btn--sm">
                          다운로드
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : null}

                {canEvaluate ? (
                  <Form method="post" className="mt-3">
                    <input type="hidden" name="submissionId" value={t.submissionId} />

                    <p className="small font-bold" style={{ fontWeight: 700, marginTop: "0.5rem" }}>
                      팀 발표 평가
                    </p>
                    <StarPicker
                      name="teamScore"
                      label="이 팀 발표는 몇 점인가요?"
                      defaultValue={t.my?.star}
                      required
                    />
                    <CommentBox
                      id={`team-comment-${t.submissionId}`}
                      name="teamComment"
                      defaultValue={t.my?.comment}
                      placeholder="발표에 대한 코멘트를 남겨주세요 (선택)"
                    />

                    {t.members.length > 0 ? (
                      <>
                        <p
                          className="small font-bold mt-4"
                          style={{ fontWeight: 700, paddingTop: "0.75rem", borderTop: "1px dashed var(--border)" }}
                        >
                          팀원 개별 평가 <span className="faint font-normal">(점수를 줄 사람만 평가해도 돼요)</span>
                        </p>
                        <div className="stack-sm mt-2">
                          {t.members.map((m) => (
                            <div key={m.userId} className="member-eval">
                              <input type="hidden" name="memberIds" value={m.userId} />
                              <StarPicker
                                name={`memberScore_${m.userId}`}
                                label={m.name}
                                defaultValue={m.my?.star}
                              />
                              <CommentBox
                                id={`member-comment-${t.submissionId}-${m.userId}`}
                                name={`memberComment_${m.userId}`}
                                defaultValue={m.my?.comment}
                                placeholder={`${m.name}에게 남길 코멘트 (선택)`}
                                compact
                              />
                            </div>
                          ))}
                        </div>
                      </>
                    ) : null}

                    <div className="cluster mt-4">
                      <button type="submit" className="btn btn--primary btn--sm" disabled={submitting}>
                        {t.my ? "평가 수정하기" : "평가 제출하기"}
                      </button>
                      {t.my ? <span className="small faint">이미 평가한 발표예요. 수정 제출도 가능해요.</span> : null}
                    </div>
                  </Form>
                ) : s.phase === "scheduled" ? (
                  <p className="small faint mt-3">평가 기간이 되면 이곳에서 평가할 수 있어요.</p>
                ) : t.my ? (
                  <p className="small faint mt-3">평가 완료 — ★{t.my.star}</p>
                ) : (
                  <p className="small faint mt-3">평가 기간이 마감되어 제출할 수 없어요.</p>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
