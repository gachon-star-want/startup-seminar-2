import { useState } from "react";
import { Form, Link, redirect, useActionData } from "react-router";
import type { Route } from "./+types/admin.assignments.$id";
import { eq, inArray } from "drizzle-orm";
import { assignments, submissionFiles, submissions, teamMembers, teams, users } from "~/db/schema";
import { requireAdmin } from "~/lib/session";
import { fmtKST } from "~/lib/time";
import { IconArrowLeft } from "~/components/icons";
import { Badge, Card, EmptyState, ErrorText, Field, SectionTitle, formatBytes } from "~/components/ui";

function toKstDatetimeLocal(d: Date): string {
  const kstMs = d.getTime() + 9 * 60 * 60 * 1000;
  return new Date(kstMs).toISOString().slice(0, 16);
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const { db } = await requireAdmin(request, context);

  const [assignment] = await db.select().from(assignments).where(eq(assignments.id, params.id!)).limit(1);
  if (!assignment) throw new Response("과제를 찾을 수 없어요", { status: 404 });

  // 제출 목록과 (팀 or 사용자 목록)을 병렬 조회
  const [rows, targetList] = await Promise.all([
    db
      .select({
        submission: submissions,
        userName: users.name,
        teamName: teams.name,
      })
      .from(submissions)
      .innerJoin(users, eq(submissions.userId, users.id))
      .leftJoin(teams, eq(submissions.teamId, teams.id))
      .where(eq(submissions.assignmentId, assignment.id)),
    assignment.unit === "team"
      ? db.select({ id: teams.id, name: teams.name }).from(teams)
      : db.select({ id: users.id, name: users.name }).from(users),
  ]);

  // 해당 과제의 제출물들에 속한 파일만 inArray로 정밀 조회 (전체 테이블 풀스캔 제거)
  const subIds = rows.map((r) => r.submission.id);
  const files =
    subIds.length > 0
      ? await db.select().from(submissionFiles).where(inArray(submissionFiles.submissionId, subIds))
      : [];

  const filesBySubmission = new Map<string, typeof files>();
  for (const f of files) {
    const list = filesBySubmission.get(f.submissionId) ?? [];
    list.push(f);
    filesBySubmission.set(f.submissionId, list);
  }

  // 미제출 목록
  let missing: { label: string }[] = [];
  if (assignment.unit === "team") {
    const submittedTeamIds = new Set(rows.map((r) => r.submission.teamId).filter(Boolean));
    missing = (targetList as { id: string; name: string }[])
      .filter((t) => !submittedTeamIds.has(t.id))
      .map((t) => ({ label: `${t.name} 팀` }));
  } else {
    const submittedUserIds = new Set(rows.map((r) => r.submission.userId));
    missing = (targetList as { id: string; name: string }[])
      .filter((u) => !submittedUserIds.has(u.id))
      .map((u) => ({ label: u.name }));
  }

  return {
    assignment: {
      id: assignment.id,
      title: assignment.title,
      description: assignment.description,
      unit: assignment.unit,
      dueAt: assignment.dueAt.toISOString(),
      dueAtLocal: toKstDatetimeLocal(assignment.dueAt),
    },
    submissions: rows
      .map((r) => ({
        id: r.submission.id,
        content: r.submission.content,
        link: r.submission.link,
        userName: r.userName,
        teamName: r.teamName,
        updatedAt: r.submission.updatedAt.toISOString(),
        files: (filesBySubmission.get(r.submission.id) ?? []).map((f) => ({
          id: f.id,
          filename: f.filename,
          size: f.size,
        })),
      }))
      .sort((a, b) => (a.teamName ?? a.userName).localeCompare(b.teamName ?? b.userName, "ko")),
    missing,
  };
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const { db } = await requireAdmin(request, context);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "update") {
    const title = String(form.get("title") ?? "").trim();
    const description = String(form.get("description") ?? "").trim();
    const dueAtRaw = String(form.get("dueAt") ?? "").trim();
    const unit = String(form.get("unit") ?? "team");

    if (!title) return { error: "과제 제목을 입력해 주세요." };
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(dueAtRaw)) {
      return { error: "마감일시를 입력해 주세요." };
    }
    const dueAt = new Date(`${dueAtRaw}:00+09:00`);
    if (Number.isNaN(dueAt.getTime())) return { error: "마감일시가 올바르지 않아요." };
    if (!["team", "individual"].includes(unit)) return { error: "제출 단위가 올바르지 않아요." };

    await db
      .update(assignments)
      .set({
        title,
        description: description || null,
        dueAt,
        unit,
      })
      .where(eq(assignments.id, params.id!));

    return { ok: true, message: "과제 설정이 성공적으로 수정되었어요." };
  }

  if (intent === "delete") {
    await db.delete(assignments).where(eq(assignments.id, params.id!));
    return redirect("/admin/assignments");
  }

  return { error: "알 수 없는 요청이에요." };
}

