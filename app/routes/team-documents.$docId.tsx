import type { Route } from "./+types/team-documents.$docId";
import { requireAppContext } from "~/lib/context.server";
import { TeamDocuments } from "~/modules/teams/index.server";

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const ctx = await requireAppContext(request, context);
  const inline = new URL(request.url).searchParams.get("inline") === "1";
  return TeamDocuments.serve(ctx, params.docId!, { inline });
}
