import { data, Form, Link, useActionData } from "react-router";
import type { Route } from "./+types/assignments.$id";
import { and, eq, or } from "drizzle-orm";
import { assignments, submissionFiles, submissions, teamMembers, teams } from "~/db/schema";
import { requireUser } from "~/lib/session";
import { getCloudflare } from "~/lib/env";
import { MAX_FILES_PER_SUBMISSION, MAX_FILE_MB } from "~/lib/constants";
import { dDay, fmtKST } from "~/lib/time";
import {
  Badge,
  Card,
  ErrorText,
  SectionTitle,
  btnDanger,
  btnPrimary,
  inputClass,
  labelClass,
  formatBytes,
} from "~/components/ui";

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const { user, db } = await requireUser(request, context);

  const [assignment] = await db
    .select()
    .from(assignments)
    .where(eq(assignments.id, params.id!))
    .limit(1);
  if (!assignment) throw new Response("과제를 찾을 수 없어요", { status: 404 });

  const now = new Date();
  const closed = assignment.dueAt < now;

  const [membership] = await db
    .select({ teamId: teamMembers.teamId, teamName: teams.name })
    .from(teamMembers)
    .innerJoin(teams, eq(teamMembers.teamId, teams.id))
    .where(eq(teamMembers.userId, user.id))
    .limit(1);

  const isTeam = assignment.unit === "team";
  if (isTeam && !membership) {
    return { assignment, closed, myTeam: null, submission: null };
  }

  const conditions = [eq(submissions.assignmentId, assignment.id)];
  if (isTeam && membership) conditions.push(eq(submissions.teamId, membership.teamId));
  else conditions.push(eq(submissions.userId, user.id));

  const [submission] = await db
    .select()
    .from(submissions)
    .where(and(...conditions))
    .limit(1);

  const files = submission
    ? await db.select().from(submissionFiles).where(eq(submissionFiles.submissionId, submission.id))
    : [];

  return {
    assignment: { ...assignment, dueAt: assignment.dueAt.toISOString() },
    closed,
    myTeam: isTeam ? membership : null,
    submission: submission
      ? {
          id: submission.id,
          content: submission.content,
          link: submission.link,
          updatedAt: submission.updatedAt.toISOString(),
          files: files.map((f) => ({
            id: f.id,
            filename: f.filename,
            size: f.size,
          })),
        }
      : null,
  };
}

