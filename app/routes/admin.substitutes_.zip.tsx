import type { Route } from "./+types/admin.substitutes_.zip";
import { requireAdminAppContext } from "~/lib/context.server";
import { SubstituteHub } from "~/modules/substitutes/index.server";
import type { SubstituteReviewFilter } from "~/modules/substitutes/substitutes.server";
import { buildZip, uniqueZipName } from "~/lib/zip";
import { sanitizeFilename } from "~/modules/submissions/storage";

/** R2에서 조립한 ZIP을 응답으로 감쌀 때의 총량 방어선 (Workers 메모리 한도 고려) */
const MAX_ZIP_BYTES = 120 * 1024 * 1024;

const FILTERS = ["pending", "all", "approved", "rejected"] as const;

function parseFilter(raw: string | null): SubstituteReviewFilter {
  return (FILTERS as readonly string[]).includes(raw ?? "") ? (raw as SubstituteReviewFilter) : "all";
}

/** 대체 과제 제출물 전체(또는 상태별)를 학생/수업 폴더별로 묶어 하나의 ZIP으로 내려준다 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = await requireAdminAppContext(request, context);
  const filter = parseFilter(new URL(request.url).searchParams.get("status"));

  const sources = await SubstituteHub.getZipSources(ctx, filter);

  const totalBytes = sources.reduce((sum, f) => sum + f.size, 0);
  if (totalBytes > MAX_ZIP_BYTES) {
    throw new Response(
      `파일 총 용량이 너무 커요 (${Math.round(totalBytes / 1024 / 1024)}MB). 큰 파일을 제외하고 다시 시도해 주세요.`,
      { status: 413 }
    );
  }

  // 학생_수업날짜 폴더 기준으로 묶되, 같은 폴더 안 동명 파일은 uniqueZipName이 보정한다
  const used = new Set<string>();
  const entries: { name: string; data: Uint8Array }[] = [];
  for (const f of sources) {
    const folder = sanitizeFilename(`${f.userName}_${f.dateLabel}`);
    const name = uniqueZipName(used, `${folder}/${sanitizeFilename(f.filename)}`);

    const object = await ctx.env.FILES.get(f.r2Key);
    if (!object) continue; // 스토리지에서 유실된 파일은 건너뛴다
    entries.push({ name, data: new Uint8Array(await object.arrayBuffer()) });
  }

  if (entries.length === 0) {
    throw new Response("다운로드 가능한 파일이 없어요 (첨부 파일이 없거나 스토리지에서 유실되었을 수 있어요)", {
      status: 404,
    });
  }

  const zip = buildZip(entries);
  const zipName = sanitizeFilename("대체과제_보고서.zip");

  return new Response(new Uint8Array(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(zipName)}`,
      "Cache-Control": "no-store",
    },
  });
}
