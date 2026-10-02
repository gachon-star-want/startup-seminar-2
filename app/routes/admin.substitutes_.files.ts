import type { Route } from "./+types/admin.substitutes_.files";
import { requireAdminAppContext } from "~/lib/context.server";
import { SubstituteHub } from "~/modules/substitutes/index.server";
import type { SubstituteReviewFilter } from "~/modules/substitutes/substitutes.server";
import { uniqueZipName } from "~/lib/zip";
import { sanitizeFilename } from "~/modules/submissions/storage";

const FILTERS = ["pending", "all", "approved", "rejected"] as const;

function parseFilter(raw: string | null): SubstituteReviewFilter {
  return (FILTERS as readonly string[]).includes(raw ?? "") ? (raw as SubstituteReviewFilter) : "all";
}

/**
 * 브라우저에서 ZIP으로 조립할 대체 과제 파일 목록(폴더 경로 + 개별 다운로드 URL)을 내려준다.
 * 파일 본문은 여기서 안 읽는다 — 각 URL(/admin/substitute-files/:fileId)이 개별 스트리밍 서빙한다.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = await requireAdminAppContext(request, context);
  const filter = parseFilter(new URL(request.url).searchParams.get("status"));

  const sources = await SubstituteHub.getZipSources(ctx, filter);

  // 학생_수업날짜 폴더 기준으로 묶되, 같은 폴더 안 동명 파일은 uniqueZipName이 보정한다
  const used = new Set<string>();
  const list = sources.map((f) => {
    const folder = sanitizeFilename(`${f.userName}_${f.dateLabel}`);
    return {
      name: uniqueZipName(used, `${folder}/${sanitizeFilename(f.filename)}`),
      url: `/admin/substitute-files/${f.id}`,
      size: f.size,
    };
  });

  if (list.length === 0) {
    throw new Response("내려받을 첨부 파일이 없어요 (첨부가 없거나 스토리지에서 유실되었을 수 있어요)", {
      status: 404,
    });
  }

  return Response.json(
    {
      zipName: sanitizeFilename("대체과제_보고서.zip"),
      totalBytes: sources.reduce((sum, f) => sum + f.size, 0),
      files: list,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