function sanitizeFilename(name: string): string {
  return name.replace(/[/\\?%*:|"<>]/g, "_").slice(0, 200) || "file";
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const { user, db } = await requireUser(request, context);
  const { env } = getCloudflare(context);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  const [assignment] = await db
    .select()
    .from(assignments)
    .where(eq(assignments.id, params.id!))
    .limit(1);
  if (!assignment) throw new Response("과제를 찾을 수 없어요", { status: 404 });

  const [membership] = await db
    .select({ teamId: teamMembers.teamId })
    .from(teamMembers)
    .where(eq(teamMembers.userId, user.id))
    .limit(1);
  const isTeam = assignment.unit === "team";
  if (isTeam && !membership) {
    return data({ error: "팀 과제예요. 먼저 팀에 합류해 주세요." }, { status: 400 });
  }

  // 내(우리 팀) 제출 찾기
  const findConditions = [eq(submissions.assignmentId, assignment.id)];
  if (isTeam && membership) findConditions.push(eq(submissions.teamId, membership.teamId));
  else findConditions.push(eq(submissions.userId, user.id));
  const [existing] = await db
    .select()
    .from(submissions)
    .where(and(...findConditions))
    .limit(1);

  if (assignment.dueAt < new Date()) {
    return data({ error: "마감된 과제예요. 수정할 수 없어요." }, { status: 400 });
  }

  if (intent === "deleteFile") {
    const fileId = String(form.get("fileId") ?? "");
    const [file] = await db
      .select()
      .from(submissionFiles)
      .where(eq(submissionFiles.id, fileId))
      .limit(1);
    if (!file || !existing || file.submissionId !== existing.id) {
      return data({ error: "파일을 찾을 수 없어요." }, { status: 400 });
    }
    await db.delete(submissionFiles).where(eq(submissionFiles.id, fileId));
    try {
      await env.FILES.delete(file.r2Key);
    } catch {
      // R2 삭제 실패는 무시 (레코드는 이미 삭제됨)
    }
    return { ok: true, revalidate: true };
  }

  if (intent === "submit") {
    const content = String(form.get("content") ?? "").trim();
    const link = String(form.get("link") ?? "").trim();
    const newFiles = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);

    if (!content && !link && newFiles.length === 0 && !existing) {
      return data({ error: "내용, 링크, 파일 중 하나는 넣어주세요." }, { status: 400 });
    }
    for (const f of newFiles) {
      if (f.size > MAX_FILE_MB * 1024 * 1024) {
        return data({ error: `'${f.name}' 파일이 ${MAX_FILE_MB}MB를 초과해요.` }, { status: 400 });
      }
    }

    // 파일 개수 제한 (기존 + 새 파일)
    const existingFiles = existing
      ? await db.select({ id: submissionFiles.id }).from(submissionFiles).where(eq(submissionFiles.submissionId, existing.id))
      : [];
    // 삭제 폼에서 남긴 파일은 그대로 두므로 총합으로 검사
    if (existingFiles.length + newFiles.length > MAX_FILES_PER_SUBMISSION) {
      return data(
        { error: `파일은 최대 ${MAX_FILES_PER_SUBMISSION}개까지 첨부할 수 있어요.` },
        { status: 400 },
      );
    }

    let submissionId: string;
    if (existing) {
      await db
        .update(submissions)
        .set({ content: content || null, link: link || null, updatedAt: new Date() })
        .where(eq(submissions.id, existing.id));
      submissionId = existing.id;
    } else {
      const [created] = await db
        .insert(submissions)
        .values({
          assignmentId: assignment.id,
          userId: user.id,
          teamId: isTeam && membership ? membership.teamId : null,
          content: content || null,
          link: link || null,
        })
        .returning();
      submissionId = created.id;
    }

    const ownerKey = isTeam && membership ? membership.teamId : user.id;
    for (const file of newFiles) {
      const key = `submissions/${assignment.id}/${ownerKey}/${crypto.randomUUID()}-${sanitizeFilename(file.name)}`;
      await env.FILES.put(key, await file.arrayBuffer(), {
        httpMetadata: file.type ? { contentType: file.type } : undefined,
      });
      await db.insert(submissionFiles).values({
        submissionId,
        filename: file.name,
        r2Key: key,
        size: file.size,
        mime: file.type || null,
      });
    }

    return { ok: true, revalidate: true };
  }

  return data({ error: "알 수 없는 요청이에요." }, { status: 400 });
}

export default function AssignmentDetailRoute({ loaderData }: Route.ComponentProps) {
  const actionData = useActionData<typeof action>();
  const a = loaderData.assignment;
  const dd = dDay(new Date(a.dueAt));

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link to="/assignments" className="text-sm font-medium text-indigo-600">
          ← 과제 목록
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-extrabold tracking-tight">{a.title}</h1>
          <Badge tone={a.unit === "team" ? "indigo" : "gray"}>
            {a.unit === "team" ? "팀 과제" : "개인 과제"}
          </Badge>
          {loaderData.closed ? (
            <Badge tone="red">마감됨</Badge>
          ) : (
            <Badge tone={dd <= 1 ? "red" : "amber"}>{dd === 0 ? "오늘 마감" : `D-${dd}`}</Badge>
          )}
        </div>
        <p className="mt-1 text-sm text-slate-500">
          마감 {fmtKST(new Date(a.dueAt), { year: "numeric", month: "numeric", day: "numeric", weekday: "short", hour: "numeric", minute: "2-digit" })}
          {a.unit === "team" && loaderData.myTeam ? ` · ${loaderData.myTeam.teamName} 팀으로 제출` : ""}
        </p>
        {a.description ? (
          <p className="mt-3 whitespace-pre-wrap rounded-2xl border border-slate-200 bg-white p-4 text-sm leading-relaxed text-slate-700 shadow-sm">
            {a.description}
          </p>
        ) : null}
      </div>

      <ErrorText>{actionData && "error" in actionData ? actionData.error : null}</ErrorText>

      {a.unit === "team" && !loaderData.myTeam ? (
        <Card>
          <p className="text-sm text-slate-600">
            팀 과제예요.{" "}
            <Link to="/team" className="font-semibold text-indigo-600">
              내 팀 페이지
            </Link>
            에서 팀을 만들거나 합류한 뒤 제출해 주세요.
          </p>
        </Card>
      ) : loaderData.closed && !loaderData.submission ? (
        <Card>
          <p className="text-sm text-rose-600">마감 전에 제출된 기록이 없어요. 관리자에게 문의해 주세요.</p>
        </Card>
      ) : (
        <>
          {/* 기존 제출 내용 */}
          {loaderData.submission ? (
            <Card>
              <SectionTitle
                right={<Badge tone="green">제출 완료</Badge>}
              >
                내 제출
              </SectionTitle>
              {loaderData.submission.content ? (
                <p className="whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
                  {loaderData.submission.content}
                </p>
              ) : null}
              {loaderData.submission.link ? (
                <p className="mt-2 text-sm">
                  🔗{" "}
                  <a
                    href={loaderData.submission.link}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-indigo-600 underline"
                  >
                    {loaderData.submission.link}
                  </a>
                </p>
              ) : null}
              {loaderData.submission.files.length > 0 ? (
                <ul className="mt-3 space-y-1.5">
                  {loaderData.submission.files.map((f) => (
                    <li key={f.id} className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2 text-sm">
                      <span className="truncate">
                        📄 {f.filename}{" "}
                        <span className="text-xs text-slate-400">({formatBytes(f.size)})</span>
                      </span>
                      {!loaderData.closed ? (
                        <Form method="post" className="shrink-0">
                          <input type="hidden" name="intent" value="deleteFile" />
                          <input type="hidden" name="fileId" value={f.id} />
                          <button type="submit" className={btnDanger}>
                            삭제
                          </button>
                        </Form>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
              <p className="mt-3 text-right text-[11px] text-slate-400">
                마지막 수정 {fmtKST(new Date(loaderData.submission.updatedAt), { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" })}
              </p>
            </Card>
          ) : null}

          {/* 제출/수정 폼 */}
          {!loaderData.closed ? (
            <Card>
              <SectionTitle>{loaderData.submission ? "제출 수정" : "과제 제출"}</SectionTitle>
              <Form method="post" encType="multipart/form-data" className="space-y-4">
                <input type="hidden" name="intent" value="submit" />
                <div>
                  <label className={labelClass} htmlFor="content">
                    내용
                  </label>
                  <textarea
                    id="content"
                    name="content"
                    rows={4}
                    className={inputClass}
                    placeholder="과제 내용을 간단히 적어주세요"
                    defaultValue={loaderData.submission?.content ?? ""}
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="link">
                    링크 (노션/구글폼/유튜브 등)
                  </label>
                  <input
                    id="link"
                    name="link"
                    type="url"
                    className={inputClass}
                    placeholder="https://..."
                    defaultValue={loaderData.submission?.link ?? ""}
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="files">
                    파일 첨부 (최대 {MAX_FILES_PER_SUBMISSION}개 · 파일당 {MAX_FILE_MB}MB)
                  </label>
                  <input id="files" name="files" type="file" multiple className={inputClass} />
                </div>
                <button type="submit" className={`${btnPrimary} w-full`}>
                  {loaderData.submission ? "수정하기" : "제출하기"}
                </button>
              </Form>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}
