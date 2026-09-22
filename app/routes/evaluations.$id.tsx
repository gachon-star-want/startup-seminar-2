import { useEffect, useRef, useState } from "react";
import { Link, useActionData, useFetcher, useNavigation } from "react-router";
import type { Route } from "./+types/evaluations.$id";
import { Form } from "react-router";
import { requireAppContext } from "~/lib/context.server";
import { EvaluationHub } from "~/modules/evaluations/index.server";
import { MAX_EVAL_COMMENT_BYTES } from "~/lib/constants";
import { fmtKST, ymdLabel } from "~/lib/time";
import { IconArrowLeft } from "~/components/icons";
import { Badge, Card, EmptyState, formatBytes } from "~/components/ui";
import type { EvaluationTargetItem } from "~/modules/evaluations/types";

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const ctx = await requireAppContext(request, context);
  return EvaluationHub.getSessionForStudent(ctx, params.id!);
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const ctx = await requireAppContext(request, context);
  const form = await request.formData();
  const result = await EvaluationHub.saveEvaluation(ctx, params.id!, form);
  if (!result.ok) {
    return { error: result.message, message: undefined as string | undefined, saved: 0 };
  }
  return { error: undefined as string | undefined, message: result.message, saved: result.saved };
}

const encoder = new TextEncoder();
const byteLen = (s: string) => encoder.encode(s).length;

/** 임시 저장 디바운스 — 마지막 입력 후 이 시간이 지나면 저장 */
const DRAFT_DEBOUNCE_MS = 600;

/**
 * 0.5점 단위 별점 — 별 5개, 각 별의 좌/우 반쪽을 눌러 0.5씩 조절.
 * 반쪽이 투명 버튼이라 키보드·터치로도 고를 수 있고, 값은 hidden input으로 제출한다.
 */
function StarRating({
  name,
  ariaLabel,
  defaultValue = 0,
  clearable,
  onChange,
}: {
  name: string;
  ariaLabel: string;
  defaultValue?: number;
  clearable?: boolean;
  onChange?: () => void;
}) {
  const [value, setValue] = useState(defaultValue);
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  const pick = (v: number) => {
    setValue(v);
    onChange?.();
  };
  return (
    <div className="stars" role="group" aria-label={ariaLabel}>
      <input type="hidden" name={name} value={value ? String(value) : ""} />
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className="stars__star">
          <span className="stars__bg" aria-hidden>
            ★
          </span>
          <span
            className="stars__fg"
            aria-hidden
            style={{ width: shown >= n ? "100%" : shown >= n - 0.5 ? "50%" : "0%" }}
          >
            ★
          </span>
          <button
            type="button"
            className="stars__half"
            aria-label={`${n - 0.5}점`}
            onClick={() => pick(n - 0.5)}
            onMouseEnter={() => setHover(n - 0.5)}
            onMouseLeave={() => setHover(0)}
          />
          <button
            type="button"
            className="stars__half stars__half--r"
            aria-label={`${n}점`}
            onClick={() => pick(n)}
            onMouseEnter={() => setHover(n)}
            onMouseLeave={() => setHover(0)}
          />
        </span>
      ))}
      {clearable && value > 0 ? (
        <button
          type="button"
          className="stars__clear"
          aria-label="별점 지우기"
          title="별점 지우기"
          onClick={() => pick(0)}
        >
          ✕
        </button>
      ) : null}
    </div>
  );
}

/** 300바이트 카운터가 붙은 코멘트 박스 */
function CommentBox({
  id,
  name,
  defaultValue,
  placeholder,
  onEdit,
}: {
  id: string;
  name: string;
  defaultValue?: string | null;
  placeholder: string;
  onEdit?: () => void;
}) {
  const [bytes, setBytes] = useState(() => byteLen(defaultValue ?? ""));
  const over = bytes > MAX_EVAL_COMMENT_BYTES;
  return (
    <div className="field">
      <textarea
        id={id}
        name={name}
        rows={2}
        className="input"
        placeholder={placeholder}
        defaultValue={defaultValue ?? ""}
        onInput={(e) => {
          setBytes(byteLen((e.target as HTMLTextAreaElement).value));
          onEdit?.();
        }}
        style={over ? { borderColor: "var(--danger)" } : undefined}
      />
      <p className={`hint num${over ? " text-danger" : ""}`}>
        {bytes}/{MAX_EVAL_COMMENT_BYTES}바이트{over ? " — 초과했어요" : ""}
      </p>
    </div>
  );
}

