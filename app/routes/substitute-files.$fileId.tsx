import type { Route } from "./+types/substitute-files.$fileId";
import { requireAppContext } from "~/lib/context.server";
import { SubstituteHub } from "~/modules/substitutes/index.server";

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const ctx = await requireAppContext(request, context);
  const inline = new URL(request.url).searchParams.get("inline") === "1";
  return SubstituteHub.serveFile(ctx, params.fileId!, { inline });
}