export default function AdminAssignmentDetailRoute({ loaderData }: Route.ComponentProps) {
  const actionData = useActionData<typeof action>();
  const a = loaderData.assignment;
  const [isEditing, setIsEditing] = useState(false);
  const [selectedUnit, setSelectedUnit] = useState<string>(a.unit);

  return (
    <div className="stack-xl">
      <div>
        <Link to="/admin/assignments" className="back-link">
          <IconArrowLeft />
          과제 관리
        </Link>
        <div className="cluster cluster--between">
          <div className="cluster minw-0">
            <h1 className="page-head__title page-head__title--sm ellipsis">{a.title}</h1>
            <Badge tone={a.unit === "team" ? "indigo" : "gray"}>
              {a.unit === "team" ? "팀 과제" : "개인 과제"}
            </Badge>
            <Badge tone="gray">제출 {loaderData.submissions.length}건</Badge>
          </div>
          <div className="cluster flex-shrink-0">
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => setIsEditing(!isEditing)}
            >
              {isEditing ? "닫기" : "⚙️ 과제 설정 수정"}
            </button>
            {loaderData.submissions.length > 0 ? (
              <Link
                to={`/admin/assignments/${a.id}/present`}
                className="btn btn--primary btn--sm"
              >
                ▶ 발표
              </Link>
            ) : null}
          </div>
        </div>
        <p className="page-head__sub num">
          마감{" "}
          {fmtKST(new Date(a.dueAt), {
            year: "numeric",
            month: "numeric",
            day: "numeric",
            weekday: "short",
            hour: "numeric",
            minute: "2-digit",
          })}
        </p>
        {a.description ? (
          <p className="card small muted help-text notice-body mt-2">{a.description}</p>
        ) : null}
      </div>

      {actionData && "message" in actionData && actionData.message ? (
        <div className="notice notice--success" style={{ padding: "0.75rem 1rem", borderRadius: "8px" }}>
          <p className="small" style={{ color: "var(--success, #10b981)", fontWeight: 600 }}>
            {actionData.message}
          </p>
        </div>
      ) : null}

      <ErrorText>{actionData?.error}</ErrorText>

      {/* 과제 설정 수정 폼 */}
      {isEditing ? (
        <Card>
          <SectionTitle>과제 설정 수정</SectionTitle>
          <Form
            method="post"
            onSubmit={() => {
              // 폼 제출 후 편집 닫기는 액션 완료 시 반응
            }}
          >
            <input type="hidden" name="intent" value="update" />
            <Field label="과제 제목" htmlFor="edit-title">
              <input
                id="edit-title"
                name="title"
                defaultValue={a.title}
                className="input"
                required
              />
            </Field>

            <Field label="과제 설명" htmlFor="edit-desc">
              <textarea
                id="edit-desc"
                name="description"
                rows={3}
                defaultValue={a.description ?? ""}
                className="input"
                placeholder="과제 안내 문구를 입력하세요"
              />
            </Field>

            <div className="grid-2">
              <Field label="마감일시 (한국 시간 KST)" htmlFor="edit-due">
                <input
                  id="edit-due"
                  name="dueAt"
                  type="datetime-local"
                  defaultValue={a.dueAtLocal}
                  className="input num"
                  required
                />
              </Field>

              <Field label="과제 제출 단위 (팀 vs 개인)" htmlFor="edit-unit">
                <select
                  id="edit-unit"
                  name="unit"
                  className="input"
                  value={selectedUnit}
                  onChange={(e) => setSelectedUnit(e.target.value)}
                >
                  <option value="team">👥 팀 과제 (조당 1건 제출 · 팀원 공유)</option>
                  <option value="individual">👤 개인 과제 (학생별 1인 1건 제출)</option>
                </select>
              </Field>
            </div>

            <div
              className="notice notice--neutral small mt-3"
              style={{ padding: "0.75rem", borderRadius: "6px", backgroundColor: "var(--bg-subtle, #f3f4f6)" }}
            >
              💡 <strong>제출 단위 변경 안내:</strong>
              {selectedUnit === "team" ? (
                <span>
                  {" "}현재 <strong>팀 과제</strong>로 설정되어 있습니다. 같은 팀원은 동일한 제출물을 공유하며, 조별로 1건씩 제출됩니다.
                </span>
              ) : (
                <span>
                  {" "}현재 <strong>개인 과제</strong>로 설정되어 있습니다. 각 학생이 개별적으로 과제를 제출하며, 학생별로 제출 여부가 집계됩니다.
                </span>
              )}
            </div>

            <div className="cluster cluster--between mt-4">
              <div className="cluster">
                <button type="submit" className="btn btn--primary">
                  설정 저장
                </button>
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => setIsEditing(false)}
                >
                  취소
                </button>
              </div>
            </div>
          </Form>

          <div style={{ marginTop: "1.5rem", paddingTop: "1rem", borderTop: "1px solid var(--border, #e5e7eb)" }}>
            <div className="cluster cluster--between">
              <span className="small text-danger">⚠️ 과제를 삭제하면 관련된 모든 제출물과 파일이 삭제됩니다.</span>
              <Form
                method="post"
                onSubmit={(e) => {
                  if (!confirm("정말 이 과제를 삭제하시겠습니까? 되돌릴 수 없습니다.")) {
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

      {loaderData.missing.length > 0 ? (
        <Card>
          <h2 className="small text-danger">
            미제출 {a.unit === "team" ? "팀" : "학생"} ({loaderData.missing.length})
          </h2>
          <p className="small muted mt-2">{loaderData.missing.map((m) => m.label).join(" · ")}</p>
        </Card>
      ) : (
        <Card>
          <h2 className="small text-success">전원 제출 완료 🎉</h2>
        </Card>
      )}

      {loaderData.submissions.length === 0 ? (
        <EmptyState>아직 제출물이 없어요.</EmptyState>
      ) : (
        <div className="stack-md">
          {loaderData.submissions.map((s) => (
            <Card key={s.id}>
              <div className="cluster cluster--between">
                <div className="cluster minw-0">
                  <strong className="card__title">
                    {a.unit === "team" ? `${s.teamName ?? "팀명없음"} 팀` : s.userName}
                  </strong>
                  {a.unit === "team" ? <span className="small faint">제출자: {s.userName}</span> : null}
                </div>
                <span className="small faint num">
                  {fmtKST(new Date(s.updatedAt), { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" })}
                </span>
              </div>
              {s.content ? (
                <p className="notice notice--neutral notice-body" style={{ whiteSpace: "pre-wrap" }}>
                  {s.content}
                </p>
              ) : null}
              {s.link ? (
                <p className="small mt-2">
                  🔗{" "}
                  <a href={s.link} target="_blank" rel="noreferrer" className="link-url">
                    {s.link}
                  </a>
                </p>
              ) : null}
              {s.files.length > 0 ? (
                <ul className="stack-sm mt-2 bare-list">
                  {s.files.map((f) => (
                    <li key={f.id} className="item-link">
                      <span className="small ellipsis minw-0">
                        📄{" "}
                        <a
                          href={`/admin/files/${f.id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="card__link"
                        >
                          {f.filename}
                        </a>{" "}
                        <span className="faint">({formatBytes(f.size)})</span>
                      </span>
                      <a
                        href={`/admin/files/${f.id}`}
                        download={f.filename}
                        className="btn btn--ghost btn--sm"
                      >
                        다운로드
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
