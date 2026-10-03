import type { Route } from "./+types/admin.documents.files";
import { requireAdminAppContext } from "~/lib/context.server";
import { TeamDocuments } from "~/modules/teams/index.server";
import { TEAM_DOC_LABELS, type TeamDocKind } from "~/lib/constants";
import { uniqueZipName } from "~/lib/zip";
import { sanitizeFilename } from "~/modules/submissions/storage";

const KINDS: TeamDocKind[] = ["business", "mail_order"];

/**
 * 브라우저에서 ZIP으로 조립할 서류 목록(팀별 폴더 + 개별 다운로드 URL)을 내려준다.
 * 파일 본문은 여기서 안 읽는다 — 각 URL(/admin/team-documents/:docId)이 개별 스트리밍 서빙한다.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = await requireAdminAppContext(request, context);
  const rows = await TeamDocuments.getAdminOverview(ctx);

  // 같은 폴더 안 동명 파일은 uniqueZipName이 보정한다
  const used = new Set<string>();
  const list: { name: string; url: string; size: number }[] = [];

  for (const row of rows) {
    for (const kind of KINDS) {
      const doc = kind === "business" ? row.business : row.mailOrder;
      if (!doc) continue;
      const dot = doc.filename.lastIndexOf(".");
      const ext = dot >= 0 ? doc.filename.slice(dot + 1).toLowerCase() : "pdf";
      const name = uniqueZipName(
        used,
        `${sanitizeFilename(row.teamName)}팀/${TEAM_DOC_LABELS[kind]}.${ext}`
      );
      list.push({ name, url: `/admin/team-documents/${doc.id}`, size: doc.size });
    }
  }

  if (list.length === 0) {
    throw new Response("제출된 서류가 아직 없어요", { status: 404 });
  }

  return Response.json(
    {
      zipName: sanitizeFilename("팀별_사업서류.zip"),
      totalBytes: list.reduce((sum, f) => sum + f.size, 0),
      files: list,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
