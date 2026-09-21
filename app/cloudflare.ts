import { createContext } from "react-router";

declare global {
  interface CloudflareEnvironment extends Env {
    /** D1 데이터베이스 바인딩 (wrangler.toml) */
    DB: D1Database;
    /** 세션 서명용 시크릿 (로컬 미설정 시 기본값 사용) — wrangler types가 .dev.vars를 읽으면 필수 타입이 됨 */
    SESSION_SECRET: string;
    /** 관리자 페이지 비밀번호 (기본값: 0806) */
    ADMIN_PASSWORD: string;
  }
}

export const cloudflareContext = createContext<{
  env: CloudflareEnvironment;
  ctx: ExecutionContext;
}>();
