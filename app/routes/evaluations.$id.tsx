import { Link, useActionData, useNavigation } from "react-router";
import type { Route } from "./+types/evaluations.$id";
import { Form } from "react-router";
import { requireAppContext } from "~/lib/context.server";
import { EvaluationHub } from "~/modules/evaluations/index.server";
import { fmtKST, ymdLabel } from "~/lib/time";
import { IconArrowLeft } from "~/components/icons";
import { Badge, Card, EmptyState, ErrorText, Field, formatBytes } from "~/components/ui";

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

const SCORE_ITEMS = [
  { key: "idea", label: "아이디어·시장성" },
  { key: "feasibility", label: "실현가능성" },
  { key: "delivery", label: "발표력·완성도" },
] as const;

function ScorePicker({
  fieldKey,
  label,
  defaultValue,
  disabled,
}: {
  fieldKey: string;
  label: string;
  defaultValue?: number;
  disabled: boolean;
}) {
  return (
    <div className="score-row">
      <span className="score-row__label">{label}</span>
      <div className="score-row__opts" role="radiogroup" aria-label={label}>
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} className="score-row__opt" title={`${n}점`}>
            <input
              type="radio"
              name={`${fieldKey}Score`}
              value={n}
              defaultChecked={defaultValue === n}
              disabled={disabled}
              required
            />
            <span aria-hidden>★</span>
            <span className="score-row__num">{n}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

export default function EvaluationSessionRoute({ loaderData }: Route.ComponentProps) {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const s = loaderData.session;
  const myEvals = loaderData.myEvaluations;
  const evaluableTargets = loaderData.targets.filter((t) => !t.mine);
  const doneCount = evaluableTargets.filter((t) => myEvals[t.submissionId]).length;

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
          {" · 내 평가 "}
          {doneCount}/{evaluableTargets.length}
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

      {loaderData.targets.length === 0 ? (
        <EmptyState>이 세션에 연결된 발표 제출물이 아직 없어요.</EmptyState>
      ) : (
        <div className="stack-md">
          {loaderData.targets.map((t, i) => {
            const mine = t.mine;
            const myEval = myEvals[t.submissionId];
            const canEvaluate = s.phase === "open" && !mine;
            return (
              <Card key={t.submissionId}>
                <div className="cluster cluster--between">
                  <div className="cluster minw-0">
                    <strong className="card__title">
                      {i + 1}. {t.label}
                    </strong>
                    {mine ? <Badge tone="indigo">우리 발표</Badge> : null}
                    {myEval ? <Badge tone="green">평가 완료 ★{myEval.idea + myEval.feasibility + myEval.delivery}</Badge> : null}
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

                {mine ? (
                  <p className="small faint mt-3">우리 발표는 평가 대상에서 제외돼요.</p>
                ) : canEvaluate ? (
                  <Form method="post" className="mt-3">
                    <input type="hidden" name="submissionId" value={t.submissionId} />
                    <div className="stack-sm">
                      {SCORE_ITEMS.map((item) => (
                        <ScorePicker
                          key={item.key}
                          fieldKey={item.key}
                          label={item.label}
                          defaultValue={myEval?.[item.key]}
                          disabled={navigation.state === "submitting"}
                        />
                      ))}
                    </div>
                    <Field label="코멘트 (선택)" htmlFor={`comment-${t.submissionId}`}>
                      <textarea
                        id={`comment-${t.submissionId}`}
                        name="comment"
                        rows={2}
                        className="input"
                        placeholder="좋았던 점, 아쉬운 점을 한 줄 남겨주세요."
                        defaultValue={myEval?.comment ?? ""}
                      />
                    </Field>
                    <div className="cluster mt-3">
                      <button
                        type="submit"
                        className="btn btn--primary btn--sm"
                        disabled={navigation.state === "submitting"}
                      >
                        {myEval ? "평가 수정하기" : "평가 제출하기"}
                      </button>
                      {myEval ? <span className="small faint">이미 평가한 발표예요. 수정 제출도 가능해요.</span> : null}
                    </div>
                  </Form>
                ) : s.phase === "scheduled" ? (
                  <p className="small faint mt-3">평가 기간이 되면 이곳에서 평가할 수 있어요.</p>
                ) : myEval ? (
                  <p className="small faint mt-3">
                    평가 완료 — 아이디어 {myEval.idea}점 · 실현가능성 {myEval.feasibility}점 · 발표력{" "}
                    {myEval.delivery}점
                  </p>
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
