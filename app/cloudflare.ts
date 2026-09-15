import { createContext } from "react-router";

declare global {
  interface CloudflareEnvironment extends Env {
    /** Neon Postgres 연결 문자열 (wrangler secret) */
    DATABASE_URL: string;
    /** 세션 서명용 시크릿 (로컬 미설정 시 기본값 사용) */
    SESSION_SECRET?: string;
    /** 관리자 페이지 비밀번호 (기본값: 0806) */
    ADMIN_PASSWORD?: string;
  }
}

export const cloudflareContext = createContext<{
  env: CloudflareEnvironment;
  ctx: ExecutionContext;
}>();
