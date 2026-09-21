import { redirect, type RouterContextProvider } from "react-router";
import type { DB } from "~/db";
import type { users } from "~/db/schema";
import { getCloudflare } from "~/lib/env";
import { getCurrentUser, requireAdmin as sessionRequireAdmin } from "~/lib/session";

export type UserRecord = typeof users.$inferSelect;

export type AppContext = {
  db: DB;
  env: CloudflareEnvironment;
  user: UserRecord;
  now: Date;
  executionCtx?: ExecutionContext;
};

export type AdminAppContext = AppContext & {
  isAdmin: true;
};

export type OptionalAppContext = {
  db: DB;
  env: CloudflareEnvironment;
  user: UserRecord | null;
  now: Date;
  executionCtx?: ExecutionContext;
};

const requestContextCache = new WeakMap<Request, Promise<AppContext>>();
const requestOptionalContextCache = new WeakMap<Request, Promise<OptionalAppContext>>();

/**
 * 일반 사용자 인증을 요구하는 요청에 대해 단일 AppContext를 반환합니다.
 * 동일 요청 내 중복 호출 시 WeakMap 캐시를 통해 단 1회만 인증 및 DB 조회가 실행됩니다.
 */
export async function requireAppContext(
  request: Request,
  context: Readonly<RouterContextProvider>
): Promise<AppContext> {
  const cached = requestContextCache.get(request);
  if (cached) return cached;

  const promise = (async (): Promise<AppContext> => {
    const cf = getCloudflare(context);
    const session = await getCurrentUser(request, context);

    if (!session.user) {
      throw redirect("/login");
    }

    return {
      db: session.db,
      env: cf.env,
      user: session.user,
      now: new Date(),
      executionCtx: cf.ctx,
    };
  })();

  requestContextCache.set(request, promise);
  return promise;
}

/**
 * 관리자(교수) 권한을 요구하는 요청에 대해 AdminAppContext를 반환합니다.
 */
export async function requireAdminAppContext(
  request: Request,
  context: Readonly<RouterContextProvider>
): Promise<AdminAppContext> {
  const cf = getCloudflare(context);
  const session = await sessionRequireAdmin(request, context);

  // 관리자 쿠키는 통과했으나 DB 유저 세션이 없는 경우 기본 관리자 객체 주입
  const adminUser: UserRecord = session.user ?? {
    id: "00000000-0000-0000-0000-000000000000",
    name: "관리자",
    studentNumber: null,
    birth4: null,
    role: "professor",
    createdAt: new Date(),
  };

  return {
    db: session.db,
    env: cf.env,
    user: adminUser,
    isAdmin: true,
    now: new Date(),
    executionCtx: cf.ctx,
  };
}

/**
 * 로그인 여부와 무관하게(선택적 로그인) DB와 컨텍스트에 접근할 때 사용합니다.
 */
export async function getOptionalAppContext(
  request: Request,
  context: Readonly<RouterContextProvider>
): Promise<OptionalAppContext> {
  const cached = requestOptionalContextCache.get(request);
  if (cached) return cached;

  const promise = (async (): Promise<OptionalAppContext> => {
    const cf = getCloudflare(context);
    const session = await getCurrentUser(request, context);

    return {
      db: session.db,
      env: cf.env,
      user: session.user,
      now: new Date(),
      executionCtx: cf.ctx,
    };
  })();

  requestOptionalContextCache.set(request, promise);
  return promise;
}
