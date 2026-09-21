import type { Route } from "./+types/files.$fileId";
import { requireAppContext } from "~/lib/context.server";
import { SubmissionHub } from "~/modules/submissions/index.server";

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const ctx = await requireAppContext(request, context);
  const inline = new URL(request.url).searchParams.get("inline") === "1";
  return SubmissionHub.serveFile(ctx, params.fileId!, { inline });
}
