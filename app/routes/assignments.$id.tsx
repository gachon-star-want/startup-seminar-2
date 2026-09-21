import { useState } from "react";
import { data, Form, Link, useActionData } from "react-router";
import type { Route } from "./+types/assignments.$id";
import { requireAppContext } from "~/lib/context.server";
import { SubmissionHub } from "~/modules/submissions/index.server";
import { MAX_FILES_PER_SUBMISSION, MAX_FILE_MB } from "~/lib/constants";
import { dDay, fmtKST } from "~/lib/time";
import { IconArrowLeft } from "~/components/icons";
import {
  Badge,
  Card,
  ErrorText,
  Field,
  SectionTitle,
  formatBytes,
} from "~/components/ui";

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const ctx = await requireAppContext(request, context);
  return SubmissionHub.getStudentAssignment(ctx, params.id!);
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const ctx = await requireAppContext(request, context);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "deleteFile") {
    const fileId = String(form.get("fileId") ?? "");
    const result = await SubmissionHub.deleteSubmissionFile(ctx, params.id!, fileId);
    if (!result.ok) return data({ error: result.message }, { status: 400 });
    return result;
  }

  if (intent === "submit") {
    const result = await SubmissionHub.saveSubmission(ctx, params.id!, form);
    if (!result.ok) return data({ error: result.message }, { status: 400 });
    return result;
  }

  return data({ error: "알 수 없는 요청이에요." }, { status: 400 });
}

