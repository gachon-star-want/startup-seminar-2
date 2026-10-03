import type { Route } from "./+types/admin.team-documents.$docId";
import { requireAdminAppContext } from "~/lib/context.server";
import { TeamDocuments } from "~/modules/teams/index.server";

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const ctx = await requireAdminAppContext(request, context);
  const inline = new URL(request.url).searchParams.get("inline") === "1";
  return TeamDocuments.serve(ctx, params.docId!, { inline });
}
