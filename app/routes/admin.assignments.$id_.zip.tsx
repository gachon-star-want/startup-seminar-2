import type { Route } from "./+types/admin.assignments.$id_.zip";
import { eq, inArray } from "drizzle-orm";
import { requireAdminAppContext } from "~/lib/context.server";
import { assignments, submissionFiles, submissions, teams, users } from "~/db/schema";
import { buildZip, uniqueZipName } from "~/lib/zip";
import { sanitizeFilename } from "~/modules/submissions/storage";

/** R2에서 조립한 ZIP을 응답으로 감쌀 때의 총량 방어선 (Workers 메모리 한도 고려) */
const MAX_ZIP_BYTES = 120 * 1024 * 1024;

/** 과제의 모든 제출 파일을 팀(또는 제출자) 폴더별로 묶어 하나의 ZIP으로 내려준다 */
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

  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
  if (totalBytes > MAX_ZIP_BYTES) {
    throw new Response(
      `파일 총 용량이 너무 커요 (${Math.round(totalBytes / 1024 / 1024)}MB). 큰 파일을 제외하고 다시 시도해 주세요.`,
      { status: 413 }
    );
  }

  // 팀명 기준으로 묶되, 같은 폴더 안 동명 파일은 uniqueZipName이 보정한다
  const used = new Set<string>();
  const entries: { name: string; data: Uint8Array }[] = [];
  for (const f of files) {
    const owner = rows.find((r) => r.submissionId === f.submissionId);
    const folder = sanitizeFilename(
      owner ? (owner.teamName ? `${owner.teamName}팀_${owner.userName}` : owner.userName) : "제출자미상"
    );
    const name = uniqueZipName(used, `${folder}/${sanitizeFilename(f.filename)}`);

    const object = await ctx.env.FILES.get(f.r2Key);
    if (!object) continue; // 스토리지에서 유실된 파일은 건너뛴다
    entries.push({ name, data: new Uint8Array(await object.arrayBuffer()) });
  }

  if (entries.length === 0) {
    throw new Response("다운로드 가능한 파일이 없어요 (스토리지에서 유실되었을 수 있어요)", {
      status: 404,
    });
  }

  const zip = buildZip(entries);
  const zipName = sanitizeFilename(`${assignment.title}_제출물.zip`);

  return new Response(new Uint8Array(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(zipName)}`,
      "Cache-Control": "no-store",
    },
  });
}
