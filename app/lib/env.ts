import type { RouterContextProvider } from "react-router";
import { cloudflareContext } from "~/cloudflare";

type LoaderContext = Readonly<RouterContextProvider>;

export function getCloudflare(context: LoaderContext) {
  const cf = context.get(cloudflareContext);
  if (!cf) {
    throw new Error("Cloudflare 컨텍스트를 찾을 수 없습니다. (workers/app.ts 설정 확인)");
  }
  return cf;
}
