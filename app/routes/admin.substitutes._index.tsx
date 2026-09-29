import { Link, Form, useActionData, useSearchParams } from "react-router";
import type { Route } from "./+types/admin.substitutes._index";
import { requireAdminAppContext } from "~/lib/context.server";
import { SubstituteHub } from "~/modules/substitutes/index.server";
import type { SubstituteReviewFilter } from "~/modules/substitutes/substitutes.server";
import { ATTENDANCE_LABELS } from "~/lib/constants";
import { fmtKST } from "~/lib/time";
import { AttendanceBadge, Badge, Card, EmptyState, ErrorText, PageHeader, formatBytes } from "~/components/ui";

const FILTERS = ["pending", "all", "approved", "rejected"] as const;

function parseFilter(raw: string | null): SubstituteReviewFilter {
  return (FILTERS as readonly string[]).includes(raw ?? "") ? (raw as SubstituteReviewFilter) : "pending";
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = await requireAdminAppContext(request, context);
  const filter = parseFilter(new URL(request.url).searchParams.get("status"));
  const [rows, counts] = await Promise.all([
    SubstituteHub.listForAdminReview(ctx, filter),
    SubstituteHub.countByStatus(ctx),
  ]);
  return { rows, counts, filter };
}

export async function action({ request, context }: Route.ActionArgs) {
  const ctx = await requireAdminAppContext(request, context);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "review") {
    const reviewAction = String(form.get("reviewAction") ?? "");
    if (reviewAction === "approve" || reviewAction === "reject" || reviewAction === "revoke") {
      const res = await SubstituteHub.review(
        ctx,
        String(form.get("submissionId") ?? ""),
        reviewAction,
        String(form.get("note") ?? "")
      );
      if (!res.ok) return { error: res.message };
    }
    return { error: undefined };
  }

  return { error: "알 수 없는 요청이에요." };
}

const subStatusBadge = {
  pending: <Badge tone="gray">대기중</Badge>,
  approved: <Badge tone="green">승인</Badge>,
  rejected: <Badge tone="red">반려</Badge>,
} as const;

const filterLabels = { all: "전체", pending: "대기중", approved: "승인", rejected: "반려" } as const;

const fmtKstDT = (iso: string) =>
  fmtKST(new Date(iso), { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });

export default function AdminSubstitutesRoute({ loaderData }: Route.ComponentProps) {
  const { rows, counts, filter } = loaderData;
  const actionData = useActionData<typeof action>();
  const [searchParams] = useSearchParams();

  return (
    <div className="stack-xl">
      <PageHeader
        title="대체 과제 검토"
        sub="지각/결석한 수업에 학생이 제출한 보고서를 확인하고 승인하면 그 날짜가 대체출석으로 바뀌어요."
        right={
          <Link to={`/admin/substitutes/zip?status=${filter}`} prefetch="intent" className="btn btn--ghost btn--sm">
            📦 ZIP 다운로드
          </Link>
        }
      />

      <div className="cluster">
        {FILTERS.map((f) => (
          <Link
            key={f}
            to={`/admin/substitutes?status=${f}`}
            prefetch="intent"
            className={`badge ${filter === f ? "badge--indigo" : "badge--gray"}`}
          >
            {filterLabels[f]} {counts[f]}
          </Link>
        ))}
      </div>

      <ErrorText>{actionData?.error}</ErrorText>

      {rows.length === 0 ? (
        <EmptyState>
          {filter === "pending" ? "검토 대기 중인 제출물이 없어요." : "제출된 대체 과제가 없어요."}
        </EmptyState>
      ) : (
        <div className="stack-md">
          {rows.map((s) => (
            <Card key={s.id}>
              <div className="cluster cluster--between">
                <div className="cluster minw-0">
                  <span className="num" style={{ fontWeight: 700 }}>{s.userName}</span>
                  <span className="badge badge--gray num">{s.dateLabel}</span>
                  {s.attendanceStatus ? (
                    <AttendanceBadge status={s.attendanceStatus} labels={ATTENDANCE_LABELS} />
                  ) : null}
                  {subStatusBadge[s.status]}
                </div>
                <span className="faint small num">{fmtKstDT(s.submittedAt)}</span>
              </div>

              {s.content ? (
                <p className="small muted" style={{ whiteSpace: "pre-wrap" }}>{s.content}</p>
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
                      <a href={`/admin/substitute-files/${f.id}`} className="item-link">
                        {f.filename}
                      </a>{" "}
                      <span className="faint">({formatBytes(f.size)})</span>
                    </span>
                  ))}
                </p>
              )}
              {s.reviewNote ? (
                <p className="notice notice--neutral small">메모: {s.reviewNote}</p>
              ) : null}

              <Form method="post" className="cluster mt-3">
                <input type="hidden" name="intent" value="review" />
                <input type="hidden" name="submissionId" value={s.id} />
                <input name="note" className="input" style={{ maxWidth: "22rem" }} placeholder="교수 메모 (선택)" />
                {s.status === "approved" ? (
                  <button type="submit" name="reviewAction" value="revoke" className="btn btn--warn btn--sm">
                    승인 취소
                  </button>
                ) : (
                  <>
                    <button type="submit" name="reviewAction" value="approve" className="btn btn--primary btn--sm">
                      승인
                    </button>
                    {s.status === "pending" && (
                      <button type="submit" name="reviewAction" value="reject" className="btn btn--danger btn--sm">
                        반려
                      </button>
                    )}
                  </>
                )}
              </Form>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
