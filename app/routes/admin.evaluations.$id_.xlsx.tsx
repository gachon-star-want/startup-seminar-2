import type { Route } from "./+types/admin.evaluations.$id_.xlsx";
import { requireAdminAppContext } from "~/lib/context.server";
import { EvaluationHub } from "~/modules/evaluations/index.server";

/** 발표 평가 결과를 하나의 XLSX 스프레드시트로 내려준다 */
export async function loader({ request, context, params }: Route.LoaderArgs) {
  const ctx = await requireAdminAppContext(request, context);
  const detail = await EvaluationHub.getSessionAdminDetail(ctx, params.id!);
  const { data, filename } = EvaluationHub.buildResultsXlsx(detail);

  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
    },
  });
}
