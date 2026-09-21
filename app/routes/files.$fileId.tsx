import type { Route } from "./+types/files.$fileId";
import { and, eq } from "drizzle-orm";
import { submissionFiles, submissions, teamMembers } from "~/db/schema";
import { requireUser } from "~/lib/session";
import { getCloudflare } from "~/lib/env";
import { inferMimeType } from "~/lib/mime";

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const { user, db } = await requireUser(request, context);
  const { env } = getCloudflare(context);

  const [file] = await db
    .select({
      id: submissionFiles.id,
      submissionId: submissionFiles.submissionId,
      filename: submissionFiles.filename,
      r2Key: submissionFiles.r2Key,
      mime: submissionFiles.mime,
      userId: submissions.userId,
      teamId: submissions.teamId,
    })
    .from(submissionFiles)
    .innerJoin(submissions, eq(submissionFiles.submissionId, submissions.id))
    .where(eq(submissionFiles.id, params.fileId!))
    .limit(1);

  if (!file) throw new Response("파일을 찾을 수 없어요", { status: 404 });

  // 권한 체크: 관리자(교수)이거나, 본인 제출이거나, 같은 팀 제출인 경우 허용
  const isAdmin = user.role === "professor";
  const isAuthor = file.userId === user.id;

  let isTeamMember = false;
  if (!isAdmin && !isAuthor && file.teamId) {
    const [membership] = await db
      .select({ id: teamMembers.id })
      .from(teamMembers)
      .where(and(eq(teamMembers.teamId, file.teamId), eq(teamMembers.userId, user.id)))
      .limit(1);
    isTeamMember = Boolean(membership);
  }

  if (!isAdmin && !isAuthor && !isTeamMember) {
    throw new Response("파일에 접근할 권한이 없어요", { status: 403 });
  }

  const object = await env.FILES.get(file.r2Key);
  if (!object) {
    throw new Response("저장된 파일이 없어요 (스토리지에서 삭제되었을 수 있어요)", { status: 404 });
  }

  const inline = new URL(request.url).searchParams.get("inline") === "1";
  const disposition = inline ? "inline" : "attachment";
  const encodedName = encodeURIComponent(file.filename);
  const mimeType = inferMimeType(file.filename, file.mime);

  return new Response(object.body, {
    headers: {
      "Content-Type": mimeType,
      "Content-Disposition": `${disposition}; filename*=UTF-8''${encodedName}`,
      "Cache-Control": "private, no-store",
    },
  });
}
