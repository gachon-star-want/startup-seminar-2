import { redirect, type RouterContextProvider } from "react-router";
import { eq } from "drizzle-orm";
import { getCloudflare } from "~/lib/env";
import { getDb, type DB } from "~/db";
import { users } from "~/db/schema";
import {
  ADMIN_COOKIE,
  SESSION_COOKIE,
  parseCookies,
  readSessionToken,
  verifyAdminToken,
} from "~/lib/auth";

export function sessionSecret(env: { SESSION_SECRET?: string }): string {
  return env.SESSION_SECRET || "dev-insecure-secret";
}

type UserSession = {
  user: (typeof users.$inferSelect) | null;
  env: ReturnType<typeof getCloudflare>["env"];
  db: DB;
};

// 동일한 HTTP 요청 라이프사이클 내에서 루트 loader와 하위 loader가 동시에
// getCurrentUser를 호출할 때 DB 쿼리가 중복 실행되지 않도록 WeakMap 캐싱
const requestSessionCache = new WeakMap<Request, Promise<UserSession>>();

// 격리(isolate) 단위 유저 마이크로캐시 — 매 화면 전환마다 세션 확인 SELECT가
// DB 왕복 1라운드(미국 리전 기준 ~150ms)를 점유하는 것을 막는다.
// 안전 근거: birth4는 쓰기 경로(AttendanceDesk.checkIn)가 DB 최신값으로 검증하고,
// role/status 변경(관리자 토글)은 invalidateUserCache로 즉시 무효화한다.
const USER_CACHE_TTL_MS = 60_000;
const USER_CACHE_MAX = 256;
const userCache = new Map<string, { user: typeof users.$inferSelect; exp: number }>();

function getCachedUser(userId: string): typeof users.$inferSelect | null {
  const hit = userCache.get(userId);
  if (!hit) return null;
  if (hit.exp < Date.now()) {
    userCache.delete(userId);
    return null;
  }
  return hit.user;
}

function setCachedUser(user: typeof users.$inferSelect): void {
  if (userCache.size >= USER_CACHE_MAX) {
    const now = Date.now();
    for (const [id, entry] of userCache) {
      if (entry.exp < now) userCache.delete(id);
    }
    if (userCache.size >= USER_CACHE_MAX) userCache.clear();
  }
  userCache.set(user.id, { user, exp: Date.now() + USER_CACHE_TTL_MS });
}

/**
 * role/status 같은 유저 속성을 관리자가 변경했을 때 마이크로캐시를 즉시 무효화한다.
 * 캐시는 격리(isolate) 단위이므로 다른 isolate는 TTL(60초) 내 자연 만료된다.
 */
export function invalidateUserCache(userId: string): void {
  userCache.delete(userId);
}

export async function getCurrentUser(
  request: Request,
  context: Readonly<RouterContextProvider>,
): Promise<UserSession> {
  const cached = requestSessionCache.get(request);
  if (cached) return cached;

  const sessionPromise = (async (): Promise<UserSession> => {
    const { env } = getCloudflare(context);
    if (!env.DB) {
      throw new Error("D1 바인딩(DB)이 wrangler.toml에 설정되지 않았습니다.");
    }
    const db = getDb(env.DB);
    const cookies = parseCookies(request.headers.get("cookie"));
    const userId = await readSessionToken(cookies[SESSION_COOKIE], sessionSecret(env));
    if (!userId) return { user: null, env, db };
    const cached = getCachedUser(userId);
    if (cached) return { user: cached, env, db };
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    // 휴학(비활성) 전환된 유저는 기존 세션 쿠키로도 접근할 수 없게 한다
    if (user && user.status !== "inactive") setCachedUser(user);
    return { user: user && user.status !== "inactive" ? user : null, env, db };
  })();

  requestSessionCache.set(request, sessionPromise);
  return sessionPromise;
}

export async function requireUser(request: Request, context: Readonly<RouterContextProvider>) {
  const session = await getCurrentUser(request, context);
  if (!session.user) throw redirect("/login");
  return session as {
    user: typeof users.$inferSelect;
    env: ReturnType<typeof getCloudflare>["env"];
    db: DB;
  };
}

export async function isAdmin(
  request: Request,
  context: Readonly<RouterContextProvider>,
): Promise<boolean> {
  const { env } = getCloudflare(context);
  const cookies = parseCookies(request.headers.get("cookie"));
  if (await verifyAdminToken(cookies[ADMIN_COOKIE], sessionSecret(env))) return true;

  // 교수(role=professor) 계정은 비밀번호 게이트 없이 관리자 페이지에 항상 들어갈 수 있다.
  const session = await getCurrentUser(request, context);
  return session.user?.role === "professor";
}

export async function requireAdmin(request: Request, context: Readonly<RouterContextProvider>) {
  if (!(await isAdmin(request, context))) throw redirect("/admin/login");
  return getCurrentUser(request, context); // { user, env, db }
}
