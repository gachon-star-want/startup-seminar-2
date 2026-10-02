import type { Route } from "./+types/admin.assignments.$id_.files";
import { eq, inArray } from "drizzle-orm";
import { requireAdminAppContext } from "~/lib/context.server";
import { assignments, submissionFiles, submissions, teams, users } from "~/db/schema";
import { uniqueZipName } from "~/lib/zip";
import { sanitizeFilename } from "~/modules/submissions/storage";

/**
 * 브라우저에서 ZIP으로 조립할 파일 목록(폴더 경로 + 개별 다운로드 URL)을 내려준다.
 * 파일 본문은 여기서 안 읽는다 — 각 URL(/admin/files/:fileId)이 개별 스트리밍 서빙한다.
 */
export async function loader({ request, context, params }: Route.LoaderArgs) {
  const ctx = await requireAdminAppContext(request, context);
  const assignmentId = params.id!;

  const [assignment] = await ctx.db
    .select({ id: assignments.id, title: assignments.title })
    .from(assignments)
    .where(eq(assignments.id, assignmentId))
    .limit(1);
  if (!assignment) throw new Response("과제를 찾을 수 없어요", { status: 404 });

  const rows = await ctx.db
    .select({
      submissionId: submissions.id,
      userName: users.name,
      teamName: teams.name,
    })
    .from(submissions)
    .innerJoin(users, eq(submissions.userId, users.id))
    .leftJoin(teams, eq(submissions.teamId, teams.id))
    .where(eq(submissions.assignmentId, assignmentId));

  const subIds = rows.map((r) => r.submissionId);
  const files =
    subIds.length > 0
      ? await ctx.db.select().from(submissionFiles).where(inArray(submissionFiles.submissionId, subIds))
      : [];

  // 팀명 기준 폴더로 묶되, 같은 폴더 안 동명 파일은 uniqueZipName이 보정한다
  const used = new Set<string>();
  const list = files.map((f) => {
    const owner = rows.find((r) => r.submissionId === f.submissionId);
    const folder = sanitizeFilename(
      owner ? (owner.teamName ? `${owner.teamName}팀_${owner.userName}` : owner.userName) : "제출자미상"
    );
    return {
      name: uniqueZipName(used, `${folder}/${sanitizeFilename(f.filename)}`),
      url: `/admin/files/${f.id}`,
      size: f.size,
    };
  });

  if (list.length === 0) {
    throw new Response("내려받을 첨부 파일이 없어요 (스토리지에서 유실되었을 수 있어요)", {
      status: 404,
    });
  }

  return Response.json(
    {
      zipName: sanitizeFilename(`${assignment.title}_제출물.zip`),
      totalBytes: files.reduce((sum, f) => sum + f.size, 0),
      files: list,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
