import { createRequestHandler, RouterContextProvider } from "react-router";
import { neon } from "@neondatabase/serverless";

import { cloudflareContext } from "../app/cloudflare";

declare global {
  interface CloudflareEnvironment extends Env {}
}

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export default {
  async fetch(request, env, ctx) {
    const routerContext = new RouterContextProvider();
    routerContext.set(cloudflareContext, { env, ctx });
    return requestHandler(request, routerContext);
  },
  // 크론 keep-alive: Neon free의 5분 슬립을 막아 수업 시간 첫 클릭 콜드스타트 제거
  async scheduled(_controller: ScheduledController, env: CloudflareEnvironment, ctx: ExecutionContext) {
    if (!env.DATABASE_URL) return;
    ctx.waitUntil(
      neon(env.DATABASE_URL)`select 1`.catch((err) =>
        console.error("keep-alive failed", err)
      )
    );
  },
} satisfies ExportedHandler<CloudflareEnvironment>;