export default function AssignmentDetailRoute({ loaderData }: Route.ComponentProps) {
  const actionData = useActionData<typeof action>();
  const a = loaderData.assignment;
  const dd = dDay(new Date(a.dueAt));

  const hasSubmission = Boolean(loaderData.submission);
  const [isEditing, setIsEditing] = useState(!hasSubmission);
  const [deleteFileIds, setDeleteFileIds] = useState<string[]>([]);

  // 제출/수정 완료 시 수정 모드 자동 종료 및 삭제 대상 목록 초기화
  const isSuccess = actionData && "ok" in actionData && actionData.ok;

  const currentFiles = loaderData.submission?.files ?? [];
  const remainingCount = currentFiles.filter((f) => !deleteFileIds.includes(f.id)).length;
  const maxNewFiles = Math.max(0, MAX_FILES_PER_SUBMISSION - remainingCount);

  return (
    <div className="stack-xl">
      <div>
        <Link to="/assignments" className="back-link">
          <IconArrowLeft />
          과제 목록
        </Link>
        <div className="cluster">
          <h1 className="page-head__title page-head__title--sm">{a.title}</h1>
          <Badge tone={a.unit === "team" ? "indigo" : "gray"}>
            {a.unit === "team" ? "팀 과제" : "개인 과제"}
          </Badge>
          {loaderData.closed ? (
            <Badge tone="red">마감됨</Badge>
          ) : (
            <Badge tone={dd <= 1 ? "red" : "amber"}>{dd === 0 ? "오늘 마감" : `D-${dd}`}</Badge>
          )}
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
          {a.unit === "team" && loaderData.myTeam ? ` · ${loaderData.myTeam.teamName} 팀으로 제출` : ""}
        </p>
        {a.description ? (
          <p className="card small muted help-text notice-body mt-3">{a.description}</p>
        ) : null}
      </div>

      {actionData && "message" in actionData && actionData.message ? (
        <div className="notice notice--success" style={{ padding: "0.75rem 1rem", borderRadius: "8px" }}>
          <p className="small" style={{ color: "var(--success, #10b981)", fontWeight: 600 }}>
            {actionData.message}
          </p>
        </div>
      ) : null}

      <ErrorText>{actionData && "error" in actionData ? actionData.error : null}</ErrorText>

      {a.unit === "team" && !loaderData.myTeam ? (
        <Card>
          <p className="small muted">
            팀 과제예요.{" "}
            <Link to="/team" className="card__link">
              내 팀 페이지
            </Link>
            에서 팀을 만들거나 합류한 뒤 제출해 주세요.
          </p>
        </Card>
      ) : loaderData.closed && !loaderData.submission ? (
        <Card>
          <p className="small" style={{ color: "var(--danger)", fontWeight: 600 }}>
            마감 전에 제출된 기록이 없어요. 관리자에게 문의해 주세요.
          </p>
        </Card>
      ) : (
        <>
          {/* 제출 완료 카드 (보기 모드) */}
          {loaderData.submission && (!isEditing || isSuccess) ? (
            <Card>
              <div className="cluster cluster--between mb-3">
                <SectionTitle right={<Badge tone="green">제출 완료</Badge>}>내 제출 내용</SectionTitle>
                {!loaderData.closed ? (
                  <button
                    type="button"
                    className="btn btn--primary btn--sm"
                    onClick={() => {
                      setIsEditing(true);
                      setDeleteFileIds([]);
                    }}
                  >
                    ✏️ 과제 수정하기
                  </button>
                ) : null}
              </div>

              {loaderData.submission.content ? (
                <div className="notice notice--neutral notice-body" style={{ whiteSpace: "pre-wrap" }}>
                  {loaderData.submission.content}
                </div>
              ) : null}

              {loaderData.submission.link ? (
                <p className="small mt-3">
                  🔗{" "}
                  <a
                    href={loaderData.submission.link}
                    target="_blank"
                    rel="noreferrer"
                    className="link-url card__link"
                  >
                    {loaderData.submission.link}
                  </a>
                </p>
              ) : null}

              {loaderData.submission.files.length > 0 ? (
                <div className="mt-4">
                  <span className="small text-muted font-bold" style={{ fontWeight: 600 }}>
                    첨부파일 ({loaderData.submission.files.length}개)
                  </span>
                  <ul className="stack-sm mt-2 bare-list">
                    {loaderData.submission.files.map((f) => (
                      <li key={f.id} className="item-link">
                        <span className="small ellipsis minw-0">
                          📄{" "}
                          <a
                            href={`/files/${f.id}`}
                            target="_blank"
                            rel="noreferrer"
                            className="card__link"
                            title="클릭하여 파일 열기/다운로드"
                          >
                            {f.filename}
                          </a>{" "}
                          <span className="faint">({formatBytes(f.size)})</span>
                        </span>
                        <div className="cluster">
                          <a
                            href={`/files/${f.id}`}
                            download={f.filename}
                            className="btn btn--ghost btn--sm"
                            title="다운로드"
                          >
                            다운로드
                          </a>
                          {!loaderData.closed ? (
                            <Form method="post" className="flex-shrink-0">
                              <input type="hidden" name="intent" value="deleteFile" />
                              <input type="hidden" name="fileId" value={f.id} />
                              <button
                                type="submit"
                                className="btn btn--danger btn--sm"
                                onClick={(e) => {
                                  if (!confirm(`'${f.filename}' 파일을 정말 삭제하시겠어요?`)) {
                                    e.preventDefault();
                                  }
                                }}
                              >
                                삭제
                              </button>
                            </Form>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <p className="small faint right num mt-4">
                마지막 수정:{" "}
                {fmtKST(new Date(loaderData.submission.updatedAt), {
                  year: "numeric",
                  month: "numeric",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </p>
            </Card>
          ) : null}

          {/* 제출 및 수정 폼 모드 */}
          {!loaderData.closed && (isEditing || !loaderData.submission) ? (
            <Card>
              <div className="cluster cluster--between mb-2">
                <SectionTitle>
                  {loaderData.submission ? "과제 수정하기" : "과제 제출하기"}
                </SectionTitle>
                {loaderData.submission ? (
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => {
                      setIsEditing(false);
                      setDeleteFileIds([]);
                    }}
                  >
                    수정 취소
                  </button>
                ) : null}
              </div>

              {loaderData.submission ? (
                <p className="small muted mb-4">
                  내용, 링크, 첨부파일을 자유롭게 변경하고 하단의 [수정 저장하기]를 눌러주세요.
                </p>
              ) : null}

              <Form method="post" encType="multipart/form-data">
                <input type="hidden" name="intent" value="submit" />

                <Field label="내용 (선택)" htmlFor="content">
                  <textarea
                    id="content"
                    name="content"
                    rows={4}
                    className="input"
                    placeholder="과제 내용이나 요약 설명을 작성해 주세요."
                    defaultValue={loaderData.submission?.content ?? ""}
                  />
                </Field>

                <Field label="링크 (노션, 구글 드라이브, 유튜브 등 URL)" htmlFor="link">
                  <input
                    id="link"
                    name="link"
                    type="url"
                    className="input"
                    placeholder="https://..."
                    defaultValue={loaderData.submission?.link ?? ""}
                  />
                </Field>

                {/* 기존 첨부파일 목록 및 삭제 선택 */}
                {loaderData.submission && loaderData.submission.files.length > 0 ? (
                  <div className="field">
                    <label className="label">
                      기존 첨부파일 관리 (삭제할 파일 체크)
                    </label>
                    <div className="stack-xs">
                      {loaderData.submission.files.map((f) => {
                        const isMarked = deleteFileIds.includes(f.id);
                        return (
                          <div
                            key={f.id}
                            className="item-link"
                            style={{
                              backgroundColor: isMarked ? "var(--bg-danger-subtle, #fee2e2)" : undefined,
                              border: isMarked ? "1px solid var(--danger, #ef4444)" : undefined,
                            }}
                          >
                            <label
                              className="cluster cluster--between minw-0"
                              style={{ width: "100%", cursor: "pointer" }}
                            >
                              <span
                                className="small ellipsis minw-0"
                                style={{
                                  textDecoration: isMarked ? "line-through" : "none",
                                  color: isMarked ? "var(--danger, #ef4444)" : "inherit",
                                }}
                              >
                                📄 {f.filename} <span className="faint">({formatBytes(f.size)})</span>
                              </span>
                              <div className="cluster flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                                <a
                                  href={`/files/${f.id}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="small card__link mr-2"
                                >
                                  열기 ↗
                                </a>
                                <label className="cluster" style={{ cursor: "pointer", gap: "0.25rem" }}>
                                  <input
                                    type="checkbox"
                                    name="deleteFileIds"
                                    value={f.id}
                                    checked={isMarked}
                                    onChange={(e) => {
                                      if (e.target.checked) {
                                        setDeleteFileIds([...deleteFileIds, f.id]);
                                      } else {
                                        setDeleteFileIds(deleteFileIds.filter((id) => id !== f.id));
                                      }
                                    }}
                                  />
                                  <span
                                    className="small font-bold"
                                    style={{
                                      color: isMarked ? "var(--danger, #ef4444)" : "var(--muted)",
                                      fontWeight: 600,
                                    }}
                                  >
                                    {isMarked ? "삭제 선택됨" : "삭제"}
                                  </span>
                                </label>
                              </div>
                            </label>
                          </div>
                        );
                      })}
                    </div>
                    {deleteFileIds.length > 0 ? (
                      <p className="small text-danger mt-1">
                        ⚠️ 체크된 {deleteFileIds.length}개 파일은 과제 저장 시 스토리지에서 함께 삭제됩니다.
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {/* 새 파일 첨부 */}
                <Field
                  label={`새 파일 첨부 (최대 ${MAX_FILES_PER_SUBMISSION}개 중 추가 가능: ${maxNewFiles}개)`}
                  htmlFor="files"
                  hint={`모든 파일 형식 첨부 가능 (PDF, PPT, Word, Excel, 한글 HWP, ZIP, 이미지, 동영상 등) · 파일당 최대 ${MAX_FILE_MB}MB`}
                >
                  <input
                    id="files"
                    name="files"
                    type="file"
                    multiple
                    accept="*/*"
                    className="input"
                    disabled={maxNewFiles <= 0}
                  />
                </Field>

                <div className="cluster mt-4">
                  <button type="submit" className="btn btn--primary flex-1">
                    {loaderData.submission ? "수정 저장하기" : "제출하기"}
                  </button>
                  {loaderData.submission ? (
                    <button
                      type="button"
                      className="btn btn--ghost"
                      onClick={() => {
                        setIsEditing(false);
                        setDeleteFileIds([]);
                      }}
                    >
                      취소
                    </button>
                  ) : null}
                </div>
              </Form>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}
