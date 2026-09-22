import type { AppContext, UserRecord } from "~/lib/context.server";
import { createFakeR2 } from "./r2";

export function createTestUser(overrides?: Partial<UserRecord>): UserRecord {
  return {
    id: overrides?.id ?? "11111111-1111-1111-1111-111111111111",
    name: overrides?.name ?? "테스트학생",
    studentNumber: overrides?.studentNumber ?? "20260001",
    birth4: overrides?.birth4 ?? "0806",
    role: overrides?.role ?? "student",
    status: overrides?.status ?? "active",
    createdAt: overrides?.createdAt ?? new Date("2026-09-01T00:00:00Z"),
  };
}

export function createTestContext(overrides?: Partial<AppContext>): AppContext {
  const fakeR2 = createFakeR2();

  const fakeEnv: any = {
    DB: {},
    SESSION_SECRET: "test-super-secret-key-32chars-long!",
    ADMIN_PASSWORD: "0806",
    FILES: fakeR2,
  };

  const fakeExecutionCtx: any = {
    waitUntil: (promise: Promise<any>) => {
      // Background promise tracker for testing
      promise.catch(() => {});
    },
    passThroughOnException: () => {},
  };

  return {
    db: (overrides?.db ?? {}) as any,
    env: (overrides?.env ?? fakeEnv) as any,
    user: overrides?.user ?? createTestUser(),
    now: overrides?.now ?? new Date("2026-09-15T10:00:00+09:00"),
    executionCtx: overrides?.executionCtx ?? fakeExecutionCtx,
  };
}