/** 발표 카드 — 제출물 내용은 항상, 평가 입력은 폼 안에서만. status가 주어지면 입력 대신 안내문 */
function EvaluationCard({
  t,
  index,
  status,
  onEdit,
}: {
  t: EvaluationTargetItem;
  index: number;
  status?: string;
  onEdit?: () => void;
}) {
  return (
    <Card>
      <div className="cluster cluster--between">
        <div className="cluster minw-0">
          <strong className="card__title">
            {index + 1}. {t.label}
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

      {t.submissionId ? null : (
        <p className="small faint mt-2">이 팀은 아직 발표 자료를 올리지 않았어요.</p>
      )}

      {status ? (
        <p className="small faint mt-3">{status}</p>
      ) : (
        <>
          <input type="hidden" name="teamId" value={t.teamId} />
          <div className="eval-sheet mt-3">
          <div className="eval-sheet__row">
            <div className="eval-sheet__label">팀 평가</div>
            <div className="eval-sheet__body">
              <StarRating
                name={`teamScore_${t.teamId}`}
                ariaLabel={`${t.label} 별점`}
                defaultValue={t.my?.star ?? 0}
                onChange={onEdit}
              />
            </div>
          </div>
          <div className="eval-sheet__row">
            <div className="eval-sheet__label">팀 코멘트</div>
            <div className="eval-sheet__body">
              <CommentBox
                id={`team-comment-${t.teamId}`}
                name={`teamComment_${t.teamId}`}
                defaultValue={t.my?.comment}
                placeholder="발표에 대한 코멘트를 남겨주세요 (선택)"
                onEdit={onEdit}
              />
            </div>
          </div>
          {t.members.length > 0 ? (
            <div className="eval-sheet__row">
              <div className="eval-sheet__label">개별 평가</div>
              <div className="eval-sheet__body">
                <div className="stack-sm">
                  {t.members.map((m) => (
                    <div key={m.userId} className="eval-sheet__member">
                      <input type="hidden" name={`memberIds_${t.teamId}`} value={m.userId} />
                      <span className="eval-sheet__member-name">{m.name}</span>
                      <StarRating
                        name={`memberScore_${t.teamId}_${m.userId}`}
                        ariaLabel={`${t.label} — ${m.name} 별점`}
                        defaultValue={m.my?.star ?? 0}
                        clearable
                        onChange={onEdit}
                      />
                    </div>
                  ))}
                </div>
                <p className="hint">점수를 줄 팀원에게만 별점을 눌러도 돼요.</p>
              </div>
            </div>
          ) : null}
          </div>
        </>
      )}
    </Card>
  );
}

export default function EvaluationSessionRoute({ loaderData }: Route.ComponentProps) {
  const actionData = useActionData<typeof action>();
  const draftFetcher = useFetcher<typeof action>();
  const navigation = useNavigation();
  const formRef = useRef<HTMLFormElement>(null);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const s = loaderData.session;
  const targets = loaderData.targets;
  const doneCount = targets.filter((t) => t.my).length;
  const submitting = navigation.state === "submitting";
  const canEvaluate = s.phase === "open";

  useEffect(() => () => clearTimeout(draftTimer.current), []);

  /** 입력이 멈추면 폼 전체를 임시 저장한다 — 별점을 고른 팀만 서버에 반영된다 */
  const queueDraftSave = () => {
    clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      if (!formRef.current) return;
      const fd = new FormData(formRef.current);
      fd.set("intent", "draft");
      draftFetcher.submit(fd, { method: "post" });
    }, DRAFT_DEBOUNCE_MS);
  };

  const draftSaving = draftFetcher.state !== "idle";
  const draftStatus = draftSaving
    ? "임시 저장 중…"
    : draftFetcher.data?.error
      ? draftFetcher.data.error
      : draftFetcher.data && draftFetcher.data.saved > 0
        ? "임시 저장됨 ✓"
        : "";

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

      {targets.length === 0 ? (
        <EmptyState>아직 평가할 팀이 없어요.</EmptyState>
      ) : canEvaluate ? (
        <Form method="post" ref={formRef}>
          <input type="hidden" name="intent" value="submit" />
          <div className="stack-md">
            {targets.map((t, i) => (
              <EvaluationCard key={t.teamId} t={t} index={i} onEdit={queueDraftSave} />
            ))}
          </div>

          <div className="eval-submit">
            {draftStatus ? (
              <p className={`hint${draftFetcher.data?.error ? " text-danger" : ""}`} aria-live="polite">
                {draftStatus}
              </p>
            ) : null}
            {actionData?.error ? <p className="small text-danger">{actionData.error}</p> : null}
            {actionData?.message ? (
              <p className="small" style={{ color: "var(--success, #10b981)", fontWeight: 600 }}>
                {actionData.message}
              </p>
            ) : null}
            <button type="submit" className="btn btn--primary" disabled={submitting}>
              {submitting ? "제출 중..." : "제출"}
            </button>
            <p className="hint">
              별점을 고르면 자동으로 임시 저장돼요. 제출을 누르면 최종 제출이에요.
            </p>
          </div>
        </Form>
      ) : (
        <div className="stack-md">
          {targets.map((t, i) => (
            <EvaluationCard
              key={t.teamId}
              t={t}
              index={i}
              status={
                s.phase === "scheduled"
                  ? "평가 기간이 되면 이곳에서 평가할 수 있어요."
                  : t.my
                    ? `평가 완료 — ★${t.my.star}`
                    : "평가 기간이 마감되어 제출할 수 없어요."
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
