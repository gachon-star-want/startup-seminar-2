import type { Route } from "./+types/admin.files.$fileId";
import { eq } from "drizzle-orm";
import { submissionFiles } from "~/db/schema";
import { requireAdmin } from "~/lib/session";
import { getCloudflare } from "~/lib/env";
import { getDb } from "~/db";

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const { env } = getCloudflare(context);
  await requireAdmin(request, context);

  const db = getDb(env.DATABASE_URL);
  const [file] = await db
    .select()
    .from(submissionFiles)
    .where(eq(submissionFiles.id, params.fileId!))
    .limit(1);
  if (!file) throw new Response("파일을 찾을 수 없어요", { status: 404 });

  const object = await env.FILES.get(file.r2Key);
  if (!object) throw new Response("저장된 파일이 없어요 (R2에서 삭제되었을 수 있어요)", { status: 404 });

  const encodedName = encodeURIComponent(file.filename);
  return new Response(object.body, {
    headers: {
      "Content-Type": file.mime || "application/octet-stream",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodedName}`,
      "Cache-Control": "private, no-store",
    },
  });
}
