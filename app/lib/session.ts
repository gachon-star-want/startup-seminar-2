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

export async function getCurrentUser(
  request: Request,
  context: Readonly<RouterContextProvider>,
): Promise<UserSession> {
  const cached = requestSessionCache.get(request);
  if (cached) return cached;

  const sessionPromise = (async (): Promise<UserSession> => {
    const { env } = getCloudflare(context);
    if (!env.DATABASE_URL) {
      throw new Error("DATABASE_URL 시크릿이 설정되지 않았습니다. (wrangler secret put DATABASE_URL)");
    }
    const db = getDb(env.DATABASE_URL);
    const cookies = parseCookies(request.headers.get("cookie"));
    const userId = await readSessionToken(cookies[SESSION_COOKIE], sessionSecret(env));
    if (!userId) return { user: null, env, db };
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    return { user: user ?? null, env, db };
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
  return verifyAdminToken(cookies[ADMIN_COOKIE], sessionSecret(env));
}

export async function requireAdmin(request: Request, context: Readonly<RouterContextProvider>) {
  if (!(await isAdmin(request, context))) throw redirect("/admin/login");
  return getCurrentUser(request, context); // { user, env, db }
}
