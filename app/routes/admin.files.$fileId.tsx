import type { Route } from "./+types/admin.files.$fileId";
import { requireAdminAppContext } from "~/lib/context.server";
import { SubmissionHub } from "~/modules/submissions/index.server";

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const ctx = await requireAdminAppContext(request, context);
  const inline = new URL(request.url).searchParams.get("inline") === "1";
  return SubmissionHub.serveFile(ctx, params.fileId!, { inline });
}
